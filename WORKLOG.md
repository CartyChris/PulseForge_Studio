# PulseForge Studio — Worklog

Living log of decisions, stages, and verification. Newest entries appended per stage.

## Repository inspection (2026-07-19)

`All Finished Apps/` was empty (only `.claude/settings.local.json`). No reusable
components, audio utilities, backend services, or provider code existed. Everything
below is built from scratch.

Subagent note: the spec recommends delegating to specialized subagents. This build is
executed inline in one session for coherence — a DAW's engine, schema, and UI are too
tightly coupled for cold-context agents to build pieces independently without expensive
re-derivation. The stage map below plays the role of the specialist split.

## Stage map

| # | Stage | Expected checkable output |
|---|-------|---------------------------|
| S0 | Scaffold: package.json, tsconfigs (strict), eslint, vite, vitest, playwright, scripts, launcher | `npm install` + `npm run typecheck` pass |
| S1 | Shared core: musical time, project schema v1 (Zod), note schema, AI command schema, composition schema, migrations | unit tests green |
| S2 | Audio engine: Tone.js transport (audio-clock), synthesized drum kits, sampler, subtractive/FM/pad/pluck synths, piano/EP/bass presets, 19 effects, pattern & clip scheduling, metronome, offline render + WAV encode | WAV encoder + scheduling unit tests green; live render verified in e2e |
| S3 | Storage: IndexedDB metadata, OPFS blobs w/ IDB fallback, save/load/save-as/recent/duplicate/templates/autosave, portable archive | vitest (fake-indexeddb) green |
| S4 | Backend: Fastify + Zod, health/providers/ai/jobs/assets/SSE, 10 provider adapters, secrets, redaction, rate-limit, zip safety | node unit tests incl. traversal + redaction green |
| S5 | Frontend: shell, transport bar, Channel Rack, Piano Roll, Playlist, Mixer, Audio Editor, browser, inspector, undo/redo, shortcuts, palette | typecheck + manual smoke + e2e |
| S6 | Recording: input select, metering, count-in, punch, loop record, takes, comping, latency cal, 11 vocal presets | mocked-mic e2e |
| S7 | AI: Production Assistant (edit-plan flow + Reversible Autopilot), Sound Lab jobs, Resource Hub + pack importer, host adapter | integration tests w/ mocked provider |
| S8 | Export: WAV master/stems/region (rate/depth/normalize/tail), MIDI import/export, portable project | e2e verifies WAV header, duration, non-silence |
| S9 | Tests + launcher + verify chain | `npm run verify` green |
| S10 | Docs (13 files), TODO sweep, skeptical review, manual acceptance scenario | VERIFICATION_REPORT.md complete |

## Key decisions

- **Single npm package.** No workspaces; `src/` frontend, `server/` backend (run via
  project-local `tsx`), `shared/` isomorphic schemas. Two tsconfigs (DOM vs node).
- **One production process.** The Fastify backend serves `dist/` statically, so
  `Start PulseForge.command` starts exactly one server. Dev mode runs Vite + backend
  with an `/api` proxy.
- **Tone.js is the audio substrate.** Tone.Transport is the audio-clock master
  (lookahead scheduler on AudioContext time — not JS timers). Tone instruments/effects
  are wrapped behind our own typed instrument/effect registry so the project format
  never references Tone types directly.
- **All bundled sounds are synthesized programmatically** at runtime (documented in
  BUNDLED_AUDIO_LICENSES.md) — zero licensing ambiguity, zero download.
- **Offline export** uses Tone.Offline with the same scheduling code as live playback.
- **Ports:** 7800 frontend/static, 7801 API (dev), e2e uses 7802/7803.
- **Secrets:** env vars take precedence; otherwise `~/.pulseforge/secrets.json`
  (chmod 600). Never sent to or bundled in the frontend.
- **AI edits** are Zod-validated commands dispatched through the same undoable command
  bus the UI uses. No eval, no arbitrary code.

## Stage log

- **S0 done (2026-07-19):** scaffold + scripts + launcher written; `npm install`,
  `typecheck`, `lint` pass (verified below in stage entries).

