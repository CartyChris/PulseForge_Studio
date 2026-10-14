import { describe, it, expect } from "vitest";
import { createEmptyProject, migrateProject, ProjectSchema, PROJECT_SCHEMA_VERSION, newId, MASTER_ID } from "./project";
import { validateEditPlan } from "./commands";
import { validateComposition } from "./composition";
import { encodeWav, parseWavHeader, decodeWavSamples, peakLevel } from "./wav";

describe("project schema", () => {
  it("creates a valid empty project with a master channel", () => {
    const p = createEmptyProject("Test", 90);
    expect(p.bpm).toBe(90);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.mixer.channels.find((c) => c.id === MASTER_ID)?.kind).toBe("master");
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });
  it("round-trips through JSON", () => {
    const p = createEmptyProject();
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });
  it("rejects newer schema versions", () => {
    const p = { ...createEmptyProject(), schemaVersion: 999 };
    expect(() => migrateProject(p)).toThrow(/newer/);
  });
  it("rejects garbage", () => {
    expect(() => migrateProject("nope")).toThrow();
    expect(() => migrateProject({ schemaVersion: 1 })).toThrow();
  });
  it("ids are unique", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(seen.size).toBe(2000);
  });
});

describe("edit plan validation", () => {
  it("accepts a valid plan", () => {
    const plan = validateEditPlan({
      version: 1,
      title: "Louder drums",
      commands: [{ type: "setTrackVolume", mixerChannelId: "m1", volumeDb: -3 }],
    });
    expect(plan.commands).toHaveLength(1);
  });
  it("rejects unknown commands and out-of-range values", () => {
    expect(() => validateEditPlan({ version: 1, title: "x", commands: [{ type: "formatHardDrive" }] })).toThrow(/Invalid edit plan/);
    expect(() => validateEditPlan({ version: 1, title: "x", commands: [{ type: "setBpm", bpm: 9000 }] })).toThrow();
    expect(() => validateEditPlan({ version: 1, title: "x", commands: [] })).toThrow();
  });
});

describe("composition validation", () => {
  it("accepts a minimal composition", () => {
    const c = validateComposition({
      version: 1,
      bpm: 90,
      sections: [{ name: "Verse", lengthBars: 4, drumPattern: [{ sound: "kick", step: 0 }] }],
    });
    expect(c.sections[0]?.drumPattern[0]?.sound).toBe("kick");
  });
  it("rejects invalid notes", () => {
    expect(() =>
      validateComposition({ version: 1, sections: [{ name: "V", lengthBars: 2, melodyNotes: [{ pitch: 500, startStep: 0, lengthSteps: 1 }] }] }),
    ).toThrow(/Invalid composition/);
  });
});

describe("wav encode/decode", () => {
  const sine = (freq: number, sec: number, rate: number) => {
    const n = Math.floor(sec * rate);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * 0.5;
    return out;
  };
  it("round-trips 16/24/32-bit audio", () => {
    const rate = 44100;
    const data = [sine(440, 0.1, rate), sine(220, 0.1, rate)];
    for (const depth of [16, 24, 32] as const) {
      const buf = encodeWav(data, rate, depth);
      const info = parseWavHeader(buf);
      expect(info.sampleRate).toBe(rate);
      expect(info.channels).toBe(2);
      expect(info.bitDepth).toBe(depth);
      expect(info.durationSec).toBeCloseTo(0.1, 3);
      const { channelData } = decodeWavSamples(buf);
      expect(channelData[0]![100]).toBeCloseTo(data[0]![100]!, depth === 16 ? 3 : 4);
      expect(peakLevel(channelData)).toBeGreaterThan(0.4);
    }
  });
  it("rejects non-WAV data", () => {
    expect(() => parseWavHeader(new ArrayBuffer(64))).toThrow(/Not a WAV/);
  });
});
