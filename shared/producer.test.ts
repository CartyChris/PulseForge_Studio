import { describe, it, expect } from "vitest";
import {
  GENRE_IDS, GENRES, buildProduction, resolveSpec, validateProductionSpec, ProductionSpecSchema,
  parseChordToken, normalizeKey, parseGrid, describeProduction, type Production,
} from "./producer";
import { directFromPrompt } from "./director";
import { SCALES, TICKS_PER_STEP } from "./time";

const pc = (rootPc: number, midi: number) => (((midi - rootPc) % 12) + 12) % 12;
const spec = (over: Record<string, unknown> = {}) => ProductionSpecSchema.parse({ seed: 1234, ...over });
const partsOf = (p: Production, role: string) => p.parts.filter((x) => x.role === role);

describe("producer — every genre, every length", () => {
  for (const genre of GENRE_IDS) {
    for (const length of ["short", "standard", "extended"] as const) {
      it(`${genre}/${length}: valid, in key, in range, on grid`, () => {
        const p = buildProduction(spec({ genre, length }));
        const s = p.spec;
        expect(p.sections.length).toBeGreaterThanOrEqual(4);
        expect(p.totalBars).toBe(p.sections.reduce((a, x) => a + x.bars, 0));
        // the core parts all appear somewhere in the song
        for (const role of ["drums", "bass", "chords", "melody"]) expect(partsOf(p, role).length, `${role} missing`).toBeGreaterThan(0);

        const hScale = SCALES[s.harmonyScale]!;
        const mScale = SCALES[s.scale]!;
        for (const part of p.parts) {
          const maxTick = part.lengthSteps * TICKS_PER_STEP;
          for (const n of part.notes ?? []) {
            expect(n.startTick).toBeGreaterThanOrEqual(0);
            expect(n.startTick).toBeLessThan(maxTick);
            expect(n.lengthTicks).toBeGreaterThan(0);
            expect(n.velocity).toBeGreaterThan(0);
            expect(n.velocity).toBeLessThanOrEqual(1);
            if (part.role === "bass") { expect(n.pitch).toBeGreaterThanOrEqual(24); expect(n.pitch).toBeLessThanOrEqual(52); }
            if (part.role === "chords") { expect(n.pitch).toBeGreaterThanOrEqual(45); expect(n.pitch).toBeLessThanOrEqual(88); }
            if (part.role === "melody") { expect(n.pitch).toBeGreaterThanOrEqual(55); expect(n.pitch).toBeLessThanOrEqual(96); }
            const scale = part.role === "melody" ? mScale : hScale;
            expect(scale, `${part.role} note ${n.pitch} out of ${s.key} ${part.role === "melody" ? s.scale : s.harmonyScale}`).toContain(pc(s.rootPc, n.pitch));
          }
          for (const [role, hits] of Object.entries(part.drums ?? {})) {
            for (const h of hits) {
              expect(h.index, role).toBeGreaterThanOrEqual(0);
              expect(h.index, role).toBeLessThan(part.lengthSteps);
              expect(Math.abs(h.micro), role).toBeLessThanOrEqual(12);
              expect(h.velocity).toBeGreaterThanOrEqual(0.05);
              expect(h.velocity).toBeLessThanOrEqual(1);
            }
          }
        }
        expect(p.spec.bpm).toBeGreaterThanOrEqual(GENRES[genre].bpm[0]);
        expect(p.spec.bpm).toBeLessThanOrEqual(GENRES[genre].bpm[1]);
        expect(describeProduction(p)).toContain(GENRES[genre].name);
      });
    }
  }
});

