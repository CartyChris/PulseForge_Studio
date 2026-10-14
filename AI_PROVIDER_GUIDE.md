# AI Provider Guide

PulseForge works fully without AI. When you want it, connect a provider in
**AI Assistant → Providers**. Keys are sent once to the local backend and stored in
`~/.pulseforge/secrets.json` (chmod 600) or read from environment variables — they
never appear in frontend code, bundles, or logs.

## Environment variables (alternative to the UI)

```
PF_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY
PF_OPENAI_API_KEY    / OPENAI_API_KEY
PF_GEMINI_API_KEY    / GEMINI_API_KEY
PF_OPENROUTER_API_KEY
PF_ELEVENLABS_API_KEY
PF_OPENAI_COMPATIBLE_API_KEY   (+ base URL via provider config)
PF_GENERIC_AUDIO_SYNC_API_KEY / PF_GENERIC_AUDIO_ASYNC_API_KEY
```

## Implemented adapters and their real capabilities

| Provider | Kind | Capabilities implemented |
|---|---|---|
| **Anthropic** | text | composition, lyrics, project-analysis, edit plans, mix suggestions |
| **OpenAI** | text+audio-in | composition, lyrics, project-analysis, audio-analysis, transcription |
| **Google Gemini** | text+audio-in | composition, lyrics, project-analysis, audio-analysis |
| **OpenRouter** | text | composition, lyrics, project-analysis (any hosted model) |
| **OpenAI-compatible** | text | composition, lyrics, project-analysis (set base URL, e.g. LM Studio, vLLM) |
| **Ollama** | local text | composition, lyrics, project-analysis — fully local, no key |
| **ElevenLabs** | audio out | text-to-sound (sound effects API), text-to-speech |
| **Generic audio (sync)** | audio out | text-to-sound/music via a single POST that returns audio bytes |
| **Generic audio (async)** | audio out | job-based generation: start → poll status URL → fetch result |
| **Manual import** | none | for services without a public API: generate elsewhere, import the file; PulseForge tracks prompt/source/license metadata |

Capabilities are declared per adapter and the UI renders only what the selected
provider actually supports. No endpoint is invented: the generic adapters exist
precisely so you can wire services we can't hard-code, by entering their documented
URL, auth header, and field mapping in the provider config.

## What each AI feature does

- **Compose** — the model returns a versioned structured composition (sections,
  chords, drum patterns, basslines, melodies, mixer hints, lyrics). It is validated
  (Zod) before anything touches your project, then previewed; you insert all of it,
  selected sections, only notes, only drums, as an alternate arrangement, or replace
  a selected pattern. Compositions render through built-in instruments — no audio
  provider needed.
- **Edit plans** — natural-language request → list of validated DAW commands with a
  readable preview. Accept applies atomically and undoably; reject discards.
  **Reversible Autopilot** (opt-in toggle) lets plans apply automatically, but never:
  delete source audio, spend money without confirmation, upload audio without
  disclosure, or touch anything outside the project. Every action stays undoable.
- **Sound Lab** — prompt → tracked generation job (provider, model, status, progress,
  cancel/retry, license note). Results can be previewed, saved to the library,
  opened in the Audio Editor, added to the Playlist, sliced to the Drum Rack, or
  turned into a Sampler instrument — then chopped, reversed, pitched, stretched,
  layered, and resampled like any other audio.
- **Analyze** — project analysis uses a structured project summary (never raw app
  state). Audio analysis sends audio only after an explicit dialog disclosing the
  upload, and only to providers that accept audio (OpenAI, Gemini).
- **Lyrics / Mix suggestions** — freeform text endpoints with project context.
  Mix suggestions are labeled as opinions, with A/B preview before broad changes.

## Cost & privacy defaults

Provider calls happen only when you press a button; there is no background AI.
The cloud light in the transport bar turns cyan during any provider request.
Generation costs are shown when the provider reports them; otherwise the job card
says "cost unknown". Local analysis (BPM, transients, key, silence, clipping) is
deterministic and clearly separated from model output in the UI.

## Replicate (stem separation)
1. Create an API token at replicate.com → paste it in AI Assistant → Providers → Replicate.
2. Pick a stem-separation model on replicate.com (Demucs-family models work well), open its
   API tab, and copy the **version hash**. Paste it into the Replicate provider's
   `modelVersion` config field.
3. Use the Stem Extractor (Sound Lab tab, or "Stems ✂" in the Audio Editor) — select audio,
   tick the upload consent box, Split. Stems import back as normal project assets.

Notes: your audio is uploaded to Replicate for processing; runs cost money on your Replicate
account per their pricing; output quality and stem names depend on the model you chose.
