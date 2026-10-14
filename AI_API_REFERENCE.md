# AI API Reference (local backend)

Base URL: `http://127.0.0.1:7800/api` in production (`:7801` in dev; Vite proxies `/api`).
All bodies are JSON, validated with Zod; validation errors return `400 {error}`.
Rate limiting and body-size limits apply; secrets are redacted from all logs.

## Health & providers

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ok, name, version, time}` |
| `GET /providers` | — | `{providers: [{id, name, kind, capabilities[], configured, hasKey, needsKey, configFields[], config}]}` — never includes key material |
| `POST /providers/test` | `{providerId}` | `{ok, message, models?}` — live connection probe |
| `POST /providers/secret` | `{providerId, apiKey}` | `{ok}` — stores to chmod-600 secrets file |
| `POST /providers/config` | `{providerId, config}` | `{ok}` — e.g. base URL, model, field mapping |

## AI endpoints

| Method & path | Body | Returns |
|---|---|---|
| `POST /ai/compose` | `{providerId, prompt, context, model?}` | `{composition}` — validated against the versioned composition schema before returning |
| `POST /ai/edit-plan` | `{providerId, prompt, projectSummary, model?}` | `{plan: {summary, commands[]}}` — commands validated against the DAW command schema |
| `POST /ai/generate-lyrics` | `{providerId, prompt, context, model?}` | `{text}` |
| `POST /ai/suggest-mix` | `{providerId, prompt, context, model?}` | `{text}` |
| `POST /ai/analyze-project` | `{providerId, prompt, context, model?}` | `{text}` |
| `POST /ai/analyze-audio` | `{providerId, prompt, features, audioBase64?, audioMime?, model?}` | `{text, audioWasSent}` — audio only goes to capable providers; `features` carries local deterministic analysis |
| `POST /ai/generate-audio` · `POST /ai/generate-sound` | `{providerId, prompt, durationSec, kind: "sound"\|"music"\|"speech", model?}` | `{job}` — starts a tracked job |

## Jobs & assets

| Method & path | Returns |
|---|---|
| `GET /jobs` | `{jobs: JobInfo[]}` |
| `GET /jobs/:jobId` | `{job}` — `status: queued\|running\|completed\|failed\|cancelled`, `progress 0..1`, `assetId?`, `licenseNote?` |
| `POST /jobs/:jobId/cancel` | `{ok}` — aborts in-flight provider requests |
| `GET /assets/:assetId` | raw audio bytes (correct MIME) for completed generations |
| `GET /events` | **SSE stream**; `event: job` messages carry every job state change (progress, completion, cancellation, errors) |

## Sample packs

| Method & path | Body | Returns |
|---|---|---|
| `POST /packs/inspect` | `{zipBase64}` | `{entries: [{path, size, kind}], unsafe: []}` — lists contents; flags traversal attempts, executables, oversized entries |
| `POST /packs/extract` | `{zipBase64}` | `{files: [{path, dataBase64}]}` — audio files only; unsafe paths rejected |
| `POST /packs/download` | `{url}` | `{dataBase64, contentType, size}` — explicit-user-action download helper with size cap |

## JobInfo shape

```ts
{
  id: string; kind: string; providerId: string; model: string; prompt: string;
  durationSec?: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;           // 0..1
  error?: string;             // redacted
  assetId?: string; mime?: string;
  licenseNote?: string;       // provider usage terms reminder
  createdAt: string; finishedAt?: string;
}
```

## Guarantees

- No endpoint executes code from model output; compositions and edit plans are
  schema-validated data.
- Provider failures return typed errors and never mutate project state (the
  frontend applies plans atomically after validation).
- API keys never appear in responses, errors, or logs (`redactSecrets` covers
  `sk-`-style tokens and stored key values).
