/**
 * CLI bridge — lets PulseForge use the AI *subscriptions* a user already has by
 * running their own, officially installed CLIs (Claude Code, Codex, Kimi Code,
 * Grok Build) as subprocesses. Each CLI uses its OWN stored login.
 *
 * HARD RULES (security + provider terms):
 *  - We never read, copy or reuse another app's credential files or Keychain items.
 *    "Logged in" is only ever determined by a real test prompt succeeding.
 *  - Only the four allow-listed provider ids below can execute anything, and only
 *    the binary NAME is fixed per id — the HTTP API can never supply a binary path,
 *    extra CLI flags, or a cwd.
 *  - spawn(absolutePath, argv[], { shell: false }) — never a shell string. Prompt
 *    text travels as one argv element or on stdin, verbatim.
 *  - Fresh empty temp dir as cwd per call (deleted afterwards), minimal env
 *    allow-list (no *_API_KEY — otherwise the CLI would silently bill an API key
 *    instead of the subscription), hard timeout that kills the whole process
 *    group, 4 MB output cap, ANSI stripped.
 *  - Desktop/local mode only: PF_SERVERLESS=1 → every CLI provider is unavailable.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AIProviderAdapter, ChatRequest, ConnectionTestResult } from "./providers";
import { getProviderConfig, redactSecrets, setImportedEnv, SHELL_ENV_ALLOWLIST } from "./secrets";

// ---------------------------------------------------------------------------
// test seams (spawn + discovery are injectable so tests never run real CLIs)
// ---------------------------------------------------------------------------
type SpawnFn = (file: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;
let spawnImpl: SpawnFn = nodeSpawn as SpawnFn;
/** @internal tests only */
export function _setSpawnForTests(fn: SpawnFn | null): void {
  spawnImpl = fn ?? (nodeSpawn as SpawnFn);
}
let discoveryOverride: Record<string, string | null> | null = null;
/** @internal tests only — map binary name → absolute path (or null = not installed). */
export function _setDiscoveryForTests(map: Record<string, string | null> | null): void {
  discoveryOverride = map;
  clearCliCaches();
}

export const isServerless = (): boolean => process.env.PF_SERVERLESS === "1";

// ---------------------------------------------------------------------------
// allow-lists
// ---------------------------------------------------------------------------
export type CliProviderId = "cli-claude" | "cli-codex" | "cli-kimi" | "cli-grok";

export interface CliSpec {
  id: CliProviderId;
  name: string;
  binary: string;
  /** how the user signs in, shown when a run fails for auth reasons */
  loginHint: string;
  vendor: string;
}

export const CLI_SPECS: Record<CliProviderId, CliSpec> = {
  "cli-claude": { id: "cli-claude", name: "Claude Code (subscription)", binary: "claude", vendor: "Anthropic", loginHint: "Claude Code isn't logged in — run `claude` once in Terminal and sign in with your Claude subscription." },
  "cli-codex": { id: "cli-codex", name: "Codex CLI (ChatGPT subscription)", binary: "codex", vendor: "OpenAI", loginHint: "Codex isn't logged in — run `codex login` in Terminal and sign in with ChatGPT." },
  "cli-kimi": { id: "cli-kimi", name: "Kimi Code (subscription)", binary: "kimi", vendor: "Moonshot AI", loginHint: "Kimi Code isn't logged in — run `kimi login` in Terminal." },
  "cli-grok": { id: "cli-grok", name: "Grok Build (subscription)", binary: "grok", vendor: "xAI", loginHint: "Grok Build isn't logged in — run `grok login` in Terminal." },
};
export const CLI_PROVIDER_IDS = Object.keys(CLI_SPECS) as CliProviderId[];

