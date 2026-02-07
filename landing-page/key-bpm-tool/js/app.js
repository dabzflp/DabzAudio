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
    status.textContent = 'Reading file...';
    uploadBtn.disabled = true;

    // Read file as ArrayBuffer
    const fileReader = new FileReader();
    fileReader.readAsArrayBuffer(selectedFile);
    fileReader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      // Create a Blob URL for the audio player
      const blobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: selectedFile.type }));
      player.src = blobUrl;

      // progress callback shows small UI updates
      const progress = (msg) => { status.textContent = msg; };

      // do analysis client-side (analysis.js)
      const analysis = await window.dabzAnalysis.analyzeAudioBuffer(arrayBuffer, progress);

      status.textContent = 'Analysis complete.';
      bpmResult.textContent = analysis.bpm || '—';
      keyResult.textContent = analysis.key || '—';
      uploadBtn.disabled = false;
    };
    fileReader.onerror = (err) => {
      console.error(err);
      alert('Error reading file.');
      status.textContent = 'Error reading file.';
      uploadBtn.disabled = false;
    };
  } catch (err) {
    console.error(err);
    alert('Error: ' + (err.message || err));
    status.textContent = 'Error during analysis.';
    uploadBtn.disabled = false;
  }
});
