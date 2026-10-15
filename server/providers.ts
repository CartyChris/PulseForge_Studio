/**
 * AI provider adapters behind one interface; capabilities are
 * declared per adapter and only advertised when the adapter actually implements
 * them. Endpoints used are each provider's documented public API — nothing invented.
 */
import { getSecret, getProviderConfig } from "./secrets";
import { CLI_PROVIDERS } from "./cli-bridge";

export type AICapability =
  | "composition"
  | "lyrics"
  | "project-analysis"
  | "audio-analysis"
  | "text-to-music"
  | "text-to-sound"
  | "text-to-speech"
  | "audio-remix"
  | "audio-continuation"
  | "stem-separation"
  | "transcription"
  | "voice-conversion";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export interface ChatRequest {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  /** optional audio for multimodal analysis (base64 + mime) */
  audioBase64?: string;
  audioMime?: string;
  /**
   * Optional structured-output hint. Used only where the provider supports it natively
   * (OpenAI response_format json_schema, Grok CLI --json-schema); everyone else ignores it,
   * so callers must still validate the text they get back.
   */
  jsonSchema?: object;
  /** Optional hint: ask for a JSON object (OpenAI-style response_format json_object). */
  json?: boolean;
  /** Optional cancellation (CLI providers kill their subprocess). */
  signal?: AbortSignal;
}

export interface AudioGenRequest {
  prompt: string;
  durationSec?: number;
  model?: string;
  kind: "sound" | "music" | "speech";
}
export interface AudioGenResult {
  audio: Buffer;
  mime: string;
  licenseNote: string;
}

export interface AIProviderAdapter {
  id: string;
  name: string;
  kind: "text" | "audio" | "manual";
  capabilities: AICapability[];
  /** true when key/config present */
  configured(): boolean;
  needsKey: boolean;
  configFields: string[];
  testConnection(): Promise<ConnectionTestResult>;
  chat?(req: ChatRequest): Promise<string>;
  generateAudio?(req: AudioGenRequest, onProgress?: (p: number) => void): Promise<AudioGenResult>;
  /** Split a mixed audio file into stems (vocals/drums/bass/other…). */
  separateStems?(audio: Buffer, mime: string, onProgress?: (p: number) => void): Promise<StemSeparationResult>;
}

export interface StemSeparationResult {
  /** stem name → audio bytes */
  stems: Record<string, { data: Buffer; mime: string }>;
  licenseNote: string;
}

const TIMEOUT = 120_000;

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

