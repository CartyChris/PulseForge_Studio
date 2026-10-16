/** Chord progression picker (Melody page): ~50 progressions, spelled in the project's key, written
 * into the current pattern on the selected (or a new keys) channel. One undo step. */
import { useMemo, useState } from "react";
import { useStudio } from "../state/store";
import { PROGRESSIONS, progressionNotes, CHORD_RHYTHMS, type ChordRhythm, type Progression } from "../../shared/progressions";
import { parseKey } from "../engine/chop";
import { newId, type Channel } from "../../shared/project";
import { Icon } from "./shell/Icons";

export function applyProgression(prog: Progression, o: { rhythm: ChordRhythm; barsPerChord: number; bass: boolean }): string {
  const s = useStudio.getState();
  const p = s.project;
  const pattern = p.patterns.find((x) => x.id === s.selection.patternId) ?? p.patterns[0];
  if (!pattern) return "Create a pattern first";
  const keyPc = parseKey(p.key)?.pc ?? 0;
  const { notes, labels, lengthSteps } = progressionNotes(prog, keyPc, o);
  // only a synth channel takes chords (a drum or a sampler chop pad would play them as pitched hits)
  let channel = p.channels.find((c) => c.id === s.selection.channelId && c.instrument.type === "synth");
  let newChannel: Channel | null = null;
  if (!channel) {
    newChannel = { id: newId("ch"), name: "Chords", color: "#3ec6ff", instrument: { type: "synth", synthId: "epiano", presetId: "ep-warm", params: {} }, volumeDb: -4, pan: 0, muted: false, soloed: false, mixerChannelId: null };
    channel = newChannel;
  }
  const chId = channel.id;
  s.update((proj) => ({
    ...proj,
    channels: newChannel ? [...proj.channels, newChannel] : proj.channels,
    patterns: proj.patterns.map((x) => (x.id === pattern.id ? { ...x, lengthSteps: Math.max(x.lengthSteps, lengthSteps), notes: { ...x.notes, [chId]: notes.map((n) => ({ ...n, id: newId("n") })) } } : x)),
  }));
  s.select({ channelId: chId, patternId: pattern.id });
  return `${prog.name}: ${labels.join(" – ")} written on “${channel.name}” (undo with ⌘Z)`;
}

export function ProgressionPicker({ onClose }: { onClose: () => void }) {
  const { project, toast } = useStudio();
  const [mode, setMode] = useState<"all" | "major" | "minor">(project.scale.includes("minor") ? "minor" : "all");
  const [q, setQ] = useState("");
  const [rhythm, setRhythm] = useState<ChordRhythm>("whole");
  const [bars, setBars] = useState(1);
  const [bass, setBass] = useState(false);
  const keyPc = parseKey(project.key)?.pc ?? 0;
  const list = useMemo(() => PROGRESSIONS.filter((p) => (mode === "all" || p.mode === mode) && (!q || `${p.name} ${p.moods.join(" ")} ${p.styles.join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [mode, q]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(860px, calc(100vw - 24px))", maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
        <div className="row"><h2 style={{ margin: 0 }}><Icon name="keys" /> Chord Progressions <span className="faint small">in {project.key}</span></h2><div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="row wrap" style={{ margin: "10px 0", gap: 6 }}>
          <input className="search-box" style={{ margin: 0, width: 200 }} placeholder="Mood or style: sad, jazzy, trap…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="sel" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode">
            <option value="all">Major & minor</option><option value="major">Major</option><option value="minor">Minor</option>
          </select>
          <select className="sel" value={rhythm} onChange={(e) => setRhythm(e.target.value as ChordRhythm)} aria-label="Rhythm">
            {CHORD_RHYTHMS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="sel" value={bars} onChange={(e) => setBars(Number(e.target.value))} aria-label="Bars per chord">
            <option value={1}>1 bar per chord</option><option value={2}>2 bars per chord</option>
          </select>
          <label className="row small"><input type="checkbox" checked={bass} onChange={(e) => setBass(e.target.checked)} />Add bass notes</label>
        </div>
        <div style={{ overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
          {list.map((p) => (
            <button key={p.id} className="card groove-card" onClick={() => { toast(applyProgression(p, { rhythm, barsPerChord: bars, bass }), "success"); onClose(); }}>
              <b>{p.name}</b>
              <span className="mono small">{progressionNotes(p, keyPc).labels.join(" – ")}</span>
              <span className="faint small">{p.numerals.join(" ")} · {p.mode}</span>
              <span className="small dim">{p.moods.join(", ")} · {p.styles.join(", ")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
