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

  // Main analysis flow: run client-side analysis only
  async function run(file) {
    try {
      setStatus('Analyzing file...');
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const arrayBuffer = e.target.result;
          setStatus('Running analysis...');
          // Ensure the analysis module is loaded
          if (!window.dabzAnalysis || !window.dabzAnalysis.analyzeAudioBuffer) {
            throw new Error('Analysis module not loaded. Include js/analysis.bundle.js');
          }
          // Run the analysis and get BPM + Key
          const res = await window.dabzAnalysis.analyzeAudioBuffer(arrayBuffer, setStatus);
          setStatus('Done');
          // Display results in the dedicated result cards
          const bpmEl = document.getElementById('bpmResult');
          const keyEl = document.getElementById('keyResult');
          const playerEl = document.getElementById('player');
          if (bpmEl) bpmEl.textContent = res.bpm ?? 'Unknown';
          if (keyEl) keyEl.textContent = res.key ?? 'Unknown';
          if (playerEl) {
            // Create a blob URL for playback
            const blob = new Blob([arrayBuffer], { type: file.type });
            playerEl.src = URL.createObjectURL(blob);
          }
        } catch (err) {
          setStatus('Error: ' + err.message);
          console.error(err);
        }
      };
      reader.onerror = function() {
        setStatus('Error reading file');
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      setStatus('Error: ' + err.message);
      console.error(err);
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