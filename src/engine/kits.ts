/**
 * Drum kits + factory starter library. Every sound maps to a pure-DSP generator
 * in dsp.ts. render() returns mono Float32Array at FACTORY_RATE.
 */
import type { DrumRole } from "../../shared/composition";
import {
  synthKick, synth808, synthSnare, synthClap, synthHat, synthCymbal, synthTom,
  synthRimshot, synthShaker, synthTambourine, synthCowbell, synthClick, synthImpact,
  synthRiser, synthDownlifter, synthNoiseSweep, synthBassHit, synthVocalChop,
  synthTexture, synthFoley,
} from "./dsp";

export interface KitSound {
  id: string;
  name: string;
  role: DrumRole;
  render: () => Float32Array;
}
export interface DrumKit {
  id: string;
  name: string;
  description: string;
  sounds: KitSound[];
}

function kitSounds(kitId: string, overrides: Partial<Record<DrumRole, () => Float32Array>>, tunes: Partial<Record<DrumRole, number>> = {}): KitSound[] {
  const base: Record<DrumRole, { name: string; render: () => Float32Array }> = {
    kick: { name: "Kick", render: () => synthKick({ tune: tunes.kick ?? 0 }) },
    "kick-808": { name: "808 Kick", render: () => synth808({ tune: tunes["kick-808"] ?? 0 }) },
    snare: { name: "Snare", render: () => synthSnare({ tune: tunes.snare ?? 0 }) },
    clap: { name: "Clap", render: () => synthClap({}) },
    rimshot: { name: "Rimshot", render: () => synthRimshot({}) },
    "hat-closed": { name: "Closed Hat", render: () => synthHat({}) },
    "hat-open": { name: "Open Hat", render: () => synthHat({ open: true }) },
    ride: { name: "Ride", render: () => synthCymbal({ ride: true }) },
    crash: { name: "Crash", render: () => synthCymbal({}) },
    "tom-low": { name: "Low Tom", render: () => synthTom({ tune: -5 }) },
    "tom-mid": { name: "Mid Tom", render: () => synthTom({ tune: 0 }) },
    "tom-high": { name: "High Tom", render: () => synthTom({ tune: 5 }) },
    shaker: { name: "Shaker", render: () => synthShaker({}) },
    tambourine: { name: "Tambourine", render: () => synthTambourine({}) },
    cowbell: { name: "Cowbell", render: () => synthCowbell({}) },
    perc: { name: "Perc", render: () => synthTom({ tune: 12, decay: 0.15 }) },
    click: { name: "Click", render: () => synthClick({}) },
    impact: { name: "Impact", render: () => synthImpact({}) },
  };
  return (Object.keys(base) as DrumRole[]).map((role) => ({
    id: `${kitId}/${role}`,
    name: base[role].name,
    role,
    render: overrides[role] ?? base[role].render,
  }));
}

