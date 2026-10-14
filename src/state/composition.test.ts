import { describe, it, expect } from "vitest";
import { createEmptyProject } from "../../shared/project";
import { validateComposition } from "../../shared/composition";
import { insertComposition, projectSummary, songStructure } from "./composition";

const comp = validateComposition({
  version: 1,
  title: "Test Jam",
  bpm: 95,
  key: "F",
  scale: "minor",
  sections: [
    {
      name: "Verse", role: "verse", lengthBars: 4,
      drumPattern: [
        { sound: "kick", step: 0, velocity: 1 }, { sound: "kick", step: 8 },
        { sound: "snare", step: 4 }, { sound: "snare", step: 12 },
        { sound: "hat-closed", step: 2 }, { sound: "hat-closed", step: 6 },
      ],
      bassNotes: [{ pitch: 41, startStep: 0, lengthSteps: 4, velocity: 0.9 }],
      chordNotes: [{ pitch: 65, startStep: 0, lengthSteps: 8 }, { pitch: 68, startStep: 0, lengthSteps: 8 }],
      melodyNotes: [{ pitch: 77, startStep: 8, lengthSteps: 2 }],
    },
    {
      name: "Chorus", role: "chorus", lengthBars: 4,
      drumPattern: [{ sound: "kick", step: 0 }, { sound: "clap", step: 4 }],
      melodyNotes: [{ pitch: 80, startStep: 0, lengthSteps: 4 }],
    },
  ],
});

describe("composition insertion", () => {
  it("full insert creates channels, patterns, clips, sections and applies tempo", () => {
    const p = insertComposition(createEmptyProject("t", 120), comp, { mode: "full" });
    expect(p.bpm).toBe(95);
    expect(p.key).toBe("F");
    // drum channels for kick/snare/hat/clap + bass/chords/melody synths
    expect(p.channels.filter((c) => c.instrument.type === "drum-sound").length).toBeGreaterThanOrEqual(4);
    expect(p.channels.find((c) => c.name === "AI Bass")).toBeTruthy();
    expect(p.channels.find((c) => c.name === "AI Melody")).toBeTruthy();
    expect(p.patterns).toHaveLength(2);
    expect(p.clips).toHaveLength(2);
    expect(p.clips[1]!.startTick).toBe(p.clips[0]!.lengthTicks);
    expect(p.sections.map((s) => s.name)).toEqual(["Verse", "Chorus"]);
    const verse = p.patterns[0]!;
    expect(Object.values(verse.steps).flat().length).toBe(6);
    expect(Object.values(verse.notes).flat().length).toBe(4);
  });
  it("drums-only omits notes; notes-only omits steps", () => {
    const drums = insertComposition(createEmptyProject(), comp, { mode: "drums-only" });
    expect(Object.values(drums.patterns[0]!.notes).flat()).toHaveLength(0);
    expect(Object.values(drums.patterns[0]!.steps).flat().length).toBeGreaterThan(0);
    const notes = insertComposition(createEmptyProject(), comp, { mode: "notes-only" });
    expect(Object.values(notes.patterns[0]!.steps).flat()).toHaveLength(0);
    expect(Object.values(notes.patterns[0]!.notes).flat().length).toBeGreaterThan(0);
  });
  it("sections mode inserts only chosen sections", () => {
    const p = insertComposition(createEmptyProject(), comp, { mode: "sections", sectionNames: ["Chorus"] });
    expect(p.patterns).toHaveLength(1);
    expect(p.patterns[0]!.name).toBe("Chorus");
  });
  it("alternate mode appends after existing song with a gap and keeps original clips", () => {
    let p = insertComposition(createEmptyProject(), comp, { mode: "full" });
    const clipCount = p.clips.length;
    p = insertComposition(p, comp, { mode: "sections", sectionNames: ["Chorus"], atTick: undefined, applyTempo: false });
    expect(p.clips.length).toBe(clipCount + 1);
  });
  it("replace-pattern grafts content into an existing pattern", () => {
    let p = createEmptyProject();
    p = insertComposition(p, comp, { mode: "full" });
    const targetId = p.patterns[0]!.id;
    const before = Object.values(p.patterns[0]!.steps).flat().length;
    const replaced = insertComposition(p, comp, { mode: "replace-pattern", replacePatternId: targetId, sectionNames: ["Chorus"] });
    const target = replaced.patterns.find((x) => x.id === targetId)!;
    expect(Object.values(target.steps).flat().length).not.toBe(before);
  });
  it("channels are reused on repeated inserts (no duplicates)", () => {
    let p = insertComposition(createEmptyProject(), comp, { mode: "full" });
    const n = p.channels.length;
    p = insertComposition(p, comp, { mode: "full" });
    expect(p.channels.length).toBe(n);
  });
});

describe("project summary", () => {
  it("includes real ids for AI grounding", () => {
    const p = insertComposition(createEmptyProject("Sum", 100), comp, { mode: "full" });
    const s = projectSummary(p);
    expect(s).toContain(p.patterns[0]!.id);
    expect(s).toContain(p.mixer.channels[0]!.id);
    expect(s).toContain("95 BPM");
    expect(songStructure(p)).toContain("Verse");
  });
});
