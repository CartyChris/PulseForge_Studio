# PulseForge Studio — Architecture

## Overview

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  React 18 + TypeScript (strict) + Vite            Zustand store     │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────────┐ │
│  │ UI views │→│ commands  │→│  store   │→│  engine (Tone.js)      │ │
│  │ (10 tabs)│ │ (Zod-     │ │ undo/redo│ │  transport·graph·      │ │
│  └──────────┘ │ validated)│ │ autosave │ │  instruments·effects   │ │
│               └───────────┘ └────┬─────┘ │  AudioWorklet meter    │ │
│                                  │       └───────────┬────────────┘ │
│               ┌──────────────────┴───┐   ┌───────────┴────────────┐ │
│               │ storage: IndexedDB   │   │ offline render         │ │
│               │ meta + OPFS blobs    │   │ (same event builder)   │ │
│               │ (IDB fallback)       │   │ → WAV encode           │ │
│               └──────────────────────┘   └────────────────────────┘ │
│         Web Workers: waveform peaks · transient/BPM analysis        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ /api (fetch + SSE)  — no keys in FE
┌───────────────────────────────┴─────────────────────────────────────┐
│  Fastify backend (Node 20+, TypeScript, tsx)                        │
│  routes (Zod-validated) · provider adapters (10) · job manager      │
│  SSE events · secrets store (chmod 600) · ZIP inspect/extract       │
│  rate limiting · size limits · secret redaction                     │
│  Production: also serves dist/ so one process runs everything       │
└─────────────────────────────────────────────────────────────────────┘
```

## Source layout

```
shared/     schemas + pure logic used by BOTH frontend and backend
  project.ts       versioned project schema (Zod), migrations, factories
  time.ts          PPQ=96 musical time, bars/beats/steps/ticks/seconds,
                   snapping, swing, euclidean patterns, scales/chords
  commands.ts      DAW command schema (AI edit plans) — the ONLY way AI
                   mutates a project
  composition.ts   versioned AI composition schema + validation
  wav.ts           WAV encode/decode + peak analysis (pure, node-testable)
src/
  engine/          Tone.js audio engine
    engine.ts      singleton: context, transport sync, PAT/SONG play modes,
                   metering worklet, asset buffers
    graph.ts       project → live audio graph (mixer strips, sends, ducking,
                   instruments, drum players); event scheduling on transport
    events.ts      project → flat tick-stamped event lists (shared by live
                   playback AND offline export — what you hear is what renders)
    render.ts      Tone.Offline render → Float32 channels → WAV
    instruments.ts 8 synth engines + 35+ presets
    kits.ts        4 drum kits, 18 roles each, synthesized via dsp.ts
    dsp.ts         pure Float32 synthesis (kicks, snares, hats, risers…)
    sampler.ts     SamplerInstrument: ADSR, filter, loop, portamento, reverse
    effects.ts     18 effect types + vocal chain presets (Tone nodes)
    recorder.ts    getUserMedia recording, takes, latency compensation
    analysis.ts    transient/BPM/key/silence detection (worker-backed)
  state/
    store.ts       Zustand: project + selection + UI, undo/redo, autosave
    commands.ts    command reducer (validated, atomic, undoable)
    composition.ts AI composition → project insertion
  storage/
    db.ts          IndexedDB wrapper
    blobs.ts       OPFS blob store with IndexedDB fallback (probe-verified)
    projects.ts    save/load/recovery/templates/portable .pfproj (fflate)
  ui/              React views (TransportBar, ChannelRack, PianoRoll,
                   Playlist, Mixer, AudioEditor, Recording, AIAssistant,
                   SoundLab, ResourceHub, InstrumentEditor, Browser,
                   Inspector, CommandPalette, ProjectMenu)
  host/adapter.ts  HostPlatformAdapter interface + StandaloneHostAdapter
  workers/         waveform/analysis web workers
server/
  index.ts         Fastify bootstrap (serves dist/ in production)
  routes.ts        all /api endpoints, Zod request/response validation
  providers.ts     10 AI provider adapters (capability-based)
  jobs.ts          generation job manager + SSE fanout + cancellation
  secrets.ts       key storage (~/.pulseforge/secrets.json, chmod 600),
                   env-var loading, log redaction
  ziputil.ts       ZIP inspection/extraction with traversal rejection
  prompts.ts       system prompts for compose/edit/lyrics/mix/analysis
integrations/aios-adapter/   documented AIOSHostAdapter stub (see
                   AI_OS_INTEGRATION_GUIDE.md)
e2e/               Playwright suite (full-song lifecycle, audibility
                   regression, mocked mic, AI plan apply/reject)
```

## Key decisions

- **One shared event builder.** `events.ts` expands clips/patterns into tick-stamped
  events for both live playback and offline export. The WAV you export is scheduled
  by exactly the code you monitored.
- **PAT/SONG play modes.** Pattern mode schedules the active rack pattern as a
  virtual looping clip; song mode plays the playlist. FL-style workflow, one code path.
- **Audio clock only.** All musical timing runs on Tone's lookahead scheduler over
  the Web Audio clock (PPQ 96). JS timers only debounce UI-triggered reschedules.
- **Engine settings idempotence.** `engine.init()` re-applies the current project
  after context creation and `play()` re-syncs every time — transport settings can
  never be lost to init-ordering races (this was the launch-day bug; see WORKLOG).
- **Commands, not code.** AI edits arrive as Zod-validated `DawCommand[]`; the
  reducer applies them atomically (all-or-nothing) and undoably. No eval, ever.
- **Playhead outside React.** A dedicated `usePlayhead` store updates from a rAF
  loop; heavy views subscribe at quantized resolutions (e.g. per-16th) so the
  Playlist never re-renders per tick.
- **Non-destructive audio.** Clip edits are parameter changes (offset/fades/reverse/
  pitch/stretch); slicing creates new assets; originals stay in blob storage.
- **Secrets never reach the frontend.** The browser talks only to `/api`; provider
  keys live in env vars or a chmod-600 JSON store; logs pass through a redactor.

## Data flow: a note from click to sound

1. PianoRoll pointer handler → `setNotes` → store `update()` (undo snapshot).
2. Store calls `engine.applyProject(next)`; a structural signature decides whether
   the graph rebuilds; if playing, a 150 ms debounced reschedule refreshes events.
3. `scheduleAll()` → `buildEventList(project, {patternId?})` → `scheduleEvents`
   registers transport callbacks at `${tick}i`.
4. Callback fires on the audio clock → instrument/drum player `triggerAttackRelease`
   → channel gain/pan → mixer strip (effects → volume → pan → post) → sends/master
   → master tap → destination + AudioWorklet meter.

## Performance notes (targeting M4 Pro, but frugal everywhere)

Cached drum buffers; pooled per-voice nodes with disposal on `onended`;
worker-side waveform peaks with LRU cache; virtualized long lists; bounded undo
(80 snapshots); object-URL lifecycle tracking; cancellable analysis and AI jobs;
`content-visibility` on heavy panels; quantized playhead subscriptions.
