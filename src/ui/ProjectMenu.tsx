/** Project menu: new/templates, open, save as, duplicate, portable import/export, WAV/MIDI export. */
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../state/store";
import { listProjects, loadProjectWithRecovery, deleteProject, duplicateProject, PROJECT_TEMPLATES, importPortableProject, saveProject, type ProjectListEntry } from "../storage/projects";
import { ensureProjectAssetsLoaded } from "../audio/assets";
import { exportMixWav, exportStems, exportMidi, exportPortable, cancelExport, type ExportSummary } from "../audio/export";
import { getHost } from "../host/adapter";
import { newId } from "../../shared/project";
import { engine } from "../engine/engine";
import type { BitDepth } from "../../shared/wav";
import { Portal, placeMenu } from "./shell/Portal";
import { backUpEverything, restoreFromBackup } from "./backup-actions";

type Dialog = null | "open" | "new" | "saveas" | "export";

export function ProjectMenu() {
  const { project, setProject, save, toast } = useStudio();
  const [menuAt, setMenuAt] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const menuOpen = menuAt !== null;
  const setMenuOpen = (open: boolean) => {
    if (!open) return setMenuAt(null);
    const r = ref.current?.getBoundingClientRect();
    if (r) setMenuAt(placeMenu(r, 280, 380));
  };
  const [dialog, setDialog] = useState<Dialog>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // the menu is portaled to <body>, so "outside" means outside both the button and the menu
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setMenuAt(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAt(null); };
    const gone = () => setMenuAt(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("resize", gone);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); window.removeEventListener("resize", gone); };
  }, [menuOpen]);

  const openProject = async (id: string) => {
    engine.stop();
    const rec = await loadProjectWithRecovery(id);
    if (!rec) return toast("Project could not be loaded", "error");
    setProject(rec.project);
    await ensureProjectAssetsLoaded(rec.project);
    if (rec.recovered) toast("Recovered a newer autosave of this project", "info");
    setDialog(null);
  };

  const importPortable = async () => {
    const files = await getHost().importFiles({ accept: [".pfproj", ".zip"], multiple: false });
    if (!files[0]) return;
    try {
      const imported = await importPortableProject(files[0].data);
      await openProject(imported.id);
      toast(`Imported "${imported.name}"`, "success");
    } catch (e) {
      toast(`Import failed: ${e}`, "error");
    }
  };

  const item = (label: string, action: () => void, hint?: string) => (
    <div className="result" role="menuitem" tabIndex={0}
      onClick={() => { setMenuOpen(false); action(); }}
      onKeyDown={(e) => e.key === "Enter" && (setMenuOpen(false), action())}>
      <span>{label}</span>{hint && <span className="kbd">{hint}</span>}
    </div>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="tbtn proj-btn" title={`Project menu: ${project.name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        <span className="proj-name">{project.name}</span> ▾
      </button>
      {menuAt && (
        <Portal>
        <div ref={menuRef} className="palette menu-pop" style={{ left: menuAt.left, top: menuAt.top, width: 280 }} role="menu" aria-label="Project">
          <div className="results" style={{ borderTop: "none", maxHeight: menuAt.maxHeight - 16 }}>
            {item("New Project…", () => setDialog("new"))}
            {item("Open Project…", () => setDialog("open"))}
            {item("Save", () => save(true), "⌘S")}
            {item("Save As…", () => setDialog("saveas"), "⌘⇧S")}
            {item("Duplicate Project", async () => {
              await save();
              const copy = await duplicateProject(project.id);
              if (copy) { await openProject(copy.id); toast(`Duplicated as "${copy.name}"`, "success"); }
            })}
            {item("Export…", () => setDialog("export"))}
            {item("Export Portable Project (.pfproj)", async () => {
              await save();
              try { await exportPortable(project); toast("Portable project exported", "success"); }
              catch (e) { toast(String(e), "error"); }
            })}
            {item("Import Portable Project…", importPortable)}
            {item("Back Up All Projects (.pfbackup)…", () => void backUpEverything())}
            {item("Restore From Backup…", () => void restoreFromBackup())}
            {item("Export Pattern MIDI (.mid)", async () => {
              try { await exportMidi(project); toast("MIDI exported", "success"); }
              catch (e) { toast(String(e), "error"); }
            })}
          </div>
        </div>
        </Portal>
      )}
      <Portal>
      {dialog === "open" && <OpenDialog onOpen={openProject} onClose={() => setDialog(null)} />}
      {dialog === "new" && <NewDialog onClose={() => setDialog(null)} onOpen={openProject} />}
      {dialog === "saveas" && (
        <NameDialog
          title="Save As"
          initial={`${project.name} copy`}
          onSubmit={async (name) => {
            const copy = { ...project, id: newId("proj"), name };
            await saveProject(copy);
            setProject(copy);
            toast(`Saved as "${name}"`, "success");
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      </Portal>
    </div>
  );

  function NewDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
    const [name, setName] = useState("Untitled");
    const [templateId, setTemplateId] = useState("hiphop-90");
    return (
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <h2>New Project</h2>
          <div className="field"><label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="field"><label>Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {PROJECT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
            </select></div>
          <div className="row end">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              const tpl = PROJECT_TEMPLATES.find((t) => t.id === templateId)!;
              const p = { ...tpl.create(), name };
              await saveProject(p);
              onOpen(p.id);
            }}>Create</button>
          </div>
        </div>
      </div>
    );
  }
}

function OpenDialog({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const { toast } = useStudio();
  const refresh = () => listProjects().then(setProjects);
  useEffect(() => { refresh(); }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ minWidth: 520 }}>
        <h2>Open Project</h2>
        {!projects.length && <p className="dim">No saved projects yet.</p>}
        {projects.map((p) => (
          <div key={p.id} className="take-row">
            <span style={{ flex: 1 }}>{p.name}</span>
            <span className="dim small">{p.bpm} BPM · {new Date(p.modifiedAt).toLocaleString()}</span>
            <button className="btn small primary" onClick={() => onOpen(p.id)}>Open</button>
            <button className="btn small danger" onClick={async () => {
              if (confirm(`Delete "${p.name}"? This cannot be undone.`)) {
                await deleteProject(p.id);
                toast(`Deleted "${p.name}"`);
                refresh();
              }
            }}>Delete</button>
          </div>
        ))}
        <div className="row end"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function NameDialog({ title, initial, onSubmit, onClose }: { title: string; initial: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{title}</h2>
        <div className="field"><label>Name</label>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit(name)} /></div>
        <div className="row end">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSubmit(name)}>OK</button>
        </div>
      </div>
    </div>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, toast } = useStudio();
  const [mode, setMode] = useState<"mix" | "region" | "stems">("mix");
  const [sampleRate, setSampleRate] = useState(44100);
  const [bitDepth, setBitDepth] = useState<BitDepth>(16);
  const [normalize, setNormalize] = useState(false);
  const [tailSec, setTailSec] = useState(2);
  const [busy, setBusy] = useState(false);
  const [summaries, setSummaries] = useState<ExportSummary[]>([]);

  const run = async () => {
    setBusy(true);
    setSummaries([]);
    try {
      const settings = {
        sampleRate, bitDepth, normalize, tailSec,
        ...(mode === "region" && project.loop.endTick > project.loop.startTick
          ? { fromTick: project.loop.startTick, toTick: project.loop.endTick }
          : {}),
      };
      if (mode === "stems") {
        const res = await exportStems(project, settings);
        setSummaries(res);
        toast(`Exported ${res.length} stems`, "success");
      } else {
        if (mode === "region" && !(project.loop.endTick > project.loop.startTick)) {
          toast("Set a loop region first (region export uses the loop range)", "error");
          setBusy(false);
          return;
        }
        const res = await exportMixWav(project, settings);
        if (res) {
          setSummaries([res]);
          toast(res.clipped ? "Exported — WARNING: output clipped, consider normalize or lower master" : "WAV exported", res.clipped ? "error" : "success");
        }
      }
    } catch (e) {
      toast(`Export failed: ${e}`, "error");
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal">
        <h2>Export Audio</h2>
        <div className="field"><label>What</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="mix">Full song (WAV)</option>
            <option value="region">Loop region (WAV)</option>
            <option value="stems">Stems — one WAV per mixer channel</option>
          </select></div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}><label>Sample rate</label>
            <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}>
              {[44100, 48000, 88200, 96000].map((r) => <option key={r} value={r}>{r} Hz</option>)}
            </select></div>
          <div className="field" style={{ flex: 1 }}><label>Bit depth</label>
            <select value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value) as BitDepth)}>
              <option value={16}>16-bit PCM</option>
              <option value={24}>24-bit PCM</option>
              <option value={32}>32-bit float</option>
            </select></div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}><label>Reverb/delay tail</label>
            <select value={tailSec} onChange={(e) => setTailSec(Number(e.target.value))}>
              {[0, 1, 2, 4, 8].map((t) => <option key={t} value={t}>{t}s</option>)}
            </select></div>
          <label className="row" style={{ flex: 1, marginTop: 12 }}>
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /> Normalize to -0.2 dBFS
          </label>
        </div>
        {busy && <p className="dim">Rendering offline… this uses the exact same engine as playback.</p>}
        {summaries.map((s, i) => (
          <div key={i} className="take-row">
            <span style={{ flex: 1 }}>{s.file}</span>
            <span className="dim small">{s.durationSec.toFixed(1)}s · peak {s.peakDb === -Infinity ? "-∞" : s.peakDb} dB</span>
            {s.clipped && <span style={{ color: "var(--red)" }}>CLIPPED</span>}
          </div>
        ))}
        <div className="row end">
          {busy && <button className="btn danger" onClick={cancelExport}>Cancel render</button>}
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn primary" onClick={run} disabled={busy}>{busy ? "Rendering…" : "Export"}</button>
        </div>
      </div>
    </div>
  );
}
