/** Structured-output helpers shared by every AI route: tolerant JSON extraction + one repair retry. */
import type { AIProviderAdapter } from "./providers";

/**
 * Pull the JSON object out of a model reply. Tolerates ```json fences and prose around the
 * object, and scans for the first *balanced* top-level object (string-aware) instead of
 * first-"{"-to-last-"}", which breaks when trailing prose contains braces.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced?.[1]?.includes("{") ? fenced[1] : text;
  for (let start = src.indexOf("{"); start >= 0; start = src.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(src.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw new Error("Response contained no JSON object");
}

/** Ask for JSON, validate it, and on failure send the validation error back once for repair. */
export async function chatWithJsonRetry<T>(
  provider: AIProviderAdapter,
  system: string,
  user: string,
  model: string | undefined,
  validate: (raw: unknown) => T,
  opts: { maxTokens?: number } = {},
): Promise<T> {
  if (!provider.chat) throw new Error(`${provider.name} does not support text generation`);
  const first = await provider.chat({ system, user, model, json: true, maxTokens: opts.maxTokens });
  try {
    return validate(extractJson(first));
  } catch (err) {
    const retry = await provider.chat({
      system,
      user: `${user}\n\nYour previous response was invalid: ${String(err).slice(0, 300)}\nPrevious response (truncated): ${first.slice(0, 1500)}\nRespond again with ONLY the corrected JSON object.`,
      model,
      json: true,
      maxTokens: opts.maxTokens,
    });
    return validate(extractJson(retry));
  }
}
