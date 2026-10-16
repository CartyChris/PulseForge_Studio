/**
 * Browser-side OpenRouter OAuth PKCE for the hosted (bring-your-own-key) build — the key goes
 * straight from OpenRouter into this browser's storage and never touches our server.
 * Flow per https://openrouter.ai/docs/use-cases/oauth-pkce. Desktop/local builds use the
 * server-side variant (server/oauth.ts) because the callback lands in the system browser.
 */
import { byok } from "../api";

const V_KEY = "pf_or_verifier";
const S_KEY = "pf_or_state";
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function startOpenRouterBrowserOAuth(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  sessionStorage.setItem(V_KEY, verifier);
  sessionStorage.setItem(S_KEY, state);
  const callback = `${location.origin}${location.pathname}`;
  location.href = `https://openrouter.ai/auth?${new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256", state, key_label: "PulseForge Studio" })}`;
}

/** Call once on app start: finishes the handshake if we just came back from OpenRouter. */
export async function completeOpenRouterBrowserOAuth(): Promise<"connected" | "failed" | null> {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  const state = q.get("state");
  const verifier = sessionStorage.getItem(V_KEY);
  if (!code || !verifier) return null;
  const expected = sessionStorage.getItem(S_KEY);
  sessionStorage.removeItem(V_KEY);
  sessionStorage.removeItem(S_KEY);
  history.replaceState(null, "", location.pathname); // never leave the code in the address bar
  if (!state || state !== expected) return "failed";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    });
    const data = (await res.json()) as { key?: string };
    if (!res.ok || !data.key) return "failed";
    byok.setKey("openrouter", data.key);
    return "connected";
  } catch {
    return "failed";
  }
}
