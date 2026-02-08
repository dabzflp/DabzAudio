// Analyze audio from ArrayBuffer (for client-side analysis)
async function analyzeAudioBuffer(arrBuffer, progressCallback = () => {}) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioContext();

    progressCallback("Decoding audio...");
    const audioBuffer = await ac.decodeAudioData(arrBuffer);
    console.log('Decoded audioBuffer:', audioBuffer);

    // Meyda setup
    const Meyda = await ensureMeyda();
    console.log('Meyda loaded:', !!Meyda);

    progressCallback("Extracting chroma features...");
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.numberOfChannels > 0 ? audioBuffer.getChannelData(0) : null;
    console.log('Channel data:', channelData ? channelData.length : 'none');
    if (!channelData) {
      console.warn('No channel data');
      return { bpm: null, key: "Unknown" };
    }

    const frameSize = 4096;
    const hopSize = 2048;
    const chromaSum = new Array(12).fill(0);
    let frames = 0;

    for (let i = 0; i + frameSize <= channelData.length; i += hopSize) {
      const frame = channelData.slice(i, i + frameSize);
      const chroma = Meyda.extract("chroma", frame, {
        bufferSize: frameSize,
        sampleRate,
      });
      if (Array.isArray(chroma) && chroma.length === 12) {
        for (let k = 0; k < 12; k++) chromaSum[k] += chroma[k];
        frames++;
      }
      if (i % (hopSize * 50) === 0)
        progressCallback(`Chroma: ${(i / channelData.length * 100).toFixed(1)}%`);
      if (i % (hopSize * 50) === 0) console.log(`Chroma frame ${i}:`, chroma);
    }

    if (frames === 0) {
      console.warn('No valid chroma frames');
      return { bpm: null, key: "Unknown" };
    }
    const chromaAvg = chromaSum.map((v) => v / frames);
    const key = estimateKeyFromChroma(chromaAvg);
    console.log('Chroma avg:', chromaAvg, 'Estimated key:', key);

    progressCallback("Estimating BPM (Energy Peaks)...");
    const bpm = await estimateBPM(audioBuffer);
    console.log('Estimated BPM:', bpm);

    ac.close();
    return { bpm, key };
  } catch (err) {
    console.error('analyzeAudioBuffer error:', err);
    return { bpm: null, key: "Unknown" };
  }
}
/**
 * analysis.js
 *
 * Client-side audio analysis:
 *  - Loads an audio file into Web Audio API
 *  - Uses Meyda for chroma feature extraction → Key estimation
 *  - Uses realtime-bpm-analyzer for BPM estimation
 *
 * Dependencies:
 *  - public/js/meyda.min.js   (already in project)
 *  - npm install realtime-bpm-analyzer
 */

/* ---- Load Meyda (local copy in /public/js/) ---- */
async function ensureMeyda() {
  if (window.Meyda) return window.Meyda;
  // Remove any existing Meyda script tags (CDN or otherwise)
  Array.from(document.querySelectorAll('script')).forEach(s => {
    if (s.src && s.src.includes('meyda')) s.remove();
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/meyda.min.js"; // always use local
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Meyda locally"));
    document.head.appendChild(s);
  });
  return window.Meyda;
}

