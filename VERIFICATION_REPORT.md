# Verification Report

Date: 2026-07-19 · Machine: Apple Silicon MacBook Pro (macOS 27.0, Darwin 27.0.0) ·
Node v22.23.1 · Browser: Chromium (in-app pane + headless Playwright)

## Command results (final run, after last code change)

| Command | Result |
|---|---|
| `npm run lint` | ✅ 0 problems |
| `npm run typecheck` | ✅ frontend + backend, strict, 0 errors |
| `npm run test` | ✅ 8 files, **88/88 tests** |
| `npm run build` | ✅ production bundle (≈738 kB js, ≈208 kB gzip) |
| `npm run test:e2e` | ✅ **7/7 Playwright tests** (12.1s) |
| `npm run verify` | ✅ full chain green (lint → typecheck → test → build → e2e) |

## E2E coverage (each test in `e2e/studio.spec.ts`)

1. **Backend health & providers** — health ok; 10 providers listed; response
   asserted to contain no key material.
2. **UI smoke** — step programming via real clicks, transport advances on the audio
   clock, stop resets, all 10 workspace tabs render, ⌘K palette opens.
3. **Pattern-mode audibility (regression)** — fresh rack beat + real play button →
   analyser at the master tap must exceed peak 0.05 within 2.5s, transport must be
   at project BPM with loop on. Guards the two launch-day P0 bugs (see WORKLOG).
4. **Full song lifecycle** — built-in drums + bass + keys + mocked vocal + imported
   sample + mocked structured AI composition + mocked AI audio asset → save →
   reload → all tracks/assets verified → offline WAV export → RIFF header parsed,
   duration > 0, decoded samples non-silent.
5. **Recording** — mocked microphone (Playwright fake device) → armed take captured,
   waveform generated, take placed.
6. **AI edit plan** — validated commands apply atomically and are undoable.
7. **Invalid AI plan** — malformed command list rejected with zero partial state.

## Live browser verification (documented session)

Performed in the in-app browser against the production build (`npm run start`):

- Real-click play on a freshly-programmed Modern Hip-Hop beat: audible (master
  analyser peak 0.451), master VU meter animating (86%), BPM 90 honored, transport
  looping, hat onsets measured on the 8th-note grid (~0.333s at 90 BPM).
- Channel Rack: step toggles (incl. rapid bursts), right-click step editor
  (velocity/probability/micro), swing, euclidean/randomize/humanize/variation,
  mute/solo, add-channel dialog (4 kits + 35 presets), pattern clone/rename/length.
- Piano Roll gauntlet with real pointer input on the 808 Bass preset: pencil draw
  (snapped, auditioned), body-drag move (+1 beat, pitch change), tail-drag resize
  (48→96 ticks), ⌘Z restored exact pre-gesture state with redo available; velocity
  and pan lanes; hover cursors (grab / ew-resize).
- Autosave recovery: beat survived reload; recovery toast shown when autosave was
  newer than the last save.
- Launcher: `Start PulseForge.command` path verified; port-conflict handling
  ("already running → open it" / "another app owns the port" message) tested.
- iPhone-width (375×812) session: stacked transport, ≥34px touch targets, side
  panels hidden; step tap registered and playback audible (peak 0.533).

## Manual acceptance scenario (§30) — status per step

| # | Step | How verified |
|---|---|---|
| 1 | Launch via `Start PulseForge.command` | live (launcher + health + browser open) |
| 2 | New project at 90 BPM | live (Hip-Hop Session template, 90 BPM) |
| 3 | Modern Hip-Hop kit | live |
| 4 | Program a four-bar beat | live (16-step pattern; 64-step/4-bar length verified via Length control) + e2e arrangement |
| 5–6 | 808 Bass + bassline | live (preset added, notes drawn/edited in Piano Roll) |
| 7–8 | Piano + chords/melody | e2e full-song (keys track with chords) + live chord-stamp control |
| 9 | Intro/verse/chorus/outro arrangement | e2e full-song (section markers + clips) |
| 10–12 | Import sample, slice ≥4, rearrange | e2e full-song (programmatic import → slice → placement) + live importer UI |
| 13–14 | Record/simulate rap vocal + Clean Rap preset | e2e mocked-mic recording; Clean Rap chain applied via preset (live UI) |
| 15–17 | Mocked AI provider → alternate chorus → accept as new section | e2e (structured composition through mocked provider, inserted as section) |
| 18–19 | Import mocked AI sound, chop & layer | e2e (mocked generated asset → slice → layered placement) |
| 20–23 | Save, restart, reopen, verify | e2e (save → full reload → tracks/assets/arrangement asserted) + live autosave recovery |
| 24–25 | Export WAV, verify audible | e2e (header/duration/non-silence on decoded samples) + live export dialog |

## Security spot-checks

- `grep` of built bundle for key patterns (`sk-…`, `api_key=…`): **no matches**.
- Providers endpoint payload: booleans only, no key material (asserted in e2e).
- Secrets file written `0o600` inside `0o700` dir; log redaction unit-tested.
- ZIP traversal fixtures rejected (unit tests); invalid AI plans atomic-rejected (e2e).
- No `TODO`/`FIXME`/`unimplemented` markers in production code; the only "mock"
  references in the repo live in test files.

## Known limitations at sign-off

Listed in `ACCEPTANCE_MATRIX.md` (§Known limitations): repitch-style pitch/stretch
coupling, latency/samplerate readout instead of %-CPU, labeled experimental pitch
assist, no MP3/M4A export, no mic on plain-HTTP LAN clients, ducking-style sidechain.