/** Detected-but-not-yet-supported CLIs (reported with supported:false; only `--version` is ever run). */
export const UNSUPPORTED_CLIS: { id: string; name: string; binary: string }[] = [
  { id: "gemini", name: "Gemini CLI", binary: "gemini" },
  { id: "opencode", name: "opencode", binary: "opencode" },
  { id: "qwen", name: "Qwen Code", binary: "qwen" },
  { id: "cursor-agent", name: "Cursor Agent", binary: "cursor-agent" },
  { id: "goose", name: "Goose", binary: "goose" },
];

const ALLOWED_BINARIES = new Set([...Object.values(CLI_SPECS).map((s) => s.binary), ...UNSUPPORTED_CLIS.map((s) => s.binary)]);

export function isCliProviderId(id: string): id is CliProviderId {
  return Object.prototype.hasOwnProperty.call(CLI_SPECS, id);
}

// ---------------------------------------------------------------------------
// process runner
// ---------------------------------------------------------------------------
export const DEFAULT_CLI_TIMEOUT_MS = 180_000;
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface RunOptions {
  file: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxBytes?: number;
  signal?: AbortSignal;
}
export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  cancelled: boolean;
  spawnError?: string;
}

const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "").replace(/\r(?!\n)/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function killTree(child: ChildProcess, sig: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, sig); // whole process group (detached)
  } catch {
    try { child.kill(sig); } catch { /* already gone */ }
  }
}

/** Run one process safely: no shell, own process group, hard timeout, output cap. Never rejects. */
export function runProcess(opts: RunOptions): Promise<RunResult> {
  const maxBytes = opts.maxBytes ?? MAX_OUTPUT_BYTES;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(opts.file, [...opts.args], {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        detached: true, // own process group → killTree reaches grandchildren too
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false, cancelled: false, spawnError: String(e) });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let hardKill: NodeJS.Timeout | undefined;
    const stop = () => {
      killTree(child, "SIGTERM");
      hardKill = setTimeout(() => killTree(child, "SIGKILL"), 2000);
      hardKill.unref?.();
    };
    const take = (sink: Buffer[]) => (chunk: Buffer) => {
      if (truncated) return;
      const room = maxBytes - bytes;
      if (chunk.length > room) {
        sink.push(chunk.subarray(0, Math.max(0, room)));
        bytes = maxBytes;
        truncated = true;
        stop();
        return;
      }
      sink.push(chunk);
      bytes += chunk.length;
    };
    child.stdout?.on("data", take(out));
    child.stderr?.on("data", take(err));
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        code, signal, timedOut, truncated, cancelled, spawnError,
        stdout: stripAnsi(Buffer.concat(out).toString("utf8")),
        stderr: stripAnsi(Buffer.concat(err).toString("utf8")),
      });
    };
    child.on("error", (e) => finish(null, null, String(e)));
    child.on("close", (code, signal) => finish(code, signal));
    if (child.stdin) {
      child.stdin.on("error", () => { /* EPIPE when the CLI exits early — ignore */ });
      if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
      else child.stdin.end();
    }
  });
}

// ---------------------------------------------------------------------------
// environment + binary discovery
// ---------------------------------------------------------------------------
const HOME = () => os.homedir();

function userShell(): string | null {
  const candidates = [process.env.SHELL, (() => { try { return os.userInfo().shell ?? undefined; } catch { return undefined; } })(), "/bin/zsh", "/bin/bash"];
  for (const c of candidates) {
    if (c && path.isAbsolute(c) && fs.existsSync(c)) return c;
  }
  return null;
}

/** Minimal env for the login-shell probes themselves. */
function probeEnv(): NodeJS.ProcessEnv {
  return {
    HOME: HOME(),
    USER: process.env.USER ?? os.userInfo().username,
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? os.userInfo().username,
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    TERM: "dumb",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  };
}

const SHELL_PROBE_TIMEOUT_MS = 4000;
let shellPathCache: Promise<string[]> | null = null;
let shellPathResolved: string[] = [];

