import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyProject } from "../../shared/project";
import { saveProject, loadProject, loadProjectWithRecovery, listProjects, duplicateProject, deleteProject, recentProjects, exportPortableProject, importPortableProject, PROJECT_TEMPLATES } from "./projects";
import { getBlobStore, safeBlobKey, _resetBlobStore } from "./blobs";
import { zipSync, strToU8 } from "fflate";

beforeEach(() => {
  // fresh DB per test
  (globalThis as any).indexedDB = new IDBFactory();
  _resetBlobStore();
  // force re-open of cached db connection
  const mod = import("./db");
  void mod;
});

// db.ts caches its open promise per module load; reset by re-import is unreliable in
// vitest, so tests use unique ids instead and a single DB is acceptable.

describe("project persistence", () => {
  it("save + load round-trips a project", async () => {
    const p = createEmptyProject("Round Trip", 95);
    await saveProject(p);
    const loaded = await loadProject(p.id);
    expect(loaded?.name).toBe("Round Trip");
    expect(loaded?.bpm).toBe(95);
  });
  it("autosave is preferred by recovery when newer", async () => {
    const p = createEmptyProject("Recover me");
    await saveProject(p);
    await new Promise((r) => setTimeout(r, 5));
    const modified = { ...p, name: "Recover me EDITED" };
    await saveProject(modified, { autosave: true });
    const rec = await loadProjectWithRecovery(p.id);
    expect(rec?.recovered).toBe(true);
    expect(rec?.project.name).toBe("Recover me EDITED");
  });
  it("list excludes autosaves and sorts newest first", async () => {
    const a = createEmptyProject("A");
    const b = createEmptyProject("B");
    await saveProject(a);
    await new Promise((r) => setTimeout(r, 5));
    await saveProject(b);
    await saveProject(b, { autosave: true });
    const list = await listProjects();
    const names = list.map((x) => x.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(names.indexOf("B")).toBeLessThan(names.indexOf("A"));
  });
  it("duplicate creates an independent copy", async () => {
    const p = createEmptyProject("Orig");
    await saveProject(p);
    const copy = await duplicateProject(p.id);
    expect(copy?.id).not.toBe(p.id);
    expect(copy?.name).toBe("Orig copy");
    await deleteProject(p.id);
    expect(await loadProject(p.id)).toBeNull();
    expect(await loadProject(copy!.id)).not.toBeNull();
  });
  it("recent projects tracks saves", async () => {
    const p = createEmptyProject("R1");
    await saveProject(p);
    expect(await recentProjects()).toContain(p.id);
  });
  it("templates all produce valid projects", () => {
    expect(PROJECT_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of PROJECT_TEMPLATES) {
      const p = t.create();
      expect(p.mixer.channels.length).toBeGreaterThan(0);
    }
  });
});

describe("blob store (IndexedDB fallback in Node)", () => {
  it("put/get/delete round-trip", async () => {
    const store = await getBlobStore();
    expect(store.kind).toBe("idb");
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await store.put("test key/with bad*chars", data);
    const back = await store.get("test key/with bad*chars");
    expect(back).not.toBeNull();
    expect(new Uint8Array(back!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    await store.delete("test key/with bad*chars");
    expect(await store.get("test key/with bad*chars")).toBeNull();
  });
  it("safe keys strip traversal", () => {
    expect(safeBlobKey("../../etc/passwd")).not.toContain("/");
    expect(safeBlobKey("../../etc/passwd")).not.toContain("..");
  });
});

describe("portable archives", () => {
  it("export → import round-trips project + assets with a new id", async () => {
    const store = await getBlobStore();
    const p = createEmptyProject("Portable", 100);
    const audio = new Uint8Array(1000).fill(7);
    await store.put("asset_1.wav", audio.buffer);
    p.assets.push({
      id: "a1", name: "clip", durationSec: 1, sampleRate: 44100, channels: 1, source: "import",
      blobKey: "asset_1.wav", originalBlobKey: null, licenseNote: "", tags: [], favorite: false,
      bpmEstimate: null, keyEstimate: null, aiMeta: null,
    });
    const blob = await exportPortableProject(p);
    const imported = await importPortableProject(await blob.arrayBuffer());
    expect(imported.id).not.toBe(p.id);
    expect(imported.name).toBe("Portable");
    const assetBack = await store.get("asset_1.wav");
    expect(assetBack?.byteLength).toBe(1000);
  });
  it("rejects path traversal in archives", async () => {
    const evil = zipSync({ "project.json": strToU8("{}"), "../evil.sh": strToU8("#!/bin/sh") });
    await expect(importPortableProject(evil.slice().buffer as ArrayBuffer)).rejects.toThrow(/Unsafe path|Invalid|Not a PulseForge/);
  });
  it("rejects archives without project.json", async () => {
    const zip = zipSync({ "readme.txt": strToU8("hello") });
    await expect(importPortableProject(zip.slice().buffer as ArrayBuffer)).rejects.toThrow(/no project.json/);
  });
});
