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

## 2.0 — Connections: subscriptions, more APIs, local servers, voices

### Use the AI subscriptions you already pay for (desktop app only)
PulseForge can drive the **official CLIs you've already installed and signed in to**. It runs
them as subprocesses; each CLI uses its own stored login. PulseForge never reads, copies or
reuses any other app's tokens or Keychain items — "connected" only ever means a real test
prompt succeeded.

| Provider id | CLI | One answer-only turn runs as |
|---|---|---|
| `cli-claude` | Claude Code (`claude`) | `claude -p --output-format json --tools "" --no-session-persistence --setting-sources project --strict-mcp-config --system-prompt <system> [--model M]`, prompt on stdin |
| `cli-codex` | Codex CLI (`codex`) | `codex exec --sandbox read-only --skip-git-repo-check --ephemeral --color never -C <tmp> -o <tmp>/last-message.txt [-m M] -`, system+prompt on stdin |
| `cli-kimi` | Kimi Code (`kimi`) | `kimi -p <system+prompt> --plan --output-format text [-m M]` |
| `cli-grok` | Grok Build (`grok`) | `grok --single=<prompt> --output-format plain --cwd <tmp> --disable-web-search --no-subagents --max-turns 1 --permission-mode plan --rules=<system> [--json-schema=<schema>] [-m M]` |

Safety: no shell (argv arrays only), a fresh empty temp folder per call (deleted after), a
minimal environment (API keys are deliberately *not* passed, so the CLI uses your
subscription rather than billing a key), a 180 s timeout (provider config `timeoutSec`)
that kills the whole process group, a 4 MB output cap, and no tools, MCP servers or web
search. Only these four ids can run anything; the API never accepts a binary path or flags.
If a run fails with "isn't logged in", open Terminal and run the CLI once (`claude` →
`/login`, `codex login`, `kimi login`, `grok login`). The Vercel/serverless build
(`PF_SERVERLESS=1`) reports CLI providers as unavailable.

Detected but not yet supported (listed with `supported:false`): Gemini CLI, opencode,
Qwen Code, Cursor Agent, Goose.

### Auto-detection — `GET /api/connections`
```
{ serverless, clis: [{id, name, binary, path|null, version|null, installed, supported}],
  local: [{id:"ollama"|"lmstudio", url, reachable, models[]}],
  envKeys: [{providerId, envVar, present, source:"process"|"login-shell"|null}],
  importedFromShell: [names only] }
```
`POST /api/connections/rescan` clears caches; `POST /api/connections/test {providerId}` runs
that provider's real connection test (for CLIs: a tiny "Reply with exactly: OK" prompt).
These routes only answer pages served from this computer (loopback/file/app origins).
Key **values** are never returned.

Apps launched from Finder don't see `~/.zshrc` exports, so PulseForge asks your login shell
for **only these variable names** (everything else is filtered inside the shell):
ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, MOONSHOT_API_KEY, KIMI_API_KEY, ZAI_API_KEY,
ZHIPUAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY,
MISTRAL_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, ELEVENLABS_API_KEY, FISH_API_KEY /
FISH_AUDIO_API_KEY, REPLICATE_API_TOKEN. Lookup order: process env → login shell → secrets.json.

### New API providers (base URLs checked against each vendor's docs, 2026-10-14)
| id | Base URL | Auth | Key env var | Docs |
|---|---|---|---|---|
| `xai` | `https://api.x.ai/v1` (Chat Completions, uses `max_completion_tokens`) | Bearer | XAI_API_KEY | docs.x.ai/developers/rest-api-reference/inference/chat-completions |
| `moonshot` | `https://api.moonshot.ai/v1` | Bearer | MOONSHOT_API_KEY | platform.kimi.ai/docs/guide/start-using-kimi-api |
| `kimi-coding` | `https://api.kimi.ai/coding/v1` (China: `https://api.kimi.com/coding/v1` — set `baseUrl`) | Bearer | KIMI_API_KEY | kimi.com/code/docs/en/ |
| `zai` | `https://api.z.ai/api/paas/v4` | Bearer | ZAI_API_KEY / ZHIPUAI_API_KEY | docs.z.ai/guides/overview/quick-start |
| `zai-coding` | `https://api.z.ai/api/coding/paas/v4` (GLM Coding Plan endpoint) | Bearer | ZAI_API_KEY / ZHIPUAI_API_KEY | docs.z.ai/devpack/quick-start |
| `deepseek` | `https://api.deepseek.com` | Bearer | DEEPSEEK_API_KEY | api-docs.deepseek.com |
| `mistral` | `https://api.mistral.ai/v1` | Bearer | MISTRAL_API_KEY | docs.mistral.ai/api |
| `groq` | `https://api.groq.com/openai/v1` | Bearer | GROQ_API_KEY | console.groq.com/docs/openai |
| `together` | `https://api.together.ai/v1` | Bearer | TOGETHER_API_KEY | docs.together.ai/docs/openai-api-compatibility |
| `lmstudio` | `http://127.0.0.1:1234/v1` (local, no key) | — | — | LM Studio local server |
| `anthropic-compatible` | your `baseUrl` + `/v1/messages` | `x-api-key` (or `authHeader: bearer`) + `anthropic-version` | ANTHROPIC_COMPATIBLE_API_KEY | e.g. Z.ai `https://api.z.ai/api/anthropic` (docs.z.ai/devpack/tool/claude), Kimi `https://api.kimi.ai/coding/` |
| `fish-audio` | `POST https://api.fish.audio/v1/tts` (`model` header, default `s2.1-pro`; `voiceId` = `reference_id`) | Bearer | FISH_API_KEY / FISH_AUDIO_API_KEY | docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech |

ElevenLabs now also does **text-to-music** (Eleven Music, `POST https://api.elevenlabs.io/v1/music`,
3–600 s, `musicModel` config: `music_v1` default, `music_v2`, `music_v2_5`) —
elevenlabs.io/docs/api-reference/music/compose.

**Kimi For Coding key note:** Kimi's docs say the membership key is meant for development
tools and that clients must keep their real identity (changing the User-Agent is a
violation). PulseForge sends its own honest `PulseForge-Studio/2.0` User-Agent and never
imitates a coding agent. If you only want to use your Kimi membership, `cli-kimi` (the
official CLI) is the safer route.

Structured output: requests may carry an optional JSON-schema hint. It is used natively
only by OpenAI (`response_format: json_schema`) and Grok Build (`--json-schema`); every
other provider ignores it, and PulseForge validates all output either way.
