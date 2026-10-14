import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { zipSync, strToU8 } from "fflate";

// isolate secrets/config into a temp dir before importing server modules
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-test-"));
process.env.PF_DATA_DIR = tmp;

const { redactSecrets, setSecret, getSecret, hasSecret } = await import("./secrets");
const { inspectZip, extractZipSafe, isUnsafePath } = await import("./ziputil");
const { PROVIDERS, getProvider } = await import("./providers");
const { createJob, updateJob, cancelJob, getJob } = await import("./jobs");
const { registerRoutes } = await import("./routes");
const Fastify = (await import("fastify")).default;

const app = Fastify({ bodyLimit: 50 * 1024 * 1024 });
registerRoutes(app);
beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("secrets", () => {
  it("stores and retrieves secrets with 600 perms, env wins", () => {
    setSecret("elevenlabs", "test-secret-value-123456");
    expect(getSecret("elevenlabs")).toBe("test-secret-value-123456");
    expect(hasSecret("elevenlabs")).toBe(true);
    const mode = fs.statSync(path.join(tmp, "secrets.json")).mode & 0o777;
    expect(mode).toBe(0o600);
    process.env.ELEVENLABS_API_KEY = "env-wins-secret-98765";
    expect(getSecret("elevenlabs")).toBe("env-wins-secret-98765");
    delete process.env.ELEVENLABS_API_KEY;
    setSecret("elevenlabs", "");
    expect(hasSecret("elevenlabs")).toBe(false);
  });
  it("redacts stored secrets and key-like strings from logs", () => {
    setSecret("openai", "sk-proj-supersecret12345678");
    const msg = "error calling api with key sk-proj-supersecret12345678 and Bearer abcdefghijk12345 done";
    const red = redactSecrets(msg);
    expect(red).not.toContain("supersecret");
    expect(red).not.toContain("Bearer abcdefghijk12345");
    setSecret("openai", "");
  });
});

describe("zip safety", () => {
  it("flags traversal paths", () => {
    expect(isUnsafePath("../etc/passwd")).toBe(true);
    expect(isUnsafePath("/abs/path.wav")).toBe(true);
    expect(isUnsafePath("C:\\windows\\evil.wav")).toBe(true);
    expect(isUnsafePath("kicks/kick 01.wav")).toBe(false);
    expect(isUnsafePath("weird..name.wav")).toBe(false);
  });
  it("inspects and classifies entries", () => {
    const zip = zipSync({
      "pack/kick.wav": new Uint8Array(100),
      "pack/readme.txt": strToU8("license info"),
      "pack/evil.exe": new Uint8Array(10),
      "../traversal.wav": new Uint8Array(5),
    });
    const { entries, unsafe } = inspectZip(zip);
    expect(unsafe).toEqual(["../traversal.wav"]);
    expect(entries.find((e) => e.path === "pack/kick.wav")?.kind).toBe("audio");
    expect(entries.find((e) => e.path === "pack/evil.exe")?.kind).toBe("ignored");
  });
  it("safe extraction skips executables and throws on traversal", () => {
    const good = zipSync({ "a/kick.wav": new Uint8Array(50), "a/x.exe": new Uint8Array(5) });
    const files = extractZipSafe(good);
    expect(files.has("a/kick.wav")).toBe(true);
    expect(files.has("a/x.exe")).toBe(false);
    const evil = zipSync({ "../../evil.wav": new Uint8Array(5) });
    expect(() => extractZipSafe(evil)).toThrow(/Unsafe path/);
  });
});

describe("providers", () => {
  it("registers every adapter with honest capability flags", () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(10); // spec minimum; expansion adapters welcome
    const ids = PROVIDERS.map((p) => p.id);
    for (const id of ["anthropic", "openai", "gemini", "openrouter", "openai-compatible", "ollama", "elevenlabs", "generic-audio-sync", "generic-audio-async", "replicate", "manual-import"]) {
      expect(ids).toContain(id);
    }
    // manual import claims nothing; audio adapters don't claim composition
    expect(getProvider("manual-import").capabilities).toHaveLength(0);
    expect(getProvider("elevenlabs").capabilities).not.toContain("composition");
    expect(getProvider("anthropic").chat).toBeTypeOf("function");
    expect(getProvider("elevenlabs").generateAudio).toBeTypeOf("function");
    // a capability is only claimed when the method backing it actually exists
    for (const p of PROVIDERS) {
      if (p.capabilities.includes("stem-separation")) expect(p.separateStems).toBeTypeOf("function");
      if (p.capabilities.includes("text-to-sound")) expect(p.generateAudio).toBeTypeOf("function");
    }
  });
  it("unconfigured providers report so via test", async () => {
    const res = await getProvider("anthropic").testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/No API key/);
  });
});

describe("jobs", () => {
  it("lifecycle + cancellation", () => {
    const job = createJob({ kind: "generate-sound", providerId: "elevenlabs", model: "", prompt: "boom" });
    expect(getJob(job.id)?.status).toBe("queued");
    updateJob(job.id, { status: "running", progress: 0.5 });
    expect(cancelJob(job.id)).toBe(true);
    expect(getJob(job.id)?.status).toBe("cancelled");
    expect(cancelJob(job.id)).toBe(false);
  });
});

