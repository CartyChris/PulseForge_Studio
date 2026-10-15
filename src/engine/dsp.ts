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

/* ════════════════════════════════════════════════════════════════════════════
 * 2.0 sound-library expansion — classic drum-machine recipes, Latin/world
 * percussion, FX & transitions, stabs and textures. All original procedural
 * synthesis (no recordings), deterministic via mulberry32 seeds.
 * ════════════════════════════════════════════════════════════════════════════ */

const semi = (st = 0): number => Math.pow(2, st / 12);
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** PolyBLEP residual — removes most aliasing from naive saw/square edges. */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

type Wave = "sine" | "saw" | "square" | "triangle";

/** Band-limited oscillator with its own phase; call once per sample with the current frequency. */
function makeOsc(kind: Wave, rate: number, phase0 = 0): (freq: number) => number {
  let ph = ((phase0 % 1) + 1) % 1;
  return (freq: number): number => {
    const dt = Math.min(0.49, Math.max(0, freq / rate));
    let v: number;
    if (kind === "sine") v = Math.sin(TWO_PI * ph);
    else if (kind === "saw") v = 2 * ph - 1 - polyBlep(ph, dt);
    else if (kind === "square") v = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.5) % 1, dt);
    else v = 1 - 4 * Math.abs(ph - 0.5);
    ph += dt;
    if (ph >= 1) ph -= 1;
    return v;
  };
}

/** Zavalishin TPT state-variable filter with a per-sample cutoff (stable under any sweep). In place. */
function svfSweep(x: F32, rate: number, mode: "lowpass" | "bandpass" | "highpass", cutoff: (i: number) => number, q: number | ((i: number) => number) = 0.707): F32 {
  let ic1 = 0, ic2 = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = Math.min(rate * 0.45, Math.max(10, cutoff(i)));
    const Q = typeof q === "number" ? q : q(i);
    const g = Math.tan((Math.PI * fc) / rate);
    const k = 1 / Math.max(0.1, Q);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v0 = x[i]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    x[i] = mode === "lowpass" ? v2 : mode === "bandpass" ? v1 : v0 - k * v1 - v2;
  }
  return x;
}

/** Two-pole formant resonator with a gliding centre frequency; ~unity gain at the peak. Returns a new buffer. */
function resonate(x: F32, rate: number, freq: (i: number) => number, bwHz: number): F32 {
  const out = new Float32Array(x.length);
  const r = Math.exp((-Math.PI * bwHz) / rate);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = (TWO_PI * Math.min(freq(i), rate * 0.45)) / rate;
    const g = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * w) + r * r);
    const y = g * x[i]! + 2 * r * Math.cos(w) * y1 - r * r * y2;
    y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Freeverb-style mono reverb (8 damped combs + 4 allpasses). Returns dry+tail, longer than the input. */
function plateTail(x: F32, rate: number, decaySec: number, mix: number, damp = 0.35): F32 {
  const decay = Math.min(4, Math.max(0.05, decaySec));
  const n = x.length + Math.round(decay * rate);
  const sc = rate / 44100;
  const wet = new Float32Array(n);
  for (const d0 of [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]) {
    const d = Math.max(1, Math.round(d0 * sc));
    const line = new Float32Array(d);
    const fb = Math.pow(10, (-3 * d) / (rate * decay));
    let idx = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const y = line[idx]!;
      lp = y * (1 - damp) + lp * damp;
      line[idx] = (i < x.length ? x[i]! : 0) + lp * fb;
      wet[i]! += y;
      idx = idx + 1 === d ? 0 : idx + 1;
    }
  }
  for (const d0 of [556, 441, 341, 225]) {
    const d = Math.max(1, Math.round(d0 * sc));
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const b = line[idx]!;
      const inp = wet[i]!;
      line[idx] = inp + b * 0.5;
      wet[i] = b - inp;
      idx = idx + 1 === d ? 0 : idx + 1;
    }
  }
  let dryPeak = 0, wetPeak = 0;
  for (let i = 0; i < x.length; i++) dryPeak = Math.max(dryPeak, Math.abs(x[i]!));
  for (let i = 0; i < n; i++) wetPeak = Math.max(wetPeak, Math.abs(wet[i]!));
  const wg = wetPeak > 0 ? (dryPeak * 0.7) / wetPeak : 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (i < x.length ? x[i]! : 0) * (1 - mix * 0.5) + wet[i]! * wg * mix;
  return out;
}

/** Common one-shot mastering: kill non-finite values, remove DC, peak-normalize, fade the tail. */
function finish(x: F32, rate: number, o: { peak?: number; fadeMs?: number; dcHz?: number } = {}): F32 {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i]!)) x[i] = 0;
  biquad(x, rate, "highpass", o.dcHz ?? 24, 0.707);
  normalize(x, o.peak ?? 0.9);
  return fadeOutTail(x, rate, o.fadeMs ?? 10);
}

/** Per-kit character processing applied to any rendered one-shot. */
export interface ShapeOptions {
  highpass?: number;
  lowpass?: number;
  /** tanh saturation amount, 0 = clean, 4+ = crunchy. */
  drive?: number;
  /** bit depth for quantization grit (e.g. 12 = SP-1200-ish, 8 = LinnDrum-ish, 6 = 909 cymbal ROM). */
  bits?: number;
  /** sample-and-hold factor (2 = half sample rate, aliasing grit). */
  downsample?: number;
  reverb?: { decay: number; mix: number; damp?: number };
  /** gated-reverb: hold this many seconds then slam shut (80s snare). */
  gate?: number;
  peak?: number;
}

