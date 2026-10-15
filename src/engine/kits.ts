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
  // 2.0 expansion
  synthKick909, synthSnare909, synthSnare808, synthHat909, synthHat808, synthCowbell808, synthClap808, synthRim808,
  synthSnap, synthConga, synthBongo, synthTimbale, synthClave, synthWoodblock, synthTriangle, synthAgogo, synthGuiro,
  synthVoxHey, synthReverseCymbal, synthNoiseBuild, synthAirHorn, synthVinylCrackle, synthTapeStop, synthLaser,
  synthSiren, synthScratch, synthSubDrop, synthOrchHit, synthChordStab, shapeOneShot, layerSounds,
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
    // 2.0 roles — every kit gets a sensible default; kits override for character
    snap: { name: "Snap", render: () => synthSnap({ tune: tunes.snap ?? 0 }) },
    "conga-high": { name: "Conga High", render: () => synthConga({ high: true, tune: tunes["conga-high"] ?? 0 }) },
    "conga-low": { name: "Conga Low", render: () => synthConga({ high: false, tune: tunes["conga-low"] ?? 0 }) },
    bongo: { name: "Bongo", render: () => synthBongo({ tune: tunes.bongo ?? 0 }) },
    clave: { name: "Clave", render: () => synthClave({ tune: tunes.clave ?? 0 }) },
    woodblock: { name: "Woodblock", render: () => synthWoodblock({ tune: tunes.woodblock ?? 0 }) },
    triangle: { name: "Triangle", render: () => synthTriangle({ tune: tunes.triangle ?? 0 }) },
    agogo: { name: "Agogo", render: () => synthAgogo({ tune: tunes.agogo ?? 0 }) },
    timbale: { name: "Timbale", render: () => synthTimbale({ tune: tunes.timbale ?? 0 }) },
    "vox-hey": { name: "Vox Hey", render: () => synthVoxHey({ tune: tunes["vox-hey"] ?? 0 }) },
    "reverse-cymbal": { name: "Reverse Cymbal", render: () => synthReverseCymbal({ seconds: 2 }) },
    riser: { name: "Riser", render: () => synthNoiseBuild({ seconds: 2 }) },
  };
  return (Object.keys(base) as DrumRole[]).map((role) => ({
    id: `${kitId}/${role}`,
    name: base[role].name,
    role,
    render: overrides[role] ?? base[role].render,
  }));
}

