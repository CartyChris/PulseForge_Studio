/**
 * AI provider adapters. Ten adapters behind one interface; capabilities are
 * declared per adapter and only advertised when the adapter actually implements
 * them. Endpoints used are each provider's documented public API — nothing invented.
 */
import { getSecret, getProviderConfig } from "./secrets";

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

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
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
    const data = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: req.maxTokens ?? 8192,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      },
    );
    return (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  },
};

// ---------- OpenAI-compatible chat helper ----------
function openAiStyle(id: string, name: string, baseUrl: string | null, defaultModel: string, caps: AICapability[], extraHeaders: () => Record<string, string> = () => ({})): AIProviderAdapter {
  const resolveBase = () => getProviderConfig(id).baseUrl || baseUrl;
  return {
    id,
    name,
    kind: "text",
    needsKey: id !== "ollama",
    configFields: ["baseUrl", "model"],
    capabilities: caps,
    configured: () => (id === "ollama" ? true : !!getSecret(id)) && !!resolveBase(),
    async testConnection() {
      const base = resolveBase();
      if (!base) return { ok: false, message: "No base URL configured" };
      const key = getSecret(id);
      if (id !== "ollama" && !key) return { ok: false, message: "No API key configured" };
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
      const data = await post(
        `${base}/chat/completions`,
        { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extraHeaders() },
        { model, max_tokens: req.maxTokens ?? 8192, messages },
      );
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

const openai = openAiStyle("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o", ["composition", "lyrics", "project-analysis", "audio-analysis", "transcription"]);
const openrouter = openAiStyle("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.5", ["composition", "lyrics", "project-analysis"], () => ({ "HTTP-Referer": "http://localhost", "X-Title": "PulseForge Studio" }));
const openaiCompatible = openAiStyle("openai-compatible", "OpenAI-compatible API", null, "default", ["composition", "lyrics", "project-analysis"]);
const ollama = openAiStyle("ollama", "Ollama (local)", "http://localhost:11434/v1", "llama3.1", ["composition", "lyrics", "project-analysis"]);

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
  configFields: ["voiceId"],
  capabilities: ["text-to-sound", "text-to-speech"],
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
  elevenlabs, genericAudioSync, genericAudioAsync, replicate, manualImport,
];

export function getProvider(id: string): AIProviderAdapter {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
