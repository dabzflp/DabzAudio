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
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/meyda.min.js"; // served locally
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
  const majorProfile = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const minorProfile = [6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

  const normChroma = normalizeVector(chroma);
  let best = { name: "Unknown", score: -Infinity };
  const pitchNames = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  for (let root = 0; root < 12; root++) {
    const maj = normalizeVector(rotateArray(majorProfile, root));
    const min = normalizeVector(rotateArray(minorProfile, root));
    const majScore = dot(normChroma, maj);
    const minScore = dot(normChroma, min);

    if (majScore > best.score) best = { name: `${pitchNames[root]} major`, score: majScore };
    if (minScore > best.score) best = { name: `${pitchNames[root]} minor`, score: minScore };
  }
  return best.score < 0.15 ? "Unknown" : best.name;
}

/* ---- New BPM estimation using realtime-bpm-analyzer ---- */
async function estimateBPMWithRealtime(audioBuffer) {
  try {
    const mod = await import("realtime-bpm-analyzer");
    // prefer analyzeFullBuffer if exported
    if (typeof mod.analyzeFullBuffer === "function") {
      const res = await mod.analyzeFullBuffer(audioBuffer);
      if (Array.isArray(res) && res.length) return Math.round(res[0].tempo);
      return null;
    }
    // fallback to default class API
    const RealtimeBpmAnalyzer = mod.default;
    if (typeof RealtimeBpmAnalyzer === "function") {
      const analyzer = new RealtimeBpmAnalyzer({ scriptNodeBufferSize: 4096, pushTime: 500, calculateByFft: true });
      const channelData = audioBuffer.getChannelData(0);
      const bufferSize = 4096;
      for (let i = 0; i < channelData.length; i += bufferSize) {
        analyzer.input(channelData.slice(i, i + bufferSize));
      }
      const results = typeof analyzer.getBpm === "function" ? analyzer.getBpm() : null;
      if (Array.isArray(results) && results.length) return Math.round(results[0].tempo);
    }
  } catch (e) {
    console.warn("BPM estimate failed:", e);
  }
  return null;
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
window.dabzAnalysis = { analyzeAudioUrl, estimateKeyFromChroma };
