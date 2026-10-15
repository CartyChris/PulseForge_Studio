/**
 * Production → Project. Turns the producer's output (shared/producer.ts) into a real,
 * fully editable FL-style session:
 *   • one rack channel per drum sound + one per instrument role, routed to named mixer inserts
 *   • patterns per (section × part), reused when a section repeats — "Verse · Drums", "Hook · Bass"
 *   • playlist lanes per part (Drums / Bass / Chords / Melody / Counter / FX / Automation)
 *   • Kick insert keys the sidechain; Reverb + Delay return buses with sends; a Music Bus with a
 *     low-pass filter whose cutoff is automated through intros and builds; a master chain
 * Pure: (project, production) → project. One undo step when applied through the store.
 */
import type { Project, Channel, Pattern, Track, MixerChannel, Clip, EffectInstance, Step, Note } from "../../shared/project";
import { newId, MASTER_ID, ProjectSchema } from "../../shared/project";
import type { Production, PartRole, ResolvedSpec } from "../../shared/producer";
import { TICKS_PER_STEP } from "../../shared/time";
import { getKit } from "../engine/kits";
import { INSTRUMENT_PRESETS, type InstrumentPreset } from "../engine/instruments";
import { EFFECT_DEFS } from "../engine/effects";
import type { EffectType } from "../../shared/project";

const TICKS_PER_BAR = 16 * TICKS_PER_STEP;

export const PART_COLORS: Record<PartRole | "fx" | "automation" | "kick", string> = {
  kick: "#ff8a5c", drums: "#e8663c", bass: "#ffd166", chords: "#4cc2ff", melody: "#8ef58a",
  counter: "#a594ff", fx: "#ff7bd5", automation: "#5ad9c9",
};
export const PART_LABELS: Record<PartRole, string> = { drums: "Drums", bass: "Bass", chords: "Chords", melody: "Melody", counter: "Counter" };

/** Roles added in the 2.0 kit expansion → closest classic role, for kits that predate them. */
const ROLE_FALLBACK: Record<string, string> = {
  snap: "clap", "conga-high": "perc", "conga-low": "tom-low", bongo: "perc", clave: "rimshot",
  woodblock: "click", triangle: "ride", agogo: "cowbell", timbale: "tom-high", "vox-hey": "clap",
  "reverse-cymbal": "crash", riser: "impact",
};

/** Per-drum-role channel defaults: [volumeDb, pan]. */
const DRUM_LEVELS: Record<string, [number, number]> = {
  kick: [0, 0], "kick-808": [-1, 0], snare: [-1.5, 0], clap: [-2.5, 0.04], rimshot: [-5, -0.1],
  "hat-closed": [-7, 0.18], "hat-open": [-9, 0.22], ride: [-10, 0.3], crash: [-9, -0.2],
  shaker: [-11, 0.3], tambourine: [-10, -0.28], cowbell: [-6, -0.15], perc: [-7, -0.25],
  snap: [-4, 0.06], "conga-high": [-7, 0.3], "conga-low": [-6, -0.3], bongo: [-7, 0.2],
  clave: [-8, 0.25], woodblock: [-9, -0.2], triangle: [-12, 0.3], agogo: [-8, -0.2],
  timbale: [-6, 0.15], "vox-hey": [-6, 0], "reverse-cymbal": [-8, 0], riser: [-10, 0], impact: [-6, 0],
  "tom-low": [-4, -0.25], "tom-mid": [-4, 0], "tom-high": [-4, 0.25],
};

export function resolvePreset(candidates: string[]): InstrumentPreset {
  for (const id of candidates) {
    const p = INSTRUMENT_PRESETS.find((x) => x.id === id);
    if (p) return p;
  }
  for (const id of candidates) {
    const p = INSTRUMENT_PRESETS.find((x) => x.engineId === id);
    if (p) return p;
  }
  return INSTRUMENT_PRESETS[0]!;
}

function kitSound(kitId: string, role: string): { kitId: string; soundId: string; name: string } {
  const kit = getKit(kitId);
  const sound = kit.sounds.find((s) => s.role === role)
    ?? kit.sounds.find((s) => s.role === ROLE_FALLBACK[role])
    ?? kit.sounds[0]!;
  return { kitId: kit.id, soundId: sound.id, name: sound.name };
}

/** Build an effect instance with every param known to EFFECT_DEFS, clamped to its range. */
export function makeEffect(type: string, params: Record<string, number>): EffectInstance {
  const def = EFFECT_DEFS[type as EffectType];
  if (!def) throw new Error(`Unknown effect type "${type}"`);
  const full: Record<string, number> = {};
  for (const p of def.params) {
    const v = params[p.key] ?? p.default;
    full[p.key] = Math.min(p.max, Math.max(p.min, v));
  }
  return { id: newId("fx"), type: type as EffectType, enabled: true, params: full };
}

