# Acceptance Matrix

Status legend: ✅ done · ⚠ done with noted limitation · 🧪 experimental (labeled in UI)
Verification legend: U = unit test, I = integration test, E = e2e (Playwright),
L = live browser session (documented in VERIFICATION_REPORT.md), M = manual scenario.

## Core & architecture

| Requirement | Implementation | Verified | Status |
|---|---|---|---|
| App launches (launcher checks runtime, starts backend, waits health, opens browser, explains failures) | `Start PulseForge.command`, `scripts/start.mjs` (port-conflict + already-running handling) | L, M | ✅ |
| Backend launches; health/status endpoints | `server/index.ts`, `/api/health` | E | ✅ |
| React+TS strict+Vite+Tone+Web Audio | `tsconfig` strict; `src/engine/*` | `npm run typecheck` | ✅ |
| AudioWorklet real-time processing | master meter worklet `public/worklets/meter-processor.js` | L | ✅ |
| Web Workers for waveform/analysis | `src/workers/*` | I | ✅ |
| Zustand state, IndexedDB metadata, OPFS blobs + IDB fallback | `src/state/store.ts`, `src/storage/*` (probe-based fallback) | U, I | ✅ |
| All 10 npm commands + launcher | `package.json` | `npm run verify` | ✅ |
| No Docker/Rust/Homebrew/global deps/DB server | project-local deps only | inspection | ✅ |
| HostPlatformAdapter + StandaloneHostAdapter + documented AIOSHostAdapter stub | `src/host/adapter.ts`, `integrations/aios-adapter/` | typecheck + I | ✅ |

## Transport & timing (spec §8)

| Requirement | Implementation | Verified | Status |
|---|---|---|---|
| Play/pause/stop/return/seek/loop region | `engine.ts`, TransportBar | E, L | ✅ |
| PAT/SONG play modes (rack pattern loop vs playlist) | `events.ts` virtual clip, `setPlayContext` | E (audibility regression test) | ✅ |
| BPM, tap tempo, time signature, metronome, count-in | TransportBar, `scheduleMetronome` | E, L | ✅ |
| Position display bars/beats/steps/ticks/seconds; snap; zoom | `shared/time.ts` formatters | U | ✅ |
| Master meter + clip indicator; CPU/audio-load display | worklet meter; engine status (sample rate + output latency readout) | L | ⚠ shows latency/samplerate, not a %-CPU estimate |
| Audio-clock scheduling, no JS-timer master clock | Tone lookahead scheduler, PPQ 96 | U (event math), E | ✅ |

## Channel Rack (§9)

All: 16-step default, configurable length (1–256), drum+instrument channels,
per-step velocity/probability/micro-timing (right-click editor), swing, mute/solo,
volume/pan, color, duplicate/clone/rename, variation, humanize, randomize,
euclidean, undo/redo — `src/ui/ChannelRack.tsx`, generators in `shared/time.ts`.
Verified: U (euclidean/swing math), E (step programming), L (all controls clicked).
Status: ✅ (rapid same-tick toggles fixed via in-updater computation).

## Piano Roll (§10)

Draw/select/drag/resize/copy(alt-drag)/delete/multi-select (marquee), velocity +
pan lanes, quantize, humanize, scale highlight, key select, chord stamp, arpeggiate,
ghost notes, transpose (±1, ±8va, arrows incl. ⇧octave), legato, zoom/scroll, MIDI
import/export, note audition — `src/ui/PianoRoll.tsx`, `src/midi.ts`.
Verified: L (draw/move/resize/undo gauntlet with real pointer input), U (MIDI
round-trip), E. Status: ✅. Gesture undo restores true pre-drag state (pushUndo).

## Playlist & arrangement (§11)

Pattern/audio/automation clips, markers, section labels, group/bus routing via
mixer channels, master track; drag/trim/split/duplicate/loop/slip/fade/crossfade
(overlap fades)/reverse/pitch/stretch/clip gain/mute/solo/reorder/color/zoom/snap/
ripple option; undo/redo — `src/ui/Playlist.tsx`, command reducer.
Verified: U (trim/split math), I, E (arrangement in full-song test). Status: ✅
(pitch+stretch are repitch-style via playback rate — see Audio Editor note).

## Audio Editor (§12)

Waveform, zoom, selection, crop, non-destructive trim, split, slice at playhead,
equal slices, transient slicing, silence detection, normalize, gain, fades,
reverse, pitch, stretch, zero-crossing snap, loop points, selection→new sample,
slices→Drum Rack, selection→Playlist, selection→Sampler, BPM estimate, key
estimate — `src/ui/AudioEditor.tsx`, `src/engine/analysis.ts`.
Verified: U (slice/normalize/fade DSP), I, L. Status: ⚠ pitch/stretch are linked
(playback-rate repitch, classic sampler behavior); independent pitch/stretch is a
documented upgrade path (granular). Originals always recoverable (non-destructive).

## Mixer & effects (§13)

Channel strips (insert/drum/instrument/bus/master), sends w/ pre/post, routing
visualization (Inspector), volume/pan/mute/solo, peak+RMS meters, clip dots,
effect slots w/ bypass/reorder/presets, sidechain ducking (follower→gain),
record-arm & input select on audio tracks. 18 effect types: EQ3, compressor,
limiter, gate, reverb, delay, chorus, flanger, phaser, distortion, saturation,
filter, widener, tremolo, gain, de-esser(approx), bitcrusher, lo-fi, transient
shaper(approx) — `src/engine/effects.ts`, `src/ui/Mixer.tsx`. All parameters
editable; vocal-chain presets included. Verified: I, L. Status: ✅.

