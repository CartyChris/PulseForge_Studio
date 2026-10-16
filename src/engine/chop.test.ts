import { describe, it, expect } from "vitest";
import {
  varispeed, screw, rateToSemitones, chopRepeat, stutter, backspin, tapeStop, plateReverb, slowedReverb,
  vintageSampler, VINTAGE_PRESETS, timeStretch, pitchShift, fitPlan, parseKey, safePeak,
} from "./chop";

const SR = 22050;
const sine = (hz: number, sec: number, amp = 0.5) => {
  const d = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return d;
};
/** frequency from upward zero crossings over a region */
const freq = (d: Float32Array, from = 0, to = d.length) => {
  let n = 0, first = -1, last = -1;
  for (let i = Math.max(1, from); i < to; i++) if (d[i - 1]! < 0 && d[i]! >= 0) { n++; if (first < 0) first = i; last = i; }
  return n > 1 ? ((n - 1) * SR) / (last - first) : 0;
};
const finiteBounded = (cs: Float32Array[], lim = 1.0001) => cs.every((c) => c.every((v) => Number.isFinite(v) && Math.abs(v) <= lim));

describe("screw / varispeed", () => {
  it("0.8× makes it 25% longer and ~3.9 semitones lower, together (tape behaviour)", () => {
    const [out] = screw([sine(440, 1)], 0.8);
    expect(out!.length).toBe(Math.floor(SR / 0.8));
    expect(freq(out!)).toBeCloseTo(352, -0.5); // ±~3 Hz
    expect(rateToSemitones(0.8)).toBeCloseTo(-3.86, 2);
  });
  it("speeding up raises pitch and shortens; stays bounded", () => {
    const out = varispeed(sine(220, 1), 1.5);
    expect(out.length).toBe(Math.floor(SR / 1.5));
    expect(freq(out)).toBeCloseTo(330, -0.5);
    expect(finiteBounded([out])).toBe(true);
  });
});

describe("chops", () => {
  const ramp = () => Float32Array.from({ length: SR }, (_, i) => Math.sin(i / 50) * 0.5); // distinctive signal
  it("chopRepeat plays to the end of the phrase, repeats it N times, then continues — no clicks", () => {
    const d = ramp();
    const [out] = chopRepeat([d], SR, 0.25, 0.25, 2);
    const s = Math.round(0.25 * SR), len = Math.round(0.25 * SR);
    expect(out!.length).toBe(d.length + 2 * len);
    // after each crossfade (6 ms) the repeat is the original segment, sample for sample
    const fade = Math.round(0.006 * SR);
    for (const rep of [1, 2]) {
      const base = s + len * rep;
      for (let i = fade + 1; i < len; i += 97) expect(out![base + i]).toBeCloseTo(d[s + i]!, 5);
    }
    // the rest of the recording follows the last repeat
    expect(out![s + 3 * len + 10]).toBeCloseTo(d[s + len + 10]!, 5);
    // continuity: no sample-to-sample jump bigger than the source's own steepest slope ×3
    let maxSrc = 0, maxOut = 0;
    for (let i = 1; i < d.length; i++) maxSrc = Math.max(maxSrc, Math.abs(d[i]! - d[i - 1]!));
    for (let i = 1; i < out!.length; i++) maxOut = Math.max(maxOut, Math.abs(out![i]! - out![i - 1]!));
    expect(maxOut).toBeLessThan(maxSrc * 3);
  });
  it("stutter repeats a short slice with a decaying level", () => {
    const d = sine(300, 1);
    const [out] = stutter([d], SR, 0.5, 0.05, 4, 0.2);
    const len = Math.round(0.05 * SR), s = Math.round(0.5 * SR);
    expect(out!.length).toBe(s + 4 * len + (d.length - (s + len)));
    const rms = (a: number, b: number) => Math.sqrt(out!.slice(a, b).reduce((x, v) => x + v * v, 0) / (b - a));
    expect(rms(s + 3 * len, s + 4 * len)).toBeLessThan(rms(s, s + len));
    expect(finiteBounded([out!])).toBe(true);
  });
});

describe("backspin & tape stop", () => {
  it("backspin keeps everything before the spin and then plays backwards", () => {
    const up = Float32Array.from({ length: SR }, (_, i) => (i / SR) * 0.8); // rising ramp
    const [out] = backspin([up], SR, 0.5, 0.4, 3);
    const at = Math.round(0.5 * SR);
    expect(out!.length).toBe(at + Math.round(0.4 * SR));
    expect(out![at - 100]).toBeCloseTo(up[at - 100]!, 6);
    // reading backwards through a rising ramp → values fall during the spin
    expect(out![at + Math.round(0.25 * SR)]!).toBeLessThan(out![at + Math.round(0.02 * SR)]!);
  });
  it("tape stop: pitch falls over the tail", () => {
    const [out] = tapeStop([sine(440, 2)], SR, 0.5, 1.0);
    const at = Math.round(0.5 * SR), tail = SR;
    expect(out!.length).toBe(at + tail);
    const early = freq(out!, at, at + tail * 0.15), later = freq(out!, at + tail * 0.5, at + tail * 0.7);
    expect(early).toBeGreaterThan(300);
    expect(later).toBeLessThan(early * 0.6);
  });
});

