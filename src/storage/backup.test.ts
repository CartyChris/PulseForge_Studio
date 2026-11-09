import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { zipSync, strToU8 } from "fflate";
import { createEmptyProject, newId } from "../../shared/project";
import { saveProject, deleteProject, listProjects, loadProjectWithRecovery } from "./projects";
import { getBlobStore } from "./blobs";
import { exportBackup, importBackup, lastBackupAt } from "./backup";

async function blobToBuf(b: Blob): Promise<ArrayBuffer> { return await b.arrayBuffer(); }

describe("whole-library backup", () => {
  it("round-trips every project (incl. autosave-only) with its audio, then skips what's already here", async () => {
    const tag = newId("t");
    const store = await getBlobStore();
    const audioKey = `asset-${tag}`;
    await store.put(audioKey, new Uint8Array([1, 2, 3, 4, 5]).buffer);
    const a = { ...createEmptyProject(`A ${tag}`, 90), assets: [{ id: "as1", name: "kick", durationSec: 1, sampleRate: 44100, channels: 1, source: "import" as const, blobKey: audioKey, originalBlobKey: null, licenseNote: "", tags: [], favorite: false, bpmEstimate: null, keyEstimate: null, aiMeta: null }] };
    const b = createEmptyProject(`B ${tag}`, 120);
    const c = createEmptyProject(`C-autosave-only ${tag}`, 140);
    await saveProject(a); await saveProject(b); await saveProject(c, { autosave: true });

    const { blob, summary } = await exportBackup();
    expect(summary.projects).toBeGreaterThanOrEqual(3);
    expect(summary.assets).toBeGreaterThanOrEqual(1);
    expect(await lastBackupAt()).not.toBeNull();

    // wipe them, restore
    for (const p of [a, b, c]) await deleteProject(p.id);
    await store.delete(audioKey);
    const r = await importBackup(await blobToBuf(blob));
    expect(r.added).toBeGreaterThanOrEqual(3);
    expect(r.assets).toBeGreaterThanOrEqual(1);
    const names = (await listProjects()).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining([`A ${tag}`, `B ${tag}`, `C-autosave-only ${tag}`]));
    expect(new Uint8Array((await store.get(audioKey))!)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));

    // restoring again changes nothing
    const again = await importBackup(await blobToBuf(blob));
    expect(again.added).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(3);
  });

  it("never overwrites newer local work, but updates older copies", async () => {
    const tag = newId("t");
    const p = createEmptyProject(`Edit ${tag}`, 100);
    await saveProject(p);
    const { blob } = await exportBackup();
    // newer local edit survives a restore
    await new Promise((r) => setTimeout(r, 5));
    await saveProject({ ...p, name: `Edit ${tag} (newer)` });
    await importBackup(await blob.arrayBuffer());
    expect((await loadProjectWithRecovery(p.id))!.project.name).toBe(`Edit ${tag} (newer)`);
  });

  it("rejects files that aren't backups and unsafe paths", async () => {
    const notBackup = zipSync({ "project.json": strToU8("{}") });
    await expect(importBackup(notBackup.slice().buffer as ArrayBuffer)).rejects.toThrow(/backup/i);
    const evil = zipSync({ "backup.json": strToU8(JSON.stringify({ format: "pulseforge-backup", version: 1 })), "../evil.json": strToU8("x") });
    await expect(importBackup(evil.slice().buffer as ArrayBuffer)).rejects.toThrow(/Unsafe/);
    const future = zipSync({ "backup.json": strToU8(JSON.stringify({ format: "pulseforge-backup", version: 99 })) });
    await expect(importBackup(future.slice().buffer as ArrayBuffer)).rejects.toThrow(/newer/);
  });
});
