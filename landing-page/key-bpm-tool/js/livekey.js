/**
 * livekey.js
 *
 * Live (microphone) key detection. Fully self-contained and additive: it does
 * not touch the file-upload / BPM flow. It captures the microphone, keeps a
 * rolling window of recent audio, and periodically sends a small mono 16 kHz WAV
 * to the same OpenKeyScan proxy (/api/key/analyze) used by the file uploader.
 * Results are smoothed so the displayed key only changes when it is stable.
 */

(function () {
  'use strict';

  // Tuning. OpenKeyScan needs a few seconds of audio to be reliable, so we
  // analyze a rolling window rather than tiny instantaneous slices.
  const TARGET_SAMPLE_RATE = 16000; // what we upload (mono)
  const WINDOW_SECONDS = 12;        // rolling window length sent for analysis
  const MIN_SECONDS = 7;            // wait until we have this much before first call
  const ANALYZE_INTERVAL_MS = 1500; // how often we re-analyze the window
  const SMOOTHING_HISTORY = 3;      // recent results kept for stability voting
  const SMOOTHING_MIN_AGREE = 2;    // a key must appear this many times to show

  let listening = false;
  let mediaStream = null;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let silentGain = null;
  let intervalId = null;
  let analyzing = false; // guards against overlapping fetches

  // Rolling buffer of recent mono samples at the AudioContext's sample rate.
  let chunks = [];
  let chunkSamples = 0;
  let captureSampleRate = 48000;

  let recentKeys = [];
  let lastDisplayedKey = null;

  // ---- DOM ----
  let btn = null;
  let labelEl = null;
  let statusEl = null;
  let keyEl = null;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-error', Boolean(isError));
  }

  function setButtonListening(on) {
    if (!btn) return;
    btn.classList.toggle('is-listening', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (labelEl) labelEl.textContent = on ? 'Stop' : 'Detect Live Key';
  }

  function formatKey(rawKey) {
    if (
      window.dabzAnalysis &&
      typeof window.dabzAnalysis.formatOpenKeyNotation === 'function'
    ) {
      return window.dabzAnalysis.formatOpenKeyNotation(rawKey);
    }
    return rawKey;
  }

  // ---- Rolling buffer helpers ----
  function pushSamples(float32) {
    // Copy because the underlying AudioBuffer is reused by the browser.
    chunks.push(new Float32Array(float32));
    chunkSamples += float32.length;
    const maxSamples = Math.ceil(WINDOW_SECONDS * captureSampleRate);
    while (chunkSamples - chunks[0].length >= maxSamples) {
      chunkSamples -= chunks.shift().length;
    }
  }

  function getWindowSamples() {
    const out = new Float32Array(chunkSamples);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  // Average-decimate from captureSampleRate down to TARGET_SAMPLE_RATE (mono).
  function downsample(samples, fromRate, toRate) {
    if (fromRate <= toRate) return samples;
    const ratio = fromRate / toRate;
    const outLength = Math.floor(samples.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      out[i] = end > start ? sum / (end - start) : 0;
    }
    return out;
  }

  function encodeWavBlob(float32, sampleRate) {
    const numSamples = float32.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    let offset = 44;
    for (let i = 0; i < numSamples; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Only update the display when a key is stable across recent readings.
  function applySmoothing(formattedKey) {
    recentKeys.push(formattedKey);
    if (recentKeys.length > SMOOTHING_HISTORY) recentKeys.shift();

    const counts = {};
    let best = null;
    let bestCount = 0;
    for (const k of recentKeys) {
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > bestCount) {
        best = k;
        bestCount = counts[k];
      }
    }
    if (bestCount >= SMOOTHING_MIN_AGREE && best && best !== lastDisplayedKey) {
      lastDisplayedKey = best;
      if (keyEl) keyEl.textContent = best;
    }
  }

  async function analyzeWindow() {
    if (!listening || analyzing) return;
    const haveSeconds = chunkSamples / captureSampleRate;
    if (haveSeconds < MIN_SECONDS) return;

    analyzing = true;
    try {
      const windowSamples = getWindowSamples();
      const mono16k = downsample(windowSamples, captureSampleRate, TARGET_SAMPLE_RATE);
      const wavBlob = encodeWavBlob(mono16k, TARGET_SAMPLE_RATE);

      const formData = new FormData();
      formData.append('file', wavBlob, 'live.wav');

      const response = await fetch('/api/key/analyze', { method: 'POST', body: formData });
      if (!response.ok) return; // transient; keep listening
      const data = await response.json();
      const succeeded =
        data.status === 'success' || data.success === true || Boolean(data.key || data.result);
      if (!succeeded) return;

      const formatted = formatKey(data.key || data.result || 'Unknown');
      if (formatted && formatted !== 'Unknown') {
        applySmoothing(formatted);
        if (lastDisplayedKey) setStatus('Listening… detecting key live');
      }
    } catch (err) {
      // Network blips shouldn't stop the session; just try again next tick.
      console.warn('Live key analyze failed:', err);
    } finally {
      analyzing = false;
    }
  }

  async function start() {
    if (listening) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Microphone not supported in this browser.', true);
      return;
    }

    setStatus('Requesting microphone…');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      setStatus('Microphone access denied. Allow mic access and try again.', true);
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') {
      try { await audioContext.resume(); } catch (e) { /* ignore */ }
    }
    captureSampleRate = audioContext.sampleRate || 48000;

    chunks = [];
    chunkSamples = 0;
    recentKeys = [];
    lastDisplayedKey = null;

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    const bufferSize = 4096;
    processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    processorNode.onaudioprocess = (e) => {
      if (!listening) return;
      pushSamples(e.inputBuffer.getChannelData(0));
    };
    // Route through a muted gain so the processor runs without feeding mic to speakers.
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    listening = true;
    setButtonListening(true);
    setStatus('Listening… play your instrument');
    intervalId = setInterval(analyzeWindow, ANALYZE_INTERVAL_MS);
  }

  function stop() {
    listening = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (processorNode) { processorNode.onaudioprocess = null; try { processorNode.disconnect(); } catch (e) {} }
    if (silentGain) { try { silentGain.disconnect(); } catch (e) {} }
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} }
    if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); }
    if (audioContext) { try { audioContext.close(); } catch (e) {} }
    processorNode = silentGain = sourceNode = mediaStream = audioContext = null;

    setButtonListening(false);
    // Keep the last detected key displayed; show a small note.
    setStatus(lastDisplayedKey ? 'Stopped. Last detected key shown above.' : '');
  }

  function toggle() {
    if (listening) stop();
    else start();
  }

  document.addEventListener('DOMContentLoaded', () => {
    btn = document.getElementById('liveKeyBtn');
    statusEl = document.getElementById('liveKeyStatus');
    keyEl = document.getElementById('liveKeyResult');
    if (!btn) return;
    labelEl = btn.querySelector('.live-key-label');
    btn.addEventListener('click', toggle);
  });

  // Best-effort cleanup if the user navigates away mid-session.
  window.addEventListener('beforeunload', () => { if (listening) stop(); });
})();
