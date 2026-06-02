const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.post('/api/key/analyze', upload.single('audiofile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  try {
    const absolutePath = path.join(UPLOADS_DIR, req.file.filename);
    const openKeyScanUrl = process.env.OPENKEYSCAN_URL || 'http://localhost:58721/analyze/single';

    if (!process.env.OPENKEYSCAN_URL) {
      console.warn('OPENKEYSCAN_URL not set; using localhost fallback (development only)');
    }

    console.log('Forwarding file to OpenKeyScan:', absolutePath, '->', openKeyScanUrl);

    const openKeyScanResponse = await fetch(openKeyScanUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: absolutePath })
    });

    if (!openKeyScanResponse.ok) {
      const text = await openKeyScanResponse.text();
      console.error('OpenKeyScan API error:', openKeyScanResponse.status, text, 'path:', absolutePath);
      return res.status(502).json({ success: false, message: 'OpenKeyScan API error', details: text });
    }

    const data = await openKeyScanResponse.json();
    const key = data.key || data.result || null;
    return res.json({ success: true, key, raw: data, file: absolutePath });
  } catch (error) {
    console.error('OpenKeyScan call failed:', error);
    return res.status(500).json({ success: false, message: 'OpenKeyScan call failed', error: error.message });
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