describe("API routes", () => {
  it("health endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
  it("providers list never exposes key material", async () => {
    setSecret("anthropic", "sk-ant-supersecret-abcdef123456");
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("supersecret");
    const anthropic = res.json().providers.find((p: any) => p.id === "anthropic");
    expect(anthropic.configured).toBe(true);
    setSecret("anthropic", "");
  });
  it("rejects invalid bodies", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/compose", payload: { nope: 1 } });
    expect(res.statusCode).toBe(400);
  });
  it("compose validates AI output through the schema (mocked provider)", async () => {
    const ollama = getProvider("ollama");
    const spy = vi.spyOn(ollama, "chat" as any).mockResolvedValue(JSON.stringify({
      version: 1, title: "Test Song", bpm: 90,
      sections: [{ name: "Verse", role: "verse", lengthBars: 4, drumPattern: [{ sound: "kick", step: 0, velocity: 1 }] }],
    }));
    const res = await app.inject({ method: "POST", url: "/api/ai/compose", payload: { providerId: "ollama", prompt: "make a beat" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().composition.title).toBe("Test Song");
    spy.mockRestore();
  });
  it("compose retries once then errors on persistent garbage", async () => {
    const ollama = getProvider("ollama");
    const spy = vi.spyOn(ollama, "chat" as any).mockResolvedValue("I refuse to output JSON, here is prose instead.");
    const res = await app.inject({ method: "POST", url: "/api/ai/compose", payload: { providerId: "ollama", prompt: "make a beat" } });
    expect(res.statusCode).toBe(502);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("edit-plan validates commands (mocked provider)", async () => {
    const ollama = getProvider("ollama");
    const spy = vi.spyOn(ollama, "chat" as any).mockResolvedValue(JSON.stringify({
      version: 1, title: "Turn it down", explanation: "Lower master volume",
      commands: [{ type: "setTrackVolume", mixerChannelId: "master", volumeDb: -6 }],
    }));
    const res = await app.inject({ method: "POST", url: "/api/ai/edit-plan", payload: { providerId: "ollama", prompt: "quieter", projectSummary: "mixer: master" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.commands[0].type).toBe("setTrackVolume");
    spy.mockRestore();
  });
  it("generation rejects providers without audio capability", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/generate-sound", payload: { providerId: "anthropic", prompt: "kick drum" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not support audio/);
  });
  it("generation creates a tracked job with a mocked audio provider", async () => {
    const el = getProvider("elevenlabs");
    const spy = vi.spyOn(el, "generateAudio" as any).mockResolvedValue({ audio: Buffer.from([1, 2, 3, 4]), mime: "audio/mpeg", licenseNote: "test" });
    setSecret("elevenlabs", "fake-key-for-test-123456");
    const res = await app.inject({ method: "POST", url: "/api/ai/generate-sound", payload: { providerId: "elevenlabs", prompt: "808 kick", durationSec: 2 } });
    expect(res.statusCode).toBe(200);
    const jobId = res.json().job.id;
    await vi.waitFor(async () => {
      const jr = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
      expect(jr.json().job.status).toBe("completed");
    });
    const jr = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
    const assetId = jr.json().job.assetId;
    expect(assetId).toBeTruthy();
    const ar = await app.inject({ method: "GET", url: `/api/assets/${assetId}` });
    expect(ar.statusCode).toBe(200);
    expect(ar.rawPayload.length).toBe(4);
    spy.mockRestore();
    setSecret("elevenlabs", "");
  });
  it("asset endpoint rejects traversal-shaped ids", async () => {
    const res = await app.inject({ method: "GET", url: "/api/assets/..%2F..%2Fsecrets.json" });
    expect(res.statusCode).toBe(404);
  });
  it("pack inspect flags unsafe entries over HTTP", async () => {
    const zip = zipSync({ "kick.wav": new Uint8Array(10), "../evil.wav": new Uint8Array(3) });
    const res = await app.inject({ method: "POST", url: "/api/packs/inspect", payload: { zipBase64: Buffer.from(zip).toString("base64") } });
    expect(res.statusCode).toBe(200);
    expect(res.json().unsafe).toContain("../evil.wav");
  });
  it("pack download refuses non-https", async () => {
    const res = await app.inject({ method: "POST", url: "/api/packs/download", payload: { url: "http://insecure.example.com/pack.zip" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("stem separation", () => {
  it("rejects providers without stem support", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/ai/separate-stems",
      payload: { providerId: "anthropic", audioBase64: "A".repeat(200), audioMime: "audio/wav" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not support stem separation/);
  });
  it("runs a stem job via mocked replicate and returns per-stem assets", async () => {
    const rep = getProvider("replicate");
    vi.spyOn(rep, "separateStems" as any).mockResolvedValue({
      stems: {
        vocals: { data: Buffer.from("vv"), mime: "audio/wav" },
        drums: { data: Buffer.from("dd"), mime: "audio/wav" },
        bass: { data: Buffer.from("bb"), mime: "audio/wav" },
        other: { data: Buffer.from("oo"), mime: "audio/wav" },
      },
      licenseNote: "test",
    });
    const res = await app.inject({
      method: "POST", url: "/api/ai/separate-stems",
      payload: { providerId: "replicate", audioBase64: Buffer.from("x".repeat(200)).toString("base64"), audioMime: "audio/wav", sourceName: "song.wav" },
    });
    expect(res.statusCode).toBe(200);
    const jobId = res.json().job.id;
    await vi.waitFor(async () => {
      const jr = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
      expect(jr.json().job.status).toBe("completed");
      expect(Object.keys(jr.json().job.stems)).toEqual(["vocals", "drums", "bass", "other"]);
    });
    // each stem downloadable through the assets endpoint
    const jr = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
    for (const assetId of Object.values(jr.json().job.stems) as string[]) {
      const ar = await app.inject({ method: "GET", url: `/api/assets/${assetId}` });
      expect(ar.statusCode).toBe(200);
    }
  });
});
