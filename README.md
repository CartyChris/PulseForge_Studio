# PulseForge Studio ⚒

A standalone, local-first digital audio workstation with the pattern-based workflow of
classic beat-making software — plus an optional, secure AI production layer.
Original design, original branding, original synthesized sounds.

**Everything core runs locally in your browser**: sequencing, piano roll, arrangement,
mixing, recording, sample chopping, project storage, and WAV export all work without
any AI provider connected. AI features are additive and route through a local backend
that keeps API keys out of the frontend.

## Quick start

```bash
# double-click this in Finder:
Start PulseForge.command

# or from a terminal:
npm install
npm run start        # production: build served at http://127.0.0.1:7800
npm run dev          # development: Vite on :5173, API on :7801
```

The launcher checks your Node runtime (20+), installs dependencies on first run,
starts the backend (which also serves the built studio), waits for
`/api/health`, and opens your browser.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + backend API (hot reload) |
| `npm run build` | Production build into `dist/` |
| `npm run start` | Build (if needed) + serve studio & API on one port |
| `npm run start:local` | Same as `start`, never opens a browser |
| `npm run lint` | ESLint over the whole repo |
| `npm run typecheck` | Strict TypeScript on frontend + backend |
| `npm run test` | Vitest unit + integration suites (88 tests) |
| `npm run test:e2e` | Playwright end-to-end suite (7 tests, real audio engine) |
| `npm run verify` | lint + typecheck + test + build + e2e, in order |

## Making a beat in 60 seconds

1. **PAT mode** is on by default — the transport plays the current Channel Rack pattern.
2. Open **Channel Rack**, click **+ Add Channel**, add a drum kit starter set.
3. Click steps to program kick/snare/hats. Right-click a step for velocity,
   probability, and micro-timing. Swing, Euclidean (E), Randomize (R), Humanize (H),
   Variation (V) per channel.
4. Add a melodic instrument, open **Piano Roll**, draw notes (pencil), drag to move,
   grab a note's tail to stretch, right-click to erase. Velocity and pan lanes below.
5. Switch to **Playlist**, place pattern clips, arrange sections, add audio and
   automation clips. Flip the transport to **SONG** mode to hear the arrangement.
6. Mix in the **Mixer** (18 built-in effect types, sends, buses, sidechain ducking).
7. **Project ▾ → Export…** renders the full song offline to WAV (16/24/32-bit,
   44.1–96 kHz, stems optional).

## What's inside

- **Instruments**: 4 synthesized drum kits (Modern Hip-Hop, Trap & 808, Electronic,
  Acoustic Essentials — 18 sounds each), sampler (ADSR/filter/loop/portamento/reverse),
  8 synth engines (subtractive, FM, pad, pluck, piano, e-piano, 808/sub bass, bass) and
  35+ musical presets (pianos, EPs, organ, basses, pads, leads, bells, brass, choir…).
- **Starter library**: 60+ programmatically synthesized one-shots and FX — kicks,
  snares, hats, percussion, risers, downlifters, impacts, sweeps, bass hits, vocal-ish
  chops, textures, foley-style ticks, metronome clicks. All original, license-free
  (see `BUNDLED_AUDIO_LICENSES.md`).
- **Recording studio**: input selection, metering, monitoring with feedback warnings,
  count-in, punch in/out, loop recording, take lanes with comping, latency calibration,
  dry-take preservation, 11 vocal chain presets (Clean Rap → Podcast Voice).
- **Audio editor**: waveform view, non-destructive trim/crop, split, equal-slice,
  transient slice, normalize, gain, fades, reverse, pitch, stretch, BPM/key estimate,
  send slices to Drum Rack / Sampler / Playlist.
- **AI (optional)**: structured composition, validated edit plans with preview and
  undo, lyrics, mix suggestions, audio analysis, generated-audio jobs with progress —
  through 10 provider adapters (Anthropic, OpenAI, Gemini, OpenRouter,
  OpenAI-compatible, Ollama, ElevenLabs, generic sync/async audio REST, manual import).
  See `AI_PROVIDER_GUIDE.md`.
- **Sound packs**: Resource Hub with curated royalty-free sources, ZIP/folder importer
  with path-traversal protection, BPM estimation, tagging, favorites.
  See `SAMPLE_PACK_GUIDE.md`.

## Keyboard shortcuts

Space play/pause · ⌘Z undo · ⌘⇧Z redo · ⌘S save · R record tab · M metronome ·
⌘A select all · ⌘D duplicate · Delete remove · P pencil · B select tool ·
⌘K command palette · +/− zoom · arrows nudge (⇧↑/⇧↓ octave) · Esc cancel.
Shortcuts never fire while you're typing in a text field.

## iPhone / iPad

The UI adapts below 760 px (stacked transport, larger touch targets, hidden side
panels) and audio unlocks on first tap. To open the studio from a phone on your
network: `PF_HOST=0.0.0.0 npm run start`, then visit `http://<your-mac-ip>:7800`.
Note: microphone recording requires a secure context (HTTPS or localhost), so
record on the Mac or behind a HTTPS tunnel. See `TROUBLESHOOTING.md`.

## Documentation

`ARCHITECTURE.md` · `ACCEPTANCE_MATRIX.md` · `VERIFICATION_REPORT.md` ·
`AI_PROVIDER_GUIDE.md` · `AI_API_REFERENCE.md` · `SAMPLE_PACK_GUIDE.md` ·
`BUNDLED_AUDIO_LICENSES.md` · `AI_OS_INTEGRATION_GUIDE.md` · `XCODE_WRAPPER_GUIDE.md` ·
`SECURITY.md` · `TROUBLESHOOTING.md` · `WORKLOG.md`
