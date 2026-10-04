"use strict";

var EpubParser = (function () {
  // Chapters join paragraphs with "\n\n" — the tts.js sentence segmenter
  // depends on this contract for position round-tripping.
  var BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,blockquote,li,td,div";

  function isDrm(zip) {
    var encFile = zip.file("META-INF/encryption.xml");
    if (!encFile) return Promise.resolve({ drm: false });
    return encFile.async("string").then(function (xmlText) {
      var doc = new DOMParser().parseFromString(xmlText, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) {
        return { drm: true, reason: "unreadable encryption data" };
      }
      // XML documents: the element is qualified (e.g. "enc:EncryptionMethod"),
      // so getElementsByTagName("EncryptionMethod") matches nothing — use NS form
      var methods = doc.getElementsByTagNameNS("*", "EncryptionMethod");
      var obfuscation = {
        "http://www.idpf.org/2008/embedding": true,
        "http://www.adobe.com/2008/enc": true
      };
      for (var i = 0; i < methods.length; i++) {
        var algo = methods[i].getAttribute("Algorithm");
        if (!obfuscation[algo]) {
          return { drm: true, reason: "DRM-protected" };
        }
      }
      return { drm: false };
    });
  }

  function parseContainer(zip) {
    var containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) {
      return Promise.reject(new Error("not an epub (missing container.xml)"));
    }
    return containerFile.async("string").then(function (xmlText) {
      var doc = new DOMParser().parseFromString(xmlText, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) {
        throw new Error("not an epub (malformed container.xml)");
      }
      var rootfiles = doc.getElementsByTagName("rootfile");
      for (var i = 0; i < rootfiles.length; i++) {
        var type = rootfiles[i].getAttribute("media-type");
        if (type === "application/oebps-package+xml") {
          return rootfiles[i].getAttribute("full-path");
        }
      }
      throw new Error("not an epub (no package document)");
    });
  }

  function decodeEntities(text) {
    // Fallback for entities that survive even HTML parsing is unnecessary;
    // this covers raw text nodes extracted before entity decoding.
    if (text.indexOf("&") === -1) return text;
    var el = document.createElement("textarea");
    el.innerHTML = text;
    return el.value;
  }

  function parseOpf(zip, opfPath) {
    var opfFile = zip.file(opfPath);
    if (!opfFile) {
      return Promise.reject(new Error("not an epub (missing package document)"));
    }
    return opfFile.async("string").then(function (xmlText) {
      var doc = new DOMParser().parseFromString(xmlText, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) {
        doc = new DOMParser().parseFromString(xmlText, "text/html");
      }

      var el = doc.getElementsByTagName("dc:title")[0] ||
               doc.querySelector("metadata title") ||
               doc.querySelector("title");
      var title = el && el.textContent ? el.textContent.trim() : "untitled";

      var authorEl = doc.getElementsByTagName("dc:creator")[0] ||
                     doc.querySelector("metadata creator") ||
                     doc.querySelector("creator");
      var author = authorEl && authorEl.textContent ? authorEl.textContent.trim() : "";

      var manifest = {};
      var items = doc.getElementsByTagName("item");
      for (var i = 0; i < items.length; i++) {
        var id = items[i].getAttribute("id");
        var href = items[i].getAttribute("href");
        var mediaType = items[i].getAttribute("media-type") || "";
        if (id && href && mediaType.indexOf("html") !== -1) {
          manifest[id] = href;
        }
      }
      if (!Object.keys(manifest).length) {
        var rawItems = doc.getElementsByTagName("item");
        for (var j = 0; j < rawItems.length; j++) {
          var id2 = rawItems[j].getAttribute("id");
          var href2 = rawItems[j].getAttribute("href");
          if (id2 && href2 && /\.x?html?$/i.test(href2)) {
            manifest[id2] = href2;
          }
        }
      }

      var hrefs = [];
      var spineItems = doc.getElementsByTagName("itemref");
      for (var k = 0; k < spineItems.length; k++) {
        var idref = spineItems[k].getAttribute("idref");
        if (manifest[idref]) hrefs.push(manifest[idref]);
      }
      if (!hrefs.length) {
        hrefs = Object.keys(manifest).map(function (m) { return manifest[m]; });
      }
      if (!hrefs.length) {
        throw new Error("no readable chapters in this epub");
      }

      var opfDir = opfPath.indexOf("/") === -1 ? "" : opfPath.slice(0, opfPath.lastIndexOf("/") + 1);
      return { title: title, author: author, hrefs: hrefs, opfDir: opfDir };
    });
  }

  function resolvePath(opfDir, href) {
    if (/^[a-z]+:\/\//i.test(href)) return null; // absolute/external
    var path = opfDir + href;
    var parts = path.split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "." || parts[i] === "") continue;
      if (parts[i] === "..") { out.pop(); continue; }
      out.push(parts[i]);
    }
    return out.join("/");
  }

  function extractText(body) {
    var blocks = body.querySelectorAll(BLOCK_SELECTOR);
    var used = [];
    var paras = [];
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i];
      var skip = false;
      for (var j = 0; j < used.length; j++) {
        if (used[j].contains(el)) { skip = true; break; }
      }
      if (skip) continue;
      var inner = el.querySelectorAll(BLOCK_SELECTOR);
      if (inner.length) {
        for (var k = 0; k < inner.length; k++) used.push(inner[k]);
      }
      var text = el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";
      if (text) paras.push(decodeEntities(text));
    }
    return paras.join("\n\n");
  }

  function chapterText(zip, opfDir, href) {
    var path = resolvePath(opfDir, href);
    if (!path) return Promise.resolve("");
    var file = zip.file(path);
    if (!file) {
      var bare = href.indexOf("/") === -1 ? href : href.slice(href.lastIndexOf("/") + 1);
      file = zip.file(bare);
    }
    if (!file) return Promise.resolve("");
    return file.async("string").then(function (raw) {
      var doc = new DOMParser().parseFromString(raw, "application/xhtml+xml");
      if (doc.getElementsByTagName("parsererror").length) {
        doc = new DOMParser().parseFromString(raw, "text/html");
      }
      var body = doc.getElementsByTagName("body")[0];
      if (!body) return "";
      return extractText(body);
    });
  }

  function djb2(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
      hash = hash >>> 0;
    }
    return hash.toString(36);
  }

  function parse(file) {
    if (!file) return Promise.reject(new Error("no file"));
    if (!window.JSZip) {
      return Promise.reject(new Error("JSZip failed to load"));
    }
    return file.arrayBuffer().then(function (buffer) {
      return window.JSZip.loadAsync(buffer);
    }).then(function (zip) {
      return isDrm(zip).then(function (drmResult) {
        if (drmResult.drm) {
          throw new Error(drmResult.reason + " — this epub can't be opened");
        }
        return parseContainer(zip).then(function (opfPath) {
          return parseOpf(zip, opfPath).then(function (meta) {
            var chapters = [];
            var chain = Promise.resolve();
            var charsTotal = 0;
            meta.hrefs.forEach(function (href) {
              chain = chain.then(function () {
                return chapterText(zip, meta.opfDir, href).then(function (text) {
                  if (text) {
                    var chapter = {
                      index: chapters.length,
                      text: text,
                      wordCount: text.split(/\s+/).filter(Boolean).length
                    };
                    chapters.push(chapter);
                    charsTotal += text.length;
                  }
                });
              });
            });
            return chain.then(function () {
              if (!chapters.length) {
                throw new Error("no readable chapters in this epub");
              }
              return {
                id: djb2((meta.title || "untitled") + "::" + (meta.author || "")),
                title: meta.title,
                author: meta.author,
                chapters: chapters,
                charsTotal: charsTotal
              };
            });
          });
        });
      });
    });
  }

  return { parse: parse };
})();

window.EpubParser = EpubParser;
