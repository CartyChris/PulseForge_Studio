import { describe, it, expect } from "vitest";
import { createEmptyProject, MASTER_ID, type Project } from "../../shared/project";
import { buildProduction, ProductionSpecSchema, GENRE_IDS } from "../../shared/producer";
import { applyProduction, makeEffect, resolvePreset } from "./production";
import { buildEventList } from "../engine/events";
import { EFFECT_DEFS } from "../engine/effects";
import { INSTRUMENT_PRESETS } from "../engine/instruments";

const prod = (genre: string, seed = 42) => buildProduction(ProductionSpecSchema.parse({ genre, seed }));

/** Every id-valued reference in the project must resolve — the class of bug that crashes the engine. */
function assertReferentialIntegrity(p: Project) {
  const mixerIds = new Set(p.mixer.channels.map((c) => c.id));
  const patternIds = new Set(p.patterns.map((x) => x.id));
  const trackIds = new Set(p.tracks.map((t) => t.id));
  const channelIds = new Set(p.channels.map((c) => c.id));
  for (const c of p.channels) if (c.mixerChannelId) expect(mixerIds.has(c.mixerChannelId), `channel ${c.name} → missing mixer`).toBe(true);
  for (const t of p.tracks) if (t.mixerChannelId) expect(mixerIds.has(t.mixerChannelId), `track ${t.name} → missing mixer`).toBe(true);
  for (const m of p.mixer.channels) {
    if (m.outputId) expect(mixerIds.has(m.outputId), `${m.name} output`).toBe(true);
    if (m.sidechainFromId) expect(mixerIds.has(m.sidechainFromId), `${m.name} sidechain`).toBe(true);
    for (const s of m.sends) expect(mixerIds.has(s.toChannelId), `${m.name} send`).toBe(true);
    for (const fx of m.effects) {
      const def = EFFECT_DEFS[fx.type];
      expect(def, fx.type).toBeDefined();
      for (const [k, v] of Object.entries(fx.params)) {
        const d = def.params.find((x) => x.key === k);
        expect(d, `${fx.type}.${k} is not a real param`).toBeDefined();
        expect(v).toBeGreaterThanOrEqual(d!.min);
        expect(v).toBeLessThanOrEqual(d!.max);
      }
    }
  }
  for (const pat of p.patterns) {
    for (const id of Object.keys(pat.steps)) expect(channelIds.has(id), `pattern ${pat.name} steps → missing channel`).toBe(true);
    for (const id of Object.keys(pat.notes)) expect(channelIds.has(id), `pattern ${pat.name} notes → missing channel`).toBe(true);
  }
  for (const c of p.clips) {
    expect(trackIds.has(c.trackId), "clip track").toBe(true);
    if (c.kind === "pattern") expect(patternIds.has(c.patternId!), "clip pattern").toBe(true);
    if (c.kind === "automation") {
      const t = c.automationTarget!;
      const ch = p.mixer.channels.find((m) => m.id === t.mixerChannelId);
      expect(ch, "automation mixer").toBeDefined();
      expect(ch!.effects.some((f) => f.id === t.effectId), "automation effect").toBe(true);
      for (const pt of c.automationPoints) { expect(pt.value).toBeGreaterThanOrEqual(0); expect(pt.value).toBeLessThanOrEqual(1); expect(pt.tick).toBeLessThanOrEqual(c.lengthTicks); }
    }
  }
}