/* ---- Main analysis function ---- */
async function analyzeAudioUrl(audioUrl, progressCallback = () => {}) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ac = new AudioContext();

  progressCallback("Fetching audio...");
  const resp = await fetch(audioUrl);
  const arrBuffer = await resp.arrayBuffer();
  progressCallback("Decoding audio...");
  const audioBuffer = await ac.decodeAudioData(arrBuffer);

  const src = ac.createBufferSource();
  src.buffer = audioBuffer;

  const node = ac.createGain();
  src.connect(node);
  node.connect(ac.destination);

  // Meyda setup
  const Meyda = await ensureMeyda();

  progressCallback("Extracting chroma features...");
  const sampleRate = audioBuffer.sampleRate;
  const channelData =
    audioBuffer.numberOfChannels > 0
      ? audioBuffer.getChannelData(0)
      : null;
  if (!channelData) return { bpm: null, key: "Unknown" };

  const frameSize = 4096;
  const hopSize = 2048;
  const chromaSum = new Array(12).fill(0);
  let frames = 0;

  for (let i = 0; i + frameSize <= channelData.length; i += hopSize) {
    const frame = channelData.slice(i, i + frameSize);
    // Meyda.extract returns the feature directly (for 'chroma' it's an array)
    const chroma = Meyda.extract("chroma", frame, {
      bufferSize: frameSize,
      sampleRate,
    });
    if (Array.isArray(chroma) && chroma.length === 12) {
      for (let k = 0; k < 12; k++) chromaSum[k] += chroma[k];
      frames++;
    }
    if (i % (hopSize * 50) === 0)
      progressCallback(`Chroma: ${(i / channelData.length * 100).toFixed(1)}%`);
  }

  if (frames === 0) return { bpm: null, key: "Unknown" };
  const chromaAvg = chromaSum.map((v) => v / frames);
  const key = estimateKeyFromChroma(chromaAvg);

  progressCallback("Estimating BPM (Realtime Analyzer)...");
  const bpm = await estimateBPMWithRealtime(audioBuffer);

  ac.close();
  return { bpm, key };
}

/* ---- Key estimation (Krumhansl-Schmuckler) ---- */
function estimateKeyFromChroma(chroma) {
  // Profiles from Krumhansl-Schmuckler
  const majorProfile = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const minorProfile = [6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const pitchNames = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  // Normalize chroma vector
  const normChroma = normalizeVector(chroma);
  // Reduce noise: zero out values below 10% of max
  const maxVal = Math.max(...normChroma);
  const cleanedChroma = normChroma.map(v => v < maxVal * 0.1 ? 0 : v);

  let best = { name: "Unknown", score: -Infinity };
  let secondBest = { name: "Unknown", score: -Infinity };
  for (let root = 0; root < 12; root++) {
    const maj = normalizeVector(rotateArray(majorProfile, root));
    const min = normalizeVector(rotateArray(minorProfile, root));
    const majScore = dot(cleanedChroma, maj);
    const minScore = dot(cleanedChroma, min);
    if (majScore > best.score) {
      secondBest = best;
      best = { name: `${pitchNames[root]} major`, score: majScore };
    } else if (majScore > secondBest.score) {
      secondBest = { name: `${pitchNames[root]} major`, score: majScore };
    }
    if (minScore > best.score) {
      secondBest = best;
      best = { name: `${pitchNames[root]} minor`, score: minScore };
    } else if (minScore > secondBest.score) {
      secondBest = { name: `${pitchNames[root]} minor`, score: minScore };
    }
  }
  // If ambiguous, report both
  if (best.score < 0.15) return "Unknown";
  if (secondBest.score > 0.9 * best.score) return `${best.name} (possible: ${secondBest.name})`;
  return best.name;
}

/* ---- Browser-native BPM estimation using energy peaks ---- */
async function estimateBPM(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const frameSize = 1024;
  const hopSize = 512;
  const energies = [];
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      const v = channelData[i + j];
      sum += v * v;
    }
    energies.push(sum);
  }

  // Smooth energies (moving average)
  const smoothEnergies = [];
  const windowSize = 5;
  for (let i = 0; i < energies.length; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(energies.length - 1, i + windowSize); j++) {
      sum += energies[j];
    }
    smoothEnergies.push(sum / (Math.min(energies.length - 1, i + windowSize) - Math.max(0, i - windowSize) + 1));
  }

  // Autocorrelation
  const maxLag = Math.floor(sampleRate / 60); // up to 60 BPM
  const minLag = Math.floor(sampleRate / 180); // down to 180 BPM
  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < smoothEnergies.length - lag; i++) {
      corr += smoothEnergies[i] * smoothEnergies[i + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return null;
  const secondsPerBeat = (bestLag * hopSize) / sampleRate;
  let bpm = 60 / secondsPerBeat;
  // Fix half/double tempo
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/* ---- Utilities ---- */
function rotateArray(arr, n) {
  return arr.slice(n).concat(arr.slice(0, n));
}
function dot(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}
function normalizeVector(v) {
  const s = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / (s || 1));
}

/* ---- Expose to app ---- */
window.dabzAnalysis = { analyzeAudioUrl, analyzeAudioBuffer, estimateKeyFromChroma };
