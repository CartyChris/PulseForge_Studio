/** UI actions for whole-library backup/restore (Settings, project menu, Home shelf, ⌘K). */
import { useStudio } from "../state/store";
import { getHost } from "../host/adapter";
import { exportBackup, importBackup, requestPersistentStorage } from "../storage/backup";
import { listProjects } from "../storage/projects";

export async function backUpEverything(): Promise<void> {
  const { toast, save } = useStudio.getState();
  try {
    await save(); // include the open project's latest edits
    const { blob, summary } = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    await getHost().exportFiles([{ name: `PulseForge Backup ${stamp}.pfbackup`, mime: "application/zip", data: blob }]);
    void requestPersistentStorage();
    toast(`Backed up ${summary.projects} project${summary.projects === 1 ? "" : "s"} and ${summary.assets} audio file${summary.assets === 1 ? "" : "s"} (${(summary.bytes / 1e6).toFixed(1)} MB)`, "success");
  } catch (e) {
    toast(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

/** pick a .pfbackup and restore it; returns true when anything changed */
export async function restoreFromBackup(): Promise<boolean> {
  const { toast } = useStudio.getState();
  const files = await getHost().importFiles({ accept: [".pfbackup", ".zip"], multiple: false });
  if (!files[0]) return false;
  try {
    const r = await importBackup(files[0].data);
    const parts = [r.added && `${r.added} added`, r.updated && `${r.updated} updated`, r.skipped && `${r.skipped} already up to date`].filter(Boolean);
    toast(`Restore complete: ${parts.join(", ") || "nothing to restore"}`, "success");
    window.dispatchEvent(new CustomEvent("pf-projects-changed"));
    return r.added + r.updated > 0;
  } catch (e) {
    toast(`Restore failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  }
}

export async function projectCount(): Promise<number> {
  try { return (await listProjects()).length; } catch { return 0; }
}
