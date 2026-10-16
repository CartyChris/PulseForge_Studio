/**
 * PulseForge Producer — a deterministic, AI-free beat production engine.
 *
 *   genre template + ProductionSpec (from the user, the local director, or an AI model)
 *     → a complete multi-section arrangement (drums, bass, chords, melody, counter-melody,
 *       transition FX) plus a mix plan.
 *
 * "AI directs, engine performs": models are good at musical *decisions* (genre, mood,
 * progression, form, drum grids written as "x...x..." strings, a melody motif in scale
 * degrees) and unreliable at emitting hundreds of correct note events. The spec carries the
 * decisions; this engine turns them into notes that are always in key, on grid and in range.
 *
 * Pure + seeded: the same spec and seed always produce the same production.
 */
import { z } from "zod";
import { SCALES, NOTE_NAMES, TICKS_PER_STEP } from "./time";

// ───────────────────────────── vocabulary ─────────────────────────────

export const GENRE_IDS = [
  "trap", "drill", "boom-bap", "lofi", "rnb", "pop", "house", "techno",
  "dnb", "dubstep", "afrobeats", "reggaeton", "dancehall", "phonk", "jersey-club", "synthwave",
] as const;
export type GenreId = (typeof GENRE_IDS)[number];

export const SECTION_ROLES = ["intro", "verse", "pre-chorus", "chorus", "hook", "bridge", "breakdown", "build", "drop", "outro"] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

export const BASS_STYLES = ["808", "sub", "offbeat", "rolling", "reese", "walking", "dembow", "afro", "none"] as const;
export const CHORD_STYLES = ["block", "stabs", "arp", "pad", "pluck", "skank", "pulse", "none"] as const;
export const MELODY_STYLES = ["bells", "motif", "lead", "arp", "sparse", "none"] as const;
export type BassStyle = (typeof BASS_STYLES)[number];
export type ChordStyle = (typeof CHORD_STYLES)[number];
export type MelodyStyle = (typeof MELODY_STYLES)[number];

export const PART_ROLES = ["drums", "bass", "chords", "melody", "counter"] as const;
export type PartRole = (typeof PART_ROLES)[number];

/** Drum roles the producer may use (all exist in every kit — see DRUM_ROLES). */
export const FX_ROLES = ["crash", "reverse-cymbal", "riser", "impact"] as const;

export type LengthId = "short" | "standard" | "extended";

const STEPS_PER_BAR = 16;
const TICKS_PER_BAR = STEPS_PER_BAR * TICKS_PER_STEP; // 384 in 4/4
const MAX_PATTERN_BARS = 16; // pattern lengthSteps max is 256

// ───────────────────────────── AI-facing spec ─────────────────────────────

const GridString = z.string().regex(/^[xXogrR.\-|]+$/, "grid chars: x X o g r R . - |").max(260);
const SpecSection = z.object({
  name: z.string().min(1).max(40),
  role: z.enum(SECTION_ROLES).default("verse"),
  bars: z.number().int().min(1).max(32),
  energy: z.number().min(0).max(1).default(0.6),
  /** override which parts play in this section */
  parts: z.array(z.enum(PART_ROLES)).optional(),
  /** per-role drum grid override for this section (16 chars = 1 bar, repeats) */
  drums: z.record(z.string(), GridString).optional(),
});

const MotifNote = z.object({
  /** scale degree relative to the key root: 0 = root, 2 = third, 4 = fifth, 7 = octave, negatives below */
  degree: z.number().int().min(-7).max(14),
  /** 16th-step offset inside a 2-bar phrase (0–31) */
  step: z.number().int().min(0).max(31),
  /** length in 16th steps */
  length: z.number().int().min(1).max(16).default(2),
});

export const ProductionSpecSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().max(80).default("Untitled Beat"),
  genre: z.enum(GENRE_IDS).default("trap"),
  mood: z.string().max(160).default(""),
  bpm: z.number().min(50).max(200).optional(),
  key: z.string().max(3).optional(),
  scale: z.string().max(24).optional(),
  swing: z.number().min(0).max(0.75).optional(),
  length: z.enum(["short", "standard", "extended"]).default("standard"),
  /** roman numerals ("i", "VI", "iv7") or chord names ("Am", "F#m7") */
  progression: z.array(z.string().max(8)).min(1).max(8).optional(),
  sections: z.array(SpecSection).min(1).max(16).optional(),
  instruments: z
    .object({
      kit: z.string().max(40).optional(),
      bass: z.string().max(40).optional(),
      chords: z.string().max(40).optional(),
      melody: z.string().max(40).optional(),
      counter: z.string().max(40).optional(),
    })
    .default({}),
  styles: z
    .object({
      bass: z.enum(BASS_STYLES).optional(),
      chords: z.enum(CHORD_STYLES).optional(),
      melody: z.enum(MELODY_STYLES).optional(),
    })
    .default({}),
  /** global per-role drum grid overrides (16/32/64 chars) */
  drums: z.record(z.string(), GridString).optional(),
  /** 2-bar melody motif in scale degrees — the engine varies and harmonizes it */
  motif: z.array(MotifNote).max(32).optional(),
  mix: z
    .object({
      sidechain: z.boolean().optional(),
      reverb: z.number().min(0).max(1).optional(),
      delay: z.number().min(0).max(1).optional(),
      saturation: z.number().min(0).max(1).optional(),
      width: z.number().min(0).max(1).optional(),
    })
    .default({}),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  notes: z.string().max(1200).default(""),
});
export type ProductionSpec = z.infer<typeof ProductionSpecSchema>;

export function validateProductionSpec(raw: unknown): ProductionSpec {
  const res = ProductionSpecSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    throw new Error(`Invalid production spec: ${first?.path.join(".")}: ${first?.message}`);
  }
  return res.data;
}

// ───────────────────────────── genre templates ─────────────────────────────

type Form = "hiphop" | "pop" | "edm" | "club" | "chill";

export interface GenreTemplate {
  id: GenreId;
  name: string;
  blurb: string;
  bpm: [number, number];
  swing: number;
  halfTime: boolean;
  scales: string[];
  keys: string[];
  progressions: string[][];
  /** bars per chord */
  harmonicBars: 1 | 2;
  chordExt: "triad" | "seventh" | "ninth" | "add9";
  kit: string;
  instruments: { bass: string[]; chords: string[]; melody: string[]; counter: string[] };
  bass: BassStyle;
  chords: ChordStyle;
  melody: MelodyStyle;
  form: Form;
  mix: { sidechain: boolean; reverb: number; delay: number; saturation: number; width: number };
}

const MINOR_LOOPS = [["i", "VI", "III", "VII"], ["i", "iv", "VI", "v"], ["i", "VII", "VI", "VII"], ["i", "i", "VI", "VII"]];
const POP_LOOPS = [["I", "V", "vi", "IV"], ["vi", "IV", "I", "V"], ["I", "vi", "IV", "V"], ["IV", "V", "vi", "I"]];

