/** All PulseForge API routes. Every body is Zod-validated; errors are redacted before logging. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PROVIDERS, getProvider } from "./providers";
import { setSecret, hasSecret, setProviderConfig, getProviderConfig, redactSecrets } from "./secrets";
import { createJob, getJob, listJobs, updateJob, cancelJob, isCancelled, saveAsset, readAsset, jobEvents, type Job } from "./jobs";
import { inspectZip, extractZipSafe } from "./ziputil";
import { COMPOSITION_SYSTEM, EDIT_PLAN_SYSTEM, LYRICS_SYSTEM, MIX_SYSTEM, ANALYZE_SYSTEM } from "./prompts";
import { validateComposition } from "../shared/composition";
import { validateEditPlan } from "../shared/commands";
import { registerConnectionRoutes, isLocalOrigin } from "./connections";
import { chatWithJsonRetry } from "./ai-json";
import { registerProducerRoutes } from "./producer-routes";
import { registerOAuthRoutes } from "./oauth";

// ---------- rate limiting (simple in-memory token bucket per IP) ----------
const buckets = new Map<string, { tokens: number; last: number }>();
function rateLimit(ip: string, cost = 1, capacity = 60, refillPerSec = 1): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: capacity, last: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens < cost) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= cost;
  buckets.set(ip, b);
  return true;
}

const providerBody = z.object({ providerId: z.string(), model: z.string().optional() });

/**
 * Cross-site request guard for every /api route. The backend can spend the user's API keys,
 * drive their logged-in AI CLIs and read local files, so a random website must never be able
 * to call it from the user's browser.
 *  - Origin must be absent (curl, Electron main), local (localhost/127.0.0.1/file/app), or the
 *    same host the request was sent to (same-origin, incl. LAN mode and Vercel).
 *  - Locally, the Host header must be loopback or a literal IP: this blocks DNS rebinding, where
 *    evil.example resolves to 127.0.0.1 and would otherwise look "same-origin".
 */
