/**
 * Pure-TypeScript DSP synthesis for PulseForge's bundled sounds.
 * Every drum hit, riser, impact, and texture in the factory library is generated
 * here — no recorded samples, no licensing ambiguity. Runs in Node (tests) and
 * the browser (rendered into AudioBuffers once, then cached).
 */

export const FACTORY_RATE = 44100;

type F32 = Float32Array;

const TWO_PI = Math.PI * 2;

/** Deterministic PRNG so factory sounds are identical on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buf(sec: number, rate = FACTORY_RATE): F32 {
  return new Float32Array(Math.max(1, Math.round(sec * rate)));
}

/** Exponential decay envelope value at sample i. */
function expEnv(i: number, rate: number, decaySec: number): number {
  return Math.exp((-i / rate) * (5 / Math.max(0.001, decaySec)));
}

/** RBJ biquad filter, applied in place. */
export function biquad(x: F32, rate: number, type: "lowpass" | "highpass" | "bandpass" | "peak" | "notch", freq: number, q = 0.707, gainDb = 0): F32 {
  const w0 = (TWO_PI * Math.min(freq, rate / 2 - 1)) / rate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw = Math.cos(w0);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case "lowpass":
      b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case "highpass":
      b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case "notch":
      b0 = 1; b1 = -2 * cosw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case "peak":
      b0 = 1 + alpha * A; b1 = -2 * cosw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosw; a2 = 1 - alpha / A; break;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

function softClip(x: F32, drive = 1): F32 {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i]! * drive);
  return x;
}

function normalize(x: F32, target = 0.9): F32 {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  if (peak > 0) { const g = target / peak; for (let i = 0; i < x.length; i++) x[i]! *= g; }
  return x;
}

function fadeOutTail(x: F32, rate: number, ms = 8): F32 {
  const n = Math.min(x.length, Math.round((ms / 1000) * rate));
  for (let i = 0; i < n; i++) x[x.length - 1 - i]! *= i / n;
  return x;
}

export interface DrumParams {
  tune?: number;      // semitone offset
  decay?: number;     // seconds
  tone?: number;      // 0..1 brightness / character
  drive?: number;     // saturation amount
  seed?: number;
}

/** Kick: sine with exponential pitch sweep + click transient. */
export function synthKick(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.35;
  const base = 50 * Math.pow(2, (p.tune ?? 0) / 12);
  const sweepAmt = 4 + (p.tone ?? 0.5) * 6;
  const out = buf(decay + 0.05, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const freq = base * (1 + sweepAmt * Math.exp(-t * 45));
    phase += (TWO_PI * freq) / rate;
    const body = Math.sin(phase) * expEnv(i, rate, decay);
    const click = i < rate * 0.004 ? (1 - i / (rate * 0.004)) * (p.tone ?? 0.5) * 0.8 : 0;
    out[i] = body + click * Math.sin(phase * 8);
  }
  softClip(out, 1 + (p.drive ?? 0.4) * 3);
  return fadeOutTail(normalize(out), rate);
}

/** 808 kick / bass: long tuned sine with slight sweep and saturation. */
export function synth808(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 1.2;
  const base = 41.2 * Math.pow(2, (p.tune ?? 0) / 12); // E1
  const out = buf(decay + 0.1, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const freq = base * (1 + 2.5 * Math.exp(-t * 60));
    phase += (TWO_PI * freq) / rate;
    out[i] = Math.sin(phase) * expEnv(i, rate, decay);
  }
  softClip(out, 1.6 + (p.drive ?? 0.5) * 2);
  return fadeOutTail(normalize(out), rate);
}

/** Snare: two detuned tones + bandpassed noise. */
export function synthSnare(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.22;
  const rnd = mulberry32(p.seed ?? 7);
  const base = 180 * Math.pow(2, (p.tune ?? 0) / 12);
  const out = buf(decay + 0.08, rate);
  for (let i = 0; i < out.length; i++) {
    const tone = (Math.sin((TWO_PI * base * i) / rate) + 0.6 * Math.sin((TWO_PI * base * 1.6 * i) / rate)) * expEnv(i, rate, decay * 0.5) * 0.6;
    const noise = (rnd() * 2 - 1) * expEnv(i, rate, decay) * (0.5 + (p.tone ?? 0.5) * 0.8);
    out[i] = tone + noise;
  }
  biquad(out, rate, "highpass", 120, 0.7);
  biquad(out, rate, "peak", 3000 + (p.tone ?? 0.5) * 3000, 0.8, 4);
  softClip(out, 1 + (p.drive ?? 0.3) * 2);
  return fadeOutTail(normalize(out), rate);
}