function mixerChannel(name: string, color: string, kind: MixerChannel["kind"], volumeDb = 0, outputId: string | null = MASTER_ID): MixerChannel {
  return { id: newId("mx"), name, color, kind, volumeDb, pan: 0, muted: false, soloed: false, effects: [], sends: [], outputId, sidechainFromId: null };
}

function track(name: string, color: string, kind: Track["kind"], mixerChannelId: string | null): Track {
  return { id: newId("trk"), name, color, kind, height: 56, muted: false, soloed: false, mixerChannelId, groupId: null, armed: false, inputDeviceId: null };
}

function patternClip(trackId: string, pattern: Pattern, startTick: number, lengthTicks: number): Clip {
  return {
    id: newId("clip"), trackId, kind: "pattern", patternId: pattern.id, startTick, lengthTicks,
    muted: false, offsetTicks: 0, gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false,
    pitchSemitones: 0, stretch: 1, loopSource: false, automationPoints: [], color: pattern.color, name: pattern.name,
  };
}

export interface ApplyProductionOptions {
  /** replace = new arrangement in this project (assets/takes kept); append = add after the song end */
  mode: "replace" | "append";
  keepName?: boolean;
}

/** Serializable record of how a project was produced (stored in project.ui.production). */
export function productionRecord(spec: ResolvedSpec) {
  return {
    genre: spec.genre, title: spec.title, mood: spec.mood, seed: spec.seed, bpm: spec.bpm, key: spec.key, scale: spec.scale,
    swing: spec.swing, progression: spec.progressionLabels, styles: spec.styles, instruments: spec.instruments, mix: spec.mix,
    sections: spec.sections.map((s) => ({ name: s.name, role: s.role, bars: s.bars, energy: s.energy, parts: s.parts })),
    generatedAt: new Date().toISOString(),
  };
}

