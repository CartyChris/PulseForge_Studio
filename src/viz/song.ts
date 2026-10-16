/**
 * Song-aware visualizer data: what the music *is*, not only how loud it is. The project's own
 * event list says exactly when each kick, snare, hat, bass note and chord lands, so the visuals
 * can hit on the beat with zero detection latency, colour each instrument with its channel colour,
 * and pick a palette from the song's key. Pure (no audio), unit tested.
 */
import type { Channel, Project } from "../../shared/project";
import { buildEventList } from "../engine/events";
import { getKit } from "../engine/kits";
import { layerOf } from "../state/blueprint";
import { INSTRUMENT_PRESETS } from "../engine/instruments";
import { TICKS_PER_STEP } from "../../shared/time";

export type VizRole = "kick" | "snare" | "hat" | "cymbal" | "perc" | "bass" | "chords" | "lead" | "pad" | "audio";
export const VIZ_ROLES: VizRole[] = ["kick", "snare", "hat", "cymbal", "perc", "bass", "chords", "lead", "pad", "audio"];

export interface VizChannel { id: string; name: string; color: string; role: VizRole }
export interface VizHit { tick: number; channelId: string; role: VizRole; velocity: number; pitch: number; durTicks: number }
export interface VizIndex {
  hits: VizHit[];
  endTick: number;
  channels: VizChannel[];
  /** step grid of the loop being heard (rows = channels, ≤ 16 × 64 steps): velocity 0..1 */
  grid: { rows: VizChannel[]; steps: number; cells: Float32Array };
}

const DRUM_ROLE_MAP: Record<string, VizRole> = {
  kick: "kick", "kick-808": "kick",
  snare: "snare", clap: "snare", rimshot: "snare", snap: "snare",
  "hat-closed": "hat", "hat-open": "hat", shaker: "hat", tambourine: "hat", ride: "hat",
  crash: "cymbal", "reverse-cymbal": "cymbal", riser: "cymbal", impact: "cymbal",
};

export function roleForChannel(ch: Channel): VizRole {
  const inst = ch.instrument;
  if (inst.type === "drum-sound") {
    const role = getKit(inst.kitId).sounds.find((s) => s.id === inst.soundId)?.role ?? "perc";
    return DRUM_ROLE_MAP[role] ?? "perc";
  }
  if (inst.type === "drum-kit") return "perc";
  const name = ch.name.toLowerCase();
  if (inst.type === "sampler") {
    if (/\bkick\b/.test(name)) return "kick";
    if (/\b(snare|clap|rim)\b/.test(name)) return "snare";
    if (/\bhats?\b/.test(name)) return "hat";
  }
  const layer = layerOf(ch);
  if (layer === "drums") return "perc";
  if (layer === "bass") return "bass";
  if (layer === "lead") return "lead";
  if (inst.type === "synth") {
    const cat = INSTRUMENT_PRESETS.find((p) => p.id === inst.presetId)?.category ?? "";
    if (["Synth Pads", "Strings", "Ensemble", "Organ"].includes(cat) || /\bpad\b/.test(name)) return "pad";
  }
  return "chords";
}