/** Clap: 3-4 short noise bursts then a decaying body. */
export function synthClap(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const rnd = mulberry32(p.seed ?? 11);
  const decay = p.decay ?? 0.3;
  const out = buf(decay + 0.1, rate);
  const bursts = [0, 0.012, 0.025, 0.04];
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let env = 0;
    for (const b of bursts) if (t >= b) env = Math.max(env, Math.exp(-(t - b) * (t < 0.05 ? 220 : 18 / decay)));
    out[i] = (rnd() * 2 - 1) * env;
  }
  biquad(out, rate, "bandpass", 1100 + (p.tone ?? 0.5) * 800, 1.1);
  biquad(out, rate, "highpass", 400, 0.7);
  return fadeOutTail(normalize(out), rate);
}

/** Hi-hat: six square oscillators (808-style metallic cluster) through highpass. */
export function synthHat(p: DrumParams & { open?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? (p.open ? 0.5 : 0.06);
  const out = buf(decay + 0.05, rate);
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const base = 40 * Math.pow(2, (p.tune ?? 0) / 12);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const r of ratios) v += Math.sign(Math.sin((TWO_PI * base * r * 100 * i) / rate / 10));
    out[i] = (v / ratios.length) * expEnv(i, rate, decay);
  }
  biquad(out, rate, "highpass", 7000 - (p.tone ?? 0.5) * 2000, 0.9);
  biquad(out, rate, "highpass", 5000, 0.7);
  return fadeOutTail(normalize(out, 0.8), rate);
}