describe("producer — grooves are genre-correct", () => {
  const drumsIn = (p: Production, section: string) => partsOf(p, "drums").find((x) => x.section === section)!.drums!;

  it("trap hook is half-time: a snare/clap on beat 3 (step 8) of every bar", () => {
    const p = buildProduction(spec({ genre: "trap" }));
    const d = drumsIn(p, "Hook");
    const backbeat = [...(d.snare ?? []), ...(d.clap ?? [])].filter((h) => h.index % 16 === 8 && h.micro === 0);
    const bars = partsOf(p, "drums").find((x) => x.section === "Hook")!.lengthSteps / 16;
    expect(new Set(backbeat.map((h) => Math.floor(h.index / 16))).size).toBe(bars);
    // and trap hats roll: some hats sit off the 16th grid (micro ≠ 0)
    expect((d["hat-closed"] ?? []).some((h) => h.micro !== 0)).toBe(true);
  });

  it("house drop is four-on-the-floor", () => {
    const p = buildProduction(spec({ genre: "house" }));
    const kicks = new Set(drumsIn(p, "Drop").kick!.map((h) => h.index));
    for (const s of [0, 4, 8, 12, 16, 20, 24, 28]) expect(kicks.has(s)).toBe(true);
  });

  it("EDM intros keep their kick (regression: intros were classified as light)", () => {
    const p = buildProduction(spec({ genre: "techno" }));
    expect(drumsIn(p, "Intro").kick?.length ?? 0).toBeGreaterThan(0);
  });

  it("hip-hop intros have no drums at all", () => {
    const p = buildProduction(spec({ genre: "boom-bap" }));
    expect(partsOf(p, "drums").some((x) => x.section === "Intro")).toBe(false);
  });

  it("reggaeton runs the dembow snare (steps 3, 6, 11, 14)", () => {
    const p = buildProduction(spec({ genre: "reggaeton" }));
    const snares = new Set(drumsIn(p, "Hook").snare!.filter((h) => h.index < 16).map((h) => h.index));
    for (const s of [3, 6, 11, 14]) expect(snares.has(s)).toBe(true);
  });

  it("an explicit drum grid overrides the groove in every drum section", () => {
    const p = buildProduction(spec({ genre: "trap", drums: { kick: "x...x...x...x..." } }));
    for (const part of partsOf(p, "drums")) {
      const kicks = (part.drums!.kick ?? []).map((h) => h.index);
      if (!kicks.length) continue;
      expect(kicks.slice(0, 4)).toEqual([0, 4, 8, 12]);
    }
  });

  it("808 bass follows the kick", () => {
    const p = buildProduction(spec({ genre: "trap" }));
    const kickTicks = new Set(drumsIn(p, "Verse").kick!.map((h) => h.index * TICKS_PER_STEP + h.micro));
    const bass = partsOf(p, "bass").find((x) => x.section === "Verse")!.notes!;
    const onKick = bass.filter((n) => kickTicks.has(n.startTick)).length;
    expect(onKick / bass.length).toBeGreaterThan(0.9);
  });
});

