/**
 * Pure scheduling math: expand a Project's clips into flat, tick-stamped event lists.
 * Consumed by both live playback (engine.ts) and offline export (render.ts), so the
 * exported WAV is scheduled by exactly the code you heard.
 */
import type { Project, Clip, Pattern } from "../../shared/project";
import { TICKS_PER_STEP, swungTick, ticksToSeconds } from "../../shared/time";

export interface NoteEvent {
  tick: number;
  durTicks: number;
  channelId: string;
  pitch: number;
  velocity: number;
  probability: number;
  pan: number;
}
export interface DrumEvent {
  tick: number;
  channelId: string;
  velocity: number;
  probability: number;
}
export interface AudioEvent {
  tick: number;
  clipId: string;
  assetId: string;
  /** seconds into the source buffer to start from (after reverse handling) */
  offsetSec: number;
  durSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
  reversed: boolean;
  pitchSemitones: number;
  stretch: number;
  mixerChannelId: string | null;
}
export interface AutomationEvent {
  tick: number;
  value: number;
  target: NonNullable<Clip["automationTarget"]>;
}
export interface EventList {
  notes: NoteEvent[];
  drums: DrumEvent[];
  audio: AudioEvent[];
  automation: AutomationEvent[];
  endTick: number;
}

function soloActiveTracks(project: Project): Set<string> | null {
  const soloed = project.tracks.filter((t) => t.soloed).map((t) => t.id);
  return soloed.length ? new Set(soloed) : null;
}

function patternEvents(project: Project, pattern: Pattern, clip: Clip, out: EventList) {
  const clipStart = clip.startTick;
  const clipEnd = clip.startTick + clip.lengthTicks;
  const patternTicks = pattern.lengthSteps * TICKS_PER_STEP;
  const swing = pattern.swing || project.swing;
  // pattern loops to fill the clip
  for (let base = 0; base < clip.lengthTicks; base += patternTicks) {
    for (const [channelId, steps] of Object.entries(pattern.steps)) {
      const channel = project.channels.find((c) => c.id === channelId);
      if (!channel || channel.muted) continue;
      for (const step of steps) {
        if (step.index >= pattern.lengthSteps) continue;
        const local = swungTick(step.index * TICKS_PER_STEP, swing) + step.micro;
        const tick = clipStart + base + local - clip.offsetTicks;
        if (tick < clipStart || tick >= clipEnd) continue;
        out.drums.push({ tick, channelId, velocity: step.velocity, probability: step.probability });
      }
    }
    for (const [channelId, notes] of Object.entries(pattern.notes)) {
      const channel = project.channels.find((c) => c.id === channelId);
      if (!channel || channel.muted) continue;
      for (const note of notes) {
        const local = swungTick(note.startTick, swing);
        const tick = clipStart + base + local - clip.offsetTicks;
        if (tick < clipStart || tick >= clipEnd) continue;
        const durTicks = Math.min(note.lengthTicks, clipEnd - tick);
        out.notes.push({ tick, durTicks, channelId, pitch: note.pitch, velocity: note.velocity, probability: note.probability, pan: note.pan });
      }
    }
  }
}

/**
 * Song mode (default): expand every playlist clip.
 * Pattern mode (`opts.patternId`): loop the rack's current pattern by itself —
 * what you hear when jamming in the Channel Rack before arranging anything.
 */
export function buildEventList(project: Project, opts?: { patternId?: string }): EventList {
  const out: EventList = { notes: [], drums: [], audio: [], automation: [], endTick: 0 };
  if (opts?.patternId) {
    const pattern = project.patterns.find((p) => p.id === opts.patternId);
    if (!pattern) return out;
    const lengthTicks = pattern.lengthSteps * TICKS_PER_STEP;
    const virtualClip: Clip = {
      id: "__pattern-mode__", kind: "pattern", trackId: "__rack__", patternId: pattern.id,
      startTick: 0, lengthTicks, offsetTicks: 0, muted: false, gainDb: 0,
      fadeInTicks: 0, fadeOutTicks: 0, reversed: false, pitchSemitones: 0, stretch: 1,
      loopSource: false, automationPoints: [], name: pattern.name,
    };
    patternEvents(project, pattern, virtualClip, out);
    out.endTick = lengthTicks;
    out.notes.sort((a, b) => a.tick - b.tick);
    out.drums.sort((a, b) => a.tick - b.tick);
    return out;
  }
  const solo = soloActiveTracks(project);
  for (const clip of project.clips) {
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!track) continue;
    if (clip.muted || track.muted) continue;
    if (solo && !solo.has(track.id)) continue;
    out.endTick = Math.max(out.endTick, clip.startTick + clip.lengthTicks);
    if (clip.kind === "pattern" && clip.patternId) {
      const pattern = project.patterns.find((p) => p.id === clip.patternId);
      if (pattern) patternEvents(project, pattern, clip, out);
    } else if (clip.kind === "audio" && clip.assetId) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      const bpm = project.bpm;
      const clipLenSec = ticksToSeconds(clip.lengthTicks, bpm);
      const offsetSec = ticksToSeconds(clip.offsetTicks, bpm) * clip.stretch;
      const maxDurSec = Math.max(0.01, (asset.durationSec - offsetSec) / clip.stretch);
      out.audio.push({
        tick: clip.startTick,
        clipId: clip.id,
        assetId: clip.assetId,
        offsetSec,
        durSec: Math.min(clipLenSec, maxDurSec),
        gainDb: clip.gainDb,
        fadeInSec: ticksToSeconds(clip.fadeInTicks, bpm),
        fadeOutSec: ticksToSeconds(clip.fadeOutTicks, bpm),
        reversed: clip.reversed,
        pitchSemitones: clip.pitchSemitones,
        stretch: clip.stretch,
        mixerChannelId: track.mixerChannelId,
      });
    } else if (clip.kind === "automation" && clip.automationTarget) {
      for (const p of clip.automationPoints) {
        if (p.tick > clip.lengthTicks) continue;
        out.automation.push({ tick: clip.startTick + p.tick, value: p.value, target: clip.automationTarget });
      }
    }
  }
  out.notes.sort((a, b) => a.tick - b.tick);
  out.drums.sort((a, b) => a.tick - b.tick);
  out.audio.sort((a, b) => a.tick - b.tick);
  out.automation.sort((a, b) => a.tick - b.tick);
  return out;
}

/** Song length in ticks incl. reverb-tail padding for export. */
export function songEndTick(project: Project): number {
  return buildEventList(project).endTick;
}
