/**
 * Sampling & "chopped and screwed" DSP — pure functions over Float32Array channels, so every one
 * is unit-tested in Node and runs the same in the browser. Nothing here touches the audio context.
 *
 *   screw / varispeed   tape-style slow-down: slower AND lower together (DJ Screw, "slowed")
 *   chopRepeat          the DJ Screw "chop": cut back and repeat a phrase/beat, click-free
 *   stutter             rapid repeats of a short slice (1/16 or 1/32 "buzz")
 *   backspin            record pulled backwards, decelerating to a stop
 *   tapeStop            the deck losing power: pitch and speed fall to zero
 *   plateReverb         Schroeder/Freeverb-style reverb (used by "slowed + reverb")
 *   vintageSampler      SP-1200 / MPC60 / SP-404 vinyl / cassette / 78 rpm emulations
 *   timeStretch         WSOLA: change length, keep pitch
 *   pitchShift          change pitch, keep length (stretch + varispeed)
 *   fitPlan             how to stretch/transpose a sample to a project's BPM and key
 */
import { mulberry32, biquad, synthVinylCrackle } from "./dsp";

export type F32 = Float32Array;
export type Chans = F32[];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 4-point Hermite interpolation at fractional index `pos` (0 outside the buffer). */
export function readAt(d: F32, pos: number): number {
  const i = Math.floor(pos);
  const f = pos - i;
  const xm1 = d[i - 1] ?? 0, x0 = d[i] ?? 0, x1 = d[i + 1] ?? 0, x2 = d[i + 2] ?? 0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/** Scale down only if anything would clip; never boosts. */
export function safePeak(chans: Chans, ceiling = 0.98): Chans {
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]!); if (a > peak) peak = a; }
  if (peak <= ceiling || peak === 0) return chans;
  const g = ceiling / peak;
  return chans.map((c) => c.map((v) => v * g));
}

// ---------------------------------------------------------------------------------------------
// 1. screw / varispeed
// ---------------------------------------------------------------------------------------------
/** Play back at `rate` (0.5 = half speed, an octave down). Output length = input / rate. */
export function varispeed(d: F32, rate: number): F32 {
  const r = clamp(rate, 0.25, 4);
  const n = Math.max(1, Math.floor(d.length / r));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = readAt(d, i * r);
  return out;
}

/** "Screw" a recording: tape slow-down, both channels. 0.8 ≈ −3.9 semitones, the classic Houston feel. */
export function screw(chans: Chans, rate = 0.8): Chans {
  return chans.map((c) => varispeed(c, rate));
}

/** Semitones a varispeed rate moves the pitch (0.8 → −3.86). */
export const rateToSemitones = (rate: number) => 12 * Math.log2(rate);
export const semitonesToRate = (st: number) => 2 ** (st / 12);

// ---------------------------------------------------------------------------------------------
// 2. chops
// ---------------------------------------------------------------------------------------------
function equalPowerJoin(out: F32, at: number, tail: F32, fade: number): void {
  // crossfade `tail` (the audio that would have continued) into out[at…] which already holds the new audio
  for (let i = 0; i < fade && at + i < out.length; i++) {
    const t = (i + 0.5) / fade;
    out[at + i] = out[at + i]! * Math.sin((t * Math.PI) / 2) + (tail[i] ?? 0) * Math.cos((t * Math.PI) / 2);
  }
}

/**
 * The DJ Screw "chop": play up to the end of a phrase, cut back to its start and repeat it.
 * Output = audio up to (start + len), then the [start, start+len) segment `repeats` more times,
 * then the rest of the recording. Every jump is crossfaded (default 6 ms) so it never clicks.
 */
export function chopRepeat(chans: Chans, sampleRate: number, startSec: number, lenSec: number, repeats = 1, fadeSec = 0.006): Chans {
  return chans.map((d) => {
    const s = clamp(Math.round(startSec * sampleRate), 0, d.length);
    const len = clamp(Math.round(lenSec * sampleRate), 1, d.length - s);
    const reps = clamp(Math.round(repeats), 0, 64);
    const fade = Math.max(1, Math.min(Math.round(fadeSec * sampleRate), Math.floor(len / 4)));
    const out = new Float32Array(d.length + len * reps);
    out.set(d.subarray(0, s + len), 0);
    let w = s + len;
    for (let r = 0; r < reps; r++) {
      out.set(d.subarray(s, s + len), w);
      equalPowerJoin(out, w, d.subarray(s + len, s + len + fade), fade);
      w += len;
    }
    out.set(d.subarray(s + len), w); // the last repeat ends exactly where the recording continues
    return out;
  });
}

