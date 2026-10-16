/**
 * Visualizer signal analysis: pure functions over analyser data, so they run (and are tested)
 * without an AudioContext. Spectrum inputs are dB values as returned by
 * AnalyserNode.getFloatFrequencyData().
 */

export interface Bands { sub: number; bass: number; lowMid: number; mid: number; highMid: number; air: number }
export const BAND_NAMES: (keyof Bands)[] = ["sub", "bass", "lowMid", "mid", "highMid", "air"];
/** band edges in Hz: sub 20–60, bass 60–250, low-mid 250–500, mid 500–2k, high-mid 2k–6k, air 6k–20k */
export const BAND_EDGES = [20, 60, 250, 500, 2000, 6000, 20000];

export const MIN_DB = -96;
export const MAX_DB = -18;

/** dB → 0..1 on the visualizer's display range */
export function normDb(db: number, min = MIN_DB, max = MAX_DB): number {
  if (!Number.isFinite(db)) return 0;
  const v = (db - min) / (max - min);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function binOf(freq: number, sampleRate: number, fftSize: number, nBins: number): number {
  const b = Math.round((freq / (sampleRate / 2)) * nBins);
  return b < 0 ? 0 : b >= nBins ? nBins - 1 : b;
}

/** Mean normalized energy per band. Bands above Nyquist read as 0. */
export function bandEnergies(spectrumDb: Float32Array, sampleRate: number, fftSize: number): Bands {
  const n = spectrumDb.length;
  const out = [0, 0, 0, 0, 0, 0];
  for (let b = 0; b < 6; b++) {
    const lo = BAND_EDGES[b]!, hi = BAND_EDGES[b + 1]!;
    if (lo >= sampleRate / 2) continue;
    const i0 = binOf(lo, sampleRate, fftSize, n);
    const i1 = Math.max(i0, binOf(Math.min(hi, sampleRate / 2), sampleRate, fftSize, n));
    let s = 0;
    for (let i = i0; i <= i1; i++) s += normDb(spectrumDb[i]!);
    out[b] = s / (i1 - i0 + 1);
  }
  return { sub: out[0]!, bass: out[1]!, lowMid: out[2]!, mid: out[3]!, highMid: out[4]!, air: out[5]! };
}

/**
 * Resample a linear-frequency dB spectrum onto `out.length` log-spaced bins between fMin and fMax
 * (normalized 0..1). Each output bin takes the loudest source bin in its range, or interpolates
 * between neighbours where the range is narrower than one source bin (the low end).
 */
export function logSpectrum(spectrumDb: Float32Array, sampleRate: number, out: Float32Array, fMin = 30, fMax = 16000): Float32Array {
  const n = spectrumDb.length;
  const nyq = sampleRate / 2;
  const hiF = Math.min(fMax, nyq);
  const ratio = hiF / fMin;
  const m = out.length;
  for (let i = 0; i < m; i++) {
    const f0 = fMin * Math.pow(ratio, i / m);
    const f1 = fMin * Math.pow(ratio, (i + 1) / m);
    const x0 = (f0 / nyq) * n, x1 = (f1 / nyq) * n;
    let v: number;
    if (x1 - x0 < 1) {
      const x = Math.min(n - 1.001, (x0 + x1) / 2);
      const k = Math.floor(x), t = x - k;
      v = normDb(spectrumDb[k]!) * (1 - t) + normDb(spectrumDb[k + 1]!) * t;
    } else {
      v = 0;
      const a = Math.floor(x0), b = Math.min(n - 1, Math.ceil(x1));
      for (let k = a; k <= b; k++) { const e = normDb(spectrumDb[k]!); if (e > v) v = e; }
    }
    // gentle tilt: real mixes fall off ~3–4.5 dB/oct, so lift the top so hats read on screen
    out[i] = Math.min(1, v * (0.85 + 0.35 * (i / m)));
  }
  return out;
}

/** RMS and peak of a time-domain block (-1..1). */
export function levels(block: Float32Array): { rms: number; peak: number } {
  let s = 0, p = 0;
  for (let i = 0; i < block.length; i++) { const v = block[i]!; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
  return { rms: block.length ? Math.sqrt(s / block.length) : 0, peak: p };
}

/** Attack/release envelope follower with time constants in seconds (frame-rate independent). */
export class Envelope {
  value = 0;
  constructor(public attack = 0.01, public release = 0.25) {}
  step(target: number, dt: number): number {
    const tc = target > this.value ? this.attack : this.release;
    const k = tc <= 0 ? 1 : 1 - Math.exp(-dt / tc);
    this.value += (target - this.value) * k;
    return this.value;
  }
  /** jump up immediately (a trigger), then release normally */
  kick(amount: number): void { if (amount > this.value) this.value = amount; }
}

/**
 * Spectral-flux onset detector over a frequency range: the positive change in energy between
 * frames, against an adaptive threshold (recent mean × sensitivity + floor), with a refractory
 * period so one hit fires once.
 */
export class OnsetDetector {
  private prev: Float32Array | null = null;
  private hist: number[] = [];
  private lastFire = -1;
  constructor(public loHz: number, public hiHz: number, public sensitivity = 1.5, public floor = 0.015, public refractorySec = 0.09, private histLen = 40) {}

  /** returns onset strength (0 = no onset) */
  step(spectrumDb: Float32Array, sampleRate: number, fftSize: number, timeSec: number): number {
    const n = spectrumDb.length;
    const i0 = binOf(this.loHz, sampleRate, fftSize, n);
    const i1 = Math.max(i0, binOf(this.hiHz, sampleRate, fftSize, n));
    if (!this.prev || this.prev.length !== n) this.prev = new Float32Array(n);
    let flux = 0;
    for (let i = i0; i <= i1; i++) {
      const v = normDb(spectrumDb[i]!);
      const d = v - this.prev[i]!;
      if (d > 0) flux += d;
      this.prev[i] = v;
    }
    flux /= i1 - i0 + 1;
    const mean = this.hist.length ? this.hist.reduce((a, b) => a + b, 0) / this.hist.length : flux;
    this.hist.push(flux);
    if (this.hist.length > this.histLen) this.hist.shift();
    const threshold = mean * this.sensitivity + this.floor;
    if (flux > threshold && timeSec - this.lastFire >= this.refractorySec) {
      this.lastFire = timeSec;
      return Math.min(1, (flux - threshold) / (threshold + 1e-6) * 0.5 + 0.5);
    }
    return 0;
  }
  reset(): void { this.prev = null; this.hist = []; this.lastFire = -1; }
}

/**
 * Automatic gain for visual reactivity: tracks a slow ceiling and floor so a quiet demo and a
 * loud master both swing the visuals across 0..1. A steady signal settles toward 0 (nothing to
 * react to); movement (hits, swells) reads as movement.
 */
export class AutoGain {
  hi = 0;
  lo = 1;
  constructor(public release = 5, public floorRise = 2.5, public minSpan = 0.1) {}
  step(v: number, dt: number): number {
    this.hi = v > this.hi ? v : this.hi + (v - this.hi) * (1 - Math.exp(-dt / this.release));
    this.lo = v < this.lo ? v : this.lo + (v - this.lo) * (1 - Math.exp(-dt / this.floorRise));
    const span = Math.max(this.minSpan, this.hi - this.lo);
    const out = (v - this.lo) / span;
    return out < 0 ? 0 : out > 1 ? 1 : out;
  }
}