export const DRUM_KITS: DrumKit[] = [
  {
    id: "modern-hiphop",
    name: "Modern Hip-Hop",
    description: "Punchy acoustic-leaning kit with tight hats and a warm kick.",
    sounds: kitSounds("modern-hiphop", {
      kick: () => synthKick({ tune: -2, decay: 0.4, tone: 0.6, drive: 0.5 }),
      snare: () => synthSnare({ tune: 0, decay: 0.25, tone: 0.6, drive: 0.4 }),
      "hat-closed": () => synthHat({ decay: 0.05, tone: 0.5 }),
      clap: () => synthClap({ decay: 0.35, tone: 0.5 }),
    }),
  },
  {
    id: "trap-808",
    name: "Trap & 808",
    description: "Long 808s, bright snappy snares, crisp rolled hats.",
    sounds: kitSounds("trap-808", {
      kick: () => synthKick({ tune: 2, decay: 0.25, tone: 0.8, drive: 0.7 }),
      "kick-808": () => synth808({ tune: 0, decay: 1.6, drive: 0.7 }),
      snare: () => synthSnare({ tune: 5, decay: 0.18, tone: 0.9, drive: 0.5 }),
      "hat-closed": () => synthHat({ decay: 0.04, tone: 0.8 }),
      "hat-open": () => synthHat({ open: true, decay: 0.4, tone: 0.8 }),
      clap: () => synthClap({ decay: 0.28, tone: 0.7 }),
    }, { "tom-low": -8, "tom-mid": -3, "tom-high": 2 }),
  },
  {
    id: "electronic",
    name: "Electronic",
    description: "Clean club kick, synthetic snare, metallic percussion.",
    sounds: kitSounds("electronic", {
      kick: () => synthKick({ tune: 0, decay: 0.3, tone: 0.9, drive: 0.9 }),
      snare: () => synthSnare({ tune: 8, decay: 0.15, tone: 1, drive: 0.6, seed: 13 }),
      clap: () => synthClap({ decay: 0.4, tone: 0.9, seed: 19 }),
      "hat-closed": () => synthHat({ decay: 0.045, tone: 1 }),
      perc: () => synthCowbell({ tune: 7, decay: 0.12 }),
    }),
  },
  {
    id: "acoustic-essentials",
    name: "Acoustic Essentials",
    description: "Soft-attack kick, brushy snare, natural toms and cymbals.",
    sounds: kitSounds("acoustic-essentials", {
      kick: () => synthKick({ tune: -4, decay: 0.5, tone: 0.3, drive: 0.2 }),
      snare: () => synthSnare({ tune: -3, decay: 0.3, tone: 0.35, drive: 0.15, seed: 31 }),
      "hat-closed": () => synthHat({ decay: 0.08, tone: 0.3 }),
      "hat-open": () => synthHat({ open: true, decay: 0.7, tone: 0.3 }),
      ride: () => synthCymbal({ ride: true, decay: 1.8 }),
      crash: () => synthCymbal({ decay: 3 }),
    }),
  },
  {
    id: "lofi-dust",
    name: "Lo-Fi Dust",
    description: "Dusty tuned-down kit — soft knock kick, muffled snare, hazy hats.",
    sounds: kitSounds("lofi-dust", {
      kick: () => synthKick({ tune: -5, decay: 0.35, tone: 0.2, drive: 0.65, seed: 41 }),
      "kick-808": () => synth808({ tune: -3, decay: 1.2, drive: 0.5 }),
      snare: () => synthSnare({ tune: -6, decay: 0.22, tone: 0.2, drive: 0.55, seed: 43 }),
      clap: () => synthClap({ decay: 0.3, tone: 0.25, seed: 47 }),
      "hat-closed": () => synthHat({ decay: 0.06, tone: 0.2 }),
      "hat-open": () => synthHat({ open: true, decay: 0.35, tone: 0.2 }),
      rimshot: () => synthRimshot({ tune: -4, tone: 0.3 }),
      perc: () => synthTom({ tune: 7, decay: 0.12, tone: 0.3 }),
    }, { "tom-low": -10, "tom-mid": -6, "tom-high": -2 }),
  },
  {
    id: "world-perc",
    name: "World Percussion",
    description: "Hand-drum style toms, woody rims, shakers and bells for organic grooves.",
    sounds: kitSounds("world-perc", {
      kick: () => synthTom({ tune: -12, decay: 0.45, tone: 0.4, drive: 0.3 }), // djembe-style bass tone
      snare: () => synthTom({ tune: 2, decay: 0.2, tone: 0.7, drive: 0.25, seed: 53 }), // conga slap approx
      clap: () => synthClap({ decay: 0.22, tone: 0.4, seed: 59 }),
      rimshot: () => synthRimshot({ tune: 5, tone: 0.8 }),
      "hat-closed": () => synthShaker({ decay: 0.07 }),
      "hat-open": () => synthShaker({ decay: 0.25 }),
      perc: () => synthCowbell({ tune: -2, decay: 0.2 }),
      cowbell: () => synthCowbell({ tune: 4, decay: 0.3 }),
      tambourine: () => synthTambourine({ decay: 0.35 }),
    }, { "tom-low": -7, "tom-mid": 0, "tom-high": 7 }),
  },
  {
    id: "drill-uk",
    name: "Drill",
    description: "Sliding 808s, sharp snares and skippy hats for drill patterns.",
    sounds: kitSounds("drill-uk", {
      kick: () => synthKick({ tune: 3, decay: 0.22, tone: 0.85, drive: 0.6 }),
      "kick-808": () => synth808({ tune: 2, decay: 2.2, drive: 0.8 }),
      snare: () => synthSnare({ tune: 10, decay: 0.16, tone: 0.95, drive: 0.55, seed: 61 }),
      rimshot: () => synthRimshot({ tune: 8, tone: 0.9 }),
      "hat-closed": () => synthHat({ decay: 0.035, tone: 0.9 }),
      "hat-open": () => synthHat({ open: true, decay: 0.3, tone: 0.9 }),
      clap: () => synthClap({ decay: 0.25, tone: 0.8, seed: 67 }),
    }, { "tom-low": -6, "tom-mid": -1, "tom-high": 4 }),
  },
];