export const GENRES: Record<GenreId, GenreTemplate> = {
  trap: {
    id: "trap", name: "Trap", blurb: "Hard 808s, rolling hi-hats, dark bells",
    bpm: [130, 150], swing: 0, halfTime: true, scales: ["minor", "harmonic minor", "phrygian"], keys: ["C", "C#", "D", "F", "F#", "G", "A"],
    progressions: MINOR_LOOPS, harmonicBars: 1, chordExt: "triad", kit: "trap-808",
    instruments: { bass: ["bass-808-long", "bass-808"], chords: ["piano-dark", "grand-piano"], melody: ["bell", "fm-glass", "keys-music-box"], counter: ["choir-ahh", "pad-choir", "strings-ensemble"] },
    bass: "808", chords: "pad", melody: "bells", form: "hiphop",
    mix: { sidechain: false, reverb: 0.35, delay: 0.3, saturation: 0.45, width: 0.6 },
  },
  drill: {
    id: "drill", name: "Drill", blurb: "Sliding 808s, skippy hats, ominous strings",
    bpm: [138, 146], swing: 0, halfTime: true, scales: ["harmonic minor", "minor", "phrygian"], keys: ["C", "C#", "D#", "F", "F#", "G#"],
    progressions: [["i", "VI", "VII", "i"], ["i", "iv", "v", "i"], ["i", "II", "i", "VII"]], harmonicBars: 1, chordExt: "triad", kit: "drill-uk",
    instruments: { bass: ["bass-808-distorted", "bass-808"], chords: ["strings-ensemble", "pad-strings"], melody: ["flute", "flute-air", "pizzicato", "bell"], counter: ["piano-dark", "grand-piano"] },
    bass: "808", chords: "pad", melody: "sparse", form: "hiphop",
    mix: { sidechain: false, reverb: 0.4, delay: 0.25, saturation: 0.55, width: 0.55 },
  },
  "boom-bap": {
    id: "boom-bap", name: "Boom Bap", blurb: "Dusty swung drums, jazzy keys, walking bass",
    bpm: [84, 96], swing: 0.55, halfTime: false, scales: ["dorian", "minor"], keys: ["C", "D", "E", "F", "G", "A"],
    progressions: [["i", "iv", "VII", "III"], ["ii", "v", "i", "i"], ["i", "IV", "i", "v"]], harmonicBars: 1, chordExt: "seventh", kit: "boom-bap",
    instruments: { bass: ["bass-electric", "bass-sub"], chords: ["ep-warm", "piano-lofi", "grand-piano"], melody: ["flute", "flute-air", "ep-bell"], counter: ["strings-ensemble", "pad-strings"] },
    bass: "walking", chords: "block", melody: "motif", form: "hiphop",
    mix: { sidechain: false, reverb: 0.25, delay: 0.15, saturation: 0.5, width: 0.4 },
  },
  lofi: {
    id: "lofi", name: "Lo-Fi", blurb: "Warm Rhodes, lazy swing, vinyl haze",
    bpm: [70, 88], swing: 0.5, halfTime: false, scales: ["major", "dorian", "minor"], keys: ["C", "D", "D#", "F", "G", "A#"],
    progressions: [["ii", "v", "I", "vi"], ["IV", "iii", "ii", "I"], ["I", "vi", "ii", "V"]], harmonicBars: 1, chordExt: "ninth", kit: "lofi-dust",
    instruments: { bass: ["bass-electric", "bass-sub"], chords: ["piano-lofi", "ep-warm", "piano-tape"], melody: ["ep-bell", "keys-dream", "fm-kalimba"], counter: ["pad-vapor", "pad-warm-analog"] },
    bass: "sub", chords: "block", melody: "motif", form: "chill",
    mix: { sidechain: false, reverb: 0.45, delay: 0.25, saturation: 0.55, width: 0.5 },
  },
  rnb: {
    id: "rnb", name: "R&B", blurb: "Silky 7th chords, finger snaps, smooth sub",
    bpm: [66, 96], swing: 0.25, halfTime: false, scales: ["major", "minor", "dorian"], keys: ["C#", "D#", "F", "F#", "G#", "A#"],
    progressions: [["ii", "V", "I", "vi"], ["I", "iii", "vi", "IV"], ["vi", "IV", "I", "V"]], harmonicBars: 1, chordExt: "ninth", kit: "rnb",
    instruments: { bass: ["bass-sub", "bass-808"], chords: ["ep-classic", "keys-dream"], melody: ["nylon-guitar", "pluck-guitar", "ep-bell"], counter: ["strings-ensemble", "pad-strings"] },
    bass: "sub", chords: "block", melody: "motif", form: "hiphop",
    mix: { sidechain: false, reverb: 0.4, delay: 0.25, saturation: 0.3, width: 0.6 },
  },
  pop: {
    id: "pop", name: "Pop", blurb: "Four-chord hooks, bright piano, punchy claps",
    bpm: [100, 122], swing: 0, halfTime: false, scales: ["major"], keys: ["C", "D", "E", "F", "G", "A"],
    progressions: POP_LOOPS, harmonicBars: 1, chordExt: "add9", kit: "pop",
    instruments: { bass: ["bass-synth", "bass-sub"], chords: ["grand-piano", "piano-studio"], melody: ["pluck", "lead-trance"], counter: ["supersaw-chords", "pad-strings"] },
    bass: "sub", chords: "pulse", melody: "lead", form: "pop",
    mix: { sidechain: true, reverb: 0.3, delay: 0.25, saturation: 0.25, width: 0.7 },
  },
  house: {
    id: "house", name: "House", blurb: "Four-on-the-floor, offbeat bass, organ stabs",
    bpm: [120, 126], swing: 0.1, halfTime: false, scales: ["minor", "dorian", "major"], keys: ["C", "D", "F", "G", "A"],
    progressions: [["i", "VI", "III", "VII"], ["i", "iv", "VII", "III"], ["vi", "IV", "I", "V"]], harmonicBars: 1, chordExt: "seventh", kit: "house",
    instruments: { bass: ["bass-deep-house", "bass-synth"], chords: ["b3-organ", "keys-house-organ", "synth-chord"], melody: ["pluck", "lead-trance"], counter: ["pad-warm-analog"] },
    bass: "offbeat", chords: "stabs", melody: "motif", form: "edm",
    mix: { sidechain: true, reverb: 0.3, delay: 0.25, saturation: 0.2, width: 0.65 },
  },
  techno: {
    id: "techno", name: "Techno", blurb: "Driving kick, acid lines, hypnotic loops",
    bpm: [126, 136], swing: 0, halfTime: false, scales: ["minor", "phrygian"], keys: ["C", "D", "E", "F", "G", "A"],
    progressions: [["i", "i", "VI", "VII"], ["i", "VII", "i", "VI"]], harmonicBars: 2, chordExt: "triad", kit: "techno",
    instruments: { bass: ["bass-acid", "bass-synth"], chords: ["synth-chord", "pad-dark-drone"], melody: ["lead-square", "fm-metallic"], counter: ["pad-dark-drone"] },
    bass: "rolling", chords: "stabs", melody: "arp", form: "edm",
    mix: { sidechain: true, reverb: 0.35, delay: 0.35, saturation: 0.3, width: 0.55 },
  },
  dnb: {
    id: "dnb", name: "Drum & Bass", blurb: "174 BPM breaks, reese bass, cinematic pads",
    bpm: [170, 176], swing: 0, halfTime: false, scales: ["minor", "dorian"], keys: ["C", "D", "E", "F", "G", "A"],
    progressions: [["i", "VI", "III", "VII"], ["i", "VII", "VI", "v"]], harmonicBars: 2, chordExt: "seventh", kit: "dnb",
    instruments: { bass: ["bass-reese", "bass-growl"], chords: ["pad-cinematic", "pad-strings"], melody: ["pluck", "lead-super"], counter: ["pad-shimmer"] },
    bass: "reese", chords: "pad", melody: "motif", form: "edm",
    mix: { sidechain: true, reverb: 0.4, delay: 0.3, saturation: 0.35, width: 0.6 },
  },
  dubstep: {
    id: "dubstep", name: "Dubstep", blurb: "Half-time weight, wobble bass, huge snares",
    bpm: [138, 150], swing: 0, halfTime: true, scales: ["minor", "phrygian"], keys: ["C", "D", "E", "F", "G"],
    progressions: [["i", "VI", "VII", "i"], ["i", "iv", "VI", "VII"]], harmonicBars: 2, chordExt: "triad", kit: "dubstep",
    instruments: { bass: ["bass-wobble", "bass-growl"], chords: ["pad-dark-drone", "pad-cinematic"], melody: ["supersaw-lead", "lead-super"], counter: ["choir-ahh", "pad-choir"] },
    bass: "reese", chords: "pad", melody: "lead", form: "edm",
    mix: { sidechain: true, reverb: 0.4, delay: 0.25, saturation: 0.6, width: 0.6 },
  },
  afrobeats: {
    id: "afrobeats", name: "Afrobeats", blurb: "Bouncy percussion, marimba hooks, warm keys",
    bpm: [98, 112], swing: 0.15, halfTime: false, scales: ["major", "mixolydian"], keys: ["C", "D", "F", "G", "A", "A#"],
    progressions: [["I", "V", "vi", "IV"], ["vi", "IV", "I", "V"], ["ii", "V", "I", "I"], ["I", "IV", "vi", "V"]], harmonicBars: 1, chordExt: "seventh", kit: "afrobeats",
    instruments: { bass: ["bass-sub", "bass-picked"], chords: ["ep-classic", "piano-studio"], melody: ["marimba", "fm-marimba", "fm-kalimba"], counter: ["nylon-guitar", "pluck-guitar"] },
    bass: "afro", chords: "pluck", melody: "motif", form: "club",
    mix: { sidechain: false, reverb: 0.3, delay: 0.2, saturation: 0.2, width: 0.65 },
  },
  reggaeton: {
    id: "reggaeton", name: "Reggaeton", blurb: "Dembow groove, guitar plucks, deep bass",
    bpm: [88, 98], swing: 0, halfTime: false, scales: ["minor"], keys: ["C", "D", "E", "F", "G", "A"],
    progressions: [["i", "VI", "III", "VII"], ["vi", "IV", "I", "V"]], harmonicBars: 1, chordExt: "triad", kit: "reggaeton",
    instruments: { bass: ["bass-808", "bass-sub"], chords: ["synth-chord", "pluck"], melody: ["nylon-guitar", "pluck-guitar", "lead-whistle"], counter: ["pad-strings"] },
    bass: "dembow", chords: "pluck", melody: "motif", form: "club",
    mix: { sidechain: false, reverb: 0.3, delay: 0.2, saturation: 0.3, width: 0.6 },
  },
  dancehall: {
    id: "dancehall", name: "Dancehall", blurb: "Island bounce, organ skanks, brass stabs",
    bpm: [94, 106], swing: 0.1, halfTime: false, scales: ["minor", "major"], keys: ["C", "D", "F", "G", "A"],
    progressions: [["i", "VII", "VI", "VII"], ["I", "IV", "V", "IV"]], harmonicBars: 1, chordExt: "triad", kit: "dancehall",
    instruments: { bass: ["bass-sub", "bass-808"], chords: ["b3-organ", "keys-house-organ", "ep-classic"], melody: ["lead-whistle", "pluck"], counter: ["brass-section", "brass"] },
    bass: "afro", chords: "skank", melody: "motif", form: "club",
    mix: { sidechain: false, reverb: 0.3, delay: 0.25, saturation: 0.25, width: 0.55 },
  },
  phonk: {
    id: "phonk", name: "Phonk", blurb: "Memphis cowbells, distorted 808s, drift energy",
    bpm: [130, 150], swing: 0, halfTime: true, scales: ["phrygian", "minor"], keys: ["C", "C#", "D", "E", "F"],
    progressions: [["i", "VI", "III", "VII"], ["i", "iv", "i", "VII"], ["i", "II", "i", "II"]], harmonicBars: 1, chordExt: "triad", kit: "phonk",
    instruments: { bass: ["bass-808-distorted", "bass-808"], chords: ["pad-dark-drone", "piano-dark"], melody: ["fm-metallic", "bell"], counter: ["choir-ahh", "pad-choir"] },
    bass: "808", chords: "pad", melody: "bells", form: "hiphop",
    mix: { sidechain: false, reverb: 0.3, delay: 0.2, saturation: 0.75, width: 0.5 },
  },
  "jersey-club": {
    id: "jersey-club", name: "Jersey Club", blurb: "Triplet kick bounce, vocal chops, bed squeaks",
    bpm: [135, 145], swing: 0, halfTime: false, scales: ["minor", "major"], keys: ["C", "D", "F", "G", "A"],
    progressions: [["i", "VI", "III", "VII"], ["vi", "IV", "I", "V"]], harmonicBars: 1, chordExt: "seventh", kit: "jersey-club",
    instruments: { bass: ["bass-808", "bass-sub"], chords: ["synth-chord", "pad-vapor"], melody: ["pluck", "lead-retro"], counter: ["pad-shimmer"] },
    bass: "808", chords: "stabs", melody: "motif", form: "club",
    mix: { sidechain: true, reverb: 0.3, delay: 0.25, saturation: 0.35, width: 0.6 },
  },
  synthwave: {
    id: "synthwave", name: "Synthwave", blurb: "Neon 80s pads, gated snares, arpeggios",
    bpm: [96, 118], swing: 0, halfTime: false, scales: ["minor", "dorian"], keys: ["C", "D", "E", "F", "A"],
    progressions: [["i", "VI", "III", "VII"], ["vi", "IV", "I", "V"], ["i", "VII", "VI", "VII"]], harmonicBars: 1, chordExt: "triad", kit: "eighties",
    instruments: { bass: ["bass-synth", "bass-pluck"], chords: ["pad-vapor", "pad-warm-analog"], melody: ["supersaw-lead", "lead-super", "lead-retro"], counter: ["supersaw-chords", "synth-chord"] },
    bass: "rolling", chords: "pad", melody: "arp", form: "pop",
    mix: { sidechain: true, reverb: 0.5, delay: 0.35, saturation: 0.2, width: 0.75 },
  },
};

