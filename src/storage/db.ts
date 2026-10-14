/** Minimal promise-based IndexedDB wrapper. Stores: projects, blobs (OPFS fallback), kv. */

const DB_NAME = "pulseforge";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export const idb = {
  get: <T>(store: string, key: IDBValidKey) => tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: string, value: unknown, key?: IDBValidKey) => tx(store, "readwrite", (s) => (key !== undefined ? s.put(value, key) : s.put(value))),
  delete: (store: string, key: IDBValidKey) => tx(store, "readwrite", (s) => s.delete(key)),
  getAll: <T>(store: string) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  getAllKeys: (store: string) => tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()),
};
