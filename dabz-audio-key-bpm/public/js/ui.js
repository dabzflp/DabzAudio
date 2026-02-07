/**
 * ui.js
 * Handles UI interactions: file selection, upload button, and displaying results.
 *
 * - Listens for file input changes or upload button clicks
 * - Calls uploadFile() from uploader.js to upload the selected audio
 * - Runs client-side analysis using window.dabzAnalysis
 * - Displays BPM and Key results in the UI
 */

document.addEventListener('DOMContentLoaded', () => {
  // Get UI elements by their IDs
  const input = document.getElementById('audioFile');
  const btn = document.getElementById('uploadBtn');
  const statusEl = document.getElementById('status');

  // Update status/progress message
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  // Upload a file to the server
  async function upload(file) {
    const fd = new FormData();
    fd.append('audiofile', file);
    setStatus('Uploading...');
    // Use absolute URL to work with ngrok and different domains
    const uploadUrl = window.location.origin + '/upload';
    const r = await fetch(uploadUrl, { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.success) throw new Error(j.message || 'Upload failed');
    return j.url;
  }

  // Main analysis flow: upload file → run analysis → display results
  async function run(file) {
    try {
      setStatus('Uploading file...');
      const url = await upload(file);
      setStatus('Uploaded. Starting analysis...');

      // Ensure the analysis module is loaded
      if (!window.dabzAnalysis || !window.dabzAnalysis.analyzeAudioUrl) {
        throw new Error('Analysis module not loaded. Include js/analysis.bundle.js');
      }

      // Run the analysis and get BPM + Key
      const res = await window.dabzAnalysis.analyzeAudioUrl(url, setStatus);
      setStatus('Done');
      
      // Display results in the dedicated result cards
      const bpmEl = document.getElementById('bpmResult');
      const keyEl = document.getElementById('keyResult');
      const playerEl = document.getElementById('player');
      
      if (bpmEl) bpmEl.textContent = res.bpm ?? 'Unknown';
      if (keyEl) keyEl.textContent = res.key ?? 'Unknown';
      if (playerEl) playerEl.src = url;
    } catch (e) {
      setStatus('Error: ' + (e.message || String(e)));
      console.error(e);
    }
  }

  // Handle file selection via input or upload button
  if (btn) {
    btn.addEventListener('click', () => {
      const f = input.files && input.files[0];
      if (!f) return alert('Choose a file first');
      run(f);
    });
  } else if (input) {
    input.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) run(f);
    });
  }
});