export function isAllowedRequest(origin: string | undefined, host: string | undefined, serverless: boolean): boolean {
  if (!serverless) {
    const h = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    const loopbackOrIp = h === "localhost" || h === "" || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":");
    if (!loopbackOrIp) return false;
  }
  if (!origin || origin === "null" || isLocalOrigin(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function registerRoutes(app: FastifyInstance): void {
  const serverless = process.env.PF_SERVERLESS === "1";
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/") && !isAllowedRequest(req.headers.origin, req.headers.host, serverless)) {
      return reply.code(403).send({ error: "Blocked cross-site request — PulseForge's API only answers its own app." });
    }
  });
  registerConnectionRoutes(app);
  registerProducerRoutes(app);
  registerOAuthRoutes(app);
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/ai/") || req.url.startsWith("/api/providers/test")) {
      if (!rateLimit(req.ip, 2)) {
        reply.code(429).send({ error: "Rate limit exceeded — slow down a little." });
      }
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    name: "PulseForge Studio backend",
    version: "2.0.0",
    /** "serverless" = hosted build (bring-your-own-key, no CLIs); "local" = desktop/local server */
    mode: serverless ? "serverless" : "local",
    time: new Date().toISOString(),
  }));

  // ---------- providers ----------
  app.get("/api/providers", async () => ({
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      capabilities: p.capabilities,
      configured: p.configured(),
      hasKey: hasSecret(p.id),
      needsKey: p.needsKey,
      configFields: p.configFields,
      config: getProviderConfig(p.id),
    })),
  }));

  app.post("/api/providers/test", async (req, reply) => {
    const body = providerBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const result = await getProvider(body.data.providerId).testConnection();
      return result;
    } catch (e) {
      return reply.code(400).send({ error: redactSecrets(String(e)) });
    }
  });

  app.post("/api/providers/secret", async (req, reply) => {
    if (serverless) return reply.code(400).send({ error: "Hosted version: keys are stored in your browser, not on the server." });
    const body = z.object({ providerId: z.string(), apiKey: z.string().max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid body" });
    getProvider(body.data.providerId); // throws on unknown
    setSecret(body.data.providerId, body.data.apiKey);
    return { ok: true, configured: hasSecret(body.data.providerId) };
  });

  app.post("/api/providers/config", async (req, reply) => {
    if (serverless) return reply.code(400).send({ error: "Hosted version: provider settings are stored in your browser." });
    const body = z.object({ providerId: z.string(), config: z.record(z.string(), z.string().max(500)) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid body" });
    getProvider(body.data.providerId);
    setProviderConfig(body.data.providerId, body.data.config);
    return { ok: true };
  });

  // ---------- AI text endpoints ----------
  app.post("/api/ai/compose", async (req, reply) => {
    const body = providerBody.extend({
      prompt: z.string().min(1).max(8000),
      context: z.string().max(20000).default(""),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      const user = `${body.data.context ? `Current project context:\n${body.data.context}\n\n` : ""}Request: ${body.data.prompt}`;
      const composition = await chatWithJsonRetry(provider, COMPOSITION_SYSTEM, user, body.data.model, validateComposition);
      return { composition };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });

  app.post("/api/ai/edit-plan", async (req, reply) => {
    const body = providerBody.extend({
      prompt: z.string().min(1).max(8000),
      projectSummary: z.string().max(60000),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      const user = `Project summary (ids are real — only use these):\n${body.data.projectSummary}\n\nUser request: ${body.data.prompt}`;
      const plan = await chatWithJsonRetry(provider, EDIT_PLAN_SYSTEM, user, body.data.model, validateEditPlan);
      return { plan };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });

  const freeform = (system: string) => async (req: any, reply: any) => {
    const body = providerBody.extend({ prompt: z.string().min(1).max(20000), context: z.string().max(60000).default("") }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      if (!provider.chat) throw new Error(`${provider.name} does not support text generation`);
      const text = await provider.chat({
        system,
        user: body.data.context ? `${body.data.context}\n\n${body.data.prompt}` : body.data.prompt,
        model: body.data.model,
      });
      return { text };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  };

  app.post("/api/ai/generate-lyrics", freeform(LYRICS_SYSTEM));
  app.post("/api/ai/suggest-mix", freeform(MIX_SYSTEM));
  app.post("/api/ai/analyze-project", freeform(ANALYZE_SYSTEM));

  app.post("/api/ai/analyze-audio", async (req, reply) => {
    const body = providerBody.extend({
      prompt: z.string().max(4000).default("Analyze this audio for a music producer."),
      features: z.string().max(20000).default(""),
      audioBase64: z.string().max(24 * 1024 * 1024).optional(),
      audioMime: z.string().max(60).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      if (!provider.chat) throw new Error(`${provider.name} does not support analysis`);
      const supportsAudio = provider.capabilities.includes("audio-analysis") && !!body.data.audioBase64 && ["gemini", "openai"].includes(provider.id);
      const user = `${body.data.features ? `Locally computed audio features:\n${body.data.features}\n\n` : ""}${body.data.prompt}${supportsAudio ? "" : "\n(Analysis is based on the computed features above; raw audio was not sent.)"}`;
      const text = await provider.chat({
        system: ANALYZE_SYSTEM,
        user,
        model: body.data.model,
        audioBase64: supportsAudio ? body.data.audioBase64 : undefined,
        audioMime: body.data.audioMime,
      });
      return { text, audioWasSent: supportsAudio };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });

  // ---------- audio generation jobs ----------
  const genBody = providerBody.extend({
    prompt: z.string().min(1).max(2000),
    durationSec: z.number().min(0.5).max(120).default(5),
    kind: z.enum(["sound", "music", "speech"]).default("sound"),
  });

  const startGeneration = async (req: any, reply: any) => {
    const body = genBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const provider = getProvider(body.data.providerId);
    if (!provider.generateAudio) {
      return reply.code(400).send({ error: `${provider.name} does not support audio generation. Choose an audio-capable provider or use Manual Import.` });
    }
    const job = createJob({
      kind: `generate-${body.data.kind}`,
      providerId: provider.id,
      model: body.data.model ?? "",
      prompt: body.data.prompt,
      durationSec: body.data.durationSec,
    });
    if (serverless) {
      try {
        const result = await provider.generateAudio!(
          { prompt: body.data.prompt, durationSec: body.data.durationSec, model: body.data.model, kind: body.data.kind },
        );
        if (result.audio.length > 4_000_000) throw new Error("Generated audio is larger than the hosted 4 MB response limit — try a shorter duration or use the desktop app.");
        updateJob(job.id, { status: "completed", progress: 1, mime: result.mime, licenseNote: result.licenseNote });
        return { job: getJob(job.id), audioBase64: result.audio.toString("base64"), mime: result.mime };
      } catch (e) {
        updateJob(job.id, { status: "failed", error: redactSecrets(String(e)) });
        return reply.code(502).send({ error: redactSecrets(String(e)), job: getJob(job.id) });
      }
    }
    // run async
    (async () => {
      updateJob(job.id, { status: "running", progress: 0.02 });
      try {
        const result = await provider.generateAudio!(
          { prompt: body.data.prompt, durationSec: body.data.durationSec, model: body.data.model, kind: body.data.kind },
          (p) => { if (!isCancelled(job.id)) updateJob(job.id, { progress: p }); },
        );
        if (isCancelled(job.id)) return;
        const assetId = saveAsset(job.id, result.audio, result.mime);
        updateJob(job.id, { status: "completed", progress: 1, assetId, mime: result.mime, licenseNote: result.licenseNote });
      } catch (e) {
        if (!isCancelled(job.id)) updateJob(job.id, { status: "failed", error: redactSecrets(String(e)) });
      }
    })();
    return { job: getJob(job.id) };
  };

  app.post("/api/ai/generate-audio", startGeneration);
  app.post("/api/ai/generate-sound", startGeneration);

  // ---- stem separation (FL-style Stem Extractor, provider-powered) ----
  const stemBody = providerBody.extend({
    audioBase64: z.string().min(100).max(120 * 1024 * 1024), // ~90MB of audio
    audioMime: z.string().regex(/^audio\//),
    sourceName: z.string().max(200).default("audio"),
  });
  app.post("/api/ai/separate-stems", async (req, reply) => {
    if (serverless) return reply.code(400).send({ error: "Stem separation needs the PulseForge desktop app (song uploads exceed the hosted 4.5 MB request limit)." });
    const body = stemBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const provider = getProvider(body.data.providerId);
    if (!provider.separateStems) {
      return reply.code(400).send({ error: `${provider.name} does not support stem separation. Configure the Replicate provider (with a Demucs-style modelVersion) or use Manual Import.` });
    }
    const audio = Buffer.from(body.data.audioBase64, "base64");
    const job = createJob({
      kind: "stem-separation",
      providerId: provider.id,
      model: "",
      prompt: `Split "${body.data.sourceName}" into stems`,
    });
    (async () => {
      updateJob(job.id, { status: "running", progress: 0.02 });
      try {
        const result = await provider.separateStems!(audio, body.data.audioMime,
          (p) => { if (!isCancelled(job.id)) updateJob(job.id, { progress: p }); });
        if (isCancelled(job.id)) return;
        const stems: Record<string, string> = {};
        for (const [name, s] of Object.entries(result.stems)) {
          stems[name.replace(/[^a-zA-Z0-9_-]/g, "_")] = saveAsset(`${job.id}-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`, s.data, s.mime);
        }
        updateJob(job.id, { status: "completed", progress: 1, stems, licenseNote: result.licenseNote });
      } catch (e) {
        if (!isCancelled(job.id)) updateJob(job.id, { status: "failed", error: redactSecrets(String(e)) });
      }
    })();
    return { job: getJob(job.id) };
  });

  app.get("/api/jobs", async () => ({ jobs: listJobs() }));
  app.get("/api/jobs/:jobId", async (req, reply) => {
    const job = getJob((req.params as any).jobId);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return { job };
  });
  app.post("/api/jobs/:jobId/cancel", async (req, reply) => {
    const ok = cancelJob((req.params as any).jobId);
    if (!ok) return reply.code(400).send({ error: "Job not found or already finished" });
    return { ok: true };
  });

  app.get("/api/assets/:assetId", async (req, reply) => {
    const asset = readAsset((req.params as any).assetId);
    if (!asset) return reply.code(404).send({ error: "Asset not found" });
    reply.header("content-type", asset.mime);
    return reply.send(asset.data);
  });

  // ---------- SSE event stream ----------
  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);
    const onJob = (job: Job) => {
      reply.raw.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
    };
    jobEvents.on("job", onJob);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 20000);
    req.raw.on("close", () => {
      jobEvents.off("job", onJob);
      clearInterval(ping);
    });
  });

  // ---------- sample pack helpers ----------
  app.post("/api/packs/inspect", async (req, reply) => {
    const body = z.object({ zipBase64: z.string().max(700 * 1024 * 1024) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid body" });
    try {
      const data = Buffer.from(body.data.zipBase64, "base64");
      return inspectZip(new Uint8Array(data));
    } catch (e) {
      return reply.code(400).send({ error: String(e) });
    }
  });

  app.post("/api/packs/extract", async (req, reply) => {
    const body = z.object({ zipBase64: z.string().max(700 * 1024 * 1024) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid body" });
    try {
      const data = Buffer.from(body.data.zipBase64, "base64");
      const files = extractZipSafe(new Uint8Array(data));
      const out: Array<{ path: string; dataBase64: string }> = [];
      for (const [p, content] of files) out.push({ path: p, dataBase64: Buffer.from(content).toString("base64") });
      return { files: out };
    } catch (e) {
      return reply.code(400).send({ error: String(e) });
    }
  });

  // safe pack download on explicit user request (https only, size-capped)
  app.post("/api/packs/download", async (req, reply) => {
    if (serverless) return reply.code(400).send({ error: "Downloading packs through the server is a desktop-app feature. In the hosted version, download the pack in your browser and import the ZIP." });
    const body = z.object({ url: z.string().url().max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid URL" });
    if (!body.data.url.startsWith("https://")) return reply.code(400).send({ error: "Only https downloads are allowed" });
    try {
      const res = await fetch(body.data.url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
      if (!res.ok) return reply.code(502).send({ error: `Download failed: HTTP ${res.status}` });
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > 500 * 1024 * 1024) return reply.code(400).send({ error: "File larger than 500MB limit" });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 500 * 1024 * 1024) return reply.code(400).send({ error: "File larger than 500MB limit" });
      return { dataBase64: buf.toString("base64"), contentType: res.headers.get("content-type") ?? "application/octet-stream", size: buf.length };
    } catch (e) {
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });
}
