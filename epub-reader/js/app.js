"use strict";

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  var currentBook = null;
  var bookId = null;
  var currentChapter = null;
  var currentChapterIdx = 0;
  var lastPos = { ci: 0, si: 0 };
  var themeIcons = { dark: "☀", light: "☽" };

  /* ---------- views ---------- */

  function switchView(name) {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    $("view-" + name).classList.add("active");
  }

  function showToast(container, text) {
    var el = $(container);
    el.textContent = text;
    el.classList.remove("hidden");
    setTimeout(function () { el.classList.add("hidden"); }, 5000);
  }

  /* ---------- library ---------- */

  function renderLibrary() {
    var books = Storage.getBooks();
    var list = $("library-list");
    list.textContent = "";
    $("library-empty").classList.toggle("hidden", books.length > 0);

    books.forEach(function (book) {
      var card = document.createElement("div");
      card.className = "book-card";

      var title = document.createElement("div");
      title.className = "book-card-title";
      title.textContent = book.title;
      card.appendChild(title);

      if (book.author) {
        var author = document.createElement("div");
        author.className = "book-card-author";
        author.textContent = book.author;
        card.appendChild(author);
      }

      var meta = document.createElement("div");
      meta.className = "book-card-meta";

      var pos = Storage.getPosition(book.id);
      var total = book.charsTotal || 0;
      var chapters = book.chapters && !book.tooLarge ? book.chapters : null;

      if (pos && chapters && chapters[pos.ci]) {
        var done = 0;
        for (var i = 0; i < pos.ci; i++) done += chapters[i].text.length;
        var pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
        var bar = document.createElement("div");
        bar.className = "book-card-progress";
        var fill = document.createElement("div");
        fill.className = "book-card-progress-fill";
        fill.style.width = pct + "%";
        bar.appendChild(fill);
        meta.appendChild(bar);
        var pctLabel = document.createElement("span");
        pctLabel.textContent = pct + "%";
        meta.appendChild(pctLabel);
        var resume = document.createElement("span");
        resume.className = "book-card-resume";
        resume.textContent = "resume · chapter " + (pos.ci + 1);
        meta.appendChild(resume);
      } else {
        var chaptersLabel = document.createElement("span");
        chaptersLabel.textContent = chapters
          ? chapters.length + (chapters.length === 1 ? " chapter" : " chapters")
          : "needs re-open";
        meta.appendChild(chaptersLabel);
      }

      var del = document.createElement("button");
      del.className = "book-card-delete";
      del.textContent = "×";
      del.title = "remove book";
      del.setAttribute("aria-label", "remove " + book.title);
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (bookId === book.id && EpubTTS.isSpeaking()) EpubTTS.stop();
        Storage.deleteBook(book.id);
        renderLibrary();
      });
      meta.appendChild(del);

      card.appendChild(meta);
      card.addEventListener("click", function () { openBook(book.id); });
      list.appendChild(card);
    });
  }

  /* ---------- upload ---------- */

  function handleFiles(files) {
    $("dropzone-error").classList.add("hidden");
    var epubFiles = [];
    for (var i = 0; i < files.length; i++) {
      if (/\.epub$/i.test(files[i].name)) epubFiles.push(files[i]);
    }
    if (!epubFiles.length) {
      showToast("dropzone-error", "no .epub files found");
      return;
    }
    var chain = Promise.resolve();
    epubFiles.forEach(function (file) {
      chain = chain.then(function () {
        return EpubParser.parse(file).then(function (book) {
          var saved = Storage.saveBook(book);
          renderLibrary();
          if (saved.tooLarge) {
            openBook(saved.id);
          } else if (saved.evictedNote) {
            showToast("dropzone-error",
              "storage full — dropped cached text for: " + saved.evictedNote);
          }
          if (epubFiles.length === 1) openBook(saved.id);
        }).catch(function (err) {
          showToast("dropzone-error", file.name + ": " + err.message);
        });
      });
    });
  }

  function wireDropzone() {
    var dz = $("dropzone");
    var input = $("file-input");

    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", function () {
      if (input.files && input.files.length) {
        handleFiles(input.files);
        input.value = "";
      }
    });

    ["dragenter", "dragover"].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove("dragover");
      });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  /* ---------- reader ---------- */

  function openBook(id) {
    var book = Storage.getBook(id);
    if (!book) return;
    if (book.tooLarge) {
      showToast("dropzone-error", "cached text was dropped (storage limit) — re-add the epub file");
      return;
    }

    currentBook = book;
    bookId = id;
    var pos = Storage.getPosition(id) || { ci: 0, si: 0 };
    pos.ci = Math.max(0, Math.min(pos.ci || 0, book.chapters.length - 1));
    currentChapterIdx = pos.ci;
    lastPos = { ci: pos.ci, si: 0 };

    $("reader-title").textContent = book.title;
    renderChapter(pos.ci, pos.si);
    switchView("reader");
  }

  function renderChapter(ci, startSentence) {
    currentChapterIdx = ci;
    var chapter = currentBook.chapters[ci];
    currentChapter = EpubTTS.segment(chapter.text);
    lastPos = { ci: ci, si: 0 };

    var container = $("reader-text");
    container.textContent = "";

    var flatIdx = 0;
    currentChapter.paragraphs.forEach(function (paraSentences, pIdx) {
      var p = document.createElement("p");
      if (chapter.text.length < 200 && pIdx === 0) p.className = "heading";
      paraSentences.forEach(function (sentence) {
        var span = document.createElement("span");
        span.className = "sentence";
        span.dataset.idx = flatIdx;
        span.textContent = sentence;
        p.appendChild(span);
        p.appendChild(document.createTextNode(" "));
        flatIdx++;
      });
      container.appendChild(p);
    });

    $("chapter-indicator").textContent =
      "chapter " + (ci + 1) + " / " + currentBook.chapters.length;
    $("reader-end-hint").classList.add("hidden");

    setSentenceStates(startSentence);
    if (startSentence > 0 && startSentence < currentChapter.sentences.length) {
      var target = container.querySelector('[data-idx="' + startSentence + '"]');
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function setSentenceStates(activeIdx) {
    var spans = $("reader-text").querySelectorAll(".sentence");
    for (var i = 0; i < spans.length; i++) {
      var idx = Number(spans[i].dataset.idx);
      spans[i].classList.remove("active", "read");
      if (idx < activeIdx) spans[i].classList.add("read");
      else if (idx === activeIdx) spans[i].classList.add("active");
    }
  }

  function highlight(idx) {
    if (!currentChapter) return;
    if (idx >= 0 && idx < currentChapter.sentences.length) setSentenceStates(idx);
    var target = $("reader-text").querySelector('[data-idx="' + idx + '"]');
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ---------- playback wiring ---------- */

  function playFromPosition() {
    var start = 0;
    if (lastPos.ci === currentChapterIdx && lastPos.si > 0 &&
        lastPos.si < currentChapter.sentences.length) {
      start = lastPos.si;
    }
    var chapter = currentBook.chapters[currentChapterIdx];
    EpubTTS.play(chapter.text, { chapterIdx: currentChapterIdx, startSentence: start });
  }

  function updateButtons(state) {
    var play = $("btn-play");
    if (state.speaking && state.paused) {
      play.textContent = "resume";
    } else if (state.speaking) {
      play.textContent = "pause";
    } else {
      play.textContent = "play";
    }
    $("btn-stop").disabled = !state.speaking;
  }

  function wireTTS() {
    EpubTTS.onSentence(function (pos) {
      if (pos.chapterIdx !== currentChapterIdx) return;
      lastPos = { ci: currentChapterIdx, si: pos.sentenceIdx };
      if (bookId) Storage.setPosition(bookId, { ci: lastPos.ci, si: lastPos.si });
      highlight(pos.sentenceIdx);
    });

    EpubTTS.onState(updateButtons);

    EpubTTS.onEnd(function (info) {
      if (info.chapterIdx === null || info.chapterIdx < 0) return;
      if (bookId && currentBook) {
        var lastChapter = currentBook.chapters.length - 1;
        Storage.setPosition(bookId, { ci: info.chapterIdx, si: 0 });
        if (info.chapterIdx >= lastChapter) {
          var hint = $("reader-end-hint");
          hint.textContent = "book finished — nice reading! press 'next chapter' to stay, or 'library' to go back";
          hint.classList.remove("hidden");
        } else {
          var hint2 = $("reader-end-hint");
          hint2.textContent = "chapter finished — press 'chapter →' to continue";
          hint2.classList.remove("hidden");
        }
      }
    });

    $("btn-play").addEventListener("click", function () {
      if (!currentBook) return;
      if (EpubTTS.isPaused()) EpubTTS.resume();
      else if (EpubTTS.isSpeaking()) EpubTTS.pause();
      else playFromPosition();
    });

    $("btn-stop").addEventListener("click", function () {
      EpubTTS.stop();
      if (bookId) Storage.setPosition(bookId, lastPos);
    });

    $("btn-prev").addEventListener("click", function () { navChapter(-1); });
    $("btn-next").addEventListener("click", function () { navChapter(1); });

    $("btn-back").addEventListener("click", function () {
      EpubTTS.stop();
      if (bookId) Storage.setPosition(bookId, lastPos);
      currentBook = null;
      bookId = null;
      currentChapter = null;
      switchView("library");
      renderLibrary();
    });
  }

  function navChapter(dir) {
    if (!currentBook) return;
    var next = currentChapterIdx + dir;
    if (next < 0 || next >= currentBook.chapters.length) return;
    if (EpubTTS.isSpeaking() || EpubTTS.isPaused()) EpubTTS.stop();
    if (bookId) Storage.setPosition(bookId, { ci: next, si: 0 });
    renderChapter(next, 0);
  }

  /* ---------- selects ---------- */

  function populateVoiceSelect(voices) {
    var select = $("voice-select");
    select.textContent = "";
    if (!voices || !voices.length) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "system default";
      select.appendChild(opt);
      return;
    }
    var sorted = voices.slice().sort(function (a, b) {
      if (a.localService !== b.localService) return a.localService ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    var settings = Storage.getSettings();
    var pick = settings.voiceURI;
    if (!pick) {
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].localService && sorted[i].lang.indexOf("en") === 0) {
          pick = sorted[i].voiceURI;
          break;
        }
      }
    }
    if (!pick && sorted.length) pick = sorted[0].voiceURI;

    sorted.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = v.name + " (" + v.lang + ", " + (v.localService ? "local" : "network") + ")";
      if (v.voiceURI === pick) opt.selected = true;
      select.appendChild(opt);
    });
    if (pick) EpubTTS.setVoiceURI(pick);
  }

  function wireSelects() {
    var rates = [0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0];
    var rateSelect = $("rate-select");
    var settings = Storage.getSettings();
    rates.forEach(function (r) {
      var opt = document.createElement("option");
      opt.value = String(r);
      opt.textContent = r + "×";
      if (r === settings.rate || Math.abs(r - settings.rate) < 0.01) opt.selected = true;
      rateSelect.appendChild(opt);
    });
    EpubTTS.setRate(settings.rate);

    rateSelect.addEventListener("change", function () {
      var r = parseFloat(rateSelect.value);
      EpubTTS.setRate(r);
      Storage.saveSettings({ rate: r });
    });

    var voiceSelect = $("voice-select");
    voiceSelect.addEventListener("change", function () {
      var uri = voiceSelect.value;
      EpubTTS.setVoiceURI(uri);
      Storage.saveSettings({ voiceURI: uri });
    });

    EpubTTS.onVoicesChanged(populateVoiceSelect);
    populateVoiceSelect(EpubTTS.getVoices());
  }

  /* ---------- theme ---------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("btn-theme").textContent = themeIcons[theme] || themeIcons.dark;
  }

  function wireTheme() {
    $("btn-theme").addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      Storage.saveSettings({ theme: next });
    });
  }

  /* ---------- keyboard ---------- */

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (!$("view-reader").classList.contains("active")) return;

      if (e.key === " ") {
        e.preventDefault();
        if (EpubTTS.isPaused()) EpubTTS.resume();
        else if (EpubTTS.isSpeaking()) EpubTTS.pause();
        else playFromPosition();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        navChapter(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navChapter(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrubSentence(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        scrubSentence(1);
      } else if (e.key === "Escape") {
        $("btn-back").click();
      }
    });
  }

  function scrubSentence(dir) {
    if (!currentChapter) return;
    var target = lastPos.ci === currentChapterIdx ? lastPos.si + dir : 0;
    target = Math.max(0, Math.min(target, currentChapter.sentences.length - 1));
    lastPos = { ci: currentChapterIdx, si: target };
    if (bookId) Storage.setPosition(bookId, lastPos);
    setSentenceStates(target);
    highlight(target);
  }

  /* ---------- init ---------- */

  function init() {
    var settings = Storage.getSettings();
    applyTheme(settings.theme);
    renderLibrary();
    wireDropzone();
    wireTTS();
    wireSelects();
    wireTheme();
    wireKeyboard();

    if (!EpubTTS.supported()) {
      showToast("dropzone-error", "this browser doesn't support speech synthesis — reading still works");
      var play = $("btn-play");
      play.disabled = true;
      var stop = $("btn-stop");
      stop.disabled = true;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
