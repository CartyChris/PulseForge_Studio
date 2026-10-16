import { describe, it, expect } from "vitest";
import { chopsFromMarkers, autoChopPoints, chopPattern, flipChops, lengthFor, MAX_PADS } from "./chops";

describe("chops", () => {
  it("markers → contiguous chops; slivers fold into the previous chop", () => {
    const c = chopsFromMarkers([1.5, 0.5, 1.51, 3], 2);
    expect(c).toEqual([{ startSec: 0, endSec: 0.5 }, { startSec: 0.5, endSec: 1.51 }, { startSec: 1.51, endSec: 2 }]);
    expect(c[0]!.startSec).toBe(0);
    expect(c.at(-1)!.endSec).toBe(2);
  });
  it("auto-chop snaps equal divisions to nearby transients, capped at 16 pads", () => {
    expect(autoChopPoints([0.98, 2.03, 2.95], 4, 4)).toEqual([0.98, 2.03, 2.95]);
    expect(autoChopPoints([2.9], 4, 4)).toContain(3); // 0.1 s away is outside the 0.08 s window: keep the exact cut
    expect(autoChopPoints([], 4, 4)).toEqual([1, 2, 3]); // nothing near → exact divisions
    expect(autoChopPoints([], 8, 64)).toHaveLength(MAX_PADS - 1);
  });
  it("the pattern recreates the sample: chops in order at their original positions", () => {
    // 90 BPM: one 16th = 1/6 s. A 2-bar loop chopped into 8 equal pieces = one chop every 4 steps
    const dur = 32 / 6;
    const chops = chopsFromMarkers(autoChopPoints([], dur, 8), dur);
    const p = chopPattern(chops, 90);
    expect(p.lengthSteps).toBe(32);
    expect(p.hits.map((h) => h.chop)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(p.hits.map((h) => h.step)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(lengthFor(dur, 90)).toBe(32);
    expect(lengthFor(0.2, 90)).toBe(16);
  });
  it("flips: deterministic, anchored, always valid", () => {
    const p = chopPattern(chopsFromMarkers(autoChopPoints([], 32 / 6, 8), 32 / 6), 90);
    for (const style of ["flip", "reverse", "stutter", "halftime"] as const) {
      const a = flipChops(p, 8, style, 42), b = flipChops(p, 8, style, 42);
      expect(a, style).toEqual(b);
      for (const h of a.hits) {
        expect(h.chop).toBeGreaterThanOrEqual(0);
        expect(h.chop).toBeLessThan(8);
        expect(h.step).toBeLessThan(a.lengthSteps);
      }
    }
    const flip = flipChops(p, 8, "flip", 7);
    expect(flip.hits.filter((h) => h.step % 16 === 0).every((h) => h.chop === 0)).toBe(true); // chop 1 on every downbeat
    expect(flipChops(p, 8, "flip", 7)).not.toEqual(flipChops(p, 8, "flip", 8));
    expect(flipChops(p, 8, "reverse", 1).hits.map((h) => h.chop)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(flipChops(p, 8, "halftime", 1).lengthSteps).toBe(64);
    expect(flipChops(p, 8, "stutter", 3).hits.length).toBeGreaterThan(p.hits.length);
  });
});
