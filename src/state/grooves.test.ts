import { describe, it, expect } from "vitest";
import { GROOVES, GROOVE_CATEGORIES, grooveToSteps, gridSteps } from "../../shared/grooves";
import { DRUM_ROLES } from "../../shared/composition";
import { DRUM_KITS } from "../engine/kits";

describe("groove library", () => {
  it("60+ grooves, unique ids, every category used at least twice", () => {
    expect(GROOVES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(GROOVES.map((g) => g.id)).size).toBe(GROOVES.length);
    for (const c of GROOVE_CATEGORIES) expect(GROOVES.filter((g) => g.category === c).length, c).toBeGreaterThanOrEqual(2);
  });
  it("every row is a real kit role with a valid 1- or 2-bar grid, on a kit that has that role", () => {
    for (const g of GROOVES) {
      const kit = DRUM_KITS.find((k) => k.id === g.kit);
      expect(kit, `${g.id} kit ${g.kit}`).toBeDefined();
      expect(g.bpm).toBeGreaterThanOrEqual(50);
      expect(g.swing).toBeLessThanOrEqual(0.75);
      for (const [role, grid] of Object.entries(g.rows)) {
        expect(DRUM_ROLES as readonly string[], `${g.id}.${role}`).toContain(role);
        expect(grid, `${g.id}.${role}`).toMatch(/^[xXogrR.|]+$/);
        expect([16, 32], `${g.id}.${role} length`).toContain(gridSteps(grid!));
        expect(kit!.sounds.some((s) => s.role === role), `${g.kit} lacks ${role}`).toBe(true);
      }
      expect(Object.keys(g.rows).length, g.id).toBeGreaterThanOrEqual(2);
    }
  });
  it("grooveToSteps: 2-bar grooves grow a 1-bar pattern; hits land where the grid says", () => {
    const bb = GROOVES.find((g) => g.id === "bb-classic")!;
    const { lengthSteps, rows } = grooveToSteps(bb, 16);
    expect(lengthSteps).toBe(32);
    expect(rows.kick!.map((s) => s.index)).toEqual([0, 10, 16, 18, 26]);
    expect(rows.snare!.map((s) => s.index)).toEqual([4, 12, 20, 28]);
    expect(grooveToSteps(bb, 64).lengthSteps).toBe(64); // never shrinks; grid repeats
    expect(grooveToSteps(bb, 64).rows.snare).toHaveLength(8);
    const dembow = GROOVES.find((g) => g.id === "dembow")!;
    expect(grooveToSteps(dembow, 16).rows.snare!.map((s) => s.index)).toEqual([3, 6, 11, 14]);
  });
});
