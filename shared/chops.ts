/**
 * MPC-style chopping logic (pure, no audio): turn slice markers into chops, place them on the
 * step grid so the pattern recreates the original sample, and generate "flips" — re-arrangements
 * that keep the groove anchored (chop 1 on every downbeat) while reordering the rest.
 */
import { seededRng } from "./producer";

export interface Chop { startSec: number; endSec: number }
export interface ChopHit { chop: number; step: number; velocity: number }
export type FlipStyle = "flip" | "reverse" | "stutter" | "halftime";

export const MAX_PADS = 16;

/** Markers (seconds, any order) → contiguous chops, dropping slivers shorter than `minLenSec`. */
export function chopsFromMarkers(markers: number[], durationSec: number, minLenSec = 0.03): Chop[] {
  const pts = [...new Set([0, ...markers.filter((m) => m > 0 && m < durationSec), durationSec])].sort((a, b) => a - b);
  const out: Chop[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i + 1]! - pts[i]! < minLenSec) {
      if (out.length) out[out.length - 1]!.endSec = pts[i + 1]!; // fold the sliver into the previous chop
      continue;
    }
    out.push({ startSec: pts[i]!, endSec: pts[i + 1]! });
  }
  return out;
}

/**
 * Auto-chop into `count` pieces: equal divisions, each snapped to the nearest transient within
 * `snapSec` so cuts land on hits instead of mid-note. Returns the inner markers (count − 1).
 */
export function autoChopPoints(transientsSec: number[], durationSec: number, count: number, snapSec = 0.08): number[] {
  const n = Math.max(1, Math.min(MAX_PADS, Math.round(count)));
  const out: number[] = [];
  for (let i = 1; i < n; i++) {
    const ideal = (durationSec * i) / n;
    let best = ideal, dist = snapSec;
    for (const t of transientsSec) {
      const d = Math.abs(t - ideal);
      if (d < dist) { dist = d; best = t; }
    }
    if (!out.includes(best)) out.push(best);
  }
  return out.sort((a, b) => a - b);
}

const stepSecAt = (bpm: number) => 60 / bpm / 4;

/** Pattern length for a sample: whole bars (16 steps), 16…256. */
export function lengthFor(durationSec: number, bpm: number): number {
  const steps = Math.ceil(durationSec / stepSecAt(bpm) - 0.25);
  return Math.min(256, Math.max(16, Math.ceil(steps / 16) * 16));
}

/** Place each chop where it starts in the original, so playing the pattern recreates the sample. */
export function chopPattern(chops: Chop[], bpm: number): { lengthSteps: number; hits: ChopHit[] } {
  const stepSec = stepSecAt(bpm);
  const total = chops.length ? chops[chops.length - 1]!.endSec : 0;
  const lengthSteps = lengthFor(total, bpm);
  const used = new Set<number>();
  const hits: ChopHit[] = [];
  chops.forEach((c, i) => {
    const step = Math.round(c.startSec / stepSec);
    if (step >= lengthSteps || used.has(step)) return;
    used.add(step);
    hits.push({ chop: i, step, velocity: 0.9 });
  });
  return { lengthSteps, hits };
}

/**
 * Re-arrange chops into a new pattern ("flip"). Deterministic per seed.
 *  flip     — chop 1 on every bar's downbeat, other quarter notes get random chops, a few 8th pickups
 *  reverse  — the original placement, chops in reverse order
 *  stutter  — the original, plus 16th-note repeats of random chops
 *  halftime — the original placement stretched to twice the length (pattern doubles)
 */
export function flipChops(original: { lengthSteps: number; hits: ChopHit[] }, chopCount: number, style: FlipStyle, seed = 1): { lengthSteps: number; hits: ChopHit[] } {
  const rng = seededRng(seed);
  const n = Math.max(1, chopCount);
  const pick = () => Math.floor(rng() * n);
  const L = original.lengthSteps;
  if (style === "reverse") {
    return { lengthSteps: L, hits: original.hits.map((h) => ({ ...h, chop: n - 1 - h.chop })) };
  }
  if (style === "halftime") {
    const L2 = Math.min(256, L * 2);
    return { lengthSteps: L2, hits: original.hits.filter((h) => h.step * 2 < L2).map((h) => ({ ...h, step: h.step * 2 })) };
  }
  if (style === "stutter") {
    const hits = original.hits.map((h) => ({ ...h }));
    const taken = new Set(hits.map((h) => h.step));
    for (let s = 0; s < L; s += 4) {
      if (rng() < 0.35) {
        const c = pick();
        for (let k = 1; k < 4 && s + k < L; k++) if (!taken.has(s + k)) { hits.push({ chop: c, step: s + k, velocity: 0.75 - k * 0.1 }); taken.add(s + k); }
      }
    }
    return { lengthSteps: L, hits: hits.sort((a, b) => a.step - b.step) };
  }
  // flip
  const hits: ChopHit[] = [];
  for (let s = 0; s < L; s += 4) {
    if (s % 16 === 0) hits.push({ chop: 0, step: s, velocity: 1 });
    else if (rng() < 0.85) hits.push({ chop: pick(), step: s, velocity: 0.85 });
    if (rng() < 0.3 && s + 2 < L) hits.push({ chop: pick(), step: s + 2, velocity: 0.7 }); // 8th-note pickup
  }
  return { lengthSteps: L, hits };
}
