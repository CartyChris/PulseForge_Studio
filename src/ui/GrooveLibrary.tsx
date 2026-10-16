/** Groove Library browser (Beat page): 60+ named drum patterns by style, applied in one undo step. */
import { useMemo, useState } from "react";
import { useStudio } from "../state/store";
import { GROOVES, GROOVE_CATEGORIES, grooveToSteps, type Groove } from "../../shared/grooves";
import { getKit } from "../engine/kits";
import { newId, type Channel, type Step } from "../../shared/project";
import { Icon } from "./shell/Icons";

const PAD_COLORS = ["#ff6a3d", "#ffc94d", "#3ec6ff", "#4fe39a", "#8b6cff", "#ff6fcf", "#5ee6d0", "#ff9f43"];

/** Write a library groove into the current pattern (adding any missing drum channels). One undo step. */
export function applyLibraryGroove(groove: Groove, opts: { setBpm: boolean; useKit: boolean }): string {
  const s = useStudio.getState();
  const pattern = s.project.patterns.find((p) => p.id === s.selection.patternId) ?? s.project.patterns[0];
  if (!pattern) return "Create a pattern first";
  const existingKit = (s.project.channels.find((c) => c.instrument.type === "drum-sound")?.instrument as { kitId?: string } | undefined)?.kitId;
  const kit = getKit(opts.useKit || !existingKit ? groove.kit : existingKit);
  const { lengthSteps, rows } = grooveToSteps(groove, pattern.lengthSteps);
  s.update((p) => {
    let channels: Channel[] = [...p.channels];
    if (opts.useKit) {
      // swap every drum channel to the same role in the groove's kit (steps stay)
      channels = channels.map((c) => {
        if (c.instrument.type !== "drum-sound") return c;
        const role = getKit(c.instrument.kitId).sounds.find((x) => x.id === (c.instrument as { soundId: string }).soundId)?.role;
        const sound = kit.sounds.find((x) => x.role === role);
        return sound ? { ...c, name: sound.name, instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id } } : c;
      });
    }
    const steps: Record<string, Step[]> = { ...pattern.steps };
    for (const [role, hits] of Object.entries(rows)) {
      let ch = channels.find((c) => c.instrument.type === "drum-sound" && getKit(c.instrument.kitId).sounds.find((x) => x.id === (c.instrument as { soundId: string }).soundId)?.role === role);
      if (!ch) {
        const sound = kit.sounds.find((x) => x.role === role) ?? kit.sounds[0]!;
        ch = { id: newId("ch"), name: sound.name, color: PAD_COLORS[channels.length % PAD_COLORS.length]!, instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id }, volumeDb: role.startsWith("hat") || role === "shaker" ? -6 : 0, pan: 0, muted: false, soloed: false, mixerChannelId: null };
        channels.push(ch);
      }
      steps[ch.id] = hits!;
    }
    return {
      ...p, channels, ...(opts.setBpm ? { bpm: groove.bpm } : {}),
      patterns: p.patterns.map((x) => (x.id === pattern.id ? { ...x, steps, lengthSteps, swing: groove.swing } : x)),
    };
  });
  return `“${groove.name}” written into “${pattern.name}”${opts.setBpm ? ` at ${groove.bpm} BPM` : ""} (undo with ⌘Z)`;
}

export function GrooveLibrary({ onClose }: { onClose: () => void }) {
  const { toast } = useStudio();
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [setBpm, setSetBpm] = useState(true);
  const [useKit, setUseKit] = useState(false);
  const list = useMemo(() => GROOVES.filter((g) => (cat === "all" || g.category === cat) && (!q || `${g.name} ${g.category} ${g.tip ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [cat, q]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(860px, calc(100vw - 24px))", maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
        <div className="row"><h2 style={{ margin: 0 }}><Icon name="drum" /> Groove Library <span className="faint small">{GROOVES.length} patterns</span></h2><div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="row wrap" style={{ margin: "10px 0", gap: 6 }}>
          <input className="search-box" style={{ margin: 0, width: 200 }} placeholder="Search grooves…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="sel" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Style">
            <option value="all">All styles</option>
            {GROOVE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="row small"><input type="checkbox" checked={setBpm} onChange={(e) => setSetBpm(e.target.checked)} />Set tempo</label>
          <label className="row small" title="Swap your drum sounds to the kit this groove was written for"><input type="checkbox" checked={useKit} onChange={(e) => setUseKit(e.target.checked)} />Use its kit</label>
        </div>
        <div style={{ overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
          {list.map((g) => (
            <button key={g.id} className="card groove-card" onClick={() => { toast(applyLibraryGroove(g, { setBpm, useKit }), "success"); onClose(); }} title={g.tip ?? `${g.category} · ${g.bpm} BPM`}>
              <b>{g.name}</b>
              <span className="faint small">{g.category} · {g.bpm} BPM{g.swing > 0.05 ? ` · swing ${Math.round(g.swing * 100)}%` : ""}</span>
              <GridPreview g={g} />
              {g.tip && <span className="small dim">{g.tip}</span>}
            </button>
          ))}
          {!list.length && <p className="dim small">No grooves match.</p>}
        </div>
      </div>
    </div>
  );
}

/** tiny dot-grid preview of the first bar */
function GridPreview({ g }: { g: Groove }) {
  const rows = Object.entries(g.rows).slice(0, 4);
  return (
    <span className="groove-grid">
      {rows.map(([role, grid]) => (
        <span key={role} className="groove-row" title={role}>
          {grid!.replace(/\|/g, "").slice(0, 16).split("").map((c, i) => <i key={i} className={c === "." ? "" : c === "X" || c === "x" || c === "R" || c === "r" ? "on" : "soft"} />)}
        </span>
      ))}
    </span>
  );
}
