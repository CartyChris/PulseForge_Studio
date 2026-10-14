/**
 * Audio blob storage: Origin Private File System when available, IndexedDB fallback.
 * Keys are flat safe names; large audio lives here, project JSON lives in IndexedDB.
 */
import { idb } from "./db";

export interface BlobStore {
  kind: "opfs" | "idb";
  put(key: string, data: Blob | ArrayBuffer): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function safeBlobKey(key: string): string {
  // flat, filesystem-safe, no traversal
  return key.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_").slice(0, 180);
}

class OpfsStore implements BlobStore {
  kind = "opfs" as const;
  constructor(private dir: FileSystemDirectoryHandle) {}
  async put(key: string, data: Blob | ArrayBuffer): Promise<void> {
    const handle = await this.dir.getFileHandle(safeBlobKey(key), { create: true });
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
  }
  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      const handle = await this.dir.getFileHandle(safeBlobKey(key));
      const file = await handle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.dir.removeEntry(safeBlobKey(key));
    } catch {}
  }
  async keys(): Promise<string[]> {
    const out: string[] = [];
    for await (const name of (this.dir as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(name);
    return out;
  }
}

class IdbBlobStore implements BlobStore {
  kind = "idb" as const;
  async put(key: string, data: Blob | ArrayBuffer): Promise<void> {
    const buf = data instanceof Blob ? await data.arrayBuffer() : data;
    await idb.put("blobs", buf, safeBlobKey(key));
  }
  async get(key: string): Promise<ArrayBuffer | null> {
    return (await idb.get<ArrayBuffer>("blobs", safeBlobKey(key))) ?? null;
  }
  async delete(key: string): Promise<void> {
    await idb.delete("blobs", safeBlobKey(key));
  }
  async keys(): Promise<string[]> {
    return (await idb.getAllKeys("blobs")).map(String);
  }
}

let storePromise: Promise<BlobStore> | null = null;
export function getBlobStore(): Promise<BlobStore> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle("pulseforge-audio", { create: true });
          // probe write access
          const probe = await dir.getFileHandle("__probe", { create: true });
          const w = await probe.createWritable();
          await w.close();
          await dir.removeEntry("__probe");
          return new OpfsStore(dir);
        }
      } catch {}
      return new IdbBlobStore();
    })();
  }
  return storePromise;
}

/** test hook */
export function _resetBlobStore(): void {
  storePromise = null;
}
