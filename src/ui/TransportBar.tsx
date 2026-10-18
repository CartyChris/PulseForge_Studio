/** Top transport & toolbar: play/stop/record, BPM, tap tempo, position, meters, status lights. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudio, usePlayhead } from "../state/store";
import { engine } from "../engine/engine";
import { formatPosition, formatSeconds, ticksToSeconds, ticksPerBar } from "../../shared/time";
import { ProjectMenu } from "./ProjectMenu";
import { SettingsButton } from "./Settings";
import { Icon, BrandMark } from "./shell/Icons";
import { ShowAt, LevelSwitch, AiSwitch } from "./shell/Level";
import { LcdSpectrum, LcdBeats } from "./viz/LiveVisuals";
import { useVizPrefs } from "../viz/prefs";
import { Portal } from "./shell/Portal";

const SQUEEZE_STEPS = 12;

/** the bar doesn't fit: it overflows sideways, or (wrapping on phones) needs more than two rows */
function tooBig(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  if (getComputedStyle(el).flexWrap !== "wrap") return false;
  const rows = new Set<number>();
  for (const c of el.children) {
    const r = (c as HTMLElement).getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rows.add(Math.round(r.top / 8));
  }
  return rows.size > 2;
}

export function TransportBar() {
  const { project, playing, recording, micActive, cloudActive, aiBusy, aiEnabled, dirty, lastSavedAt, snap, setSnap, playMode, setPlayMode, update, undo, redo, undoStack, redoStack, save, setTab, toast } = useStudio();
  const positionTicks = usePlayhead((s) => s.ticks);
  const [status, setStatus] = useState(engine.status());
  const [moreAt, setMoreAt] = useState<{ x: number; y: number; tap: boolean; tools: boolean } | null>(null); // ⋯ popover anchor (fixed: the bar clips overflow)
  const moreOpen = moreAt !== null;
  const tapTimes = useRef<number[]>([]);
  const level = useStudio((s) => s.level);
  const barRef = useRef<HTMLDivElement>(null);
  const lcdOn = useVizPrefs((v) => v.lcd);

  // Keep every control reachable at any window width: add squeeze steps (see .topbar.sqN in
  // styles.css) one at a time until the bar fits — one row on desktop, at most two rows on phones
  // (where the bar wraps). Classes are set on the DOM directly so the 150ms status re-renders
  // never fight them.
  const fit = useCallback(() => {
    const el = barRef.current;
    if (!el) return;
    for (let k = 1; k <= SQUEEZE_STEPS; k++) el.classList.remove(`sq${k}`);
    for (let n = 1; n <= SQUEEZE_STEPS && tooBig(el); n++) el.classList.add(`sq${n}`);
  }, []);
  useLayoutEffect(fit, [fit, level, project.name, playMode, aiEnabled]);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    const t = setInterval(() => {
      setStatus(engine.status());
      const el = barRef.current; // content can grow later (engine info text), re-fit if it overflows
      if (el && tooBig(el)) fit();
    }, 150);
    return () => clearInterval(t);
  }, [fit]);

  const togglePlay = async () => {
    if (engine.playing) engine.pause();
    else await engine.play();
  };

  const tapTempo = () => {
    const now = performance.now();
    tapTimes.current = tapTimes.current.filter((t) => now - t < 3000);
    tapTimes.current.push(now);
    if (tapTimes.current.length >= 3) {
      const diffs = tapTimes.current.slice(1).map((t, i) => t - tapTimes.current[i]!);
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const bpm = Math.round((60_000 / avg) * 10) / 10;
      if (bpm >= 20 && bpm <= 400) update((p) => ({ ...p, bpm }));
    } else {
      toast("Keep tapping…");
    }
  };

  const meterPct = status.masterPeakDb === -Infinity ? 0 : Math.max(0, Math.min(100, ((status.masterPeakDb + 48) / 48) * 100));
  const loopOn = project.loop.enabled;

  // snap / time signature / count-in: inline on wide windows, in a ⋯ popover on narrow ones
  const extras = (
    <>
      <select className="sel" title="Snap grid" value={snap} aria-label="Snap" onChange={(e) => setSnap(e.target.value)}>
        {["bar", "beat", "1/2", "1/4", "1/8", "step", "1/32", "none"].map((s) => <option key={s} value={s}>Snap: {s}</option>)}
      </select>
      <ShowAt min="expert">
        <select className="sel" title="Time signature" aria-label="Time signature" value={`${project.timeSignature.num}/${project.timeSignature.den}`}
          onChange={(e) => { const [num, den] = e.target.value.split("/").map(Number); update((p) => ({ ...p, timeSignature: { num: num!, den: den as 4 } })); }}>
          {["4/4", "3/4", "6/8", "5/4", "7/8", "2/4", "12/8"].map((ts) => <option key={ts}>{ts}</option>)}
        </select>
        <select className="sel" title="Count-in bars before recording" value={project.countInBars} aria-label="Count-in"
          onChange={(e) => update((p) => ({ ...p, countInBars: Number(e.target.value) }))}>
          {[0, 1, 2].map((n) => <option key={n} value={n}>Count-in: {n}</option>)}
        </select>
      </ShowAt>
    </>
  );

  return (
    <div className="topbar" ref={barRef}>
      <div className="logo" title="PulseForge Studio 2.0">
        <BrandMark size={28} />
        <span className="word"><span className="pulse">Pulse</span>Forge</span>
      </div>

      <ProjectMenu />

      <div className="seg" role="radiogroup" aria-label="Playback mode">
        <button role="radio" aria-checked={playMode === "pattern"} className={playMode === "pattern" ? "on" : ""}
          title="Pattern mode: loop the current pattern" onClick={() => setPlayMode("pattern")}><Icon name="pads" size={14} /><span className="lbl">Pattern</span></button>
        <button role="radio" aria-checked={playMode === "song"} className={playMode === "song" ? "on" : ""}
          title="Song mode: play the whole arrangement" onClick={() => setPlayMode("song")}><Icon name="song" size={14} /><span className="lbl">Song</span></button>
      </div>

      <div className="tb-group" role="toolbar" aria-label="Transport">
        <button className="tbtn" title="Back to start" aria-label="Back to start" onClick={() => engine.seek(0)}><Icon name="rewind" size={15} /></button>
        <button className={`tbtn play ${playing ? "active" : ""}`} title="Play / Pause (Space)" aria-label="Play or pause" onClick={togglePlay}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button className="tbtn" title="Stop" aria-label="Stop" onClick={() => engine.stop()}><Icon name="stop" size={14} /></button>
        <button className={`tbtn rec ${recording ? "active" : ""}`} title="Record (R) — opens the recording studio" aria-label="Record" onClick={() => setTab("recording")}>
          <Icon name="record" size={15} />
        </button>
        <button className={`tbtn ${loopOn ? "active" : ""}`} title="Loop region on/off" aria-label="Toggle loop"
          onClick={() => update((p) => ({
            ...p,
            loop: p.loop.enabled
              ? { ...p.loop, enabled: false }
              : { enabled: true, startTick: 0, endTick: p.loop.endTick > 0 ? p.loop.endTick : ticksPerBar(p.timeSignature) * 4 },
          }))}><Icon name="loop" size={15} /></button>
      </div>

      <button className={`position-display lcd ${playing ? "live" : ""}`} title="Now playing: Bar.Beat.Step · time. Click for the full-screen Visualizer" onClick={() => setTab("visualizer")}>
        {lcdOn && <LcdSpectrum />}
        <span className="lcd-row"><span className="lcd-pos">{formatPosition(positionTicks, project.timeSignature)}</span><LcdBeats /></span>
        <span className="sub">{formatSeconds(ticksToSeconds(positionTicks, project.bpm))}</span>
      </button>

      <div className="bpm-box" title="Tempo (BPM)">
        <input className="num-input" type="number" min={20} max={400} step={0.5} value={project.bpm} aria-label="BPM"
          onChange={(e) => { const bpm = Number(e.target.value); if (bpm >= 20 && bpm <= 400) update((p) => ({ ...p, bpm })); }} />
        <label>bpm</label>
        <ShowAt min="intermediate"><button className="tbtn tap-btn" title="Tap tempo" onClick={tapTempo}>TAP</button></ShowAt>
      </div>

      <button className={`tbtn tb-metro ${project.metronome ? "active" : ""}`} title="Metronome (M)" aria-label="Metronome"
        onClick={() => update((p) => ({ ...p, metronome: !p.metronome }))}><Icon name="metronome" size={15} /></button>

      <ShowAt min="intermediate"><span className="tb-inline">{extras}</span></ShowAt>
      {/* ⋯ overflow: whatever the squeeze steps took off the bar lands here, so nothing is ever unreachable */}
      <span className="tb-more">
        <button className={`tbtn ${moreOpen ? "active" : ""}`} title="More: snap, time signature, count-in and anything that didn't fit" aria-label="More transport options" aria-expanded={moreOpen}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const bar = barRef.current;
            setMoreAt(moreOpen ? null : { x: r.left + r.width / 2, y: r.bottom + 6, tap: !!bar?.classList.contains("sq7"), tools: !!bar?.classList.contains("sq8") });
          }}><Icon name="sliders" size={15} /></button>
        {moreAt && (
          <Portal>
            <div className="tb-more-scrim" onMouseDown={() => setMoreAt(null)} />
            <div className="tb-more-pop" style={{ left: Math.max(130, Math.min(moreAt.x, window.innerWidth - 130)), top: moreAt.y }}>
              {((moreAt.tap && level !== "beginner") || moreAt.tools) && (
                <div className="tb-more-row">
                  {moreAt.tap && <ShowAt min="intermediate"><button className="tbtn" title="Tap tempo" onClick={tapTempo}>TAP</button></ShowAt>}
                  {moreAt.tools && <>
                    <button className={`tbtn ${project.metronome ? "active" : ""}`} title="Metronome (M)" aria-label="Metronome" onClick={() => update((p) => ({ ...p, metronome: !p.metronome }))}><Icon name="metronome" size={15} /></button>
                    <button className="tbtn" title="Undo (⌘Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}><Icon name="undo" size={15} /></button>
                    <button className="tbtn" title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}><Icon name="redo" size={15} /></button>
                  </>}
                </div>
              )}
              <ShowAt min="intermediate">{extras}</ShowAt>
            </div>
          </Portal>
        )}
      </span>

      <div className="tb-group tb-undo">
        <button className="tbtn" title="Undo (⌘Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}><Icon name="undo" size={15} /></button>
        <button className="tbtn" title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}><Icon name="redo" size={15} /></button>
      </div>

      <div className="spacer" />

      <div className={`meter-master ${status.clipped ? "clip" : ""}`}
        title={`Master peak ${status.masterPeakDb === -Infinity ? "-∞" : status.masterPeakDb.toFixed(1)} dB${status.clipped ? " — CLIPPED (click to reset)" : ""}`}
        onClick={() => engine.resetClip()}>
        <div className="fill" style={{ width: `${meterPct}%` }} />
      </div>

      <div className="status-lights" title="Status: microphone · cloud · AI · saved">
        <ShowAt min="expert"><span className="mono engine-info">{status.running ? `${(status.sampleRate / 1000).toFixed(1)}k · ${status.outputLatencyMs}ms` : "engine idle"}</span></ShowAt>
        <span className={`light ${micActive ? "on-red" : ""}`} title={micActive ? "Microphone active" : "Microphone off"} />
        <span className={`light ${cloudActive ? "on-cyan" : ""}`} title={cloudActive ? "Cloud request in flight" : "No cloud activity"} />
        {aiEnabled && <span className={`light ${aiBusy ? "on-purple" : ""}`} title={aiBusy ? "AI working" : "AI idle"} />}
        <span className={`light ${!dirty ? "on-green" : ""}`} title={dirty ? "Unsaved changes (autosave pending)" : `Saved ${lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : ""}`} />
      </div>

      <AiSwitch />
      <LevelSwitch compact />
      <button className="tbtn" title="Save (⌘S)" aria-label="Save" onClick={() => save(true)}><Icon name="save" size={15} /></button>
      <SettingsButton />
    </div>
  );
}