export function shapeOneShot(input: F32, o: ShapeOptions = {}, rate = FACTORY_RATE): F32 {
  let x: F32 = input.slice();
  if (o.highpass) biquad(x, rate, "highpass", o.highpass, 0.707);
  if (o.drive && o.drive > 0) {
    normalize(x, 1);
    const d = 1 + o.drive;
    const norm = Math.tanh(d);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i]! * d) / norm;
  }
  if (o.downsample && o.downsample > 1) {
    const h = Math.round(o.downsample);
    for (let i = 0; i < x.length; i++) if (i % h !== 0) x[i] = x[i - (i % h)]!;
  }
  if (o.bits && o.bits > 1) {
    normalize(x, 0.95);
    const q = Math.pow(2, Math.round(o.bits) - 1);
    for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i]! * q) / q;
  }
  if (o.lowpass) biquad(x, rate, "lowpass", o.lowpass, 0.707);
  if (o.reverb) x = plateTail(x, rate, o.reverb.decay, o.reverb.mix, o.reverb.damp);
  if (o.gate && o.gate > 0) {
    const hold = Math.round(o.gate * rate), rel = Math.round(0.018 * rate);
    const n = Math.min(x.length, hold + rel);
    for (let i = hold; i < n; i++) x[i]! *= 1 - (i - hold) / rel;
    x = x.slice(0, n);
  }
  return finish(x, rate, { peak: o.peak });
}

/** Sum rendered layers: [buffer, gain, offsetSeconds?]. Result is normalized. */
export function layerSounds(layers: Array<[F32, number, number?]>, rate = FACTORY_RATE): F32 {
  let n = 1;
  for (const [d, , off] of layers) n = Math.max(n, d.length + Math.round((off ?? 0) * rate));
  const out = new Float32Array(n);
  for (const [d, g, off] of layers) {
    const o = Math.round((off ?? 0) * rate);
    for (let i = 0; i < d.length; i++) out[i + o]! += d[i]! * g;
  }
  return finish(out, rate);
}

// ───────────────────────────── drum-machine recipes ─────────────────────────────

/** TR-909-style kick: fast two-stage pitch drop (≈230 Hz → ≈52 Hz), short hold, plus noise+pulse click. */
export function synthKick909(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.42;
  const tone = p.tone ?? 0.5;
  const base = 52 * semi(p.tune);
  const rnd = mulberry32(p.seed ?? 909);
  const out = buf(decay + 0.08, rate);
  const click = buf(0.012, rate);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const f = base * (1 + 3.4 * Math.exp(-t * 95) + 0.45 * Math.exp(-t * 16));
    ph += (TWO_PI * f) / rate;
    const amp = t < 0.012 ? 1 : Math.exp(((-(t - 0.012)) * 5) / decay);
    out[i] = Math.sin(ph) * amp;
  }
  softClip(out, 1.3 + (p.drive ?? 0.35) * 4);
  for (let i = 0; i < click.length; i++) {
    const t = i / rate;
    const pulse = t < 0.0006 ? 1 : 0;
    click[i] = pulse + (rnd() * 2 - 1) * Math.exp(-t * 700);
  }
  biquad(click, rate, "highpass", 1100, 0.7);
  biquad(click, rate, "lowpass", 9000, 0.7);
  for (let i = 0; i < click.length; i++) out[i]! += click[i]! * (0.25 + tone * 0.9);
  return finish(out, rate);
}

function analogSnare(c: { f1: number; f2: number; bodyDecay: number; noiseDecay: number; snappy: number; noiseHp: number; noiseLp: number; bend: number; drive: number; seed: number }, rate: number): F32 {
  const len = Math.max(c.bodyDecay, c.noiseDecay) + 0.08;
  const out = buf(len, rate);
  const noise = buf(len, rate);
  const rnd = mulberry32(c.seed);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const bend = 1 + c.bend * Math.exp(-t * 55);
    p1 += (TWO_PI * c.f1 * bend) / rate;
    p2 += (TWO_PI * c.f2 * bend) / rate;
    out[i] = (Math.sin(p1) + 0.55 * Math.sin(p2)) * Math.exp((-t * 5) / c.bodyDecay) * 0.8;
    noise[i] = (rnd() * 2 - 1) * Math.min(1, t / 0.0015) * Math.exp((-t * 5) / c.noiseDecay);
  }
  biquad(noise, rate, "highpass", c.noiseHp, 0.8);
  biquad(noise, rate, "lowpass", c.noiseLp, 0.7);
  for (let i = 0; i < out.length; i++) out[i]! += noise[i]! * c.snappy * 1.4;
  softClip(out, 1 + c.drive * 3);
  return finish(out, rate);
}

/** TR-909-style snare: two pitched oscillators (~190/340 Hz) with a bend, plus bright "snappy" noise. tone = snappy. */
export function synthSnare909(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const k = semi(p.tune);
  return analogSnare({ f1: 190 * k, f2: 340 * k, bodyDecay: 0.12, noiseDecay: p.decay ?? 0.24, snappy: 0.5 + (p.tone ?? 0.5) * 0.7, noiseHp: 1000, noiseLp: 11000, bend: 0.5, drive: p.drive ?? 0.3, seed: p.seed ?? 919 }, rate);
}

/** TR-808-style snare: 238/476 Hz bridged-T tones plus thinner high-passed noise. */
export function synthSnare808(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const k = semi(p.tune);
  return analogSnare({ f1: 238 * k, f2: 476 * k, bodyDecay: 0.15, noiseDecay: p.decay ?? 0.18, snappy: 0.35 + (p.tone ?? 0.5) * 0.6, noiseHp: 1800, noiseLp: 8000, bend: 0.15, drive: p.drive ?? 0.2, seed: p.seed ?? 818 }, rate);
}

