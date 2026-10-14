/**
 * Deterministic local audio analysis — pure TS, runs in the analysis worker and tests.
 * These are honest approximations: good enough to place slice markers and guess a
 * loop's tempo, clearly labeled as estimates in the UI.
 */
import { mulberry32 } from "./dsp";

/** Min/max peak pairs for waveform drawing. */
export function computePeaks(data: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const per = data.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let mn = 0, mx = 0;
    const start = Math.floor(b * per);
    const end = Math.min(data.length, Math.ceil((b + 1) * per));
    for (let i = start; i < end; i++) {
      const v = data[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[b * 2] = mn;
    out[b * 2 + 1] = mx;
  }
  return out;
}

/** Onset/transient detection via spectral-flux-style energy rise on a smoothed envelope. */
export function detectTransients(data: Float32Array, sampleRate: number, sensitivity = 1.5): number[] {
  const hop = 256;
  const frames = Math.floor(data.length / hop);
  if (frames < 4) return [];
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += data[i]! * data[i]!;
    energy[f] = Math.sqrt(e / hop);
  }
  // moving average baseline
  const win = 20;
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let f = 2; f < frames; f++) {
    let avg = 0;
    const s = Math.max(0, f - win);
    for (let k = s; k < f; k++) avg += energy[k]!;
    avg /= f - s || 1;
    const rise = energy[f]! - energy[f - 1]!;
    if (energy[f]! > avg * sensitivity && rise > avg * 0.3 && f * hop - lastOnset > sampleRate * 0.05) {
      onsets.push(f * hop);
      lastOnset = f * hop;
    }
  }
  return onsets;
}

/** Regions quieter than threshold dB for at least minLenSec. Returns [start,end] sample pairs. */
export function detectSilence(data: Float32Array, sampleRate: number, thresholdDb = -45, minLenSec = 0.2): Array<[number, number]> {
  const thr = Math.pow(10, thresholdDb / 20);
  const hop = 512;
  const out: Array<[number, number]> = [];
  let silentStart = -1;
  for (let i = 0; i < data.length; i += hop) {
    let peak = 0;
    for (let k = i; k < Math.min(data.length, i + hop); k++) peak = Math.max(peak, Math.abs(data[k]!));
    const silent = peak < thr;
    if (silent && silentStart < 0) silentStart = i;
    if (!silent && silentStart >= 0) {
      if ((i - silentStart) / sampleRate >= minLenSec) out.push([silentStart, i]);
      silentStart = -1;
    }
  }
  if (silentStart >= 0 && (data.length - silentStart) / sampleRate >= minLenSec) out.push([silentStart, data.length]);
  return out;
}

/** BPM estimate via onset autocorrelation. Returns null when confidence is poor. */
export function estimateBpm(data: Float32Array, sampleRate: number): number | null {
  const hop = 512;
  const frames = Math.floor(data.length / hop);
  if (frames < 64) return null;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += Math.abs(data[i]!);
    env[f] = e / hop;
  }
  // differentiate + rectify
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, env[f]! - env[f - 1]!);
  const frameRate = sampleRate / hop;
  const minBpm = 60, maxBpm = 190;
  const minLag = Math.floor((60 / maxBpm) * frameRate);
  const maxLag = Math.ceil((60 / minBpm) * frameRate);
  let bestLag = 0, bestScore = 0, total = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, frames - 1); lag++) {
    let score = 0;
    for (let f = 0; f < frames - lag; f++) score += flux[f]! * flux[f + lag]!;
    total += score;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore < (total / (maxLag - minLag + 1)) * 1.15) return null;
  let bpm = (60 * frameRate) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Rough key estimate via chroma correlation (Krumhansl profiles). Labeled approximate. */
export function estimateKey(data: Float32Array, sampleRate: number): string | null {
  const N = 4096;
  if (data.length < N * 4) return null;
  const chroma = new Float32Array(12);
  const hops = Math.min(32, Math.floor(data.length / N));
  // Goertzel per semitone across 3 octaves — cheap and dependency-free
  for (let h = 0; h < hops; h++) {
    const off = Math.floor((h * (data.length - N)) / hops);
    for (let midi = 48; midi < 84; midi++) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const w = (2 * Math.PI * freq) / sampleRate;
      const coeff = 2 * Math.cos(w);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) {
        s0 = data[off + i]! + coeff * s1 - s2;
        s2 = s1; s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      chroma[midi % 12]! += power;
    }
  }
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let best = { score: -Infinity, name: "" };
  for (let root = 0; root < 12; root++) {
    let ms = 0, ns = 0;
    for (let i = 0; i < 12; i++) {
      ms += chroma[(root + i) % 12]! * major[i]!;
      ns += chroma[(root + i) % 12]! * minor[i]!;
    }
    if (ms > best.score) best = { score: ms, name: `${NOTE_NAMES[root]} major` };
    if (ns > best.score) best = { score: ns, name: `${NOTE_NAMES[root]} minor` };
  }
  return best.name || null;
}

