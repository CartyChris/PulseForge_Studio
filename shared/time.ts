/**
 * Musical time for PulseForge.
 *
 * Canonical unit: the TICK. PPQ ticks per quarter note.
 * A "step" is a 16th note (PPQ / 4 ticks). Bars derive from the time signature.
 * Seconds derive from BPM (quarter note = 60 / bpm seconds, regardless of denominator's
 * notated value — BPM in PulseForge always means quarter notes per minute).
 */

export const PPQ = 96;
export const TICKS_PER_STEP = PPQ / 4; // 24

export interface TimeSignature {
  num: number; // beats per bar
  den: number; // beat unit (4 = quarter, 8 = eighth)
}

export interface BBST {
  bar: number; // 0-based
  beat: number; // 0-based within bar
  step: number; // 0-based 16th within beat
  tick: number; // 0-based remainder ticks
}

/** Ticks in one beat of the given signature (a "beat" is 1/den of a whole note). */
export function ticksPerBeat(sig: TimeSignature): number {
  return (PPQ * 4) / sig.den;
}

export function ticksPerBar(sig: TimeSignature): number {
  return ticksPerBeat(sig) * sig.num;
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return (seconds / (60 / bpm)) * PPQ;
}

export function ticksToBBST(ticks: number, sig: TimeSignature): BBST {
  const tpb = ticksPerBar(sig);
  const tpbeat = ticksPerBeat(sig);
  const bar = Math.floor(ticks / tpb);
  let rem = ticks - bar * tpb;
  const beat = Math.floor(rem / tpbeat);
  rem -= beat * tpbeat;
  const step = Math.floor(rem / TICKS_PER_STEP);
  rem -= step * TICKS_PER_STEP;
  return { bar, beat, step, tick: rem };
}

export function bbstToTicks(t: BBST, sig: TimeSignature): number {
  return t.bar * ticksPerBar(sig) + t.beat * ticksPerBeat(sig) + t.step * TICKS_PER_STEP + t.tick;
}

/** Human display: bars.beats.steps (1-based) as in classic pattern DAWs. */
export function formatPosition(ticks: number, sig: TimeSignature): string {
  const { bar, beat, step } = ticksToBBST(Math.max(0, Math.floor(ticks)), sig);
  return `${bar + 1}.${beat + 1}.${step + 1}`;
}

export function formatSeconds(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, "0")}`;
}

export type SnapValue = "none" | "bar" | "beat" | "1/2" | "1/4" | "1/8" | "1/16" | "1/32" | "step";

export function snapTicks(value: SnapValue, sig: TimeSignature): number {
  switch (value) {
    case "none": return 1;
    case "bar": return ticksPerBar(sig);
    case "beat": return ticksPerBeat(sig);
    case "1/2": return PPQ * 2;
    case "1/4": return PPQ;
    case "1/8": return PPQ / 2;
    case "1/16":
    case "step": return TICKS_PER_STEP;
    case "1/32": return TICKS_PER_STEP / 2;
  }
}

export function snap(ticks: number, value: SnapValue, sig: TimeSignature): number {
  const grid = snapTicks(value, sig);
  return Math.round(ticks / grid) * grid;
}

export function snapFloor(ticks: number, value: SnapValue, sig: TimeSignature): number {
  const grid = snapTicks(value, sig);
  return Math.floor(ticks / grid) * grid;
}

/** Swing: delay every off-16th by amount * half a step. amount 0..1. */
export function swungTick(tick: number, amount: number): number {
  if (amount <= 0) return tick;
  const stepIndex = Math.floor(tick / TICKS_PER_STEP);
  const isOffStep = stepIndex % 2 === 1;
  return isOffStep ? tick + amount * (TICKS_PER_STEP / 2) : tick;
}

/** Euclidean rhythm (Bjorklund): distribute `pulses` onsets over `steps` slots. */
export function euclideanPattern(steps: number, pulses: number, rotation = 0): boolean[] {
  const out: boolean[] = new Array(Math.max(0, steps)).fill(false);
  if (steps <= 0 || pulses <= 0) return out;
  const p = Math.min(pulses, steps);
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += p;
    if (bucket >= steps) {
      bucket -= steps;
      out[(i + rotation) % steps] = true;
    }
  }
  return out;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function midiToName(midi: number): string {
  const n = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${n}${Math.floor(midi / 12) - 1}`;
}

export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])(#|b)?(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semitone = base[m[1]!.toUpperCase()]!;
  if (m[2] === "#") semitone += 1;
  if (m[2] === "b") semitone -= 1;
  return (Number(m[3]) + 1) * 12 + semitone;
}

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic minor": [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "pentatonic major": [0, 2, 4, 7, 9],
  "pentatonic minor": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export function inScale(midi: number, rootPitchClass: number, scale: number[]): boolean {
  return scale.includes((((midi - rootPitchClass) % 12) + 12) % 12);
}

export const CHORD_SHAPES: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14],
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}