## 2026-07-19 — Launch-failure investigation (user report: "does not launch or work")
Verified server boot, health, static serving all fine; failure was runtime-audio, found via live browser probes:
1. **Silent playback (P0)** — `buildEventList` only expanded Playlist clips; a fresh project has an empty
   Playlist, so Channel Rack playback was pure silence. Fix: FL-style PAT/SONG play modes; pattern mode
   schedules the active rack pattern as a virtual looping clip (engine.setPlayContext + transport loop).
2. **Transport settings dropped (P0, the deep one)** — App mount calls engine.init() async; applyProject()
   calls made before init early-returned, so BPM/loop never reached the transport (played at default 120,
   no loop, events one-shot). Fix: init() re-applies this.project once initialized; play() always re-syncs.
   Diagnosed by dumping Tone transport internals live (PPQ 96 ✓ ours, bpm 120 ✗ default).
3. **Master meter dead** — (a) native AudioWorkletNode constructor rejects Tone's standardized-audio-context;
   use toneCtx.addAudioWorkletModule/createAudioWorkletNode. (b) a worklet with an unconnected output is
   never pulled by the graph; routed through Gain(0) → destination. Clip latch now resettable via port msg.
4. **Stale-closure step toggling** — rapid same-tick step clicks overwrote each other; compute next steps
   inside the store updater.
Verification (real click path): peak 0.451, meter 86%, bpm 90, loop on, onsets on the 8th-note grid.

## 2026-07-19 (later) — FL parity, iOS, docs, final verification
- Piano Roll: fixed gesture undo (pushUndo records true pre-drag state), widened
  resize grab zone (6px → ≤12px adaptive), alt-drag clone, hover cursors, pan lane
  alongside velocity, arrow-key nudge/⇧octave, P/B tool keys, ⌘D note duplicate,
  default zoom 0.5→1.5 px/tick, auto-scroll to musical center. Verified live with
  real pointer input (draw → move → resize → undo → redo).
- iOS/iPhone: viewport-fit=cover + PWA metas + 100dvh; safe-area insets;
  touch-action rules (manipulation on controls, none on gesture canvases);
  ≤760px phone layout + coarse-pointer sizing; audio unlock re-attempted on every
  sound-producing entry point (init-outside-gesture no longer bricks audio);
  PF_HOST=0.0.0.0 LAN mode with loud secure-context warning. Verified at 375×812.
- Launcher: detects an already-running PulseForge (opens it) vs a foreign port
  owner (clear PF_PORT advice).
- e2e: added pattern-mode audibility regression test (real button, analyser
  threshold, BPM + loop assertions). Suite now 7 tests.
- Docs: all 13 deliverables written. Skeptical sweep: no TODO/FIXME markers, no
  mocks outside tests, no key patterns in dist, secrets 0600.
- FINAL: npm run verify green — lint ✓ typecheck ✓ 88/88 unit ✓ build ✓ 7/7 e2e ✓.

## Post-V1 feature round 2 (2026-07-20)
- Granular pitch/time-stretch: audio clips with stretch≠1 now use Tone.GrainPlayer (rate=1/stretch, detune=pitch·100¢) — pitch and stretch fully independent; stretch=1 keeps the cheaper repitch buffer-source path.
- Experimental hum-to-MIDI: `extractMelody()` in engine/analysis.ts (autocorrelation 80–800 Hz, octave-error guard, RMS gate); "♪ To MIDI ⚗" button in Audio Editor creates a synth channel + pattern. Unit test (3-note sine) + live browser test (transcribed 69/72/76 exactly).
- Project Notes: `notes` field in project schema (defaulted, no migration needed), editable in Inspector, travels with portable export.
- Mix suggestions now require a one-line "why:" rationale per suggestion (server/prompts.ts).
- SKIPPED (need external models/infra, documented for handoff): stem separation, live collaboration.
- Verify: typecheck ✓ lint ✓ 90/90 tests ✓ build ✓ live smoke ✓

