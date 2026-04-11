/**
 * Client-side audio analysis utilities.
 * Detects BPM and musical key from an audio File using the Web Audio API.
 *
 * BPM:  energy-onset autocorrelation (accurate for 60–200 BPM steady-tempo music)
 * Key:  chroma features + Krumhansl-Schmuckler key-finding profiles
 */

export interface AudioFeatures {
  bpm: number | null;
  key: string | null;
}

// ── Krumhansl-Schmuckler profiles ─────────────────────────────────────────────
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// ── Radix-2 in-place FFT ──────────────────────────────────────────────────────
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Cooley-Tukey butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (2 * Math.PI) / len;
    const wr0 = Math.cos(ang);
    const wi0 = -Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j],          ui = im[i + j];
        const vr = re[i + j + half] * cr - im[i + j + half] * ci;
        const vi = re[i + j + half] * ci + im[i + j + half] * cr;
        re[i + j]        = ur + vr;  im[i + j]        = ui + vi;
        re[i + j + half] = ur - vr;  im[i + j + half] = ui - vi;
        const ncr = cr * wr0 - ci * wi0;
        ci = cr * wi0 + ci * wr0;
        cr = ncr;
      }
    }
  }
}

// ── Pearson correlation ────────────────────────────────────────────────────────
function pearsonR(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// ── BPM detection ─────────────────────────────────────────────────────────────
function detectBpm(buf: AudioBuffer): number | null {
  const sr  = buf.sampleRate;
  const hop = 512;
  // Analyse up to the first 60 s
  const maxLen = Math.min(buf.length, sr * 60);
  const mono   = buf.getChannelData(0);

  // RMS energy per hop window
  const energies: number[] = [];
  for (let i = 0; i + hop < maxLen; i += hop) {
    let e = 0;
    for (let j = 0; j < hop; j++) e += mono[i + j] ** 2;
    energies.push(Math.sqrt(e / hop));
  }

  // Half-wave-rectified first-order difference → onset strength
  const onset: number[] = [0];
  for (let i = 1; i < energies.length; i++) {
    onset.push(Math.max(0, energies[i] - energies[i - 1]));
  }

  // Autocorrelation over the BPM range 60–200
  const fps    = sr / hop;
  const lagMin = Math.max(1, Math.floor(fps * 60 / 200));
  const lagMax = Math.ceil(fps * 60 / 60);

  let bestLag = -1, bestCorr = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let corr = 0;
    for (let i = 0; i + lag < onset.length; i++) corr += onset[i] * onset[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }

  if (bestLag <= 0) return null;

  let bpm = fps * 60 / bestLag;

  // Resolve half/double-tempo ambiguity — target the 80-160 range
  if (bpm < 80  && bpm * 2 <= 200) bpm *= 2;
  if (bpm > 160 && bpm / 2 >= 60)  bpm /= 2;

  bpm = Math.round(bpm);
  return bpm >= 60 && bpm <= 200 ? bpm : null;
}

// ── Key detection ─────────────────────────────────────────────────────────────
function detectKey(buf: AudioBuffer): string | null {
  const sr      = buf.sampleRate;
  const fftSize = 4096;
  const hop     = fftSize >> 1;

  // Analyse up to 90 s from the middle of the track
  const maxLen     = Math.min(buf.length, sr * 90);
  const startSamp  = Math.max(0, Math.floor((buf.length - maxLen) / 2));
  const mono       = buf.getChannelData(0);

  // Pre-compute which pitch class (0-11) each FFT bin maps to
  const binToPc = new Int8Array(fftSize >> 1).fill(-1);
  for (let k = 1; k < fftSize >> 1; k++) {
    const hz = k * sr / fftSize;
    if (hz < 55 || hz > 2093) continue;            // A1 → C7
    const midi = 12 * Math.log2(hz / 440) + 69;
    binToPc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  // Pre-compute Hann window
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re     = new Float32Array(fftSize);
  const im     = new Float32Array(fftSize);
  const chroma = new Float32Array(12);

  for (let off = startSamp; off + fftSize < startSamp + maxLen; off += hop) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = mono[off + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < fftSize >> 1; k++) {
      const pc = binToPc[k];
      if (pc < 0) continue;
      chroma[pc] += Math.sqrt(re[k] ** 2 + im[k] ** 2);
    }
  }

  // Normalise chroma
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum === 0) return null;
  const norm = Array.from(chroma).map(v => v / sum);

  // Correlate with KS profiles for all 12 transpositions
  let bestScore = -Infinity, bestKey = '';
  for (let root = 0; root < 12; root++) {
    const rot = [...norm.slice(root), ...norm.slice(0, root)];
    const maj = pearsonR(rot, KS_MAJOR);
    const min = pearsonR(rot, KS_MINOR);
    if (maj > bestScore) { bestScore = maj; bestKey = `${KEY_NAMES[root]} major`; }
    if (min > bestScore) { bestScore = min; bestKey = `${KEY_NAMES[root]} minor`; }
  }

  return bestKey || null;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Decode an audio File in the browser and return detected BPM and key.
 * Returns null for each value if detection fails or the file is not audio.
 */
export async function analyzeAudioFile(file: File): Promise<AudioFeatures> {
  if (!file.type.startsWith('audio/')) return { bpm: null, key: null };
  try {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } finally {
      await ctx.close();
    }
    return {
      bpm: detectBpm(audioBuffer),
      key: detectKey(audioBuffer),
    };
  } catch {
    return { bpm: null, key: null };
  }
}