// ───────────────────────────── forms ─────────────────────────────

type FormSection = [name: string, role: SectionRole, bars: number, energy: number];
const FORMS: Record<Form, Record<LengthId, FormSection[]>> = {
  hiphop: {
    short: [["Intro", "intro", 4, 0.35], ["Verse", "verse", 8, 0.65], ["Hook", "hook", 8, 0.95], ["Outro", "outro", 4, 0.3]],
    standard: [["Intro", "intro", 8, 0.35], ["Verse", "verse", 16, 0.65], ["Hook", "hook", 8, 0.95], ["Verse", "verse", 16, 0.68], ["Hook", "hook", 8, 0.95], ["Bridge", "bridge", 8, 0.45], ["Hook", "hook", 8, 1], ["Outro", "outro", 8, 0.28]],
    extended: [["Intro", "intro", 8, 0.35], ["Verse", "verse", 16, 0.65], ["Hook", "hook", 8, 0.95], ["Verse", "verse", 16, 0.68], ["Hook", "hook", 8, 0.95], ["Bridge", "bridge", 8, 0.45], ["Verse", "verse", 16, 0.7], ["Hook", "hook", 8, 1], ["Hook", "hook", 8, 1], ["Outro", "outro", 8, 0.28]],
  },
  pop: {
    short: [["Intro", "intro", 4, 0.35], ["Verse", "verse", 8, 0.55], ["Chorus", "chorus", 8, 0.95], ["Outro", "outro", 4, 0.3]],
    standard: [["Intro", "intro", 4, 0.35], ["Verse", "verse", 8, 0.55], ["Pre-Chorus", "pre-chorus", 4, 0.72], ["Chorus", "chorus", 8, 0.95], ["Verse", "verse", 8, 0.6], ["Pre-Chorus", "pre-chorus", 4, 0.75], ["Chorus", "chorus", 8, 1], ["Bridge", "bridge", 8, 0.5], ["Chorus", "chorus", 8, 1], ["Outro", "outro", 4, 0.3]],
    extended: [["Intro", "intro", 8, 0.35], ["Verse", "verse", 8, 0.55], ["Pre-Chorus", "pre-chorus", 4, 0.72], ["Chorus", "chorus", 8, 0.95], ["Verse", "verse", 8, 0.6], ["Pre-Chorus", "pre-chorus", 4, 0.75], ["Chorus", "chorus", 8, 1], ["Bridge", "bridge", 8, 0.5], ["Pre-Chorus", "pre-chorus", 4, 0.78], ["Chorus", "chorus", 8, 1], ["Chorus", "chorus", 8, 1], ["Outro", "outro", 8, 0.3]],
  },
  edm: {
    short: [["Intro", "intro", 8, 0.35], ["Build", "build", 4, 0.7], ["Drop", "drop", 8, 1], ["Outro", "outro", 4, 0.3]],
    standard: [["Intro", "intro", 16, 0.35], ["Build", "build", 8, 0.7], ["Drop", "drop", 16, 1], ["Breakdown", "breakdown", 16, 0.4], ["Build", "build", 8, 0.72], ["Drop", "drop", 16, 1], ["Outro", "outro", 8, 0.3]],
    extended: [["Intro", "intro", 16, 0.35], ["Build", "build", 8, 0.7], ["Drop", "drop", 16, 1], ["Breakdown", "breakdown", 16, 0.4], ["Build", "build", 8, 0.72], ["Drop", "drop", 16, 1], ["Breakdown", "breakdown", 8, 0.42], ["Drop", "drop", 16, 1], ["Outro", "outro", 16, 0.3]],
  },
  club: {
    short: [["Intro", "intro", 4, 0.4], ["Verse", "verse", 8, 0.65], ["Hook", "hook", 8, 0.95], ["Outro", "outro", 4, 0.35]],
    standard: [["Intro", "intro", 4, 0.4], ["Verse", "verse", 8, 0.65], ["Hook", "hook", 8, 0.9], ["Verse", "verse", 8, 0.7], ["Hook", "hook", 8, 0.95], ["Bridge", "bridge", 4, 0.5], ["Hook", "hook", 8, 1], ["Outro", "outro", 4, 0.35]],
    extended: [["Intro", "intro", 8, 0.4], ["Verse", "verse", 16, 0.65], ["Hook", "hook", 8, 0.9], ["Verse", "verse", 16, 0.7], ["Hook", "hook", 8, 0.95], ["Bridge", "bridge", 8, 0.5], ["Hook", "hook", 8, 1], ["Hook", "hook", 8, 1], ["Outro", "outro", 8, 0.35]],
  },
  chill: {
    short: [["Intro", "intro", 4, 0.3], ["A", "verse", 8, 0.6], ["B", "hook", 8, 0.72], ["Outro", "outro", 4, 0.3]],
    standard: [["Intro", "intro", 4, 0.3], ["A", "verse", 8, 0.58], ["B", "hook", 8, 0.72], ["A", "verse", 8, 0.62], ["B", "hook", 8, 0.75], ["Bridge", "bridge", 4, 0.45], ["B", "hook", 8, 0.75], ["Outro", "outro", 4, 0.3]],
    extended: [["Intro", "intro", 8, 0.3], ["A", "verse", 8, 0.58], ["B", "hook", 8, 0.72], ["A", "verse", 8, 0.62], ["B", "hook", 8, 0.75], ["Bridge", "bridge", 8, 0.45], ["A", "verse", 8, 0.62], ["B", "hook", 8, 0.78], ["Outro", "outro", 8, 0.3]],
  },
};

// ───────────────────────────── seeded randomness ─────────────────────────────

export type Rng = () => number;
export function seededRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]!;
const chance = (rng: Rng, p: number) => rng() < p;
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Move a pitch by whole octaves into [lo, hi]. Unlike clamping, this never changes the
 * pitch class — clamping 43 up to 45 turns a G into an A and knocks the note out of key. */
const foldPitch = (p: number, lo: number, hi: number) => { let x = p; while (x < lo) x += 12; while (x > hi) x -= 12; return x; };
/** stable 32-bit hash so sub-generators get independent but reproducible streams */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ───────────────────────────── theory ─────────────────────────────

const ENHARMONIC: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E", "E#": "F", "B#": "C" };

