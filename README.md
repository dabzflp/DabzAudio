# DabzAudio

## Key & BPM Finder — how it works (architecture)

The Key & BPM Finder detects a track's musical **key** (via the OpenKeyScan analyzer)
and estimates **BPM** (in the browser). Understanding the request path explains why
"works on localhost" is **not** the same as "works in production".

### Request flow

```
Browser (landing-page/key-bpm-tool)
  │  uploads the actual audio file as multipart/form-data, field name: "file"
  ▼
POST /api/key/analyze
  │  Netlify _redirects proxies /api/key/analyze  ->  <analyzer>/analyze/single
  ▼
OpenKeyScan analyzer (FastAPI on Railway:
  openkeyscan-analyzer-production.up.railway.app)
  │  returns JSON: {"status":"success","key":"E minor","camelot":"9A", ...}
  ▼
Browser displays the key (falls back to in-browser estimation if this fails)
```

BPM is computed entirely client-side and never leaves the browser.

### Cost: the analyzer runs scale-to-zero

The analyzer is the only always-on, RAM-hungry component, so it's run **scale-to-zero**
— idle → shut down, wakes on the next scan (Railway App Sleeping, or Cloud Run with
`--min-instances 0`; see `dabz-audio-key-bpm/RAILWAY.md`). To keep the first (cold)
scan smooth, the front-end **warms the analyzer as soon as a file is selected**
(`warmUpOpenKeyScan`) and **retries once** on the transient 502/503/504/timeout a
cold boot returns before dropping to the in-browser estimator.

### Why localhost / file paths broke production

The analyzer in production runs on a **separate machine** (Railway). Two earlier
assumptions only held on a single dev machine and failed in production:

1. **File path instead of the file.** The old `server.js` sent the analyzer a
   path on disk (`{ file: "/.../uploads/song.wav" }`). The analyzer can only open
   that path if it shares the same filesystem — true on your Mac, false on Railway.
   Fix: upload the actual file **bytes** over HTTP (multipart), which works between
   any two machines.
2. **`http://localhost:58721` default.** Localhost only exists while the analyzer
   runs on your own machine. Production must reach the deployed analyzer over HTTPS.

Other production-only gotchas that were fixed:

- The analyzer's endpoint is **`/analyze/single`**, and its multipart field must be
  named **`file`** (sending `audiofile` returns HTTP 422; hitting `/api/key/analyze`
  on the analyzer returns 404).
- Netlify only reads **`_redirects` from the publish root** (`landing-page/`), not
  from a subfolder — otherwise the `/api` proxy silently never applies.

### Project layout (key finder)

- `landing-page/key-bpm-tool/` — the deployed front-end. Edit `js/analysis.js` /
  `js/ui.js`, then **rebuild the bundle** (the browser loads `js/bundle.js`):
  ```bash
  cd dabz-audio-key-bpm && npm install && npx webpack --config webpack.config.js
  ```
- `landing-page/_redirects` — Netlify proxy rules (must stay at the publish root).
- `dabz-audio-key-bpm/server.js` — local dev server: serves the site and proxies
  `/api/key/analyze` to the analyzer. Configure the target with `OPENKEYSCAN_URL`
  (defaults to `http://localhost:58721/analyze/single` for local development):
  ```bash
  cd dabz-audio-key-bpm && npm install
  OPENKEYSCAN_URL="https://openkeyscan-analyzer-production.up.railway.app/analyze/single" npm start
  ```
- See `dabz-audio-key-bpm/RAILWAY.md` for analyzer deployment notes.

> Note: the active project code lives on the **`master`** branch.
