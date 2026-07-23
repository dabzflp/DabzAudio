const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure `fetch` is available in Node environments that lack a global fetch (older Node versions)
if (typeof fetch === 'undefined') {
  try {
    // cross-fetch works in CommonJS and ESM environments
    // eslint-disable-next-line global-require
    global.fetch = require('cross-fetch');
    console.log('Global fetch polyfilled using cross-fetch');
  } catch (err) {
    console.warn('cross-fetch not installed; please run `npm install` to enable backend OpenKeyScan forwarding if using older Node versions.');
  }
}

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, '../landing-page')));
app.use('/dabz-audio-key-bpm', express.static(path.join(__dirname, './public')));
app.use('/dabz-audio-reverb-delay-calculator', express.static(path.join(__dirname, '../dabz-audio-reverb-delay-calculator')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Warm-up ping: the front-end hits this the moment a file is picked so a
// scale-to-zero analyzer starts booting before the real scan. We just poke the
// analyzer to wake it; its response doesn't matter (a 404/405 still wakes it).
app.get('/api/key/analyze', async (req, res) => {
  const openKeyScanUrl = process.env.OPENKEYSCAN_URL || 'http://localhost:58721/analyze/single';
  const base = openKeyScanUrl.replace(/\/analyze\/single\/?$/, '') || openKeyScanUrl;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      await fetch(base, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Best-effort — waking is what matters, not the result.
  }
  return res.json({ warmed: true });
});

app.post('/api/key/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const absolutePath = path.join(UPLOADS_DIR, req.file.filename);

  try {
    const openKeyScanUrl = process.env.OPENKEYSCAN_URL || 'http://localhost:58721/analyze/single';

    if (!process.env.OPENKEYSCAN_URL) {
      console.warn('OPENKEYSCAN_URL not set; using localhost fallback (development only)');
    }

    console.log('Forwarding file to OpenKeyScan:', absolutePath, '->', openKeyScanUrl);

    // OpenKeyScan's /analyze/single expects the actual file as a multipart upload
    // under the field name "file" -- not a JSON file path. Passing a path only
    // works when the analyzer shares this machine's filesystem (local dev), which
    // is why production (a separate host) was failing.
    const fileBuffer = fs.readFileSync(absolutePath);
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), req.file.originalname || req.file.filename);

    const openKeyScanResponse = await fetch(openKeyScanUrl, {
      method: 'POST',
      body: form
    });

    if (!openKeyScanResponse.ok) {
      const text = await openKeyScanResponse.text();
      console.error('OpenKeyScan API error:', openKeyScanResponse.status, text, 'path:', absolutePath);
      return res.status(502).json({ success: false, message: 'OpenKeyScan API error', details: text });
    }

    const data = await openKeyScanResponse.json();
    const key = data.key || data.result || null;
    // Pass through OpenKeyScan's fields (key, camelot, openkey, ...) and keep the
    // legacy `success` flag so the front-end works against either response shape.
    return res.json({ success: true, ...data, key });
  } catch (error) {
    console.error('OpenKeyScan call failed:', error);
    return res.status(500).json({ success: false, message: 'OpenKeyScan call failed', error: error.message });
  } finally {
    fs.unlink(absolutePath, () => {});
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing server or set PORT to a different value.`);
    process.exit(1);
  }
  throw err;
});
