import { describe, it, expect } from "vitest";
import { SAMPLE_STARTERS } from "./sample-starters";
import { loopSpec } from "./generate-audio";
import { buildProduction } from "../../shared/producer";
import { applyProduction } from "../state/production";
import { createEmptyProject } from "../../shared/project";
import { INSTRUMENT_PRESETS } from "../engine/instruments";

describe("sample starters", () => {
  it("10+ starters; every instrument named is a real preset; each builds only the parts asked for", () => {
    expect(SAMPLE_STARTERS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SAMPLE_STARTERS.map((s) => s.id)).size).toBe(SAMPLE_STARTERS.length);
    for (const s of SAMPLE_STARTERS) {
      for (const id of Object.values(s.spec.instruments)) if (id) expect(INSTRUMENT_PRESETS.some((p) => p.id === id), `${s.id}: ${id}`).toBe(true);
      const project = applyProduction(createEmptyProject(), buildProduction(loopSpec(s.spec, s.bars, s.parts)));
      const hasDrums = project.channels.some((c) => c.instrument.type === "drum-sound");
      expect(hasDrums, s.id).toBe(s.parts.includes("drums"));
      expect(project.channels.length, s.id).toBeGreaterThan(0);
    }
  });
});
