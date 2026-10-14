/** Top transport & toolbar: play/stop/record, BPM, tap tempo, position, meters, status lights. */
import { useEffect, useRef, useState } from "react";
import { useStudio, usePlayhead } from "../state/store";
import { engine } from "../engine/engine";
import { formatPosition, formatSeconds, ticksToSeconds, ticksPerBar } from "../../shared/time";
import { ProjectMenu } from "./ProjectMenu";
import { SettingsButton } from "./Settings";

export function TransportBar() {
  const { project, playing, recording, micActive, cloudActive, aiBusy, dirty, lastSavedAt, snap, setSnap, playMode, setPlayMode, update, undo, redo, undoStack, redoStack, save, setTab, toast } = useStudio();
  const positionTicks = usePlayhead((s) => s.ticks);
  const [status, setStatus] = useState(engine.status());
  const tapTimes = useRef<number[]>([]);

  useEffect(() => {
    const t = setInterval(() => setStatus(engine.status()), 150);
    return () => clearInterval(t);
  }, []);

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

  return (
    <div className="topbar">
      <div className="logo" title="PulseForge Studio">
        <div className="logo-mark">⚒</div>
        <span><span className="pulse">Pulse</span>Forge</span>
      </div>

      <ProjectMenu />

      <div className="transport" role="toolbar" aria-label="Playback mode">
        <button
          className={`tbtn ${playMode === "pattern" ? "active" : ""}`}
          title="Pattern mode — loop the current Channel Rack pattern"
          onClick={() => setPlayMode("pattern")}
        >PAT</button>
        <button
          className={`tbtn ${playMode === "song" ? "active" : ""}`}
          title="Song mode — play the Playlist arrangement"
          onClick={() => setPlayMode("song")}
        >SONG</button>
      </div>

      <div className="transport" role="toolbar" aria-label="Transport">
        <button className="tbtn" title="Return to beginning" aria-label="Return to beginning" onClick={() => engine.seek(0)}>⏮</button>
        <button className={`tbtn ${playing ? "active" : ""}`} title="Play / Pause (Space)" aria-label="Play or pause" onClick={togglePlay}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="tbtn" title="Stop" aria-label="Stop" onClick={() => engine.stop()}>■</button>
        <button
          className={`tbtn rec ${recording ? "active" : ""}`}
          title="Record (R) — opens Recording Studio"
          aria-label="Record"
          onClick={() => setTab("recording")}
        >●</button>
        <button
          className={`tbtn ${loopOn ? "active" : ""}`}
          title="Toggle loop region"
          aria-label="Toggle loop"
          onClick={() => update((p) => ({
            ...p,
            loop: p.loop.enabled
              ? { ...p.loop, enabled: false }
              : { enabled: true, startTick: 0, endTick: p.loop.endTick > 0 ? p.loop.endTick : ticksPerBar(p.timeSignature) * 4 },
          }))}
        >⟲</button>
      </div>

      <div className="position-display" title="Bar.Beat.Step | mm:ss">
        <div>{formatPosition(positionTicks, project.timeSignature)}</div>
        <div className="sub">{formatSeconds(ticksToSeconds(positionTicks, project.bpm))}</div>
      </div>

      <div className="bpm-box" title="Tempo (BPM)">
        <input
          className="num-input"
          type="number"
          min={20}
          max={400}
          step={0.5}
          value={project.bpm}
          aria-label="BPM"
          onChange={(e) => {
            const bpm = Number(e.target.value);
            if (bpm >= 20 && bpm <= 400) update((p) => ({ ...p, bpm }));
          }}
        />
        <button className="tbtn" title="Tap tempo" onClick={tapTempo}>TAP</button>
      </div>

      <select
        className="sel"
        title="Time signature"
        aria-label="Time signature"
        value={`${project.timeSignature.num}/${project.timeSignature.den}`}
        onChange={(e) => {
          const [num, den] = e.target.value.split("/").map(Number);
          update((p) => ({ ...p, timeSignature: { num: num!, den: den as 4 } }));
        }}
      >
        {["4/4", "3/4", "6/8", "5/4", "7/8", "2/4", "12/8"].map((ts) => <option key={ts}>{ts}</option>)}
      </select>

      <button
        className={`tbtn ${project.metronome ? "active" : ""}`}
        title="Metronome (M)"
        aria-label="Metronome"
        onClick={() => update((p) => ({ ...p, metronome: !p.metronome }))}
      >⏱</button>

      <select className="sel" title="Count-in bars" value={project.countInBars} aria-label="Count-in"
        onChange={(e) => update((p) => ({ ...p, countInBars: Number(e.target.value) }))}>
        {[0, 1, 2].map((n) => <option key={n} value={n}>Count-in: {n}</option>)}
      </select>

      <select className="sel" title="Snap grid" value={snap} aria-label="Snap" onChange={(e) => setSnap(e.target.value)}>
        {["bar", "beat", "1/2", "1/4", "1/8", "step", "1/32", "none"].map((s) => <option key={s} value={s}>Snap: {s}</option>)}
      </select>

      <div className="row" style={{ gap: 3 }}>
        <button className="tbtn" title="Undo (⌘Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}>↩</button>
        <button className="tbtn" title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}>↪</button>
      </div>

      <div className="spacer" />

      <div
        className={`meter-master ${status.clipped ? "clip" : ""}`}
        title={`Master peak ${status.masterPeakDb === -Infinity ? "-∞" : status.masterPeakDb.toFixed(1)} dB${status.clipped ? " — CLIPPED (click to reset)" : ""}`}
        onClick={() => engine.resetClip()}
      >
        <div className="fill" style={{ width: `${meterPct}%` }} />
      </div>

      <div className="status-lights" title="Audio engine status">
        <span className="mono">{status.running ? `${(status.sampleRate / 1000).toFixed(1)}k · ${status.outputLatencyMs}ms` : "engine idle"}</span>
        <span className={`light ${micActive ? "on-red" : ""}`} title={micActive ? "Microphone active" : "Microphone off"} />
        <span className={`light ${cloudActive ? "on-cyan" : ""}`} title={cloudActive ? "Cloud request in flight" : "No cloud activity"} />
        <span className={`light ${aiBusy ? "on-purple" : ""}`} title={aiBusy ? "AI generation running" : "AI idle"} />
        <span className={`light ${!dirty ? "on-green" : ""}`} title={dirty ? "Unsaved changes (autosave pending)" : `Saved ${lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : ""}`} />
      </div>

      <button className="btn small" title="Save (⌘S)" onClick={() => save(true)}>Save</button>
      <SettingsButton />
    </div>
  );
}
