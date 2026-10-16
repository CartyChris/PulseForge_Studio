import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { PROJECT_TEMPLATES } from "./projects";
import { ProjectSchema } from "../../shared/project";

describe("project templates", () => {
  it("every template creates a valid project; the producer-built ones are complete songs", () => {
    for (const t of PROJECT_TEMPLATES) {
      const p = t.create();
      expect(() => ProjectSchema.parse(p), t.id).not.toThrow();
    }
    for (const id of ["screwed-tape", "sample-flip", "lofi-tape", "phonk-memphis"]) {
      const p = PROJECT_TEMPLATES.find((t) => t.id === id)!.create();
      expect(p.sections.length, id).toBeGreaterThanOrEqual(3);
      expect(p.clips.length, id).toBeGreaterThan(0);
    }
    const screwed = PROJECT_TEMPLATES.find((t) => t.id === "screwed-tape")!.create();
    expect(screwed.bpm).toBe(70);
    const flip = PROJECT_TEMPLATES.find((t) => t.id === "sample-flip")!.create();
    // drums + bass only: room for the sample
    expect(flip.channels.every((c) => c.instrument.type === "drum-sound" || /bass|808/i.test(c.instrument.type === "synth" ? c.instrument.presetId : ""))).toBe(true);
  });
});
