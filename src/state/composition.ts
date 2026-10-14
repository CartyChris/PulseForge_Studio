/**
 * Turn a validated AI Composition into project structure, rendered through
 * built-in instruments. Pure functions: (project, composition, options) -> project.
 */
import type { Project, Pattern, Note, Channel } from "../../shared/project";
import { newId } from "../../shared/project";
import type { Composition, CompositionSection } from "../../shared/composition";
import { TICKS_PER_STEP, ticksPerBar } from "../../shared/time";
import { getKit } from "../engine/kits";
import { INSTRUMENT_PRESETS } from "../engine/instruments";

export interface InsertOptions {
  mode: "full" | "sections" | "notes-only" | "drums-only" | "alternate" | "replace-pattern";
  sectionNames?: string[];
  atTick?: number;
  replacePatternId?: string;
  applyTempo?: boolean;
}

interface RoleChannels {
  drums: Record<string, Channel>; // role -> channel
  bass: Channel | null;
  chords: Channel | null;
  melody: Channel | null;
  counter: Channel | null;
}

function synthChannel(name: string, presetIdWanted: string, color: string): Channel {
  const preset = INSTRUMENT_PRESETS.find((p) => p.id === presetIdWanted || p.engineId === presetIdWanted) ?? INSTRUMENT_PRESETS[0]!;
  return {
    id: newId("ch"), name, color,
    instrument: { type: "synth", synthId: preset.engineId, presetId: preset.id, params: preset.params },
    volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null,
  };
}

/** Find-or-create the channels a composition needs. Returns updated project + mapping. */
function ensureChannels(p: Project, comp: Composition): { project: Project; roles: RoleChannels } {
  const channels = [...p.channels];
  const kit = getKit(comp.instrumentAssignments.drumsKitId);
  const drums: Record<string, Channel> = {};
  const rolesUsed = new Set<string>();
  for (const s of comp.sections) for (const h of s.drumPattern) rolesUsed.add(h.sound);

  for (const role of rolesUsed) {
    const sound = kit.sounds.find((x) => x.role === role) ?? kit.sounds[0]!;
    let chan = channels.find((c) => c.instrument.type === "drum-sound" && c.instrument.kitId === kit.id && c.instrument.soundId === sound.id);
    if (!chan) {
      chan = {
        id: newId("ch"), name: sound.name, color: "#e8663c",
        instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id },
        volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null,
      };
      channels.push(chan);
    }
    drums[role] = chan;
  }

  const need = (want: string, label: string, color: string, hasContent: boolean): Channel | null => {
    if (!hasContent) return null;
    let chan = channels.find((c) => c.instrument.type === "synth" && c.name === label);
    if (!chan) {
      chan = synthChannel(label, want, color);
      channels.push(chan);
    }
    return chan;
  };
  const hasAny = (k: keyof CompositionSection) => comp.sections.some((s) => (s[k] as unknown[]).length > 0);
  const roles: RoleChannels = {
    drums,
    bass: need(comp.instrumentAssignments.bassSynthId, "AI Bass", "#ffd166", hasAny("bassNotes")),
    chords: need(comp.instrumentAssignments.chordsSynthId, "AI Chords", "#4cc2ff", hasAny("chordNotes")),
    melody: need(comp.instrumentAssignments.melodySynthId, "AI Melody", "#8ef58a", hasAny("melodyNotes")),
    counter: need(comp.instrumentAssignments.counterMelodySynthId, "AI Counter", "#7b6cff", hasAny("counterMelodyNotes")),
  };
  return { project: { ...p, channels }, roles };
}

