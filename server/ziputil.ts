/** ZIP inspection & safe extraction for sample packs. Pure fflate — no shelling out. */
import { unzipSync } from "fflate";

const AUDIO_EXT = new Set(["wav", "mp3", "aac", "m4a", "ogg", "flac", "aif", "aiff"]);
const IGNORED_EXT = new Set(["exe", "dll", "sh", "bat", "cmd", "app", "dmg", "pkg", "scpt", "js", "vbs", "jar", "com", "msi"]);
const META_EXT = new Set(["txt", "md", "json", "pdf", "rtf"]);
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export interface ZipEntryInfo {
  path: string;
  size: number;
  kind: "audio" | "metadata" | "ignored";
}

export function isUnsafePath(p: string): boolean {
  return (
    p.split(/[\\/]/).includes("..") ||
    p.startsWith("/") ||
    p.startsWith("\\") ||
    /^[a-zA-Z]:/.test(p) ||
    p.includes("\0")
  );
}

/** Parse the archive and classify entries; unsafe paths are reported, never extracted. */
export function inspectZip(data: Uint8Array): { entries: ZipEntryInfo[]; unsafe: string[] } {
  const all = unzipSync(data);
  const entries: ZipEntryInfo[] = [];
  const unsafe: string[] = [];
  let count = 0;
  for (const [name, content] of Object.entries(all)) {
    if (name.endsWith("/")) continue;
    if (++count > MAX_ENTRIES) throw new Error(`ZIP has too many entries (> ${MAX_ENTRIES})`);
    if (isUnsafePath(name)) {
      unsafe.push(name);
      continue;
    }
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const kind: ZipEntryInfo["kind"] = AUDIO_EXT.has(ext) ? "audio" : IGNORED_EXT.has(ext) ? "ignored" : "metadata";
    entries.push({ path: name, size: content.length, kind });
  }
  return { entries, unsafe };
}

/** Extract only safe audio + small metadata files. Throws on traversal attempts. */
export function extractZipSafe(data: Uint8Array): Map<string, Uint8Array> {
  if (data.length > MAX_TOTAL_BYTES) throw new Error("ZIP too large");
  const result = new Map<string, Uint8Array>();
  const all = unzipSync(data);
  let total = 0;
  for (const [name, content] of Object.entries(all)) {
    if (name.endsWith("/")) continue;
    if (isUnsafePath(name)) throw new Error(`Unsafe path in ZIP: ${name}`);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (IGNORED_EXT.has(ext)) continue;
    const isAudio = AUDIO_EXT.has(ext);
    const isSmallMeta = !isAudio && content.length < 1024 * 1024 && META_EXT.has(ext);
    if (!isAudio && !isSmallMeta) continue;
    total += content.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("ZIP contents too large");
    result.set(name, content);
  }
  return result;
}
