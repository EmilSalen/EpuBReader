# epub reader

A local, browser-based EPUB reader with read-aloud (text-to-speech). Upload an
`.epub`, read it in a clean two-page-column-free layout, and have it read aloud
sentence by sentence with live highlighting.

Everything runs in your browser — no server, no accounts, nothing uploaded.

## Run

Option 1 — just double-click `index.html` (works over `file://` in Chrome/Edge).

Option 2 — serve locally (recommended):

```powershell
python -m http.server 8080 --directory "C:\Users\ejsal\epub-reader"
# open http://localhost:8080
```

## Features

- Upload via dropzone or click (drag multiple files works too)
- Clean serif reading view with sentence highlighting + auto-scroll
- Read-aloud via the browser's built-in Web Speech API:
  - play / pause / stop
  - speed control (0.5×–2×)
  - voice picker (local voices first — the reliable ones)
  - switch voice or speed mid-sentence; playback continues from mid-sentence
- Resume: your position (chapter + sentence) is saved automatically and the
  library card shows "resume · chapter N"
- Chapter navigation (prev/next buttons + keyboard)
- Dark mode toggle (dark default), persisted
- Keyboard: Space = play/pause · ←/→ = chapters · ↑/↓ = sentence scrub · Esc = stop

## Notes

- **Voices**: what you see in the picker depends on your OS. Windows ships with
  several Microsoft voices; add more under Settings → Time & Language → Speech.
  Voices marked "network" (e.g. Google voices in Chrome) can be kill-prone —
  pause is unreliable with them and long utterances may stop silently. The app
  auto-recovers, but prefer "local" voices for best results.
- **Storage**: books are cached in localStorage. Books over ~3 MB are kept
  metadata-only — re-add the epub file to reopen them. Removing a book also
  clears its position.
- **DRM**: DRM-protected epubs are detected and refused (only font obfuscation
  is allowed). This app reads DRM-free epubs only.

## Test fixtures

`node tools\make-test-epub.js` regenerates:

- `test.epub` — valid 2-chapter book (sentences exercise abbreviation/decimal
  handling: "Mr.", "7.30", "U.S.A.", "e.g.")
- `broken.epub` — a zip that is not an epub (negative test)
- `drm.epub` — valid structure + AES encryption (must be refused)

## Files

```
index.html          UI (library + reader views)
style.css           dark/light themes, reading typography
js/storage.js       localStorage: books, positions, settings ("er." prefix)
js/epub-parser.js   epub → chapter text (JSZip, DRM check, spine)
js/tts.js           sentence segmentation + Web Speech engine
js/app.js           glue: views, upload, playback, keyboard, theme
vendor/jszip.min.js JSZip v3.10.1 (only third-party asset)
```