describe("reverb & slowed+reverb", () => {
  it("reverb rings after the input stops; slowed+reverb is slower, lower and never clips", () => {
    const imp = new Float32Array(SR / 4); imp[10] = 0.9;
    const [wet] = plateReverb([imp], SR, { tailSec: 1.5, mix: 0.5 });
    const tailEnergy = wet!.slice(imp.length + SR * 0.2, imp.length + SR * 0.6).reduce((a, v) => a + v * v, 0);
    expect(tailEnergy).toBeGreaterThan(1e-6);
    const loud = sine(440, 1, 0.95);
    const out = slowedReverb([loud, loud.slice()], SR, 0.85, 0.4);
    expect(out[0]!.length).toBeGreaterThan(SR / 0.85);
    expect(freq(out[0]!, 0, SR / 2)).toBeLessThan(400);
    expect(finiteBounded(out, 0.9801)).toBe(true);
  });
});

describe("vintage samplers", () => {
  it("bit depth and sample-and-hold rate are really applied", () => {
    const d = sine(97, 0.5, 0.7);
    const [out] = vintageSampler([d], SR, { rate: SR / 2, bits: 8, lowpass: 0, highpass: 0, drive: 0, noise: 0, wowCents: 0, flutterCents: 0, mono: false });
    for (let i = 0; i < out!.length; i += 37) expect(Math.abs(out![i]! * 128 - Math.round(out![i]! * 128))).toBeLessThan(1e-4); // 8-bit grid
    for (let i = 0; i + 1 < out!.length; i += 2) expect(out![i + 1]).toBe(out![i]); // held for 2 samples
  });
  it("every preset: same length, finite, under the ceiling, deterministic; 78 rpm is mono", () => {
    const l = sine(330, 0.6, 0.9), r = sine(495, 0.6, 0.9);
    for (const [id, p] of Object.entries(VINTAGE_PRESETS)) {
      const a = vintageSampler([l, r], SR, p.o, 3), b = vintageSampler([l, r], SR, p.o, 3);
      expect(a[0]!.length, id).toBe(l.length);
      expect(finiteBounded(a, 0.9801), id).toBe(true);
      expect(a[0]!.slice(0, 500)).toEqual(b[0]!.slice(0, 500));
    }
    const shellac = vintageSampler([l, r], SR, VINTAGE_PRESETS["78rpm"]!.o);
    expect(shellac[0]).toEqual(shellac[1]);
  });
});

describe("time-stretch & pitch-shift", () => {
  it("stretch changes length but keeps pitch", () => {
    for (const f of [0.7, 1.5]) {
      const [out] = timeStretch([sine(440, 1)], SR, f);
      expect(out!.length).toBe(Math.round(SR * f));
      expect(freq(out!, 2000, out!.length - 2000) / 440).toBeGreaterThan(0.97);
      expect(freq(out!, 2000, out!.length - 2000) / 440).toBeLessThan(1.03);
    }
  });
  it("pitch-shift changes pitch but keeps length", () => {
    const [up] = pitchShift([sine(440, 1)], SR, 3);
    expect(up!.length).toBe(SR);
    expect(freq(up!, 2000, SR - 3000) / (440 * 2 ** (3 / 12))).toBeGreaterThan(0.97);
    expect(freq(up!, 2000, SR - 3000) / (440 * 2 ** (3 / 12))).toBeLessThan(1.03);
  });
});

describe("fit to project", () => {
  it("chooses half/double time to stretch least, and the smallest move into key", () => {
    expect(fitPlan(180, 90, null, null)).toMatchObject({ stretch: 1, matchedBpm: 90, semitones: 0 });
    expect(fitPlan(95, 90, null, null).stretch).toBeCloseTo(95 / 90, 6);
    expect(fitPlan(null, 90, "A minor", "C major").semitones).toBe(0); // relative keys
    expect(fitPlan(null, 90, "C minor", "D minor").semitones).toBe(2);
    expect(fitPlan(null, 90, "B", "C").semitones).toBe(1);
    expect(fitPlan(null, 90, "F#", "C").semitones).toBe(-6);
    expect(fitPlan(null, 90, null, "C").note).toMatch(/nothing to change/);
  });
  it("parses key spellings", () => {
    expect(parseKey("Am")).toEqual({ pc: 9, minor: true });
    expect(parseKey("F# major")).toEqual({ pc: 6, minor: false });
    expect(parseKey("Eb minor")).toEqual({ pc: 3, minor: true });
    expect(parseKey("c#m")).toEqual({ pc: 1, minor: true });
    expect(parseKey("H")).toBeNull();
  });
  it("safePeak only ever turns down", () => {
    const quiet = [Float32Array.from([0.1, -0.2])];
    expect(safePeak(quiet)).toBe(quiet);
    expect(Math.max(...safePeak([Float32Array.from([1.5, -2])])[0]!.map(Math.abs))).toBeCloseTo(0.98, 6);
  });
});
