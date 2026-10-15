/**
 * Connections API — auto-detects what the user already has, without ever touching
 * another app's credentials:
 *   - installed AI CLIs (binary exists + `--version`); whether one is *logged in* is
 *     only ever learned by POST /api/connections/test running a real tiny prompt
 *   - local model servers (Ollama, LM Studio) via their documented list endpoints
 *   - which known API-key env vars are present (names + booleans — NEVER values),
 *     including allow-listed names imported from the login shell for GUI launches
 *
 * Routes: GET /api/connections · POST /api/connections/rescan · POST /api/connections/test
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { PROVIDERS, getProvider } from "./providers";
import { envKeyPresence, getProviderConfig, importedEnvNames, redactSecrets } from "./secrets";
import {
  CLI_SPECS, UNSUPPORTED_CLIS, clearCliCaches, findBinary, getCliVersion, importLoginShellEnv, isServerless,
} from "./cli-bridge";

export interface CliConnection {
  id: string;
  name: string;
  binary: string;
  path: string | null;
  version: string | null;
  installed: boolean;
  supported: boolean;
}
export interface LocalServerConnection {
  id: "ollama" | "lmstudio";
  url: string;
  reachable: boolean;
  models: string[];
}
export interface ConnectionsReport {
  serverless: boolean;
  clis: CliConnection[];
  local: LocalServerConnection[];
  envKeys: { providerId: string; envVar: string; present: boolean; source: "process" | "login-shell" | null }[];
  /** names only of variables imported from the login shell */
  importedFromShell: string[];
}

const PROBE_TIMEOUT_MS = 1500;

export async function detectClis(): Promise<CliConnection[]> {
  const entries = [
    ...Object.values(CLI_SPECS).map((s) => ({ id: s.id, name: s.name, binary: s.binary, supported: true })),
    ...UNSUPPORTED_CLIS.map((s) => ({ ...s, supported: false })),
  ];
  if (isServerless()) return entries.map((e) => ({ ...e, path: null, version: null, installed: false }));
  return Promise.all(entries.map(async (e) => {
    const p = await findBinary(e.binary);
    const version = p ? await getCliVersion(p).catch(() => null) : null;
    return { ...e, path: p, version, installed: !!p };
  }));
}

function ollamaOrigin(): string {
  const base = getProviderConfig("ollama").baseUrl;
  if (base) {
    try {
      const u = new URL(base);
      return `${u.protocol}//${u.host}`;
    } catch { /* fall through */ }
  }
  return "http://127.0.0.1:11434";
}

export async function probeLocalServers(): Promise<LocalServerConnection[]> {
  const ollamaUrl = `${ollamaOrigin()}/api/tags`;
  const lmBase = (getProviderConfig("lmstudio").baseUrl || "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
  const lmUrl = `${lmBase}/models`;
  const probe = async (url: string, pick: (data: any) => string[]) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!res.ok) return { reachable: false, models: [] as string[] };
      const data: unknown = await res.json();
      return { reachable: true, models: pick(data).filter((m) => typeof m === "string").slice(0, 100) };
    } catch {
      return { reachable: false, models: [] as string[] };
    }
  };
  const [o, l] = await Promise.all([
    probe(ollamaUrl, (d) => (d?.models ?? []).map((m: any) => m?.name ?? m?.model)),
    probe(lmUrl, (d) => (d?.data ?? []).map((m: any) => m?.id)),
  ]);
  return [
    { id: "ollama", url: ollamaUrl, ...o },
    { id: "lmstudio", url: lmUrl, ...l },
  ];
}

let reportCache: Promise<ConnectionsReport> | null = null;

export function getConnections(): Promise<ConnectionsReport> {
  if (!reportCache) {
    reportCache = (async () => {
      await importLoginShellEnv().catch(() => []);
      const [clis, local] = await Promise.all([detectClis(), probeLocalServers()]);
      return { serverless: isServerless(), clis, local, envKeys: envKeyPresence(), importedFromShell: importedEnvNames() };
    })();
    // local servers come and go — don't pin a failed probe forever
    reportCache.catch(() => { reportCache = null; });
  }
  return reportCache;
}

export function rescanConnections(): void {
  reportCache = null;
  clearCliCaches();
}

/**
 * These routes can start subprocesses, so only same-machine pages may call them:
 * no Origin (curl / Electron main / same-origin GET) or a loopback / file / app origin.
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "file:" || u.protocol === "app:") return true;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  } catch {
    return false;
  }
}

const testBody = z.object({ providerId: z.string().min(1).max(64) });
const inFlight = new Set<string>();
let lastTests: number[] = [];

export function registerConnectionRoutes(app: FastifyInstance): void {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isLocalOrigin(req.headers.origin)) {
      return reply.code(403).send({ error: "Connections can only be managed from PulseForge on this computer." });
    }
  };

  // GUI launches don't inherit shell exports — start the allow-listed import early (skipped in tests)
  if (!process.env.VITEST && !isServerless() && process.env.PF_NO_SHELL_ENV !== "1") void importLoginShellEnv().catch(() => []);

  app.get("/api/connections", { preHandler: guard }, async () => getConnections());

  app.post("/api/connections/rescan", { preHandler: guard }, async () => {
    rescanConnections();
    await importLoginShellEnv(true).catch(() => []);
    return getConnections();
  });

  app.post("/api/connections/test", { preHandler: guard }, async (req, reply) => {
    const body = testBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Body must be { providerId: string }" });
    const { providerId } = body.data;
    if (!PROVIDERS.some((p) => p.id === providerId)) return reply.code(404).send({ error: `Unknown provider: ${providerId}` });
    // each test may spawn a CLI: one per provider at a time, ≤ 10 per minute overall
    const now = Date.now();
    lastTests = lastTests.filter((t) => now - t < 60_000);
    if (inFlight.has(providerId)) return reply.code(409).send({ error: "A test for this provider is already running." });
    if (lastTests.length >= 10) return reply.code(429).send({ error: "Too many connection tests — wait a minute." });
    lastTests.push(now);
    inFlight.add(providerId);
    try {
      const result = await getProvider(providerId).testConnection();
      return { providerId, ...result, message: redactSecrets(result.message) };
    } catch (e) {
      return reply.code(400).send({ error: redactSecrets(String(e)) });
    } finally {
      inFlight.delete(providerId);
    }
  });
}