/** "f#", "Bb", "Eb", "F#m" → canonical sharp name from NOTE_NAMES, or null. */
export function normalizeKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^([A-Ga-g])([#b♯♭]?)/.exec(raw.trim());
  if (!m) return null;
  const acc = m[2] === "♯" || m[2] === "#" ? "#" : m[2] === "♭" || m[2] === "b" ? "b" : "";
  const name = m[1]!.toUpperCase() + acc;
  const sharp = ENHARMONIC[name] ?? name;
  return (NOTE_NAMES as readonly string[]).includes(sharp) ? sharp : null;
}

/** Scales whose harmony is stacked thirds over 7 notes. Pentatonic/blues melodies borrow a parent. */
function harmonyScaleOf(scale: string): string {
  if (scale === "pentatonic minor" || scale === "blues") return "minor";
  if (scale === "pentatonic major") return "major";
  if (scale === "chromatic") return "minor";
  return SCALES[scale] && SCALES[scale]!.length === 7 ? scale : "minor";
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii"];

/** Parse "VI", "iv7", "bVII", "Am", "F#m7", "3" → scale degree 0–6 within the scale (diatonic). */
export function parseChordToken(token: string, rootPc: number, scale: number[]): number | null {
  const t = token.trim();
  if (!t) return null;
  if (/^[1-7]$/.test(t)) return Number(t) - 1;
  const roman = t.replace(/^[b#♭♯]/, "").replace(/(maj|min|dim|aug|sus|add|°|ø|\+|\d)+$/i, "").toLowerCase();
  const ri = ROMAN.indexOf(roman);
  if (ri >= 0) return ri;
  const m = /^([A-Ga-g])([#b♯♭]?)/.exec(t);
  if (!m) return null;
  const name = normalizeKey(m[1]! + (m[2] ?? ""));
  if (!name) return null;
  const pc = (NOTE_NAMES as readonly string[]).indexOf(name);
  let best = 0, bestDist = 99;
  scale.forEach((iv, d) => {
    const spc = (rootPc + iv) % 12;
    const dist = Math.min((pc - spc + 12) % 12, (spc - pc + 12) % 12);
    if (dist < bestDist) { bestDist = dist; best = d; }
  });
  return best;
}

/** Pitch classes (relative to octave 0) of the diatonic chord on `degree`. */
function chordTones(degree: number, scale: number[], ext: GenreTemplate["chordExt"]): number[] {
  const at = (d: number) => scale[((d % 7) + 7) % 7]! + 12 * Math.floor(d / 7);
  const tones = [at(degree), at(degree + 2), at(degree + 4)];
  if (ext === "seventh" || ext === "ninth") tones.push(at(degree + 6));
  if (ext === "ninth" || ext === "add9") tones.push(at(degree + 8));
  return tones;
}

/** Voice a chord near `center`, choosing the inversion closest to the previous voicing (voice leading). */
function voiceChord(tones: number[], rootPc: number, center: number, prev: number[] | null): number[] {
  const base = tones.map((t) => t + rootPc);
  const candidates: number[][] = [];
  for (let inv = 0; inv < base.length; inv++) {
    const v = base.map((t, i) => (i < inv ? t + 12 : t));
    for (const shift of [-24, -12, 0, 12, 24]) candidates.push(v.map((x) => x + shift).sort((a, b) => a - b));
  }
  const score = (v: number[]) => {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const centerCost = Math.abs(mean - center);
    if (!prev) return centerCost;
    let move = 0;
    for (let i = 0; i < Math.min(v.length, prev.length); i++) move += Math.abs(v[i]! - prev[i]!);
    return move + centerCost * 0.5;
  };
  return candidates.reduce((best, v) => (score(v) < score(best) ? v : best));
}

// ───────────────────────────── resolved spec ─────────────────────────────

export interface ResolvedSection {
  name: string;
  role: SectionRole;
  bars: number;
  energy: number;
  parts: PartRole[];
  drums?: Record<string, string>;
}

export interface ResolvedSpec {
  title: string;
  genre: GenreId;
  mood: string;
  bpm: number;
  key: string;
  rootPc: number;
  scale: string;
  harmonyScale: string;
  swing: number;
  progression: number[]; // scale degrees
  progressionLabels: string[];
  sections: ResolvedSection[];
  instruments: { kit: string; bass: string[]; chords: string[]; melody: string[]; counter: string[] };
  styles: { bass: BassStyle; chords: ChordStyle; melody: MelodyStyle };
  drums: Record<string, string>;
  motif: Array<{ degree: number; step: number; length: number }> | null;
  mix: GenreTemplate["mix"];
  seed: number;
  template: GenreTemplate;
}

const MOOD_DARK = /dark|evil|sinister|haunt|menac|aggress|hard|grim|ominous|horror|gritty|angry/i;
const MOOD_BRIGHT = /happy|bright|uplift|joy|summer|sunny|fun|feel.?good|positive|cheer/i;
const MOOD_SAD = /sad|melanch|emotional|heartbreak|lonely|blue|cry|nostalg/i;
const MOOD_CHILL = /chill|relax|calm|mellow|study|sleep|lazy|soft|smooth|dreamy/i;

/** Default part set for a section role at a given energy. */
function defaultParts(role: SectionRole, energy: number, form: Form): PartRole[] {
  switch (role) {
    case "intro": return form === "edm" ? ["drums", "chords"] : ["chords", "melody"];
    case "outro": return ["chords", "melody"];
    case "breakdown": return ["chords", "melody", "counter"];
    case "bridge": return energy < 0.5 ? ["chords", "melody", "counter"] : ["drums", "bass", "chords", "melody"];
    case "build": case "pre-chorus": return ["drums", "bass", "chords", "melody"];
    case "hook": case "chorus": case "drop": return ["drums", "bass", "chords", "melody", "counter"];
    default: return energy < 0.45 ? ["chords", "melody"] : ["drums", "bass", "chords", "melody"];
  }
}

export function resolveSpec(spec: ProductionSpec): ResolvedSpec {
  const t = GENRES[spec.genre];
  const seed = spec.seed ?? hash(`${spec.title}|${spec.genre}|${spec.mood}`) % 2_000_000_000;
  const rng = seededRng(seed ^ 0x5bd1e995);
  const mood = spec.mood;

  let scale = spec.scale && SCALES[spec.scale] ? spec.scale : "";
  if (!scale) {
    if (MOOD_BRIGHT.test(mood) && t.scales.includes("major")) scale = "major";
    else if (MOOD_DARK.test(mood)) scale = t.scales.find((s) => s === "phrygian" || s === "harmonic minor") ?? t.scales[0]!;
    else if (MOOD_SAD.test(mood)) scale = t.scales.includes("minor") ? "minor" : t.scales[0]!;
    else scale = t.scales[0]!;
  }
  const harmonyScale = harmonyScaleOf(scale);
  const hScale = SCALES[harmonyScale]!;
  const key = normalizeKey(spec.key) ?? pick(rng, t.keys);
  const rootPc = (NOTE_NAMES as readonly string[]).indexOf(key);

  let bpm = spec.bpm ?? Math.round(t.bpm[0] + rng() * (t.bpm[1] - t.bpm[0]));
  if (spec.bpm === undefined && MOOD_CHILL.test(mood)) bpm = Math.max(t.bpm[0], bpm - 6);
  if (spec.bpm === undefined && MOOD_DARK.test(mood) && /aggress|hard|angry/i.test(mood)) bpm = Math.min(t.bpm[1], bpm + 4);

  // progression: AI/user tokens, else a genre loop. Degrees map diatonically into whatever
  // scale is active, so every chord is in key by construction ("vi" in minor = the VI chord).
  const progLabels = spec.progression?.length ? spec.progression : pick(rng, t.progressions);
  const progression = progLabels.map((x) => parseChordToken(x, rootPc, hScale)).filter((d): d is number => d !== null);
  const finalProg = progression.length ? progression : [0, 5, 2, 6];

  const sections: ResolvedSection[] = (spec.sections?.length
    ? spec.sections.map((s) => ({ name: s.name, role: s.role, bars: s.bars, energy: s.energy, parts: s.parts ?? defaultParts(s.role, s.energy, t.form), drums: s.drums }))
    : FORMS[t.form][spec.length].map(([name, role, bars, energy]) => ({ name, role, bars, energy, parts: defaultParts(role, energy, t.form) }))
  ).map((s) => ({ ...s, energy: MOOD_CHILL.test(mood) ? s.energy * 0.9 : s.energy }));

  const prefer = (want: string | undefined, list: string[]) => (want ? [want, ...list] : list);
  return {
    title: spec.title, genre: t.id, mood, bpm, key, rootPc, scale, harmonyScale,
    swing: spec.swing ?? t.swing,
    progression: finalProg,
    progressionLabels: progLabels,
    sections,
    instruments: {
      kit: spec.instruments.kit ?? t.kit,
      bass: prefer(spec.instruments.bass, t.instruments.bass),
      chords: prefer(spec.instruments.chords, t.instruments.chords),
      melody: prefer(spec.instruments.melody, t.instruments.melody),
      counter: prefer(spec.instruments.counter, t.instruments.counter),
    },
    styles: {
      bass: spec.styles.bass ?? t.bass,
      chords: spec.styles.chords ?? t.chords,
      melody: spec.styles.melody ?? t.melody,
    },
    drums: spec.drums ?? {},
    motif: spec.motif?.length ? spec.motif.map((m) => ({ degree: m.degree, step: m.step, length: m.length })) : null,
    mix: {
      sidechain: spec.mix.sidechain ?? t.mix.sidechain,
      reverb: spec.mix.reverb ?? (MOOD_CHILL.test(mood) ? Math.min(1, t.mix.reverb + 0.15) : t.mix.reverb),
      delay: spec.mix.delay ?? t.mix.delay,
      saturation: spec.mix.saturation ?? t.mix.saturation,
      width: spec.mix.width ?? t.mix.width,
    },
    seed,
    template: t,
  };
}

// ───────────────────────────── production output ─────────────────────────────

export interface DrumHit { index: number; velocity: number; micro: number; probability: number }
export interface PitchedNote { pitch: number; startTick: number; lengthTicks: number; velocity: number }

export interface ProducedPart {
  role: PartRole;
  section: string;
  lengthSteps: number;
  /** drums only: drum role → hits */
  drums?: Record<string, DrumHit[]>;
  notes?: PitchedNote[];
}

export interface ProducedSection {
  name: string;
  role: SectionRole;
  bars: number;
  energy: number;
  startBar: number;
  parts: PartRole[];
  chords: string[];
}

export interface FxPlacement { role: (typeof FX_ROLES)[number]; tick: number; velocity: number }

export interface MixPartPlan {
  volumeDb: number;
  pan: number;
  effects: Array<{ type: string; params: Record<string, number> }>;
  reverbSendDb: number | null;
  delaySendDb: number | null;
  sidechained: boolean;
}

export interface MixPlan {
  parts: Record<PartRole | "kick" | "fx", MixPartPlan>;
  reverb: { decay: number; preDelay: number };
  delay: { time: number; feedback: number };
  master: Array<{ type: string; params: Record<string, number> }>;
  /** low-pass sweep automation on the music bus for intros / builds */
  filterSweeps: Array<{ startTick: number; lengthTicks: number; fromHz: number; toHz: number }>;
}

export interface Production {
  spec: ResolvedSpec;
  sections: ProducedSection[];
  parts: ProducedPart[];
  fx: FxPlacement[];
  mix: MixPlan;
  totalBars: number;
}

// ───────────────────────────── drums ─────────────────────────────

/** Parse a grid string ("x...x...", "X" accent, "o" soft, "g" ghost, "r"/"R" ratchet 2/3) into per-step hits. */
export function parseGrid(grid: string, lengthSteps: number): DrumHit[] {
  const cells = grid.replace(/\|/g, "").split("");
  if (!cells.length) return [];
  const out: DrumHit[] = [];
  for (let i = 0; i < lengthSteps; i++) {
    const c = cells[i % cells.length]!;
    const vel = c === "X" ? 1 : c === "x" ? 0.88 : c === "o" ? 0.6 : c === "g" ? 0.32 : c === "r" || c === "R" ? 0.82 : 0;
    if (!vel) continue;
    out.push({ index: i, velocity: vel, micro: 0, probability: 1 });
    if (c === "r") out.push({ index: i, velocity: vel * 0.75, micro: 12, probability: 1 });
    if (c === "R") { out.push({ index: i, velocity: vel * 0.75, micro: 8, probability: 1 }); out.push({ index: i + 1 < lengthSteps ? i + 1 : i, velocity: vel * 0.65, micro: i + 1 < lengthSteps ? -8 : 12, probability: 1 }); }
  }
  return out;
}

/** Place a hit at an absolute tick inside the pattern, as (step index, micro) with |micro| ≤ 12. */
function hitAt(tick: number, velocity: number, lengthSteps: number, probability = 1): DrumHit | null {
  const index = Math.round(tick / TICKS_PER_STEP);
  if (index < 0 || index >= lengthSteps) return null;
  const micro = clampN(Math.round(tick - index * TICKS_PER_STEP), -12, 12);
  return { index, velocity: clampN(velocity, 0.05, 1), micro, probability };
}

interface GrooveBar { kick: string; snare: string; hats: string; open?: string; perc?: string; percRole?: string; extra?: Array<[role: string, grid: string]> }

/** Genre grooves. Each entry is one bar of 16 steps; variants are chosen per section. */
function grooveFor(genre: GenreId, rng: Rng, energy: number): GrooveBar {
  const hi = energy >= 0.8;
  switch (genre) {
    case "trap": return {
      kick: pick(rng, ["x.........x.....", "x......x..x.....", "x.....x...x...x.", "x..x......x....."]),
      snare: "........x.......", hats: hi ? "xxxxxxxxxxxxxxxx" : "x.x.x.x.x.x.x.x.",
      open: hi ? "..............x." : undefined, perc: "...........g....", percRole: "snap",
    };
    case "drill": return {
      kick: pick(rng, ["x.........x.....", "x.......x.x.....", "x......x...x...."]),
      snare: pick(rng, ["........x.......", "........x.....o."]), hats: "", perc: "...x......x..x..", percRole: "rimshot",
    };
    case "boom-bap": return {
      kick: pick(rng, ["x......x..x.....", "x.x.......x.....", "x......xx.x....."]),
      snare: "....x.......x..g", hats: hi ? "x.x.x.x.x.x.x.xo" : "x.x.x.x.x.x.x.x.", open: "..............o.",
    };
    case "lofi": return {
      kick: pick(rng, ["x......x.x......", "x.....x...x....."]),
      snare: "....x.......x...", hats: "o.o.o.o.o.o.o.o.", perc: "gggggggggggggggg", percRole: "shaker",
    };
    case "rnb": return {
      kick: pick(rng, ["x......x..x.....", "x.........x..x.."]),
      snare: "....x.......x...", hats: hi ? "x.xox.xox.xox.xo" : "x.x.x.x.x.x.x.x.", perc: "...g.......g....", percRole: "rimshot",
      extra: [["snap", "....x.......x..."]],
    };
    case "pop": return {
      kick: pick(rng, ["x.......x.......", "x.....x.x.......", "x.......x.x....."]),
      snare: "....x.......x...", hats: "x.x.x.x.x.x.x.x.", perc: hi ? "o.o.o.o.o.o.o.o." : "", percRole: "tambourine",
    };
    case "house": return {
      kick: "x...x...x...x...", snare: "....x.......x...", hats: "gggggggggggggggg", open: "..x...x...x...x.",
      perc: hi ? "o.o.o.o.o.o.o.o." : "", percRole: "shaker",
    };
    case "techno": return {
      kick: "x...x...x...x...", snare: hi ? "....o.......o..." : "", hats: "x.xox.xox.xox.xo", open: "..x...x...x...x.",
      perc: pick(rng, ["...x..x....x..x.", "..x..x..x...x..."]), percRole: "rimshot", extra: hi ? [["ride", "o.o.o.o.o.o.o.o."]] : [],
    };
    case "dnb": return {
      kick: pick(rng, ["x.........x.....", "x.x.......x.....", "x.........x..x.."]),
      snare: "....x.......x..g", hats: hi ? "xoxoxoxoxoxoxoxo" : "x.x.x.x.x.x.x.x.",
    };
    case "dubstep": return {
      kick: pick(rng, ["x...............", "x.........x.....", "x.....x........."]),
      snare: "........x.......", hats: "x..x..x..x..x..x", open: hi ? "............x..." : undefined,
    };
    case "afrobeats": return {
      kick: pick(rng, ["x.....x...x.....", "x..x..x...x....."]), snare: "....o.......o...", hats: "", open: undefined,
      perc: "X.x.X.x.X.x.X.x.", percRole: "shaker",
      extra: [["rimshot", "...x..x....x..x."], ["conga-high", "..x...x.x..x...."], ["conga-low", "x......x....x..."]],
    };
    case "reggaeton": return {
      kick: "x...x...x...x...", snare: "...x..x....x..x.", hats: "x.x.x.x.x.x.x.x.",
      extra: hi ? [["timbale", "..............xx"]] : [],
    };
    case "dancehall": return {
      kick: pick(rng, ["x......x..x.....", "x..x....x..x...."]), snare: "....x.......x...", hats: "x.x.x.x.x.x.x.x.",
      perc: "..x..x....x..x..", percRole: "rimshot",
    };
    case "phonk": return {
      kick: pick(rng, ["x.....x...x.....", "x......x..x....."]), snare: "........x.......", hats: "x.x.x.x.x.x.x.x.",
      perc: pick(rng, ["x..x..x.x..x..x.", "x.xx..x.x.xx..x."]), percRole: "cowbell", open: "......x.......x.",
    };
    case "jersey-club": return {
      kick: pick(rng, ["x..x..x.x..x.x..", "x.....x.x.....x."]), snare: "....x.......x...", hats: "x.x.x.x.x.x.x.x.",
      extra: [["vox-hey", "............x..."]],
    };
    case "synthwave": return {
      kick: pick(rng, ["x...x...x...x...", "x.......x.x....."]), snare: "....X.......X...", hats: "x.x.x.x.x.x.x.x.",
    };
  }
}

function genDrums(spec: ResolvedSpec, sec: ResolvedSection, lengthSteps: number, isLastBeforeChange: boolean, rng: Rng): Record<string, DrumHit[]> {
  const bars = lengthSteps / STEPS_PER_BAR;
  const out: Record<string, DrumHit[]> = {};
  const add = (role: string, hits: DrumHit[]) => {
    if (!hits.length) return;
    out[role] = [...(out[role] ?? []), ...hits];
  };
  const fromGrid = (grid: string, velScale = 1): DrumHit[] => parseGrid(grid, lengthSteps).map((h) => ({ ...h, velocity: clampN(h.velocity * velScale, 0.05, 1) }));

  // explicit grids (section first, then global) override the groove per role
  const overrides: Record<string, string> = { ...spec.drums, ...(sec.drums ?? {}) };
  // EDM intros keep the four-on-the-floor (DJs mix on it); other genres' intros stay light
  const edmIntro = spec.template.form === "edm" && sec.role === "intro";
  const light = !edmIntro && (sec.energy < 0.45 || sec.role === "intro" || sec.role === "outro" || sec.role === "breakdown");
  const g = grooveFor(spec.genre, rng, sec.energy);
  const velScale = 0.75 + 0.25 * sec.energy;
  const snareRole = spec.genre === "rnb" || spec.genre === "lofi" ? (chance(rng, 0.5) ? "rimshot" : "snare") : spec.genre === "afrobeats" || spec.genre === "house" || spec.genre === "pop" || spec.genre === "jersey-club" ? "clap" : "snare";

  if (!light) {
    add("kick", fromGrid(overrides.kick ?? g.kick, velScale));
    if (g.snare || overrides.snare) add(snareRole, fromGrid(overrides.snare ?? overrides[snareRole] ?? g.snare, velScale));
    // layered clap on the backbeat for big sections
    if (sec.energy >= 0.85 && snareRole === "snare" && !spec.template.halfTime) add("clap", fromGrid(g.snare, 0.7));
    if (sec.energy >= 0.85 && spec.template.halfTime) add("clap", fromGrid("........x.......", 0.75));
  }
  // hats: trap/drill/phonk get genre-specific rolls; others read the groove grid
  if (overrides["hat-closed"]) add("hat-closed", fromGrid(overrides["hat-closed"], velScale));
  else if (spec.genre === "drill") {
    // drill bounce: 8th-note triplets with gaps
    const hits: DrumHit[] = [];
    for (let tk = 0; tk < lengthSteps * TICKS_PER_STEP; tk += 32) {
      const inBeat = (tk % 96) / 32;
      if (inBeat === 1 && chance(rng, 0.45)) continue;
      const h = hitAt(tk, inBeat === 0 ? 0.85 : 0.55 + rng() * 0.15, lengthSteps);
      if (h) hits.push(h);
    }
    add("hat-closed", light ? hits.filter((_, i) => i % 2 === 0).map((h) => ({ ...h, velocity: h.velocity * 0.7 })) : hits);
  } else if (g.hats) {
    let hats = fromGrid(g.hats, light ? 0.6 : velScale);
    if ((spec.genre === "trap" || spec.genre === "phonk") && !light) {
      // trap hat rolls: a triplet or 32nd roll in the last beat of every 2nd bar
      for (let b = 1; b < bars; b += 2) {
        const beatStart = b * TICKS_PER_BAR + 3 * 96;
        const roll = chance(rng, 0.5) ? [0, 32, 64] : [0, 12, 24, 36, 48, 60, 72, 84];
        hats = hats.filter((h) => h.index < (beatStart / TICKS_PER_STEP) || h.index >= (beatStart + 96) / TICKS_PER_STEP);
        roll.forEach((off, i) => { const h = hitAt(beatStart + off, 0.55 + (i / roll.length) * 0.4, lengthSteps); if (h) hats.push(h); });
      }
    }
    add("hat-closed", hats);
  }
  if (g.open && !light) add("hat-open", fromGrid(overrides["hat-open"] ?? g.open, velScale * 0.85));
  if (g.perc && g.percRole && (!light || g.percRole === "shaker")) add(g.percRole, fromGrid(overrides[g.percRole] ?? g.perc, light ? 0.55 : velScale));
  for (const [role, grid] of g.extra ?? []) if (!light || sec.role === "intro") add(role, fromGrid(overrides[role] ?? grid, light ? 0.6 : velScale));
  // any extra override roles not covered above
  for (const [role, grid] of Object.entries(overrides)) {
    if (!out[role] && !["kick", "snare", "clap", "rimshot", "hat-closed", "hat-open"].includes(role)) add(role, fromGrid(grid, velScale));
  }

  // build sections: classic accelerating snare roll across the section
  if (sec.role === "build" || sec.role === "pre-chorus") {
    const roll: DrumHit[] = [];
    const total = lengthSteps * TICKS_PER_STEP;
    for (let tk = 0; tk < total;) {
      const progress = tk / total;
      const stepTicks = progress < 0.5 ? 96 : progress < 0.75 ? 48 : progress < 0.9 ? 24 : 12;
      const h = hitAt(tk, 0.35 + progress * 0.6, lengthSteps);
      if (h) roll.push(h);
      tk += stepTicks;
    }
    add(sec.role === "build" ? "snare" : "clap", roll);
  }

  // end-of-section fill into the next section
  if (isLastBeforeChange && !light && lengthSteps >= 16) {
    const fillStart = lengthSteps - (sec.energy > 0.8 ? 8 : 4);
    if (spec.genre === "trap" || spec.genre === "drill" || spec.genre === "phonk" || spec.genre === "dubstep") {
      // trap-style: drop the kick for the last beat (the classic "pause before the hook")
      if (out.kick) out.kick = out.kick.filter((h) => h.index < lengthSteps - 4);
      add("snare", [hitAt((lengthSteps - 2) * TICKS_PER_STEP, 0.7, lengthSteps), hitAt((lengthSteps - 1) * TICKS_PER_STEP, 0.9, lengthSteps)].filter((h): h is DrumHit => !!h));
    } else if (spec.genre === "synthwave" || spec.genre === "pop" || spec.genre === "boom-bap" || spec.genre === "dnb") {
      const toms = ["tom-high", "tom-mid", "tom-low"];
      for (let i = fillStart; i < lengthSteps; i++) {
        const role = toms[Math.min(toms.length - 1, Math.floor(((i - fillStart) / (lengthSteps - fillStart)) * toms.length))]!;
        add(role, [{ index: i, velocity: 0.65 + 0.3 * ((i - fillStart) / (lengthSteps - fillStart)), micro: 0, probability: 1 }]);
      }
    } else {
      const hits: DrumHit[] = [];
      for (let i = fillStart; i < lengthSteps; i++) hits.push({ index: i, velocity: 0.45 + 0.5 * ((i - fillStart) / (lengthSteps - fillStart)), micro: 0, probability: 1 });
      add(snareRole, hits);
    }
  }

  // dedupe identical (index, micro) per role and humanize velocities slightly
  for (const role of Object.keys(out)) {
    const seen = new Set<string>();
    out[role] = out[role]!
      .filter((h) => { const k = `${h.index}:${h.micro}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((h) => ({ ...h, velocity: clampN(h.velocity + (rng() - 0.5) * 0.06, 0.05, 1) }))
      .sort((a, b) => a.index - b.index || a.micro - b.micro);
  }
  return out;
}

// ───────────────────────────── harmony per section ─────────────────────────────

interface BarChord { degree: number; tones: number[]; voicing: number[]; rootMidi: number; label: string }

function chordsForSection(spec: ResolvedSpec, bars: number): BarChord[] {
  const scale = SCALES[spec.harmonyScale]!;
  const out: BarChord[] = [];
  let prev: number[] | null = null;
  for (let b = 0; b < bars; b++) {
    const idx = Math.floor(b / spec.template.harmonicBars) % spec.progression.length;
    const degree = spec.progression[idx]!;
    const tones = chordTones(degree, scale, spec.template.chordExt);
    const voicing = voiceChord(tones, spec.rootPc, 62, prev);
    prev = voicing;
    const rootPc = (spec.rootPc + scale[degree]!) % 12;
    const rootMidi = 24 + rootPc + (rootPc < 4 ? 12 : 0); // E1..D#2 band keeps 808s/subs in their sweet spot
    out.push({ degree, tones, voicing, rootMidi, label: spec.progressionLabels[idx] ?? ROMAN[degree]! });
  }
  return out;
}

// ───────────────────────────── bass ─────────────────────────────

function genBass(spec: ResolvedSpec, sec: ResolvedSection, lengthSteps: number, chords: BarChord[], kickHits: DrumHit[], rng: Rng): PitchedNote[] {
  const notes: PitchedNote[] = [];
  const bars = lengthSteps / STEPS_PER_BAR;
  const scale = SCALES[spec.harmonyScale]!;
  const fifthOf = (c: BarChord) => {
    const fifthPc = (spec.rootPc + scale[(c.degree + 4) % 7]!) % 12;
    let m = c.rootMidi - c.rootMidi % 12 + fifthPc;
    if (m < c.rootMidi) m += 12;
    return m;
  };
  const push = (pitch: number, startTick: number, lengthTicks: number, velocity: number) => {
    if (startTick >= lengthSteps * TICKS_PER_STEP) return;
    notes.push({ pitch: foldPitch(pitch, 24, 52), startTick: Math.max(0, Math.round(startTick)), lengthTicks: Math.max(12, Math.round(Math.min(lengthTicks, lengthSteps * TICKS_PER_STEP - startTick))), velocity: clampN(velocity, 0.3, 1) });
  };
  const style = spec.styles.bass;

  if (style === "808" || style === "dembow") {
    // 808 follows the kick: each kick starts a note that sustains until the next kick
    const kicks = [...kickHits].sort((a, b) => a.index - b.index);
    const src = kicks.length ? kicks : Array.from({ length: bars }, (_, b) => ({ index: b * 16, velocity: 0.9, micro: 0, probability: 1 }));
    src.forEach((k, i) => {
      const tick = k.index * TICKS_PER_STEP + k.micro;
      const bar = Math.min(bars - 1, Math.floor(k.index / 16));
      const chord = chords[bar]!;
      const next = src[i + 1];
      const end = next ? next.index * TICKS_PER_STEP + next.micro : Math.min(lengthSteps * TICKS_PER_STEP, (bar + 1) * TICKS_PER_BAR);
      let pitch = chord.rootMidi;
      // occasional octave jump / fifth on off-beat kicks for movement
      if (k.index % 16 !== 0 && chance(rng, 0.25)) pitch = chance(rng, 0.5) ? pitch + 12 : fifthOf(chord);
      // glide: slight overlap into the next note so mono 808s slide
      const overlap = next && chance(rng, 0.3) ? 18 : -6;
      push(pitch, tick, Math.min(TICKS_PER_BAR, end - tick + overlap), 0.85 + k.velocity * 0.15);
    });
  } else if (style === "offbeat") {
    for (let b = 0; b < bars; b++) {
      const c = chords[b]!;
      for (let beat = 0; beat < 4; beat++) push(beat % 2 === 1 && chance(rng, 0.3) ? c.rootMidi + 12 : c.rootMidi, b * TICKS_PER_BAR + beat * 96 + 48, 40, 0.85);
    }
  } else if (style === "rolling") {
    const mask = pick(rng, ["xxx.xxx.xxx.xx.x", "x.xxx.xxx.xxx.xx", "xx.xxx.xx.xxx.x."]);
    for (let b = 0; b < bars; b++) {
      const c = chords[b]!;
      for (let s = 0; s < 16; s++) if (mask[s] === "x") push(s % 4 === 0 ? c.rootMidi : chance(rng, 0.2) ? c.rootMidi + 12 : c.rootMidi, b * TICKS_PER_BAR + s * TICKS_PER_STEP, 20, s % 4 === 0 ? 0.95 : 0.7);
    }
  } else if (style === "reese") {
    for (let b = 0; b < bars; b += spec.template.harmonicBars) {
      const c = chords[b]!;
      push(c.rootMidi, b * TICKS_PER_BAR, TICKS_PER_BAR * spec.template.harmonicBars - 12, 0.9);
    }
  } else if (style === "walking") {
    for (let b = 0; b < bars; b++) {
      const c = chords[b]!;
      const tonesMidi = c.tones.map((t) => clampN(c.rootMidi + (t - c.tones[0]!), 28, 50));
      for (let beat = 0; beat < 4; beat++) {
        const p = beat === 0 ? c.rootMidi : tonesMidi[(beat + Math.floor(rng() * 2)) % tonesMidi.length]!;
        push(p, b * TICKS_PER_BAR + beat * 96, 88, beat === 0 ? 0.95 : 0.78);
      }
    }
  } else if (style === "afro") {
    const rhythm = pick(rng, [[0, 6, 10], [0, 3, 6, 10, 14], [0, 7, 10, 12]]);
    for (let b = 0; b < bars; b++) {
      const c = chords[b]!;
      rhythm.forEach((s, i) => push(i % 2 === 1 && chance(rng, 0.4) ? fifthOf(c) : c.rootMidi, b * TICKS_PER_BAR + s * TICKS_PER_STEP, 60, i === 0 ? 0.95 : 0.8));
    }
  } else if (style === "sub") {
    for (let b = 0; b < bars; b++) {
      const c = chords[b]!;
      push(c.rootMidi, b * TICKS_PER_BAR, sec.energy > 0.8 ? 180 : TICKS_PER_BAR - 12, 0.9);
      if (sec.energy > 0.8) push(c.rootMidi, b * TICKS_PER_BAR + 240, 120, 0.8);
    }
  }
  return notes;
}

// ───────────────────────────── chords ─────────────────────────────

function genChords(spec: ResolvedSpec, sec: ResolvedSection, lengthSteps: number, chords: BarChord[], rng: Rng): PitchedNote[] {
  const notes: PitchedNote[] = [];
  const bars = lengthSteps / STEPS_PER_BAR;
  const style = sec.role === "intro" || sec.role === "breakdown" ? (spec.styles.chords === "none" ? "none" : "pad") : spec.styles.chords;
  const v = 0.55 + 0.3 * sec.energy;
  const chordAt = (c: BarChord, start: number, len: number, vel: number) => {
    for (const p of c.voicing) notes.push({ pitch: foldPitch(p, 45, 84), startTick: Math.round(start), lengthTicks: Math.max(12, Math.round(len)), velocity: clampN(vel, 0.2, 1) });
  };
  for (let b = 0; b < bars; b++) {
    const c = chords[b]!;
    const bt = b * TICKS_PER_BAR;
    switch (style) {
      case "none": break;
      case "pad": case "block":
        if (b % spec.template.harmonicBars === 0) chordAt(c, bt, TICKS_PER_BAR * spec.template.harmonicBars - 6, v * 0.9);
        break;
      case "stabs":
        for (let beat = 0; beat < 4; beat++) chordAt(c, bt + beat * 96 + 48, 30, v);
        break;
      case "skank":
        for (const s of [2, 6, 10, 14]) chordAt(c, bt + s * TICKS_PER_STEP, 26, v * 0.85);
        break;
      case "pulse":
        for (let beat = 0; beat < 4; beat++) chordAt(c, bt + beat * 96, 80, beat === 0 ? v : v * 0.78);
        break;
      case "pluck":
        for (const s of [0, 3, 6, 8, 11, 14]) chordAt(c, bt + s * TICKS_PER_STEP, 40, s === 0 ? v : v * 0.75);
        break;
      case "arp": {
        const tones = [...c.voicing, c.voicing[0]! + 12];
        const rate = sec.energy > 0.75 ? 1 : 2; // 16ths at high energy, 8ths otherwise
        let i = 0;
        for (let s = 0; s < 16; s += rate) {
          const p = tones[(chance(rng, 0.1) ? i + 1 : i) % tones.length]!;
          notes.push({ pitch: foldPitch(p, 45, 88), startTick: bt + s * TICKS_PER_STEP, lengthTicks: rate * TICKS_PER_STEP - 4, velocity: clampN((s % 4 === 0 ? v : v * 0.75), 0.2, 1) });
          i++;
        }
        break;
      }
    }
  }
  return notes;
}

// ───────────────────────────── melody ─────────────────────────────

const RHYTHMS: Record<MelodyStyle, string[]> = {
  bells: ["x..x..x...x.x...|x..x..x.....x...", "x.x...x.x.x.....|x.x...x...x.x..."],
  motif: ["x...x.x.....x...|x...x.x...x.x...", "x.x.x...x.x.....|x.x.x...x...x..."],
  lead: ["x.x...x.x.x.....|x.x...x...x.xx..", "x...x.x.x...x...|x...x.x.x.x....."],
  arp: ["x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x."],
  sparse: ["x.......x.....x.|x.......x.......", "x.....x.....x...|..........x....."],
  none: [""],
};

/** Map a scale degree (any integer) to MIDI inside the melody scale around `baseOctaveMidi`. */
function degreeToMidi(degree: number, rootPc: number, scale: number[], baseOctaveMidi: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return baseOctaveMidi + rootPc + scale[idx]! + 12 * oct;
}

function genMelody(spec: ResolvedSpec, sec: ResolvedSection, lengthSteps: number, chords: BarChord[], rng: Rng, variant: "main" | "counter"): PitchedNote[] {
  const style = spec.styles.melody;
  if (style === "none") return [];
  const mScale = SCALES[["trap", "drill", "phonk", "boom-bap", "afrobeats", "pop", "reggaeton", "dancehall"].includes(spec.genre) && SCALES[spec.harmonyScale]!.length === 7 && spec.scale !== "harmonic minor"
    ? (spec.harmonyScale === "major" || spec.harmonyScale === "mixolydian" ? "pentatonic major" : "pentatonic minor")
    : spec.scale]!;
  const hScale = SCALES[spec.harmonyScale]!;
  const notes: PitchedNote[] = [];
  const bars = lengthSteps / STEPS_PER_BAR;
  const hook = sec.role === "hook" || sec.role === "chorus" || sec.role === "drop";
  // bases are octaves of C so degree math stays in key: C3 counter, C4 verse, C5 hooks & bells
  const base = variant === "counter" ? 48 : style === "bells" || hook ? 72 : 60;

  if (variant === "counter") {
    // slow guide-tone line: chord 3rds/7ths, one note per harmonic span
    for (let b = 0; b < bars; b += spec.template.harmonicBars) {
      const c = chords[b]!;
      const tone = c.tones[1]! + (c.tones[3] !== undefined && chance(rng, 0.4) ? c.tones[3]! - c.tones[1]! : 0);
      let p = base + 12 + ((spec.rootPc + tone) % 12);
      if (p > 76) p -= 12;
      notes.push({ pitch: p, startTick: b * TICKS_PER_BAR, lengthTicks: TICKS_PER_BAR * spec.template.harmonicBars - 12, velocity: 0.55 + 0.2 * sec.energy });
    }
    return notes;
  }

  // build (or take) a 2-bar motif in scale degrees, then develop it as A A' A B over 8 bars
  let motif = spec.motif;
  if (!motif) {
    const rhythm = pick(rng, RHYTHMS[style]).replace("|", "");
    motif = [];
    let deg = pick(rng, [0, 2, 4, 7]);
    for (let s = 0; s < 32; s++) {
      if (rhythm[s] !== "x") continue;
      let next = s + 1;
      while (next < 32 && rhythm[next] !== "x") next++;
      const len = Math.max(1, Math.min(style === "sparse" ? 6 : 4, next - s));
      motif.push({ degree: deg, step: s, length: len });
      const leap = chance(rng, 0.18);
      deg += leap ? pick(rng, [-4, -3, 3, 4]) : pick(rng, [-2, -1, -1, 1, 1, 2, 0]);
      deg = clampN(deg, -3, 9);
    }
  }
  for (let phrase = 0; phrase * 2 < bars; phrase++) {
    const startBar = phrase * 2;
    const variantN = phrase % 4; // 0=A 1=A' 2=A 3=B
    const transpose = variantN === 3 ? pick(rng, [2, -1, 3]) : 0;
    for (const m of motif) {
      if (variantN === 1 && m.step >= 16 && chance(rng, 0.5)) continue; // A' answers with space
      const bar = startBar + Math.floor(m.step / 16);
      if (bar >= bars) continue;
      const chord = chords[bar]!;
      // degrees are documented against the 7-note scale (2 = third, 4 = fifth); the melody
      // scale (often its pentatonic subset) is enforced by the snap below
      let midi = degreeToMidi(m.degree + transpose, spec.rootPc, hScale, base);
      // strong beats land on chord tones (keeps the line consonant with the harmony)
      if (m.step % 8 === 0) {
        const chordPcs = chord.tones.map((t) => (spec.rootPc + t) % 12);
        let bestMidi = midi, bestDist = 99;
        for (let d = -3; d <= 3; d++) {
          const cand = midi + d;
          if (chordPcs.includes(((cand % 12) + 12) % 12) && hScale.includes((((cand - spec.rootPc) % 12) + 12) % 12) && Math.abs(d) < bestDist) { bestDist = Math.abs(d); bestMidi = cand; }
        }
        midi = bestMidi;
      }
      // final safety: never leave the key
      while (!mScale.includes((((midi - spec.rootPc) % 12) + 12) % 12)) midi--;
      notes.push({
        pitch: foldPitch(midi, 55, 96),
        startTick: bar * TICKS_PER_BAR + (m.step % 16) * TICKS_PER_STEP,
        lengthTicks: Math.max(12, m.length * TICKS_PER_STEP - 4),
        velocity: clampN((m.step % 4 === 0 ? 0.85 : 0.68) * (0.8 + 0.2 * sec.energy) + (rng() - 0.5) * 0.06, 0.25, 1),
      });
    }
  }
  return notes;
}

// ───────────────────────────── mix plan ─────────────────────────────

function mixPlanFor(spec: ResolvedSpec, sections: ProducedSection[]): MixPlan {
  const m = spec.mix;
  const sat = m.saturation;
  const part = (volumeDb: number, effects: MixPartPlan["effects"], extra: Partial<MixPartPlan> = {}): MixPartPlan => ({
    volumeDb, pan: 0, effects, reverbSendDb: null, delaySendDb: null, sidechained: false, ...extra,
  });
  const revDb = (amt: number) => (amt <= 0.02 ? null : Math.round(-24 + amt * 18));
  const beatSec = 60 / spec.bpm;
  const sweeps: MixPlan["filterSweeps"] = [];
  for (const s of sections) {
    const start = s.startBar * TICKS_PER_BAR, len = s.bars * TICKS_PER_BAR;
    if (s.role === "intro") sweeps.push({ startTick: start, lengthTicks: len, fromHz: 350, toHz: 20000 });
    if (s.role === "build") sweeps.push({ startTick: start, lengthTicks: len, fromHz: 900, toHz: 20000 });
  }
  return {
    parts: {
      kick: part(-2.5, [{ type: "eq3", params: { low: 2, mid: -2, high: 1 } }, { type: "transient", params: { attack: 0.6, sustain: -3 } }]),
      drums: part(-6, [{ type: "eq3", params: { low: -3, mid: 0, high: 2 } }, { type: "compressor", params: { threshold: -18, ratio: 3, attack: 0.01, release: 0.15 } }], { reverbSendDb: revDb(m.reverb * 0.4) }),
      bass: part(-5, [{ type: "saturation", params: { drive: clampN(sat * 0.8, 0, 1), warmth: 0.6 } }, { type: "eq3", params: { low: 1, mid: -1, high: -4 } }], { sidechained: m.sidechain }),
      chords: part(-11, [{ type: "eq3", params: { low: -8, mid: 0, high: 1, lowFreq: 220 } }, { type: "widener", params: { width: m.width, rate: 4, depth: 0.4 } }], { reverbSendDb: revDb(m.reverb), sidechained: m.sidechain, pan: 0 }),
      melody: part(-8.5, [{ type: "eq3", params: { low: -10, mid: 1, high: 2, lowFreq: 300 } }], { reverbSendDb: revDb(m.reverb * 0.8), delaySendDb: revDb(m.delay), pan: 0.08 }),
      counter: part(-14, [{ type: "eq3", params: { low: -10, mid: 0, high: 0, lowFreq: 300 } }, { type: "chorus", params: { rate: 0.8, depth: 0.5, wet: 0.4 } }], { reverbSendDb: revDb(m.reverb * 1.1), sidechained: m.sidechain, pan: -0.12 }),
      fx: part(-12, [{ type: "eq3", params: { low: -12, mid: 0, high: 0, lowFreq: 250 } }], { reverbSendDb: revDb(0.6) }),
    },
    reverb: { decay: 1.6 + m.reverb * 3, preDelay: 0.02 },
    delay: { time: clampN(beatSec * 0.75, 0.02, 1.5), feedback: 0.3 + m.delay * 0.25 },
    master: [
      { type: "eq3", params: { low: 0.5, mid: -0.5, high: 1 } },
      { type: "compressor", params: { threshold: -14, ratio: 2, attack: 0.03, release: 0.25, knee: 12 } },
      // drive into the limiter: the auto-mix raises this (never the post-limiter fader) to reach loudness
      { type: "gain", params: { gain: 6 } },
      { type: "limiter", params: { threshold: -1 } },
    ],
    filterSweeps: sweeps,
  };
}

// ───────────────────────────── main entry ─────────────────────────────

export function buildProduction(raw: ProductionSpec | ResolvedSpec): Production {
  const spec = "template" in raw ? raw : resolveSpec(raw);
  const parts: ProducedPart[] = [];
  const sections: ProducedSection[] = [];
  const generated = new Set<string>();
  let bar = 0;

  spec.sections.forEach((sec, i) => {
    const chords = chordsForSection(spec, Math.min(sec.bars, MAX_PATTERN_BARS));
    sections.push({ name: sec.name, role: sec.role, bars: sec.bars, energy: sec.energy, startBar: bar, parts: sec.parts, chords: chords.map((c) => c.label) });
    bar += sec.bars;
    if (generated.has(sec.name)) return; // repeated sections reuse their patterns
    generated.add(sec.name);

    const patternBars = Math.min(sec.bars, MAX_PATTERN_BARS);
    const lengthSteps = patternBars * STEPS_PER_BAR;
    const next = spec.sections[i + 1];
    const fillIntoNext = !!next && next.energy > sec.energy;
    const sub = (what: string) => seededRng(spec.seed ^ hash(`${sec.name}|${what}`));

    let kickHits: DrumHit[] = [];
    if (sec.parts.includes("drums")) {
      const drums = genDrums(spec, sec, lengthSteps, fillIntoNext, sub("drums"));
      kickHits = drums.kick ?? [];
      if (Object.keys(drums).length) parts.push({ role: "drums", section: sec.name, lengthSteps, drums });
    }
    if (sec.parts.includes("bass") && spec.styles.bass !== "none") {
      const notes = genBass(spec, sec, lengthSteps, chords, kickHits, sub("bass"));
      if (notes.length) parts.push({ role: "bass", section: sec.name, lengthSteps, notes });
    }
    if (sec.parts.includes("chords")) {
      const notes = genChords(spec, sec, lengthSteps, chords, sub("chords"));
      if (notes.length) parts.push({ role: "chords", section: sec.name, lengthSteps, notes });
    }
    if (sec.parts.includes("melody")) {
      const notes = genMelody(spec, sec, lengthSteps, chords, seededRng(spec.seed ^ hash("motif")), "main");
      if (notes.length) parts.push({ role: "melody", section: sec.name, lengthSteps, notes });
    }
    if (sec.parts.includes("counter")) {
      const notes = genMelody(spec, sec, lengthSteps, chords, sub("counter"), "counter");
      if (notes.length) parts.push({ role: "counter", section: sec.name, lengthSteps, notes });
    }
  });

  // transitions: crash/impact on big downbeats, reverse cymbal + riser leading into them
  const fx: FxPlacement[] = [];
  sections.forEach((s, i) => {
    const prev = sections[i - 1];
    const start = s.startBar * TICKS_PER_BAR;
    const rising = !!prev && s.energy - prev.energy >= 0.2;
    if (rising || (s.energy >= 0.9 && i > 0)) {
      fx.push({ role: "crash", tick: start, velocity: 0.85 });
      if (s.role === "drop") fx.push({ role: "impact", tick: start, velocity: 0.9 });
      if (start >= TICKS_PER_BAR) fx.push({ role: "reverse-cymbal", tick: start - TICKS_PER_BAR, velocity: 0.75 });
      if ((s.role === "drop" || s.role === "hook" || s.role === "chorus") && start >= 2 * TICKS_PER_BAR && prev?.role !== "build") {
        fx.push({ role: "riser", tick: start - 2 * TICKS_PER_BAR, velocity: 0.6 });
      }
    }
    if (s.role === "build" && i + 1 < sections.length) fx.push({ role: "riser", tick: start, velocity: 0.7 });
  });

  return { spec, sections, parts, fx, mix: mixPlanFor(spec, sections), totalBars: bar };
}

/** Human-readable one-paragraph description of a production (shown in the UI + fed to AI critics). */
export function describeProduction(p: Production): string {
  const s = p.spec;
  const form = p.sections.map((x) => `${x.name} ${x.bars}`).join(" → ");
  const minutes = (p.totalBars * 4 * 60) / s.bpm / 60;
  return `${s.title}: ${s.template.name} at ${s.bpm} BPM in ${s.key} ${s.scale}. Progression ${s.progressionLabels.join("–")}. Form (bars): ${form}. ~${minutes.toFixed(1)} min. Bass ${s.styles.bass}, chords ${s.styles.chords}, melody ${s.styles.melody}, kit ${s.instruments.kit}.`;
}