describe("producer — AI-directed specs", () => {
  it("honors a scale-degree motif: degree 4 on beat 1 is the fifth", () => {
    const p = buildProduction(spec({ genre: "lofi", key: "C", scale: "minor", progression: ["i"], motif: [{ degree: 4, step: 0, length: 4 }, { degree: 2, step: 8, length: 4 }] }));
    const mel = partsOf(p, "melody")[0]!.notes!;
    expect(pc(0, mel[0]!.pitch)).toBe(7); // G over C minor
    // onsets only where the motif put them (steps 0 and 8 of each 2-bar phrase)
    for (const n of mel) expect([0, 8]).toContain((n.startTick / TICKS_PER_STEP) % 16);
  });

  it("respects explicit key, scale, bpm, progression and custom sections", () => {
    const p = buildProduction(spec({
      genre: "pop", key: "Bb", scale: "major", bpm: 104, progression: ["I", "V", "vi", "IV"],
      sections: [{ name: "Intro", role: "intro", bars: 4, energy: 0.3 }, { name: "Chorus", role: "chorus", bars: 8, energy: 1 }],
    }));
    expect(p.spec.key).toBe("A#");
    expect(p.spec.bpm).toBe(104);
    expect(p.sections.map((s) => s.name)).toEqual(["Intro", "Chorus"]);
    expect(p.sections[1]!.chords.slice(0, 4)).toEqual(["I", "V", "vi", "IV"]);
  });

  it("is deterministic per seed and varies across seeds", () => {
    const a = JSON.stringify(buildProduction(spec({ genre: "drill", seed: 7 })).parts);
    const b = JSON.stringify(buildProduction(spec({ genre: "drill", seed: 7 })).parts);
    const c = JSON.stringify(buildProduction(spec({ genre: "drill", seed: 8 })).parts);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("validation rejects junk and fills defaults", () => {
    expect(() => validateProductionSpec({ bpm: 400 })).toThrow(/bpm/);
    expect(() => validateProductionSpec({ drums: { kick: "x..y" } })).toThrow(/grid/);
    expect(() => validateProductionSpec({ genre: "polka" })).toThrow(/genre/);
    const v = validateProductionSpec({});
    expect(v.genre).toBe("trap");
    expect(resolveSpec(v).sections.length).toBeGreaterThan(3);
  });
});

describe("producer — transitions & mix plan", () => {
  it("big sections get a crash on the downbeat with a reverse cymbal leading in", () => {
    const p = buildProduction(spec({ genre: "pop" }));
    const chorus = p.sections.find((s) => s.name === "Chorus")!;
    const start = chorus.startBar * 384;
    expect(p.fx.some((f) => f.role === "crash" && f.tick === start)).toBe(true);
    expect(p.fx.some((f) => f.role === "reverse-cymbal" && f.tick === start - 384)).toBe(true);
  });

  it("sidechain only when the genre/spec asks for it; master always ends in a limiter", () => {
    const house = buildProduction(spec({ genre: "house" }));
    const trap = buildProduction(spec({ genre: "trap" }));
    expect(house.mix.parts.bass.sidechained).toBe(true);
    expect(trap.mix.parts.bass.sidechained).toBe(false);
    expect(house.mix.master.at(-1)!.type).toBe("limiter");
    expect(house.mix.filterSweeps.length).toBeGreaterThan(0); // intro + builds sweep open
  });
});

describe("theory helpers", () => {
  const minor = SCALES["minor"]!, major = SCALES["major"]!;
  it("parses roman numerals and chord names diatonically", () => {
    expect(parseChordToken("VI", 9, minor)).toBe(5);
    expect(parseChordToken("iv7", 9, minor)).toBe(3);
    expect(parseChordToken("bVII", 9, minor)).toBe(6);
    expect(parseChordToken("VImaj7", 9, minor)).toBe(5);
    expect(parseChordToken("Am", 0, major)).toBe(5);
    expect(parseChordToken("F#m7", 2, major)).toBe(2);
    expect(parseChordToken("5", 0, major)).toBe(4);
    expect(parseChordToken("xyz", 0, major)).toBeNull();
  });
  it("normalizes key names", () => {
    expect(normalizeKey("Bb")).toBe("A#");
    expect(normalizeKey("f#")).toBe("F#");
    expect(normalizeKey("Eb")).toBe("D#");
    expect(normalizeKey("b")).toBe("B");
    expect(normalizeKey("F#m")).toBe("F#");
    expect(normalizeKey("H")).toBeNull();
  });
  it("parses drum grids incl. accents, ghosts and ratchets", () => {
    const g = parseGrid("X.g.r...", 8);
    expect(g.map((h) => [h.index, h.micro])).toEqual([[0, 0], [2, 0], [4, 0], [4, 12]]);
    expect(g[0]!.velocity).toBe(1);
    expect(g[1]!.velocity).toBeLessThan(0.4);
  });
});

describe("local director (offline prompt → spec)", () => {
  it("understands genre, tempo, key, scale and instruments", () => {
    const { spec: s, understood } = directFromPrompt("dark trap beat 140 bpm in F# minor with bells");
    expect(s.genre).toBe("trap");
    expect(s.bpm).toBe(140);
    expect(s.key).toBe("F#");
    expect(s.scale).toBe("minor");
    expect(s.instruments.melody).toBe("bell");
    expect(s.mood).toContain("dark");
    expect(understood.join(" ")).toContain("140 BPM");
  });
  it("does not read 'in a dark mood' as the key of A (regression)", () => {
    expect(directFromPrompt("a house track in a dark mood").spec.key).toBeUndefined();
  });
  it("maps genre words, flats and qualities", () => {
    expect(directFromPrompt("chill lo-fi study beat").spec.genre).toBe("lofi");
    expect(directFromPrompt("uk drill with sliding 808s").spec.genre).toBe("drill");
    expect(directFromPrompt("drum and bass roller").spec.genre).toBe("dnb");
    expect(directFromPrompt("dancehall riddim").spec.genre).toBe("dancehall");
    const af = directFromPrompt("happy afrobeats in Bb major");
    expect(af.spec.genre).toBe("afrobeats");
    expect(af.spec.key).toBe("A#");
    expect(af.spec.scale).toBe("major");
    expect(directFromPrompt("something in Am").spec.scale).toBe("minor");
  });
  it("every director spec produces a playable production", () => {
    for (const prompt of ["", "phonk drift", "jersey club", "synthwave 80s", "techno warehouse 132 bpm", "r&b slow jam", "epic cinematic dubstep"]) {
      const p = buildProduction(directFromPrompt(prompt, 99).spec);
      expect(p.parts.length).toBeGreaterThan(3);
    }
  });
});
