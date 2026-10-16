/** Typed client for the PulseForge backend. All AI traffic goes through here. */
import type { Composition } from "../shared/composition";
import type { EditPlan } from "../shared/commands";

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "text" | "audio" | "manual";
  capabilities: string[];
  configured: boolean;
  hasKey: boolean;
  needsKey: boolean;
  configFields: string[];
  config: Record<string, string>;
}

export interface JobInfo {
  id: string;
  kind: string;
  providerId: string;
  model: string;
  prompt: string;
  durationSec?: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  error?: string;
  assetId?: string;
  /** stem-separation jobs: stem name → backend assetId */
  stems?: Record<string, string>;
  mime?: string;
  licenseNote?: string;
  createdAt: string;
  finishedAt?: string;
}

/**
 * Bring-your-own-key store for the hosted (serverless) build. Keys live ONLY in this browser's
 * localStorage and travel to our own origin's stateless proxy per request — never baked into the
 * bundle, never stored server-side. In the desktop/local app keys stay in the backend instead.
 */
const BYOK_KEY = "pf_byok_keys";
const BYOK_CFG = "pf_byok_config";
function readJsonLS(k: string): Record<string, unknown> { try { return JSON.parse(localStorage.getItem(k) ?? "{}"); } catch { return {}; } }
export const byok = {
  keys: () => readJsonLS(BYOK_KEY) as Record<string, string>,
  config: () => readJsonLS(BYOK_CFG) as Record<string, Record<string, string>>,
  setKey(providerId: string, key: string) {
    const all = byok.keys();
    if (key) all[providerId] = key; else delete all[providerId];
    try { localStorage.setItem(BYOK_KEY, JSON.stringify(all)); } catch {}
  },
  setConfig(providerId: string, cfg: Record<string, string>) {
    const all = byok.config();
    all[providerId] = cfg;
    try { localStorage.setItem(BYOK_CFG, JSON.stringify(all)); } catch {}
  },
};
const b64 = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));

/** "local" = desktop app / local server (keys in backend); "serverless" = hosted, BYOK */
export let serverMode: "local" | "serverless" = "local";
let modeKnown: Promise<void> | null = null;
export function detectServerMode(): Promise<void> {
  modeKnown ??= fetch("/api/health").then((r) => r.json()).then((h: { mode?: string }) => { serverMode = h.mode === "serverless" ? "serverless" : "local"; }).catch(() => {});
  return modeKnown;
}

