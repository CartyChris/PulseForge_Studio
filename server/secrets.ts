/**
 * Secret handling: env vars take precedence, then ~/.pulseforge/secrets.json
 * (created chmod 600). Secrets never leave this process except inside provider
 * request headers; redactSecrets() scrubs them from anything we log.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const PF_DIR = process.env.PF_DATA_DIR ?? path.join(os.homedir(), ".pulseforge");
const SECRETS_FILE = () => path.join(PF_DIR, "secrets.json");
const CONFIG_FILE = () => path.join(PF_DIR, "config.json");

export function ensureDir(): void {
  fs.mkdirSync(PF_DIR, { recursive: true, mode: 0o700 });
}

export const ENV_KEYS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "openai-compatible": ["OPENAI_COMPATIBLE_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  "generic-audio-sync": ["GENERIC_AUDIO_API_KEY"],
  "generic-audio-async": ["GENERIC_AUDIO_ASYNC_API_KEY"],
};

function readJson(file: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function getSecret(providerId: string): string | null {
  for (const env of ENV_KEYS[providerId] ?? []) {
    const v = process.env[env];
    if (v) return v;
  }
  return readJson(SECRETS_FILE())[providerId] ?? null;
}

export function setSecret(providerId: string, value: string): void {
  ensureDir();
  const secrets = readJson(SECRETS_FILE());
  if (value) secrets[providerId] = value;
  else delete secrets[providerId];
  fs.writeFileSync(SECRETS_FILE(), JSON.stringify(secrets, null, 2), { mode: 0o600 });
  try { fs.chmodSync(SECRETS_FILE(), 0o600); } catch {}
}

export function hasSecret(providerId: string): boolean {
  return getSecret(providerId) !== null;
}

/** Provider config (base URLs, default models for generic adapters). Not secret. */
export function getProviderConfig(providerId: string): Record<string, string> {
  const all = readJson(CONFIG_FILE());
  try {
    return typeof all[providerId] === "object" ? (all[providerId] as unknown as Record<string, string>) : JSON.parse(all[providerId] ?? "{}");
  } catch {
    return {};
  }
}

export function setProviderConfig(providerId: string, config: Record<string, string>): void {
  ensureDir();
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8")); } catch {}
  all[providerId] = config;
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** Scrub any known secret values and obvious key patterns from a string. */
export function redactSecrets(text: string): string {
  let out = text;
  const secrets = readJson(SECRETS_FILE());
  for (const v of Object.values(secrets)) {
    if (v && v.length > 6) out = out.split(v).join("[redacted]");
  }
  for (const envList of Object.values(ENV_KEYS)) {
    for (const env of envList) {
      const v = process.env[env];
      if (v && v.length > 6) out = out.split(v).join("[redacted]");
    }
  }
  // common API-key shapes even if not stored with us
  out = out.replace(/\b(sk-[a-zA-Z0-9_-]{10,})/g, "[redacted]");
  out = out.replace(/\b(sk-ant-[a-zA-Z0-9_-]{10,})/g, "[redacted]");
  out = out.replace(/\bBearer\s+[a-zA-Z0-9._-]{10,}/g, "Bearer [redacted]");
  return out;
}
