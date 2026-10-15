/**
 * PulseForge 2.0 sound library — contract + quality checks for the expanded drum roles,
 * genre kits, factory one-shots and the new DSP generators. Every assertion here is meant
 * to FAIL if a generator is silent, unbounded, non-deterministic or wired to the wrong recipe.
 */
import { describe, it, expect } from "vitest";
import { DRUM_ROLES } from "../../shared/composition";
import { DRUM_KITS, FACTORY_SAMPLES } from "./kits";
import {
  FACTORY_RATE, biquad,
  synthKick909, synthHat909, synthHat808, synthCowbell808, synthSnare909, synthClave, synthSubDrop,
  synthTriangle, synthNoiseBuild, synthReverseCymbal, synthLaser, synthTapeStop, synthScratch,
  synthConga, synthBongo, synthVoxHey, synthAirHorn, synthClap808, shapeOneShot,
} from "./dsp";
import { isNonSilent } from "./analysis";

const NEW_ROLES = [
  "snap", "conga-high", "conga-low", "bongo", "clave", "woodblock",
  "triangle", "agogo", "timbale", "vox-hey", "reverse-cymbal", "riser",
] as const;

const NEW_KITS: Array<[string, string]> = [
  ["classic-808", "Classic 808"], ["classic-909", "Classic 909"], ["boom-bap", "Boom Bap"], ["house", "House"],
  ["techno", "Techno"], ["afrobeats", "Afrobeats"], ["reggaeton", "Reggaeton"], ["phonk", "Phonk"],
  ["jersey-club", "Jersey Club"], ["dnb", "Drum & Bass"], ["dancehall", "Dancehall"], ["pop", "Pop"],
  ["rnb", "R&B"], ["eighties", "80s Retro"], ["dubstep", "Dubstep"],
];
const ORIGINAL_KITS = ["modern-hiphop", "trap-808", "electronic", "acoustic-essentials", "lofi-dust", "world-perc", "drill-uk"];
const ORIGINAL_SAMPLE_COUNT = 18;

/** Shared render-quality gate: non-empty, < 10 s, every sample finite, peak ≤ 1, audibly non-silent. */
function expectGoodOneShot(data: Float32Array, label: string): void {
  expect(data.length, `${label} length`).toBeGreaterThan(0);
  expect(data.length, `${label} < 10 s`).toBeLessThan(FACTORY_RATE * 10);
  let peak = 0;
  let finite = true;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v)) { finite = false; break; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  expect(finite, `${label} finite`).toBe(true);
  expect(peak, `${label} peak`).toBeLessThanOrEqual(1.0);
  expect(isNonSilent(data), `${label} non-silent`).toBe(true);
}

const energy = (x: Float32Array): number => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i]! * x[i]!; return e; };
/** Fraction of total energy that survives a filter chain (each stage applied twice for a 24 dB/oct slope). */
function share(x: Float32Array, stages: Array<["lowpass" | "highpass", number]>): number {
  const y = x.slice();
  for (const [type, hz] of stages) { biquad(y, FACTORY_RATE, type, hz); biquad(y, FACTORY_RATE, type, hz); }
  return energy(y) / energy(x);
}
const lowShare = (x: Float32Array, hz: number): number => share(x, [["lowpass", hz]]);
const highShare = (x: Float32Array, hz: number): number => share(x, [["highpass", hz]]);
const bandShare = (x: Float32Array, lo: number, hi: number): number => share(x, [["highpass", lo], ["lowpass", hi]]);
function rms(x: Float32Array, from: number, to: number): number {
  const a = Math.floor(from * x.length), b = Math.floor(to * x.length);
  let s = 0; for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
}
/** Zero-crossing rate (crossings per second) over a fractional window — a cheap pitch/brightness proxy. */
function zcr(x: Float32Array, from: number, to: number): number {
  const a = Math.floor(from * x.length), b = Math.floor(to * x.length);
  let z = 0; for (let i = a + 1; i < b; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) z++;
  return z / ((b - a) / FACTORY_RATE);
}

