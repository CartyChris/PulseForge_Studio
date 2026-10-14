/**
 * PulseForge project format, schema version 1.
 * Everything in a project serializes to this shape; Zod validates on load,
 * migrateProject() upgrades older versions.
 */
import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1;

const id = z.string().min(1);

export const NoteSchema = z.object({
  id,
  pitch: z.number().int().min(0).max(127),
  startTick: z.number().min(0),
  lengthTicks: z.number().min(1),
  velocity: z.number().min(0).max(1).default(0.8),
  pan: z.number().min(-1).max(1).default(0),
  probability: z.number().min(0).max(1).default(1),
});
export type Note = z.infer<typeof NoteSchema>;

export const StepSchema = z.object({
  index: z.number().int().min(0),
  velocity: z.number().min(0).max(1).default(0.8),
  probability: z.number().min(0).max(1).default(1),
  /** micro-timing offset in ticks, ± half a step */
  micro: z.number().min(-12).max(12).default(0),
});
export type Step = z.infer<typeof StepSchema>;

export const InstrumentRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("drum-kit"), kitId: z.string() }),
  z.object({
    type: z.literal("drum-sound"),
    kitId: z.string(),
    soundId: z.string(),
  }),
  z.object({
    type: z.literal("synth"),
    synthId: z.string(), // registry id, e.g. "subtractive", "fm", "pad", "pluck", "piano", "epiano", "bass808"
    presetId: z.string(),
    params: z.record(z.string(), z.number()).default({}),
  }),
  z.object({
    type: z.literal("sampler"),
    assetId: z.string().nullable().default(null),
    params: z
      .object({
        rootNote: z.number().int().min(0).max(127).default(60),
        startNorm: z.number().min(0).max(1).default(0),
        endNorm: z.number().min(0).max(1).default(1),
        loop: z.boolean().default(false),
        loopStartNorm: z.number().min(0).max(1).default(0),
        loopEndNorm: z.number().min(0).max(1).default(1),
        attack: z.number().min(0).max(10).default(0.002),
        decay: z.number().min(0).max(10).default(0.1),
        sustain: z.number().min(0).max(1).default(1),
        release: z.number().min(0).max(10).default(0.1),
        filterHz: z.number().min(20).max(20000).default(20000),
        gainDb: z.number().min(-48).max(24).default(0),
        pan: z.number().min(-1).max(1).default(0),
        polyphony: z.number().int().min(1).max(32).default(8),
        mono: z.boolean().default(false),
        portamento: z.number().min(0).max(2).default(0),
        reverse: z.boolean().default(false),
        velocityAmount: z.number().min(0).max(1).default(1),
        pitchTrack: z.boolean().default(true),
      })
      .default({}),
  }),
]);
export type InstrumentRef = z.infer<typeof InstrumentRefSchema>;