/** Event index for what's playing: one pattern (pattern mode) or the whole arrangement (song mode). */
export function buildVizIndex(project: Project, mode: "pattern" | "song", patternId: string | null): VizIndex {
  const pid = mode === "pattern" ? (patternId ?? project.patterns[0]?.id) : undefined;
  const ev = buildEventList(project, pid ? { patternId: pid } : undefined);
  const byId = new Map(project.channels.map((c) => [c.id, c]));
  const channels: VizChannel[] = project.channels.map((c) => ({ id: c.id, name: c.name, color: c.color || "#8b6cff", role: roleForChannel(c) }));
  const roleOf = new Map(channels.map((c) => [c.id, c.role]));
  const hits: VizHit[] = [];
  for (const d of ev.drums) if (byId.has(d.channelId)) hits.push({ tick: d.tick, channelId: d.channelId, role: roleOf.get(d.channelId)!, velocity: d.velocity, pitch: 0, durTicks: TICKS_PER_STEP });
  for (const n of ev.notes) if (byId.has(n.channelId)) hits.push({ tick: n.tick, channelId: n.channelId, role: roleOf.get(n.channelId)!, velocity: n.velocity, pitch: n.pitch, durTicks: n.durTicks });
  for (const a of ev.audio) hits.push({ tick: a.tick, channelId: `audio:${a.clipId}`, role: "audio", velocity: 0.8, pitch: 0, durTicks: TICKS_PER_STEP * 4 });
  hits.sort((a, b) => a.tick - b.tick);

  // the step grid: the loop in pattern mode, the first 4 bars of the song otherwise
  const used = channels.filter((c) => hits.some((h) => h.channelId === c.id)).slice(0, 16);
  const steps = Math.max(16, Math.min(64, pid ? Math.round(ev.endTick / TICKS_PER_STEP) : 64));
  const cells = new Float32Array(16 * 64);
  used.forEach((c, r) => {
    for (const h of hits) {
      if (h.channelId !== c.id) continue;
      const s = Math.floor(h.tick / TICKS_PER_STEP);
      if (s >= steps) { if (pid) continue; else break; }
      cells[r * 64 + s] = Math.max(cells[r * 64 + s]!, h.velocity);
    }
  });
  return { hits, endTick: ev.endTick, channels, grid: { rows: used, steps, cells } };
}

/** first index with hit.tick >= tick (binary search) */
function lowerBound(hits: VizHit[], tick: number): number {
  let lo = 0, hi = hits.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hits[mid]!.tick < tick) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Hits whose start falls in (from, to]. When the transport wrapped (to < from: a pattern loop or
 * the loop region restarting), returns (from, ∞) ∪ [wrapStart, to].
 */
export function hitsBetween(idx: VizIndex, from: number, to: number, wrapStart = 0): VizHit[] {
  const h = idx.hits;
  if (to >= from) {
    if (to - from > 4 * 96 * 4) return []; // a seek, not playback: don't fire a bar's worth at once
    const out: VizHit[] = [];
    for (let i = lowerBound(h, from); i < h.length && h[i]!.tick <= to; i++) if (h[i]!.tick > from || from === 0 && h[i]!.tick === 0) out.push(h[i]!);
    return out;
  }
  const out: VizHit[] = [];
  for (let i = lowerBound(h, from); i < h.length; i++) if (h[i]!.tick > from) out.push(h[i]!);
  for (let i = lowerBound(h, wrapStart); i < h.length && h[i]!.tick <= to; i++) out.push(h[i]!);
  return out;
}

export type Rgb = [number, number, number];
export interface VizPalette { a: Rgb; b: Rgb; c: Rgb; minor: boolean; hue: number }

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})/i.exec(hex.trim());
  if (!m) return [0.55, 0.42, 1];
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const PCS: Record<string, number> = { C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11 };

/**
 * Palette from the song's key, walking the circle of fifths so related keys get related colours
 * (C warm amber → G gold → D lime … F# teal-blue …). Minor keys shift cooler and deeper.
 */
export function paletteForKey(key: string, scale: string): VizPalette {
  const m = /^\s*([A-Ga-g])([#b]?)/.exec(key || "C");
  const pc = m ? PCS[(m[1]! + (m[2] ?? "")).toUpperCase()] ?? 0 : 0;
  const minor = /minor|aeolian|dorian|phrygian|locrian|blues/i.test(scale) || /m(?!aj)/.test(key.slice(1));
  const fifths = (pc * 7) % 12;
  const hue = (fifths * 30 + (minor ? 215 : 18)) % 360;
  const s = minor ? 0.82 : 0.9;
  return {
    a: hslToRgb(hue, s, minor ? 0.56 : 0.6),
    b: hslToRgb(hue + (minor ? 48 : 38), s, minor ? 0.5 : 0.56),
    c: hslToRgb(hue - (minor ? 70 : 55), s * 0.9, minor ? 0.42 : 0.5),
    minor,
    hue,
  };
}