// ---------- Anthropic ----------
const anthropic: AIProviderAdapter = {
  id: "anthropic",
  name: "Anthropic (Claude)",
  kind: "text",
  needsKey: true,
  configFields: ["model"],
  capabilities: ["composition", "lyrics", "project-analysis", "audio-analysis"],
  configured: () => !!getSecret("anthropic"),
  async testConnection() {
    const key = getSecret("anthropic");
    if (!key) return { ok: false, message: "No API key configured" };
    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=20", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data: any = await res.json();
      return { ok: true, message: "Connected", models: (data.data ?? []).map((m: any) => m.id) };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async chat(req) {
    const key = getSecret("anthropic");
    if (!key) throw new Error("Anthropic API key not configured");
    const model = req.model || getProviderConfig("anthropic").model || "claude-opus-4-8";
    return anthropicMessages("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, model, req);
  },
};

/** Anthropic Messages API call (shared by Anthropic and Anthropic-compatible endpoints). */
async function anthropicMessages(url: string, headers: Record<string, string>, model: string, req: ChatRequest): Promise<string> {
  const data = await post(url, headers, {
    model,
    max_tokens: req.maxTokens ?? 8192,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  }, req.signal);
  return (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

// ---------- OpenAI-compatible chat helper ----------
interface OpenAiStyleOpts {
  /** local servers (Ollama, LM Studio) need no key */
  keyless?: boolean;
  /** xAI documents max_tokens as deprecated in favour of max_completion_tokens */
  tokenField?: "max_tokens" | "max_completion_tokens";
  /** provider documents OpenAI response_format (json_schema / json_object) */
  jsonMode?: boolean;
  /** provider documents no GET /models → test with a 1-token chat instead */
  testViaChat?: boolean;
}

function openAiStyle(id: string, name: string, baseUrl: string | null, defaultModel: string, caps: AICapability[], extraHeaders: () => Record<string, string> = () => ({}), opts: OpenAiStyleOpts = {}): AIProviderAdapter {
  const resolveBase = () => (getProviderConfig(id).baseUrl || baseUrl)?.replace(/\/+$/, "") || null;
  const keyless = opts.keyless ?? id === "ollama";
  const adapter: AIProviderAdapter = {
    id,
    name,
    kind: "text",
    needsKey: !keyless,
    configFields: ["baseUrl", "model"],
    capabilities: caps,
    configured: () => (keyless ? true : !!getSecret(id)) && !!resolveBase(),
    async testConnection() {
      const base = resolveBase();
      if (!base) return { ok: false, message: "No base URL configured" };
      const key = getSecret(id);
      if (!keyless && !key) return { ok: false, message: "No API key configured" };
      if (opts.testViaChat) {
        try {
          await adapter.chat!({ system: "Reply with OK.", user: "OK", maxTokens: 1 });
          return { ok: true, message: "Connected" };
        } catch (e) {
          return { ok: false, message: String(e) };
        }
      }
      try {
        const res = await fetch(`${base}/models`, {
          headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extraHeaders() },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
        const data: any = await res.json();
        const models = (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name).slice(0, 40);
        return { ok: true, message: "Connected", models };
      } catch (e) {
        return { ok: false, message: String(e) };
      }
    },
    async chat(req) {
      const base = resolveBase();
      if (!base) throw new Error(`${name}: base URL not configured`);
      const key = getSecret(id);
      const model = req.model || getProviderConfig(id).model || defaultModel;
      const messages: any[] = [
        { role: "system", content: req.system },
        req.audioBase64 && id === "openai"
          ? {
              role: "user",
              content: [
                { type: "text", text: req.user },
                { type: "input_audio", input_audio: { data: req.audioBase64, format: req.audioMime?.includes("mp3") ? "mp3" : "wav" } },
              ],
            }
          : { role: "user", content: req.user },
      ];
      const body: Record<string, unknown> = { model, [opts.tokenField ?? "max_tokens"]: req.maxTokens ?? 8192, messages };
      if (opts.jsonMode && req.jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "response", schema: req.jsonSchema } };
      else if (opts.jsonMode && req.json) body.response_format = { type: "json_object" };
      const data = await post(
        `${base}/chat/completions`,
        { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extraHeaders() },
        body,
        req.signal,
      );
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
  return adapter;
}

const openai = openAiStyle("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o", ["composition", "lyrics", "project-analysis", "audio-analysis", "transcription"], undefined, { jsonMode: true });
const openrouter = openAiStyle("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.5", ["composition", "lyrics", "project-analysis"], () => ({ "HTTP-Referer": "http://localhost", "X-Title": "PulseForge Studio" }));
const openaiCompatible = openAiStyle("openai-compatible", "OpenAI-compatible API", null, "default", ["composition", "lyrics", "project-analysis"]);
const ollama = openAiStyle("ollama", "Ollama (local)", "http://localhost:11434/v1", "llama3.1", ["composition", "lyrics", "project-analysis"]);

// ---------- 2.0 API providers ----------
// Every base URL below was checked against the vendor's own docs on 2026-10-14
// (doc URLs recorded in AI_PROVIDER_GUIDE.md). All use `Authorization: Bearer <key>`.
const TEXT_CAPS: AICapability[] = ["composition", "lyrics", "project-analysis"];
const PF_UA = () => ({ "user-agent": "PulseForge-Studio/2.0" });
/** docs.x.ai — Chat Completions at https://api.x.ai/v1; max_tokens deprecated → max_completion_tokens */
const xai = openAiStyle("xai", "xAI Grok API", "https://api.x.ai/v1", "grok-4.7", TEXT_CAPS, undefined, { tokenField: "max_completion_tokens" });
/** platform.kimi.ai quickstart — https://api.moonshot.ai/v1 */
const moonshot = openAiStyle("moonshot", "Moonshot Kimi API", "https://api.moonshot.ai/v1", "kimi-k3", TEXT_CAPS);
/**
 * kimi.com/code/docs — Kimi For Coding membership key. Overseas https://api.kimi.ai/coding/v1
 * (China: https://api.kimi.com/coding/v1 — set baseUrl). Kimi's terms require the client to keep
 * its real identity, so we send an honest User-Agent and never spoof a coding agent's.
 */
const kimiCoding = openAiStyle("kimi-coding", "Kimi For Coding (membership key)", "https://api.kimi.ai/coding/v1", "kimi-for-coding", TEXT_CAPS, PF_UA);
/** docs.z.ai — standard API https://api.z.ai/api/paas/v4 (no list-models endpoint documented) */
const zai = openAiStyle("zai", "Z.ai GLM API", "https://api.z.ai/api/paas/v4", "glm-5.3", TEXT_CAPS, undefined, { testViaChat: true });
/** docs.z.ai/devpack/quick-start — GLM Coding Plan dedicated endpoint https://api.z.ai/api/coding/paas/v4 */
const zaiCoding = openAiStyle("zai-coding", "Z.ai GLM Coding Plan", "https://api.z.ai/api/coding/paas/v4", "glm-5.3", TEXT_CAPS, undefined, { testViaChat: true });
/** api-docs.deepseek.com — https://api.deepseek.com (/chat/completions) */
const deepseek = openAiStyle("deepseek", "DeepSeek", "https://api.deepseek.com", "deepseek-flash", TEXT_CAPS);
/** docs.mistral.ai/api — https://api.mistral.ai/v1 */
const mistral = openAiStyle("mistral", "Mistral", "https://api.mistral.ai/v1", "mistral-large-latest", TEXT_CAPS);
/** console.groq.com/docs/openai — https://api.groq.com/openai/v1 */
const groq = openAiStyle("groq", "Groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", TEXT_CAPS);
/** docs.together.ai OpenAI compatibility — https://api.together.ai/v1 */
const together = openAiStyle("together", "Together AI", "https://api.together.ai/v1", "MiniMaxAI/MiniMax-M3", TEXT_CAPS);
/** LM Studio local server (OpenAI-compatible) — no key */
const lmstudio = openAiStyle("lmstudio", "LM Studio (local)", "http://127.0.0.1:1234/v1", "local-model", TEXT_CAPS, undefined, { keyless: true });

// ---------- Anthropic-compatible (Z.ai / Kimi coding plans document these) ----------
const anthropicCompatible: AIProviderAdapter = {
  id: "anthropic-compatible",
  name: "Anthropic-compatible API",
  kind: "text",
  needsKey: true,
  // baseUrl: e.g. https://api.z.ai/api/anthropic or https://api.kimi.ai/coding/ — we append /v1/messages
  // authHeader: "x-api-key" (default, Anthropic style) or "bearer" (Authorization: Bearer — what
  // Claude Code sends for ANTHROPIC_AUTH_TOKEN, the variable Z.ai's docs use)
  configFields: ["baseUrl", "model", "authHeader"],
  capabilities: TEXT_CAPS,
  configured: () => !!getSecret("anthropic-compatible") && !!getProviderConfig("anthropic-compatible").baseUrl && !!getProviderConfig("anthropic-compatible").model,
  async testConnection() {
    const cfg = getProviderConfig("anthropic-compatible");
    if (!cfg.baseUrl) return { ok: false, message: "No base URL configured" };
    if (!cfg.model) return { ok: false, message: "No model configured" };
    if (!getSecret("anthropic-compatible")) return { ok: false, message: "No API key configured" };
    try {
      await anthropicCompatible.chat!({ system: "Reply with OK.", user: "OK", maxTokens: 1 });
      return { ok: true, message: "Connected" };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async chat(req) {
    const cfg = getProviderConfig("anthropic-compatible");
    const key = getSecret("anthropic-compatible");
    if (!key) throw new Error("Anthropic-compatible API key not configured");
    if (!cfg.baseUrl) throw new Error("Anthropic-compatible base URL not configured");
    const model = req.model || cfg.model;
    if (!model) throw new Error("Anthropic-compatible model not configured");
    const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const auth: Record<string, string> = cfg.authHeader === "bearer" ? { authorization: `Bearer ${key}` } : { "x-api-key": key };
    return anthropicMessages(url, { ...auth, "anthropic-version": "2023-06-01", ...PF_UA() }, model, req);
  },
};

// ---------- Fish Audio (TTS) ----------
// docs.fish.audio — POST https://api.fish.audio/v1/tts, Authorization: Bearer, optional `model`
// header (s1, s2-pro, s2.1-pro [default], s2.1-pro-free, drama-3), JSON {text, reference_id?, format}.
const fishAudio: AIProviderAdapter = {
  id: "fish-audio",
  name: "Fish Audio (voices)",
  kind: "audio",
  needsKey: true,
  configFields: ["voiceId", "model"],
  capabilities: ["text-to-speech"],
  configured: () => !!getSecret("fish-audio"),
  async testConnection() {
    const key = getSecret("fish-audio");
    if (!key) return { ok: false, message: "No API key configured" };
    try {
      const res = await fetch("https://api.fish.audio/wallet/self/api-credit", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data: any = await res.json();
      return { ok: true, message: `Connected${data?.credit !== undefined ? ` — API credit ${data.credit}` : ""}` };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async generateAudio(req, onProgress) {
    if (req.kind !== "speech") throw new Error("Fish Audio supports speech (text-to-speech) only");
    const key = getSecret("fish-audio");
    if (!key) throw new Error("Fish Audio API key not configured");
    const cfg = getProviderConfig("fish-audio");
    onProgress?.(0.1);
    const res = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        model: req.model || cfg.model || "s2.1-pro",
      },
      body: JSON.stringify({ text: req.prompt, format: "mp3", ...(cfg.voiceId ? { reference_id: cfg.voiceId } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    onProgress?.(0.7);
    if (!res.ok) throw new Error(`Fish Audio ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const audio = Buffer.from(await res.arrayBuffer());
    onProgress?.(1);
    return { audio, mime: "audio/mpeg", licenseNote: "Generated via Fish Audio — usage governed by your Fish Audio plan and the voice model's terms." };
  },
};

// ---------- Google Gemini ----------
const gemini: AIProviderAdapter = {
  id: "gemini",
  name: "Google Gemini",
  kind: "text",
  needsKey: true,
  configFields: ["model"],
  capabilities: ["composition", "lyrics", "project-analysis", "audio-analysis", "transcription"],
  configured: () => !!getSecret("gemini"),
  async testConnection() {
    const key = getSecret("gemini");
    if (!key) return { ok: false, message: "No API key configured" };
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data: any = await res.json();
      return { ok: true, message: "Connected", models: (data.models ?? []).map((m: any) => m.name?.replace("models/", "")).slice(0, 40) };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async chat(req) {
    const key = getSecret("gemini");
    if (!key) throw new Error("Gemini API key not configured");
    const model = req.model || getProviderConfig("gemini").model || "gemini-2.0-flash";
    const parts: any[] = [{ text: req.user }];
    if (req.audioBase64) parts.push({ inlineData: { mimeType: req.audioMime ?? "audio/wav", data: req.audioBase64 } });
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {},
      { systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: "user", parts }] },
    );
    return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  },
};

// ---------- ElevenLabs ----------
const elevenlabs: AIProviderAdapter = {
  id: "elevenlabs",
  name: "ElevenLabs",
  kind: "audio",
  needsKey: true,
  configFields: ["voiceId", "musicModel"],
  capabilities: ["text-to-sound", "text-to-speech", "text-to-music"],
  configured: () => !!getSecret("elevenlabs"),
  async testConnection() {
    const key = getSecret("elevenlabs");
    if (!key) return { ok: false, message: "No API key configured" };
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(20_000) });
      return res.ok ? { ok: true, message: "Connected" } : { ok: false, message: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async generateAudio(req, onProgress) {
    const key = getSecret("elevenlabs");
    if (!key) throw new Error("ElevenLabs API key not configured");
    onProgress?.(0.1);
    let url: string;
    let body: any;
    if (req.kind === "speech") {
      const voiceId = getProviderConfig("elevenlabs").voiceId || "21m00Tcm4TlvDq8ikWAM";
      url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      body = { text: req.prompt, model_id: "eleven_multilingual_v2" };
    } else if (req.kind === "music") {
      // Eleven Music — elevenlabs.io/docs/api-reference/music/compose: POST /v1/music,
      // music_length_ms 3000..600000, model_id music_v1 | music_v2 | music_v2_5; returns the audio file
      url = "https://api.elevenlabs.io/v1/music";
      const ms = Math.round(Math.min(600, Math.max(3, req.durationSec ?? 30)) * 1000);
      const musicModel = (req.model?.startsWith("music_") ? req.model : undefined) || getProviderConfig("elevenlabs").musicModel || "music_v1";
      body = { prompt: req.prompt, music_length_ms: ms, model_id: musicModel };
    } else {
      url = "https://api.elevenlabs.io/v1/sound-generation";
      body = { text: req.prompt, duration_seconds: Math.min(22, Math.max(0.5, req.durationSec ?? 5)) };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    onProgress?.(0.7);
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const audio = Buffer.from(await res.arrayBuffer());
    onProgress?.(1);
    return { audio, mime: "audio/mpeg", licenseNote: "Generated via ElevenLabs — usage governed by your ElevenLabs plan license." };
  },
};

// ---------- Generic audio adapters (user-configured REST endpoints) ----------
const genericAudioSync: AIProviderAdapter = {
  id: "generic-audio-sync",
  name: "Generic Audio API (synchronous)",
  kind: "audio",
  needsKey: false,
  configFields: ["baseUrl", "path", "model"],
  capabilities: ["text-to-sound", "text-to-music"],
  configured: () => !!getProviderConfig("generic-audio-sync").baseUrl,
  async testConnection() {
    const cfg = getProviderConfig("generic-audio-sync");
    if (!cfg.baseUrl) return { ok: false, message: "No base URL configured" };
    try {
      const res = await fetch(cfg.baseUrl, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      return { ok: res.status < 500, message: `Endpoint reachable (HTTP ${res.status})` };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async generateAudio(req, onProgress) {
    const cfg = getProviderConfig("generic-audio-sync");
    if (!cfg.baseUrl) throw new Error("Generic audio endpoint not configured");
    const key = getSecret("generic-audio-sync");
    onProgress?.(0.1);
    const res = await fetch(`${cfg.baseUrl}${cfg.path ?? "/generate"}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ prompt: req.prompt, duration: req.durationSec ?? 5, model: req.model ?? cfg.model }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`Generic audio API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const mime = res.headers.get("content-type") ?? "audio/wav";
    if (!mime.startsWith("audio/") && !mime.includes("octet-stream")) {
      throw new Error(`Endpoint returned ${mime}, expected audio`);
    }
    onProgress?.(0.9);
    return { audio: Buffer.from(await res.arrayBuffer()), mime, licenseNote: "Generated via user-configured endpoint — verify its license terms." };
  },
};

const genericAudioAsync: AIProviderAdapter = {
  id: "generic-audio-async",
  name: "Generic Audio API (job-based)",
  kind: "audio",
  needsKey: false,
  configFields: ["baseUrl", "submitPath", "statusPath", "model"],
  capabilities: ["text-to-sound", "text-to-music"],
  configured: () => !!getProviderConfig("generic-audio-async").baseUrl,
  async testConnection() {
    return genericAudioSync.testConnection.call({ ...genericAudioSync }) as Promise<ConnectionTestResult>;
  },
  async generateAudio(req, onProgress) {
    const cfg = getProviderConfig("generic-audio-async");
    if (!cfg.baseUrl) throw new Error("Generic async audio endpoint not configured");
    const key = getSecret("generic-audio-async");
    const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
    const submit = await post(`${cfg.baseUrl}${cfg.submitPath ?? "/jobs"}`, headers, {
      prompt: req.prompt, duration: req.durationSec ?? 5, model: req.model ?? cfg.model,
    });
    const jobId = submit.job_id ?? submit.id;
    if (!jobId) throw new Error("Async endpoint returned no job id");
    const statusPath = (cfg.statusPath ?? "/jobs/{id}").replace("{id}", String(jobId));
    const started = Date.now();
    while (Date.now() - started < 10 * 60_000) {
      await new Promise((r) => setTimeout(r, 2500));
      const res = await fetch(`${cfg.baseUrl}${statusPath}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Job status HTTP ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.startsWith("audio/")) {
        onProgress?.(1);
        return { audio: Buffer.from(await res.arrayBuffer()), mime: ct, licenseNote: "Generated via user-configured endpoint — verify its license terms." };
      }
      const status: any = await res.json();
      onProgress?.(Math.min(0.9, Number(status.progress ?? 0.5)));
      if (status.status === "failed" || status.error) throw new Error(`Generation failed: ${status.error ?? "unknown"}`);
      if (status.status === "completed" || status.audio_url || status.output_url) {
        const audioUrl = status.audio_url ?? status.output_url ?? status.result?.url;
        if (!audioUrl) throw new Error("Job completed but no audio URL in response");
        const audioRes = await fetch(audioUrl, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(TIMEOUT) });
        if (!audioRes.ok) throw new Error(`Audio download HTTP ${audioRes.status}`);
        onProgress?.(1);
        return { audio: Buffer.from(await audioRes.arrayBuffer()), mime: audioRes.headers.get("content-type") ?? "audio/wav", licenseNote: "Generated via user-configured endpoint — verify its license terms." };
      }
    }
    throw new Error("Async generation timed out after 10 minutes");
  },
};

// ---------- Replicate (stem separation via hosted open-source models e.g. Demucs) ----------
const replicate: AIProviderAdapter = {
  id: "replicate",
  name: "Replicate (stem separation)",
  kind: "audio",
  needsKey: true,
  // modelVersion: the version hash from the model page (e.g. a Demucs model on replicate.com).
  // We deliberately don't hardcode one — hashes rotate; the UI links users to the model page.
  configFields: ["modelVersion"],
  capabilities: ["stem-separation"],
  configured: () => !!getSecret("replicate") && !!getProviderConfig("replicate").modelVersion,
  async testConnection() {
    const key = getSecret("replicate");
    if (!key) return { ok: false, message: "No API token set" };
    try {
      const res = await fetch("https://api.replicate.com/v1/account", {
        headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, message: `Replicate HTTP ${res.status}` };
      const acct: any = await res.json();
      const cfg = getProviderConfig("replicate");
      return { ok: true, message: `Connected as ${acct.username ?? "account"}${cfg.modelVersion ? "" : " — set modelVersion (a Demucs model version hash) to enable separation"}` };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  },
  async separateStems(audio, mime, onProgress) {
    const key = getSecret("replicate");
    const cfg = getProviderConfig("replicate");
    if (!key) throw new Error("Replicate API token not set");
    if (!cfg.modelVersion) throw new Error("Set the Replicate modelVersion config (the version hash of a stem-separation model such as Demucs — copy it from the model's API page on replicate.com)");
    const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    onProgress?.(0.05);
    const dataUri = `data:${mime};base64,${audio.toString("base64")}`;
    const create = await post("https://api.replicate.com/v1/predictions", headers, {
      version: cfg.modelVersion,
      input: { audio: dataUri },
    });
    const predId = create.id;
    if (!predId) throw new Error(`Replicate returned no prediction id: ${JSON.stringify(create).slice(0, 200)}`);
    const started = Date.now();
    while (Date.now() - started < 15 * 60_000) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Replicate poll HTTP ${res.status}`);
      const pred: any = await res.json();
      if (pred.status === "starting") onProgress?.(0.1);
      if (pred.status === "processing") onProgress?.(0.5);
      if (pred.status === "failed" || pred.status === "canceled") throw new Error(`Replicate: ${pred.error ?? pred.status}`);
      if (pred.status === "succeeded") {
        // demucs-style outputs: an object of stem-name → URL (sometimes nested under a key)
        const out = pred.output;
        const urlMap: Record<string, string> = {};
        const collect = (obj: any) => {
          if (!obj) return;
          if (typeof obj === "string" && /^https?:/.test(obj)) urlMap[`stem${Object.keys(urlMap).length + 1}`] = obj;
          else if (Array.isArray(obj)) obj.forEach(collect);
          else if (typeof obj === "object") {
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === "string" && /^https?:/.test(v)) urlMap[k] = v;
              else collect(v);
            }
          }
        };
        collect(out);
        if (!Object.keys(urlMap).length) throw new Error(`Model succeeded but returned no audio URLs: ${JSON.stringify(out).slice(0, 200)}`);
        const stems: StemSeparationResult["stems"] = {};
        let done = 0;
        for (const [name, url] of Object.entries(urlMap)) {
          const dl = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
          if (!dl.ok) throw new Error(`Stem download ${name}: HTTP ${dl.status}`);
          stems[name] = { data: Buffer.from(await dl.arrayBuffer()), mime: dl.headers.get("content-type") ?? "audio/wav" };
          done++;
          onProgress?.(0.6 + (0.4 * done) / Object.keys(urlMap).length);
        }
        return { stems, licenseNote: "Separated via Replicate-hosted open-source model — verify the model's license; your input audio was uploaded to Replicate for processing." };
      }
    }
    throw new Error("Stem separation timed out after 15 minutes");
  },
};

// ---------- Manual import ----------
const manualImport: AIProviderAdapter = {
  id: "manual-import",
  name: "Manual Import (no API)",
  kind: "manual",
  needsKey: false,
  configFields: [],
  capabilities: [],
  configured: () => true,
  async testConnection() {
    return { ok: true, message: "Manual workflow: generate audio in any external service, download it, then use Import in the Sound Lab or Browser." };
  },
};

export const PROVIDERS: AIProviderAdapter[] = [
  anthropic, openai, gemini, openrouter, openaiCompatible, ollama,
  elevenlabs, genericAudioSync, genericAudioAsync, replicate,
  // 2.0: subscriptions via the user's own installed CLIs (desktop only)
  ...CLI_PROVIDERS,
  // 2.0: more APIs + local servers + voices
  xai, moonshot, kimiCoding, zai, zaiCoding, deepseek, mistral, groq, together, lmstudio, anthropicCompatible, fishAudio,
  manualImport,
];

export function getProvider(id: string): AIProviderAdapter {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
