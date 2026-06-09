// Analyze audio from ArrayBuffer (for client-side analysis)
async function analyzeAudioBuffer(arrBuffer, progressCallback = () => {}, fileName = null) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioContext();

    const keyBuffer = arrBuffer.slice(0);

    progressCallback("Decoding audio...");
    const audioBuffer = await ac.decodeAudioData(arrBuffer);
    console.log('Decoded audioBuffer:', audioBuffer);

    progressCallback("Analyzing key...");
    let keyResult;
    if (fileName) {
      keyResult = await estimateKeyWithOpenKeyScan(keyBuffer, fileName, progressCallback);
      // If OpenKeyScan returns "Unknown", fall back to Essentia
      if (keyResult.key === "Unknown" || keyResult.confidence === 0) {
        console.log('OpenKeyScan failed or returned unknown, falling back to Essentia...');
        keyResult = await estimateKeyWithEssentia(audioBuffer);
      }
    } else {
      keyResult = await estimateKeyWithEssentia(audioBuffer);
    }
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

// Load TensorFlow.js from CDN for browser usage
let tf = null;
let mlModelReady = false;

async function ensureTensorFlow() {
  if (mlModelReady && typeof window.tf !== 'undefined') return window.tf;
  try {
    // Load TensorFlow.js from CDN
    if (typeof window.tf === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    mlModelReady = true;
    return window.tf;
  } catch (err) {
    console.error('TensorFlow.js not available:', err);
    return null;
  }
}

/* ---- Load Meyda (local copy in /public/js/) - kept for backward compatibility ---- */
async function ensureMeyda() {
  if (window.Meyda) return window.Meyda;

  const localSrc = "js/meyda.min.js";
  const cdnSrc = "https://cdn.jsdelivr.net/npm/meyda@5.4.0/dist/web/meyda.min.js";

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load Meyda from ${src}`));
      document.head.appendChild(s);
    });

  Array.from(document.querySelectorAll('script')).forEach(s => {
    if (s.src && s.src.includes('meyda')) s.remove();
  });

  try {
    await loadScript(localSrc);
    return window.Meyda;
  } catch (err) {
    console.warn('Local Meyda failed, falling back to CDN:', err);
  }

  try {
    await loadScript(cdnSrc);
    return window.Meyda;
  } catch (err) {
    console.error('Meyda not available from CDN either:', err);
    return null;
  }
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

    // Load TensorFlow (not required for Meyda extraction, but kept for compatibility)
    await ensureTensorFlow();

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    let frameSize = 4096;
    while (frameSize > channelData.length && frameSize > 256) {
      frameSize = frameSize >> 1;
    }
    frameSize = Math.max(256, frameSize);
    const hopSize = Math.max(128, frameSize >> 1);
    const chromaFrames = [];
    const frameEnergies = [];

    for (let i = 0; i + frameSize <= channelData.length; i += hopSize) {
      const frame = channelData.slice(i, i + frameSize);
      try {
        const chroma = Meyda.extract("chroma", frame, {
          bufferSize: frameSize,
          sampleRate: sampleRate,
        });
        if (Array.isArray(chroma) && chroma.length === 12) {
          chromaFrames.push(chroma);
          frameEnergies.push(frame.reduce((sum, sample) => sum + sample * sample, 0));
        }
      } catch (err) {
        console.warn('Meyda chroma extraction failed for a frame:', err);
      }
    }

    if (chromaFrames.length === 0 && channelData.length > 0) {
      const paddedFrame = new Float32Array(frameSize);
      paddedFrame.set(channelData.subarray(0, Math.min(channelData.length, frameSize)));
      try {
        const chroma = Meyda.extract("chroma", paddedFrame, {
          bufferSize: frameSize,
          sampleRate: sampleRate,
        });
        if (Array.isArray(chroma) && chroma.length === 12) {
          chromaFrames.push(chroma);
          frameEnergies.push(paddedFrame.reduce((sum, sample) => sum + sample * sample, 0));
        }
      } catch (err) {
        console.warn('Fallback Meyda chroma extraction failed:', err);
      }
    }

    if (chromaFrames.length === 0) {
      console.warn('No chroma frames extracted; returning unknown key.');
      return { key: "Unknown", confidence: 0 };
    }

    const result = mlKeyDetection(chromaFrames, frameEnergies);

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
function mlKeyDetection(chromaFrames, frameEnergies = []) {
  const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  if (chromaFrames.length === 0) {
    return { key: "Unknown", score: 0, confidence: 0 };
  }

  const keyScores = new Array(24).fill(0);
  let totalWeight = 0;

  for (let idx = 0; idx < chromaFrames.length; idx++) {
    const frame = chromaFrames[idx];
    const energy = frameEnergies[idx] || 1;
    const weight = Math.log1p(Math.max(energy, 0));
    totalWeight += weight;
    
    // Normalize chroma to emphasize peaks and reduce noise
    const frameNorm = normalizeVector(frame);
    
    // Apply soft thresholding to reduce low-energy chroma bins
    const maxChroma = Math.max(...frameNorm);
    const threshold = maxChroma * 0.15;
    const thresholdedFrame = frameNorm.map(v => Math.max(0, v - threshold));
    const cleanedFrame = normalizeVector(thresholdedFrame.some(v => v > 0) ? thresholdedFrame : frameNorm);

    for (let root = 0; root < 12; root++) {
      const majProfile = normalizeVector(rotateArray(majorProfile, root));
      const minProfile = normalizeVector(rotateArray(minorProfile, root));
      const majScore = pearsonCorrelation(cleanedFrame, majProfile);
      const minScore = pearsonCorrelation(cleanedFrame, minProfile);
      keyScores[root] += majScore * weight;
      keyScores[root + 12] += minScore * weight;
    }
  }

  if (totalWeight === 0) totalWeight = chromaFrames.length || 1;
  const normalizedScores = keyScores.map(score => score / totalWeight);

  let bestIdx = 0;
  let bestScore = normalizedScores[0];
  for (let i = 1; i < 24; i++) {
    if (normalizedScores[i] > bestScore) {
      bestScore = normalizedScores[i];
      bestIdx = i;
    }
  }

  const root = bestIdx % 12;
  const isMinor = bestIdx >= 12;
  const keyName = `${pitchNames[root]} ${isMinor ? 'minor' : 'major'}`;

  const scoredKeys = normalizedScores.map((score, i) => {
    const root = i % 12;
    const isMinor = i >= 12;
    return { key: `${pitchNames[root]} ${isMinor ? 'minor' : 'major'}`, score };
  }).sort((a, b) => b.score - a.score);

  const sorted = scoredKeys.map(item => item.score);
  const gap = sorted[0] - sorted[1];
  const confidence = Math.min(1.0, Math.max(0, gap / 0.3));

  console.log('Key candidate scores:', scoredKeys.slice(0, 6));
  return { key: keyName, score: bestScore, confidence: confidence };
}

function addKeyScore(keyScores, result, weight, pitchNames) {
  if (!result || typeof result.key !== 'string' || result.key.trim() === '') return;
  const parts = result.key.split(' ');
  if (parts.length < 2) return;

  const note = parts[0];
  const mode = parts[1];
  
  const noteIdx = pitchNames.indexOf(note);
  if (noteIdx === -1) return;
  
  const keyIdx = mode === 'minor' ? noteIdx + 12 : noteIdx;
  const normalizedScore = typeof result.score === 'number' ? result.score : 0;
  keyScores[keyIdx] += normalizedScore * weight;
}

/* ---- Constant-Q Transform based key detection ---- */
function scoreKeyWithConstantQ(chroma) {
  // Alternative scoring using a slightly reweighted chroma profile
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  
  const weightedChroma = chroma.map((v, i) => v * (1 + (i % 4) * 0.05));
  const normChroma = normalizeVector(weightedChroma);
  
  let best = { key: "Unknown", score: -Infinity };
  
  for (let root = 0; root < 12; root++) {
    const maj = normalizeVector(rotateArray(majorProfile, root));
    const min = normalizeVector(rotateArray(minorProfile, root));
    
    const majScore = pearsonCorrelation(normChroma, maj);
    const minScore = pearsonCorrelation(normChroma, min);
    
    if (majScore > best.score) {
      best = { key: `${pitchNames[root]} major`, score: majScore };
    }
    if (minScore > best.score) {
      best = { key: `${pitchNames[root]} minor`, score: minScore };
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

  let best = { key: "Unknown", score: -Infinity };
  let secondBest = { key: "Unknown", score: -Infinity };
  
  // Try all 24 keys (12 major + 12 minor)
  for (let root = 0; root < 12; root++) {
    const maj = normalizeVector(rotateArray(majorProfile, root));
    const min = normalizeVector(rotateArray(minorProfile, root));
    
    const majScore = pearsonCorrelation(reNormChroma, maj);
    const minScore = pearsonCorrelation(reNormChroma, min);
    
    // Update best/second best for major
    if (majScore > best.score) {
      secondBest = { ...best };
      best = { key: `${pitchNames[root]} major`, score: majScore };
    } else if (majScore > secondBest.score) {
      secondBest = { key: `${pitchNames[root]} major`, score: majScore };
    }
    
    // Update best/second best for minor
    if (minScore > best.score) {
      secondBest = { ...best };
      best = { key: `${pitchNames[root]} minor`, score: minScore };
    } else if (minScore > secondBest.score) {
      secondBest = { key: `${pitchNames[root]} minor`, score: minScore };
    }
  }
  
  // Calculate confidence based on gap between best and second-best
  const gap = best.score - secondBest.score;
  
  // If top two are too close, mark as ambiguous with lower confidence
  if (gap < 0.08) {
    return { 
      key: `${best.key} or ${secondBest.key}`, 
      score: best.score, 
      confidence: 0.4 
    };
  }
  
  // Confidence scales with the gap
  const confidence = Math.max(0.5, Math.min(1.0, gap / 0.3));
  
  return { key: best.key, score: best.score, confidence: confidence };
}

/* ---- Utility functions ---- */
function rotateArray(arr, n) {
  return arr.slice(n).concat(arr.slice(0, n));
}

function pearsonCorrelation(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  const n = a.length;
  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;
  let num = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }
  const den = Math.sqrt(sumSqA * sumSqB);
  return den === 0 ? 0 : num / den;
}

function dot(a, b) {
  return a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
}

function normalizeVector(v) {
  const s = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / (s || 1));
}

function getWaveFileName(fileName = 'audio') {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_ ]/g, '_');
  return `${cleanName || 'audio'}.wav`;
}

async function convertArrayBufferToWavBlob(arrBuffer, fileName = 'audio') {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ac = new AudioContext();
  const audioBuffer = await ac.decodeAudioData(arrBuffer.slice(0));
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  const interleaved = new Float32Array(numSamples * numChannels);
  if (numChannels === 1) {
    interleaved.set(audioBuffer.getChannelData(0));
  } else {
    const channelData = [];
    for (let c = 0; c < numChannels; c++) {
      channelData.push(audioBuffer.getChannelData(c));
    }
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        interleaved[i * numChannels + c] = channelData[c][i];
      }
    }
  }

  floatTo16BitPCM(view, 44, interleaved);
  ac.close();
  return new Blob([buffer], { type: 'audio/wav' });
}

function convertFlatToSharp(note) {
  const map = {
    'Cb': 'B',
    'Db': 'C#',
    'Eb': 'D#',
    'Fb': 'E',
    'Gb': 'F#',
    'Ab': 'G#',
    'Bb': 'A#',
  };
  return map[note] || note;
}

function normalizeKeyName(key) {
  const cleaned = key
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/(?:\bmaj\b|\bmajor\b)/gi, 'major')
    .replace(/(?:\bmin\b|\bminor\b)/gi, 'minor')
    .replace(/\s+/g, ' ');

  const match = cleaned.match(/^([A-G])([#b]?)(?:\s+(major|minor))$/i);
  if (!match) return cleaned;

  const root = convertFlatToSharp(match[1].toUpperCase() + (match[2] || ''));
  return `${root} ${match[3].toLowerCase()}`;
}

function normalizeKeyAbbrev(key) {
  const cleaned = key
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/\s+/g, '');

  const match = cleaned.match(/^([A-Ga-g])([#b]?)(maj|major|min|minor|m)$/i);
  if (!match) return cleaned;

  const root = convertFlatToSharp(match[1].toUpperCase() + (match[2] || ''));
  const mode = /^m/i.test(match[3]) ? 'min' : 'maj';
  return `${root}${mode}`;
}

function formatOpenKeyNotation(key) {
  if (!key || typeof key !== 'string') return key;
  const normalized = key.trim();
  const code = normalized.replace(/\s+/g, '').toLowerCase();

  const codeMap = {
    '1m': 'A♭ minor',
    '2m': 'E♭ minor',
    '3m': 'B♭ minor',
    '4m': 'F minor',
    '5m': 'C minor',
    '6m': 'G minor',
    '7m': 'D minor',
    '8m': 'A minor',
    '9m': 'E minor',
    '10m': 'B minor',
    '11m': 'F♯ minor',
    '12m': 'C♯ minor',
    '1d': 'B major',
    '2d': 'F♯ major',
    '3d': 'D♭ major',
    '4d': 'A♭ major',
    '5d': 'E♭ major',
    '6d': 'B♭ major',
    '7d': 'F major',
    '8d': 'C major',
    '9d': 'G major',
    '10d': 'D major',
    '11d': 'A major',
    '12d': 'E major',
    '1a': 'A♭ minor',
    '2a': 'E♭ minor',
    '3a': 'B♭ minor',
    '4a': 'F minor',
    '5a': 'C minor',
    '6a': 'G minor',
    '7a': 'D minor',
    '8a': 'A minor',
    '9a': 'E minor',
    '10a': 'B minor',
    '11a': 'F♯ minor',
    '12a': 'C♯ minor',
    '1b': 'B major',
    '2b': 'F♯ major',
    '3b': 'D♭ major',
    '4b': 'A♭ major',
    '5b': 'E♭ major',
    '6b': 'B♭ major',
    '7b': 'F major',
    '8b': 'C major',
    '9b': 'G major',
    '10b': 'D major',
    '11b': 'A major',
    '12b': 'E major',
  };

  const translated = codeMap[code];
  if (translated) {
    return normalizeKeyAbbrev(translated);
  }

  if (/(?:^|\s)[A-G](?:#|b|♯|♭)?\s+(?:major|minor)(?:\s|$)/i.test(normalized)) {
    return normalizeKeyAbbrev(normalized);
  }

  const abbrev = normalizeKeyAbbrev(normalized);
  return abbrev || normalized;
}

async function estimateKeyWithOpenKeyScan(arrBuffer, fileName, progressCallback = () => {}) {
  try {
    progressCallback('loading...');
    const wavFileName = getWaveFileName(fileName || 'audio');
    const wavBlob = await convertArrayBufferToWavBlob(arrBuffer, wavFileName);

    progressCallback('loading...');
    const formData = new FormData();
    // OpenKeyScan's /analyze/single expects a multipart field named "file".
    formData.append('file', wavBlob, wavFileName);

    const response = await fetch('/api/key/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenKeyScan backend error: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    // OpenKeyScan returns { status: 'success', key, camelot, ... }. Older/proxied
    // responses may use { success: true, key }. Treat any of these as success.
    const succeeded = data.status === 'success' || data.success === true || Boolean(data.key || data.result);
    if (!succeeded) {
      throw new Error(data.message || data.detail || 'OpenKeyScan analysis failed');
    }

    const formattedKey = formatOpenKeyNotation(data.key || data.result || 'Unknown');
    return {
      key: formattedKey || 'Unknown',
      confidence: typeof data.confidence === 'number' ? data.confidence : 1,
    };
  } catch (err) {
    console.error('OpenKeyScan key detection error:', err);
    return { key: 'Unknown', confidence: 0 };
  }
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