/** The six TR-808 metal-oscillator frequencies (Hz). */
const METAL_808 = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metalHat(c: { open: boolean; decay: number; tune: number; noiseMix: number; bpHz: number; bpQ: number; hpHz: number; seed: number }, rate: number): F32 {
  const out = buf(c.decay + 0.05, rate);
  const k = semi(c.tune);
  const oscs = METAL_808.map((_, j) => makeOsc("square", rate, j * 0.137));
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let j = 0; j < METAL_808.length; j++) v += oscs[j]!(METAL_808[j]! * k);
    out[i] = v / METAL_808.length;
  }
  biquad(out, rate, "bandpass", c.bpHz, c.bpQ);
  const rnd = mulberry32(c.seed);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.0005) * (c.open ? 0.75 * Math.exp((-t * 5) / c.decay) + 0.25 * Math.exp(-t * 60) : Math.exp((-t * 5) / c.decay));
    out[i] = (out[i]! * 2.5 + (rnd() * 2 - 1) * c.noiseMix) * env;
  }
  biquad(out, rate, "highpass", c.hpHz, 0.707);
  biquad(out, rate, "highpass", c.hpHz * 0.8, 0.707);
  return finish(out, rate, { peak: 0.85, fadeMs: 6 });
}

/** TR-909-style hat: six inharmonic square oscillators + noise sizzle → bandpass → highpass. tone = brightness. */
export function synthHat909(p: DrumParams & { open?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const tone = p.tone ?? 0.5;
  return metalHat({ open: !!p.open, decay: p.decay ?? (p.open ? 0.38 : 0.055), tune: p.tune ?? 0, noiseMix: 0.35, bpHz: 9000, bpQ: 0.8, hpHz: 6000 + tone * 2500, seed: p.seed ?? 929 }, rate);
}

/** TR-808-style hat: the 808 metal cluster, darker band, almost no noise. */
export function synthHat808(p: DrumParams & { open?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const tone = p.tone ?? 0.5;
  return metalHat({ open: !!p.open, decay: p.decay ?? (p.open ? 0.45 : 0.045), tune: p.tune ?? 0, noiseMix: 0.05, bpHz: 7100, bpQ: 1.2, hpHz: 5200 + tone * 2000, seed: p.seed ?? 828 }, rate);
}

/** TR-808 cowbell: two square oscillators (540 Hz & 800 Hz) → bandpass ≈2.6 kHz, fast two-stage decay. drive = phonk crunch. */
export function synthCowbell808(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.32;
  const k = semi(p.tune);
  const o1 = makeOsc("square", rate), o2 = makeOsc("square", rate);
  const raw = buf(decay + 0.08, rate);
  for (let i = 0; i < raw.length; i++) {
    const t = i / rate;
    const env = 0.62 * Math.exp(-t / 0.008) + 0.38 * Math.exp((-t * 5) / decay);
    raw[i] = (o1(540 * k) + o2(800 * k)) * 0.5 * env;
  }
  const bell = biquad(raw.slice(), rate, "bandpass", 2640 * k * (0.85 + (p.tone ?? 0.5) * 0.3), 1.1);
  const body = biquad(raw.slice(), rate, "bandpass", 800 * k, 2);
  const out = buf(decay + 0.08, rate);
  for (let i = 0; i < out.length; i++) out[i] = bell[i]! + body[i]! * 0.35;
  const drive = p.drive ?? 0;
  if (drive > 0) {
    normalize(out, 1);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * (1 + drive * 6));
    biquad(out, rate, "lowpass", 5200, 0.8);
  }
  return finish(out, rate);
}

/** TR-808-style clap: four sawtooth-enveloped noise bursts ~10 ms apart, then a band-passed "room" tail. */
export function synthClap808(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.22;
  const tone = p.tone ?? 0.5;
  const rnd = mulberry32(p.seed ?? 808);
  const bursts = buf(decay + 0.12, rate);
  const tail = buf(decay + 0.12, rate);
  const times = [0, 0.0105, 0.0205, 0.031];
  for (let i = 0; i < bursts.length; i++) {
    const t = i / rate;
    let e = 0;
    for (const b of times) if (t >= b) e = Math.exp(-(t - b) / 0.0032);
    bursts[i] = (rnd() * 2 - 1) * (t < 0.045 ? e : 0);
    tail[i] = t >= 0.031 ? (rnd() * 2 - 1) * Math.exp((-(t - 0.031) * 5) / decay) : 0;
  }
  biquad(bursts, rate, "bandpass", 1000 + tone * 400, 1.6);
  biquad(tail, rate, "bandpass", 1150 + tone * 500, 1.1);
  const out = buf(decay + 0.12, rate);
  for (let i = 0; i < out.length; i++) out[i] = bursts[i]! + tail[i]! * 0.75;
  biquad(out, rate, "highpass", 350, 0.7);
  return finish(out, rate);
}

/** TR-808-style rimshot: 455 Hz + 1667 Hz resonant pings, very short, slightly clipped. */
export function synthRim808(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const k = semi(p.tune);
  const out = buf(0.07, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    out[i] = Math.sin(TWO_PI * 1667 * k * t) * Math.exp(-t / 0.006) * 0.9 + Math.sin(TWO_PI * 455 * k * t) * Math.exp(-t / 0.009) * 0.6;
  }
  softClip(out, 2.2 + (p.drive ?? 0) * 2);
  biquad(out, rate, "highpass", 300, 0.7);
  return finish(out, rate, { fadeMs: 5 });
}

// ───────────────────────────── snaps, Latin & world ─────────────────────────────

/** Finger snap: soft finger-slide noise, then a sharp band-limited crack with a ~1.9 kHz skin ping. */
export function synthSnap(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const decay = p.decay ?? 0.07;
  const tone = p.tone ?? 0.5;
  const k = semi(p.tune);
  const rnd = mulberry32(p.seed ?? 211);
  const out = buf(decay + 0.1, rate);
  const pre = Math.round(0.0025 * rate);
  for (let i = 0; i < out.length; i++) {
    const n = rnd() * 2 - 1;
    if (i < pre) { out[i] = n * 0.25 * (i / pre); continue; }
    const tt = (i - pre) / rate;
    out[i] = n * Math.exp((-tt * 5) / decay) + Math.sin(TWO_PI * 1900 * k * tt) * Math.exp(-tt * 140) * 0.8;
  }
  biquad(out, rate, "bandpass", (2300 + tone * 1200) * k, 1.4);
  biquad(out, rate, "peak", 3800 * k, 1.2, 5);
  biquad(out, rate, "highpass", 900, 0.7);
  return finish(out, rate, { fadeMs: 6 });
}

/** Membrane drum core: circular-membrane modes (1, 1.59, 2.14, 2.3, 2.65…), strike pitch bend, skin noise. */
function handDrum(c: { f0: number; decay: number; slap: boolean; noiseAmt: number; noiseHz: number; seed: number; shell?: number[]; shellDecay?: number }, rate: number): F32 {
  const modes: Array<[number, number]> = c.slap
    ? [[1, 0.5], [1.59, 0.45], [2.14, 0.4], [2.65, 0.3], [3.16, 0.2]]
    : [[1, 1], [1.59, 0.22], [2.14, 0.12], [2.3, 0.06]];
  const len = Math.max(c.decay, c.shellDecay ?? 0) + 0.08;
  const out = buf(len, rate);
  const noise = buf(len, rate);
  const rnd = mulberry32(c.seed);
  const phases = modes.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const bend = 1 + 0.06 * Math.exp(-t * 40);
    let v = 0;
    for (let m = 0; m < modes.length; m++) {
      const [ratio, amp] = modes[m]!;
      phases[m]! += (TWO_PI * c.f0 * ratio * bend) / rate;
      v += Math.sin(phases[m]!) * amp * Math.exp((-t * 5 * (1 + 0.6 * m)) / c.decay);
    }
    if (c.shell) for (let s = 0; s < c.shell.length; s++) v += Math.sin(TWO_PI * c.shell[s]! * t) * 0.12 * Math.exp((-t * 5) / (c.shellDecay ?? 0.3));
    out[i] = v;
    noise[i] = (rnd() * 2 - 1) * Math.exp(-t * (c.slap ? 60 : 160));
  }
  biquad(noise, rate, "bandpass", c.noiseHz, 0.8);
  for (let i = 0; i < out.length; i++) out[i]! += noise[i]! * c.noiseAmt;
  if (c.slap) softClip(out, 1.8);
  return finish(out, rate);
}