export function normalizeBuffer(data: Float32Array, targetPeak = 0.98): Float32Array {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  const out = new Float32Array(data.length);
  const g = peak > 0 ? targetPeak / peak : 1;
  for (let i = 0; i < data.length; i++) out[i] = data[i]! * g;
  return out;
}

/** Nearest zero crossing to `index` within ±window samples. */
export function nearestZeroCrossing(data: Float32Array, index: number, window = 2000): number {
  const start = Math.max(1, index - window);
  const end = Math.min(data.length - 1, index + window);
  let best = index, bestDist = Infinity;
  for (let i = start; i < end; i++) {
    if ((data[i - 1]! <= 0 && data[i]! > 0) || (data[i - 1]! >= 0 && data[i]! < 0)) {
      const d = Math.abs(i - index);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  return best;
}

/** True if the buffer contains audible content (peak above -50dBFS). */
export function isNonSilent(data: Float32Array): boolean {
  const thr = Math.pow(10, -50 / 20);
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]!) > thr) return true;
  return false;
}

/** EXPERIMENTAL: monophonic melody extraction (hum/sing → notes).
 * Autocorrelation f0 per frame (80–800 Hz), RMS-gated, merged into note segments.
 * Returns notes in seconds; caller maps to ticks at the project BPM. */
export interface ExtractedNote { midi: number; startSec: number; durSec: number; velocity: number }

/** Shared per-frame f0 tracker (autocorrelation 80–800 Hz, RMS-gated, octave-error guard).
 * midiFloat is the unrounded pitch; null = unvoiced/silent frame. */
export function trackF0Frames(data: Float32Array, sampleRate: number, frame = 2048, hop = 512): Array<{ midiFloat: number | null; rms: number }> {
  const minLag = Math.floor(sampleRate / 800), maxLag = Math.floor(sampleRate / 80);
  const frames: Array<{ midiFloat: number | null; rms: number }> = [];

  for (let start = 0; start + frame <= data.length; start += hop) {
    let rms = 0;
    for (let i = 0; i < frame; i++) rms += data[start + i]! * data[start + i]!;
    rms = Math.sqrt(rms / frame);
    if (rms < 0.02) { frames.push({ midiFloat: null, rms }); continue; }

    // normalized autocorrelation over the lag range
    const corrs = new Float32Array(maxLag + 1);
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0, norm = 0;
      for (let i = 0; i < frame - lag; i += 2) { // stride 2: half the work, plenty of signal
        corr += data[start + i]! * data[start + i + lag]!;
        norm += data[start + i]! * data[start + i]!;
      }
      corrs[lag] = norm > 0 ? corr / norm : 0;
      if (corrs[lag]! > bestCorr) bestCorr = corrs[lag]!;
    }
    if (bestCorr < 0.5) { frames.push({ midiFloat: null, rms }); continue; }
    // octave-error guard: take the SMALLEST lag within 90% of the peak (true fundamental),
    // requiring a local maximum so we don't grab a rising shoulder
    let bestLag = -1;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (corrs[lag]! >= bestCorr * 0.9 && corrs[lag]! >= corrs[lag - 1]! && corrs[lag]! >= corrs[lag + 1]!) { bestLag = lag; break; }
    }
    if (bestLag < 0) { frames.push({ midiFloat: null, rms }); continue; }
    const f0 = sampleRate / bestLag;
    frames.push({ midiFloat: 69 + 12 * Math.log2(f0 / 440), rms });
  }
  return frames;
}

export function extractMelody(data: Float32Array, sampleRate: number): ExtractedNote[] {
  const hop = 512;
  const frames = trackF0Frames(data, sampleRate, 2048, hop)
    .map((f) => ({ midi: f.midiFloat === null ? null : Math.round(f.midiFloat), rms: f.rms }));

  // merge consecutive frames of the same midi into notes; drop blips < 3 frames (~32ms)
  const notes: ExtractedNote[] = [];
  const frameSec = hop / sampleRate;
  let cur: { midi: number; startFrame: number; count: number; rmsMax: number } | null = null;
  const flush = (endFrame: number) => {
    if (cur && cur.count >= 3) {
      notes.push({
        midi: cur.midi,
        startSec: cur.startFrame * frameSec,
        durSec: (endFrame - cur.startFrame) * frameSec,
        velocity: Math.min(1, cur.rmsMax * 4),
      });
    }
    cur = null;
  };
  frames.forEach((f, i) => {
    if (f.midi === null) { flush(i); return; }
    if (cur && Math.abs(f.midi - cur.midi) <= 0) { cur.count++; cur.rmsMax = Math.max(cur.rmsMax, f.rms); }
    else { flush(i); cur = { midi: f.midi, startFrame: i, count: 1, rmsMax: f.rms }; }
  });
  flush(frames.length);
  return notes;
}