function sectionToPattern(section: CompositionSection, roles: RoleChannels, drumsOnly: boolean, notesOnly: boolean): Pattern {
  const lengthSteps = section.lengthBars * 16;
  const steps: Pattern["steps"] = {};
  const notes: Pattern["notes"] = {};

  if (!notesOnly) {
    for (const hit of section.drumPattern) {
      const chan = roles.drums[hit.sound];
      if (!chan || hit.step >= lengthSteps) continue;
      const arr = steps[chan.id] ?? [];
      if (!arr.some((s) => s.index === hit.step)) {
        arr.push({ index: hit.step, velocity: hit.velocity, probability: 1, micro: 0 });
      }
      steps[chan.id] = arr;
    }
  }
  if (!drumsOnly) {
    const noteSets: Array<[Channel | null, CompositionSection["bassNotes"]]> = [
      [roles.bass, section.bassNotes],
      [roles.chords, section.chordNotes],
      [roles.melody, section.melodyNotes],
      [roles.counter, section.counterMelodyNotes],
    ];
    for (const [chan, evs] of noteSets) {
      if (!chan || !evs.length) continue;
      const out: Note[] = [];
      for (const ev of evs) {
        if (ev.startStep >= lengthSteps) continue;
        out.push({
          id: newId("n"),
          pitch: ev.pitch,
          startTick: Math.round(ev.startStep * TICKS_PER_STEP),
          lengthTicks: Math.max(6, Math.round(ev.lengthSteps * TICKS_PER_STEP)),
          velocity: ev.velocity,
          pan: 0,
          probability: 1,
        });
      }
      notes[chan.id] = out;
    }
  }
  return {
    id: newId("pat"),
    name: section.name,
    color: "#7b6cff",
    lengthSteps,
    steps,
    notes,
    swing: 0,
  };
}

export function insertComposition(project: Project, comp: Composition, opts: InsertOptions): Project {
  const drumsOnly = opts.mode === "drums-only";
  const notesOnly = opts.mode === "notes-only";
  const ensured = ensureChannels(project, comp);
  const roles = ensured.roles;
  let p = ensured.project;

  if (opts.applyTempo !== false && (opts.mode === "full" || opts.mode === "alternate")) {
    p = { ...p, bpm: comp.bpm, key: comp.key, scale: comp.scale };
  }

  const wanted = opts.sectionNames?.length
    ? comp.sections.filter((s) => opts.sectionNames!.includes(s.name))
    : comp.sections;

  const patterns = [...p.patterns];
  const created: Array<{ pattern: Pattern; section: CompositionSection }> = [];
  for (const section of wanted) {
    const pat = sectionToPattern(section, roles, drumsOnly, notesOnly);
    patterns.push(pat);
    created.push({ pattern: pat, section });
  }

  if (opts.mode === "replace-pattern" && opts.replacePatternId && created[0]) {
    // graft the first generated pattern's contents into the target pattern
    const target = patterns.find((x) => x.id === opts.replacePatternId);
    if (target) {
      const src = created[0].pattern;
      const replaced = { ...target, steps: src.steps, notes: src.notes, lengthSteps: src.lengthSteps };
      return { ...p, patterns: p.patterns.map((x) => (x.id === target.id ? replaced : x)).concat([]) };
    }
  }

  // arrange on a track
  let tracks = p.tracks;
  let mixer = p.mixer;
  let trackId = tracks.find((t) => t.name === "AI Arrangement")?.id;
  if (!trackId) {
    const mixerChannel = {
      id: newId("mx"), name: "AI Arrangement", color: "#7b6cff", kind: "track" as const,
      volumeDb: 0, pan: 0, muted: false, soloed: false, effects: [], sends: [], outputId: null, sidechainFromId: null,
    };
    const track = {
      id: newId("trk"), name: "AI Arrangement", color: "#7b6cff", kind: "pattern" as const,
      height: 56, muted: false, soloed: false, mixerChannelId: mixerChannel.id, groupId: null, armed: false, inputDeviceId: null,
    };
    tracks = [...tracks, track];
    mixer = { channels: [...mixer.channels, mixerChannel] };
    trackId = track.id;
  }

  const clips = [...p.clips];
  const sections = [...p.sections];
  const songEnd = Math.max(0, ...clips.map((c) => c.startTick + c.lengthTicks));
  let cursor = opts.atTick ?? (opts.mode === "alternate" ? songEnd + ticksPerBar(p.timeSignature) : songEnd);
  for (const { pattern, section } of created) {
    const lengthTicks = pattern.lengthSteps * TICKS_PER_STEP;
    clips.push({
      id: newId("clip"), trackId, kind: "pattern", patternId: pattern.id,
      startTick: cursor, lengthTicks, muted: false, offsetTicks: 0, gainDb: 0,
      fadeInTicks: 0, fadeOutTicks: 0, reversed: false, pitchSemitones: 0, stretch: 1,
      loopSource: false, automationPoints: [], color: pattern.color, name: pattern.name,
    });
    sections.push({ id: newId("sec"), name: section.name, startTick: cursor, lengthTicks, color: "#7b6cff" });
    cursor += lengthTicks;
  }

  return { ...p, patterns, tracks, mixer, clips, sections };
}