/** SP-1200-ish dusty character: 12-bit, half-rate hold, low-passed, lightly driven. */
const DUSTY = { bits: 12, downsample: 2, lowpass: 5200, drive: 0.6 } as const;

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
  // ─────────────── 2.0 genre kits (15) — each built from its own recipes/parameters ───────────────
  {
    id: "classic-808",
    name: "Classic 808",
    description: "The TR-808 recipe: boomy tuned kick, bridged-T snare and rim, six-oscillator metal hats, the iconic cowbell and clap.",
    sounds: kitSounds("classic-808", {
      kick: () => synth808({ tune: 3, decay: 0.8, drive: 0.15 }),
      "kick-808": () => synth808({ tune: 0, decay: 1.8, drive: 0.3 }),
      snare: () => synthSnare808({}),
      clap: () => synthClap808({}),
      rimshot: () => synthRim808({}),
      "hat-closed": () => synthHat808({}),
      "hat-open": () => synthHat808({ open: true }),
      cowbell: () => synthCowbell808({}),
      perc: () => synthCowbell808({ tune: 5, decay: 0.15 }),
      "tom-low": () => synthTom({ tune: -5, decay: 0.6 }),
      "tom-mid": () => synthTom({ tune: 0, decay: 0.5 }),
      "tom-high": () => synthTom({ tune: 5, decay: 0.45 }),
      "conga-high": () => synthConga({ tune: 2, decay: 0.25, tone: 0.1 }),
      "conga-low": () => synthConga({ high: false, decay: 0.32, tone: 0.1 }),
      clave: () => synthClave({}),
      crash: () => shapeOneShot(synthCymbal({ decay: 2 }), { lowpass: 12000 }),
    }),
  },
  {
    id: "classic-909",
    name: "Classic 909",
    description: "TR-909 character: clicky punchy kick, bright snappy snare, sizzling metal hats and gritty low-bit cymbals.",
    sounds: kitSounds("classic-909", {
      kick: () => synthKick909({}),
      snare: () => synthSnare909({}),
      clap: () => synthClap808({ tone: 0.8, decay: 0.26, seed: 990 }),
      rimshot: () => synthRim808({ tune: 3 }),
      "hat-closed": () => synthHat909({}),
      "hat-open": () => synthHat909({ open: true }),
      ride: () => shapeOneShot(synthCymbal({ ride: true, decay: 1.4 }), { bits: 8, lowpass: 14000 }),
      crash: () => shapeOneShot(synthCymbal({ decay: 2.2, seed: 991 }), { bits: 8, lowpass: 14000 }),
      "tom-low": () => shapeOneShot(synthTom({ tune: -5, decay: 0.45 }), { drive: 0.5 }),
      "tom-mid": () => shapeOneShot(synthTom({ tune: 0, decay: 0.4 }), { drive: 0.5 }),
      "tom-high": () => shapeOneShot(synthTom({ tune: 5, decay: 0.35 }), { drive: 0.5 }),
      perc: () => synthRim808({ tune: 7 }),
    }),
  },
  {
    id: "boom-bap",
    name: "Boom Bap",
    description: "Dusty 12-bit, low-passed kick and snare with knock — made for swung 90s hip-hop grooves.",
    sounds: kitSounds("boom-bap", {
      kick: () => shapeOneShot(synthKick({ tune: -3, decay: 0.45, tone: 0.4, drive: 0.6, seed: 71 }), DUSTY),
      snare: () => shapeOneShot(layerSounds([[synthSnare({ tune: -2, decay: 0.26, tone: 0.45, drive: 0.4, seed: 73 }), 1], [synthRimshot({ tone: 0.3 }), 0.35]]), DUSTY),
      clap: () => shapeOneShot(synthClap({ decay: 0.3, tone: 0.35, seed: 75 }), DUSTY),
      rimshot: () => shapeOneShot(synthRimshot({ tone: 0.35 }), DUSTY),
      "hat-closed": () => shapeOneShot(synthHat({ decay: 0.07, tone: 0.35 }), { bits: 12, downsample: 2, lowpass: 9000 }),
      "hat-open": () => shapeOneShot(synthHat({ open: true, decay: 0.32, tone: 0.35 }), { bits: 12, downsample: 2, lowpass: 9000 }),
      snap: () => shapeOneShot(synthSnap({ seed: 77 }), DUSTY),
      "vox-hey": () => shapeOneShot(synthVoxHey({ tune: -2, voices: 3, seed: 79 }), DUSTY),
      crash: () => shapeOneShot(synthCymbal({ decay: 1.8 }), { bits: 12, downsample: 2, lowpass: 8000 }),
    }, { "tom-low": -8, "tom-mid": -4, "tom-high": 0 }),
  },
  {
    id: "house",
    name: "House",
    description: "Four-on-the-floor house: punchy 909-style kick, roomy clap, crisp closed hat and a short offbeat open hat.",
    sounds: kitSounds("house", {
      kick: () => synthKick909({ tune: 0, decay: 0.38, tone: 0.65, drive: 0.4 }),
      snare: () => synthSnare909({ tune: 2, tone: 0.6 }),
      clap: () => shapeOneShot(synthClap808({ tone: 0.7, decay: 0.25, seed: 1001 }), { reverb: { decay: 0.6, mix: 0.2 } }),
      "hat-closed": () => synthHat909({ decay: 0.04, tone: 0.6 }),
      "hat-open": () => synthHat909({ open: true, decay: 0.28, tone: 0.6 }),
      shaker: () => synthShaker({ decay: 0.09, tone: 0.6 }),
      ride: () => shapeOneShot(synthCymbal({ ride: true, decay: 1.3 }), { bits: 8, lowpass: 13000 }),
      perc: () => synthRim808({ tune: 2 }),
      "conga-high": () => synthConga({ tune: 3, tone: 0.4 }),
      "conga-low": () => synthConga({ high: false, tune: 3, tone: 0.4 }),
    }),
  },
  {
    id: "techno",
    name: "Techno",
    description: "Hard driven kick with a reverb-rumble layer, industrial claps, tight metallic hats and bit-crushed ride.",
    sounds: kitSounds("techno", {
      kick: () => shapeOneShot(synthKick909({ tune: -2, decay: 0.55, tone: 0.7, drive: 0.9 }), { drive: 1.5, lowpass: 9000 }),
      "kick-808": () => shapeOneShot(synthKick909({ tune: -3, decay: 0.7, drive: 0.6, seed: 1103 }), { reverb: { decay: 1.2, mix: 0.5, damp: 0.6 }, lowpass: 400, drive: 1 }),
      snare: () => synthSnare909({ tune: -1, decay: 0.2, tone: 0.8, drive: 0.6 }),
      clap: () => shapeOneShot(synthClap808({ tone: 0.6, decay: 0.3, seed: 1101 }), { reverb: { decay: 1.0, mix: 0.3 } }),
      rimshot: () => synthRim808({ tune: -2, drive: 0.5 }),
      "hat-closed": () => synthHat909({ decay: 0.035, tone: 0.8 }),
      "hat-open": () => synthHat909({ open: true, decay: 0.22, tone: 0.8 }),
      ride: () => shapeOneShot(synthCymbal({ ride: true, decay: 1.6 }), { bits: 8, downsample: 2, lowpass: 12000 }),
      perc: () => synthLaser({ seconds: 0.12, from: 1800, to: 300 }),
      clave: () => synthClave({ tune: -7, decay: 0.06 }),
      riser: () => synthNoiseBuild({ seconds: 4, tone: 0.8 }),
    }),
  },
  {
    id: "afrobeats",
    name: "Afrobeats",
    description: "Warm round kick, rim-and-snap snare, busy shakers, congas, bells and a driven log-drum perc.",
    sounds: kitSounds("afrobeats", {
      kick: () => synthKick({ tune: -3, decay: 0.4, tone: 0.35, drive: 0.4, seed: 1201 }),
      "kick-808": () => synth808({ tune: -2, decay: 1.0, drive: 0.3 }),
      snare: () => layerSounds([[synthRimshot({ tone: 0.6 }), 0.8], [synthSnap({ seed: 1203 }), 0.7]]),
      clap: () => synthClap808({ tone: 0.4, decay: 0.2, seed: 1205 }),
      shaker: () => synthShaker({ decay: 0.1, tone: 0.55, seed: 1207 }),
      "hat-closed": () => synthShaker({ decay: 0.06, tone: 0.7 }),
      "hat-open": () => synthHat({ open: true, decay: 0.25, tone: 0.4 }),
      perc: () => shapeOneShot(synthTom({ tune: -5, decay: 0.35 }), { drive: 2, lowpass: 2500 }),
      cowbell: () => synthAgogo({ high: true, decay: 0.3 }),
      "conga-high": () => synthConga({ tune: 1, tone: 0.6 }),
      "conga-low": () => synthConga({ high: false, tone: 0.6 }),
      "tom-low": () => synthConga({ high: false, tune: -3, decay: 0.45 }),
      "tom-mid": () => synthConga({ high: false, tune: 2, decay: 0.4 }),
      "tom-high": () => synthConga({ tune: 2, decay: 0.32 }),
    }),
  },
  {
    id: "reggaeton",
    name: "Reggaeton",
    description: "Dembow-ready: tight rim-layered snare, punchy kick, crisp hats, timbale rolls and a gang 'hey'.",
    sounds: kitSounds("reggaeton", {
      kick: () => synthKick909({ tune: 1, decay: 0.3, tone: 0.7, drive: 0.5 }),
      "kick-808": () => synth808({ tune: 0, decay: 0.9, drive: 0.4 }),
      snare: () => layerSounds([[synthSnare909({ tune: 4, decay: 0.14, tone: 0.8, seed: 1301 }), 1], [synthRim808({ tune: 2 }), 0.5]]),
      clap: () => synthClap808({ tone: 0.65, decay: 0.2, seed: 1303 }),
      "hat-closed": () => synthHat909({ decay: 0.04, tone: 0.65 }),
      timbale: () => synthTimbale({ tune: 1, decay: 0.32 }),
      perc: () => synthTimbale({ high: false, decay: 0.25 }),
      "vox-hey": () => synthVoxHey({ voices: 3, tune: 1, seed: 1305 }),
    }),
  },
  {
    id: "phonk",
    name: "Phonk",
    description: "Memphis-style crunch: heavily driven 808 cowbell, distorted crushed kick and 808, gritty snare and a pitched-down shout.",
    sounds: kitSounds("phonk", {
      kick: () => shapeOneShot(synthKick909({ tune: -1, decay: 0.4, tone: 0.8, drive: 1 }), { drive: 5, bits: 8, lowpass: 7000 }),
      "kick-808": () => shapeOneShot(synth808({ tune: -1, decay: 1.6, drive: 1 }), { drive: 4, lowpass: 5000 }),
      cowbell: () => shapeOneShot(synthCowbell808({ drive: 1, decay: 0.38 }), { drive: 3, bits: 10, lowpass: 6500 }),
      perc: () => shapeOneShot(synthCowbell808({ tune: 5, drive: 1, decay: 0.2 }), { drive: 3, lowpass: 6500 }),
      snare: () => shapeOneShot(synthSnare808({ tune: 1, decay: 0.2, tone: 0.7, drive: 0.6 }), { drive: 3, bits: 8, lowpass: 7000 }),
      clap: () => shapeOneShot(synthClap808({ tone: 0.5, decay: 0.24, seed: 1401 }), { drive: 2.5, bits: 8, lowpass: 7000 }),
      "hat-closed": () => shapeOneShot(synthHat808({ decay: 0.04, tone: 0.6 }), { bits: 8, downsample: 2 }),
      "hat-open": () => shapeOneShot(synthHat808({ open: true, decay: 0.3, tone: 0.6 }), { bits: 8, downsample: 2 }),
      "vox-hey": () => shapeOneShot(synthVoxHey({ tune: -5, voices: 2, seed: 1403 }), { drive: 2, bits: 8, lowpass: 5000 }),
    }),
  },
  {
    id: "jersey-club",
    name: "Jersey Club",
    description: "Bouncy club kit: punchy kick, layered clap-snares, the 'bed squeak' perc and chopped 'hey' shouts.",
    sounds: kitSounds("jersey-club", {
      kick: () => synthKick909({ tune: 2, decay: 0.28, tone: 0.75, drive: 0.6 }),
      snare: () => synthClap808({ tone: 0.75, decay: 0.2, seed: 1501 }),
      clap: () => layerSounds([[synthClap808({ tone: 0.8, seed: 1503 }), 1], [synthSnap({ seed: 1505 }), 0.5]]),
      "hat-closed": () => synthHat909({ decay: 0.035, tone: 0.75 }),
      "hat-open": () => synthHat909({ open: true, decay: 0.2, tone: 0.75 }),
      perc: () => synthLaser({ seconds: 0.14, from: 700, to: 1700 }),
      "vox-hey": () => synthVoxHey({ tune: 3, voices: 2, decay: 0.2, seed: 1507 }),
      riser: () => synthNoiseBuild({ seconds: 2, tone: 0.9 }),
    }),
  },
  {
    id: "dnb",
    name: "Drum & Bass",
    description: "Fast breaks: tight thumpy kick, very bright cracking snare, short hats, ride, and reverse-cymbal transitions.",
    sounds: kitSounds("dnb", {
      kick: () => synthKick({ tune: 3, decay: 0.24, tone: 0.9, drive: 0.6, seed: 1601 }),
      "kick-808": () => synth808({ tune: 0, decay: 1.4, drive: 0.6 }),
      snare: () => shapeOneShot(synthSnare909({ tune: 6, decay: 0.15, tone: 0.95, drive: 0.5, seed: 1603 }), { highpass: 220 }),
      clap: () => synthClap808({ tone: 0.9, decay: 0.18, seed: 1605 }),
      "hat-closed": () => synthHat909({ decay: 0.03, tone: 0.9 }),
      "hat-open": () => synthHat909({ open: true, decay: 0.25, tone: 0.9 }),
      ride: () => synthCymbal({ ride: true, decay: 1.0 }),
      shaker: () => synthShaker({ decay: 0.07, tone: 0.8 }),
      "reverse-cymbal": () => synthReverseCymbal({ seconds: 1.5 }),
      riser: () => synthNoiseBuild({ seconds: 3.5, tone: 0.9 }),
    }, { "tom-low": -2, "tom-mid": 3, "tom-high": 8 }),
  },
  {
    id: "dancehall",
    name: "Dancehall",
    description: "Rim-heavy snare, round kick, claves and cowbell, gang shouts and a dub-siren transition.",
    sounds: kitSounds("dancehall", {
      kick: () => synthKick909({ tune: 0, decay: 0.34, tone: 0.55, drive: 0.4, seed: 1701 }),
      snare: () => layerSounds([[synthRim808({ tune: 1 }), 0.8], [synthSnare909({ tune: 5, decay: 0.12, tone: 0.7, seed: 1703 }), 0.7]]),
      rimshot: () => synthRim808({ tune: 3 }),
      clap: () => synthClap808({ tone: 0.6, decay: 0.22, seed: 1705 }),
      perc: () => synthClave({ tune: -3 }),
      cowbell: () => synthCowbell808({ tune: 2, decay: 0.2 }),
      "vox-hey": () => synthVoxHey({ tune: -2, voices: 4, seed: 1707 }),
      riser: () => synthSiren({ kind: "dub", seconds: 2 }),
    }),
  },
  {
    id: "pop",
    name: "Pop",
    description: "Polished radio kit: kick with sub layer, snare+clap stack in a short room, finger snaps and crisp hats.",
    sounds: kitSounds("pop", {
      kick: () => layerSounds([[synthKick909({ tune: 0, decay: 0.35, tone: 0.6, drive: 0.3 }), 1], [synth808({ tune: 0, decay: 0.4, drive: 0.2 }), 0.4]]),
      snare: () => shapeOneShot(layerSounds([[synthSnare({ tune: 2, decay: 0.22, tone: 0.7, seed: 1801 }), 1], [synthClap808({ seed: 1803 }), 0.6]]), { reverb: { decay: 0.9, mix: 0.18 } }),
      clap: () => shapeOneShot(synthClap808({ tone: 0.7, decay: 0.25, seed: 1805 }), { reverb: { decay: 0.8, mix: 0.2 } }),
      snap: () => shapeOneShot(synthSnap({ seed: 1807 }), { reverb: { decay: 0.7, mix: 0.2 } }),
      "hat-closed": () => synthHat909({ decay: 0.045, tone: 0.7 }),
      "hat-open": () => synthHat909({ open: true, decay: 0.32, tone: 0.7 }),
      crash: () => synthCymbal({ decay: 2.4 }),
    }),
  },
  {
    id: "rnb",
    name: "R&B",
    description: "Smooth and soft: deep round kick, clean 808, snap-and-rim snare, roomy snaps and claps, mellow hats.",
    sounds: kitSounds("rnb", {
      kick: () => synthKick({ tune: -4, decay: 0.45, tone: 0.3, drive: 0.25, seed: 1901 }),
      "kick-808": () => synth808({ tune: -2, decay: 1.4, drive: 0.15 }),
      snare: () => layerSounds([[synthSnap({ seed: 1903, decay: 0.08 }), 0.9], [synthRimshot({ tone: 0.4 }), 0.6]]),
      snap: () => shapeOneShot(synthSnap({ seed: 1905, tone: 0.4 }), { reverb: { decay: 1.0, mix: 0.25 } }),
      clap: () => shapeOneShot(synthClap({ decay: 0.32, tone: 0.35, seed: 1907 }), { reverb: { decay: 1.0, mix: 0.25 }, lowpass: 9000 }),
      "hat-closed": () => shapeOneShot(synthHat({ decay: 0.06, tone: 0.3 }), { lowpass: 10000 }),
      "hat-open": () => shapeOneShot(synthHat({ open: true, decay: 0.4, tone: 0.3 }), { lowpass: 10000 }),
      rimshot: () => synthRimshot({ tone: 0.35 }),
      triangle: () => synthTriangle({ decay: 1.8, tune: 2 }),
      perc: () => synthWoodblock({ tune: -5, tone: 0.3 }),
    }, { "tom-low": -7, "tom-mid": -3, "tom-high": 1 }),
  },
  {
    id: "eighties",
    name: "80s Retro",
    description: "Gated-reverb snare and claps, 8-bit drum-machine kick and hats, Simmons-style gated toms.",
    sounds: kitSounds("eighties", {
      kick: () => shapeOneShot(synthKick909({ tune: -1, decay: 0.32, tone: 0.5, drive: 0.25 }), { bits: 8, lowpass: 9000 }),
      snare: () => shapeOneShot(synthSnare909({ tune: -2, decay: 0.25, tone: 0.7, seed: 2001 }), { reverb: { decay: 1.8, mix: 0.6, damp: 0.2 }, gate: 0.32 }),
      clap: () => shapeOneShot(synthClap808({ seed: 2003 }), { reverb: { decay: 1.5, mix: 0.5 }, gate: 0.28 }),
      "tom-low": () => shapeOneShot(synthTom({ tune: -5, decay: 0.5 }), { reverb: { decay: 1.2, mix: 0.4 }, gate: 0.4 }),
      "tom-mid": () => shapeOneShot(synthTom({ tune: 0, decay: 0.45 }), { reverb: { decay: 1.2, mix: 0.4 }, gate: 0.36 }),
      "tom-high": () => shapeOneShot(synthTom({ tune: 5, decay: 0.4 }), { reverb: { decay: 1.2, mix: 0.4 }, gate: 0.32 }),
      "hat-closed": () => shapeOneShot(synthHat808({ decay: 0.05 }), { bits: 8 }),
      "hat-open": () => shapeOneShot(synthHat808({ open: true, decay: 0.4 }), { bits: 8 }),
      cowbell: () => synthCowbell808({}),
      "vox-hey": () => synthVoxHey({ voices: 3, tune: 2, seed: 2005 }),
    }),
  },
  {
    id: "dubstep",
    name: "Dubstep",
    description: "Huge layered snare with a long reverb tail, driven punchy kick, deep sub, big impacts and long builds.",
    sounds: kitSounds("dubstep", {
      kick: () => shapeOneShot(synthKick909({ tune: -1, decay: 0.45, tone: 0.9, drive: 0.9, seed: 2101 }), { drive: 1.2 }),
      "kick-808": () => synth808({ tune: -3, decay: 1.6, drive: 0.6 }),
      snare: () => shapeOneShot(layerSounds([
        [synthSnare909({ tune: -3, decay: 0.35, tone: 0.9, drive: 0.8, seed: 2103 }), 1],
        [synthClap808({ decay: 0.3, tone: 0.6, seed: 2105 }), 0.7],
        [synthKick909({ tune: 5, decay: 0.15 }), 0.35],
      ]), { drive: 1, reverb: { decay: 1.6, mix: 0.4 } }),
      clap: () => shapeOneShot(synthClap808({ decay: 0.35, seed: 2107 }), { reverb: { decay: 1.4, mix: 0.4 } }),
      "hat-closed": () => synthHat909({ decay: 0.04, tone: 0.7 }),
      "hat-open": () => synthHat909({ open: true, decay: 0.35, tone: 0.7 }),
      crash: () => synthCymbal({ decay: 3 }),
      impact: () => synthImpact({ decay: 2.2, seed: 2109 }),
      riser: () => synthNoiseBuild({ seconds: 4, tone: 1 }),
      "reverse-cymbal": () => synthReverseCymbal({ seconds: 2.5 }),
    }, { "tom-low": -9, "tom-mid": -5, "tom-high": -1 }),
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
  // ─────────────── 2.0 expansion — all original procedural synthesis ───────────────
  // Snaps & Claps
  { id: "snap/finger-1", name: "Finger Snap", category: "Snaps & Claps", tags: ["snap", "finger snap", "click", "rnb", "pop"], render: () => synthSnap({}) },
  { id: "snap/finger-tight", name: "Finger Snap Tight", category: "Snaps & Claps", tags: ["snap", "finger snap", "tight", "dry"], render: () => synthSnap({ decay: 0.045, tone: 0.8, seed: 3001 }) },
  { id: "snap/finger-room", name: "Finger Snap Room", category: "Snaps & Claps", tags: ["snap", "finger snap", "reverb", "room", "pop"], render: () => shapeOneShot(synthSnap({ seed: 3003 }), { reverb: { decay: 1.0, mix: 0.3 } }) },
  { id: "clap/808", name: "808 Clap", category: "Snaps & Claps", tags: ["clap", "808", "drum machine", "classic"], render: () => synthClap808({}) },
  { id: "clap/909", name: "909 Clap", category: "Snaps & Claps", tags: ["clap", "909", "drum machine", "house", "bright"], render: () => synthClap808({ tone: 0.85, decay: 0.26, seed: 3005 }) },
  { id: "clap/stack", name: "Clap Stack", category: "Snaps & Claps", tags: ["clap", "layered", "wide", "pop", "trap"], render: () => layerSounds([[synthClap808({ seed: 3007 }), 1], [synthClap({ seed: 3009 }), 0.7, 0.004], [synthSnap({ seed: 3011 }), 0.5]]) },
  { id: "clap/gated-80s", name: "Gated 80s Clap", category: "Snaps & Claps", tags: ["clap", "80s", "gated reverb", "retro"], render: () => shapeOneShot(synthClap808({ seed: 3013 }), { reverb: { decay: 1.5, mix: 0.5 }, gate: 0.28 }) },
  // Latin & World
  { id: "latin/conga-high-open", name: "Conga High Open", category: "Latin & World", tags: ["conga", "hand drum", "latin", "afro", "open tone"], render: () => synthConga({ high: true }) },
  { id: "latin/conga-high-slap", name: "Conga High Slap", category: "Latin & World", tags: ["conga", "slap", "hand drum", "latin"], render: () => synthConga({ high: true, slap: true }) },
  { id: "latin/conga-low-open", name: "Conga Low Open", category: "Latin & World", tags: ["conga", "tumba", "hand drum", "latin", "low"], render: () => synthConga({ high: false }) },
  { id: "latin/bongo-high", name: "Bongo High", category: "Latin & World", tags: ["bongo", "macho", "hand drum", "latin"], render: () => synthBongo({ high: true }) },
  { id: "latin/bongo-low", name: "Bongo Low", category: "Latin & World", tags: ["bongo", "hembra", "hand drum", "latin"], render: () => synthBongo({ high: false }) },
  { id: "latin/timbale-high", name: "Timbale High", category: "Latin & World", tags: ["timbale", "timbal", "latin", "salsa", "reggaeton", "metal shell"], render: () => synthTimbale({ high: true }) },
  { id: "latin/timbale-low", name: "Timbale Low", category: "Latin & World", tags: ["timbale", "timbal", "latin", "reggaeton"], render: () => synthTimbale({ high: false }) },
  { id: "latin/clave", name: "Clave", category: "Latin & World", tags: ["clave", "wood", "latin", "son clave", "808"], render: () => synthClave({}) },
  { id: "latin/woodblock", name: "Woodblock", category: "Latin & World", tags: ["woodblock", "wood", "tok", "percussion"], render: () => synthWoodblock({}) },
  { id: "latin/triangle-open", name: "Triangle Open", category: "Latin & World", tags: ["triangle", "metal", "ring", "bright", "orchestral"], render: () => synthTriangle({}) },
  { id: "latin/triangle-muted", name: "Triangle Muted", category: "Latin & World", tags: ["triangle", "muted", "metal", "short"], render: () => synthTriangle({ muted: true }) },
  { id: "latin/agogo-high", name: "Agogo High", category: "Latin & World", tags: ["agogo", "bell", "samba", "afro", "brazil"], render: () => synthAgogo({ high: true }) },
  { id: "latin/agogo-low", name: "Agogo Low", category: "Latin & World", tags: ["agogo", "bell", "samba", "afro", "brazil"], render: () => synthAgogo({ high: false }) },
  { id: "latin/guiro", name: "Guiro", category: "Latin & World", tags: ["guiro", "scrape", "rasp", "latin", "cumbia"], render: () => synthGuiro({}) },
  { id: "latin/guiro-short", name: "Guiro Short", category: "Latin & World", tags: ["guiro", "scrape", "latin"], render: () => synthGuiro({ strokes: 1, seed: 3015 }) },
  // Drum Machines
  { id: "drum/kick-909", name: "909 Kick", category: "Drum Machines", tags: ["kick", "909", "house", "techno", "drum machine"], render: () => synthKick909({}) },
  { id: "drum/snare-909", name: "909 Snare", category: "Drum Machines", tags: ["snare", "909", "house", "drum machine"], render: () => synthSnare909({}) },
  { id: "drum/snare-808", name: "808 Snare", category: "Drum Machines", tags: ["snare", "808", "drum machine", "classic"], render: () => synthSnare808({}) },
  { id: "drum/hat-909-closed", name: "909 Closed Hat", category: "Drum Machines", tags: ["hi-hat", "hat", "closed", "909", "drum machine"], render: () => synthHat909({}) },
  { id: "drum/hat-909-open", name: "909 Open Hat", category: "Drum Machines", tags: ["hi-hat", "hat", "open", "909", "offbeat", "house"], render: () => synthHat909({ open: true }) },
  { id: "drum/hat-808-closed", name: "808 Closed Hat", category: "Drum Machines", tags: ["hi-hat", "hat", "closed", "808", "drum machine"], render: () => synthHat808({}) },
  { id: "drum/cowbell-808", name: "808 Cowbell", category: "Drum Machines", tags: ["cowbell", "808", "bell", "drum machine", "classic"], render: () => synthCowbell808({}) },
  { id: "drum/cowbell-phonk", name: "Phonk Cowbell", category: "Drum Machines", tags: ["cowbell", "808", "phonk", "distorted", "memphis"], render: () => shapeOneShot(synthCowbell808({ drive: 1, decay: 0.38 }), { drive: 3, bits: 10, lowpass: 6500 }) },
  { id: "drum/rim-808", name: "808 Rimshot", category: "Drum Machines", tags: ["rimshot", "rim", "808", "drum machine"], render: () => synthRim808({}) },
  // FX & Transitions
  { id: "fx/air-horn", name: "Air Horn", category: "FX & Transitions", tags: ["air horn", "horn", "dancehall", "reggae", "dj", "hype"], render: () => synthAirHorn({}) },
  { id: "fx/air-horn-single", name: "Air Horn Single", category: "FX & Transitions", tags: ["air horn", "horn", "dj", "hype"], render: () => synthAirHorn({ blasts: 1 }) },
  { id: "fx/siren-wail", name: "Siren Wail", category: "FX & Transitions", tags: ["siren", "wail", "alarm", "transition"], render: () => synthSiren({ kind: "wail" }) },
  { id: "fx/siren-dub", name: "Dub Siren", category: "FX & Transitions", tags: ["siren", "dub", "reggae", "dancehall", "echo"], render: () => synthSiren({ kind: "dub" }) },
  { id: "fx/scratch-baby", name: "Scratch Baby", category: "FX & Transitions", tags: ["scratch", "vinyl", "dj", "turntable", "hip-hop"], render: () => synthScratch({ style: "baby" }) },
  { id: "fx/scratch-chirp", name: "Scratch Chirp", category: "FX & Transitions", tags: ["scratch", "chirp", "vinyl", "dj", "turntable"], render: () => synthScratch({ style: "chirp", tune: 3 }) },
  { id: "fx/tape-stop", name: "Tape Stop", category: "FX & Transitions", tags: ["tape stop", "slowdown", "transition", "power down"], render: () => synthTapeStop({}) },
  { id: "fx/tape-stop-long", name: "Tape Stop Long", category: "FX & Transitions", tags: ["tape stop", "slowdown", "transition"], render: () => synthTapeStop({ seconds: 2.5, tune: -2 }) },
  { id: "fx/laser", name: "Laser Zap", category: "FX & Transitions", tags: ["laser", "zap", "pew", "sci-fi", "dub"], render: () => synthLaser({}) },
  { id: "fx/laser-short", name: "Laser Blip", category: "FX & Transitions", tags: ["laser", "zap", "blip", "short"], render: () => synthLaser({ seconds: 0.15, from: 2600, to: 400 }) },
  { id: "fx/reverse-cymbal", name: "Reverse Cymbal", category: "FX & Transitions", tags: ["reverse cymbal", "reverse", "swell", "transition", "crash"], render: () => synthReverseCymbal({ seconds: 2 }) },
  { id: "fx/reverse-cymbal-long", name: "Reverse Cymbal Long", category: "FX & Transitions", tags: ["reverse cymbal", "reverse", "swell", "transition"], render: () => synthReverseCymbal({ seconds: 4, seed: 3017 }) },
  { id: "fx/sub-drop", name: "Sub Drop", category: "FX & Transitions", tags: ["sub drop", "sub", "bass", "drop", "808", "transition"], render: () => synthSubDrop({}) },
  { id: "fx/sub-drop-long", name: "Sub Drop Long", category: "FX & Transitions", tags: ["sub drop", "sub", "bass", "drop"], render: () => synthSubDrop({ seconds: 3.5, from: 90, to: 28 }) },
  { id: "fx/white-noise-build", name: "White Noise Build 4s", category: "FX & Transitions", tags: ["riser", "build", "white noise", "uplifter", "edm", "transition"], render: () => synthNoiseBuild({ seconds: 4 }) },
  { id: "fx/white-noise-build-8s", name: "White Noise Build 8s", category: "FX & Transitions", tags: ["riser", "build", "white noise", "uplifter", "long"], render: () => synthNoiseBuild({ seconds: 8, seed: 3019, tone: 0.8 }) },
  // Stabs & Hits
  { id: "stab/orchestra-hit", name: "Orchestra Hit", category: "Stabs & Hits", tags: ["orchestra hit", "orch", "stab", "hit", "90s", "brass"], render: () => synthOrchHit({}) },
  { id: "stab/orchestra-hit-major", name: "Orchestra Hit Major", category: "Stabs & Hits", tags: ["orchestra hit", "orch", "stab", "major"], render: () => synthOrchHit({ minor: false, tune: 2 }) },
  { id: "stab/minor7-chord", name: "Minor 7 Chord Stab", category: "Stabs & Hits", tags: ["chord stab", "stab", "minor 7", "house", "deep house"], render: () => synthChordStab({ chord: "min7" }) },
  { id: "stab/minor7-dark", name: "Minor 7 Dark Stab", category: "Stabs & Hits", tags: ["chord stab", "stab", "minor 7", "dark", "dub techno"], render: () => synthChordStab({ chord: "min7", root: 57, tone: 0.1, reverb: 0.3 }) },
  { id: "stab/minor9-chord", name: "Minor 9 Chord Stab", category: "Stabs & Hits", tags: ["chord stab", "stab", "minor 9", "neo soul", "house"], render: () => synthChordStab({ chord: "min9" }) },
  { id: "stab/maj7-chord", name: "Major 7 Chord Stab", category: "Stabs & Hits", tags: ["chord stab", "stab", "major 7", "garage", "house"], render: () => synthChordStab({ chord: "maj7", root: 62 }) },
  // Vocal Chops (synthetic shouts)
  { id: "vox/hey", name: "Hey Shout", category: "Vocal Chops", tags: ["vocal", "hey", "shout", "chant", "synthetic"], render: () => synthVoxHey({}) },
  { id: "vox/hey-crowd", name: "Hey Crowd", category: "Vocal Chops", tags: ["vocal", "hey", "shout", "crowd", "gang", "synthetic"], render: () => synthVoxHey({ voices: 5, seed: 3021 }) },
  // Vinyl & Texture
  { id: "vinyl/crackle", name: "Vinyl Crackle", category: "Vinyl & Texture", tags: ["vinyl", "crackle", "lofi", "texture", "dust"], render: () => synthVinylCrackle({}) },
  { id: "vinyl/crackle-dense", name: "Vinyl Crackle Dense", category: "Vinyl & Texture", tags: ["vinyl", "crackle", "lofi", "old record"], render: () => synthVinylCrackle({ density: 3, seed: 3023 }) },
  { id: "vinyl/dust-hiss", name: "Dust & Hiss", category: "Vinyl & Texture", tags: ["vinyl", "hiss", "noise", "lofi", "texture"], render: () => synthVinylCrackle({ density: 0.3, hiss: 3, seed: 3025 }) },
];