export function getKit(kitId: string): DrumKit {
  return DRUM_KITS.find((k) => k.id === kitId) ?? DRUM_KITS[0]!;
}
export function getKitSound(kitId: string, soundIdOrRole: string): KitSound {
  const kit = getKit(kitId);
  return kit.sounds.find((s) => s.id === soundIdOrRole || s.role === soundIdOrRole) ?? kit.sounds[0]!;
}

/** Factory starter library — one-shots and FX beyond the kits. All synthesized. */
export interface FactorySample {
  id: string;
  name: string;
  category: string;
  tags: string[];
  render: () => Float32Array;
}

export const FACTORY_SAMPLES: FactorySample[] = [
  { id: "fx/riser-2s", name: "Riser 2s", category: "Risers", tags: ["riser", "fx", "transition"], render: () => synthRiser({ seconds: 2 }) },
  { id: "fx/riser-4s", name: "Riser 4s", category: "Risers", tags: ["riser", "fx", "transition"], render: () => synthRiser({ seconds: 4, seed: 53 }) },
  { id: "fx/downlifter", name: "Downlifter", category: "Downlifters", tags: ["downlifter", "fx", "transition"], render: () => synthDownlifter({}) },
  { id: "fx/downlifter-long", name: "Downlifter Long", category: "Downlifters", tags: ["downlifter", "fx"], render: () => synthDownlifter({ seconds: 2.5, seed: 63 }) },
  { id: "fx/impact-boom", name: "Impact Boom", category: "Impacts", tags: ["impact", "fx"], render: () => synthImpact({ decay: 1.8 }) },
  { id: "fx/impact-short", name: "Impact Short", category: "Impacts", tags: ["impact", "fx"], render: () => synthImpact({ decay: 0.7, seed: 43 }) },
  { id: "fx/sweep-up", name: "Noise Sweep Up", category: "Sweeps", tags: ["sweep", "noise", "transition"], render: () => synthNoiseSweep({ up: true }) },
  { id: "fx/sweep-down", name: "Noise Sweep Down", category: "Sweeps", tags: ["sweep", "noise", "transition"], render: () => synthNoiseSweep({ up: false, seed: 73 }) },
  { id: "bass/hit-a", name: "Bass Hit A", category: "Bass Hits", tags: ["bass", "hit"], render: () => synthBassHit({}) },
  { id: "bass/hit-low", name: "Bass Hit Low", category: "Bass Hits", tags: ["bass", "hit"], render: () => synthBassHit({ tune: -7, decay: 0.8 }) },
  { id: "vox/chop-ah", name: "Vox Chop Ah", category: "Vocal Chops", tags: ["vocal", "chop", "synthetic"], render: () => synthVocalChop({ vowel: "a" }) },
  { id: "vox/chop-eh", name: "Vox Chop Eh", category: "Vocal Chops", tags: ["vocal", "chop", "synthetic"], render: () => synthVocalChop({ vowel: "e", tune: 3 }) },
  { id: "vox/chop-oh", name: "Vox Chop Oh", category: "Vocal Chops", tags: ["vocal", "chop", "synthetic"], render: () => synthVocalChop({ vowel: "o", tune: -2, decay: 0.6 }) },
  { id: "vox/chop-oo", name: "Vox Chop Oo", category: "Vocal Chops", tags: ["vocal", "chop", "synthetic"], render: () => synthVocalChop({ vowel: "u", tune: 7, decay: 0.3 }) },
  { id: "tex/warm-drone", name: "Warm Drone", category: "Textures", tags: ["texture", "pad", "ambient"], render: () => synthTexture({ seconds: 4 }) },
  { id: "tex/dark-drone", name: "Dark Drone", category: "Textures", tags: ["texture", "dark", "ambient"], render: () => synthTexture({ seconds: 4, dark: true, seed: 111 }) },
  { id: "foley/wood-taps", name: "Wood Taps", category: "Foley", tags: ["foley", "percussion"], render: () => synthFoley({}) },
  { id: "foley/taps-b", name: "Taps B", category: "Foley", tags: ["foley", "percussion"], render: () => synthFoley({ seed: 141 }) },
];
