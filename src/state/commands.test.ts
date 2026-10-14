import { describe, it, expect } from "vitest";
import { createEmptyProject, MASTER_ID } from "../../shared/project";
import { applyCommand, applyCommands, CommandError } from "./commands";
import { validateEditPlan } from "../../shared/commands";

function base() {
  let p = createEmptyProject("cmd-test", 120);
  p = applyCommand(p, { type: "createTrack", name: "Drums", kind: "pattern" });
  p = applyCommand(p, { type: "createChannel", name: "Kick", instrument: { type: "drum-sound", kitId: "trap-808", soundId: "trap-808/kick" } });
  p = applyCommand(p, { type: "createPattern", name: "P1", lengthSteps: 16 });
  return p;
}

describe("command reducer", () => {
  it("creates tracks with paired mixer channels", () => {
    const p = base();
    expect(p.tracks).toHaveLength(1);
    expect(p.mixer.channels).toHaveLength(2); // master + drums
    expect(p.tracks[0]!.mixerChannelId).toBe(p.mixer.channels[1]!.id);
  });
  it("sets steps and notes, places clips, splits and trims", () => {
    let p = base();
    const patternId = p.patterns[0]!.id;
    const channelId = p.channels[0]!.id;
    const trackId = p.tracks[0]!.id;
    p = applyCommands(p, [
      { type: "setSteps", patternId, channelId, steps: [{ index: 0, velocity: 1, probability: 1, micro: 0 }] },
      { type: "addNotes", patternId, channelId, replace: false, notes: [{ pitch: 60, startTick: 0, lengthTicks: 96, velocity: 0.8, pan: 0, probability: 1 }] },
      { type: "placePatternClip", trackId, patternId, startTick: 0, lengthTicks: 768 },
    ]);
    expect(p.patterns[0]!.steps[channelId]).toHaveLength(1);
    expect(p.patterns[0]!.notes[channelId]).toHaveLength(1);
    expect(p.clips).toHaveLength(1);
    const clipId = p.clips[0]!.id;
    p = applyCommand(p, { type: "splitClip", clipId, atTick: 384 });
    expect(p.clips).toHaveLength(2);
    expect(p.clips[0]!.lengthTicks).toBe(384);
    expect(p.clips[1]!.startTick).toBe(384);
    expect(p.clips[1]!.offsetTicks).toBe(384);
    p = applyCommand(p, { type: "trimClip", clipId: p.clips[0]!.id, startTick: 96, lengthTicks: 288 });
    expect(p.clips[0]!.startTick).toBe(96);
  });
  it("rejects invalid split points and unknown ids", () => {
    let p = base();
    p = applyCommand(p, { type: "placePatternClip", trackId: p.tracks[0]!.id, patternId: p.patterns[0]!.id, startTick: 0, lengthTicks: 100 });
    expect(() => applyCommand(p, { type: "splitClip", clipId: p.clips[0]!.id, atTick: 500 })).toThrow(CommandError);
    expect(() => applyCommand(p, { type: "deleteClip", clipId: "nope" })).toThrow(/not found/);
    expect(() => applyCommand(p, { type: "setSteps", patternId: "nope", channelId: p.channels[0]!.id, steps: [] })).toThrow(/not found/);
  });
  it("mixer commands: volume, effects, buses, sends, sidechain", () => {
    let p = base();
    p = applyCommands(p, [
      { type: "setTrackVolume", mixerChannelId: MASTER_ID, volumeDb: -3 },
      { type: "addEffect", mixerChannelId: MASTER_ID, effectType: "compressor", params: { threshold: -18 } },
      { type: "createBus", name: "Reverb Bus" },
    ]);
    expect(p.mixer.channels.find((c) => c.id === MASTER_ID)?.volumeDb).toBe(-3);
    const fx = p.mixer.channels.find((c) => c.id === MASTER_ID)!.effects[0]!;
    const bus = p.mixer.channels.find((c) => c.kind === "bus")!;
    p = applyCommands(p, [
      { type: "setEffectParameter", mixerChannelId: MASTER_ID, effectId: fx.id, param: "ratio", value: 6 },
      { type: "addSend", fromMixerChannelId: p.tracks[0]!.mixerChannelId!, toMixerChannelId: bus.id, levelDb: -10 },
      { type: "setSidechain", mixerChannelId: bus.id, fromMixerChannelId: p.tracks[0]!.mixerChannelId! },
    ]);
    expect(p.mixer.channels.find((c) => c.id === MASTER_ID)!.effects[0]!.params.ratio).toBe(6);
    expect(p.mixer.channels.find((c) => c.id === p.tracks[0]!.mixerChannelId)!.sends).toHaveLength(1);
    expect(p.mixer.channels.find((c) => c.id === bus.id)!.sidechainFromId).toBe(p.tracks[0]!.mixerChannelId);
    expect(() => applyCommand(p, { type: "addSend", fromMixerChannelId: bus.id, toMixerChannelId: bus.id, levelDb: 0 })).toThrow(/itself/);
  });
  it("quantize snaps notes toward the grid", () => {
    let p = base();
    const patternId = p.patterns[0]!.id;
    const channelId = p.channels[0]!.id;
    p = applyCommand(p, { type: "addNotes", patternId, channelId, replace: false, notes: [{ pitch: 60, startTick: 30, lengthTicks: 24, velocity: 0.8, pan: 0, probability: 1 }] });
    p = applyCommand(p, { type: "quantizeNotes", patternId, channelId, grid: "step", amount: 1 });
    expect(p.patterns[0]!.notes[channelId]![0]!.startTick).toBe(24);
    p = applyCommand(p, { type: "transposeNotes", patternId, channelId, semitones: 12 });
    expect(p.patterns[0]!.notes[channelId]![0]!.pitch).toBe(72);
  });
  it("duplicateSection copies clips and creates a section label", () => {
    let p = base();
    p = applyCommand(p, { type: "placePatternClip", trackId: p.tracks[0]!.id, patternId: p.patterns[0]!.id, startTick: 0, lengthTicks: 384 });
    p = applyCommand(p, { type: "duplicateSection", startTick: 0, lengthTicks: 384, toTick: 768, name: "Chorus 2" });
    expect(p.clips).toHaveLength(2);
    expect(p.clips[1]!.startTick).toBe(768);
    expect(p.sections.find((s) => s.name === "Chorus 2")?.startTick).toBe(768);
  });
  it("a full validated AI edit plan applies atomically", () => {
    const p = base();
    const plan = validateEditPlan({
      version: 1,
      title: "Build a beat",
      commands: [
        { type: "setBpm", bpm: 90 },
        { type: "setSteps", patternId: p.patterns[0]!.id, channelId: p.channels[0]!.id, steps: [0, 4, 8, 12].map((i) => ({ index: i, velocity: 0.9, probability: 1, micro: 0 })) },
        { type: "placePatternClip", trackId: p.tracks[0]!.id, patternId: p.patterns[0]!.id, startTick: 0, lengthTicks: 1536 },
      ],
    });
    const next = applyCommands(p, plan.commands);
    expect(next.bpm).toBe(90);
    expect(next.clips).toHaveLength(1);
    // original untouched (undo safety)
    expect(p.bpm).toBe(120);
    expect(p.clips).toHaveLength(0);
  });
});
