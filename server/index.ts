/**
 * PulseForge backend entry. Dev: API only on PF_API_PORT (Vite proxies /api).
 * Production (PF_SERVE_STATIC=1): one server on PF_STATIC_PORT serving dist/ + /api.
 */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "./routes";
import { ensureDir, redactSecrets } from "./secrets";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serveStatic = process.env.PF_SERVE_STATIC === "1";
const port = Number(serveStatic ? process.env.PF_STATIC_PORT ?? 7800 : process.env.PF_API_PORT ?? 7801);

async function main() {
  ensureDir();
  const app = Fastify({
    logger: { level: "warn" },
    bodyLimit: 800 * 1024 * 1024, // pack uploads are base64 JSON
    connectionTimeout: 0,
  });
  await app.register(cors, { origin: true });
  registerRoutes(app);

  if (serveStatic) {
    const dist = path.join(root, "dist");
    if (fs.existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, prefix: "/" });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
        return reply.sendFile("index.html");
      });
    }
  }

  try {
    // default localhost-only; PF_HOST=0.0.0.0 opts into LAN access (e.g. open the
    // studio on an iPhone at http://<mac-ip>:7800 — see TROUBLESHOOTING.md)
    const host = process.env.PF_HOST ?? "127.0.0.1";
    await app.listen({ port, host });
    console.log(`[pulseforge] backend listening on http://${host}:${port}${serveStatic ? " (serving studio + API)" : " (API only)"}`);
    if (host !== "127.0.0.1") {
      console.log("[pulseforge] LAN mode: microphone recording needs a secure context — phones get playback/editing; record on the Mac or via HTTPS.");
    }
  } catch (err) {
    console.error("[pulseforge] failed to start:", redactSecrets(String(err)));
    process.exit(1);
  }
}

main();
