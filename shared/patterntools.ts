/**
 * Pure step-pattern generators for the Channel Rack. Separate from React so they can be
 * unit-tested and reused by AI edit commands.
 */
import type { Step } from "./project";
import { clamp } from "./time";

const mkStep = (index: number, velocity = 0.85, probability = 1, micro = 0): Step => ({ index, velocity, probability, micro });

/** Deterministic PRNG so generated patterns are reproducible from a seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

/** Dense burst over the final `fillSteps` of the pattern (classic end-of-bar fill). */
export function fillEnding(lengthSteps: number, fillSteps = 4, density = 0.8, seed = 1): Step[] {
  const r = rng(seed);
  const start = Math.max(0, lengthSteps - fillSteps);
  const out: Step[] = [];
  for (let i = start; i < lengthSteps; i++) {
    if (r() < density) out.push(mkStep(i, clamp(0.6 + r() * 0.4, 0.2, 1)));
  }
  return out;
}

/** Quiet off-grid hits between existing steps — adds groove without changing the pattern. */
export function ghostNotes(existing: Step[], lengthSteps: number, amount = 0.3, seed = 7): Step[] {
  const r = rng(seed);
  const taken = new Set(existing.map((s) => s.index));
  const out = [...existing];
  for (let i = 0; i < lengthSteps; i++) {
    if (taken.has(i)) continue;
    if (i % 4 === 0) continue; // keep downbeats clear
    if (r() < amount) out.push(mkStep(i, clamp(0.15 + r() * 0.2, 0.05, 0.45), 0.85, Math.round((r() - 0.5) * 6)));
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Rotate a pattern in time, wrapping around the pattern length (step-shift). */
export function shiftSteps(steps: Step[], by: number, lengthSteps: number): Step[] {
  if (lengthSteps <= 0) return [];
  return steps
    .map((s) => ({ ...s, index: (((s.index + by) % lengthSteps) + lengthSteps) % lengthSteps }))
    .sort((a, b) => a.index - b.index);
}

/** Every Nth step, offset — polyrhythm against the main grid (e.g. 3-against-4). */
export function polyrhythm(lengthSteps: number, everyN: number, offset = 0, velocity = 0.8): Step[] {
  const n = Math.max(1, Math.round(everyN));
  const out: Step[] = [];
  for (let i = offset % n; i < lengthSteps; i += n) if (i >= 0) out.push(mkStep(i, velocity));
  return out;
}

/** Accent a repeating subdivision (e.g. boost every 4th step) without adding steps. */
export function accentEvery(steps: Step[], everyN: number, boost = 0.2, offset = 0): Step[] {
  const n = Math.max(1, Math.round(everyN));
  return steps.map((s) =>
    (s.index - offset) % n === 0 ? { ...s, velocity: clamp(s.velocity + boost, 0.05, 1) } : s,
  );
}

/** Thin a busy pattern by removing a fraction of its non-downbeat steps. */
export function thin(steps: Step[], fraction = 0.4, seed = 11): Step[] {
  const r = rng(seed);
  return steps.filter((s) => s.index % 4 === 0 || r() > fraction);
}

/** Mirror the pattern in time within its own length (palindrome / reverse). */
export function reverseSteps(steps: Step[], lengthSteps: number): Step[] {
  return steps
    .map((s) => ({ ...s, index: clamp(lengthSteps - 1 - s.index, 0, lengthSteps - 1) }))
    .sort((a, b) => a.index - b.index);
}

/** Roll/ratchet: replace one step with `count` faster hits using micro-timing offsets. */
export function ratchet(steps: Step[], index: number, count = 3, ticksPerStep = 24): Step[] {
  const target = steps.find((s) => s.index === index);
  if (!target || count < 2) return steps;
  const rest = steps.filter((s) => s.index !== index);
  const sub = Math.floor(ticksPerStep / count);
  const hits: Step[] = [];
  for (let i = 0; i < count; i++) {
    hits.push({ ...target, micro: clamp(i * sub, -12, 12), velocity: clamp(target.velocity * (1 - i * 0.12), 0.05, 1) });
  }
  // only the first keeps the exact step slot; later hits ride micro-timing within it
  return [...rest, ...hits].sort((a, b) => a.index - b.index || a.micro - b.micro);
}
