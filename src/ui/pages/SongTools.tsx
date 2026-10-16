/** Song page tools: turn a loop into a song with a Blueprint; bounce / screw / slowed+reverb the song. */
import { useState } from "react";
import { useStudio } from "../../state/store";
import { BLUEPRINTS, blueprintBars } from "../../../shared/blueprints";
import { applyBlueprint } from "../../state/blueprint";
import { renderSongToAsset } from "../../audio/sampling";
import { rateToSemitones } from "../../engine/chop";
import { Icon } from "../shell/Icons";
import { ShowAt } from "../shell/Level";

export function SongTools() {
  const { project, toast, setTab } = useStudio();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rate, setRate] = useState(0.8);

  const render = async (kind: "none" | "screw" | "slowed") => {
    setBusy(kind === "none" ? "Bouncing" : kind === "screw" ? "Screwing" : "Slowing");
    try {
      const a = await renderSongToAsset(kind, kind === "slowed" ? 0.85 : rate);
      if (a) { toast(`"${a.name}" is in your library. Opening it on the Sample page`, "success"); setTab("audio-editor"); }
    } catch (e) {
      toast(`Render failed: ${String(e instanceof Error ? e.message : e)}`, "error");
    }
    setBusy(null);
  };

  return (
    <div className="row wrap" style={{ padding: "6px 12px 0", gap: 6 }}>
      <button className="btn small primary" onClick={() => setOpen(true)} title="Turn one loop into a full arrangement"><Icon name="layers" size={14} /> Song blueprint</button>
      <span className="faint small">|</span>
      <button className="btn small" disabled={!!busy} onClick={() => void render("screw")} title="Render the song and slow it down tape-style (slower and lower)"><Icon name="wave" size={14} /> Screw the song</button>
      <label className="row small" title="Screw amount">
        <input type="range" min={0.6} max={0.95} step={0.01} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={{ width: 90 }} />
        <span className="mono dim">{Math.round(rate * 100)}% ({rateToSemitones(rate).toFixed(1)} st)</span>
      </label>
      <button className="btn small" disabled={!!busy} onClick={() => void render("slowed")}>Slowed + reverb</button>
      <ShowAt min="intermediate"><button className="btn small" disabled={!!busy} onClick={() => void render("none")} title="Render the song to a sample you can chop">Bounce to sample</button></ShowAt>
      {busy && <span className="small dim">{busy} the song…</span>}
      {open && <BlueprintPicker onClose={() => setOpen(false)} hasArrangement={project.clips.some((c) => c.kind === "pattern")} />}
    </div>
  );
}

function BlueprintPicker({ onClose, hasArrangement }: { onClose: () => void; hasArrangement: boolean }) {
  const { project, selection, update, toast } = useStudio();
  const contentOf = (id: string) => { const p = project.patterns.find((x) => x.id === id)!; return Object.values(p.steps).reduce((a, s) => a + s.length, 0) + Object.values(p.notes).reduce((a, n) => a + n.length, 0); };
  const ranked = [...project.patterns].sort((a, b) => contentOf(b.id) - contentOf(a.id));
  const [src, setSrc] = useState(selection.patternId && contentOf(selection.patternId) > 0 ? selection.patternId : ranked[0]?.id ?? "");
  const [replace, setReplace] = useState(!hasArrangement);
  const go = (id: string) => {
    const bp = BLUEPRINTS.find((b) => b.id === id)!;
    try {
      let summary = "";
      update((p) => {
        const r = applyBlueprint(p, bp, src, replace ? "replace" : "append");
        summary = `${bp.name}: ${r.bars} bars with ${r.layers.join(", ")} (undo with ⌘Z)`;
        return r.project;
      });
      useStudio.getState().setPlayMode("song");
      toast(summary, "success");
      onClose();
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), "error");
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(760px, calc(100vw - 24px))" }}>
        <div className="row"><h2 style={{ margin: 0 }}><Icon name="layers" /> Song Blueprints</h2><div className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <p className="small dim">Pick your loop, then a structure. Its drums, bass, music and lead are split onto their own tracks, and each section brings them in and out: intros strip down, hooks hit with everything.</p>
        <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
          <label className="row small">Loop
            <select className="sel" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Source pattern">
              {ranked.map((p) => <option key={p.id} value={p.id}>{p.name}{contentOf(p.id) ? "" : " (empty)"}</option>)}
            </select>
          </label>
          <label className="row small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace the current arrangement {hasArrangement ? "" : "(it's empty)"}</label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {BLUEPRINTS.map((b) => (
            <button key={b.id} className="card groove-card" onClick={() => go(b.id)} disabled={!src}>
              <b>{b.name}</b>
              <span className="faint small">{b.sections.length} sections · {blueprintBars(b)} bars · ~{Math.round((blueprintBars(b) * 4 * 60) / project.bpm / 6) / 10} min at {project.bpm} BPM</span>
              <span className="small dim">{b.blurb}</span>
              <span className="bp-strip">{b.sections.map((s, i) => <i key={i} style={{ flex: s.bars, opacity: 0.35 + 0.65 * (s.layers.length / 4) }} title={`${s.name} · ${s.bars} bars · ${s.layers.join(", ")}`} />)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
