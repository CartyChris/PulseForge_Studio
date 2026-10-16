/**
 * Serverless entry (Vercel): one Fastify app per warm instance, every request answered through
 * app.inject() inside its own credential context (bring-your-own-key, see request-context.ts).
 * inject() sidesteps platform body-parsing quirks: we read the raw body ourselves and hand Fastify
 * a plain payload, so the same routes, validation and guards run exactly as on the desktop.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { requestCreds, credsFromHeaders } from "./request-context";

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  appPromise ??= (async () => {
    const { buildApp } = await import("./index");
    const app = await buildApp({ logger: false });
    await app.ready();
    return app;
  })();
  return appPromise;
}

const MAX_BODY = 4.5 * 1024 * 1024; // platform request limit

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  // some runtimes pre-parse the body; accept that form too
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    return Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request body too large for the hosted version");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

/** Rebuild the real /api/... path whether or not the platform preserved it through the rewrite. */
export function originalUrl(raw: string): string {
  const u = new URL(raw, "http://x");
  const carried = u.searchParams.get("__pfp");
  if (carried !== null) {
    u.searchParams.delete("__pfp");
    if (u.pathname === "/api" || u.pathname === "/api/") u.pathname = `/api/${carried.replace(/^\/+/, "")}`;
  }
  const qs = u.searchParams.toString();
  return `${u.pathname}${qs ? `?${qs}` : ""}`;
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    const payload = await readBody(req);
    const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
    const creds = credsFromHeaders(headers);
    delete headers["x-pf-byok"]; // keys never travel further than this context
    delete headers["x-pf-config"];
    // inject() returns a LAZY thenable — it only dispatches when awaited. It must be awaited
    // inside run(), otherwise the request executes outside the visitor's credential context.
    const out = await requestCreds.run(creds, async () =>
      await app.inject({ method: (req.method ?? "GET") as "GET", url: originalUrl(req.url ?? "/"), headers: headers as Record<string, string>, payload }),
    );
    res.statusCode = out.statusCode;
    for (const [k, v] of Object.entries(out.headers)) {
      if (v !== undefined && k !== "content-length" && k !== "transfer-encoding" && k !== "connection") res.setHeader(k, v as string);
    }
    res.end(out.rawPayload);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: String(e).slice(0, 300) }));
  }
}
