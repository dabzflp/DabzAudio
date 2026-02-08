// /**
//  * server.js
//  * Simple Express server that:
//  *  - serves static files from /public
//  *  - accepts uploaded audio files at POST /upload (using multer)
//  *  - serves uploaded files from /uploads
//  *
//  * NOTE: This server does NOT perform server-side BPM/key analysis by default.
//  *       See comments below where to plug-in server-side analysis (Essentia.js, Meyda offline).
//  */

// const express = require('express');
// const multer  = require('multer');
// const path = require('path');
// const fs = require('fs');

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Enable CORS for Netlify frontend and Railway backend only
// const allowedOrigins = [
//   'https://dabzaudio.netlify.app',
//   'https://dabzaudio-production.up.railway.app'
// ];
// app.use((req, res, next) => {
//   const origin = req.headers.origin;
//   if (allowedOrigins.includes(origin)) {
//     res.header('Access-Control-Allow-Origin', origin);
//   }
//   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//   if (req.method === 'OPTIONS') {
//     return res.sendStatus(200);
//   }
//   next();
// });

// // Make sure uploads dir exists
// const UPLOADS_DIR = path.join(__dirname, 'uploads');
// if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// // Multer configuration: store uploads in /uploads with original filename (you might want to sanitize in prod)
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, UPLOADS_DIR)
//   },
//   filename: function (req, file, cb) {
//     // keep original filename - production: sanitize/unique-ify
//     cb(null, Date.now() + '-' + file.originalname)
//   }
// });
// const upload = multer({ storage: storage });

// // Serve landing page static files
// app.use(express.static(path.join(__dirname, '../landing-page')));

// // Serve landing page at root
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, '../landing-page/index.html'));
// });

// // Serve tool's public static files at /dabz-audio-key-bpm
// app.use('/dabz-audio-key-bpm', express.static(path.join(__dirname, './public')));

// // Serve dabz-audio-reverb-delay at /dabz-audio-reverb-delay-calculator
// app.use(
//   '/dabz-audio-reverb-delay-calculator',
//   express.static(path.join(__dirname, '../dabz-audio-reverb-delay-calculator'))
// );

// // Serve uploads
// app.use('/uploads', express.static(UPLOADS_DIR));


// /**
//  * Upload endpoint
//  * - Accepts form-data with field 'audiofile'
//  * - Returns JSON: { success: true, url: "/uploads/..." }
//  *
//  * NOTE: This is where you could run server-side analysis after receiving the file.
//  * Example approaches:
//  *  - Essentia.js (WASM) supports key and BPM estimation in Node (but adds heavy dependencies). :contentReference[oaicite:4]{index=4}
//  *  - Meyda has offline extraction examples and can be used in Node with a compatible audio decoding approach. :contentReference[oaicite:5]{index=5}
//  *  - Practical flow in server-side analysis:
//  *     1. Decode uploaded audio into PCM samples (ffmpeg, audio-decode, or node-web-audio-api).
//  *     2. Feed PCM to Meyda or Essentia.js for chroma / tempo analysis.
//  *     3. Save analysis result and return it in the response here.
//  */
// app.post('/upload', upload.single('audiofile'), async (req, res) => {
//   if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

//   // Build full public URL for the uploaded file
//   const protocol = req.headers['x-forwarded-proto'] || req.protocol;
//   const host = req.headers['x-forwarded-host'] || req.headers.host;
//   const publicUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

//   // --- PLACE FOR SERVER-SIDE ANALYSIS ---
//   // e.g.
//   // const result = await runServerSideAnalysis(path.join(UPLOADS_DIR, req.file.filename));
//   // return res.json({ success: true, url: publicUrl, analysis: result });

//   // For now, we only return the URL for client-side analysis.
//   res.json({ success: true, url: publicUrl });
// });

// // Start server
// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`Server listening on http://0.0.0.0:${PORT}`);
// });