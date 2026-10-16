import { describe, it, expect } from "vitest";
import { fillEnding, ghostNotes, shiftSteps, polyrhythm, accentEvery, thin, reverseSteps, ratchet, recordTap, nextRepeatTick, REPEAT_RATES } from "./patterntools";
import type { Step } from "./project";

const s = (index: number, velocity = 0.85): Step => ({ index, velocity, probability: 1, micro: 0 });

describe("pattern tools", () => {
  it("fillEnding only writes into the last N steps and stays in range", () => {
    const out = fillEnding(16, 4, 1, 3);
    expect(out.length).toBeGreaterThan(0);
    for (const st of out) {
      expect(st.index).toBeGreaterThanOrEqual(12);
      expect(st.index).toBeLessThan(16);
      expect(st.velocity).toBeGreaterThan(0);
      expect(st.velocity).toBeLessThanOrEqual(1);
    }
  });

  it("fillEnding is deterministic for a seed and varies across seeds", () => {
    expect(fillEnding(16, 6, 0.5, 42)).toEqual(fillEnding(16, 6, 0.5, 42));
    const a = JSON.stringify(fillEnding(16, 8, 0.5, 1));
    const b = JSON.stringify(fillEnding(16, 8, 0.5, 999));
    expect(a).not.toBe(b);
  });

  it("ghostNotes keeps every original step and only adds quiet off-downbeat hits", () => {
    const orig = [s(0), s(4), s(8)];
    const out = ghostNotes(orig, 16, 1, 5);
    for (const o of orig) expect(out).toContainEqual(o);
    const added = out.filter((x) => !orig.some((o) => o.index === x.index));
    expect(added.length).toBeGreaterThan(0);
    for (const g of added) {
      expect(g.index % 4).not.toBe(0);       // downbeats stay clear
      expect(g.velocity).toBeLessThan(0.5);  // ghosts are quiet
    }
    expect(new Set(out.map((x) => x.index)).size).toBe(out.length); // no duplicate slots
  });

  it("shiftSteps rotates and wraps without losing steps", () => {
    const out = shiftSteps([s(0), s(15)], 1, 16);
    expect(out.map((x) => x.index).sort((a, b) => a - b)).toEqual([0, 1]); // 15 wrapped to 0
    expect(out).toHaveLength(2);
    // full rotation is identity
    expect(shiftSteps([s(3), s(7)], 16, 16).map((x) => x.index)).toEqual([3, 7]);
    // negative shift wraps the other way
    expect(shiftSteps([s(0)], -1, 16)[0]!.index).toBe(15);
  });

  it("polyrhythm places hits every N steps against the grid", () => {
    expect(polyrhythm(16, 3).map((x) => x.index)).toEqual([0, 3, 6, 9, 12, 15]);
    expect(polyrhythm(16, 3, 1).map((x) => x.index)).toEqual([1, 4, 7, 10, 13]);
    expect(polyrhythm(8, 1)).toHaveLength(8);
  });

  it("accentEvery boosts only matching steps and clamps at 1", () => {
    const out = accentEvery([s(0, 0.5), s(2, 0.5), s(4, 0.95)], 4, 0.3);
    const byIdx = Object.fromEntries(out.map((x) => [x.index, x.velocity]));
    expect(byIdx[0]).toBeCloseTo(0.8);
    expect(byIdx[2]).toBeCloseTo(0.5);  // not on the accent grid
    expect(byIdx[4]).toBe(1);           // clamped
  });

  it("thin never removes downbeats", () => {
    const dense = Array.from({ length: 16 }, (_, i) => s(i));
    const out = thin(dense, 1, 2); // fraction 1 = drop everything droppable
    expect(out.map((x) => x.index)).toEqual([0, 4, 8, 12]);
  });

  it("reverseSteps mirrors within the pattern length", () => {
    expect(reverseSteps([s(0), s(15)], 16).map((x) => x.index)).toEqual([0, 15]);
    expect(reverseSteps([s(1)], 16)[0]!.index).toBe(14);
    // double reverse is identity
    expect(reverseSteps(reverseSteps([s(2), s(5)], 16), 16).map((x) => x.index)).toEqual([2, 5]);
  });

  it("ratchet replaces one step with descending-velocity sub-hits inside the slot", () => {
    const out = ratchet([s(0), s(4, 1)], 4, 3, 24);
    const hits = out.filter((x) => x.index === 4);
    expect(hits).toHaveLength(3);
    expect(hits[0]!.micro).toBe(0);
    expect(hits[1]!.micro).toBeGreaterThan(hits[0]!.micro);
    expect(hits[2]!.velocity).toBeLessThan(hits[0]!.velocity);
    expect(out.filter((x) => x.index === 0)).toHaveLength(1); // other steps untouched
    for (const h of hits) expect(Math.abs(h.micro)).toBeLessThanOrEqual(12); // within schema range
  });

  it("ratchet is a no-op for a missing step or count < 2", () => {
    const src = [s(0)];
    expect(ratchet(src, 9, 3)).toEqual(src);
    expect(ratchet(src, 0, 1)).toEqual(src);
  });
});

describe("live recording & note repeat", () => {
  it("snaps taps to the nearest 16th, wrapping around the loop", () => {
    let s = recordTap([], 25, 16, 0.9); // just after step 1
    expect(s).toEqual([{ index: 1, velocity: 0.9, probability: 1, micro: 0 }]);
    s = recordTap(s, 16 * 24 + 47, 16, 0.7); // second time round the loop, near step 2
    expect(s.map((x) => x.index)).toEqual([1, 2]);
    expect(recordTap([], 16 * 24 - 5, 16, 1)[0]!.index).toBe(0); // late tap at the loop end → downbeat
  });
  it("unquantized keeps the feel as micro-timing; overdubs never erase, louder wins", () => {
    expect(recordTap([], 30, 16, 0.8, false)[0]).toMatchObject({ index: 1, micro: 6 });
    expect(recordTap([], 16, 16, 0.8, false)[0]).toMatchObject({ index: 1, micro: -8 });
    const once = recordTap([], 0, 16, 0.5);
    expect(recordTap(once, 2, 16, 0.9)).toEqual([{ index: 0, velocity: 0.9, probability: 1, micro: 0 }]);
    expect(recordTap(once, 2, 16, 0.2)[0]!.velocity).toBe(0.5);
  });
  it("note repeat locks to the grid", () => {
    expect(nextRepeatTick(0, 24)).toBe(0);
    expect(nextRepeatTick(25, 24)).toBe(48);
    expect(nextRepeatTick(33, 32)).toBe(64);
    expect(REPEAT_RATES.map((r) => r.ticks)).toEqual([96, 48, 32, 24, 16, 12]);
  });
});
