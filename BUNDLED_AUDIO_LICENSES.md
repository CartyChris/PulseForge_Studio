# Bundled Audio — Sources & Licenses

**Every sound that ships with PulseForge Studio is synthesized programmatically at
runtime by original code in this repository.** No third-party sample content, no
recorded material, no commercial pack content is bundled. There are no audio files
in the repo at all — grep it: the "library" is DSP code.

| Asset group | Source | Generator | License status |
|---|---|---|---|
| Drum kits ×4 (Modern Hip-Hop, Trap & 808, Electronic, Acoustic Essentials — 18 roles each: kicks, 808 kick, snares, claps, rimshots, closed/open hats, ride, crash, toms, shaker, tambourine, cowbell, perc, click, impact) | synthesized | `src/engine/dsp.ts` (sine-drop kicks, filtered-noise snares/hats, modal toms, seeded-noise textures) via `src/engine/kits.ts` | Original work of this project. No third-party rights. Use freely in your music. |
| Starter FX library (risers, downlifters, impacts, noise sweeps, bass hits, synthetic vocal-style chops, textures, foley-style ticks, transition effects — 60+ one-shots) | synthesized | `src/engine/dsp.ts` catalog in `src/engine/kits.ts` (`FACTORY_SAMPLES`) | Same — original synthesis. |
| Metronome clicks & count-in sounds | synthesized | `src/engine/graph.ts` (`scheduleMetronome`) | Same. |
| Instrument presets (pianos, e-pianos, organ, basses incl. 808, pads, leads, plucks, bells, brass, choir, mallet, SFX generator) | real-time synthesis | `src/engine/instruments.ts` (8 engines) | Same — synth patches, not samples. |
| Test fixtures (e2e/unit) | synthesized in-test | sine/noise buffers created programmatically | Same. |

## Determinism note

Generators use seeded PRNGs (`mulberry32`) so kits sound identical on every machine
and every run — the "sample pack" is reproducible from source.

## What this means for your music

Audio you render with these sounds is yours. No attribution required, no clearance
needed for the bundled content. (Sounds you import from external packs keep whatever
license they came with — see `SAMPLE_PACK_GUIDE.md`.)

## Expansion round (2026-07-20)
- 34 additional instrument presets (Bass/Leads/Keys/Piano/Pads/FM/Ensemble/FX): parameter
  sets over the existing built-in synthesis engines. No sampled content. License: original, MIT.
- 3 additional drum kits — "Lo-Fi Dust", "World Percussion", "Drill": rendered at runtime by
  the same pure-DSP generators in src/engine/dsp.ts with new parameters/tunings. No sampled
  content. License: original, MIT.
- External sound-pack sites linked in the Browser panel ("Get More Sounds") are third-party
  resources; their content is NOT bundled and each site's own license terms apply per sound.

## PulseForge Studio 2.0 sound library (2026-10-14)
Everything below is **original procedural synthesis** written for this project in
`src/engine/dsp.ts` and catalogued in `src/engine/kits.ts`. No recordings, no sampled
content, no third-party sample packs. The drum-machine sounds follow publicly documented
analog synthesis *recipes* (e.g. "two square oscillators into a bandpass" for an 808-style
cowbell); no ROM data or recorded hits from any hardware unit is used. Deterministic via
seeded `mulberry32`. License: original, MIT — same as the rest of the bundled sounds.

| Asset group | Generator(s) in `src/engine/dsp.ts` | License status |
|---|---|---|
| 12 new drum roles for every kit (snap, conga high/low, bongo, clave, woodblock, triangle, agogo, timbale, vox "hey", reverse cymbal, riser) | `synthSnap`, `synthConga`, `synthBongo`, `synthClave`, `synthWoodblock`, `synthTriangle`, `synthAgogo`, `synthTimbale`, `synthVoxHey`, `synthReverseCymbal`, `synthNoiseBuild` | Original synthesis. Use freely. |
| 15 genre kits — Classic 808, Classic 909, Boom Bap, House, Techno, Afrobeats, Reggaeton, Phonk, Jersey Club, Drum & Bass, Dancehall, Pop, R&B, 80s Retro, Dubstep (30 roles each) | 808/909-style recipes `synthKick909`, `synthSnare909`, `synthSnare808`, `synthHat909`, `synthHat808`, `synthCowbell808`, `synthClap808`, `synthRim808`, plus the existing generators, layered with `layerSounds` and coloured by `shapeOneShot` (filter, drive, bit-depth, sample-hold, reverb, gate) | Same — original synthesis with per-kit parameters. |
| 58 new factory one-shots — Snaps & Claps, Latin & World (incl. guiro), Drum Machines, FX & Transitions (air horn, sirens, scratches, tape stops, lasers, reverse cymbals, sub drops, white-noise builds), Stabs & Hits (orchestra hits, minor-7/minor-9/major-7 chord stabs), synthetic "hey" shouts, Vinyl & Texture (crackle, dust & hiss) | `synthGuiro`, `synthAirHorn`, `synthSiren`, `synthScratch`, `synthTapeStop`, `synthLaser`, `synthSubDrop`, `synthOrchHit`, `synthChordStab`, `synthVinylCrackle`, plus the generators above | Same — original synthesis. |

Notes: the "hey" shouts are formant-filtered synthetic buzz + noise (no human voice recorded);
the scratch FX reads back a synthetic vowel buffer, not a record. Audio you make with them is yours.

## Sampled instruments (PulseForge Studio 2.0, 2026-10-15)
Real recorded instruments, bundled in `public/samples/` (catalogued in `public/samples/manifest.json`, which is
copied to `src/engine/sample-manifest.json` for the app and checked equal by a test). Produced by
`scripts/fetch-samples.mjs`, which downloads only from the sources below, refuses to continue unless VSCO's
LICENSE file still says CC0, records each source's license evidence URL, then trims and normalizes the audio. These are the **only** non-original sounds shipped with PulseForge.

| Source | License | Instruments |
|---|---|---|
| [Salamander Grand Piano V2](https://tonejs.github.io/audio/salamander/) | [CC-BY-3.0](http://creativecommons.org/licenses/by/3.0/) (evidence: https://tonejs.github.io/audio/salamander/README) | Grand Piano (Salamander) |
| [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) | [CC0-1.0](https://github.com/sgossner/VSCO-2-CE/blob/master/LICENSE) (evidence: https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/LICENSE) | Strings Ensemble, Solo Violin, Cello Section, Pizzicato Strings, Concert Harp, Flute, Clarinet, Oboe, Trumpet, French Horn, Trombone, Glockenspiel, Marimba, Xylophone, Timpani, Brass Section |

**Attribution** (CC BY 3.0 requires it; it is also shown in the app under Settings → Sound credits):

- Salamander Grand Piano V2 (Yamaha C5) by Alexander Holm, licensed CC BY 3.0 (http://creativecommons.org/licenses/by/3.0/). mp3 edition as hosted by Tone.js (https://tonejs.github.io/audio/salamander/).
- VSCO 2 Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell); sample cutting by Elan Hickler/Soundemote. CC0 1.0 — credit requested, not required. http://vis.versilstudios.net/vsco-community.html

Music you make with these instruments is yours. The CC BY attribution covers redistributing the *samples*
themselves (e.g. shipping this app); it does not need to appear in songs you release. VSCO 2 CE is CC0 (public domain).
