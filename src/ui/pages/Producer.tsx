/** AI Producer — describe → plan → compose → arrange → mix → review, then iterate in plain English. */
import { useEffect, useState } from "react";
import { useStudio } from "../../state/store";
import { useProducer } from "../../ai/useProducer";
import { GENRES, GENRE_IDS, type GenreId, type ProductionSpec } from "../../../shared/producer";
import { NOTE_NAMES, SCALES } from "../../../shared/time";
import { engine } from "../../engine/engine";
import { Icon, type IconName } from "../shell/Icons";
import { ShowAt, Coach, useLevel } from "../shell/Level";
import { GENRE_COLORS, IDEAS } from "./Home";
import { ExportDialog } from "../ProjectMenu";

const STAGE_ICON: Record<string, IconName> = { plan: "sparkles", compose: "keys", arrange: "song", mix: "mixer", review: "headphones" };
const REVISE_IDEAS = ["faster", "darker", "hit harder", "more swing", "another version", "longer", "softer, more space", "use a piano"];

export function Producer() {
  const level = useLevel();
  const { setTab, playing } = useStudio();
  const p = useProducer();
  const [prompt, setPrompt] = useState(p.lastRequest?.prompt ?? "");
  const [genre, setGenre] = useState<GenreId | "">("");
  const [bpm, setBpm] = useState("");
  const [key, setKey] = useState("");
  const [scale, setScale] = useState("");
  const [length, setLength] = useState<ProductionSpec["length"] | "">("");
  const [append, setAppend] = useState(false);
  const [change, setChange] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => { void p.refreshProviders(); }, []); // mount only
  const provider = p.resolvedProvider();
  const run = p.run;

  const go = () => {
    void p.start({
      prompt: prompt || (genre ? GENRES[genre].name : "beat"),
      mode: append ? "append" : "replace",
      overrides: {
        genre: genre || undefined,
        bpm: bpm ? Math.max(50, Math.min(200, Number(bpm))) : undefined,
        key: key || undefined,
        scale: scale || undefined,
        length: length || undefined,
      },
    });
  };
  const play = async () => {
    if (engine.playing) { engine.stop(); return; }
    useStudio.getState().setPlayMode("song");
    await engine.play(0);
  };

  return (
    <div className="page-fill">
      <div className="page-bar">
        <h1><Icon name="sparkles" /> AI Producer</h1>
        <span className="sub">A full beat from one sentence. With AI or fully offline.</span>
        <div className="spacer" />
        <label className="small dim row" title="Who plans the beat. Auto prefers your logged-in AI subscriptions, then API keys, then local models.">
          Brain
          <select className="sel" value={p.choice} onChange={(e) => p.setChoice(e.target.value)} aria-label="AI used by the producer">
            <option value="auto">Auto{provider ? ` (${provider.name})` : " (offline)"}</option>
            <option value="offline">Offline producer (no AI)</option>
            {p.providers.map((x) => <option key={x.id} value={x.id}>{x.name}{x.configured ? " ✓" : ""}</option>)}
          </select>
        </label>
        <ShowAt min="intermediate">
          <label className="small dim row" title="After mixing, an AI mix engineer reviews the measurements and suggests fixes">
            <input type="checkbox" checked={p.review} onChange={(e) => p.setReview(e.target.checked)} /> Review
          </label>
          <label className="small dim row" title="Apply the reviewer's safe mixer fixes automatically (always undoable)">
            <input type="checkbox" checked={p.autoApply} onChange={(e) => p.setAutoApply(e.target.checked)} /> Auto-apply fixes
          </label>
        </ShowAt>
      </div>

      <div className="fill" style={{ overflowY: "auto" }}>
        <Coach id="producer-intro" title="How it works:">
          the planner (your AI, or the offline producer) picks genre, tempo, key, chords, form and sounds. Then the engine writes every note in key, builds the session on real mixer tracks, and checks loudness on a test render. Every step can be undone.
        </Coach>
        <div className="grid two" style={{ padding: 16, alignItems: "start" }}>
          {/* ── request ── */}
          <div className="card">
            <h3><Icon name="wand" /> Describe your beat</h3>
            <textarea className="prompt-box" style={{ width: "100%" }} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="Genre, mood, tempo, key, instruments, references… e.g. “moody drill beat with strings and a sliding 808, 142 bpm in F# minor”"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); }} />
            <div className="idea-row">{IDEAS.slice(0, 5).map((i) => <button key={i} className="chip" onClick={() => setPrompt(i)}>{i}</button>)}</div>

            <h3 className="section">Genre</h3>
            <div className="row wrap">
              <button className={`chip ${genre === "" ? "on" : ""}`} onClick={() => setGenre("")}>Auto</button>
              {GENRE_IDS.map((g) => (
                <button key={g} className={`chip ${genre === g ? "on" : ""}`} style={genre === g ? { borderColor: GENRE_COLORS[g] } : undefined} onClick={() => setGenre(g)} title={GENRES[g].blurb}>{GENRES[g].name}</button>
              ))}
            </div>

            <ShowAt min="intermediate">
              <h3 className="section">Options</h3>
              <div className="row wrap">
                <label className="small dim row">BPM <input className="num-input" placeholder="auto" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/\D/g, ""))} /></label>
                <select className="sel" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Key"><option value="">Key: auto</option>{NOTE_NAMES.map((n) => <option key={n}>{n}</option>)}</select>
                <select className="sel" value={scale} onChange={(e) => setScale(e.target.value)} aria-label="Scale"><option value="">Scale: auto</option>{Object.keys(SCALES).filter((s) => s !== "chromatic").map((s) => <option key={s}>{s}</option>)}</select>
                <select className="sel" value={length} onChange={(e) => setLength(e.target.value as ProductionSpec["length"])} aria-label="Length">
                  <option value="">Length: auto</option><option value="short">Short (~1 min)</option><option value="standard">Standard (~2–3 min)</option><option value="extended">Extended (~4 min)</option>
                </select>
                <label className="small dim row" title="Add the new beat after your current song instead of replacing the arrangement">
                  <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} /> Add to current song
                </label>
              </div>
            </ShowAt>

            <div className="row" style={{ marginTop: 16 }}>
              {!p.running
                ? <button className="btn primary big" onClick={go}><Icon name="sparkles" /> Produce beat</button>
                : <button className="btn danger big" onClick={p.cancel}><Icon name="stop" /> Cancel</button>}
              <span className="small faint">{append ? "Adds after your song" : "Replaces the arrangement (your recordings & imports stay). Undo with ⌘Z"}</span>
            </div>
          </div>

          {/* ── progress + result ── */}
          <div className="col">
            {!run && (
              <div className="card">
                <h3><Icon name="layers" /> The pipeline</h3>
                <div className="stage-list">
                  {(["Plan: genre, tempo, key, chords, form, sounds", "Compose: drums, 808/bass, chords, melody, counter-melody", "Arrange: tracks, patterns, transitions, automation", "Mix & master: test render, measure, gain staging", "Review: an AI mix engineer checks the numbers (optional)"] as const).map((t, i) => (
                    <div key={i} className="stage"><div className="dot">{i + 1}</div><div><span>{t}</span></div></div>
                  ))}
                </div>
              </div>
            )}

            {run && (
              <div className="card">
                <h3><Icon name="layers" /> {p.running ? "Producing…" : run.error ? "Stopped" : "Done"}</h3>
                <div className="stage-list">
                  {run.stages.map((s) => (
                    <div key={s.id} className={`stage ${s.status}`}>
                      <div className="dot">{s.status === "done" ? <Icon name="check" size={15} /> : s.status === "error" ? <Icon name="alert" size={15} /> : <Icon name={STAGE_ICON[s.id] ?? "sparkles"} size={14} />}</div>
                      <div><b>{s.label}</b>{s.detail && <span>{s.detail}</span>}</div>
                    </div>
                  ))}
                </div>
                {run.notes.length > 0 && (
                  <ul className="small dim" style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>{run.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                )}
              </div>
            )}

            {run && !run.error && !p.running && run.summary && (
              <div className="result-card">
                <h2>{run.spec?.title}</h2>
                <p className="dim" style={{ marginTop: 0 }}>{run.summary}</p>
                {run.spec?.notes && run.usedAI && <p className="small dim">{run.spec.notes}</p>}
                <div className="row wrap">
                  <button className="btn primary" onClick={play}><Icon name={playing ? "stop" : "play"} /> {playing ? "Stop" : "Play song"}</button>
                  <button className="btn" onClick={() => p.variation()}><Icon name="shuffle" /> New variation</button>
                  <button className="btn" onClick={() => setTab("playlist")}><Icon name="song" /> Open song</button>
                  <button className="btn" onClick={() => setTab("channel-rack")}><Icon name="pads" /> Edit drums</button>
                  <button className="btn" onClick={() => setExportOpen(true)}><Icon name="export" /> Export WAV</button>
                </div>

                <h3 className="section">Change it</h3>
                <div className="row">
                  <input className="search-box" style={{ margin: 0, flex: 1 }} value={change} onChange={(e) => setChange(e.target.value)}
                    placeholder="e.g. “faster and darker”, “swap the melody to flute”, “another version”"
                    onKeyDown={(e) => { if (e.key === "Enter" && change.trim()) { void p.revise(change); setChange(""); } }} />
                  <button className="btn" disabled={!change.trim()} onClick={() => { void p.revise(change); setChange(""); }}><Icon name="wand" /> Apply</button>
                </div>
                <div className="idea-row">{REVISE_IDEAS.slice(0, level === "beginner" ? 5 : 8).map((r) => <button key={r} className="chip" onClick={() => p.revise(r)}>{r}</button>)}</div>
                {p.reviseLog.length > 0 && <p className="small faint">{p.reviseLog.slice(-3).join(" · ")}</p>}

                {run.critique && (
                  <>
                    <h3 className="section">Producer review {run.critique.verdict === "ship" ? <span className="pill ok">ready</span> : <span className="pill warn">suggestions</span>}</h3>
                    <p className="small dim">{run.critique.summary}</p>
                    {run.critique.issues.length > 0 && <ul className="small dim" style={{ paddingLeft: 18 }}>{run.critique.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>}
                    {!!run.pendingFixes?.length && (
                      <button className="btn small" onClick={p.applyPendingFixes}><Icon name="check" size={13} /> Apply {run.pendingFixes.length} suggested fix{run.pendingFixes.length > 1 ? "es" : ""}</button>
                    )}
                  </>
                )}
                {run.metrics && (
                  <ShowAt min="intermediate">
                    <p className="small faint mono" style={{ marginBottom: 0 }}>
                      ≈{run.metrics.lufs} LUFS · peak {run.metrics.peakDb} dBFS · low {(run.metrics.low * 100).toFixed(0)}% · mid {(run.metrics.mid * 100).toFixed(0)}% · high {(run.metrics.high * 100).toFixed(0)}%
                    </p>
                  </ShowAt>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}
