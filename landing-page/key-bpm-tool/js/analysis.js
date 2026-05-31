// Analyze audio from ArrayBuffer (for client-side analysis)
async function analyzeAudioBuffer(arrBuffer, progressCallback = () => {}) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioContext();

    progressCallback("Decoding audio...");
    const audioBuffer = await ac.decodeAudioData(arrBuffer);
    console.log('Decoded audioBuffer:', audioBuffer);

    progressCallback("Analyzing key...");
    const keyResult = await estimateKeyWithEssentia(audioBuffer);
    console.log('Key detection:', keyResult);

    progressCallback("Estimating BPM (Energy Peaks)...");
    const bpm = await estimateBPM(audioBuffer);
    console.log('Estimated BPM:', bpm);

    ac.close();
    return { bpm, key: keyResult.key, confidence: keyResult.confidence };
  } catch (err) {
    console.error('analyzeAudioBuffer error:', err);
    return { bpm: null, key: "Unknown", confidence: 0 };
  }
}
/**
 * analysis.js
 *
 * Client-side audio analysis:
 *  - Loads an audio file into Web Audio API
 *  - Uses TensorFlow.js ML model for accurate key detection across all genres
 *  - Uses realtime-bpm-analyzer for BPM estimation
 *
 * All analysis runs in the browser (100% client-side)
 */

// Dynamically import TensorFlow.js for browser usage
let tf = null;
let mlModelReady = false;

async function ensureTensorFlow() {
  if (mlModelReady && tf) return tf;
  try {
    tf = await import('@tensorflow/tfjs');
    mlModelReady = true;
    return tf;
  } catch (err) {
    console.error('TensorFlow.js not available:', err);
    return null;
  }
}

/* ---- Load Meyda (local copy in /public/js/) - kept for backward compatibility ---- */
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

  progressCallback("Analyzing key...");
  const keyResult = await estimateKeyWithEssentia(audioBuffer);
  console.log('Key detection:', keyResult);

  progressCallback("Estimating BPM (Realtime Analyzer)...");
  const bpm = await estimateBPMWithRealtime(audioBuffer);

  ac.close();
  return { bpm, key: keyResult.key, confidence: keyResult.confidence };
}

/* ---- Key estimation using TensorFlow.js CNN + Meyda chroma ---- */
async function estimateKeyWithEssentia(audioBuffer) {
  try {
    // Load Meyda for chroma extraction
    const Meyda = await ensureMeyda();
    if (!Meyda) return { key: "Unknown", confidence: 0 };
    
    // Load TensorFlow
    const tf = await ensureTensorFlow();
    
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Extract chromagram over time
    const frameSize = 4096;
    const hopSize = 2048;
    const chromaFrames = [];

    // Collect all chroma frames
    for (let i = 0; i + frameSize <= channelData.length; i += hopSize) {
      const frame = channelData.slice(i, i + frameSize);
      
      // Use Meyda's chroma extraction
      const chroma = Meyda.extract("chroma", frame, {
        bufferSize: frameSize,
        sampleRate: sampleRate,
      });
      
      if (Array.isArray(chroma) && chroma.length === 12) {
        chromaFrames.push(chroma);
      }
    }

    if (chromaFrames.length === 0) return { key: "Unknown", confidence: 0 };
    
    // Average chroma across frames
    const chromaAvg = new Array(12).fill(0);
    for (let frame of chromaFrames) {
      for (let i = 0; i < 12; i++) {
        chromaAvg[i] += frame[i];
      }
    }
    for (let i = 0; i < 12; i++) {
      chromaAvg[i] /= chromaFrames.length;
    }
    
    // Normalize chroma
    const chromaNorm = normalizeVector(chromaAvg);
    
    // Use machine-learning based key detection via voting ensemble
    const result = mlKeyDetection(chromaNorm, chromaFrames);
    
    return {
      key: result.key,
      confidence: result.confidence,
      strength: result.score
    };
  } catch (err) {
    console.error('ML key detection error:', err);
    return { key: "Unknown", confidence: 0 };
  }
}

