import { describe, it, expect } from "vitest";
import { strum, flam, roll, velocityRamp, snapToScale, nudge, scaleLength, invertPitches, retrograde, harmonize, removeOverlaps } from "./notetools";
import { SCALES } from "./time";
import type { Note } from "./project";

const note = (id: string, pitch: number, startTick: number, lengthTicks = 96, velocity = 0.8): Note =>
  ({ id, pitch, startTick, lengthTicks, velocity, pan: 0, probability: 1 });

// C major triad landing on the same tick
const chord = [note("a", 60, 0), note("b", 64, 0), note("c", 67, 0)];

describe("note tools", () => {
  it("strum offsets a chord upward in pitch order and keeps notes ending together", () => {
    const out = strum(chord, 12, "up");
    const starts = out.sort((a, b) => a.pitch - b.pitch).map((n) => n.startTick);
    expect(starts).toEqual([0, 12, 24]);
    for (const n of out) expect(n.startTick + n.lengthTicks).toBe(96); // tail stays aligned
  });

  it("strum down reverses the order", () => {
    const out = strum(chord, 12, "down").sort((a, b) => a.pitch - b.pitch);
    expect(out.map((n) => n.startTick)).toEqual([24, 12, 0]);
  });

  it("strum leaves single notes untouched", () => {
    expect(strum([note("x", 60, 48)], 12)).toEqual([note("x", 60, 48)]);
  });

  it("flam adds a quieter grace note before each, and never before tick 0", () => {
    const out = flam([note("x", 60, 48)], 8, 0.5);
    expect(out).toHaveLength(2);
    expect(out[0]!.startTick).toBe(40);
    expect(out[0]!.velocity).toBeCloseTo(0.4);
    const atZero = flam([note("y", 60, 0)], 8);
    expect(atZero).toHaveLength(1); // grace would be negative — skipped
  });

  it("roll subdivides a note into evenly spaced repeats that fit the original span", () => {
    const out = roll([note("x", 60, 0, 96)], 4);
    expect(out).toHaveLength(4);
    expect(out.map((n) => n.startTick)).toEqual([0, 24, 48, 72]);
    expect(out.every((n) => n.lengthTicks === 24)).toBe(true);
    expect(new Set(out.map((n) => n.id)).size).toBe(4); // unique ids
  });

  it("roll velocity curves ramp up and down", () => {
    const up = roll([note("x", 60, 0, 96, 1)], 4, "up");
    expect(up[0]!.velocity).toBeLessThan(up[3]!.velocity);
    const down = roll([note("x", 60, 0, 96, 1)], 4, "down");
    expect(down[0]!.velocity).toBeGreaterThan(down[3]!.velocity);
  });

  it("velocityRamp interpolates by time order", () => {
    const out = velocityRamp([note("a", 60, 0), note("b", 62, 96), note("c", 64, 192)], 0.2, 1);
    const byId = Object.fromEntries(out.map((n) => [n.id, n.velocity]));
    expect(byId.a).toBeCloseTo(0.2);
    expect(byId.b).toBeCloseTo(0.6);
    expect(byId.c).toBeCloseTo(1);
  });

  it("snapToScale pulls out-of-key notes into the scale and leaves in-key notes alone", () => {
    // C major: C#(61) is out of key, C(60) and E(64) are in key
    const out = snapToScale([note("a", 61, 0), note("b", 60, 0), note("c", 64, 0)], 0, SCALES["major"]!);
    const pitches = Object.fromEntries(out.map((n) => [n.id, n.pitch]));
    expect([60, 62]).toContain(pitches.a); // snapped to a neighbour in key
    expect(pitches.b).toBe(60);
    expect(pitches.c).toBe(64);
  });

  it("snapToScale output is always in the scale", () => {
    const allowed = new Set(SCALES["pentatonic minor"]!);
    const input = Array.from({ length: 12 }, (_, i) => note(`n${i}`, 60 + i, 0));
    for (const n of snapToScale(input, 9, SCALES["pentatonic minor"]!)) {
      expect(allowed.has((((n.pitch - 9) % 12) + 12) % 12)).toBe(true);
    }
  });

  it("nudge shifts time and clamps at zero", () => {
    expect(nudge([note("a", 60, 48)], -12)[0]!.startTick).toBe(36);
    expect(nudge([note("a", 60, 4)], -100)[0]!.startTick).toBe(0);
  });

  it("scaleLength shortens/lengthens but never goes below a floor", () => {
    expect(scaleLength([note("a", 60, 0, 96)], 0.5)[0]!.lengthTicks).toBe(48);
    expect(scaleLength([note("a", 60, 0, 4)], 0.01)[0]!.lengthTicks).toBeGreaterThanOrEqual(3);
  });

  it("invertPitches mirrors around the mean and is its own inverse", () => {
    const once = invertPitches(chord);
    const twice = invertPitches(once);
    expect(twice.map((n) => n.pitch).sort()).toEqual(chord.map((n) => n.pitch).sort());
  });

  it("retrograde reverses time within the same span", () => {
    const src = [note("a", 60, 0, 48), note("b", 62, 48, 48), note("c", 64, 96, 48)];
    const out = retrograde(src);
    const byId = Object.fromEntries(out.map((n) => [n.id, n.startTick]));
    expect(byId.a).toBe(96);
    expect(byId.c).toBe(0);
    expect(Math.min(...out.map((n) => n.startTick))).toBe(0);
  });

  it("harmonize keeps originals and adds a transposed layer", () => {
    const out = harmonize([note("a", 60, 0)], 7);
    expect(out).toHaveLength(2);
    expect(out.map((n) => n.pitch).sort((x, y) => x - y)).toEqual([60, 67]);
    expect(out[1]!.velocity).toBeLessThan(out[0]!.velocity);
  });

  it("removeOverlaps truncates same-pitch overlaps but not different pitches", () => {
    const out = removeOverlaps([note("a", 60, 0, 200), note("b", 60, 96, 96), note("c", 67, 0, 200)]);
    const byId = Object.fromEntries(out.map((n) => [n.id, n.lengthTicks]));
    expect(byId.a).toBe(96);   // clipped at the next same-pitch note
    expect(byId.c).toBe(200);  // different pitch, untouched
  });

  it("no transform mutates its input", () => {
    const src = [note("a", 60, 48, 96, 0.8)];
    const snapshot = JSON.stringify(src);
    strum(src, 12); flam(src); invertPitches(src); retrograde(src); removeOverlaps(src);
    roll(src, 3); velocityRamp(src, 0.1, 1); snapToScale(src, 0, SCALES["major"]!);
    nudge(src, 5); scaleLength(src, 2); harmonize(src, 4);
    expect(JSON.stringify(src)).toBe(snapshot);
  });
});