describe("2.0 drum-role + kit contract", () => {
  it("DRUM_ROLES has 30 roles with the 12 new ones appended in order", () => {
    expect(DRUM_ROLES.length).toBe(30);
    expect(DRUM_ROLES.slice(18)).toEqual([...NEW_ROLES]);
    expect(DRUM_ROLES[0]).toBe("kick");
    expect(DRUM_ROLES[17]).toBe("impact");
    expect(new Set(DRUM_ROLES).size).toBe(30);
  });

  it("22 kits, unique ids, the 7 originals kept and all 15 new ids/names present", () => {
    expect(DRUM_KITS.length).toBe(22);
    const ids = DRUM_KITS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ORIGINAL_KITS) expect(ids).toContain(id);
    for (const [id, name] of NEW_KITS) {
      const kit = DRUM_KITS.find((k) => k.id === id);
      expect(kit, id).toBeDefined();
      expect(kit!.name).toBe(name);
      expect(kit!.description.length).toBeGreaterThan(20);
    }
  });

  it("every kit maps exactly one sound per role, in DRUM_ROLES order, with kit-scoped ids", () => {
    for (const kit of DRUM_KITS) {
      expect(kit.sounds.map((s) => s.role)).toEqual([...DRUM_ROLES]);
      for (const s of kit.sounds) expect(s.id).toBe(`${kit.id}/${s.role}`);
    }
  });
});

describe("every kit × every role renders cleanly", () => {
  for (const kit of DRUM_KITS) {
    it(`${kit.id}: ${kit.sounds.length} sounds — length, < 10 s, finite, peak ≤ 1, non-silent`, () => {
      for (const s of kit.sounds) expectGoodOneShot(s.render(), s.id);
    }, 120000);
  }
});

describe("factory library", () => {
  it("ids unique, ≥ 30 new entries, new categories populated, every entry tagged", () => {
    const ids = FACTORY_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FACTORY_SAMPLES.length - ORIGINAL_SAMPLE_COUNT).toBeGreaterThanOrEqual(30);
    const cats = new Set(FACTORY_SAMPLES.map((s) => s.category));
    for (const c of ["Snaps & Claps", "Latin & World", "FX & Transitions", "Stabs & Hits", "Vinyl & Texture"]) expect(cats.has(c), c).toBe(true);
    for (const id of ["fx/air-horn", "fx/siren-wail", "fx/scratch-baby", "fx/tape-stop", "fx/laser", "fx/reverse-cymbal", "fx/sub-drop", "fx/white-noise-build", "stab/orchestra-hit", "stab/minor7-chord", "vinyl/crackle", "snap/finger-1"]) {
      expect(ids, id).toContain(id);
    }
    for (const s of FACTORY_SAMPLES) expect(s.tags.length, s.id).toBeGreaterThan(0);
  });

  it("every factory sample renders: length, < 10 s, finite, peak ≤ 1, non-silent", () => {
    for (const s of FACTORY_SAMPLES) expectGoodOneShot(s.render(), s.id);
  }, 120000);
});

