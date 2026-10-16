/**
 * Sample starters: royalty-free loops PulseForge renders itself (no downloads, nothing to clear),
 * made to be chopped and flipped. Drum-less by default, like a record you'd dig for, with the
 * chords/melody on real sampled instruments where they exist (Salamander piano, VSCO 2 orchestra).
 */
import { ProductionSpecSchema, type ProductionSpec, type PartRole } from "../../shared/producer";

export interface SampleStarter {
  id: string;
  name: string;
  blurb: string;
  spec: ProductionSpec;
  parts: PartRole[];
  bars: 4 | 8;
}

const st = (id: string, name: string, blurb: string, spec: Record<string, unknown>, parts: PartRole[] = ["chords", "melody"], bars: 4 | 8 = 8): SampleStarter =>
  ({ id, name, blurb, spec: ProductionSpecSchema.parse({ title: name, ...spec }), parts, bars });

export const SAMPLE_STARTERS: SampleStarter[] = [
  st("soul-keys", "Soul Keys", "Warm electric piano 7ths at 84 BPM: classic chop material", { genre: "rnb", bpm: 84, key: "D", scale: "minor", instruments: { chords: "ep-warm", melody: "ep-classic" }, styles: { chords: "block", melody: "sparse" } }),
  st("grand-piano-ballad", "Grand Piano Ballad", "Real sampled grand piano, emotional minor chords at 72 BPM", { genre: "rnb", bpm: 72, key: "A", scale: "minor", instruments: { chords: "grand-piano", melody: "grand-piano" }, styles: { chords: "block", melody: "motif" } }),
  st("orchestral-strings", "Orchestral Strings", "Sampled string ensemble swells, cinematic boom bap fodder at 90 BPM", { genre: "boom-bap", bpm: 90, key: "C", scale: "minor", instruments: { chords: "strings-ensemble", melody: "pizzicato" }, styles: { chords: "pad", melody: "motif" } }),
  st("drill-flute", "Drill Flute", "Haunting flute line over dark strings at 142 BPM", { genre: "drill", bpm: 142, key: "F#", scale: "harmonic minor", instruments: { chords: "strings-ensemble", melody: "flute" }, styles: { melody: "motif" } }),
  st("harp-arp", "Harp Arpeggios", "Sampled harp arpeggios, dreamy major key at 100 BPM", { genre: "pop", bpm: 100, key: "G", scale: "major", instruments: { chords: "harp", melody: "harp" }, styles: { chords: "arp", melody: "none" } }, ["chords"]),
  st("dusty-jazz", "Dusty Jazz Chords", "Lo-fi piano 7ths with a lazy swing at 80 BPM", { genre: "lofi", bpm: 80, key: "F", scale: "dorian", instruments: { chords: "piano-lofi", melody: "ep-classic" }, styles: { chords: "block", melody: "sparse" } }),
  st("afro-marimba", "Afro Marimba", "Bright sampled marimba riff at 104 BPM", { genre: "afrobeats", bpm: 104, key: "E", scale: "minor", instruments: { chords: "pad-warm-analog", melody: "marimba" }, styles: { melody: "motif" } }, ["melody"]),
  st("choir-pad", "Choir Pad", "Dark choir 'ahh' pad, perfect for screwing at 70 BPM", { genre: "screwed", bpm: 70, key: "C", scale: "minor", instruments: { chords: "choir-ahh" }, styles: { chords: "pad" } }, ["chords"]),
  st("memphis-bells", "Memphis Bells", "Eerie bell motif in phrygian at 140 BPM", { genre: "phonk", bpm: 140, key: "C#", scale: "phrygian", instruments: { chords: "pad-dark-drone", melody: "bell" }, styles: { melody: "bells" } }),
  st("synth-brass", "Synthwave Brass", "Big 80s synth stabs at 110 BPM", { genre: "synthwave", bpm: 110, key: "A", scale: "minor", instruments: { chords: "synth-chord", melody: "lead-retro" }, styles: { chords: "stabs", melody: "lead" } }),
  st("full-break", "Drum Break", "A dusty boom bap drum break to chop into a kit", { genre: "boom-bap", bpm: 92 }, ["drums"], 4),
  st("trap-loop", "Trap Bell Loop", "Dark bells over a pad at 140 BPM", { genre: "trap", bpm: 140, key: "G", scale: "minor", instruments: { chords: "piano-dark", melody: "bell" } }),
];
