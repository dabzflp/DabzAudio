/**
 * app.js
 * Orchestrates UI interactions:
 *  - Handles file selection
 *  - Uploads file to server using uploader.js
 *  - Calls analysis.js to analyze the returned file URL
 *  - Updates UI elements with results
 *
 * All functions are commented thoroughly so you can follow the flow.
 */

const fileInput = document.getElementById('audioFile');
const uploadBtn = document.getElementById('uploadBtn');
const status = document.getElementById('status');
const bpmResult = document.getElementById('bpmResult');
const keyResult = document.getElementById('keyResult');
const player = document.getElementById('player');

let selectedFile = null;

fileInput.addEventListener('change', (e) => {
  selectedFile = e.target.files[0];
  status.textContent = selectedFile ? `Selected: ${selectedFile.name}` : 'No file selected.';
});

uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    alert('Please pick an audio file first.');
    return;
  }

  try {
    status.textContent = 'Uploading...';
    uploadBtn.disabled = true;

    // upload to server
    const res = await window.uploader.uploadFile(selectedFile);
    if (!res.success) throw new Error('Upload failed');

    status.textContent = 'Uploaded. Starting analysis...';
    // set audio player src
    player.src = res.url;

    // progress callback shows small UI updates
    const progress = (msg) => { status.textContent = msg; };

    // do analysis client-side (analysis.js)
    const analysis = await window.dabzAnalysis.analyzeAudioUrl(res.url, progress);

    status.textContent = 'Analysis complete.';
    bpmResult.textContent = analysis.bpm || '—';
    keyResult.textContent = analysis.key || '—';

  } catch (err) {
    console.error(err);
    alert('Error: ' + (err.message || err));
    status.textContent = 'Error during upload/analysis.';
  } finally {
    uploadBtn.disabled = false;
  }
});
