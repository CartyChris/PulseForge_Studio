/**
 * PulseForge backend entry. Dev: API only on PF_API_PORT (Vite proxies /api).
 * Production (PF_SERVE_STATIC=1): one server on PF_STATIC_PORT serving dist/ + /api.
 *
 * Also importable: buildApp() (no listen — used by the Electron shell and a serverless
 * entry) and startServer() (listen + close handle). main() runs only when this file is
 * executed directly (`tsx server/index.ts`), never on import.
 */
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "./routes";
import { isLocalOrigin } from "./connections";
import { ensureDir, redactSecrets } from "./secrets";

export interface BuildAppOptions {
  /** Directory with the built frontend (index.html). When set, served at / with SPA fallback. */
  staticDir?: string | null;
  /** Enable Fastify's logger at level "warn" (default true). */
  logger?: boolean;
}

/** Create a fully configured Fastify app (cors + routes [+ static]). Does NOT listen. */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  ensureDir();
  const app = Fastify({
    logger: opts.logger === false ? false : { level: "warn" },
    bodyLimit: 800 * 1024 * 1024, // pack uploads are base64 JSON
    connectionTimeout: 0,
  });
  // only local origins get CORS headers; the app itself is same-origin and needs none.
  // (Previously `origin: true` reflected ANY website — see isAllowedRequest in routes.ts.)
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || isLocalOrigin(origin)) });
  registerRoutes(app);

  const dist = opts.staticDir;
  if (dist && fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}

export interface StartServerOptions {
  /** 0 = let the OS pick a free port. */
  port: number;
  host?: string;
  staticDir?: string | null;
  logger?: boolean;
}

/** buildApp() + listen. Rejects (never exits the process) if the port can't be bound. */
export async function startServer(
  opts: StartServerOptions,
): Promise<{ app: FastifyInstance; url: string; port: number; close(): Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const app = await buildApp({ staticDir: opts.staticDir, logger: opts.logger });
  try {
    await app.listen({ port: opts.port, host });
  } catch (err) {
    await app.close().catch(() => {});
    throw err;
  }
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  const urlHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return { app, url: `http://${urlHost}:${port}`, port, close: () => app.close() };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const serveStatic = process.env.PF_SERVE_STATIC === "1";
  const port = Number(serveStatic ? process.env.PF_STATIC_PORT ?? 7800 : process.env.PF_API_PORT ?? 7801);
  // default localhost-only; PF_HOST=0.0.0.0 opts into LAN access (e.g. open the
  // studio on an iPhone at http://<mac-ip>:7800 — see TROUBLESHOOTING.md)
  const host = process.env.PF_HOST ?? "127.0.0.1";

  try {
    await startServer({ port, host, staticDir: serveStatic ? path.join(root, "dist") : null });
    console.log(`[pulseforge] backend listening on http://${host}:${port}${serveStatic ? " (serving studio + API)" : " (API only)"}`);
    if (host !== "127.0.0.1") {
      console.log("[pulseforge] LAN mode: microphone recording needs a secure context — phones get playback/editing; record on the Mac or via HTTPS.");
    }
  } catch (err) {
    console.error("[pulseforge] failed to start:", redactSecrets(String(err)));
    process.exit(1);
  }
}

/** True only when this module is the process entry point (tsx server/index.ts), not when imported or bundled. */
function isEntryPoint(): boolean {
  if (process.versions.electron) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const self = fileURLToPath(import.meta.url);
    const resolved = path.resolve(entry);
    if (resolved === self) return true;
    // `tsx server/index` (no extension) or a symlinked path
    if (resolved === self.replace(/\.ts$/, "")) return true;
    return fs.realpathSync(resolved) === fs.realpathSync(self);
  } catch {
    return false;
  }
}

if (isEntryPoint()) void main();