describe("applyProduction", () => {
  for (const genre of GENRE_IDS) {
    it(`${genre}: produces a schema-valid project whose every reference resolves and that actually plays`, () => {
      const production = prod(genre);
      const p = applyProduction(createEmptyProject(), production);
      assertReferentialIntegrity(p);
      expect(p.bpm).toBe(production.spec.bpm);
      expect(p.key).toBe(production.spec.key);
      expect(p.sections.length).toBe(production.sections.length);
      // the engine's own event builder must find drums and notes across the whole song
      const ev = buildEventList(p);
      expect(ev.drums.length).toBeGreaterThan(50);
      expect(ev.notes.length).toBeGreaterThan(50);
      expect(ev.endTick).toBe(production.totalBars * 384);
      expect(p.mixer.channels.find((c) => c.id === MASTER_ID)!.effects.at(-1)!.type).toBe("limiter");
      expect((p.ui as Record<string, unknown>).production).toBeDefined();
    });
  }

  it("routes chords/melody through the filtered Music Bus and automates its cutoff", () => {
    const p = applyProduction(createEmptyProject(), prod("house"));
    const bus = p.mixer.channels.find((c) => c.name === "Music Bus")!;
    expect(bus.effects[0]!.type).toBe("filter");
    expect(bus.effects[0]!.params.freq).toBe(20000); // open when not automated
    for (const name of ["Chords", "Melody"]) expect(p.mixer.channels.find((c) => c.name === name)!.outputId).toBe(bus.id);
    const sweep = p.clips.find((c) => c.kind === "automation")!;
    expect(sweep.automationPoints[0]!.value).toBeLessThan(0.05); // starts closed (~350 Hz)
    expect(sweep.automationPoints.at(-1)!.value).toBeCloseTo(1, 2); // ends fully open
  });

  it("sidechains bass under the kick for house but not for trap", () => {
    const house = applyProduction(createEmptyProject(), prod("house"));
    const kick = house.mixer.channels.find((c) => c.name === "Kick")!;
    expect(house.mixer.channels.find((c) => c.name === "Bass")!.sidechainFromId).toBe(kick.id);
    const trap = applyProduction(createEmptyProject(), prod("trap"));
    expect(trap.mixer.channels.find((c) => c.name === "Bass")!.sidechainFromId).toBeNull();
  });

  it("repeated sections reuse the same patterns (FL-style), not copies", () => {
    const p = applyProduction(createEmptyProject(), prod("trap"));
    const hookClips = p.clips.filter((c) => c.name === "Hook · Drums");
    expect(hookClips.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hookClips.map((c) => c.patternId)).size).toBe(1);
  });

  it("replace mode starts from a neutral master fader (never inherits the last beat's auto-mix gain)", () => {
    const first = applyProduction(createEmptyProject(), prod("lofi", 1));
    const hot = { ...first, mixer: { channels: first.mixer.channels.map((c) => (c.id === MASTER_ID ? { ...c, volumeDb: 12, pan: 0.5 } : c)) } };
    const next = applyProduction(hot, prod("afrobeats", 2));
    const m = next.mixer.channels.find((c) => c.id === MASTER_ID)!;
    expect(m.volumeDb).toBe(0);
    expect(m.pan).toBe(0);
    // append mode leaves the user's master alone
    expect(applyProduction(hot, prod("afrobeats", 2), { mode: "append" }).mixer.channels.find((c) => c.id === MASTER_ID)!.volumeDb).toBe(12);
  });

  it("replace mode keeps the user's audio assets; append mode keeps everything and places after the song", () => {
    const base = applyProduction(createEmptyProject(), prod("lofi", 1));
    const withAsset = { ...base, assets: [{ id: "a1", name: "vocal", durationSec: 3, sampleRate: 44100, channels: 1, source: "recording" as const, blobKey: "k", originalBlobKey: null, licenseNote: "", tags: [], favorite: false, bpmEstimate: null, keyEstimate: null, aiMeta: null }] };
    const replaced = applyProduction(withAsset, prod("pop", 2));
    expect(replaced.assets).toHaveLength(1);
    const appended = applyProduction(withAsset, prod("pop", 2), { mode: "append" });
    const baseEnd = Math.max(...base.clips.map((c) => c.startTick + c.lengthTicks));
    expect(appended.channels.length).toBeGreaterThan(base.channels.length);
    const newClips = appended.clips.filter((c) => !base.clips.some((b) => b.id === c.id));
    expect(Math.min(...newClips.map((c) => c.startTick))).toBeGreaterThanOrEqual(baseEnd);
    assertReferentialIntegrity(appended);
  });

  it("makeEffect fills every param and clamps out-of-range values", () => {
    const fx = makeEffect("compressor", { threshold: -500, ratio: 3 });
    expect(Object.keys(fx.params).sort()).toEqual(EFFECT_DEFS.compressor.params.map((p) => p.key).sort());
    expect(fx.params.threshold).toBe(-60);
    expect(() => makeEffect("nope", {})).toThrow();
  });

  it("resolvePreset falls back gracefully", () => {
    expect(resolvePreset(["does-not-exist", "bass-808"]).id).toBe("bass-808");
    expect(resolvePreset(["nope"]).id).toBe(INSTRUMENT_PRESETS[0]!.id);
  });
});
