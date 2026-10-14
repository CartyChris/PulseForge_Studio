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

async function call<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  health: () => call<{ ok: boolean }>("/health"),
  providers: () => call<{ providers: ProviderInfo[] }>("/providers"),
  testProvider: (providerId: string) => call<{ ok: boolean; message: string; models?: string[] }>("/providers/test", { providerId }),
  setSecret: (providerId: string, apiKey: string) => call<{ ok: boolean }>("/providers/secret", { providerId, apiKey }),
  setConfig: (providerId: string, config: Record<string, string>) => call<{ ok: boolean }>("/providers/config", { providerId, config }),
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
    call<{ job: JobInfo }>("/ai/generate-sound", { providerId, prompt, durationSec, kind, model }),
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