## PulseTune (autotune) + Settings round (2026-07-20)
- PulseTune experimental pitch correction: pitchCorrect() DSP in engine/analysis.ts
  (autocorrelation f0 → snap-to-scale → period-synchronous variable-rate retune, crossfaded).
  Honestly labeled — not professional Auto-Tune. Non-destructive (always a new asset).
  UI: card in Recording tab + modal in Audio Editor. Presets: Natural/Tight/Hard-Tune.
  Controls: key, scale, retune speed (0=hard), strength, humanize. 3 unit tests.
- AI can drive autotune: new "pulseTune" validated command (schema + reducer no-op + prompt doc);
  assistant applyPlanWithAudio() runs the async DSP before dispatching the rest of a plan
  (works in preview-approve AND autopilot). applyPulseTune exposed on window.__pulseforge.
- Recording enhancements: auto-trim silence (50ms pad) + auto-normalize toggles → clean asset,
  dry original ALWAYS preserved; clip start shifts to compensate for trimmed head.
- Settings modal (⚙ in topbar): accent color (6 presets + custom picker → --ember CSS var),
  interface scale, reduced motion. Persists to localStorage, restored on load via initUiPrefs().
- Verify: typecheck ✓ lint ✓ 93/93 tests ✓ build ✓ live smoke ✓ (PulseTune 429→438Hz end-to-end,
  Settings accent applied + persisted).

## Stem Extractor round (2026-07-20)
- Stem Extractor (FL-style, AI-powered): split any project asset into vocals/drums/bass/other.
  Backend: POST /api/ai/separate-stems → tracked job; new Replicate provider adapter
  (real public API: /v1/predictions with a user-configured stem-separation model version,
  e.g. a Demucs build — no invented endpoints, model hash pasted from replicate.com).
  Per-stem results saved as backend assets on the job (job.stems map), SSE progress.
- Frontend: StemExtractor panel in Sound Lab + "Stems ✂" modal in Audio Editor.
  Explicit upload-consent checkbox (audio leaves the machine — spec's cloud-disclosure rule),
  live job card w/ cancel, then "Import Stems into Project": each stem becomes a project
  asset and (optionally) lands on its own color-coded Playlist track.
- Server tests: rejects non-stem providers; mocked-replicate job completes with 4 stems,
  each downloadable via /api/assets/:id.

## Feature round 3 — effects, note tools, pattern generators (2026-07-21)
- **7 new mixer effects** (26 total): Multiband Compressor, Auto-Pan, Ping-Pong Delay,
  Auto-Wah, Pitch Shifter, Vibrato, Ring Mod / Frequency Shifter. All real Tone nodes with
  editable params; added to EffectTypeSchema so they save/load and are AI-addressable.
- **11 new Piano Roll note tools** (shared/notetools.ts, pure + unit-tested): Strum, Flam,
  Roll (note repeat), Velocity ramp up/down, Snap-to-Key, Harmonize, Invert, Reverse
  (retrograde), Staccato, Fix Overlaps. Operate on selection, or all notes when none selected.
- **7 new Channel Rack generators** (shared/patterntools.ts, pure + unit-tested): end-of-bar
  Fill, Ghost notes, Polyrhythm, Accent, Thin, Reverse, Shift ±1 step. Seeded PRNG so
  generated patterns are reproducible.
- Debug/host surface now exposes EFFECT_DEFS, INSTRUMENT_PRESETS, DRUM_KITS, notetools,
  patterntools on window.__pulseforge (useful for the future AI OS adapter).
- **Two real bugs caught by live browser verification** (node can't instantiate Tone nodes):
  1. PRE-EXISTING: Delay's `time` param max (1.5s) exceeded Tone.FeedbackDelay's default
     1s maxDelay — dragging the slider past 1s threw a RangeError. Fixed via maxDelay: 2.
  2. New Auto-Wah set baseFrequency/sensitivity as if they were signals; they're plain
     properties on Tone.AutoWah. Fixed.
- Verify: typecheck ✓ lint ✓ 125/125 tests (13 files) ✓ build ✓
  live: 26/26 effects instantiate + survive every param at min/max/default ✓
  live: Strum spreads a chord to 0/12/24 ticks, Roll multiplies notes, Vel↗ ramps,
  Snap/Harmonize/Reverse all fire, 7/7 rack generators present, Fill mutates steps ✓
