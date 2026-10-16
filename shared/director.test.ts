import { describe, it, expect } from "vitest";
import { localRevise, directFromPrompt } from "./director";
import { ProductionSpecSchema, GENRES, resolveSpec, buildProduction } from "./producer";

const base = () => ProductionSpecSchema.parse({ genre: "trap", bpm: 140, seed: 7 });

describe("localRevise (offline 'change it' box)", () => {
  it("tempo: faster/slower are relative, explicit BPM wins, and limits hold", () => {
    expect(localRevise(base(), "faster").spec.bpm).toBe(148);
    expect(localRevise(base(), "slow it down").spec.bpm).toBe(132);
    expect(localRevise(base(), "make it 150 bpm").spec.bpm).toBe(150);
    expect(localRevise(ProductionSpecSchema.parse({ genre: "dnb", bpm: 198, seed: 1 }), "faster").spec.bpm).toBe(200);
    expect(localRevise(ProductionSpecSchema.parse({ genre: "lofi", bpm: 52, seed: 1 }), "slower").spec.bpm).toBe(50);
  });

  it("feel: darker → minor-family scale, brighter → major, swing, reverb, sidechain", () => {
    expect(["minor", "phrygian", "harmonic minor"]).toContain(localRevise(base(), "darker").spec.scale);
    expect(localRevise(base(), "happier please").spec.scale).toBe("major");
    expect(localRevise(base(), "more swing").spec.swing).toBeGreaterThan(base().swing ?? GENRES.trap.swing);
    expect(localRevise({ ...base(), swing: 0.3 }, "straighter").spec.swing).toBe(0);
    const wet = localRevise(base(), "more reverb").spec.mix.reverb!;
    expect(localRevise({ ...base(), mix: { ...base().mix, reverb: wet } }, "drier").spec.mix.reverb).toBeLessThan(wet);
    expect(localRevise(base(), "add sidechain pumping").spec.mix.sidechain).toBe(true);
    expect(localRevise(base(), "no sidechain").spec.mix.sidechain).toBe(false);
  });

  it("several changes in one request all apply, and keep the same seed (same beat, just changed)", () => {
    const { spec, changes } = localRevise(base(), "slower, darker and no melody");
    expect(spec.bpm).toBe(132);
    expect(spec.styles.melody).toBe("none");
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(spec.seed).toBe(7);
  });

  it("'another version' or an unrecognised request gives a new seed; 'same beat' never does", () => {
    expect(localRevise(base(), "another version").spec.seed).not.toBe(7);
    const odd = localRevise(base(), "make it sound like purple");
    expect(odd.spec.seed).not.toBe(7);
    expect(odd.changes.join(" ")).toMatch(/fresh variation/);
    expect(localRevise(base(), "faster but keep the same beat").spec.seed).toBe(7);
  });

  it("naming a genre switches genre and resets genre-specific choices; output always validates", () => {
    const { spec } = localRevise({ ...base(), instruments: { bass: "808-sub" } }, "turn it into house");
    expect(spec.genre).toBe("house");
    expect(spec.bpm).toBeUndefined();
    expect(spec.instruments).toEqual({});
    for (const req of ["longer", "shorter", "arp melody", "harder", "softer", "in F# minor", "", "!!!"]) {
      expect(() => ProductionSpecSchema.parse(localRevise(base(), req).spec), req).not.toThrow();
    }
  });

  it("never mutates the spec it was given", () => {
    const s = base();
    const before = JSON.stringify(s);
    localRevise(s, "faster darker more reverb longer");
    expect(JSON.stringify(s)).toBe(before);
    expect(directFromPrompt("trap", 1).spec.genre).toBe("trap");
  });
});

describe("chopped & screwed genre", () => {
  it("is recognised from the ways people ask for it", () => {
    for (const p of ["chopped and screwed houston beat", "screwed down slow", "slowed beat with syrup", "DJ Screw style tape"]) {
      expect(directFromPrompt(p, 1).spec.genre, p).toBe("screwed");
    }
  });
  it("builds slow, in the screwed tempo range", () => {
    const r = resolveSpec(ProductionSpecSchema.parse({ genre: "screwed", seed: 5 }));
    expect(r.bpm).toBeGreaterThanOrEqual(60);
    expect(r.bpm).toBeLessThanOrEqual(76);
    expect(buildProduction(ProductionSpecSchema.parse({ genre: "screwed", seed: 5 })).parts.some((p) => p.role === "drums")).toBe(true);
  });
});
