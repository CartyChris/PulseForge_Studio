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
