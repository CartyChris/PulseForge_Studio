import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";

process.env.PF_SERVERLESS = "1";
process.env.PF_NO_SHELL_ENV = "1";
process.env.PF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pf-sls-"));
process.env.ANTHROPIC_API_KEY = "sk-ant-OWNER-KEY-MUST-NOT-BE-USED";

const handler = (await import("./serverless")).default;
const { originalUrl } = await import("./serverless");
const { getProvider } = await import("./providers");
const { getSecret, getProviderConfig } = await import("./secrets");
const { isSafePublicUrl } = await import("./request-context");

let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // warm the lazily-built backend here (cold start can take a while on a loaded machine)
  await fetch(`${base}/api/health`);
}, Number(process.env.PF_TEST_WARMUP_MS ?? 180_000)); // cold-loading Fastify can take minutes on a slow/iCloud-synced disk
afterAll(() => { server.close(); delete process.env.PF_SERVERLESS; delete process.env.ANTHROPIC_API_KEY; });

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("serverless (Vercel) entry", () => {
  it("reports serverless mode, through both the direct and rewritten paths", async () => {
    expect(((await (await fetch(`${base}/api/health`)).json()) as { mode: string }).mode).toBe("serverless");
    expect(((await (await fetch(`${base}/api?__pfp=health`)).json()) as { mode: string }).mode).toBe("serverless");
    expect(originalUrl("/api?__pfp=jobs/abc&x=1")).toBe("/api/jobs/abc?x=1");
    expect(originalUrl("/api/health")).toBe("/api/health");
  });

  it("uses ONLY the visitor's own key — the owner's server env key is ignored", async () => {
    const seen: Array<string | null> = [];
    const p = getProvider("anthropic") as { chat?: unknown };
    p.chat = vi.fn(async () => { seen.push(getSecret("anthropic")); return JSON.stringify({ genre: "trap" }); });
    const ok = await fetch(`${base}/api/ai/produce/plan`, {
      method: "POST", headers: { "content-type": "application/json", "x-pf-byok": b64({ anthropic: "sk-ant-VISITOR-1234567" }) },
      body: JSON.stringify({ providerId: "anthropic", prompt: "trap" }),
    });
    expect(ok.status).toBe(200);
    expect(seen).toEqual(["sk-ant-VISITOR-1234567"]);
    // without a key: provider sees nothing (the env key must not leak to strangers)
    seen.length = 0;
    await fetch(`${base}/api/ai/produce/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: "anthropic", prompt: "trap" }) });
    expect(seen).toEqual([null]);
    expect(getSecret("anthropic")).toBeNull(); // outside any request context
  });

  it("isolates concurrent visitors' keys", async () => {
    const p = getProvider("anthropic") as { chat?: unknown };
    p.chat = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 30));
      return JSON.stringify({ genre: "trap", title: getSecret("anthropic") ?? "none" });
    });
    const call = (key: string) => fetch(`${base}/api/ai/produce/plan`, {
      method: "POST", headers: { "content-type": "application/json", "x-pf-byok": b64({ anthropic: key }) },
      body: JSON.stringify({ providerId: "anthropic", prompt: "x" }),
    }).then((r) => r.json() as Promise<{ spec: { title: string } }>);
    const keys = Array.from({ length: 8 }, (_, i) => `sk-ant-visitor-${i}-abcdefgh`);
    const results = await Promise.all(keys.map(call));
    expect(results.map((r) => r.spec.title)).toEqual(keys);
  });

  it("strips private/metadata endpoints from visitor config (SSRF guard)", async () => {
    let cfg: Record<string, string> = {};
    const p = getProvider("anthropic") as { chat?: unknown };
    p.chat = vi.fn(async () => { cfg = getProviderConfig("openai-compatible"); return "{}"; });
    await fetch(`${base}/api/ai/produce/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pf-byok": b64({ anthropic: "sk-ant-v-12345678" }), "x-pf-config": b64({ "openai-compatible": { baseUrl: "http://169.254.169.254/latest", model: "m" } }) },
      body: JSON.stringify({ providerId: "anthropic", prompt: "x" }),
    });
    expect(cfg.baseUrl).toBeUndefined();
    expect(cfg.model).toBe("m");
    expect(isSafePublicUrl("https://api.example.com/v1")).toBe(true);
    for (const bad of ["http://api.example.com", "https://localhost:1", "https://10.0.0.5", "https://192.168.1.9", "https://169.254.169.254", "https://[::1]", "https://metadata.google.internal"]) {
      expect(isSafePublicUrl(bad), bad).toBe(false);
    }
  });

  it("desktop-only features refuse with a clear message; cross-site calls are blocked", async () => {
    const stems = await fetch(`${base}/api/ai/separate-stems`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: "replicate", audioBase64: "A".repeat(200), audioMime: "audio/wav" }) });
    expect(stems.status).toBe(400);
    expect(((await stems.json()) as { error: string }).error).toMatch(/desktop app/);
    const secret = await fetch(`${base}/api/providers/secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: "anthropic", apiKey: "x" }) });
    expect(secret.status).toBe(400);
    const evil = await fetch(`${base}/api/providers`, { headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
  });
});