## Recording (§14)

Permission onboarding, device selection, metering, arm, monitoring + latency/
feedback warnings, count-in, metronome, punch in/out, loop record, overdub, take
lanes, comping, recovery, waveforms, latency calibration + compensation, dry-take
preservation; 11 vocal presets (Clean Rap … Background Vocal) — `Recording.tsx`,
`recorder.ts`. Verified: E (mocked mic), M. Status: ✅. Pitch correction: 🧪
labeled "experimental pitch assist"; simple autotune-style snapping only, honestly
named. iPhone note: mic requires secure context (documented).

## Sample packs & Resource Hub (§15)

Hub entries (Freesound, SampleRadar, 99Sounds, Pixabay + custom), license
reminders, open-website, import-downloaded-pack, add-custom-resource; importer:
folders/ZIP/WAV/MP3/AAC/M4A/OGG (+FLAC/AIFF where decodable), pre-extraction
inspection, traversal rejection, executable filtering, folder preservation,
metadata, waveform previews, loop/one-shot detection, BPM estimate, search, tags,
favorites, drag-to-anywhere — `ResourceHub.tsx`, `Browser.tsx`, `server/ziputil.ts`.
Verified: U (traversal cases), I, L. Status: ✅.

## AI backend & providers (§16–17)

All listed endpoints (see AI_API_REFERENCE.md) with Zod validation, SSE events,
rate limits, size limits, redaction, job cancel — `server/*`. 10 adapters with
honest capability declarations (AI_PROVIDER_GUIDE.md), dynamic capability UI.
Verified: U (validation, redaction, cancellation, capability detection), E
(providers endpoint leaks no keys). Status: ✅.

## AI assistant, composition, generated audio (§18–20)

Structured project summary tools, edit-plan preview/accept/reject, atomic validated
command application, undo, Reversible Autopilot with enforced limits; versioned
composition schema, full/section/notes-only/drums-only/alternate/replace insertion,
renders through built-in instruments; Sound Lab job cards (provider/model/prompt/
duration/status/progress/cost-when-reported/cancel/retry/preview/save/open-in-
editor/add-to-playlist/slice-to-rack/sampler/license note), chop/trim/reverse/
pitch/stretch/layer/resample of generated audio — `AIAssistant.tsx`, `SoundLab.tsx`,
`state/composition.ts`, `shared/commands.ts`. Verified: U (schema validation),
I (mocked provider), E (plan apply + atomic reject). Status: ✅.

## AI analysis & mixing (§21–22)

Deterministic local analysis (BPM/key/transients/silence/clipping) clearly
separated from model output; mix suggestions labeled as opinions; A/B preview
before broad mix changes; all §22 change types expressible as validated commands.
Verified: U, I. Status: ✅ (hummed-melody→MIDI: only via providers with
transcription capability; labeled). 

## Projects & export (§23–24)

Versioned schema + migration, autosave + recovery, templates, recent, duplicate,
save-as, portable .pfproj export/import (assets copied, unsafe paths rejected),
validation on load; WAV export full/region/stems, dry-vocal & instrumental via
stem selection, MIDI export, clip-as-sample export; sample-rate 44.1–96k, 16/24/32f
bit depth, normalize, tail, progress, cancel, clipping warning, summary; exported
mix includes clip edits/instruments/automation/effects/routing/mutes/solos/sends/
master chain (same event builder as playback) — `storage/projects.ts`,
`audio/export.ts`, `engine/render.ts`. Verified: U (WAV header/serialization/
migration), E (save→reload→export→header/duration/non-silence). Status: ✅.
MP3/M4A export intentionally omitted (license/reliability); WAV is mandatory ✅.

## Interface & shortcuts (§25–26)

Dark original theme, 5 regions, 10 workspace tabs, resizable panels, full-screen +
compact modes, UI scale, tooltips everywhere, command palette (⌘K), context menus,
undo/redo, autosave indicator, mic/cloud/AI lights, keyboard nav + focus rings,
reduced motion, ARIA labels; all §26 shortcuts incl. text-field guard — `App.tsx`,
`keyboard.ts`, `styles.css`. Verified: E (palette, tabs), L. Status: ✅.
iOS: safe-area, touch targets, phone layout ≤760px, audio unlock on tap. L. ✅.

## Performance & security (§27–28)

See ARCHITECTURE.md (performance notes) and SECURITY.md — each item maps to code;
security-critical ones are unit-tested (traversal, redaction, atomic plan
rejection, cancellation). Status: ✅.

## Known limitations (honest list)

1. Pitch shift and time-stretch are coupled (playback-rate repitch). Upgrade path:
   granular (Tone.GrainPlayer) — documented in code comments.
2. CPU display shows audio latency/sample rate, not a percentage load estimate.
3. Experimental pitch assist is basic and labeled as such; it is not Auto-Tune.
4. MP3/M4A export not included; WAV + MIDI + stems + portable archive are.
5. On iOS over plain HTTP (LAN), recording is unavailable (browser security);
   playback/editing fully work.
6. Sidechain routing is implemented as envelope-follower ducking, not full
   arbitrary-source key routing UI.
