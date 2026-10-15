/**
 * Versioned AI composition schema — the structured song format AI providers return.
 * Rendered through built-in instruments; validated before it can touch a project.
 */
import { z } from "zod";

const NoteEvent = z.object({
  pitch: z.number().int().min(0).max(127),
  /** start in steps (16ths) from section start */
  startStep: z.number().min(0),
  lengthSteps: z.number().min(0.25),
  velocity: z.number().min(0).max(1).default(0.8),
});
export type CompositionNote = z.infer<typeof NoteEvent>;

const DrumHit = z.object({
  /** drum sound role, e.g. "kick", "snare", "hat-closed", "hat-open", "clap", "perc" */
  sound: z.string(),
  step: z.number().int().min(0),
  velocity: z.number().min(0).max(1).default(0.9),
});

const SectionRole = z.enum(["intro", "verse", "pre-chorus", "chorus", "hook", "bridge", "breakdown", "drop", "outro", "transition", "custom"]);

export const CompositionSectionSchema = z.object({
  name: z.string(),
  role: SectionRole.default("custom"),
  lengthBars: z.number().int().min(1).max(64),
  drumPattern: z.array(DrumHit).default([]),
  bassNotes: z.array(NoteEvent).default([]),
  chordNotes: z.array(NoteEvent).default([]),
  melodyNotes: z.array(NoteEvent).default([]),
  counterMelodyNotes: z.array(NoteEvent).default([]),
  lyrics: z.string().default(""),
  adLibs: z.array(z.string()).default([]),
  productionNotes: z.string().default(""),
});
export type CompositionSection = z.infer<typeof CompositionSectionSchema>;

export const CompositionSchema = z.object({
  version: z.literal(1),
  title: z.string().default("AI Draft"),
  genre: z.string().default(""),
  mood: z.string().default(""),
  bpm: z.number().min(40).max(300).default(120),
  timeSignature: z.object({ num: z.number().int().min(1).max(16).default(4), den: z.number().default(4) }).default({ num: 4, den: 4 }),
  key: z.string().default("C"),
  scale: z.string().default("minor"),
  chordProgression: z.array(z.string()).default([]),
  instrumentAssignments: z
    .object({
      drumsKitId: z.string().default("modern-hiphop"),
      bassSynthId: z.string().default("bass808"),
      chordsSynthId: z.string().default("piano"),
      melodySynthId: z.string().default("pluck"),
      counterMelodySynthId: z.string().default("pad"),
    })
    .default({}),
  sections: z.array(CompositionSectionSchema).min(1).max(32),
  automationSuggestions: z.array(z.string()).default([]),
  mixerSuggestions: z.array(z.string()).default([]),
  vocalNotes: z.string().default(""),
  productionNotes: z.string().default(""),
});
export type Composition = z.infer<typeof CompositionSchema>;

export function validateComposition(raw: unknown): Composition {
  const res = CompositionSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    throw new Error(`Invalid composition: ${first?.path.join(".")}: ${first?.message}`);
  }
  return res.data;
}

/** Drum roles every kit must map — AI compositions reference these names. */
export const DRUM_ROLES = [
  "kick", "kick-808", "snare", "clap", "rimshot", "hat-closed", "hat-open",
  "ride", "crash", "tom-low", "tom-mid", "tom-high", "shaker", "tambourine",
  "cowbell", "perc", "click", "impact",
  // 2.0 expansion — appended only, order is part of the contract
  "snap", "conga-high", "conga-low", "bongo", "clave", "woodblock",
  "triangle", "agogo", "timbale", "vox-hey", "reverse-cymbal", "riser",
] as const;
export type DrumRole = (typeof DRUM_ROLES)[number];
