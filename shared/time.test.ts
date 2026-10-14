import { describe, it, expect } from "vitest";
import {
  PPQ, TICKS_PER_STEP, ticksPerBar, ticksPerBeat, ticksToSeconds, secondsToTicks,
  ticksToBBST, bbstToTicks, formatPosition, snap, snapTicks, swungTick,
  euclideanPattern, midiToName, nameToMidi, inScale, SCALES, dbToGain, gainToDb,
} from "./time";

const S44 = { num: 4, den: 4 };
const S68 = { num: 6, den: 8 };

describe("musical time", () => {
  it("tick constants", () => {
    expect(PPQ).toBe(96);
    expect(TICKS_PER_STEP).toBe(24);
  });
  it("bar/beat sizes for 4/4 and 6/8", () => {
    expect(ticksPerBeat(S44)).toBe(96);
    expect(ticksPerBar(S44)).toBe(384);
    expect(ticksPerBeat(S68)).toBe(48);
    expect(ticksPerBar(S68)).toBe(288);
  });
  it("ticks <-> seconds round-trips at any BPM", () => {
    for (const bpm of [60, 90, 120, 174]) {
      expect(ticksToSeconds(PPQ, bpm)).toBeCloseTo(60 / bpm, 10);
      expect(secondsToTicks(ticksToSeconds(1234, bpm), bpm)).toBeCloseTo(1234, 6);
    }
  });
  it("BBST round-trip", () => {
    for (const t of [0, 1, 23, 24, 95, 96, 383, 384, 5000]) {
      const bbst = ticksToBBST(t, S44);
      expect(bbstToTicks(bbst, S44)).toBe(t);
    }
    expect(ticksToBBST(384 + 96 + 24 + 3, S44)).toEqual({ bar: 1, beat: 1, step: 1, tick: 3 });
  });
  it("position formatting is 1-based", () => {
    expect(formatPosition(0, S44)).toBe("1.1.1");
    expect(formatPosition(384, S44)).toBe("2.1.1");
  });
  it("snapping", () => {
    expect(snapTicks("bar", S44)).toBe(384);
    expect(snap(100, "beat", S44)).toBe(96);
    expect(snap(130, "step", S44)).toBe(120);
    expect(snap(130, "none", S44)).toBe(130);
  });
  it("swing delays only off-steps", () => {
    expect(swungTick(0, 0.5)).toBe(0);
    expect(swungTick(24, 0.5)).toBe(24 + 6);
    expect(swungTick(48, 0.5)).toBe(48);
    expect(swungTick(24, 0)).toBe(24);
  });
  it("euclidean patterns", () => {
    expect(euclideanPattern(8, 4).filter(Boolean)).toHaveLength(4);
    expect(euclideanPattern(16, 0).filter(Boolean)).toHaveLength(0);
    expect(euclideanPattern(8, 3).filter(Boolean)).toHaveLength(3);
    // classic tresillo spacing: gaps of 3,3,2 in some rotation
    const e = euclideanPattern(8, 3);
    const idx = e.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const gaps = idx.map((v, i) => ((idx[(i + 1) % idx.length]! - v) + 8) % 8).sort();
    expect(gaps).toEqual([2, 3, 3]);
  });
  it("midi note names", () => {
    expect(midiToName(60)).toBe("C4");
    expect(midiToName(69)).toBe("A4");
    expect(nameToMidi("C4")).toBe(60);
    expect(nameToMidi("A#3")).toBe(58);
    expect(nameToMidi("Bb3")).toBe(58);
    expect(nameToMidi("nope")).toBeNull();
  });
  it("scale membership", () => {
    expect(inScale(60, 0, SCALES.major!)).toBe(true); // C in C major
    expect(inScale(61, 0, SCALES.major!)).toBe(false); // C# not in C major
    expect(inScale(63, 0, SCALES.minor!)).toBe(true); // Eb in C minor
  });
  it("dB conversion", () => {
    expect(dbToGain(0)).toBeCloseTo(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(gainToDb(dbToGain(-12))).toBeCloseTo(-12, 8);
    expect(gainToDb(0)).toBe(-Infinity);
  });
});
