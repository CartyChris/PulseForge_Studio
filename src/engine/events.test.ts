import { describe, it, expect } from "vitest";
import { createEmptyProject, newId, MASTER_ID, type Project } from "../../shared/project";
import { buildEventList } from "./events";

function demoProject(): Project {
  const p = createEmptyProject("demo", 120);
  const kickChan = { id: "ch_kick", name: "Kick", color: "#fff", instrument: { type: "drum-sound", kitId: "trap-808", soundId: "trap-808/kick" }, volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null } as const;
  const bassChan = { id: "ch_bass", name: "Bass", color: "#fff", instrument: { type: "synth", synthId: "bass808", presetId: "bass-808", params: {} }, volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null } as const;
  p.channels = [kickChan as any, bassChan as any];
  p.patterns = [{
    id: "pat1", name: "Beat", color: "#fff", lengthSteps: 16, swing: 0,
    steps: { ch_kick: [{ index: 0, velocity: 1, probability: 1, micro: 0 }, { index: 8, velocity: 0.8, probability: 1, micro: 2 }] },
    notes: { ch_bass: [{ id: "n1", pitch: 40, startTick: 0, lengthTicks: 96, velocity: 0.9, pan: 0, probability: 1 }] },
  }];
  p.tracks = [{ id: "t1", name: "Track 1", color: "#fff", kind: "pattern", height: 56, muted: false, soloed: false, mixerChannelId: null, groupId: null, armed: false, inputDeviceId: null }];
  p.clips = [{
    id: "c1", trackId: "t1", kind: "pattern", patternId: "pat1", startTick: 0, lengthTicks: 768,
    muted: false, offsetTicks: 0, gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false,
    pitchSemitones: 0, stretch: 1, loopSource: false, automationPoints: [],
  }];
  return p;
}

describe("event list building", () => {
  it("expands pattern clips, looping the pattern to fill the clip", () => {
    const p = demoProject();
    const ev = buildEventList(p);
    // 16-step pattern = 384 ticks; clip of 768 ticks = 2 repeats
    expect(ev.drums).toHaveLength(4);
    expect(ev.drums.map((d) => d.tick)).toEqual([0, 8 * 24 + 2, 384, 384 + 8 * 24 + 2]);
    expect(ev.notes).toHaveLength(2);
    expect(ev.notes[1]!.tick).toBe(384);
    expect(ev.endTick).toBe(768);
  });
  it("honors clip and track mutes and channel mutes", () => {
    const p = demoProject();
    p.clips[0]!.muted = true;
    expect(buildEventList(p).drums).toHaveLength(0);
    const p2 = demoProject();
    p2.tracks[0]!.muted = true;
    expect(buildEventList(p2).drums).toHaveLength(0);
    const p3 = demoProject();
    p3.channels[0]!.muted = true;
    const ev3 = buildEventList(p3);
    expect(ev3.drums).toHaveLength(0);
    expect(ev3.notes.length).toBeGreaterThan(0);
  });
  it("track solo silences other tracks", () => {
    const p = demoProject();
    p.tracks.push({ ...p.tracks[0]!, id: "t2", soloed: true });
    const ev = buildEventList(p);
    expect(ev.drums).toHaveLength(0); // t1 clip suppressed, t2 has no clips
  });
  it("applies swing to off-steps only", () => {
    const p = demoProject();
    p.patterns[0]!.swing = 1;
    p.patterns[0]!.steps.ch_kick = [
      { index: 0, velocity: 1, probability: 1, micro: 0 },
      { index: 1, velocity: 1, probability: 1, micro: 0 },
    ];
    const ev = buildEventList(p);
    expect(ev.drums[0]!.tick).toBe(0);
    expect(ev.drums[1]!.tick).toBe(24 + 12);
  });
  it("audio clips carry trim, fades, gain and stretch into the event", () => {
    const p = demoProject();
    p.assets = [{
      id: "a1", name: "loop", durationSec: 4, sampleRate: 44100, channels: 2, source: "import",
      blobKey: "k", originalBlobKey: null, licenseNote: "", tags: [], favorite: false,
      bpmEstimate: null, keyEstimate: null, aiMeta: null,
    }];
    p.clips.push({
      id: "c2", trackId: "t1", kind: "audio", assetId: "a1", startTick: 384, lengthTicks: 384,
      muted: false, offsetTicks: 96, gainDb: -6, fadeInTicks: 48, fadeOutTicks: 48, reversed: true,
      pitchSemitones: 2, stretch: 1, loopSource: false, automationPoints: [],
    });
    const ev = buildEventList(p);
    expect(ev.audio).toHaveLength(1);
    const a = ev.audio[0]!;
    expect(a.tick).toBe(384);
    expect(a.offsetSec).toBeCloseTo(0.5, 5); // 96 ticks at 120bpm = 0.5s
    expect(a.durSec).toBeCloseTo(2, 5);
    expect(a.gainDb).toBe(-6);
    expect(a.reversed).toBe(true);
    expect(a.fadeInSec).toBeCloseTo(0.25, 5);
  });
  it("automation points become absolute-tick events", () => {
    const p = demoProject();
    p.clips.push({
      id: "c3", trackId: "t1", kind: "automation", startTick: 100, lengthTicks: 200,
      muted: false, offsetTicks: 0, gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false,
      pitchSemitones: 0, stretch: 1, loopSource: false,
      automationTarget: { kind: "mixer-volume", mixerChannelId: MASTER_ID },
      automationPoints: [{ tick: 0, value: 0.5, curve: 0 }, { tick: 150, value: 1, curve: 0 }, { tick: 999, value: 0, curve: 0 }],
    });
    const ev = buildEventList(p);
    expect(ev.automation.map((a) => a.tick)).toEqual([100, 250]); // out-of-clip point dropped
  });
  it("empty project produces empty list", () => {
    const ev = buildEventList(createEmptyProject());
    expect(ev.endTick).toBe(0);
    expect(ev.notes).toHaveLength(0);
  });
  it("ids helper stays collision-free under load", () => {
    expect(new Set(Array.from({ length: 500 }, () => newId("x"))).size).toBe(500);
  });
});