/** PATH entries from the user's interactive login shell (cached; 4 s timeout; [] on failure). */
export function getLoginShellPath(): Promise<string[]> {
  if (discoveryOverride) return Promise.resolve([]);
  if (isServerless()) return Promise.resolve([]);
  if (!shellPathCache) {
    shellPathCache = (async () => {
      const shell = userShell();
      if (!shell) return [];
      const r = await runProcess({
        file: shell,
        // constant command — no user data is ever interpolated into a shell string
        args: ["-ilc", 'printf "__PF_PATH_BEGIN__%s__PF_PATH_END__" "$PATH"'],
        cwd: HOME(),
        env: probeEnv(),
        timeoutMs: SHELL_PROBE_TIMEOUT_MS,
        maxBytes: 256 * 1024,
      });
      const m = /__PF_PATH_BEGIN__([\s\S]*?)__PF_PATH_END__/.exec(r.stdout);
      shellPathResolved = m?.[1] ? m[1].split(":").filter((d) => d && path.isAbsolute(d)) : [];
      return shellPathResolved;
    })();
  }
  return shellPathCache;
}

/** Well-known install dirs (+ every nvm node version's bin). */
export function wellKnownDirs(): string[] {
  const h = HOME();
  const dirs = [
    path.join(h, ".local/bin"), path.join(h, ".kimi-code/bin"), "/opt/homebrew/bin", "/usr/local/bin",
    path.join(h, ".bun/bin"), path.join(h, ".npm-global/bin"), path.join(h, ".lmstudio/bin"), path.join(h, ".cargo/bin"),
  ];
  try {
    const nvm = path.join(h, ".nvm/versions/node");
    for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, "bin"));
  } catch { /* no nvm */ }
  return dirs;
}

function searchDirs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...shellPathResolved, ...wellKnownDirs(), ...(process.env.PATH ?? "").split(":"), "/usr/bin", "/bin"]) {
    if (d && path.isAbsolute(d) && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out;
}

function isExecutableFile(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Sync lookup using already-known dirs (no spawning). */
export function findBinarySync(binary: string): string | null {
  if (!ALLOWED_BINARIES.has(binary)) return null;
  if (discoveryOverride) return discoveryOverride[binary] ?? null;
  for (const d of searchDirs()) {
    const p = path.join(d, binary);
    if (isExecutableFile(p)) return p;
  }
  return null;
}

/** Full lookup: login-shell PATH ∪ well-known dirs ∪ process PATH. */
export async function findBinary(binary: string): Promise<string | null> {
  if (!ALLOWED_BINARIES.has(binary)) return null;
  if (discoveryOverride) return discoveryOverride[binary] ?? null;
  await getLoginShellPath();
  return findBinarySync(binary);
}

/** The env a CLI run gets: an explicit allow-list, nothing else (no API keys, no proxies, no NODE_OPTIONS). */
export function buildCliEnv(binaryPath: string, src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const binDir = path.dirname(binaryPath);
  // node-script CLIs (#!/usr/bin/env node — codex, grok) need a node next to them: their own dir goes first
  const pathDirs = [binDir, ...searchDirs().filter((d) => d !== binDir), "/usr/sbin", "/sbin"];
  const env: NodeJS.ProcessEnv = {
    PATH: [...new Set(pathDirs)].join(":"),
    HOME: src.HOME ?? HOME(),
    TERM: "dumb",
    NO_COLOR: "1",
    LANG: src.LANG ?? "en_US.UTF-8",
  };
  for (const k of ["USER", "LOGNAME", "TMPDIR", "CODEX_HOME"]) if (src[k]) env[k] = src[k];
  for (const [k, v] of Object.entries(src)) {
    if ((k.startsWith("KIMI_") || k.startsWith("XDG_")) && v && !/(_API_KEY|_TOKEN|_SECRET)$/.test(k)) env[k] = v;
  }
  return env;
}

// ---------------------------------------------------------------------------
// argv builders (pure — snapshot-tested)
// ---------------------------------------------------------------------------
export interface CliTurn {
  system: string;
  prompt: string;
  model?: string;
  jsonSchema?: object;
}
export interface CliInvocation {
  args: string[];
  stdin?: string;
  /** file the CLI writes its final answer to (codex -o) */
  outFile?: string;
  /** files the runner writes into tmpDir before spawning (kimi's tools-free agent definition) */
  files?: Array<{ path: string; content: string }>;
}

/** Kimi agent definition with every tool and sub-agent disabled (`tools: []` is enforced again before
 * execution, per the Kimi Code agents docs; verified: a "write a file" request is refused). Without it,
 * `kimi -p` auto-runs tools — and `--plan` cannot be combined with `-p`. The body is the system prompt. */
export function kimiAgentFile(system: string): string {
  return `---\nname: pulseforge-answer\ndescription: Answer-only assistant for PulseForge Studio (no tools)\ntools: []\nsubagents: []\n---\n\n${system.trim() || "Answer the user's request in plain text."}\n`;
}

/** Final assistant text from `kimi --output-format stream-json` (one JSON object per line). */
export function parseKimiStream(stdout: string): string {
  let last = "";
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue; // warnings etc.
    try {
      const m = JSON.parse(t) as { role?: string; content?: unknown };
      if (m.role !== "assistant") continue;
      if (typeof m.content === "string" && m.content.trim()) last = m.content;
      else if (Array.isArray(m.content)) {
        const text = m.content.map((c: { type?: string; text?: string }) => (c?.type === "text" && typeof c.text === "string" ? c.text : "")).join("");
        if (text.trim()) last = text;
      }
    } catch { /* partial line */ }
  }
  return stripAnsi(last).trim();
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,127}$/;
export function validateModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (!MODEL_RE.test(model)) throw new Error(`Invalid model id "${model.slice(0, 60)}" — letters, digits and . _ : / @ - [ ] only`);
  return model;
}

