/**
 * Secret handling: env vars take precedence, then allow-listed variables imported
 * from the user's login shell (names only — see SHELL_ENV_ALLOWLIST), then ~/.pulseforge/secrets.json
 * (created chmod 600). Secrets never leave this process except inside provider
 * request headers; redactSecrets() scrubs them from anything we log.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { currentCreds } from "./request-context";

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
  replicate: ["REPLICATE_API_TOKEN"],
  // 2.0 providers (base URLs verified against each vendor's docs — see AI_PROVIDER_GUIDE.md)
  xai: ["XAI_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  zai: ["ZAI_API_KEY", "ZHIPUAI_API_KEY"],
  "zai-coding": ["ZAI_API_KEY", "ZHIPUAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  "anthropic-compatible": ["ANTHROPIC_COMPATIBLE_API_KEY"],
  "fish-audio": ["FISH_API_KEY", "FISH_AUDIO_API_KEY"],
};

/**
 * Variable NAMES we may import from the user's login shell. GUI-launched apps
 * (the Electron .dmg) don't inherit ~/.zshrc exports, so we read only these names
 * — every other variable is filtered out inside the shell and never reaches us.
 */
export const SHELL_ENV_ALLOWLIST: readonly string[] = [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY",
  "ZAI_API_KEY", "ZHIPUAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "ELEVENLABS_API_KEY",
  "FISH_API_KEY", "FISH_AUDIO_API_KEY", "REPLICATE_API_TOKEN",
];

/** Values imported from the login shell (allow-listed names only). In-memory, never persisted or logged. */
const importedEnv = new Map<string, string>();

/** Replace the imported set; silently drops any name that isn't allow-listed. Returns the names kept. */
export function setImportedEnv(vars: Record<string, string>): string[] {
  importedEnv.clear();
  for (const [k, v] of Object.entries(vars)) {
    if (SHELL_ENV_ALLOWLIST.includes(k) && typeof v === "string" && v.length > 0) importedEnv.set(k, v);
  }
  return [...importedEnv.keys()];
}

export function clearImportedEnv(): void {
  importedEnv.clear();
}

/** Names (never values) of the variables imported from the login shell. */
export function importedEnvNames(): string[] {
  return [...importedEnv.keys()];
}

/** Presence of every known key env var — names + booleans only, never values. */
export function envKeyPresence(): { providerId: string; envVar: string; present: boolean; source: "process" | "login-shell" | null }[] {
  const out: { providerId: string; envVar: string; present: boolean; source: "process" | "login-shell" | null }[] = [];
  for (const [providerId, vars] of Object.entries(ENV_KEYS)) {
    for (const envVar of vars) {
      const source = process.env[envVar] ? "process" : importedEnv.has(envVar) ? "login-shell" : null;
      out.push({ providerId, envVar, present: source !== null, source });
    }
  }
  return out;
}

function readJson(file: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function getSecret(providerId: string): string | null {
  // hosted build: ONLY the visitor's own request-scoped key (bring-your-own-key). Server env keys
  // are ignored unless the deployer explicitly opts in, so strangers can never spend them.
  if (process.env.PF_SERVERLESS === "1") {
    const own = currentCreds()?.keys[providerId];
    if (own) return own;
    if (process.env.PF_ALLOW_SERVER_KEYS !== "1") return null;
  }
  // order: process env → login-shell import (allow-listed) → ~/.pulseforge/secrets.json
  for (const env of ENV_KEYS[providerId] ?? []) {
    const v = process.env[env];
    if (v) return v;
  }
  for (const env of ENV_KEYS[providerId] ?? []) {
    const v = importedEnv.get(env);
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
  const own = currentCreds()?.config[providerId];
  if (own) return own;
  if (process.env.PF_SERVERLESS === "1") return {};
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
  for (const v of Object.values(currentCreds()?.keys ?? {})) {
    if (v && v.length > 6) out = out.split(v).join("[redacted]");
  }
  const secrets = readJson(SECRETS_FILE());
  for (const v of Object.values(secrets)) {
    if (v && v.length > 6) out = out.split(v).join("[redacted]");
  }
  const names = new Set<string>([...Object.values(ENV_KEYS).flat(), ...SHELL_ENV_ALLOWLIST]);
  for (const env of names) {
    for (const v of [process.env[env], importedEnv.get(env)]) {
      if (v && v.length > 6) out = out.split(v).join("[redacted]");
    }
  }
  // common API-key shapes even if not stored with us
  out = out.replace(/\b(sk-[a-zA-Z0-9_-]{10,})/g, "[redacted]");
  out = out.replace(/\b(sk-ant-[a-zA-Z0-9_-]{10,})/g, "[redacted]");
  out = out.replace(/\bBearer\s+[a-zA-Z0-9._-]{10,}/g, "Bearer [redacted]");
  out = out.replace(/\b(xai-[a-zA-Z0-9_-]{10,})/g, "[redacted]"); // xAI
  out = out.replace(/\b(gsk_[a-zA-Z0-9]{10,})/g, "[redacted]"); // Groq
  out = out.replace(/\b(r8_[a-zA-Z0-9]{10,})/g, "[redacted]"); // Replicate
  out = out.replace(/((?:x-api-key|xi-api-key)["']?\s*[:=]\s*["']?)[a-zA-Z0-9._-]{10,}/gi, "$1[redacted]");
  return out;
}