async function call<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  await detectServerMode();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (serverMode === "serverless") {
    const keys = byok.keys(), cfg = byok.config();
    if (Object.keys(keys).length) headers["x-pf-byok"] = b64(keys);
    if (Object.keys(cfg).length) headers["x-pf-config"] = b64(cfg);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface ConnectionsReport {
  serverless: boolean;
  clis: Array<{ id: string; name: string; binary: string; path: string | null; version: string | null; installed: boolean; supported: boolean }>;
  local: Array<{ id: "ollama" | "lmstudio"; url: string; reachable: boolean; models: string[] }>;
  envKeys: Array<{ providerId: string; envVar: string; present: boolean; source: "process" | "login-shell" | null }>;
  importedFromShell: string[];
}

export const api = {
  health: () => call<{ ok: boolean; mode?: string; version?: string }>("/health"),
  providers: () => call<{ providers: ProviderInfo[] }>("/providers"),
  testProvider: (providerId: string) => call<{ ok: boolean; message: string; models?: string[] }>("/providers/test", { providerId }),
  setSecret: async (providerId: string, apiKey: string) => {
    await detectServerMode();
    if (serverMode === "serverless") { byok.setKey(providerId, apiKey); return { ok: true }; }
    return call<{ ok: boolean }>("/providers/secret", { providerId, apiKey });
  },
  setConfig: async (providerId: string, config: Record<string, string>) => {
    await detectServerMode();
    if (serverMode === "serverless") { byok.setConfig(providerId, config); return { ok: true }; }
    return call<{ ok: boolean }>("/providers/config", { providerId, config });
  },
  // ── end-to-end producer ──
  producePlan: (providerId: string, prompt: string, catalog: string, model?: string, context = "") =>
    call<{ spec: import("../shared/producer").ProductionSpec }>("/ai/produce/plan", { providerId, prompt, catalog, context, model }),
  produceRevise: (providerId: string, prompt: string, spec: object, projectSummary: string, catalog: string, model?: string) =>
    call<{ result: import("../shared/producer-ai").ProduceRevise }>("/ai/produce/revise", { providerId, prompt, spec, projectSummary, catalog, model }),
  produceCritique: (providerId: string, goal: string, spec: object, metrics: string, projectSummary: string, model?: string) =>
    call<{ critique: import("../shared/producer-ai").ProduceCritique }>("/ai/produce/critique", { providerId, goal, spec, metrics, projectSummary, model }),
  // ── connections (desktop/local only) ──
  connections: () => call<ConnectionsReport>("/connections"),
  connectionsRescan: () => call<{ ok: boolean }>("/connections/rescan", {}),
  connectionsTest: (providerId: string) => call<{ providerId: string; ok: boolean; message: string }>("/connections/test", { providerId }),
  oauthOpenRouterStart: () => call<{ url: string }>("/oauth/openrouter/start", {}),
  compose: (providerId: string, prompt: string, context: string, model?: string) =>
    call<{ composition: Composition }>("/ai/compose", { providerId, prompt, context, model }),
  editPlan: (providerId: string, prompt: string, projectSummary: string, model?: string) =>
    call<{ plan: EditPlan }>("/ai/edit-plan", { providerId, prompt, projectSummary, model }),
  lyrics: (providerId: string, prompt: string, context = "", model?: string) =>
    call<{ text: string }>("/ai/generate-lyrics", { providerId, prompt, context, model }),
  suggestMix: (providerId: string, prompt: string, context: string, model?: string) =>
    call<{ text: string }>("/ai/suggest-mix", { providerId, prompt, context, model }),
  analyzeProject: (providerId: string, prompt: string, context: string, model?: string) =>
    call<{ text: string }>("/ai/analyze-project", { providerId, prompt, context, model }),
  analyzeAudio: (providerId: string, prompt: string, features: string, audioBase64?: string, audioMime?: string, model?: string) =>
    call<{ text: string; audioWasSent: boolean }>("/ai/analyze-audio", { providerId, prompt, features, audioBase64, audioMime, model }),
  generateSound: (providerId: string, prompt: string, durationSec: number, kind: "sound" | "music" | "speech", model?: string) =>
    // the hosted build answers synchronously with the audio inline (no server-side asset store)
    call<{ job: JobInfo; audioBase64?: string; mime?: string }>("/ai/generate-sound", { providerId, prompt, durationSec, kind, model }),
  separateStems: (providerId: string, audioBase64: string, audioMime: string, sourceName: string) =>
    call<{ job: JobInfo }>("/ai/separate-stems", { providerId, audioBase64, audioMime, sourceName }),
  jobs: () => call<{ jobs: JobInfo[] }>("/jobs"),
  job: (id: string) => call<{ job: JobInfo }>(`/jobs/${id}`),
  cancelJob: (id: string) => call<{ ok: boolean }>(`/jobs/${id}/cancel`, {}),
  assetUrl: (assetId: string) => `/api/assets/${assetId}`,
  inspectPack: (zipBase64: string) => call<{ entries: Array<{ path: string; size: number; kind: string }>; unsafe: string[] }>("/packs/inspect", { zipBase64 }),
  extractPack: (zipBase64: string) => call<{ files: Array<{ path: string; dataBase64: string }> }>("/packs/extract", { zipBase64 }),
  downloadPack: (url: string) => call<{ dataBase64: string; contentType: string; size: number }>("/packs/download", { url }),
};

/** Subscribe to backend SSE job updates. Returns unsubscribe. */
export function subscribeJobs(onJob: (job: JobInfo) => void): () => void {
  const es = new EventSource("/api/events");
  es.addEventListener("job", (e) => {
    try {
      onJob(JSON.parse((e as MessageEvent).data));
    } catch {}
  });
  return () => es.close();
}

export function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function arrayBufferFromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
