/**
 * Pure command reducer: applyCommand(project, cmd) -> new Project.
 * The ONLY mutation path for AI edits, and reused by UI actions. Immutable-ish:
 * returns a new project object; untouched sub-objects are shared.
 */
import type { Project, Clip, Note } from "../../shared/project";
import { newId, MASTER_ID } from "../../shared/project";
import type { DawCommand } from "../../shared/commands";
import { snapTicks, clamp, TICKS_PER_STEP } from "../../shared/time";
import { parseGrid } from "../../shared/producer";
import { INSTRUMENT_PRESETS } from "../engine/instruments";
import { DRUM_KITS } from "../engine/kits";

export class CommandError extends Error {}

function findOrThrow<T extends { id: string }>(arr: T[], id: string, what: string): T {
  const x = arr.find((e) => e.id === id);
  if (!x) throw new CommandError(`${what} not found: ${id}`);
  return x;
}

export function applyCommand(p: Project, cmd: DawCommand): Project {
  switch (cmd.type) {
    case "pulseTune":
      // async audio operation — performed by the assistant/UI apply layer before
      // dispatch (see applyPlanWithAudio); the project state itself is unchanged here.
      findOrThrow(p.assets, cmd.assetId, "Asset");
      return p;
    case "setBpm":
      return { ...p, bpm: cmd.bpm };
    case "setSwing":
      return { ...p, swing: cmd.swing };
    case "setKeyScale":
      return { ...p, key: cmd.key, scale: cmd.scale };

    case "createTrack": {
      const mixerChannel = {
        id: newId("mx"), name: cmd.name, color: cmd.color ?? "#5a6478", kind: "track" as const,
        volumeDb: 0, pan: 0, muted: false, soloed: false, effects: [], sends: [], outputId: null, sidechainFromId: null,
      };
      const track = {
        id: newId("trk"), name: cmd.name, color: cmd.color ?? "#5a6478", kind: cmd.kind,
        height: 56, muted: false, soloed: false, mixerChannelId: mixerChannel.id, groupId: null, armed: false, inputDeviceId: null,
      };
      return { ...p, tracks: [...p.tracks, track], mixer: { channels: [...p.mixer.channels, mixerChannel] } };
    }
    case "renameTrack": {
      findOrThrow(p.tracks, cmd.trackId, "Track");
      return { ...p, tracks: p.tracks.map((t) => (t.id === cmd.trackId ? { ...t, name: cmd.name } : t)) };
    }
    case "createChannel": {
      const channel = {
        id: newId("ch"), name: cmd.name, color: cmd.color ?? "#e8663c", instrument: cmd.instrument,
        volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null,
      };
      return { ...p, channels: [...p.channels, channel] };
    }
    case "createPattern": {
      const pattern = { id: newId("pat"), name: cmd.name, color: cmd.color ?? "#4cc2ff", lengthSteps: cmd.lengthSteps, steps: {}, notes: {}, swing: 0 };
      return { ...p, patterns: [...p.patterns, pattern] };
    }
    case "setSteps": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      findOrThrow(p.channels, cmd.channelId, "Channel");
      const updated = { ...pattern, steps: { ...pattern.steps, [cmd.channelId]: cmd.steps } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }
    case "addNotes": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      findOrThrow(p.channels, cmd.channelId, "Channel");
      const withIds: Note[] = cmd.notes.map((n) => ({ ...n, id: newId("n") }));
      const existing = cmd.replace ? [] : pattern.notes[cmd.channelId] ?? [];
      const updated = { ...pattern, notes: { ...pattern.notes, [cmd.channelId]: [...existing, ...withIds] } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }
    case "removeNotes": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      const ids = new Set(cmd.noteIds);
      const updated = { ...pattern, notes: { ...pattern.notes, [cmd.channelId]: (pattern.notes[cmd.channelId] ?? []).filter((n) => !ids.has(n.id)) } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }

    case "placePatternClip": {
      const track = findOrThrow(p.tracks, cmd.trackId, "Track");
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      const clip: Clip = {
        id: newId("clip"), trackId: track.id, kind: "pattern", patternId: pattern.id,
        startTick: cmd.startTick, lengthTicks: cmd.lengthTicks ?? pattern.lengthSteps * TICKS_PER_STEP,
        muted: false, offsetTicks: 0, gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false,
        pitchSemitones: 0, stretch: 1, loopSource: false, automationPoints: [], color: pattern.color, name: pattern.name,
      };
      return { ...p, clips: [...p.clips, clip] };
    }
    case "placeAudioClip": {
      const track = findOrThrow(p.tracks, cmd.trackId, "Track");
      const asset = findOrThrow(p.assets, cmd.assetId, "Asset");
      const lengthTicks = cmd.lengthTicks ?? Math.max(TICKS_PER_STEP, Math.round((asset.durationSec / (60 / p.bpm)) * 96));
      const clip: Clip = {
        id: newId("clip"), trackId: track.id, kind: "audio", assetId: asset.id,
        startTick: cmd.startTick, lengthTicks, muted: false, offsetTicks: 0,
        gainDb: cmd.gainDb ?? 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false,
        pitchSemitones: 0, stretch: 1, loopSource: false, automationPoints: [], name: asset.name,
      };
      return { ...p, clips: [...p.clips, clip] };
    }
    case "moveClip": {
      const clip = findOrThrow(p.clips, cmd.clipId, "Clip");
      if (cmd.trackId) findOrThrow(p.tracks, cmd.trackId, "Track");
      return { ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, startTick: cmd.startTick, trackId: cmd.trackId ?? c.trackId } : c)) };
    }
    case "trimClip": {
      const clip = findOrThrow(p.clips, cmd.clipId, "Clip");
      return {
        ...p,
        clips: p.clips.map((c) =>
          c.id === clip.id ? { ...c, startTick: cmd.startTick, lengthTicks: cmd.lengthTicks, offsetTicks: cmd.offsetTicks ?? c.offsetTicks } : c,
        ),
      };
    }
    case "splitClip": {
      const clip = findOrThrow(p.clips, cmd.clipId, "Clip");
      if (cmd.atTick <= clip.startTick || cmd.atTick >= clip.startTick + clip.lengthTicks) {
        throw new CommandError("Split point outside clip");
      }
      const leftLen = cmd.atTick - clip.startTick;
      const left: Clip = { ...clip, lengthTicks: leftLen, fadeOutTicks: 0 };
      const right: Clip = {
        ...clip, id: newId("clip"), startTick: cmd.atTick, lengthTicks: clip.lengthTicks - leftLen,
        offsetTicks: clip.offsetTicks + leftLen, fadeInTicks: 0,
      };
      return { ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) };
    }
    case "deleteClip": {
      findOrThrow(p.clips, cmd.clipId, "Clip");
      return { ...p, clips: p.clips.filter((c) => c.id !== cmd.clipId) };
    }
    case "setClipGain": {
      findOrThrow(p.clips, cmd.clipId, "Clip");
      return { ...p, clips: p.clips.map((c) => (c.id === cmd.clipId ? { ...c, gainDb: cmd.gainDb } : c)) };
    }
    case "setClipFades": {
      findOrThrow(p.clips, cmd.clipId, "Clip");
      return { ...p, clips: p.clips.map((c) => (c.id === cmd.clipId ? { ...c, fadeInTicks: cmd.fadeInTicks ?? c.fadeInTicks, fadeOutTicks: cmd.fadeOutTicks ?? c.fadeOutTicks } : c)) };
    }
    case "setClipMuted": {
      findOrThrow(p.clips, cmd.clipId, "Clip");
      return { ...p, clips: p.clips.map((c) => (c.id === cmd.clipId ? { ...c, muted: cmd.muted } : c)) };
    }
    case "duplicateSection": {
      const from = cmd.startTick;
      const to = from + cmd.lengthTicks;
      const inRange = p.clips.filter((c) => c.startTick >= from && c.startTick < to);
      const copies = inRange.map((c) => ({ ...c, id: newId("clip"), startTick: c.startTick - from + cmd.toTick }));
      const section = cmd.name
        ? [{ id: newId("sec"), name: cmd.name, startTick: cmd.toTick, lengthTicks: cmd.lengthTicks, color: "#7b6cff" }]
        : [];
      return { ...p, clips: [...p.clips, ...copies], sections: [...p.sections, ...section] };
    }
    case "addSection":
      return { ...p, sections: [...p.sections, { id: newId("sec"), name: cmd.name, startTick: cmd.startTick, lengthTicks: cmd.lengthTicks, color: cmd.color ?? "#7b6cff" }] };
    case "addMarker":
      return { ...p, markers: [...p.markers, { id: newId("mk"), name: cmd.name, tick: cmd.tick, color: "#ffd166" }] };

    case "setTrackVolume": {
      findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      return { ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === cmd.mixerChannelId ? { ...c, volumeDb: cmd.volumeDb } : c)) } };
    }
    case "setTrackPan": {
      findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      return { ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === cmd.mixerChannelId ? { ...c, pan: cmd.pan } : c)) } };
    }
    case "setTrackMuted": {
      findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      return { ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === cmd.mixerChannelId ? { ...c, muted: cmd.muted } : c)) } };
    }
    case "addEffect": {
      findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      const fx = { id: newId("fx"), type: cmd.effectType, enabled: true, params: cmd.params };
      return { ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === cmd.mixerChannelId ? { ...c, effects: [...c.effects, fx] } : c)) } };
    }
    case "setEffectParameter": {
      const chan = findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      findOrThrow(chan.effects, cmd.effectId, "Effect");
      return {
        ...p,
        mixer: {
          channels: p.mixer.channels.map((c) =>
            c.id === cmd.mixerChannelId
              ? { ...c, effects: c.effects.map((f) => (f.id === cmd.effectId ? { ...f, params: { ...f.params, [cmd.param]: cmd.value } } : f)) }
              : c,
          ),
        },
      };
    }
    case "removeEffect": {
      const chan = findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      findOrThrow(chan.effects, cmd.effectId, "Effect");
      return { ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === cmd.mixerChannelId ? { ...c, effects: c.effects.filter((f) => f.id !== cmd.effectId) } : c)) } };
    }
    case "createBus": {
      const bus = {
        id: newId("bus"), name: cmd.name, color: "#8a93a6", kind: "bus" as const,
        volumeDb: 0, pan: 0, muted: false, soloed: false, effects: [], sends: [], outputId: MASTER_ID, sidechainFromId: null,
      };
      return { ...p, mixer: { channels: [...p.mixer.channels, bus] } };
    }
    case "addSend": {
      findOrThrow(p.mixer.channels, cmd.fromMixerChannelId, "Mixer channel");
      findOrThrow(p.mixer.channels, cmd.toMixerChannelId, "Mixer channel");
      if (cmd.fromMixerChannelId === cmd.toMixerChannelId) throw new CommandError("Cannot send a channel to itself");
      return {
        ...p,
        mixer: {
          channels: p.mixer.channels.map((c) =>
            c.id === cmd.fromMixerChannelId
              ? { ...c, sends: [...c.sends.filter((s) => s.toChannelId !== cmd.toMixerChannelId), { toChannelId: cmd.toMixerChannelId, levelDb: cmd.levelDb, preFader: false }] }
              : c,
          ),
        },
      };
    }
    case "setSidechain": {
      findOrThrow(p.mixer.channels, cmd.mixerChannelId, "Mixer channel");
      if (cmd.fromMixerChannelId) findOrThrow(p.mixer.channels, cmd.fromMixerChannelId, "Mixer channel");
      return { ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === cmd.mixerChannelId ? { ...c, sidechainFromId: cmd.fromMixerChannelId } : c)) } };
    }
    case "createAutomation": {
      findOrThrow(p.tracks, cmd.trackId, "Track");
      const clip: Clip = {
        id: newId("clip"), trackId: cmd.trackId, kind: "automation",
        startTick: cmd.startTick, lengthTicks: cmd.lengthTicks, muted: false, offsetTicks: 0,
        gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false, pitchSemitones: 0, stretch: 1,
        loopSource: false, automationTarget: cmd.target, automationPoints: cmd.points, name: `Auto: ${cmd.target.kind}`,
      };
      return { ...p, clips: [...p.clips, clip] };
    }

    case "quantizeNotes": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      const grid = snapTicks(cmd.grid === "bar" ? "bar" : cmd.grid === "beat" ? "beat" : cmd.grid, p.timeSignature);
      const notes = (pattern.notes[cmd.channelId] ?? []).map((n) => {
        const target = Math.round(n.startTick / grid) * grid;
        return { ...n, startTick: Math.round(n.startTick + (target - n.startTick) * cmd.amount) };
      });
      const updated = { ...pattern, notes: { ...pattern.notes, [cmd.channelId]: notes } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }
    case "humanizeNotes": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      const notes = (pattern.notes[cmd.channelId] ?? []).map((n) => ({
        ...n,
        startTick: Math.max(0, Math.round(n.startTick + (Math.random() * 2 - 1) * cmd.timingTicks)),
        velocity: clamp(n.velocity + (Math.random() * 2 - 1) * cmd.velocityAmount, 0.05, 1),
      }));
      const updated = { ...pattern, notes: { ...pattern.notes, [cmd.channelId]: notes } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }
    case "transposeNotes": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      const notes = (pattern.notes[cmd.channelId] ?? []).map((n) => ({ ...n, pitch: clamp(n.pitch + cmd.semitones, 0, 127) }));
      const updated = { ...pattern, notes: { ...pattern.notes, [cmd.channelId]: notes } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }
    case "setChannelPreset": {
      const ch = findOrThrow(p.channels, cmd.channelId, "Channel");
      if (ch.instrument.type !== "synth") throw new CommandError(`Channel "${ch.name}" is not an instrument channel`);
      const preset = INSTRUMENT_PRESETS.find((x) => x.id === cmd.presetId);
      if (!preset) throw new CommandError(`Unknown instrument preset: ${cmd.presetId}`);
      return patchChannel(p, ch.id, { name: preset.name, instrument: { type: "synth", synthId: preset.engineId, presetId: preset.id, params: { ...preset.params } } });
    }
    case "setChannelDrumSound": {
      const ch = findOrThrow(p.channels, cmd.channelId, "Channel");
      if (ch.instrument.type !== "drum-sound") throw new CommandError(`Channel "${ch.name}" is not a drum channel`);
      const kit = DRUM_KITS.find((k) => k.id === cmd.kitId);
      if (!kit) throw new CommandError(`Unknown kit: ${cmd.kitId}`);
      const sound = kit.sounds.find((s) => s.id === cmd.sound || s.role === cmd.sound);
      if (!sound) throw new CommandError(`Kit "${kit.name}" has no sound "${cmd.sound}"`);
      return patchChannel(p, ch.id, { name: sound.name, instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id } });
    }
    case "setChannelVolume":
      findOrThrow(p.channels, cmd.channelId, "Channel");
      return patchChannel(p, cmd.channelId, { volumeDb: cmd.volumeDb });
    case "setChannelPan":
      findOrThrow(p.channels, cmd.channelId, "Channel");
      return patchChannel(p, cmd.channelId, { pan: cmd.pan });
    case "setChannelMuted":
      findOrThrow(p.channels, cmd.channelId, "Channel");
      return patchChannel(p, cmd.channelId, { muted: cmd.muted });
    case "setDrumGrid": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      findOrThrow(p.channels, cmd.channelId, "Channel");
      const steps = parseGrid(cmd.grid, pattern.lengthSteps);
      const updated = { ...pattern, steps: { ...pattern.steps, [cmd.channelId]: steps } };
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? updated : x)) };
    }
    case "setPatternSwing": {
      const pattern = findOrThrow(p.patterns, cmd.patternId, "Pattern");
      return { ...p, patterns: p.patterns.map((x) => (x.id === pattern.id ? { ...x, swing: cmd.swing } : x)) };
    }
  }
}

function patchChannel(p: Project, channelId: string, patch: Partial<Project["channels"][number]>): Project {
  return { ...p, channels: p.channels.map((c) => (c.id === channelId ? { ...c, ...patch } : c)) };
}

export function applyCommands(p: Project, cmds: DawCommand[]): Project {
  return cmds.reduce(applyCommand, p);
}
