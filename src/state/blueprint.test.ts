import { describe, it, expect } from "vitest";
import { applyBlueprint, layerOf } from "./blueprint";
import { BLUEPRINTS, blueprintBars, LAYERS } from "../../shared/blueprints";
import { createEmptyProject, newId, ProjectSchema, type Channel, type Project } from "../../shared/project";
import { INSTRUMENT_PRESETS } from "../engine/instruments";

const chan = (name: string, instrument: Channel["instrument"]): Channel => ({ id: newId("ch"), name, color: "#fff", instrument, volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null });
function loopProject(): { p: Project; patId: string; ids: Record<string, string> } {
  const p = createEmptyProject("Loop", 90);
  const lead = INSTRUMENT_PRESETS.find((x) => x.category === "Synth Leads")!;
  const kick = chan("Kick", { type: "drum-sound", kitId: "boom-bap", soundId: "kick" });
  const bass = chan("808", { type: "synth", synthId: "bass808", presetId: "bass-808", params: {} });
  const keys = chan("Keys", { type: "synth", synthId: "piano", presetId: "piano-studio", params: {} });
  const ld = chan("Lead", { type: "synth", synthId: lead.engineId, presetId: lead.id, params: {} });
  const note = (pitch: number) => ({ id: newId("n"), pitch, startTick: 0, lengthTicks: 96, velocity: 0.8, pan: 0, probability: 1 });
  const pat = { id: newId("pat"), name: "Loop", color: "#fff", lengthSteps: 16, swing: 0,
    steps: { [kick.id]: [{ index: 0, velocity: 0.9, probability: 1, micro: 0 }] },
    notes: { [bass.id]: [note(36)], [keys.id]: [note(60)], [ld.id]: [note(72)] } };
  return { p: { ...p, channels: [kick, bass, keys, ld], patterns: [pat] }, patId: pat.id, ids: { kick: kick.id, bass: bass.id, keys: keys.id, lead: ld.id } };
}

describe("song blueprints", () => {
  it("channels sort into the right layers", () => {
    const { p, ids } = loopProject();
    const layer = (id: string) => layerOf(p.channels.find((c) => c.id === id)!);
    expect([layer(ids.kick!), layer(ids.bass!), layer(ids.keys!), layer(ids.lead!)]).toEqual(["drums", "bass", "music", "lead"]);
    const samp = (name: string) => layerOf({ ...p.channels[0]!, name, instrument: { type: "sampler", assetId: "a", params: {} as never } });
    expect([samp("Drum Break chop 3"), samp("Soul Keys chop 1"), samp("808 slide chop 2"), samp("Kick")]).toEqual(["drums", "music", "bass", "drums"]);
  });

  it("every blueprint builds a valid song: one pattern per layer, sections in order, layers per section", () => {
    for (const bp of BLUEPRINTS) {
      const { p, patId } = loopProject();
      const r = applyBlueprint(p, bp, patId, "replace");
      expect(() => ProjectSchema.parse(r.project), bp.id).not.toThrow();
      expect(r.layers.sort()).toEqual([...LAYERS].sort());
      expect(r.project.sections.map((s) => s.name)).toEqual(bp.sections.map((s) => s.name));
      expect(r.bars).toBe(blueprintBars(bp));
      bp.sections.forEach((sec, i) => {
        const at = r.project.sections[i]!.startTick;
        const here = r.project.clips.filter((c) => c.startTick === at);
        expect(here, `${bp.id}/${sec.name}`).toHaveLength(sec.layers.length);
        for (const c of here) {
          const pat = r.project.patterns.find((x) => x.id === c.patternId)!;
          expect(pat, "clip → pattern").toBeDefined();
          expect(r.project.tracks.some((t) => t.id === c.trackId), "clip → track").toBe(true);
        }
      });
      // sections are contiguous
      for (let i = 1; i < r.project.sections.length; i++) {
        const a = r.project.sections[i - 1]!, b = r.project.sections[i]!;
        expect(b.startTick).toBe(a.startTick + a.lengthTicks);
      }
    }
  });

  it("layer patterns hold only their own channels; the source loop is left alone", () => {
    const { p, patId, ids } = loopProject();
    const r = applyBlueprint(p, BLUEPRINTS[0]!, patId, "replace");
    const drums = r.project.patterns.find((x) => x.name === "Loop · Drums")!;
    expect(Object.keys(drums.steps)).toEqual([ids.kick]);
    expect(Object.keys(drums.notes)).toEqual([]);
    expect(Object.keys(r.project.patterns.find((x) => x.name === "Loop · Bass")!.notes)).toEqual([ids.bass]);
    expect(r.project.patterns.find((x) => x.id === patId)).toEqual(p.patterns[0]);
    expect(p.clips).toHaveLength(0); // input not mutated
  });

  it("append mode starts after the existing song (bar-aligned); empty loops are refused", () => {
    const { p, patId } = loopProject();
    const first = applyBlueprint(p, BLUEPRINTS.find((b) => b.id === "snippet")!, patId, "replace").project;
    const second = applyBlueprint(first, BLUEPRINTS.find((b) => b.id === "snippet")!, patId, "append").project;
    expect(second.sections).toHaveLength(6);
    expect(second.sections[3]!.startTick).toBe(24 * 384);
    expect(second.tracks.length).toBe(first.tracks.length); // reuses the layer tracks
    const empty = { ...p, patterns: [{ ...p.patterns[0]!, steps: {}, notes: {} }] };
    expect(() => applyBlueprint(empty, BLUEPRINTS[0]!, patId)).toThrow(/empty/);
  });
});
