/**
 * Validated, reversible DAW commands. This is the ONLY way AI (and the assistant UI)
 * mutates a project — no code execution, every command Zod-validated and undoable.
 */
import { z } from "zod";
import { NoteSchema, StepSchema, EffectTypeSchema, InstrumentRefSchema, AutomationTargetSchema, AutomationPointSchema } from "./project";

const tick = z.number().min(0);

export const DawCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setBpm"), bpm: z.number().min(20).max(400) }),
  z.object({
    // EXPERIMENTAL pitch correction on an audio asset — async audio op executed by the
    // studio's apply layer (creates a NEW asset, original untouched); reducer is a no-op.
    type: z.literal("pulseTune"),
    assetId: z.string(),
    rootPc: z.number().int().min(0).max(11),
    scaleName: z.string(),
    strength: z.number().min(0).max(1),
    retuneMs: z.number().min(0).max(400),
    humanize: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("setSwing"), swing: z.number().min(0).max(1) }),
  z.object({ type: z.literal("setKeyScale"), key: z.string(), scale: z.string() }),
  z.object({
    type: z.literal("createTrack"),
    name: z.string(),
    kind: z.enum(["pattern", "audio", "instrument", "automation", "group"]).default("pattern"),
    color: z.string().optional(),
  }),
  z.object({ type: z.literal("renameTrack"), trackId: z.string(), name: z.string() }),
  z.object({
    type: z.literal("createChannel"),
    name: z.string(),
    instrument: InstrumentRefSchema,
    color: z.string().optional(),
  }),
  z.object({
    type: z.literal("createPattern"),
    name: z.string(),
    lengthSteps: z.number().int().min(1).max(256).default(16),
    color: z.string().optional(),
  }),
  z.object({
    type: z.literal("setSteps"),
    patternId: z.string(),
    channelId: z.string(),
    steps: z.array(StepSchema),
  }),
  z.object({
    type: z.literal("addNotes"),
    patternId: z.string(),
    channelId: z.string(),
    notes: z.array(NoteSchema.omit({ id: true })),
    replace: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("removeNotes"),
    patternId: z.string(),
    channelId: z.string(),
    noteIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("placePatternClip"),
    trackId: z.string(),
    patternId: z.string(),
    startTick: tick,
    lengthTicks: z.number().min(1).optional(),
  }),
  z.object({
    type: z.literal("placeAudioClip"),
    trackId: z.string(),
    assetId: z.string(),
    startTick: tick,
    lengthTicks: z.number().min(1).optional(),
    gainDb: z.number().min(-48).max(24).optional(),
  }),
  z.object({ type: z.literal("moveClip"), clipId: z.string(), startTick: tick, trackId: z.string().optional() }),
  z.object({ type: z.literal("trimClip"), clipId: z.string(), startTick: tick, lengthTicks: z.number().min(1), offsetTicks: z.number().min(0).optional() }),
  z.object({ type: z.literal("splitClip"), clipId: z.string(), atTick: tick }),
  z.object({ type: z.literal("deleteClip"), clipId: z.string() }),
  z.object({ type: z.literal("setClipGain"), clipId: z.string(), gainDb: z.number().min(-48).max(24) }),
  z.object({ type: z.literal("setClipFades"), clipId: z.string(), fadeInTicks: tick.optional(), fadeOutTicks: tick.optional() }),
  z.object({ type: z.literal("setClipMuted"), clipId: z.string(), muted: z.boolean() }),
  z.object({
    type: z.literal("duplicateSection"),
    startTick: tick,
    lengthTicks: z.number().min(1),
    toTick: tick,
    name: z.string().optional(),
  }),
  z.object({ type: z.literal("addSection"), name: z.string(), startTick: tick, lengthTicks: z.number().min(1), color: z.string().optional() }),
  z.object({ type: z.literal("addMarker"), name: z.string(), tick }),
  z.object({ type: z.literal("setTrackVolume"), mixerChannelId: z.string(), volumeDb: z.number().min(-60).max(12) }),
  z.object({ type: z.literal("setTrackPan"), mixerChannelId: z.string(), pan: z.number().min(-1).max(1) }),
  z.object({ type: z.literal("setTrackMuted"), mixerChannelId: z.string(), muted: z.boolean() }),
  z.object({
    type: z.literal("addEffect"),
    mixerChannelId: z.string(),
    effectType: EffectTypeSchema,
    params: z.record(z.string(), z.number()).default({}),
  }),
  z.object({
    type: z.literal("setEffectParameter"),
    mixerChannelId: z.string(),
    effectId: z.string(),
    param: z.string(),
    value: z.number(),
  }),
  z.object({ type: z.literal("removeEffect"), mixerChannelId: z.string(), effectId: z.string() }),
  z.object({ type: z.literal("createBus"), name: z.string() }),
  z.object({ type: z.literal("addSend"), fromMixerChannelId: z.string(), toMixerChannelId: z.string(), levelDb: z.number().min(-60).max(6).default(-12) }),
  z.object({ type: z.literal("setSidechain"), mixerChannelId: z.string(), fromMixerChannelId: z.string().nullable() }),
  z.object({
    type: z.literal("createAutomation"),
    trackId: z.string(),
    target: AutomationTargetSchema,
    startTick: tick,
    lengthTicks: z.number().min(1),
    points: z.array(AutomationPointSchema),
  }),
  z.object({
    type: z.literal("quantizeNotes"),
    patternId: z.string(),
    channelId: z.string(),
    grid: z.enum(["bar", "beat", "1/2", "1/4", "1/8", "1/16", "1/32", "step"]).default("step"),
    amount: z.number().min(0).max(1).default(1),
  }),
  z.object({
    type: z.literal("humanizeNotes"),
    patternId: z.string(),
    channelId: z.string(),
    timingTicks: z.number().min(0).max(24).default(4),
    velocityAmount: z.number().min(0).max(0.5).default(0.1),
  }),
  z.object({ type: z.literal("transposeNotes"), patternId: z.string(), channelId: z.string(), semitones: z.number().int().min(-48).max(48) }),
  // ── 2.0: beat-level commands (used by the AI producer and the Beat page) ──
  /** swap a synth channel's instrument to another preset (e.g. "808 → Reese bass") */
  z.object({ type: z.literal("setChannelPreset"), channelId: z.string(), presetId: z.string() }),
  /** swap a drum channel's sound (kit + role or sound id) */
  z.object({ type: z.literal("setChannelDrumSound"), channelId: z.string(), kitId: z.string(), sound: z.string() }),
  z.object({ type: z.literal("setChannelVolume"), channelId: z.string(), volumeDb: z.number().min(-60).max(12) }),
  z.object({ type: z.literal("setChannelPan"), channelId: z.string(), pan: z.number().min(-1).max(1) }),
  z.object({ type: z.literal("setChannelMuted"), channelId: z.string(), muted: z.boolean() }),
  /** write a drum part as a grid string: x hit, X accent, o soft, g ghost, r 32nd roll, R triplet roll, . rest */
  z.object({ type: z.literal("setDrumGrid"), patternId: z.string(), channelId: z.string(), grid: z.string().regex(/^[xXogrR.\-|]+$/).max(260) }),
  z.object({ type: z.literal("setPatternSwing"), patternId: z.string(), swing: z.number().min(0).max(1) }),
]);
export type DawCommand = z.infer<typeof DawCommandSchema>;

export const EditPlanSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  explanation: z.string().default(""),
  commands: z.array(DawCommandSchema).min(1).max(200),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

/** Parse + validate a command list coming from an AI response. Throws with readable message. */
export function validateEditPlan(raw: unknown): EditPlan {
  const res = EditPlanSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    throw new Error(`Invalid edit plan: ${first?.path.join(".")}: ${first?.message}`);
  }
  return res.data;
}
