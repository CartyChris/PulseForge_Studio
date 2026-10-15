import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.PF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pf-sec-"));
process.env.PF_NO_SHELL_ENV = "1";
const { isAllowedRequest } = await import("./routes");
const { buildApp } = await import("./index");
const app = await buildApp({ logger: false });

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

describe("cross-site request guard", () => {
  it("allows the app itself, curl and local tools", () => {
    expect(isAllowedRequest(undefined, "127.0.0.1:7800", false)).toBe(true);           // curl / Electron main
    expect(isAllowedRequest("http://127.0.0.1:7800", "127.0.0.1:7800", false)).toBe(true);
    expect(isAllowedRequest("http://localhost:7800", "127.0.0.1:7801", false)).toBe(true); // vite dev proxy
    expect(isAllowedRequest("http://192.168.1.20:7800", "192.168.1.20:7800", false)).toBe(true); // LAN/iPhone mode
  });
  it("blocks any other website", () => {
    expect(isAllowedRequest("https://evil.example", "127.0.0.1:7800", false)).toBe(false);
    expect(isAllowedRequest("https://evil.example", "localhost:7800", false)).toBe(false);
  });
  it("blocks DNS rebinding (hostile domain resolving to 127.0.0.1 looks same-origin)", () => {
    expect(isAllowedRequest("http://evil.example:7800", "evil.example:7800", false)).toBe(false);
    expect(isAllowedRequest(undefined, "evil.example:7800", false)).toBe(false);
  });
  it("serverless (Vercel) accepts same-origin from its own domain only", () => {
    expect(isAllowedRequest("https://pulseforge.vercel.app", "pulseforge.vercel.app", true)).toBe(true);
    expect(isAllowedRequest("https://evil.example", "pulseforge.vercel.app", true)).toBe(false);
  });

  it("over HTTP: a foreign Origin is refused with 403 before any route runs", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/ai/compose", headers: { origin: "https://evil.example", host: "127.0.0.1:7800" }, payload: { providerId: "cli-claude", prompt: "x" } });
    expect(bad.statusCode).toBe(403);
    const rebind = await app.inject({ method: "GET", url: "/api/providers", headers: { host: "evil.example:7800" } });
    expect(rebind.statusCode).toBe(403);
    const ok = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:7800" } });
    expect(ok.statusCode).toBe(200);
  });

  it("CORS headers are only granted to local origins", async () => {
    const local = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://localhost:7800", host: "127.0.0.1:7801" } });
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:7800");
    const foreign = await app.inject({ method: "OPTIONS", url: "/api/health", headers: { origin: "https://evil.example", host: "127.0.0.1:7800", "access-control-request-method": "POST" } });
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