export function applyProduction(project: Project, prod: Production, opts: ApplyProductionOptions = { mode: "replace" }): Project {
  const spec = prod.spec;
  const replace = opts.mode === "replace";
  const existingEnd = replace ? 0 : Math.max(0, ...project.clips.map((c) => c.startTick + c.lengthTicks));
  const offset = replace ? 0 : Math.ceil(existingEnd / TICKS_PER_BAR) * TICKS_PER_BAR;
  const suffix = replace ? "" : ` (${spec.title})`;

  const master = project.mixer.channels.find((c) => c.id === MASTER_ID)!;
  const mixer: MixerChannel[] = replace
    ? [{ ...master, effects: prod.mix.master.map((e) => makeEffect(e.type, e.params)) }]
    : [...project.mixer.channels];
  const channels: Channel[] = replace ? [] : [...project.channels];
  const patterns: Pattern[] = replace ? [] : [...project.patterns];
  const tracks: Track[] = replace ? [] : [...project.tracks];
  const clips: Clip[] = replace ? [] : [...project.clips];
  const sections = replace ? [] : [...project.sections];

  const rolesPresent = new Set(prod.parts.map((p) => p.role));
  const drumRoles = new Set<string>();
  for (const part of prod.parts) for (const r of Object.keys(part.drums ?? {})) drumRoles.add(r);
  const hasFx = prod.fx.length > 0;

  // ── mixer inserts & buses ──
  const reverb = mixerChannel(`Reverb${suffix}`, "#7f8cff", "bus", -4);
  reverb.effects = [makeEffect("reverb", { decay: prod.mix.reverb.decay, preDelay: prod.mix.reverb.preDelay, wet: 1 }), makeEffect("eq3", { low: -10, lowFreq: 300, high: -2 })];
  const delay = mixerChannel(`Delay${suffix}`, "#5ad9c9", "bus", -6);
  delay.effects = [makeEffect("pingpong", { time: prod.mix.delay.time, feedback: prod.mix.delay.feedback, wet: 1 }), makeEffect("eq3", { low: -12, lowFreq: 400, high: -4 })];
  const musicBus = prod.mix.filterSweeps.length ? mixerChannel(`Music Bus${suffix}`, "#4cc2ff", "bus", 0) : null;
  const filterFx = musicBus ? makeEffect("filter", { freq: 20000, q: 0.9, mode: 0 }) : null;
  if (musicBus && filterFx) musicBus.effects = [filterFx];

  const inserts: Partial<Record<PartRole | "kick" | "fx", MixerChannel>> = {};
  const makeInsert = (role: PartRole | "kick" | "fx", name: string) => {
    const plan = prod.mix.parts[role];
    const routesToMusic = musicBus && (role === "chords" || role === "melody" || role === "counter");
    const ch = mixerChannel(`${name}${suffix}`, PART_COLORS[role], "track", plan.volumeDb, routesToMusic ? musicBus.id : MASTER_ID);
    ch.pan = plan.pan;
    ch.effects = plan.effects.map((e) => makeEffect(e.type, e.params));
    if (plan.reverbSendDb !== null) ch.sends.push({ toChannelId: reverb.id, levelDb: plan.reverbSendDb, preFader: false });
    if (plan.delaySendDb !== null) ch.sends.push({ toChannelId: delay.id, levelDb: plan.delaySendDb, preFader: false });
    inserts[role] = ch;
    mixer.push(ch);
    return ch;
  };
  if (drumRoles.has("kick") || drumRoles.has("kick-808")) makeInsert("kick", "Kick");
  if (rolesPresent.has("drums")) makeInsert("drums", "Drums");
  for (const role of ["bass", "chords", "melody", "counter"] as const) if (rolesPresent.has(role)) makeInsert(role, PART_LABELS[role]);
  if (hasFx) makeInsert("fx", "FX");
  // sidechain: anything flagged ducks under the kick insert
  if (inserts.kick) {
    for (const role of ["bass", "chords", "counter"] as const) {
      if (prod.mix.parts[role].sidechained && inserts[role]) inserts[role]!.sidechainFromId = inserts.kick.id;
    }
  }
  if (musicBus) mixer.push(musicBus);
  mixer.push(reverb, delay);

  // ── rack channels ──
  const drumChannel: Record<string, Channel> = {};
  for (const role of drumRoles) {
    const s = kitSound(spec.instruments.kit, role);
    const [vol, pan] = DRUM_LEVELS[role] ?? [-6, 0];
    const isKick = role === "kick" || role === "kick-808";
    const ch: Channel = {
      id: newId("ch"), name: s.name, color: isKick ? PART_COLORS.kick : PART_COLORS.drums,
      instrument: { type: "drum-sound", kitId: s.kitId, soundId: s.soundId },
      volumeDb: vol, pan, muted: false, soloed: false,
      mixerChannelId: (isKick ? inserts.kick : inserts.drums)?.id ?? null,
    };
    drumChannel[role] = ch;
    channels.push(ch);
  }
  const fxChannel: Record<string, Channel> = {};
  for (const role of new Set(prod.fx.map((f) => f.role))) {
    const s = kitSound(spec.instruments.kit, role);
    const [vol, pan] = DRUM_LEVELS[role] ?? [-8, 0];
    const ch: Channel = {
      id: newId("ch"), name: `FX ${s.name}`, color: PART_COLORS.fx,
      instrument: { type: "drum-sound", kitId: s.kitId, soundId: s.soundId },
      volumeDb: vol, pan, muted: false, soloed: false, mixerChannelId: inserts.fx?.id ?? null,
    };
    fxChannel[role] = ch;
    channels.push(ch);
  }
  const synthChannel: Partial<Record<PartRole, Channel>> = {};
  const presetCandidates: Record<Exclude<PartRole, "drums">, string[]> = {
    bass: spec.instruments.bass, chords: spec.instruments.chords, melody: spec.instruments.melody, counter: spec.instruments.counter,
  };
  for (const role of ["bass", "chords", "melody", "counter"] as const) {
    if (!rolesPresent.has(role)) continue;
    const preset = resolvePreset(presetCandidates[role]);
    const ch: Channel = {
      id: newId("ch"), name: `${preset.name}`, color: PART_COLORS[role],
      instrument: { type: "synth", synthId: preset.engineId, presetId: preset.id, params: { ...preset.params } },
      volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: inserts[role]?.id ?? null,
    };
    synthChannel[role] = ch;
    channels.push(ch);
  }

  // ── patterns: one per (section × part), reused across repeats ──
  const patternFor = new Map<string, Pattern>(); // `${section}|${role}`
  for (const part of prod.parts) {
    const steps: Record<string, Step[]> = {};
    const notes: Record<string, Note[]> = {};
    if (part.drums) {
      for (const [role, hits] of Object.entries(part.drums)) {
        const ch = drumChannel[role];
        if (!ch || !hits.length) continue;
        steps[ch.id] = hits.map((h) => ({ index: h.index, velocity: h.velocity, probability: h.probability, micro: h.micro }));
      }
    } else if (part.notes) {
      const ch = synthChannel[part.role];
      if (!ch) continue;
      notes[ch.id] = part.notes.map((n) => ({ id: newId("n"), pitch: n.pitch, startTick: n.startTick, lengthTicks: n.lengthTicks, velocity: n.velocity, pan: 0, probability: 1 }));
    }
    const pat: Pattern = {
      id: newId("pat"), name: `${part.section} · ${PART_LABELS[part.role]}`, color: PART_COLORS[part.role],
      lengthSteps: part.lengthSteps, steps, notes, swing: spec.swing,
    };
    patterns.push(pat);
    patternFor.set(`${part.section}|${part.role}`, pat);
  }
  const fxPattern: Record<string, Pattern> = {};
  for (const [role, ch] of Object.entries(fxChannel)) {
    const pat: Pattern = {
      id: newId("pat"), name: `FX · ${ch.name.replace(/^FX /, "")}`, color: PART_COLORS.fx, lengthSteps: 16,
      steps: { [ch.id]: [{ index: 0, velocity: 0.85, probability: 1, micro: 0 }] }, notes: {}, swing: 0,
    };
    patterns.push(pat);
    fxPattern[role] = pat;
  }

  // ── playlist lanes + arrangement ──
  const lane: Partial<Record<PartRole | "fx" | "automation", Track>> = {};
  for (const role of ["drums", "bass", "chords", "melody", "counter"] as const) {
    if (!rolesPresent.has(role)) continue;
    const t = track(`${PART_LABELS[role]}${suffix}`, PART_COLORS[role], "pattern", (role === "drums" ? inserts.drums : inserts[role])?.id ?? null);
    lane[role] = t;
    tracks.push(t);
  }
  if (hasFx) { lane.fx = track(`FX${suffix}`, PART_COLORS.fx, "pattern", inserts.fx?.id ?? null); tracks.push(lane.fx); }
  if (musicBus && filterFx) { lane.automation = track(`Automation${suffix}`, PART_COLORS.automation, "automation", musicBus.id); tracks.push(lane.automation); }

  for (const sec of prod.sections) {
    const start = offset + sec.startBar * TICKS_PER_BAR;
    const length = sec.bars * TICKS_PER_BAR;
    for (const role of sec.parts) {
      const pat = patternFor.get(`${sec.name}|${role}`);
      const t = lane[role];
      if (pat && t) clips.push(patternClip(t.id, pat, start, length));
    }
    sections.push({ id: newId("sec"), name: sec.name, startTick: start, lengthTicks: length, color: sectionColor(sec.role) });
  }
  for (const f of prod.fx) {
    const pat = fxPattern[f.role];
    if (pat && lane.fx) clips.push(patternClip(lane.fx.id, pat, offset + f.tick, TICKS_PER_BAR));
  }

  // ── filter-sweep automation on the music bus (one point per beat, exponential cutoff curve) ──
  if (musicBus && filterFx && lane.automation) {
    const desc = EFFECT_DEFS.filter.params.find((p) => p.key === "freq")!;
    const norm = (hz: number) => (hz - desc.min) / (desc.max - desc.min);
    for (const sw of prod.mix.filterSweeps) {
      const points = [];
      const beats = Math.max(1, Math.round(sw.lengthTicks / 96));
      for (let b = 0; b <= beats; b++) {
        const t = b / beats;
        const hz = sw.fromHz * Math.pow(sw.toHz / sw.fromHz, t * t); // ease-in so it opens late, like a real sweep
        points.push({ tick: Math.min(sw.lengthTicks, b * 96), value: Math.min(1, Math.max(0, norm(hz))), curve: 0 });
      }
      clips.push({
        id: newId("clip"), trackId: lane.automation.id, kind: "automation", startTick: offset + sw.startTick, lengthTicks: sw.lengthTicks,
        muted: false, offsetTicks: 0, gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0, reversed: false, pitchSemitones: 0, stretch: 1,
        loopSource: false, color: PART_COLORS.automation, name: "Filter sweep",
        automationTarget: { kind: "effect-param", mixerChannelId: musicBus.id, effectId: filterFx.id, param: "freq" },
        automationPoints: points,
      });
    }
  }

  const next = {
    ...project,
    name: replace && !opts.keepName ? spec.title : project.name,
    bpm: replace ? spec.bpm : project.bpm,
    key: replace ? spec.key : project.key,
    scale: replace ? spec.scale : project.scale,
    swing: replace ? spec.swing : project.swing,
    channels, patterns, tracks, clips, sections,
    markers: replace ? [] : project.markers,
    mixer: { channels: mixer },
    loop: replace ? { enabled: false, startTick: 0, endTick: 0 } : project.loop,
    ui: { ...project.ui, production: productionRecord(spec) },
  };
  return ProjectSchema.parse(next);
}

function sectionColor(role: string): string {
  switch (role) {
    case "intro": case "outro": return "#5a6478";
    case "hook": case "chorus": case "drop": return "#e8663c";
    case "build": case "pre-chorus": return "#ffd166";
    case "bridge": case "breakdown": return "#7b6cff";
    default: return "#4cc2ff";
  }
}
