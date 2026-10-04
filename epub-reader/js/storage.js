"use strict";

var Storage = (function () {
  var BOOK_PREFIX = "er.book.";
  var POS_PREFIX = "er.pos.";
  var SETTINGS_KEY = "er.settings.v1";
  var PAYLOAD_LIMIT = 3000000;

  var DEFAULT_SETTINGS = {
    rate: 1,
    pitch: 1,
    voiceURI: "",
    theme: "dark"
  };

  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readJson(key) {
    var raw = lsGet(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeBookGuarded(key, payload, book) {
    if (lsSet(key, payload)) return null;
    var evicted = [];
    window.localStorage.removeItem(key);
    var books = getBooks();
    for (var i = books.length - 1; i >= 0; i--) {
      if (books[i].id === book.id) continue;
      var otherKey = BOOK_PREFIX + books[i].id;
      var other = readJson(otherKey);
      if (other && other.chapters && !other.tooLarge) {
        window.localStorage.setItem(otherKey, JSON.stringify({
          id: other.id,
          title: other.title,
          author: other.author,
          charsTotal: other.charsTotal,
          addedAt: other.addedAt,
          chapters: null,
          tooLarge: true
        }));
        evicted.push(other.title);
      }
    }
    if (!lsSet(key, payload)) return evicted;
    return evicted;
  }

  function getBooks() {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && key.indexOf(BOOK_PREFIX) === 0) {
          var book = readJson(key);
          if (book) out.push(book);
        }
      }
    } catch (e) { /* private mode etc. */ }
    out.sort(function (a, b) {
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
    return out;
  }

  function getBook(id) {
    var book = readJson(BOOK_PREFIX + id);
    if (!book) return null;
    if (!book.chapters || book.tooLarge) {
      book.chapters = null;
      book.tooLarge = true;
    }
    return book;
  }

  function saveBook(book) {
    book.addedAt = Date.now();
    var key = BOOK_PREFIX + book.id;

    var payload = JSON.stringify(book);
    if (payload.length > PAYLOAD_LIMIT) {
      lsSet(key, JSON.stringify({
        id: book.id,
        title: book.title,
        author: book.author,
        charsTotal: book.charsTotal,
        addedAt: book.addedAt,
        chapters: null,
        tooLarge: true
      }));
      book.tooLarge = true;
      book.chapters = null;
      return book;
    }

    var evicted = writeBookGuarded(key, payload, book);
    if (evicted && evicted.length) {
      book.evictedNote = evicted.join(", ");
    }
    return book;
  }

  function deleteBook(id) {
    try {
      window.localStorage.removeItem(BOOK_PREFIX + id);
      window.localStorage.removeItem(POS_PREFIX + id);
    } catch (e) { /* ignore */ }
  }

  function getPosition(id) {
    return readJson(POS_PREFIX + id);
  }

  function setPosition(id, pos) {
    var payload = JSON.stringify({ ci: pos.ci, si: pos.si, at: Date.now() });
    lsSet(POS_PREFIX + id, payload);
  }

  function getSettings() {
    var saved = readJson(SETTINGS_KEY) || {};
    var out = {};
    for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
    for (var k2 in saved) if (saved[k2] !== undefined) out[k2] = saved[k2];
    return out;
  }

  function saveSettings(partial) {
    var current = getSettings();
    for (var k in partial) current[k] = partial[k];
    lsSet(SETTINGS_KEY, JSON.stringify(current));
    return current;
  }

  return {
    getBooks: getBooks,
    getBook: getBook,
    saveBook: saveBook,
    deleteBook: deleteBook,
    getPosition: getPosition,
    setPosition: setPosition,
    getSettings: getSettings,
    saveSettings: saveSettings
  };
})();

window.Storage = Storage;
