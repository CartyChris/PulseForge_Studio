import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.PF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pf-prod-"));
process.env.PF_NO_SHELL_ENV = "1";
const { buildApp } = await import("./index");
const { getProvider } = await import("./providers");
const { extractJson } = await import("./ai-json");
const app = await buildApp({ logger: false });
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
afterEach(() => { vi.restoreAllMocks(); });

const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, headers: { host: "127.0.0.1:7800" } });
const mockChat = (...replies: string[]) => {
  const p = getProvider("anthropic");
  const spy = vi.fn();
  for (const r of replies) spy.mockResolvedValueOnce(r);
  (p as { chat?: unknown }).chat = spy;
  return spy;
};

describe("extractJson", () => {
  it("handles fences, prose and braces inside strings or after the object", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nhope {this} helps')).toEqual({ a: 1 });
    expect(extractJson('{"t": "use {braces} freely", "n": 2} — also see {x}')).toEqual({ t: "use {braces} freely", n: 2 });
    expect(extractJson('noise { not json } then {"ok": true}')).toEqual({ ok: true });
    expect(() => extractJson("no json here")).toThrow(/no JSON/);
  });
});

describe("POST /api/ai/produce/plan", () => {
  it("returns a validated spec from a fenced, chatty reply", async () => {
    const spy = mockChat('Here you go:\n```json\n{"version":1,"title":"Night Run","genre":"drill","bpm":142,"key":"F#","scale":"minor","drums":{"hat-closed":"x.x.x.x.x.x.rrrr"}}\n```');
    const res = await post("/api/ai/produce/plan", { providerId: "anthropic", prompt: "dark drill", catalog: "kits: drill-uk" });
    expect(res.statusCode).toBe(200);
    expect(res.json().spec.genre).toBe("drill");
    expect(res.json().spec.length).toBe("standard"); // default filled
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].system).toContain("executive producer");
    expect(spy.mock.calls[0]![0].user).toContain("drill-uk"); // catalog reaches the model
  });

  it("repairs an invalid first answer with one retry", async () => {
    const spy = mockChat('{"genre":"trap","bpm":400}', '{"genre":"trap","bpm":140}');
    const res = await post("/api/ai/produce/plan", { providerId: "anthropic", prompt: "trap" });
    expect(res.statusCode).toBe(200);
    expect(res.json().spec.bpm).toBe(140);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0].user).toMatch(/previous response was invalid/i);
  });

  it("fails cleanly (502, no crash) when both answers are unusable", async () => {
    mockChat("I can't do that", "still no json");
    const res = await post("/api/ai/produce/plan", { providerId: "anthropic", prompt: "trap" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/JSON/);
  });

  it("rejects bad bodies before calling any model", async () => {
    const spy = mockChat("{}");
    expect((await post("/api/ai/produce/plan", { providerId: "anthropic", prompt: "" })).statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/produce/revise", () => {
  it("accepts a respec", async () => {
    mockChat(JSON.stringify({ action: "respec", spec: { genre: "phonk", seed: 5 }, explanation: "darker + cowbells" }));
    const res = await post("/api/ai/produce/revise", { providerId: "anthropic", prompt: "make it phonk", spec: { genre: "trap" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.action).toBe("respec");
    expect(res.json().result.spec.genre).toBe("phonk");
  });
  it("accepts an edit plan with the new beat commands", async () => {
    mockChat(JSON.stringify({ action: "edit", plan: { version: 1, title: "Busier hats", commands: [{ type: "setDrumGrid", patternId: "p1", channelId: "c1", grid: "xxxxxxxxxxxxrrrr" }] } }));
    const res = await post("/api/ai/produce/revise", { providerId: "anthropic", prompt: "busier hats", spec: {} });
    expect(res.json().result.plan.commands[0].type).toBe("setDrumGrid");
  });
  it("rejects commands outside the schema (e.g. a bad grid)", async () => {
    mockChat(
      JSON.stringify({ action: "edit", plan: { version: 1, title: "x", commands: [{ type: "setDrumGrid", patternId: "p", channelId: "c", grid: "rm -rf" }] } }),
      JSON.stringify({ action: "edit", plan: { version: 1, title: "x", commands: [{ type: "runShell", cmd: "ls" }] } }),
    );
    const res = await post("/api/ai/produce/revise", { providerId: "anthropic", prompt: "x", spec: {} });
    expect(res.statusCode).toBe(502);
  });
});

describe("POST /api/ai/produce/critique", () => {
  it("returns verdict, issues and conservative commands", async () => {
    mockChat(JSON.stringify({ verdict: "revise", summary: "Bass is heavy.", issues: ["low end 68%"], commands: [{ type: "setTrackVolume", mixerChannelId: "mx1", volumeDb: -7 }] }));
    const res = await post("/api/ai/produce/critique", { providerId: "anthropic", goal: "trap", spec: { genre: "trap" }, metrics: "lufs -6.1, low 0.68" });
    expect(res.statusCode).toBe(200);
    expect(res.json().critique.verdict).toBe("revise");
    expect(res.json().critique.commands).toHaveLength(1);
  });
});