/** Conga: high (quinto ~330 Hz) or low (tumba ~220 Hz); open tone or slap. */
export function synthConga(p: DrumParams & { high?: boolean; slap?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const high = p.high ?? true, slap = p.slap ?? false;
  return handDrum({
    f0: (high ? 330 : 220) * semi(p.tune), decay: p.decay ?? (slap ? 0.12 : high ? 0.32 : 0.42), slap,
    noiseAmt: (slap ? 0.9 : 0.3) * (0.6 + (p.tone ?? 0.5) * 0.8), noiseHz: slap ? 2500 : 1800, seed: p.seed ?? (high ? 223 : 227),
  }, rate);
}

/** Bongo: small, high, dry hand drum (macho ~480 Hz, hembra ~320 Hz). */
export function synthBongo(p: DrumParams & { high?: boolean; slap?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const high = p.high ?? true;
  return handDrum({
    f0: (high ? 480 : 320) * semi(p.tune), decay: p.decay ?? (high ? 0.16 : 0.22), slap: p.slap ?? false,
    noiseAmt: 0.45 * (0.6 + (p.tone ?? 0.5) * 0.8), noiseHz: 3200, seed: p.seed ?? (high ? 229 : 233),
  }, rate);
}

/** Timbale: tight metal-shell drum — membrane ping plus ringing inharmonic shell partials and rim noise. */
export function synthTimbale(p: DrumParams & { high?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const k = semi(p.tune);
  const high = p.high ?? true;
  return handDrum({
    f0: (high ? 520 : 380) * k, decay: p.decay ?? 0.3, slap: true, noiseAmt: 0.5 * (0.6 + (p.tone ?? 0.5) * 0.8), noiseHz: 4000,
    shell: [2130 * k, 3320 * k, 4710 * k], shellDecay: (p.decay ?? 0.3) * 1.4, seed: p.seed ?? 239,
  }, rate);
}

/** Clave: the 808 recipe — a single ~2.5 kHz resonant ping with a faint upper mode, ~45 ms. */
export function synthClave(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const f = 2500 * semi(p.tune);
  const decay = p.decay ?? 0.045;
  const out = buf(decay + 0.06, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    out[i] = Math.sin(TWO_PI * f * t) * Math.exp((-t * 5) / decay) + 0.18 * Math.sin(TWO_PI * f * 2.76 * t) * Math.exp((-t * 10) / decay);
  }
  return finish(out, rate, { fadeMs: 5 });
}

/** Woodblock: hollow "tok" — ~900 Hz wood modes (1, 2.57, 4.2) with a bandpassed knock. */
export function synthWoodblock(p: DrumParams = {}, rate = FACTORY_RATE): F32 {
  const f = 900 * semi(p.tune);
  const decay = p.decay ?? 0.07;
  const rnd = mulberry32(p.seed ?? 241);
  const out = buf(decay + 0.06, rate);
  const knock = buf(decay + 0.06, rate);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    ph += (TWO_PI * f * (1 + 0.03 * Math.exp(-t * 200))) / rate;
    out[i] = Math.sin(ph) * Math.exp((-t * 5) / decay) + 0.35 * Math.sin(ph * 2.57) * Math.exp((-t * 10) / decay) + 0.15 * Math.sin(ph * 4.2) * Math.exp((-t * 16) / decay);
    knock[i] = (rnd() * 2 - 1) * Math.exp(-t * 900);
  }
  biquad(knock, rate, "bandpass", 1500 * semi(p.tune), 1.2);
  for (let i = 0; i < out.length; i++) out[i]! += knock[i]! * 0.5 * (0.5 + (p.tone ?? 0.5));
  return finish(out, rate, { fadeMs: 5 });
}

/** Triangle: free-free bar partials (1, 2.756, 5.404, 8.933, 13.34…) doubled with tiny detune for beating; long ring. */
export function synthTriangle(p: DrumParams & { muted?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const f0 = 1180 * semi(p.tune);
  const decay = p.decay ?? (p.muted ? 0.15 : 2.6);
  const rnd = mulberry32(p.seed ?? 251);
  const ratios = [1, 2.756, 5.404, 8.933, 13.344, 18.64];
  const amps = [0.5, 0.8, 1, 0.7, 0.5, 0.3];
  const parts: Array<{ f: number; a: number; d: number; ph: number }> = [];
  ratios.forEach((r, k) => {
    const f = f0 * r;
    if (f >= rate * 0.45) return;
    const d = decay / (1 + 0.15 * k);
    parts.push({ f, a: amps[k]!, d, ph: rnd() });
    parts.push({ f: f * 1.0015, a: amps[k]! * 0.6, d: d * 0.9, ph: rnd() });
  });
  const out = buf(decay + 0.1, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let v = 0;
    for (const q of parts) v += Math.sin(TWO_PI * (q.f * t + q.ph)) * q.a * Math.exp((-t * 5) / q.d);
    out[i] = v + (i < rate * 0.001 ? (rnd() * 2 - 1) * 0.6 : 0);
  }
  biquad(out, rate, "highpass", 700, 0.7);
  return finish(out, rate, { fadeMs: 40 });
}

/** Agogo bell: FM bell (carrier f, modulator 1.4f, decaying index) plus a shell partial. high ≈1050 Hz, low ≈700 Hz. */
export function synthAgogo(p: DrumParams & { high?: boolean } = {}, rate = FACTORY_RATE): F32 {
  const f = ((p.high ?? true) ? 1050 : 700) * semi(p.tune);
  const decay = p.decay ?? 0.45;
  const rnd = mulberry32(p.seed ?? 257);
  const out = buf(decay + 0.08, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const index = 3 * Math.exp(-t * 12) + 0.6;
    const env = Math.min(1, t / 0.001) * Math.exp((-t * 5) / decay);
    out[i] = Math.sin(TWO_PI * f * t + index * Math.sin(TWO_PI * 1.4 * f * t)) * env
      + 0.3 * Math.sin(TWO_PI * f * 2.71 * t) * Math.exp((-t * 8) / decay)
      + (t < 0.002 ? (rnd() * 2 - 1) * 0.4 : 0);
  }
  return finish(out, rate, { fadeMs: 15 });
}

/** Guiro: rasp of rapid noise micro-clicks (one ridge per click), a long stroke then a short one ("güi-ro"). */
export function synthGuiro(p: { tune?: number; seed?: number; strokes?: 1 | 2 } = {}, rate = FACTORY_RATE): F32 {
  const rnd = mulberry32(p.seed ?? 263);
  const strokes = (p.strokes ?? 2) === 1 ? [{ start: 0, dur: 0.28, ridges: 26 }] : [{ start: 0, dur: 0.24, ridges: 22 }, { start: 0.3, dur: 0.09, ridges: 8 }];
  const last = strokes[strokes.length - 1]!;
  const out = buf(last.start + last.dur + 0.06, rate);
  for (const s of strokes) {
    for (let r = 0; r < s.ridges; r++) {
      const frac = r / (s.ridges - 1);
      const pos = Math.round((s.start + s.dur * Math.pow(frac, 0.9)) * rate);
      const amp = Math.pow(Math.sin(Math.PI * (0.08 + frac * 0.84)), 0.6) * (0.6 + 0.4 * rnd());
      const w = Math.round(rate * 0.0025);
      for (let j = 0; j < w && pos + j < out.length; j++) out[pos + j]! += amp * (rnd() * 2 - 1) * Math.exp(-j / (rate * 0.0007));
    }
  }
  biquad(out, rate, "bandpass", 3200 * semi(p.tune), 2.5);
  biquad(out, rate, "peak", 1500, 1, 4);
  biquad(out, rate, "highpass", 600, 0.7);
  return finish(out, rate);
}

/** Synthetic "HEY!" shout: /h/ aspiration noise into a formant-filtered pitched buzz gliding /e/→/ɪ/.
 * Clearly synthetic (no recording). voices > 1 = gang shout. */
export function synthVoxHey(p: { tune?: number; voices?: number; seed?: number; decay?: number; formantShift?: number } = {}, rate = FACTORY_RATE): F32 {
  const voices = Math.max(1, Math.min(6, Math.round(p.voices ?? 1)));
  const dur = p.decay ?? 0.3;
  const total = 0.08 + dur + 0.1;
  const out = buf(total, rate);
  for (let v = 0; v < voices; v++) {
    const vr = mulberry32((p.seed ?? 271) + v * 97);
    const pitch = 245 * semi(p.tune) * (v ? 1 + (vr() - 0.5) * 0.12 : 1);
    const offset = v ? vr() * 0.018 : 0;
    const fs = (p.formantShift ?? 1) * (v ? 1 + (vr() - 0.5) * 0.08 : 1);
    const vs = offset + 0.045;
    const osc = makeOsc("saw", rate);
    const src = buf(total, rate);
    for (let i = 0; i < src.length; i++) {
      const t = i / rate;
      const n = vr() * 2 - 1;
      const u = t - offset;
      const asp = u >= 0 && u < 0.075 ? n * Math.sin((Math.PI * u) / 0.075) * 0.7 : 0;
      let voiced = 0;
      if (t >= vs) {
        const pr = Math.min(1, (t - vs) / dur);
        const f = pitch * (1.06 - 0.14 * pr) * (1 + 0.01 * Math.sin(TWO_PI * 6 * t));
        const env = Math.min(1, (t - vs) / 0.02) * (t - vs > dur ? Math.max(0, 1 - (t - vs - dur) / 0.07) : 1);
        voiced = (osc(f) + n * 0.08) * env;
      }
      src[i] = asp + voiced;
    }
    const prog = (i: number): number => Math.min(1, Math.max(0, (i / rate - vs) / dur));
    const f1 = resonate(src, rate, (i) => (750 - 330 * prog(i)) * fs, 100);
    const f2 = resonate(src, rate, (i) => (1750 + 500 * prog(i)) * fs, 120);
    const f3 = resonate(src, rate, (i) => (2500 + 200 * prog(i)) * fs, 160);
    const f4 = resonate(src, rate, () => 3500 * fs, 220);
    const g = v ? 0.7 : 1;
    for (let i = 0; i < out.length; i++) out[i]! += (f1[i]! + f2[i]! * 0.7 + f3[i]! * 0.4 + f4[i]! * 0.2) * g;
  }
  normalize(out, 1);
  softClip(out, 1.6);
  biquad(out, rate, "highpass", 120, 0.7);
  return finish(out, rate, { fadeMs: 20 });
}

// ───────────────────────────── FX & transitions ─────────────────────────────

/** Reverse cymbal: a synthesized crash, reversed, so it swells into the downbeat. */
export function synthReverseCymbal(p: { seconds?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = Math.min(8, p.seconds ?? 2);
  const fwd = synthCymbal({ decay: sec * 1.1, seed: p.seed ?? 307 }, rate);
  const n = Math.min(fwd.length, Math.round(sec * rate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fwd[n - 1 - i]!;
  return finish(out, rate, { fadeMs: 4 });
}

/** White-noise build: noise through a resonant bandpass sweeping 250 Hz → 14 kHz with rising Q and level. */
export function synthNoiseBuild(p: { seconds?: number; seed?: number; tone?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = Math.min(9, p.seconds ?? 4);
  const rnd = mulberry32(p.seed ?? 311);
  const out = buf(sec, rate);
  const n = out.length;
  const top = 9000 + (p.tone ?? 0.5) * 6000;
  for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
  svfSweep(out, rate, "bandpass", (i) => 250 * Math.pow(top / 250, Math.pow(i / n, 1.3)), (i) => 0.8 + 2.7 * (i / n));
  for (let i = 0; i < n; i++) out[i]! *= 0.1 + 0.9 * Math.pow(i / n, 1.5);
  return finish(out, rate, { fadeMs: 25 });
}

/** Air horn: stacked detuned brassy saws + fifth + sub square, each blast with a flat-to-pitch attack, driven. */
export function synthAirHorn(p: { tune?: number; blasts?: 1 | 3; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const f0 = 415 * semi(p.tune);
  const pattern: Array<[number, number]> = (p.blasts ?? 3) === 1 ? [[0, 0.75]] : [[0, 0.13], [0.17, 0.13], [0.34, 0.8]];
  const lastBlast = pattern[pattern.length - 1]!;
  const out = buf(lastBlast[0] + lastBlast[1] + 0.1, rate);
  const voices: Array<[number, number, Wave]> = [[-0.008, 0.5, "saw"], [-0.0035, 0.6, "saw"], [0, 0.7, "saw"], [0.003, 0.6, "saw"], [0.007, 0.5, "saw"], [0.498, 0.45, "saw"], [-0.5, 0.35, "square"]];
  const oscs = voices.map(([, , w], j) => makeOsc(w, rate, j * 0.21));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let gate = 0, u = 0;
    for (const [s, d] of pattern) {
      if (t >= s && t < s + d + 0.03) { u = t - s; gate = Math.min(1, u / 0.008) * (u > d ? Math.max(0, 1 - (u - d) / 0.03) : 1); }
    }
    const bend = 1 - 0.18 * Math.exp(-u * 45);
    let v = 0;
    for (let j = 0; j < voices.length; j++) {
      const [det, amp] = voices[j]!;
      v += oscs[j]!(f0 * (1 + det) * bend) * amp;
    }
    out[i] = v * gate * 0.3;
  }
  softClip(out, 2.2);
  biquad(out, rate, "peak", 1800, 0.9, 6);
  biquad(out, rate, "lowpass", 6500, 0.7);
  biquad(out, rate, "highpass", 180, 0.7);
  return finish(out, rate);
}

/** Vinyl crackle: sparse random clicks/pops (mostly tiny, a few big) over band-limited surface hiss. Loop-friendly. */
export function synthVinylCrackle(p: { seconds?: number; density?: number; hiss?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = Math.min(9, p.seconds ?? 4);
  const rnd = mulberry32(p.seed ?? 331);
  const out = buf(sec, rate);
  const hiss = buf(sec, rate);
  const pChance = (25 * (p.density ?? 1)) / rate;
  for (let i = 0; i < out.length; i++) {
    hiss[i] = rnd() * 2 - 1;
    if (rnd() < pChance) {
      const amp = 0.15 + 0.85 * Math.pow(rnd(), 3);
      const w = 1 + Math.floor(rnd() * 6);
      const sign = rnd() < 0.5 ? -1 : 1;
      for (let j = 0; j < w * 5 && i + j < out.length; j++) out[i + j]! += sign * amp * Math.exp(-j / w) * (j % 2 === 0 ? 1 : -0.6);
    }
  }
  biquad(out, rate, "highpass", 700, 0.7);
  biquad(out, rate, "peak", 3000, 1, 3);
  biquad(hiss, rate, "bandpass", 3500, 0.5);
  const h = 0.05 * (p.hiss ?? 1);
  for (let i = 0; i < out.length; i++) out[i]! += hiss[i]! * h;
  const fin = Math.round(0.005 * rate);
  for (let i = 0; i < fin && i < out.length; i++) out[i]! *= i / fin;
  return finish(out, rate, { peak: 0.8, fadeMs: 10 });
}

/** Tape stop: a pulsing minor-7 chord + bass "on tape" whose speed (pitch, rhythm and brightness) winds down to zero. */
export function synthTapeStop(p: { seconds?: number; tune?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = Math.min(6, p.seconds ?? 1.2);
  const hold = Math.min(0.12, sec * 0.2);
  const k = semi(p.tune);
  const notes = [110, 220, 261.63, 329.63, 392].map((f) => f * k);
  const oscs = notes.map((_, j) => makeOsc("saw", rate, j * 0.31));
  const out = buf(sec, rate);
  const speeds = new Float32Array(out.length);
  let pos = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const speed = t < hold ? 1 : Math.pow(Math.max(0, 1 - (t - hold) / (sec - hold)), 1.6);
    speeds[i] = speed;
    pos += speed / rate;
    let v = 0;
    for (let j = 0; j < notes.length; j++) v += oscs[j]!(notes[j]! * speed) * (j === 0 ? 0.9 : 0.4);
    const frac = pos * 4 - Math.floor(pos * 4);
    out[i] = v * (0.55 + 0.45 * Math.exp(-frac * 6)) * (0.3 + 0.7 * Math.sqrt(speed));
  }
  svfSweep(out, rate, "lowpass", (i) => 250 + 6000 * speeds[i]!, 0.9);
  return finish(out, rate, { fadeMs: 20 });
}

/** Laser zap: FM + square buzz with an exponential pitch glide (default 3.2 kHz → 140 Hz). from < to = upward squeak. */
export function synthLaser(p: { seconds?: number; from?: number; to?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = Math.min(3, p.seconds ?? 0.35);
  const from = p.from ?? 3200, to = p.to ?? 140;
  const out = buf(sec, rate);
  const n = out.length;
  const sq = makeOsc("square", rate);
  let cph = 0, mph = 0;
  for (let i = 0; i < n; i++) {
    const prog = i / n;
    const f = from * Math.pow(to / from, Math.pow(prog, 0.6));
    cph += f / rate; mph += (f * 1.5) / rate;
    const index = 2.5 * (1 - prog);
    const env = Math.min(1, i / (rate * 0.002)) * Math.exp(-prog * 3);
    out[i] = (Math.sin(TWO_PI * cph + index * Math.sin(TWO_PI * mph)) + sq(f) * 0.3) * env;
  }
  biquad(out, rate, "highpass", 80, 0.7);
  return finish(out, rate, { fadeMs: 15 });
}

/** Siren: "wail" (slow up/down triangle sweep) or "dub" (saw-LFO "pew-pew" square with a feedback echo). */
export function synthSiren(p: { seconds?: number; kind?: "wail" | "dub"; tune?: number } = {}, rate = FACTORY_RATE): F32 {
  const kind = p.kind ?? "wail";
  const sec = Math.min(8, p.seconds ?? (kind === "wail" ? 3 : 2.5));
  const k = semi(p.tune);
  const out = buf(sec, rate);
  const n = out.length;
  if (kind === "wail") {
    const tri = makeOsc("triangle", rate), saw = makeOsc("saw", rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const f = (650 + 650 * (0.5 - 0.5 * Math.cos((TWO_PI * t) / 1.5))) * k;
      const env = Math.min(1, t / 0.05) * Math.min(1, (sec - t) / 0.15);
      out[i] = (tri(f) * 0.8 + saw(f) * 0.25) * env;
    }
    biquad(out, rate, "lowpass", 5000, 0.7);
  } else {
    const sq = makeOsc("square", rate);
    let lph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      lph += (4 + 4 * (t / sec)) / rate;
      const lfo = 1 - (lph - Math.floor(lph));
      const f = 520 * k * (1 + 0.6 * lfo);
      const env = Math.min(1, t / 0.01) * Math.min(1, (sec - t) / 0.15);
      out[i] = sq(f) * env * 0.6;
    }
    biquad(out, rate, "lowpass", 3500, 0.8);
    const d = Math.round(0.18 * rate);
    for (let i = d; i < n; i++) out[i]! += out[i - d]! * 0.45;
  }
  return finish(out, rate, { fadeMs: 20 });
}

/** Vinyl scratch approximation: a synthetic "ahh" record read back along cosine-eased back-and-forth hand strokes;
 * pitch and level follow platter speed. "chirp" closes the fader on the return strokes. */
export function synthScratch(p: { style?: "baby" | "chirp"; tune?: number; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const src = synthVocalChop({ vowel: "a", decay: 0.9, tune: p.tune ?? 0 }, rate);
  const rnd = mulberry32(p.seed ?? 347);
  const moves: Array<[number, number, number]> = [[0.11, 0.05, 0.3], [0.11, 0.3, 0.05], [0.09, 0.05, 0.25], [0.09, 0.25, 0.05], [0.16, 0.05, 0.45], [0.14, 0.45, 0.05]];
  const chirp = p.style === "chirp";
  let total = 0;
  for (const m of moves) total += m[0];
  const out = buf(total + 0.03, rate);
  let i0 = 0;
  for (const [dur, from, to] of moves) {
    const len = Math.round(dur * rate);
    const back = to < from;
    for (let j = 0; j < len && i0 + j < out.length; j++) {
      const u = j / len;
      const pos = from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      const speed = Math.abs((to - from) * 0.5 * Math.PI * Math.sin(Math.PI * u)) / dur;
      const sp = pos * rate;
      const a = Math.floor(sp), fr = sp - a;
      const s = (src[Math.min(src.length - 1, a)] ?? 0) * (1 - fr) + (src[Math.min(src.length - 1, a + 1)] ?? 0) * fr;
      let fader = 1;
      if (chirp) fader = back ? 0 : Math.min(1, (1 - u) / 0.1);
      const edge = Math.min(1, j / (rate * 0.003), (len - j) / (rate * 0.003));
      out[i0 + j] = (s * Math.min(1, speed * 1.2) + (rnd() * 2 - 1) * 0.02 * speed) * fader * edge;
    }
    i0 += len;
  }
  biquad(out, rate, "highpass", 150, 0.7);
  biquad(out, rate, "peak", 2000, 1, 3);
  return finish(out, rate);
}

/** Sub drop: sine gliding exponentially down (110 Hz → 32 Hz), gently saturated so it reads on small speakers. */
export function synthSubDrop(p: { seconds?: number; from?: number; to?: number; drive?: number } = {}, rate = FACTORY_RATE): F32 {
  const sec = Math.min(8, p.seconds ?? 1.8);
  const from = p.from ?? 110, to = p.to ?? 32;
  const out = buf(sec, rate);
  const n = out.length;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const prog = i / n;
    const f = from * Math.pow(to / from, Math.pow(prog, 0.7));
    ph += (TWO_PI * f) / rate;
    out[i] = Math.sin(ph) * Math.min(1, i / (rate * 0.005)) * Math.exp(-prog * 2.2);
  }
  softClip(out, 1.5 + (p.drive ?? 0.5) * 2);
  return finish(out, rate, { dcHz: 15, fadeMs: 40 });
}

// ───────────────────────────── stabs & hits ─────────────────────────────

/** Orchestral hit: brass-like detuned saw chord (root/5th/octaves/third) with a closing filter, string-noise attack,
 * timpani thump and a hall tail. */
export function synthOrchHit(p: { tune?: number; decay?: number; minor?: boolean; seed?: number } = {}, rate = FACTORY_RATE): F32 {
  const root = 130.81 * semi(p.tune);
  const decay = p.decay ?? 0.7;
  const rnd = mulberry32(p.seed ?? 353);
  const third = (p.minor ?? true) ? 2.378 : 2.52;
  const notes: Array<[number, number]> = [[1, 0.6], [1.5, 0.8], [2, 0.9], [third, 0.6], [3, 0.55], [4, 0.4]];
  const oscs = notes.flatMap((_, j) => [makeOsc("saw", rate, j * 0.13), makeOsc("saw", rate, j * 0.29)]);
  const out = buf(decay + 0.1, rate);
  const strings = buf(decay + 0.1, rate);
  let tph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.004) * Math.exp((-t * 5) / decay);
    let v = 0;
    for (let j = 0; j < notes.length; j++) {
      const [r, a] = notes[j]!;
      v += (oscs[2 * j]!(root * r * 1.0046) + oscs[2 * j + 1]!(root * r * 0.9954)) * a;
    }
    tph += (TWO_PI * 65 * semi(p.tune) * (1 + 0.5 * Math.exp(-t * 30))) / rate;
    out[i] = v * env * 0.25 + Math.sin(tph) * Math.exp((-t * 5) / 0.45) * 0.3;
    strings[i] = (rnd() * 2 - 1) * Math.exp(-t * 45);
  }
  svfSweep(out, rate, "lowpass", (i) => 1400 + 9000 * Math.exp((-i / rate) * 5), 0.9);
  biquad(strings, rate, "bandpass", 3000, 0.9);
  for (let i = 0; i < out.length; i++) out[i]! += strings[i]! * 0.35;
  softClip(out, 1.6);
  return finish(plateTail(out, rate, 1.4, 0.25), rate, { fadeMs: 30 });
}

const CHORDS: Record<"min7" | "maj7" | "min9" | "dom7", number[]> = {
  min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], min9: [0, 3, 7, 10, 14], dom7: [0, 4, 7, 10],
};

/** Chord stab (default minor 7th): detuned saw voices + root an octave down, plucky filter envelope, into reverb. */
export function synthChordStab(p: { root?: number; chord?: "min7" | "maj7" | "min9" | "dom7"; decay?: number; tone?: number; reverb?: number } = {}, rate = FACTORY_RATE): F32 {
  const root = p.root ?? 60;
  const decay = p.decay ?? 0.45;
  const tone = p.tone ?? 0.5;
  const ivs = CHORDS[p.chord ?? "min7"];
  const freqs = [midiHz(root - 12), ...ivs.map((iv) => midiHz(root + iv))];
  const oscs = freqs.flatMap((_, j) => [makeOsc("saw", rate, j * 0.17), makeOsc("saw", rate, j * 0.41)]);
  const out = buf(decay + 0.1, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.003) * Math.exp((-t * 5) / decay);
    let v = 0;
    for (let j = 0; j < freqs.length; j++) v += (oscs[2 * j]!(freqs[j]! * 1.004) + oscs[2 * j + 1]!(freqs[j]! * 0.996)) * (j === 0 ? 0.45 : 0.4);
    out[i] = v * env;
  }
  svfSweep(out, rate, "lowpass", (i) => 400 + (2500 + tone * 6000) * Math.exp((-i / rate) * 9), 1.2);
  const mix = p.reverb ?? 0.18;
  return finish(mix > 0 ? plateTail(out, rate, 1.0, mix) : out, rate, { fadeMs: 25 });
}