/**
 * Stutter: repeat a short slice `count` times starting at `startSec` (e.g. 1/16 or 1/32 notes),
 * optionally fading each repeat down for a decaying "buzz", then continue from after the slice.
 */
export function stutter(chans: Chans, sampleRate: number, startSec: number, sliceSec: number, count = 4, decay = 0.15): Chans {
  return chans.map((d) => {
    const s = clamp(Math.round(startSec * sampleRate), 0, d.length);
    const len = clamp(Math.round(sliceSec * sampleRate), 16, Math.max(16, d.length - s));
    const cnt = clamp(Math.round(count), 1, 64);
    const fade = Math.max(8, Math.min(Math.round(0.003 * sampleRate), Math.floor(len / 4)));
    const out = new Float32Array(s + len * cnt + Math.max(0, d.length - (s + len)));
    out.set(d.subarray(0, s), 0);
    for (let r = 0; r < cnt; r++) {
      const g = Math.max(0.05, 1 - decay * r);
      const base = s + r * len;
      for (let i = 0; i < len; i++) {
        const env = i < fade ? i / fade : i > len - fade ? (len - i) / fade : 1; // per-repeat micro fades
        out[base + i] = (d[s + i] ?? 0) * g * env;
      }
    }
    out.set(d.subarray(s + len), s + len * cnt);
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// 3–4. backspin, tape stop (variable-rate playback)
// ---------------------------------------------------------------------------------------------
/** Read `d` with a time-varying speed: speed(t∈[0,1]) in "x realtime", starting at `startPos` samples. */
function variableRead(d: F32, startPos: number, outLen: number, speed: (t: number) => number): F32 {
  const out = new Float32Array(outLen);
  let pos = startPos;
  for (let i = 0; i < outLen; i++) {
    out[i] = pos >= 0 && pos < d.length ? readAt(d, pos) : 0;
    pos += speed(i / outLen);
  }
  return out;
}

/**
 * Backspin / rewind at `atSec`: audio plays normally up to there, then the "record" is spun backwards
 * — starting at `maxSpeed`× reverse and decelerating to a stop over `seconds`. Output ends there
 * (drop the beat back in after it on the timeline).
 */
export function backspin(chans: Chans, sampleRate: number, atSec: number, seconds = 0.9, maxSpeed = 3): Chans {
  return chans.map((d) => {
    const at = clamp(Math.round(atSec * sampleRate), 0, d.length);
    const tail = Math.max(1, Math.round(seconds * sampleRate));
    const spin = variableRead(d, at, tail, (t) => -maxSpeed * (1 - t) ** 1.5);
    const out = new Float32Array(at + tail);
    out.set(d.subarray(0, at), 0);
    // short crossfade into the spin, and a fade-out at the very end
    const fade = Math.min(Math.round(0.004 * sampleRate), tail);
    for (let i = 0; i < tail; i++) {
      const fin = i < fade ? i / fade : 1;
      const fout = i > tail - fade ? (tail - i) / fade : 1;
      out[at + i] = spin[i]! * fin * fout + (i < fade ? (d[at + i] ?? 0) * (1 - i / fade) : 0);
    }
    return out;
  });
}

/** Tape stop at `atSec`: speed (and pitch) falls from 1× to 0 over `seconds`, curved like a motor. */
export function tapeStop(chans: Chans, sampleRate: number, atSec: number, seconds = 1.2, curve = 1.6): Chans {
  return chans.map((d) => {
    const at = clamp(Math.round(atSec * sampleRate), 0, d.length);
    const tail = Math.max(1, Math.round(seconds * sampleRate));
    const slow = variableRead(d, at, tail, (t) => (1 - t) ** curve);
    const out = new Float32Array(at + tail);
    out.set(d.subarray(0, at), 0);
    const fade = Math.min(Math.round(0.01 * sampleRate), tail);
    for (let i = 0; i < tail; i++) out[at + i] = slow[i]! * (i > tail - fade ? (tail - i) / fade : 1);
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// 5. reverb + "slowed and reverb"
// ---------------------------------------------------------------------------------------------
/** Freeverb-style reverb (8 damped combs + 4 allpasses per channel). Output = input length + tail. */
export function plateReverb(chans: Chans, sampleRate: number, opts: { decay?: number; mix?: number; damp?: number; preDelaySec?: number; tailSec?: number } = {}): Chans {
  const decay = clamp(opts.decay ?? 0.84, 0, 0.98);
  const mix = clamp(opts.mix ?? 0.3, 0, 1);
  const damp = clamp(opts.damp ?? 0.35, 0, 0.95);
  const scale = sampleRate / 44100;
  const tail = Math.round((opts.tailSec ?? 2.5) * sampleRate);
  const pre = Math.round((opts.preDelaySec ?? 0.02) * sampleRate);
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  return chans.map((d, ch) => {
    const spread = ch * 23; // decorrelate L/R
    const n = d.length + tail;
    const wet = new Float32Array(n);
    const combs = combT.map((t) => ({ buf: new Float32Array(Math.round((t + spread) * scale)), i: 0, store: 0 }));
    const aps = apT.map((t) => ({ buf: new Float32Array(Math.round((t + spread) * scale)), i: 0 }));
    for (let k = 0; k < n; k++) {
      const x = (k - pre >= 0 && k - pre < d.length ? d[k - pre]! : 0) * 0.015;
      let y = 0;
      for (const c of combs) {
        const o = c.buf[c.i]!;
        c.store = o * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * decay;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of aps) {
        const b = a.buf[a.i]!;
        a.buf[a.i] = y + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = b - y;
      }
      wet[k] = y;
    }
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = (k < d.length ? d[k]! * (1 - mix * 0.5) : 0) + wet[k]! * mix * 3;
    return out;
  });
}

/** The "slowed + reverb" sound: screw, soften the top end, wash it in a big room. */
export function slowedReverb(chans: Chans, sampleRate: number, rate = 0.85, mix = 0.35): Chans {
  const slowed = screw(chans, rate).map((c) => biquad(c, sampleRate, "lowpass", 9000, 0.6));
  return safePeak(plateReverb(slowed, sampleRate, { decay: 0.88, mix, damp: 0.4, preDelaySec: 0.03, tailSec: 3 }));
}

// ---------------------------------------------------------------------------------------------
// 6. vintage sampler emulations
// ---------------------------------------------------------------------------------------------
export interface VintageOptions {
  /** sample-and-hold rate in Hz (aliasing included, like the real hardware) — 0 = off */
  rate: number;
  /** quantization bits — 0 = off */
  bits: number;
  /** output low-pass in Hz (the machine's filter) — 0 = off */
  lowpass: number;
  /** high-pass in Hz (small speakers / shellac) — 0 = off */
  highpass: number;
  /** tanh drive amount 0…1 */
  drive: number;
  /** vinyl crackle/hiss level 0…1 */
  noise: number;
  /** wow depth in semitone cents (slow pitch drift) */
  wowCents: number;
  /** flutter depth in cents (fast wobble) */
  flutterCents: number;
  /** sum to mono (old records) */
  mono: boolean;
}

export const VINTAGE_PRESETS: Record<string, { name: string; blurb: string; o: VintageOptions }> = {
  "sp-1200": { name: "SP-1200", blurb: "12-bit, 26 kHz, unfiltered: the gritty boom bap crunch", o: { rate: 26040, bits: 12, lowpass: 0, highpass: 0, drive: 0.15, noise: 0, wowCents: 0, flutterCents: 0, mono: false } },
  mpc60: { name: "MPC60", blurb: "12-bit, 40 kHz, warm low-pass: smooth swing-era punch", o: { rate: 40000, bits: 12, lowpass: 15000, highpass: 0, drive: 0.25, noise: 0, wowCents: 0, flutterCents: 0, mono: false } },
  "sp-404-vinyl": { name: "SP-404 Vinyl Sim", blurb: "Lo-fi hip-hop staple: crackle, hiss, rolled-off highs", o: { rate: 0, bits: 0, lowpass: 8500, highpass: 60, drive: 0.3, noise: 0.35, wowCents: 6, flutterCents: 0, mono: false } },
  cassette: { name: "Cassette", blurb: "Tape wow & flutter, hiss, soft saturation", o: { rate: 0, bits: 0, lowpass: 11000, highpass: 40, drive: 0.4, noise: 0.18, wowCents: 14, flutterCents: 5, mono: false } },
  "78rpm": { name: "78 RPM Shellac", blurb: "1930s record: narrow band, heavy crackle, mono", o: { rate: 0, bits: 0, lowpass: 4200, highpass: 280, drive: 0.35, noise: 0.7, wowCents: 10, flutterCents: 0, mono: true } },
  "8-bit": { name: "8-bit Crush", blurb: "Video-game grit: 8 bits at 11 kHz", o: { rate: 11025, bits: 8, lowpass: 0, highpass: 0, drive: 0.1, noise: 0, wowCents: 0, flutterCents: 0, mono: false } },
};

/** Apply a vintage-sampler character. Deterministic (seeded noise). */
export function vintageSampler(chans: Chans, sampleRate: number, o: VintageOptions, seed = 7): Chans {
  let work: F32[] = o.mono && chans.length > 1
    ? [chans[0]!.map((v, i) => (v + chans[1]![i]!) * 0.5)]
    : chans.map((c) => c.slice());
  // wow & flutter: modulated read position (pitch wobble), same curve on both channels
  if (o.wowCents > 0 || o.flutterCents > 0) {
    const wow = (2 ** (o.wowCents / 1200) - 1), flut = (2 ** (o.flutterCents / 1200) - 1);
    work = work.map((d) => {
      const out = new Float32Array(d.length);
      let pos = 0;
      for (let i = 0; i < d.length; i++) {
        out[i] = readAt(d, Math.min(pos, d.length - 1));
        const t = i / sampleRate;
        pos += 1 + wow * Math.sin(2 * Math.PI * 0.55 * t) + flut * Math.sin(2 * Math.PI * 7.3 * t);
      }
      return out;
    });
  }
  if (o.highpass > 0) work = work.map((d) => biquad(d, sampleRate, "highpass", o.highpass, 0.7));
  // sample-and-hold at the machine's rate (keeps the aliasing that defines the SP-1200 sound)
  if (o.rate > 0 && o.rate < sampleRate) {
    const step = sampleRate / o.rate;
    work = work.map((d) => {
      const out = new Float32Array(d.length);
      let next = 0, held = 0;
      for (let i = 0; i < d.length; i++) {
        if (i >= next) { held = d[i]!; next += step; }
        out[i] = held;
      }
      return out;
    });
  }
  if (o.bits > 0 && o.bits < 24) {
    const q = 2 ** (o.bits - 1);
    work = work.map((d) => d.map((v) => Math.round(clamp(v, -1, 1) * q) / q));
  }
  if (o.drive > 0) {
    const k = 1 + o.drive * 4;
    const norm = Math.tanh(k);
    work = work.map((d) => d.map((v) => Math.tanh(v * k) / norm));
  }
  if (o.lowpass > 0) work = work.map((d) => biquad(biquad(d, sampleRate, "lowpass", o.lowpass, 0.6), sampleRate, "lowpass", o.lowpass, 0.6));
  if (o.noise > 0) {
    const len = work[0]!.length;
    const crackle = synthVinylCrackle({ seconds: len / sampleRate + 0.05, density: 0.3 + o.noise, hiss: o.noise * 0.6, seed }, sampleRate);
    const rng = mulberry32(seed + 1);
    work = work.map((d, ch) => {
      const off = ch * 977; // decorrelate channels
      return d.map((v, i) => v + (crackle[(i + off) % crackle.length] ?? 0) * o.noise * 0.6 + (rng() * 2 - 1) * o.noise * 0.004);
    });
  }
  if (o.mono && chans.length > 1) work = [work[0]!, work[0]!.slice()];
  return safePeak(work);
}

// ---------------------------------------------------------------------------------------------
// 7. time-stretch, pitch-shift, fit-to-project
// ---------------------------------------------------------------------------------------------
/**
 * WSOLA time-stretch: output length ≈ input × `factor`, pitch unchanged. Frames are aligned by
 * cross-correlation on the mono mix and the same offsets are applied to every channel, so stereo
 * stays phase-coherent.
 */
export function timeStretch(chans: Chans, sampleRate: number, factor: number): Chans {
  const f = clamp(factor, 0.25, 4);
  const N = 2 * Math.round((sampleRate * 0.046) / 2); // ~46 ms frames
  const Hs = N / 2; // synthesis hop
  const Ha = Hs / f; // nominal analysis hop
  const tol = Math.round(N / 4); // search ±11 ms
  const n = chans[0]!.length;
  const mono = chans.length > 1 ? chans[0]!.map((v, i) => (v + chans[1]![i]!) * 0.5) : chans[0]!;
  const outLen = Math.max(1, Math.round(n * f));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outs = chans.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  let prevA = 0; // analysis position actually used for the previous frame
  const frames = Math.ceil(outLen / Hs) + 1;
  for (let k = 0; k < frames; k++) {
    const s = k * Hs;
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // find the offset whose start best continues the previous frame's natural continuation
      const natural = prevA + Hs;
      let bestScore = -Infinity;
      for (let dlt = -tol; dlt <= tol; dlt += 2) {
        const cand = nominal + dlt;
        if (cand < 0 || cand + Hs >= n) continue;
        let score = 0;
        for (let i = 0; i < Hs; i += 4) score += (mono[natural + i] ?? 0) * (mono[cand + i] ?? 0);
        if (score > bestScore) { bestScore = score; best = cand; }
      }
    }
    best = clamp(best, 0, Math.max(0, n - 1));
    prevA = best;
    for (let i = 0; i < N; i++) {
      const o = s + i;
      if (o >= outLen + N) break;
      norm[o] = norm[o]! + win[i]!;
      for (let c = 0; c < chans.length; c++) { const buf = outs[c]!; buf[o] = buf[o]! + (chans[c]![best + i] ?? 0) * win[i]!; }
    }
  }
  return outs.map((buf) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = norm[i]! > 1e-3 ? buf[i]! / norm[i]! : buf[i]!;
    return out;
  });
}

/** Shift pitch by `semitones`, keep the length (stretch by the ratio, then varispeed back). */
export function pitchShift(chans: Chans, sampleRate: number, semitones: number): Chans {
  if (Math.abs(semitones) < 1e-3) return chans.map((c) => c.slice());
  const ratio = semitonesToRate(semitones);
  const stretched = timeStretch(chans, sampleRate, ratio);
  const n = chans[0]!.length;
  return stretched.map((c) => {
    const v = varispeed(c, ratio);
    const out = new Float32Array(n);
    out.set(v.subarray(0, n));
    return out;
  });
}

const PCS: Record<string, number> = { C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11 };

/** Parse "A minor", "F# maj", "Eb", "c#m" → { pc, minor }. */
export function parseKey(raw: string | null | undefined): { pc: number; minor: boolean } | null {
  if (!raw) return null;
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(m(?!aj)|min(or)?|maj(or)?)?/i.exec(raw);
  if (!m) return null;
  const name = (m[1]! + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2] ?? "")).toUpperCase();
  const pc = PCS[name];
  if (pc === undefined) return null;
  const mode = (m[3] ?? "").toLowerCase();
  const minor = mode.startsWith("m") && !mode.startsWith("maj") || /\bminor\b/i.test(raw);
  return { pc, minor };
}

export interface FitPlan {
  /** length factor for timeStretch (sampleBpm/projectBpm, after half/double-time choice) */
  stretch: number;
  /** semitones for pitchShift (−6…+5, smallest move into the project key) */
  semitones: number;
  /** the sample tempo actually matched (may be half/double the estimate) */
  matchedBpm: number | null;
  note: string;
}

/**
 * How to make a sample fit the project: choose the half/double-time reading of the sample's tempo
 * that needs the least stretching, and the smallest transposition into the project key (relative
 * major/minor counts as the same key: A minor ↔ C major is 0 semitones).
 */
export function fitPlan(sampleBpm: number | null, projectBpm: number, sampleKey: string | null, projectKey: string | null): FitPlan {
  let stretch = 1, matchedBpm: number | null = null;
  const notes: string[] = [];
  if (sampleBpm && sampleBpm > 0 && projectBpm > 0) {
    const candidates = [sampleBpm, sampleBpm / 2, sampleBpm * 2];
    matchedBpm = candidates.reduce((a, b) => (Math.abs(Math.log(b / projectBpm)) < Math.abs(Math.log(a / projectBpm)) ? b : a));
    stretch = matchedBpm / projectBpm;
    notes.push(`tempo ${Math.round(matchedBpm)} → ${projectBpm} BPM (×${stretch.toFixed(3)} length)`);
  }
  let semitones = 0;
  const sk = parseKey(sampleKey), pk = parseKey(projectKey);
  if (sk && pk) {
    // compare tonics of the same mode: move a minor key to its relative major first
    const toMajor = (k: { pc: number; minor: boolean }) => (k.minor ? (k.pc + 3) % 12 : k.pc);
    let d = (toMajor(pk) - toMajor(sk) + 12) % 12;
    if (d > 6) d -= 12;
    if (d === 6) d = -6;
    semitones = d;
    notes.push(semitones === 0 ? "already in key" : `transpose ${semitones > 0 ? "+" : ""}${semitones} st into ${projectKey}`);
  }
  return { stretch, semitones, matchedBpm, note: notes.join(" · ") || "no tempo/key estimate — nothing to change" };
}