describe("determinism", () => {
  it("rendering the same kit sound / factory sample twice yields identical arrays", () => {
    const picks = [
      DRUM_KITS.find((k) => k.id === "phonk")!.sounds.find((s) => s.role === "cowbell")!,
      DRUM_KITS.find((k) => k.id === "dubstep")!.sounds.find((s) => s.role === "snare")!,
      DRUM_KITS.find((k) => k.id === "boom-bap")!.sounds.find((s) => s.role === "kick")!,
      DRUM_KITS.find((k) => k.id === "house")!.sounds.find((s) => s.role === "riser")!,
      ...FACTORY_SAMPLES.filter((s) => ["vinyl/crackle", "fx/scratch-baby", "vox/hey-crowd", "latin/guiro", "stab/orchestra-hit"].includes(s.id)),
    ];
    expect(picks.length).toBe(9);
    for (const s of picks) {
      const a = s.render(), b = s.render();
      expect(a.length, s.id).toBe(b.length);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
});

describe("spectral sanity — fails if a generator is wired to the wrong recipe", () => {
  it("909 kick lives below 200 Hz; 909 closed hat lives above 6 kHz", () => {
    const kick = synthKick909(), hat = synthHat909();
    expect(lowShare(kick, 200)).toBeGreaterThan(0.6);
    expect(lowShare(hat, 200)).toBeLessThan(0.01);
    expect(lowShare(kick, 200)).toBeGreaterThan(lowShare(hat, 200) * 50);
    expect(highShare(hat, 6000)).toBeGreaterThan(0.6);
    expect(highShare(kick, 6000)).toBeLessThan(0.01);
  });

  it("808 cowbell energy concentrates in the 540/800 Hz → 2.6 kHz band, not lows or air", () => {
    const bell = synthCowbell808();
    expect(bandShare(bell, 400, 4000)).toBeGreaterThan(0.6);
    expect(lowShare(bell, 200)).toBeLessThan(0.02);
    expect(highShare(bell, 6000)).toBeLessThan(0.05);
    // a hat or kick wired in by mistake fails the same band test
    expect(bandShare(synthHat909(), 400, 4000)).toBeLessThan(0.1);
    expect(bandShare(synthKick909(), 400, 4000)).toBeLessThan(0.1);
  });

  it("clave is a ~2.5 kHz ping; sub drop is almost pure sub", () => {
    const clave = synthClave();
    const z = zcr(clave, 0, 0.5) / 2; // two crossings per cycle
    expect(z).toBeGreaterThan(2000);
    expect(z).toBeLessThan(3000);
    expect(lowShare(synthSubDrop(), 200)).toBeGreaterThan(0.8);
  });

  it("open hats ring longer than closed hats; the triangle rings ≥ 1.5 s and is bright", () => {
    expect(synthHat909({ open: true }).length).toBeGreaterThan(synthHat909().length * 3);
    expect(synthHat808({ open: true }).length).toBeGreaterThan(synthHat808().length * 3);
    const tri = synthTriangle();
    expect(tri.length / FACTORY_RATE).toBeGreaterThan(1.5);
    expect(highShare(tri, 1000)).toBeGreaterThan(0.8);
    expect(rms(tri, 0.4, 0.5)).toBeGreaterThan(rms(tri, 0, 0.1) * 0.01); // still ringing mid-way
  });

  it("low conga sits below high conga, bongo above both", () => {
    const hi = zcr(synthConga({ high: true }), 0, 0.5);
    const lo = zcr(synthConga({ high: false }), 0, 0.5);
    const bongo = zcr(synthBongo({ high: true }), 0, 0.5);
    expect(lo).toBeLessThan(hi);
    expect(bongo).toBeGreaterThan(hi);
  });

  it("builds and reverse cymbals swell; lasers and tape stops fall in pitch", () => {
    for (const x of [synthNoiseBuild({ seconds: 3 }), synthReverseCymbal({ seconds: 2 })]) {
      expect(rms(x, 0.75, 0.98)).toBeGreaterThan(rms(x, 0, 0.25) * 5);
    }
    const laser = synthLaser();
    expect(zcr(laser, 0, 0.2)).toBeGreaterThan(zcr(laser, 0.8, 1) * 4);
    const tape = synthTapeStop();
    expect(zcr(tape, 0, 0.1)).toBeGreaterThan(zcr(tape, 0.85, 0.98) * 3);
  });

  it("chirp scratch is silent on return strokes, baby scratch is not", () => {
    // last move (0.14 s) is a return stroke in both styles
    const baby = synthScratch({ style: "baby" }), chirp = synthScratch({ style: "chirp" });
    expect(rms(chirp, 0.82, 0.95)).toBeLessThan(rms(baby, 0.82, 0.95) * 0.1);
  });

  it("vox hey is voiced in the formant band; air horn is mid-heavy; 808 clap sits around 1 kHz", () => {
    expect(bandShare(synthVoxHey(), 200, 4000)).toBeGreaterThan(0.6);
    expect(highShare(synthVoxHey(), 6000)).toBeLessThan(0.05);
    expect(bandShare(synthAirHorn(), 200, 5000)).toBeGreaterThan(0.7);
    expect(bandShare(synthClap808(), 400, 4000)).toBeGreaterThan(0.5);
  });

  it("909 snare has both tonal body and bright noise", () => {
    const sn = synthSnare909();
    expect(bandShare(sn, 120, 500)).toBeGreaterThan(0.05);
    expect(highShare(sn, 4000)).toBeGreaterThan(0.15);
  });

  it("shapeOneShot gate truncates, reverb extends, bit-crush stays bounded", () => {
    const dry = synthSnare909();
    const gated = shapeOneShot(dry, { reverb: { decay: 1.5, mix: 0.5 }, gate: 0.25 });
    expect(gated.length).toBeLessThanOrEqual(Math.round(0.27 * FACTORY_RATE));
    const wet = shapeOneShot(dry, { reverb: { decay: 1.2, mix: 0.4 } });
    expect(wet.length).toBeGreaterThan(dry.length + FACTORY_RATE);
    expectGoodOneShot(shapeOneShot(dry, { bits: 6, downsample: 3, drive: 5 }), "crushed");
  });
});