/** Codex and Kimi have no system-prompt flag: the system text is prepended to the prompt. */
export function combinePrompt(system: string, prompt: string): string {
  return system.trim() ? `${system.trim()}\n\n---\n\n${prompt}` : prompt;
}

export function buildCliInvocation(id: CliProviderId, turn: CliTurn, tmpDir: string): CliInvocation {
  const model = validateModel(turn.model);
  switch (id) {
    case "cli-claude":
      // NOT --bare (it skips the keychain → breaks subscription login). Prompt on stdin.
      return {
        args: [
          "-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
          "--setting-sources", "project", "--strict-mcp-config",
          "--system-prompt", turn.system,
          ...(model ? ["--model", model] : []),
        ],
        stdin: turn.prompt,
      };
    case "cli-codex": {
      const outFile = path.join(tmpDir, "last-message.txt");
      return {
        // PROMPT "-" = read instructions from stdin (codex exec --help). Never a positional prompt:
        // "review"/"resume" are subcommands and a leading "-" would parse as a flag.
        args: [
          "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--color", "never",
          "-C", tmpDir, "-o", outFile, ...(model ? ["-m", model] : []), "-",
        ],
        stdin: combinePrompt(turn.system, turn.prompt),
        outFile,
      };
    }
    case "cli-kimi": {
      // commander consumes the next argv element as -p's value even if it starts with "-" (verified).
      // Tools are disabled by the agent file (see kimiAgentFile); the system prompt lives there too.
      const agentPath = path.join(tmpDir, "pulseforge-agent.md");
      return {
        args: ["--agent-file", agentPath, "-p", turn.prompt, "--output-format", "stream-json", ...(model ? ["-m", model] : [])],
        files: [{ path: agentPath, content: kimiAgentFile(turn.system) }],
      };
    }
    case "cli-grok": {
      // clap: attached "--flag=value" form so a prompt starting with "-" can't be parsed as a flag (verified)
      const json = !!turn.jsonSchema;
      return {
        args: [
          `--single=${turn.prompt}`, "--output-format", json ? "json" : "plain", "--cwd", tmpDir,
          "--disable-web-search", "--no-subagents", "--max-turns", "1", "--permission-mode", "plan",
          `--rules=${turn.system}`,
          ...(json ? [`--json-schema=${JSON.stringify(turn.jsonSchema)}`] : []),
          ...(model ? ["-m", model] : []),
        ],
      };
    }
    default: {
      const never: never = id;
      throw new Error(`Unknown CLI provider: ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// output parsing + error classification
// ---------------------------------------------------------------------------
export function parseClaudeJson(stdout: string): { text: string; isError: boolean } {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) throw new Error("Claude Code returned no JSON");
  const data = JSON.parse(trimmed.slice(start)) as { result?: unknown; is_error?: boolean; subtype?: string };
  const text = typeof data.result === "string" ? stripAnsi(data.result) : "";
  return { text, isError: data.is_error === true || (typeof data.subtype === "string" && data.subtype !== "success") };
}

function parseGrokJson(stdout: string): string {
  try {
    const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
    for (const k of ["structured_output", "result", "output", "text", "content", "response"]) {
      const v = data[k];
      if (typeof v === "string") return v;
      if (v && typeof v === "object") return JSON.stringify(v);
    }
  } catch { /* fall through to raw */ }
  return stdout.trim();
}

const AUTH_RE = /failed to authenticate|session expired|could not be refreshed|not logged in|log ?in required|please (run )?\/?log ?in|please sign in|unauthori[sz]ed|\b401\b|invalid (api )?key|authentication (failed|required|error)|oauth token|credentials? (not found|missing|expired)|no (valid )?(auth|credentials)/i;
const LIMIT_RE = /rate.?limit|usage limit|quota|\b429\b|limit reached|too many requests/i;

const CONFIG_RE = /failed to (parse|load)[^\n]*(config|\.toml|\.json|catalog)|config\.toml[^\n]*(error|invalid)/i;

export function classifyFailure(spec: CliSpec, r: RunResult, timeoutMs: number): string {
  if (r.spawnError) return `${spec.name}: could not start \`${spec.binary}\` (${r.spawnError.slice(0, 200)})`;
  if (r.cancelled) return `${spec.name}: cancelled`;
  if (r.timedOut) return `${spec.name} timed out after ${Math.round(timeoutMs / 1000)} s and was stopped.`;
  if (r.truncated) return `${spec.name} produced more than ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB of output and was stopped.`;
  const blob = `${r.stderr}\n${r.stdout}`;
  if (AUTH_RE.test(blob)) return spec.loginHint;
  if (CONFIG_RE.test(blob)) {
    const line = redactSecrets((blob.split("\n").find((l) => CONFIG_RE.test(l)) ?? "").trim().slice(0, 300));
    return `${spec.name} couldn't load its own settings, so it stopped before answering: ${line} — run \`${spec.binary}\` in Terminal to see and fix it (PulseForge never edits your CLI config).`;
  }
  const tail = redactSecrets((r.stderr.trim() || r.stdout.trim()).split("\n").slice(-6).join(" ").slice(-400));
  if (LIMIT_RE.test(blob)) return `${spec.name} hit a usage/rate limit: ${tail}`;
  return `${spec.name} exited with code ${r.code ?? r.signal ?? "?"}${tail ? `: ${tail}` : ""}`;
}

// ---------------------------------------------------------------------------
// one answer-only turn
// ---------------------------------------------------------------------------
function timeoutFor(id: CliProviderId): number {
  const cfg = Number(getProviderConfig(id).timeoutSec);
  if (Number.isFinite(cfg) && cfg >= 5 && cfg <= 1800) return cfg * 1000;
  const env = Number(process.env.PF_CLI_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= 1000) return env;
  return DEFAULT_CLI_TIMEOUT_MS;
}

export interface CliChatOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function runCliChat(id: string, turn: CliTurn, opts: CliChatOptions = {}): Promise<string> {
  if (!isCliProviderId(id)) throw new Error(`Not a CLI provider: ${id}`); // nothing executes
  const spec = CLI_SPECS[id];
  if (isServerless()) throw new Error(`${spec.name} is only available in the PulseForge desktop app (it runs the CLI installed on your Mac).`);
  const bin = await findBinary(spec.binary);
  if (!bin) throw new Error(`${spec.name}: \`${spec.binary}\` is not installed (or not on your PATH). Install it, sign in once in Terminal, then Rescan.`);
  const timeoutMs = opts.timeoutMs ?? timeoutFor(id);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pf-cli-"));
  try {
    const inv = buildCliInvocation(id, turn, tmpDir);
    for (const f of inv.files ?? []) {
      if (path.dirname(f.path) !== tmpDir) throw new Error("refusing to write outside the CLI temp dir");
      await fsp.writeFile(f.path, f.content, { mode: 0o600 });
    }
    const r = await runProcess({ file: bin, args: inv.args, stdin: inv.stdin, cwd: tmpDir, env: buildCliEnv(bin), timeoutMs, signal: opts.signal });
    if (r.spawnError || r.timedOut || r.truncated || r.cancelled) throw new Error(classifyFailure(spec, r, timeoutMs));
    if (id === "cli-claude") {
      let parsed: { text: string; isError: boolean } | null = null;
      try { parsed = parseClaudeJson(r.stdout); } catch { /* not JSON → classify below */ }
      if (parsed && !parsed.isError && r.code === 0) return parsed.text;
      if (parsed?.isError && parsed.text) {
        throw new Error(AUTH_RE.test(parsed.text) ? spec.loginHint : `${spec.name}: ${redactSecrets(parsed.text.slice(0, 400))}`);
      }
      throw new Error(classifyFailure(spec, r, timeoutMs));
    }
    if (r.code !== 0) throw new Error(classifyFailure(spec, r, timeoutMs));
    if (id === "cli-codex") {
      let text = "";
      try { text = await fsp.readFile(inv.outFile!, "utf8"); } catch { /* fall back to stdout */ }
      text = stripAnsi(text).trim() || r.stdout.trim();
      if (!text) throw new Error(`${spec.name} finished without an answer. ${classifyFailure(spec, r, timeoutMs)}`);
      return text;
    }
    if (id === "cli-grok" && turn.jsonSchema) return parseGrokJson(r.stdout);
    if (id === "cli-kimi") {
      const text = parseKimiStream(r.stdout);
      if (!text) throw new Error(`${spec.name} finished without an answer. ${classifyFailure(spec, r, timeoutMs)}`);
      return text;
    }
    const text = r.stdout.trim();
    if (!text) throw new Error(`${spec.name} finished without an answer. ${classifyFailure(spec, r, timeoutMs)}`);
    return text;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// version detection (only `--version`, only allow-listed binaries)
// ---------------------------------------------------------------------------
const versionCache = new Map<string, Promise<string | null>>();
export function getCliVersion(binaryPath: string): Promise<string | null> {
  if (!ALLOWED_BINARIES.has(path.basename(binaryPath))) return Promise.resolve(null);
  let p = versionCache.get(binaryPath);
  if (!p) {
    p = (async () => {
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pf-ver-"));
      try {
        const r = await runProcess({ file: binaryPath, args: ["--version"], cwd: tmpDir, env: buildCliEnv(binaryPath), timeoutMs: 8000, maxBytes: 64 * 1024 });
        if (r.code !== 0) return null;
        const line = (r.stdout.trim() || r.stderr.trim()).split("\n")[0] ?? "";
        return line.trim().slice(0, 80) || null;
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    })();
    versionCache.set(binaryPath, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// login-shell env import (allow-listed NAMES only; every other var is filtered inside the shell)
// ---------------------------------------------------------------------------
let envImportCache: Promise<string[]> | null = null;
/** Parse `NAME=value` lines, keeping only allow-listed names. Exported for tests. */
export function parseAllowlistedEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq);
    if (!SHELL_ENV_ALLOWLIST.includes(name)) continue;
    const value = line.slice(eq + 1).trim();
    if (value) out[name] = value;
  }
  return out;
}

export function importLoginShellEnv(force = false): Promise<string[]> {
  if (isServerless()) return Promise.resolve([]);
  if (force) envImportCache = null;
  if (!envImportCache) {
    envImportCache = (async () => {
      const shell = userShell();
      if (!shell) return [];
      const names = SHELL_ENV_ALLOWLIST.join("|");
      // constant command built only from our own allow-list (A-Z0-9_ names) — no user data
      if (!/^[A-Z0-9_|]+$/.test(names)) return [];
      const r = await runProcess({
        file: shell,
        args: ["-ilc", `printf "__PF_ENV_BEGIN__\\n"; /usr/bin/env | /usr/bin/grep -E '^(${names})='; printf "__PF_ENV_END__\\n"`],
        cwd: HOME(),
        env: probeEnv(),
        timeoutMs: SHELL_PROBE_TIMEOUT_MS,
        maxBytes: 256 * 1024,
      });
      const m = /__PF_ENV_BEGIN__\n([\s\S]*?)__PF_ENV_END__/.exec(r.stdout);
      return setImportedEnv(parseAllowlistedEnv(m?.[1] ?? ""));
    })();
  }
  return envImportCache;
}

export function clearCliCaches(): void {
  shellPathCache = null;
  shellPathResolved = [];
  versionCache.clear();
  envImportCache = null;
}

// ---------------------------------------------------------------------------
// provider adapters
// ---------------------------------------------------------------------------
function cliAdapter(id: CliProviderId): AIProviderAdapter {
  const spec = CLI_SPECS[id];
  return {
    id,
    name: spec.name,
    kind: "text",
    needsKey: false,
    configFields: ["model", "timeoutSec"],
    capabilities: ["composition", "lyrics", "project-analysis"],
    configured: () => !isServerless() && findBinarySync(spec.binary) !== null,
    async testConnection(): Promise<ConnectionTestResult> {
      if (isServerless()) return { ok: false, message: `${spec.name} is only available in the PulseForge desktop app.` };
      const bin = await findBinary(spec.binary);
      if (!bin) return { ok: false, message: `\`${spec.binary}\` not found. Install ${spec.vendor}'s CLI, sign in once in Terminal, then Rescan.` };
      const version = await getCliVersion(bin);
      try {
        const reply = await runCliChat(id, { system: "Reply with exactly: OK", prompt: "Reply with exactly: OK", model: getProviderConfig(id).model || undefined }, { timeoutMs: Math.min(timeoutFor(id), 120_000) });
        const ok = /\bOK\b/i.test(reply);
        return { ok, message: ok ? `Connected via ${spec.binary}${version ? ` (${version})` : ""} — using your ${spec.vendor} subscription login` : `${spec.binary} answered unexpectedly: ${redactSecrets(reply.slice(0, 120))}` };
      } catch (e) {
        return { ok: false, message: redactSecrets(e instanceof Error ? e.message : String(e)) };
      }
    },
    async chat(req: ChatRequest) {
      return runCliChat(id, {
        system: req.system,
        prompt: req.user,
        model: req.model || getProviderConfig(id).model || undefined,
        jsonSchema: id === "cli-grok" ? req.jsonSchema : undefined,
      }, { signal: req.signal });
    },
  };
}

export const CLI_PROVIDERS: AIProviderAdapter[] = CLI_PROVIDER_IDS.map(cliAdapter);
