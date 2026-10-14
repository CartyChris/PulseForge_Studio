/**
 * Pure note transforms used by the Piano Roll. Kept free of React/audio so they are
 * directly unit-testable and reusable by AI edit commands.
 * Every function takes notes and returns NEW notes; none mutate the input.
 */
import type { Note } from "./project";
import { newId } from "./project";
import { TICKS_PER_STEP, clamp } from "./time";

const clampVel = (v: number) => clamp(v, 0.05, 1);

/** Spread a chord's notes across time so it sounds strummed (guitar/harp feel). */
export function strum(notes: Note[], spreadTicks: number, direction: "up" | "down" = "up"): Note[] {
  const groups = groupByStart(notes);
  const out: Note[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) { out.push(...group); continue; }
    const ordered = [...group].sort((a, b) => (direction === "up" ? a.pitch - b.pitch : b.pitch - a.pitch));
    ordered.forEach((n, i) => {
      const offset = i * spreadTicks;
      out.push({ ...n, startTick: n.startTick + offset, lengthTicks: Math.max(6, n.lengthTicks - offset) });
    });
  }
  return out;
}

/** Add a quick grace-note copy just before each note (drum flam / ornament). */
export function flam(notes: Note[], offsetTicks = 8, velocityScale = 0.6): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    const graceStart = n.startTick - offsetTicks;
    if (graceStart >= 0) {
      out.push({ ...n, id: newId("n"), startTick: graceStart, lengthTicks: Math.max(4, offsetTicks), velocity: clampVel(n.velocity * velocityScale) });
    }
    out.push(n);
  }
  return out;
}

/** Subdivide each note into `count` repeats (note repeat / trap hi-hat roll). */
export function roll(notes: Note[], count: number, velocityCurve: "flat" | "up" | "down" = "flat"): Note[] {
  const n2 = Math.max(2, Math.round(count));
  const out: Note[] = [];
  for (const n of notes) {
    const each = Math.max(3, Math.floor(n.lengthTicks / n2));
    for (let i = 0; i < n2; i++) {
      const t = n2 === 1 ? 0 : i / (n2 - 1);
      const scale = velocityCurve === "up" ? 0.5 + 0.5 * t : velocityCurve === "down" ? 1 - 0.5 * t : 1;
      out.push({
        ...n,
        id: i === 0 ? n.id : newId("n"),
        startTick: n.startTick + i * each,
        lengthTicks: each,
        velocity: clampVel(n.velocity * scale),
      });
    }
  }
  return out;
}

/** Linear velocity ramp across the selection, ordered by time (crescendo / diminuendo). */
export function velocityRamp(notes: Note[], from: number, to: number): Note[] {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  const last = sorted.length - 1;
  const byId = new Map(sorted.map((n, i) => [n.id, last === 0 ? to : from + (to - from) * (i / last)]));
  return notes.map((n) => ({ ...n, velocity: clampVel(byId.get(n.id) ?? n.velocity) }));
}

/** Snap every pitch to the nearest note of the given scale (never leaves the key). */
export function snapToScale(notes: Note[], rootPc: number, scale: number[]): Note[] {
  const allowed = new Set(scale.map((s) => ((s % 12) + 12) % 12));
  if (!allowed.size) return notes.map((n) => ({ ...n }));
  return notes.map((n) => {
    let best = n.pitch, bestDist = Infinity;
    for (let m = n.pitch - 6; m <= n.pitch + 6; m++) {
      if (m < 0 || m > 127) continue;
      if (!allowed.has((((m - rootPc) % 12) + 12) % 12)) continue;
      // ties resolve downward (matches how DAWs snap "in-between" notes)
      const d = Math.abs(m - n.pitch);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    return { ...n, pitch: best };
  });
}

/** Shift note starts in time, clamped at zero. */
export function nudge(notes: Note[], deltaTicks: number): Note[] {
  return notes.map((n) => ({ ...n, startTick: Math.max(0, n.startTick + deltaTicks) }));
}

/** Scale note lengths (staccato < 1 < legato-ish), preserving starts. */
export function scaleLength(notes: Note[], factor: number): Note[] {
  return notes.map((n) => ({ ...n, lengthTicks: Math.max(3, Math.round(n.lengthTicks * factor)) }));
}

/** Mirror pitches around an axis — melodic inversion. */
export function invertPitches(notes: Note[], axisPitch?: number): Note[] {
  if (!notes.length) return [];
  const axis = axisPitch ?? Math.round(notes.reduce((s, n) => s + n.pitch, 0) / notes.length);
  return notes.map((n) => ({ ...n, pitch: clamp(2 * axis - n.pitch, 0, 127) }));
}

/** Reverse the selection in time (retrograde) within its own span. */
export function retrograde(notes: Note[]): Note[] {
  if (!notes.length) return [];
  const start = Math.min(...notes.map((n) => n.startTick));
  const end = Math.max(...notes.map((n) => n.startTick + n.lengthTicks));
  return notes.map((n) => ({ ...n, startTick: start + (end - (n.startTick + n.lengthTicks)) }));
}

/** Double the selection an interval above/below (harmonize). Originals are kept. */
export function harmonize(notes: Note[], semitones: number, velocityScale = 0.8): Note[] {
  const harmony = notes.map((n) => ({ ...n, id: newId("n"), pitch: clamp(n.pitch + semitones, 0, 127), velocity: clampVel(n.velocity * velocityScale) }));
  return [...notes, ...harmony];
}

/** Chop overlapping same-pitch notes so nothing double-triggers (mono-legato cleanup). */
export function removeOverlaps(notes: Note[]): Note[] {
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const arr = byPitch.get(n.pitch) ?? [];
    arr.push(n);
    byPitch.set(n.pitch, arr);
  }
  const out: Note[] = [];
  for (const arr of byPitch.values()) {
    const sorted = [...arr].sort((a, b) => a.startTick - b.startTick);
    sorted.forEach((n, i) => {
      const next = sorted[i + 1];
      const maxLen = next ? Math.max(3, next.startTick - n.startTick) : n.lengthTicks;
      out.push({ ...n, lengthTicks: Math.min(n.lengthTicks, maxLen) });
    });
  }
  return out;
}

/** Default strum spread: a 32nd note. */
export const DEFAULT_STRUM_TICKS = Math.round(TICKS_PER_STEP / 2);

function groupByStart(notes: Note[]): Map<number, Note[]> {
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    const g = groups.get(n.startTick) ?? [];
    g.push(n);
    groups.set(n.startTick, g);
  }
  return groups;
}
