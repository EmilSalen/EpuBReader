"use strict";
// Generates three test epubs in the project root:
//   test.epub   — valid 2-chapter book (exercises the sentence splitter)
//   broken.epub — a zip that is not an epub
//   drm.epub    — valid structure plus DRM encryption (must be rejected)
// Run: node tools\make-test-epub.js

var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

var OUT_DIR = path.join(__dirname, "..");

/* ---------- minimal stored-only zip writer ---------- */

var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  var c = 0 ^ -1;
  for (var i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  var time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  var date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time: time, date: date };
}

// entries: [{ name, data (Buffer), store (bool) }]
function writeZip(entries) {
  var localParts = [];
  var centralParts = [];
  var offset = 0;
  var now = dosDateTime(new Date());

  entries.forEach(function (entry) {
    var nameBuf = Buffer.from(entry.name, "utf8");
    var data = entry.store ? entry.data : zlib.deflateRawSync(entry.data);
    var method = entry.store ? 0 : 8;
    var crc = crc32(entry.data);

    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    var central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  });

  var centralSize = centralParts.reduce(function (sum, b) { return sum + b.length; }, 0);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(localParts.concat(centralParts, [end]));
}

/* ---------- epub content ---------- */

function xhtmlPage(title, bodyHtml) {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE html>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n' +
    '<head><title>' + title + '</title></head>\n' +
    '<body>\n' + bodyHtml + '\n</body>\n</html>\n',
    "utf8");
}

var CHAPTER1 =
  '<h1>The Typing Chronicles</h1>\n' +
  '<p>Mr. Smith woke at 7.30 in the morning, which was early for him. The U.S.A. bird populations had grown by e.g. remarkable numbers, he thought, reading the news on his tablet.</p>\n' +
  '<p>"What a day," he said to nobody in particular. Dr. Jones had warned him about staying up late, but who listens to doctors these days?</p>\n' +
  '<p>He walked to the corner of Oak St. and bought coffee from the shop beside the cafe. The barista greeted him by name. A long sentence follows so that the chunking logic can be exercised: he walked slowly past the bakery where the smell of fresh bread drifted through open windows into the morning air settle over the quiet neighborhood streets while children ran shrieking toward the school bus stop at the end of the block and the day began properly.</p>\n';

var CHAPTER2 =
  '<h1>On Persistence</h1>\n' +
  '<p>Every book remembers where you stopped reading. This chapter exists so that position-resume behavior can be tested across sessions.</p>\n' +
  '<p>Read a little, pause, close the tab, and return. The highlight should rest exactly on the sentence where you left off. Question marks? Exclamation points! Ellipses… all belong.</p>\n';

var CONTAINER =
  '<?xml version="1.0"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
  '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
  '</container>\n';

function opfXml(idBase) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">\n' +
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '    <dc:identifier id="book-id">urn:uuid:' + idBase + '</dc:identifier>\n' +
    '    <dc:title>' + (idBase === "test" ? "The Typing Chronicles" : "The Locked Book") + '</dc:title>\n' +
    '    <dc:creator>Jane Keystroke</dc:creator>\n' +
    '    <dc:language>en</dc:language>\n' +
    '  </metadata>\n' +
    '  <manifest>\n' +
    '    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
    '    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>\n' +
    '  </manifest>\n' +
    '  <spine>\n' +
    '    <itemref idref="ch1"/>\n' +
    '    <itemref idref="ch2"/>\n' +
    '  </spine>\n' +
    '</package>\n';
}

var ENCRYPTION =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">\n' +
  '  <enc:encryptedData>\n' +
  '    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>\n' +
  '    <enc:CipherData><enc:CipherReference URI="OEBPS/chapter1.xhtml"/></enc:CipherData>\n' +
  '  </enc:encryptedData>\n' +
  '</encryption>\n';

var entriesTest = [
  { name: "mimetype", data: Buffer.from("application/epub+zip", "utf8"), store: true }, // must be first + stored
  { name: "META-INF/container.xml", data: Buffer.from(CONTAINER, "utf8") },
  { name: "OEBPS/content.opf", data: Buffer.from(opfXml("test"), "utf8") },
  { name: "OEBPS/chapter1.xhtml", data: xhtmlPage("chapter one", CHAPTER1) },
  { name: "OEBPS/chapter2.xhtml", data: xhtmlPage("chapter two", CHAPTER2) }
];

var entriesBroken = [
  { name: "readme.txt", data: Buffer.from("this is not an epub", "utf8") }
];

var entriesDrm = [
  { name: "mimetype", data: Buffer.from("application/epub+zip", "utf8"), store: true },
  { name: "META-INF/container.xml", data: Buffer.from(CONTAINER, "utf8") },
  { name: "META-INF/encryption.xml", data: Buffer.from(ENCRYPTION, "utf8") },
  { name: "OEBPS/content.opf", data: Buffer.from(opfXml("drm"), "utf8") },
  { name: "OEBPS/chapter1.xhtml", data: xhtmlPage("chapter one", CHAPTER1) },
  { name: "OEBPS/chapter2.xhtml", data: xhtmlPage("chapter two", CHAPTER2) }
];

fs.writeFileSync(path.join(OUT_DIR, "test.epub"), writeZip(entriesTest));
fs.writeFileSync(path.join(OUT_DIR, "broken.epub"), writeZip(entriesBroken));
fs.writeFileSync(path.join(OUT_DIR, "drm.epub"), writeZip(entriesDrm));
console.log("wrote test.epub, broken.epub, drm.epub to " + OUT_DIR);