/** Compact structured project summary for AI context (never raw app state). */
export function projectSummary(p: Project): string {
  const lines: string[] = [
    `Project "${p.name}": ${p.bpm} BPM, ${p.timeSignature.num}/${p.timeSignature.den}, key ${p.key} ${p.scale}, swing ${p.swing}`,
    `Tracks (${p.tracks.length}):`,
    ...p.tracks.map((t) => `  - id=${t.id} "${t.name}" kind=${t.kind} mixerChannelId=${t.mixerChannelId ?? "none"}${t.muted ? " muted" : ""}`),
    `Channels (${p.channels.length}):`,
    ...p.channels.map((c) => `  - id=${c.id} "${c.name}" ${c.instrument.type === "synth" ? `synth:${c.instrument.synthId}` : c.instrument.type}${c.muted ? " muted" : ""}`),
    `Patterns (${p.patterns.length}):`,
    ...p.patterns.map((pat) => {
      const stepCount = Object.values(pat.steps).reduce((a, s) => a + s.length, 0);
      const noteCount = Object.values(pat.notes).reduce((a, n) => a + n.length, 0);
      return `  - id=${pat.id} "${pat.name}" ${pat.lengthSteps} steps, ${stepCount} drum hits, ${noteCount} notes`;
    }),
    `Clips (${p.clips.length}):`,
    ...p.clips.slice(0, 60).map((c) => `  - id=${c.id} track=${c.trackId} ${c.kind} @${c.startTick}t len=${c.lengthTicks}t${c.patternId ? ` pattern=${c.patternId}` : ""}${c.assetId ? ` asset=${c.assetId}` : ""}${c.muted ? " muted" : ""}`),
    `Mixer channels (${p.mixer.channels.length}):`,
    ...p.mixer.channels.map((m) => `  - id=${m.id} "${m.name}" ${m.kind} vol=${m.volumeDb}dB pan=${m.pan}${m.effects.length ? ` fx=[${m.effects.map((f) => `${f.id}:${f.type}`).join(",")}]` : ""}${m.sends.length ? ` sends=[${m.sends.map((s) => s.toChannelId).join(",")}]` : ""}`),
    `Audio assets (${p.assets.length}):`,
    ...p.assets.slice(0, 40).map((a) => `  - id=${a.id} "${a.name}" ${a.durationSec.toFixed(1)}s src=${a.source}${a.bpmEstimate ? ` ~${a.bpmEstimate}bpm` : ""}`),
    `Sections: ${p.sections.map((s) => `"${s.name}"@${s.startTick}t`).join(", ") || "none"}`,
    `Song length: ${Math.max(0, ...p.clips.map((c) => c.startTick + c.lengthTicks))} ticks (96/beat)`,
  ];
  return lines.join("\n");
}

/** Song structure view (getSongStructure tool). */
export function songStructure(p: Project): string {
  if (!p.sections.length) return "No labeled sections yet.";
  return [...p.sections]
    .sort((a, b) => a.startTick - b.startTick)
    .map((s) => `${s.name}: bar ${Math.floor(s.startTick / ticksPerBar(p.timeSignature)) + 1}, ${Math.round(s.lengthTicks / ticksPerBar(p.timeSignature))} bars`)
    .join("\n");
}