/** Cymbals: dense metallic noise, long decay; ride is tighter than crash. */
export function synthCymbal(p: DrumParams & { ride?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? (p.ride ? 1.2 : 2.2);
  const rnd = mulberry32(p.seed ?? 23);
  const out = buf(decay + 0.2, rate);
  const partials = Array.from({ length: 14 }, (_, k) => 300 * Math.pow(1.47, k) * (0.98 + rnd() * 0.04));
  for (let i = 0; i < out.length; i++) {
    let v = (rnd() * 2 - 1) * 0.5;
    for (const f of partials) if (f < rate / 2) v += Math.sin((TWO_PI * f * i) / rate) / partials.length;
    out[i] = v * expEnv(i, rate, decay) * (p.ride ? (i < rate * 0.01 ? 1 : 0.7) : 1);
  }
  biquad(out, rate, "highpass", p.ride ? 2000 : 1500, 0.7);
  return fadeOutTail(normalize(out, 0.75), rate);
}

export function synthTom(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.4;
  const base = 110 * Math.pow(2, (p.tune ?? 0) / 12);
  const rnd = mulberry32(p.seed ?? 5);
  const out = buf(decay + 0.05, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const freq = base * (1 + 1.2 * Math.exp(-t * 30));
    phase += (TWO_PI * freq) / rate;
    out[i] = (Math.sin(phase) + (rnd() * 2 - 1) * 0.15 * expEnv(i, rate, 0.03)) * expEnv(i, rate, decay);
  }
  return fadeOutTail(normalize(out), rate);
}

export function synthRimshot(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const out = buf(0.09, rate);
  const rnd = mulberry32(p.seed ?? 3);
  for (let i = 0; i < out.length; i++) {
    out[i] = (Math.sin((TWO_PI * 480 * i) / rate) * 0.6 + (rnd() * 2 - 1) * 0.7) * expEnv(i, rate, 0.05);
  }
  biquad(out, rate, "bandpass", 2200 + (p.tone ?? 0.5) * 1500, 2.2);
  softClip(out, 2.5);
  return fadeOutTail(normalize(out), rate);
}

export function synthShaker(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.12;
  const rnd = mulberry32(p.seed ?? 17);
  const out = buf(decay + 0.04, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const attack = Math.min(1, t / 0.015);
    out[i] = (rnd() * 2 - 1) * attack * expEnv(i, rate, decay);
  }
  biquad(out, rate, "bandpass", 6500 + (p.tone ?? 0.5) * 2000, 1.6);
  return fadeOutTail(normalize(out, 0.7), rate);
}

export function synthTambourine(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const rnd = mulberry32(p.seed ?? 29);
  const out = buf(0.35, rate);
  const jingles = [5200, 6100, 7300, 8400].map((f) => f * (0.97 + rnd() * 0.06));
  for (let i = 0; i < out.length; i++) {
    let v = (rnd() * 2 - 1) * 0.4 * expEnv(i, rate, 0.05);
    for (const f of jingles) if (f < rate / 2) v += Math.sin((TWO_PI * f * i) / rate) * 0.2 * expEnv(i, rate, 0.25);
    out[i] = v;
  }
  biquad(out, rate, "highpass", 3800, 0.8);
  return fadeOutTail(normalize(out, 0.7), rate);
}

export function synthCowbell(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.25;
  const t1 = 540 * Math.pow(2, (p.tune ?? 0) / 12);
  const out = buf(decay + 0.05, rate);
  for (let i = 0; i < out.length; i++) {
    const v = Math.sign(Math.sin((TWO_PI * t1 * i) / rate)) * 0.5 + Math.sign(Math.sin((TWO_PI * t1 * 1.48 * i) / rate)) * 0.5;
    out[i] = v * expEnv(i, rate, decay);
  }
  biquad(out, rate, "bandpass", t1 * 1.3, 1.2);
  softClip(out, 1.5);
  return fadeOutTail(normalize(out, 0.8), rate);
}

export function synthClick(_p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const out = buf(0.03, rate);
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((TWO_PI * 2100 * i) / rate) * expEnv(i, rate, 0.012);
  return fadeOutTail(normalize(out, 0.8), rate);
}

export function synthImpact(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 1.5;
  const rnd = mulberry32(p.seed ?? 41);
  const out = buf(decay + 0.2, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const freq = 55 * (1 + 3 * Math.exp(-t * 25));
    phase += (TWO_PI * freq) / rate;
    out[i] = Math.sin(phase) * expEnv(i, rate, decay) + (rnd() * 2 - 1) * expEnv(i, rate, 0.4) * 0.5;
  }
  biquad(out, rate, "lowpass", 3000, 0.7);
  softClip(out, 2);
  return fadeOutTail(normalize(out), rate);
}

export function synthRiser(p: { seconds?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = p.seconds ?? 2;
  const rnd = mulberry32(p.seed ?? 51);
  const out = buf(sec, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const prog = i / out.length;
    const freq = 80 + 1800 * prog * prog;
    phase += (TWO_PI * freq) / rate;
    out[i] = (Math.sin(phase) * 0.4 + (rnd() * 2 - 1) * 0.6) * (0.2 + 0.8 * prog);
  }
  // rising resonant filter feel: two passes with different cutoffs blended by segments
  biquad(out, rate, "highpass", 200, 0.8);
  return fadeOutTail(normalize(out, 0.8), rate, 30);
}

export function synthDownlifter(p: { seconds?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = p.seconds ?? 1.5;
  const rnd = mulberry32(p.seed ?? 61);
  const out = buf(sec, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const prog = i / out.length;
    const freq = 1400 * (1 - prog) * (1 - prog) + 60;
    phase += (TWO_PI * freq) / rate;
    out[i] = (Math.sin(phase) * 0.5 + (rnd() * 2 - 1) * 0.5) * (1 - prog * 0.7);
  }
  biquad(out, rate, "lowpass", 4000, 0.8);
  return fadeOutTail(normalize(out, 0.75), rate, 60);
}

export function synthNoiseSweep(p: { seconds?: number; up?: boolean; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = p.seconds ?? 2;
  const rnd = mulberry32(p.seed ?? 71);
  const out = buf(sec, rate);
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 2 - 1;
  // sweep by crossfading filtered segments
  const seg = Math.floor(out.length / 8);
  for (let s = 0; s < 8; s++) {
    const prog = (p.up !== false ? s : 7 - s) / 7;
    const slice = out.subarray(s * seg, Math.min(out.length, (s + 1) * seg));
    biquad(slice, rate, "bandpass", 300 + 6000 * prog * prog, 1.2);
  }
  for (let i = 0; i < out.length; i++) {
    const prog = i / out.length;
    out[i]! *= p.up !== false ? 0.2 + 0.8 * prog : 1 - 0.8 * prog;
  }
  return fadeOutTail(normalize(out, 0.7), rate, 40);
}

export function synthBassHit(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.6;
  const base = 55 * Math.pow(2, (p.tune ?? 0) / 12);
  const out = buf(decay + 0.1, rate);
  for (let i = 0; i < out.length; i++) {
    const saw = 2 * ((base * i) / rate - Math.floor(0.5 + (base * i) / rate));
    out[i] = (Math.sin((TWO_PI * base * i) / rate) * 0.7 + saw * 0.3) * expEnv(i, rate, decay);
  }
  biquad(out, rate, "lowpass", 400 + (p.tone ?? 0.5) * 800, 1.0);
  softClip(out, 2);
  return fadeOutTail(normalize(out), rate);
}

/** Synthetic vowel chop — saw through formant filters. Clearly synthetic, clearly legal. */
export function synthVocalChop(p: { vowel?: "a" | "e" | "i" | "o" | "u"; tune?: number; decay?: number } = {}, rate = FACTORY_RATE): F32 {
  const formants: Record<string, [number, number, number]> = {
    a: [800, 1150, 2900], e: [400, 2000, 2800], i: [250, 2300, 3000], o: [450, 800, 2830], u: [325, 700, 2700],
  };
  const [f1, f2, f3] = formants[p.vowel ?? "a"]!;
  const decay = p.decay ?? 0.4;
  const base = 220 * Math.pow(2, (p.tune ?? 0) / 12);
  const src = buf(decay + 0.1, rate);
  for (let i = 0; i < src.length; i++) {
    const t = i / rate;
    const vib = 1 + 0.008 * Math.sin(TWO_PI * 5.5 * t);
    const f = base * vib;
    src[i] = (2 * ((f * i) / rate - Math.floor(0.5 + (f * i) / rate))) * expEnv(i, rate, decay) * Math.min(1, t / 0.02);
  }
  const b1 = biquad(src.slice(), rate, "bandpass", f1, 6);
  const b2 = biquad(src.slice(), rate, "bandpass", f2, 8);
  const b3 = biquad(src.slice(), rate, "bandpass", f3, 10);
  const out = buf(decay + 0.1, rate);
  for (let i = 0; i < out.length; i++) out[i] = b1[i]! * 1 + b2[i]! * 0.5 + b3[i]! * 0.25;
  return fadeOutTail(normalize(out, 0.8), rate);
}

export function synthTexture(p: { seconds?: number; seed?: number; dark?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const sec = p.seconds ?? 4;
  const rnd = mulberry32(p.seed ?? 101);
  const out = buf(sec, rate);
  const tones = [110, 165, 220, 275].map((f) => f * (0.99 + rnd() * 0.02));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let v = (rnd() * 2 - 1) * 0.15;
    for (let k = 0; k < tones.length; k++) {
      v += Math.sin(TWO_PI * tones[k]! * t + Math.sin(TWO_PI * 0.13 * (k + 1) * t) * 2) * 0.2;
    }
    const env = Math.min(1, t / 0.5) * Math.min(1, (sec - t) / 0.5);
    out[i] = v * env;
  }
  biquad(out, rate, "lowpass", p.dark ? 900 : 2500, 0.7);
  return normalize(out, 0.6);
}

export function synthFoley(p: { seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const rnd = mulberry32(p.seed ?? 131);
  const out = buf(0.5, rate);
  // a few irregular filtered taps, like knuckles on wood
  const taps = [0, 0.09, 0.21, 0.33].map((t) => t + rnd() * 0.03);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let v = 0;
    for (const tap of taps) if (t >= tap) v += (rnd() * 2 - 1) * Math.exp(-(t - tap) * 90);
    out[i] = v;
  }
  biquad(out, rate, "bandpass", 700 + rnd() * 500, 1.4);
  return fadeOutTail(normalize(out, 0.8), rate);
}

export function synthMetronomeTick(accent: boolean, rate = FACTORY_RATE): F32 {
  const out = buf(0.05, rate);
  const f = accent ? 1800 : 1200;
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((TWO_PI * f * i) / rate) * expEnv(i, rate, 0.02);
  return fadeOutTail(normalize(out, 0.7), rate);
}

/** Simple linear-interp resample (used by editor previews and slice exports). */
export function resampleLinear(input: F32, fromRate: number, toRate: number): F32 {
  if (fromRate === toRate) return input.slice();
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = (input.length - 1) / (outLen - 1 || 1);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}
