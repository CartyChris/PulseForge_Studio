/**
 * One-click "Connect with OpenRouter" — OAuth PKCE as documented at
 * https://openrouter.ai/docs/use-cases/oauth-pkce (verified 2026-10-15):
 *   1. GET https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256&state=…
 *   2. POST https://openrouter.ai/api/v1/auth/keys {code, code_verifier, code_challenge_method} → {key}
 * Localhost callbacks are supported on any port. The verifier never leaves this process; `state`
 * is single-use (CSRF), and pending handshakes expire after 10 minutes like the codes themselves.
 * Local/desktop only — the hosted build runs the same flow client-side (keys stay in the browser).
 */
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { setSecret, redactSecrets } from "./secrets";

const pending = new Map<string, { verifier: string; created: number }>();
const TTL = 10 * 60_000;
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function page(title: string, body: string, ok: boolean): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#0a0b10;color:#eaedf6;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:42px">${ok ? "✓" : "⚠"}</div>
<h2 style="margin:8px 0">${esc(title)}</h2><p style="color:#9ba2b7">${esc(body)}</p></div></body>`;
}

export function registerOAuthRoutes(app: FastifyInstance): void {
  app.post("/api/oauth/openrouter/start", async (req, reply) => {
    if (process.env.PF_SERVERLESS === "1") return reply.code(400).send({ error: "Hosted build: OAuth runs in the browser." });
    for (const [k, v] of pending) if (Date.now() - v.created > TTL) pending.delete(k);
    const { verifier, challenge } = pkcePair();
    const state = b64url(crypto.randomBytes(18));
    pending.set(state, { verifier, created: Date.now() });
    // OpenRouter documents localhost callbacks on any port; use the port this request arrived on
    const port = (req.headers.host ?? "").split(":")[1] ?? "7800";
    const callback = `http://localhost:${port}/api/oauth/openrouter/callback`;
    const url = `https://openrouter.ai/auth?${new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256", state, key_label: "PulseForge Studio" })}`;
    return { url };
  });

  app.get("/api/oauth/openrouter/callback", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const entry = q.state ? pending.get(q.state) : undefined;
    if (q.state) pending.delete(q.state); // single use, success or not
    reply.type("text/html");
    if (!q.code) return page("Connection cancelled", "OpenRouter didn't return an authorization code. You can close this tab and try again from PulseForge.", false);
    if (!entry || Date.now() - entry.created > TTL) return page("Link expired", "This sign-in link is invalid or expired. Start again from PulseForge → Connections.", false);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: q.code, code_verifier: entry.verifier, code_challenge_method: "S256" }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as { key?: string };
      if (!res.ok || !data.key) throw new Error(`OpenRouter returned HTTP ${res.status}`);
      setSecret("openrouter", data.key);
      return page("OpenRouter connected", "PulseForge can now use OpenRouter models. You can close this tab and return to the studio.", true);
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return page("Couldn't finish connecting", redactSecrets(String(e)), false);
    }
  });
}