export const ChannelSchema = z.object({
  id,
  name: z.string(),
  color: z.string().default("#e8663c"),
  instrument: InstrumentRefSchema,
  volumeDb: z.number().min(-60).max(12).default(0),
  pan: z.number().min(-1).max(1).default(0),
  muted: z.boolean().default(false),
  soloed: z.boolean().default(false),
  mixerChannelId: z.string().nullable().default(null),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const PatternSchema = z.object({
  id,
  name: z.string(),
  color: z.string().default("#4cc2ff"),
  lengthSteps: z.number().int().min(1).max(256).default(16),
  /** channelId -> active steps (sparse) */
  steps: z.record(z.string(), z.array(StepSchema)).default({}),
  /** channelId -> piano-roll notes */
  notes: z.record(z.string(), z.array(NoteSchema)).default({}),
  swing: z.number().min(0).max(1).default(0),
});
export type Pattern = z.infer<typeof PatternSchema>;

export const EffectTypeSchema = z.enum([
  "eq3", "compressor", "limiter", "gate", "reverb", "delay", "chorus", "flanger",
  "phaser", "distortion", "saturation", "filter", "widener", "tremolo", "gain",
  "deesser", "bitcrusher", "lofi", "transient",
  "multiband", "autopan", "pingpong", "autowah", "pitchshift", "vibrato", "ringmod",
]);
export type EffectType = z.infer<typeof EffectTypeSchema>;

export const EffectInstanceSchema = z.object({
  id,
  type: EffectTypeSchema,
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.number()).default({}),
  presetName: z.string().optional(),
});
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;

export const SendSchema = z.object({
  toChannelId: z.string(),
  levelDb: z.number().min(-60).max(6).default(-12),
  preFader: z.boolean().default(false),
});
export type Send = z.infer<typeof SendSchema>;

export const MixerChannelSchema = z.object({
  id,
  name: z.string(),
  color: z.string().default("#8a93a6"),
  kind: z.enum(["track", "bus", "master"]).default("track"),
  volumeDb: z.number().min(-60).max(12).default(0),
  pan: z.number().min(-1).max(1).default(0),
  muted: z.boolean().default(false),
  soloed: z.boolean().default(false),
  effects: z.array(EffectInstanceSchema).default([]),
  sends: z.array(SendSchema).default([]),
  /** where this channel's output goes; null = master */
  outputId: z.string().nullable().default(null),
  /** sidechain source mixer channel (used by compressor's sidechain mode) */
  sidechainFromId: z.string().nullable().default(null),
});
export type MixerChannel = z.infer<typeof MixerChannelSchema>;

export const TrackKindSchema = z.enum(["pattern", "audio", "instrument", "automation", "group"]);
export const TrackSchema = z.object({
  id,
  name: z.string(),
  color: z.string().default("#5a6478"),
  kind: TrackKindSchema.default("pattern"),
  height: z.number().min(28).max(200).default(56),
  muted: z.boolean().default(false),
  soloed: z.boolean().default(false),
  /** mixer channel this track feeds */
  mixerChannelId: z.string().nullable().default(null),
  groupId: z.string().nullable().default(null),
  armed: z.boolean().default(false),
  inputDeviceId: z.string().nullable().default(null),
});
export type Track = z.infer<typeof TrackSchema>;

export const AutomationPointSchema = z.object({
  tick: z.number().min(0),
  value: z.number(), // normalized 0..1 in target's range
  curve: z.number().min(-1).max(1).default(0),
});
export const AutomationTargetSchema = z.object({
  kind: z.enum(["mixer-volume", "mixer-pan", "effect-param", "channel-volume", "bpm"]),
  mixerChannelId: z.string().optional(),
  channelId: z.string().optional(),
  effectId: z.string().optional(),
  param: z.string().optional(),
});
export type AutomationTarget = z.infer<typeof AutomationTargetSchema>;

export const ClipSchema = z.object({
  id,
  trackId: z.string(),
  kind: z.enum(["pattern", "audio", "automation"]),
  startTick: z.number().min(0),
  lengthTicks: z.number().min(1),
  color: z.string().optional(),
  name: z.string().optional(),
  muted: z.boolean().default(false),
  // pattern clips
  patternId: z.string().optional(),
  // audio clips
  assetId: z.string().optional(),
  /** trim offset into the source, in ticks at project tempo */
  offsetTicks: z.number().min(0).default(0),
  gainDb: z.number().min(-48).max(24).default(0),
  fadeInTicks: z.number().min(0).default(0),
  fadeOutTicks: z.number().min(0).default(0),
  reversed: z.boolean().default(false),
  pitchSemitones: z.number().min(-24).max(24).default(0),
  /** playback-rate stretch: 1 = original speed */
  stretch: z.number().min(0.25).max(4).default(1),
  loopSource: z.boolean().default(false),
  // automation clips
  automationTarget: AutomationTargetSchema.optional(),
  automationPoints: z.array(AutomationPointSchema).default([]),
});
export type Clip = z.infer<typeof ClipSchema>;

export const AudioAssetSchema = z.object({
  id,
  name: z.string(),
  durationSec: z.number().min(0),
  sampleRate: z.number().default(44100),
  channels: z.number().int().min(1).max(2).default(2),
  source: z.enum(["import", "recording", "ai", "render", "slice", "factory"]),
  blobKey: z.string(),
  /** untouched original for recovery (recordings/imports keep theirs) */
  originalBlobKey: z.string().nullable().default(null),
  licenseNote: z.string().default(""),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  bpmEstimate: z.number().nullable().default(null),
  keyEstimate: z.string().nullable().default(null),
  aiMeta: z
    .object({
      providerId: z.string(),
      model: z.string().default(""),
      prompt: z.string().default(""),
      jobId: z.string().default(""),
      createdAt: z.string().default(""),
    })
    .nullable()
    .default(null),
});
export type AudioAsset = z.infer<typeof AudioAssetSchema>;

export const TakeSchema = z.object({
  id,
  trackId: z.string(),
  assetId: z.string(),
  startTick: z.number().min(0),
  lengthTicks: z.number().min(1),
  lane: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  recordedAt: z.string().default(""),
});
export type Take = z.infer<typeof TakeSchema>;

export const MarkerSchema = z.object({
  id,
  name: z.string(),
  tick: z.number().min(0),
  color: z.string().default("#ffd166"),
});
export const SectionSchema = z.object({
  id,
  name: z.string(), // "Intro", "Verse", "Chorus"...
  startTick: z.number().min(0),
  lengthTicks: z.number().min(1),
  color: z.string().default("#7b6cff"),
});
export type Section = z.infer<typeof SectionSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.number().int(),
  /** free-form session/collab notes; travels with portable project export */
  notes: z.string().default(""),
  id,
  name: z.string().default("Untitled"),
  createdAt: z.string(),
  modifiedAt: z.string(),
  bpm: z.number().min(20).max(400).default(120),
  timeSignature: z.object({ num: z.number().int().min(1).max(16).default(4), den: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]).default(4) }).default({ num: 4, den: 4 }),
  swing: z.number().min(0).max(1).default(0),
  key: z.string().default("C"),
  scale: z.string().default("minor"),
  channels: z.array(ChannelSchema).default([]),
  patterns: z.array(PatternSchema).default([]),
  tracks: z.array(TrackSchema).default([]),
  clips: z.array(ClipSchema).default([]),
  mixer: z.object({ channels: z.array(MixerChannelSchema) }),
  assets: z.array(AudioAssetSchema).default([]),
  takes: z.array(TakeSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  sections: z.array(SectionSchema).default([]),
  loop: z.object({ enabled: z.boolean().default(false), startTick: z.number().min(0).default(0), endTick: z.number().min(0).default(0) }).default({ enabled: false, startTick: 0, endTick: 0 }),
  metronome: z.boolean().default(false),
  countInBars: z.number().int().min(0).max(4).default(1),
  ui: z.record(z.string(), z.unknown()).default({}),
});
export type Project = z.infer<typeof ProjectSchema>;

let idCounter = 0;
export function newId(prefix = "pf"): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export const MASTER_ID = "master";

export function createEmptyProject(name = "Untitled", bpm = 120): Project {
  const now = new Date().toISOString();
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newId("proj"),
    name,
    createdAt: now,
    modifiedAt: now,
    bpm,
    mixer: {
      channels: [
        { id: MASTER_ID, name: "Master", kind: "master", color: "#e8663c", volumeDb: 0, pan: 0, muted: false, soloed: false, effects: [], sends: [], outputId: null, sidechainFromId: null },
      ],
    },
  });
}

/** Upgrade any older project JSON to the current schema. Throws on invalid input. */
export function migrateProject(raw: unknown): Project {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") throw new Error("Not a PulseForge project");
  const version = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new Error(`Project schema v${version} is newer than this app supports (v${PROJECT_SCHEMA_VERSION})`);
  }
  // v0 (pre-release) → v1: no released v0 projects exist; treat as v1 candidate.
  const candidate = { ...obj, schemaVersion: PROJECT_SCHEMA_VERSION };
  return ProjectSchema.parse(candidate);
}