/** EXPERIMENTAL pitch correction ("PulseTune"). Not professional Auto-Tune — an honest
 * granular retuner: per-frame f0 → snap to nearest scale note → smoothed correction
 * ratio → time-preserving granular resample (Hann, 50% OLA). Formants shift with pitch.
 */
export interface PitchCorrectOptions {
  /** root pitch class 0-11 (C=0) */
  rootPc: number;
  /** allowed pitch classes relative to root, e.g. major [0,2,4,5,7,9,11] */
  scale: number[];
  /** 0..1 — how far toward the target each frame is pulled */
  strength: number;
  /** retune smoothing in ms; 0 = instant hard-tune */
  retuneMs: number;
  /** 0..1 — adds slow pitch drift back in so it sounds less robotic */
  humanize: number;
  /** random seed for humanize drift */
  seed?: number;
}

export function pitchCorrect(data: Float32Array, sampleRate: number, opts: PitchCorrectOptions): Float32Array {
  const hop = 512, frame = 2048;
  const frames = trackF0Frames(data, sampleRate, frame, hop);
  if (!frames.length) return data.slice();

  // nearest allowed midi note for a float pitch
  const allowed = new Set(opts.scale.map((s) => ((s % 12) + 12) % 12));
  const snap = (midiFloat: number): number => {
    let best = Math.round(midiFloat), bestDist = Infinity;
    for (let m = Math.round(midiFloat) - 6; m <= Math.round(midiFloat) + 6; m++) {
      if (!allowed.has((((m - opts.rootPc) % 12) + 12) % 12)) continue;
      const d = Math.abs(m - midiFloat);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    return best;
  };

  // per-frame target correction in semitones, smoothed by retune speed
  const rng = mulberry32(opts.seed ?? 777);
  const frameSec = hop / sampleRate;
  const alpha = opts.retuneMs <= 0 ? 1 : Math.min(1, frameSec / (opts.retuneMs / 1000));
  let smoothed = 0;
  let drift = 0;
  const semis: number[] = frames.map((f) => {
    let target = 0;
    if (f.midiFloat !== null) target = (snap(f.midiFloat) - f.midiFloat) * opts.strength;
    smoothed += alpha * (target - smoothed);
    // humanize: slow random-walk drift, ±~35 cents at humanize=1
    drift = drift * 0.98 + (rng() - 0.5) * 0.02;
    return smoothed + drift * 35 * opts.humanize * 0.01 * 12;
  });

  // synthesis: variable-rate read pointer (pitch shift), with time drift bounded by
  // period-synchronous re-anchoring — jumps of a whole number of periods are phase-
  // continuous for voiced audio, and each jump is crossfaded. (Naive time-aligned
  // granular OLA cancels its own repitch at high overlap — verified empirically.)
  const out = new Float32Array(data.length);
  const XFADE = 64;
  const maxDriftSec = 0.02; // keep output within 20ms of input timing
  const maxDrift = maxDriftSec * sampleRate;
  let p = 0; // input read pointer (float)

  const readAt = (pos: number): number => {
    const s0 = Math.floor(pos);
    if (s0 < 0 || s0 + 1 >= data.length) return 0;
    const frac = pos - s0;
    return data[s0]! * (1 - frac) + data[s0 + 1]! * frac;
  };

  for (let i = 0; i < out.length; i++) {
    const k = Math.min(frames.length - 1, Math.floor(i / hop));
    const ratio = Math.pow(2, semis[k]! / 12);
    const midiFloat = frames[k]!.midiFloat;
    out[i] = readAt(p);
    p += ratio;

    const drift = p - i;
    if (Math.abs(drift) > maxDrift) {
      // jump back/forward by whole periods when voiced (phase-preserving), raw when not
      const periodSamples = midiFloat !== null ? sampleRate / (440 * Math.pow(2, (midiFloat - 69) / 12)) : Math.abs(drift);
      const jump = Math.max(1, Math.round(Math.abs(drift) / periodSamples)) * periodSamples * Math.sign(drift);
      const pNew = p - jump;
      // short equal-power crossfade from old position to new position
      for (let x = 0; x < XFADE && i + 1 + x < out.length; x++) {
        const t = (x + 1) / XFADE;
        out[i + 1 + x] = readAt(p + (x + 1) * ratio) * Math.cos((t * Math.PI) / 2) + readAt(pNew + (x + 1) * ratio) * Math.sin((t * Math.PI) / 2);
      }
      i += Math.min(XFADE, out.length - i - 1);
      p = pNew + XFADE * ratio + ratio;
    }
  }
  return out;
}
