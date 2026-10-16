/**
 * Per-request credential context for the hosted (serverless) build. Each visitor's own keys
 * (sent from their browser in x-pf-byok) live ONLY in an AsyncLocalStorage store scoped to that
 * request — concurrent requests on the same warm instance can never see each other's keys, and
 * nothing is written to disk. getSecret()/getProviderConfig() consult this first.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestCreds {
  keys: Record<string, string>;
  config: Record<string, Record<string, string>>;
}

export const requestCreds = new AsyncLocalStorage<RequestCreds>();
export const currentCreds = (): RequestCreds | undefined => requestCreds.getStore();

function decode(header: string | string[] | undefined): Record<string, unknown> {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || raw.length > 64_000) return {};
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Private / link-local / loopback destinations a hosted proxy must never be steered to (SSRF). */
export function isSafePublicUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
      const [a, b] = h.split(".").map(Number) as [number, number];
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
    }
    if (h.includes(":")) return false; // literal IPv6 — reject outright rather than enumerate ranges
    return true;
  } catch {
    return false;
  }
}

/** Parse + sanitize the BYOK headers: string values only, URL-ish config fields must be public https. */
export function credsFromHeaders(headers: Record<string, string | string[] | undefined>): RequestCreds {
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(decode(headers["x-pf-byok"]))) {
    if (typeof v === "string" && v.length > 0 && v.length <= 500 && /^[a-z0-9-]{1,64}$/.test(k)) keys[k] = v;
  }
  const config: Record<string, Record<string, string>> = {};
  for (const [pid, cfg] of Object.entries(decode(headers["x-pf-config"]))) {
    if (!/^[a-z0-9-]{1,64}$/.test(pid) || !cfg || typeof cfg !== "object") continue;
    const clean: Record<string, string> = {};
    for (const [f, val] of Object.entries(cfg as Record<string, unknown>)) {
      if (typeof val !== "string" || val.length > 500) continue;
      if (/url|host|endpoint/i.test(f) && !isSafePublicUrl(val)) continue;
      clean[f] = val;
    }
    config[pid] = clean;
  }
  return { keys, config };
}
