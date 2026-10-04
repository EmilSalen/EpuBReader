"use strict";

var EpubTTS = (function () {
  var synth = window.speechSynthesis || null;
  var Utterance = window.SpeechSynthesisUtterance || null;

  var PLACEHOLDER = "";

  var ABBREV_RE = new RegExp(
    "\\b(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|Rev|Hon|Gen|Col|Capt|Lt|Sgt|Fig|No|Vol|Ch|" +
    "approx|etc|vs|Inc|Ltd|Co|Corp)\\.(?=\\s|$)" +
    "|\\b(?:e\\.\\s?g|i\\.\\s?e)\\.",
    "gi");

  function protect(str) {
    return str
      .replace(ABBREV_RE, function (m) { return m.replace(/\./g, PLACEHOLDER); })
      .replace(/(?:\b[A-Za-z]\.\s?){2,}/g, function (m) { return m.replace(/\./g, PLACEHOLDER); })
      .replace(/(\d)\.(?=\d)/g, "$1" + PLACEHOLDER);
  }

  var MAX_LEN = 400;

  function chunkLong(s) {
    if (s.length <= MAX_LEN) return [s];
    var out = [];
    var cur = "";
    s.split(" ").forEach(function (w) {
      if (cur && (cur + " " + w).length > MAX_LEN) {
        out.push(cur);
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    });
    if (cur) out.push(cur);
    return out;
  }

  function segment(text) {
    var paragraphs = [];
    var sentences = [];
    text.split(/\n{2,}/).forEach(function (para) {
      if (!para.trim()) return;
      var safe = protect(para);
      var raw = safe.split(/(?<=[.!?…]["'”’)\]]*)\s+/);
      var paraSentences = [];
      raw.forEach(function (s) {
        s = s.replace(new RegExp(PLACEHOLDER, "g"), ".").trim();
        if (!s) return;
        chunkLong(s).forEach(function (chunk) {
          paraSentences.push(chunk);
          sentences.push(chunk);
        });
      });
      if (paraSentences.length) paragraphs.push(paraSentences);
    });
    return { paragraphs: paragraphs, sentences: sentences };
  }

  var sentences = [];
  var currentUtter = null;
  var token = 0;
  var speaking = false;
  var paused = false;
  var chapterIdx = -1;
  var sentenceIdx = -1;
  var lastCharIndex = 0;
  var lastAdvanceAt = 0;
  var watchdog = null;
  var rate = 1;
  var pitch = 1;
  var voiceURI = "";

  var sentenceCbs = [];
  var stateCbs = [];
  var endCbs = [];
  var voicesChangedCbs = [];
  var voicesHooked = false;

  function fireEvent(cbs, data) {
    cbs.forEach(function (cb) {
      try { cb(data); } catch (e) { /* listener error shouldn't kill speech */ }
    });
  }

  function voiceByURI(uri) {
    if (!uri || !synth) return null;
    var voices = synth.getVoices();
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].voiceURI === uri) return voices[i];
    }
    return null;
  }

  function clearWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  function startWatchdog() {
    clearWatchdog();
    watchdog = setInterval(function () {
      if (!speaking || paused) return;
      if (synth.speaking || synth.pending) return;
      if (Date.now() - lastAdvanceAt < 1500) return;
      var pos = sentenceIdx;
      if (pos >= 0 && pos < sentences.length) lastAdvanceAt = Date.now();
      speakFrom(pos >= 0 ? pos : 0, lastCharIndex);
    }, 500);
  }

  function finishChapter() {
    speaking = false;
    paused = false;
    sentenceIdx = -1;
    lastCharIndex = 0;
    clearWatchdog();
    fireEvent(stateCbs, { speaking: false, paused: false });
    fireEvent(endCbs, { chapterIdx: chapterIdx });
  }

  function speakFrom(idx, charOffset) {
    if (!synth || !Utterance) return;
    var s = sentences[idx];
    if (s == null) { finishChapter(); return; }
    token++;
    var myToken = token;
    currentUtter = new Utterance(charOffset > 0 ? s.slice(charOffset) : s);
    currentUtter.rate = rate;
    currentUtter.pitch = pitch;
    var v = voiceByURI(voiceURI);
    if (v) currentUtter.voice = v;
    currentUtter.onstart = function () {
      if (myToken !== token) return;
      lastCharIndex = 0;
    };
    currentUtter.onboundary = function (e) {
      if (myToken !== token) return;
      if (typeof e.charIndex === "number") lastCharIndex = e.charIndex;
    };
    currentUtter.onend = function () {
      if (myToken !== token) return;
      lastAdvanceAt = Date.now();
      sentenceIdx = idx + 1;
      fireEvent(sentenceCbs, { chapterIdx: chapterIdx, sentenceIdx: idx + 1 });
      speakFrom(idx + 1, 0);
    };
    currentUtter.onerror = function (e) {
      if (myToken !== token) return;
      if (e && (e.error === "canceled" || e.error === "interrupted")) return;
      lastAdvanceAt = Date.now();
      speakFrom(idx + 1, 0);
    };
    sentenceIdx = idx;
    fireEvent(sentenceCbs, { chapterIdx: chapterIdx, sentenceIdx: idx });
    synth.speak(currentUtter);
  }

  function play(chapterText, opts) {
    if (!synth || !Utterance) return false;
    opts = opts || {};
    stop();
    var seg = segment(chapterText);
    if (!seg.sentences.length) return false;
    sentences = seg.sentences;
    chapterIdx = typeof opts.chapterIdx === "number" ? opts.chapterIdx : -1;
    paused = false;
    speaking = true;
    fireEvent(stateCbs, { speaking: true, paused: false });
    var start = opts.startSentence || 0;
    if (start >= sentences.length) start = 0;
    setTimeout(function () {
      lastAdvanceAt = Date.now();
      speakFrom(start, 0);
      startWatchdog();
    }, 60);
    return true;
  }

  function pause() {
    if (!speaking || paused || !synth) return;
    synth.pause();
    paused = true;
    fireEvent(stateCbs, { speaking: true, paused: true });
  }

  function resume() {
    if (!paused || !synth) return;
    paused = false;
    synth.resume();
    fireEvent(stateCbs, { speaking: true, paused: false });
    setTimeout(function () {
      if (!paused && speaking && !synth.speaking && !synth.pending) {
        lastAdvanceAt = Date.now();
        speakFrom(sentenceIdx >= 0 ? sentenceIdx : 0, lastCharIndex);
      }
    }, 250);
  }

  function stop() {
    token++;
    clearWatchdog();
    speaking = false;
    paused = false;
    sentenceIdx = -1;
    lastCharIndex = 0;
    if (synth) {
      try { synth.cancel(); } catch (e) { /* ignore */ }
    }
    fireEvent(stateCbs, { speaking: false, paused: false });
  }

  function setRate(r) {
    rate = r;
    if (speaking && !paused) {
      var keep = lastCharIndex;
      var at = sentenceIdx;
      token++;
      try { synth.cancel(); } catch (e) { /* ignore */ }
      setTimeout(function () {
        lastAdvanceAt = Date.now();
        speakFrom(at, keep);
      }, 60);
    }
  }

  function setPitch(p) {
    pitch = p;
  }

  function setVoiceURI(uri) {
    voiceURI = uri;
    if (speaking && !paused) {
      var keep = lastCharIndex;
      var at = sentenceIdx;
      token++;
      try { synth.cancel(); } catch (e) { /* ignore */ }
      setTimeout(function () {
        lastAdvanceAt = Date.now();
        speakFrom(at, keep);
      }, 60);
    }
  }

  function supported() {
    return !!(synth && Utterance);
  }

  function isSpeaking() { return speaking; }
  function isPaused() { return paused; }

  function position() {
    return { chapterIdx: chapterIdx, sentenceIdx: sentenceIdx };
  }

  function getVoices() {
    if (!synth) return [];
    return synth.getVoices();
  }

  function onVoicesChanged(cb) {
    if (!synth) return;
    voicesChangedCbs.push(cb);
    if (!voicesHooked) {
      voicesHooked = true;
      synth.addEventListener("voiceschanged", function () {
        fireEvent(voicesChangedCbs, null);
      });
    }
    setTimeout(function () { cb(getVoices()); }, 0);
  }

  function onSentence(cb) { sentenceCbs.push(cb); }
  function onState(cb) { stateCbs.push(cb); }
  function onEnd(cb) { endCbs.push(cb); }

  return {
    segment: segment,
    supported: supported,
    isSpeaking: isSpeaking,
    isPaused: isPaused,
    position: position,
    getVoices: getVoices,
    onVoicesChanged: onVoicesChanged,
    play: play,
    pause: pause,
    resume: resume,
    stop: stop,
    setRate: setRate,
    setPitch: setPitch,
    setVoiceURI: setVoiceURI,
    onSentence: onSentence,
    onState: onState,
    onEnd: onEnd
  };
})();

window.EpubTTS = EpubTTS;
