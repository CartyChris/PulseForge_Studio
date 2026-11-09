/**
 * Whole-library backup & restore, plus durable browser storage.
 *
 * On the web, projects live in this browser (IndexedDB + OPFS). Browsers may evict "best-effort"
 * storage under disk pressure, and Safari deletes script-written data after seven days without a
 * visit when tracking prevention is on — so the studio asks for persistent storage and offers a
 * one-file backup (.pfbackup: a ZIP of every project and its audio) that restores anywhere,
 * including the Mac app.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { migrateProject, type Project } from "../../shared/project";
import { allProjectIds, loadProjectWithRecovery, restoreProjectRecord } from "./projects";
import { getBlobStore, safeBlobKey } from "./blobs";
import { idb } from "./db";

export const BACKUP_FORMAT = "pulseforge-backup";
export const BACKUP_VERSION = 1;
const MAX_ENTRY = 512 * 1024 * 1024;
const LAST_BACKUP_KEY = "lastBackupAt";

export interface BackupSummary { projects: number; assets: number; bytes: number }
export interface RestoreSummary { added: number; updated: number; skipped: number; assets: number }

/** Zip every project (newest of saved/autosaved) with all of its audio. */
export async function exportBackup(): Promise<{ blob: Blob; summary: BackupSummary }> {
  const store = await getBlobStore();
  const files: Record<string, Uint8Array> = {};
  const ids = await allProjectIds();
  const included: string[] = [];
  const blobKeys = new Set<string>();
  for (const id of ids) {
    const rec = await loadProjectWithRecovery(id);
    if (!rec) continue;
    files[`projects/${safeBlobKey(id)}.json`] = strToU8(JSON.stringify(rec.project));
    included.push(id);
    for (const a of rec.project.assets) {
      blobKeys.add(a.blobKey);
      if (a.originalBlobKey) blobKeys.add(a.originalBlobKey);
    }
  }
  let assets = 0;
  for (const key of blobKeys) {
    const data = await store.get(key);
    if (data) { files[`assets/${safeBlobKey(key)}`] = new Uint8Array(data); assets++; }
  }
  files["backup.json"] = strToU8(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), projects: included }, null, 2));
  const zipped = zipSync(files, { level: 6 });
  await idb.put("kv", new Date().toISOString(), LAST_BACKUP_KEY).catch(() => {});
  return { blob: new Blob([zipped.slice().buffer as ArrayBuffer], { type: "application/zip" }), summary: { projects: included.length, assets, bytes: zipped.byteLength } };
}

/**
 * Restore a .pfbackup. Never clobbers newer work: a project already here that was edited more
 * recently than the backup's copy is kept; older or missing ones are restored with their audio.
 */
export async function importBackup(data: ArrayBuffer): Promise<RestoreSummary> {
  const entries = unzipSync(new Uint8Array(data));
  const head = entries["backup.json"];
  if (!head) throw new Error("This isn't a PulseForge backup (no backup.json). For a single project use Import Portable Project.");
  const meta = JSON.parse(strFromU8(head)) as { format?: string; version?: number };
  if (meta.format !== BACKUP_FORMAT) throw new Error("This isn't a PulseForge backup");
  if ((meta.version ?? 0) > BACKUP_VERSION) throw new Error("This backup was made by a newer PulseForge. Update the app to restore it");
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.includes("..") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) throw new Error(`Unsafe path in backup: ${name}`);
    if (bytes.length > MAX_ENTRY) throw new Error(`Backup entry too large: ${name}`);
  }
  const store = await getBlobStore();
  const out: RestoreSummary = { added: 0, updated: 0, skipped: 0, assets: 0 };
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith("projects/") || !name.endsWith(".json")) continue;
    const project: Project = migrateProject(JSON.parse(strFromU8(bytes)));
    const local = await loadProjectWithRecovery(project.id);
    if (local && local.project.modifiedAt >= project.modifiedAt) { out.skipped++; continue; }
    for (const a of project.assets) {
      for (const key of [a.blobKey, a.originalBlobKey]) {
        if (!key) continue;
        const entry = entries[`assets/${safeBlobKey(key)}`];
        if (entry && !(await store.get(key))) { await store.put(key, entry.slice().buffer as ArrayBuffer); out.assets++; }
      }
    }
    await restoreProjectRecord(project);
    if (local) out.updated++; else out.added++;
  }
  return out;
}

export async function lastBackupAt(): Promise<string | null> {
  try { return (await idb.get<string>("kv", LAST_BACKUP_KEY)) ?? null; } catch { return null; }
}

export interface StorageStatus { persisted: boolean | null; usage: number | null; quota: number | null }

/** How much this browser holds for the studio, and whether it's protected from eviction. */
export async function storageStatus(): Promise<StorageStatus> {
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  const persisted = sm?.persisted ? await sm.persisted().catch(() => null) : null;
  const est = sm?.estimate ? await sm.estimate().catch(() => null) : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}

/** Ask the browser to keep our data (Chrome/Safari decide silently from engagement; Firefox asks). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!sm?.persist) return null;
  try { return (await sm.persisted?.()) || (await sm.persist()); } catch { return null; }
}