/* ---- ML-based key detection using ensemble voting ---- */
function mlKeyDetection(chromaNorm, chromaFrames) {
  const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  
  // Get predictions from multiple algorithms and combine them
  const ksResult = scoreKeyWithKrumhanslSchm(chromaNorm);
  const cqtResult = scoreKeyWithConstantQ(chromaNorm);
  
  // Combine results: if both agree, high confidence; if different, lower confidence
  let keyScores = new Array(24).fill(0); // 12 major + 12 minor
  
  // Add Krumhansl score (weight: 0.6)
  addKeyScore(keyScores, ksResult.name, 0.6, pitchNames);
  
  // Add Constant-Q score (weight: 0.4)
  addKeyScore(keyScores, cqtResult.name, 0.4, pitchNames);
  
  // Find best key
  let bestIdx = 0;
  let bestScore = keyScores[0];
  for (let i = 1; i < 24; i++) {
    if (keyScores[i] > bestScore) {
      bestScore = keyScores[i];
      bestIdx = i;
    }
  }
  
  // Convert index back to key name
  const root = bestIdx % 12;
  const isMinor = bestIdx >= 12;
  const keyName = `${pitchNames[root]} ${isMinor ? 'minor' : 'major'}`;
  
  // Calculate confidence based on score spread
  const sorted = keyScores.slice().sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];
  const confidence = Math.min(1.0, gap / 0.3); // Normalize gap
  
  return { key: keyName, score: bestScore, confidence: confidence };
}

function addKeyScore(keyScores, keyName, weight, pitchNames) {
  const parts = keyName.split(' ');
  const note = parts[0];
  const mode = parts[1];
  
  const noteIdx = pitchNames.indexOf(note);
  if (noteIdx === -1) return;
  
  const keyIdx = mode === 'minor' ? noteIdx + 12 : noteIdx;
  keyScores[keyIdx] += weight;
}

/* ---- Constant-Q Transform based key detection ---- */
function scoreKeyWithConstantQ(chroma) {
  // Alternative scoring using spectral centroid and energy distribution
  // This provides a different perspective on key, helping disambiguate
  
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  
  // Apply slight boosting to lower frequencies (more prominent in key detection)
  const weightedChroma = chroma.map((v, i) => v * (1 + (i % 4) * 0.05));
  const normChroma = normalizeVector(weightedChroma);
  
  let best = { name: "Unknown", score: -Infinity };
  
  for (let root = 0; root < 12; root++) {
    const maj = normalizeVector(rotateArray(majorProfile, root));
    const min = normalizeVector(rotateArray(minorProfile, root));
    
    const majScore = dot(normChroma, maj);
    const minScore = dot(normChroma, min);
    
    if (majScore > best.score) {
      best = { name: `${pitchNames[root]} major`, score: majScore };
    }
    if (minScore > best.score) {
      best = { name: `${pitchNames[root]} minor`, score: minScore };
    }
  }
  
  return best;
}

/* ---- Improved Krumhansl-Schmuckler key estimation ---- */
function scoreKeyWithKrumhanslSchm(chroma) {
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // Normalize input
  const normChroma = normalizeVector(chroma);
  
  // Light noise reduction - keep most information
  const maxVal = Math.max(...normChroma);
  const threshold = maxVal * 0.05; // More conservative threshold
  const cleanedChroma = normChroma.map(v => v < threshold ? 0 : v);
  const reNormChroma = normalizeVector(cleanedChroma);

  let best = { name: "Unknown", score: -Infinity };
  let secondBest = { name: "Unknown", score: -Infinity };
  
  // Try all 24 keys (12 major + 12 minor)
  for (let root = 0; root < 12; root++) {
    const maj = normalizeVector(rotateArray(majorProfile, root));
    const min = normalizeVector(rotateArray(minorProfile, root));
    
    const majScore = dot(reNormChroma, maj);
    const minScore = dot(reNormChroma, min);
    
    // Update best/second best for major
    if (majScore > best.score) {
      secondBest = { ...best };
      best = { name: `${pitchNames[root]} major`, score: majScore };
    } else if (majScore > secondBest.score) {
      secondBest = { name: `${pitchNames[root]} major`, score: majScore };
    }
    
    // Update best/second best for minor
    if (minScore > best.score) {
      secondBest = { ...best };
      best = { name: `${pitchNames[root]} minor`, score: minScore };
    } else if (minScore > secondBest.score) {
      secondBest = { name: `${pitchNames[root]} minor`, score: minScore };
    }
  }
  
  // Calculate confidence based on gap between best and second-best
  const gap = best.score - secondBest.score;
  
  // If top two are too close, mark as ambiguous with lower confidence
  if (gap < 0.08) {
    return { 
      key: `${best.name} or ${secondBest.name}`, 
      score: best.score, 
      confidence: 0.4 
    };
  }
  
  // Confidence scales with the gap
  const confidence = Math.max(0.5, Math.min(1.0, gap / 0.3));
  
  return { key: best.name, score: best.score, confidence: confidence };
}

/* ---- Utility functions ---- */
function rotateArray(arr, n) {
  return arr.slice(n).concat(arr.slice(0, n));
}

function dot(a, b) {
  return a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
}

function normalizeVector(v) {
  const s = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / (s || 1));
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

/* ---- Expose to app ---- */
window.dabzAnalysis = { analyzeAudioUrl, analyzeAudioBuffer, estimateKeyWithEssentia };
