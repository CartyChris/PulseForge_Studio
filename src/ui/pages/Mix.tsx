/**
 * Mix — Quick Mix macros + one-click measured Auto-mix above the full mixer.
 * Macros drive the named inserts the producer creates (Drums, Bass, Chords/Melody → Music, Reverb)
 * and fall back gracefully when a project doesn't have them.
 */
import { useState } from "react";
import { useStudio } from "../../state/store";
import { Mixer } from "../Mixer";
import { MASTER_ID, type MixerChannel } from "../../../shared/project";
import { renderProject } from "../../engine/render";
import { engine } from "../../engine/engine";
import { mixMetrics, type MixMetrics } from "../../engine/analysis";
import { autoMixCommands, loudnessTarget } from "../../ai/producer-agent";
import { Icon } from "../shell/Icons";
import { Coach } from "../shell/Level";
import type { GenreId } from "../../../shared/producer";

function Macro({ label, hint, channels, onChange }: { label: string; hint: string; channels: MixerChannel[]; onChange: (deltaDb: number) => void }) {
  const value = channels.length ? channels.reduce((a, c) => a + c.volumeDb, 0) / channels.length : 0;
  return (
    <div className="card" style={{ padding: 12, opacity: channels.length ? 1 : 0.45 }} title={channels.length ? `${hint} — ${channels.map((c) => c.name).join(", ")}` : `${hint} (no matching mixer channel in this project)`}>
      <div className="row"><b className="small">{label}</b><div className="spacer" /><span className="mono small dim">{value.toFixed(1)} dB</span></div>
      <input type="range" min={-30} max={6} step={0.5} value={value} disabled={!channels.length} style={{ width: "100%" }}
        onPointerDown={() => { const s = useStudio.getState(); s.pushUndo(s.project); }}
        onChange={(e) => onChange(Number(e.target.value) - value)} aria-label={label} />
    </div>
  );
}

/** Loudness: drives the pre-limiter gain stage when the master has one (the limiter keeps peaks safe);
 * otherwise falls back to the master fader. The post-limiter fader is never pushed past the ceiling. */
function LoudnessMacro({ master }: { master: MixerChannel }) {
  const { update } = useStudio();
  const limIdx = master.effects.findIndex((e) => e.type === "limiter");
  const drive = limIdx > 0 ? master.effects.slice(0, limIdx).reverse().find((e) => e.type === "gain") : undefined;
  if (!drive) return null;
  const value = drive.params.gain ?? 0;
  const set = (v: number) => update((p) => ({
    ...p,
    mixer: { channels: p.mixer.channels.map((c) => (c.id !== master.id ? c : { ...c, effects: c.effects.map((e) => (e.id === drive.id ? { ...e, params: { ...e.params, gain: v } } : e)) })) },
  }), { undoable: false });
  return (
    <div className="card" style={{ padding: 12 }} title="Drive into the master limiter: louder without clipping">
      <div className="row"><b className="small">Loudness</b><div className="spacer" /><span className="mono small dim">{value > 0 ? "+" : ""}{value.toFixed(1)} dB</span></div>
      <input type="range" min={-12} max={24} step={0.5} value={value} style={{ width: "100%" }}
        onPointerDown={() => { const s = useStudio.getState(); s.pushUndo(s.project); }}
        onChange={(e) => set(Number(e.target.value))} aria-label="Loudness" />
    </div>
  );
}

export function MixPage() {
  const { project, update, dispatchMany, toast } = useStudio();
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<MixMetrics | null>(null);
  const byName = (re: RegExp) => project.mixer.channels.filter((c) => c.kind !== "master" && re.test(c.name));
  const master = project.mixer.channels.find((c) => c.id === MASTER_ID)!;
  const nudge = (chs: MixerChannel[], delta: number) => {
    const ids = new Set(chs.map((c) => c.id));
    update((p) => ({ ...p, mixer: { channels: p.mixer.channels.map((c) => (ids.has(c.id) ? { ...c, volumeDb: Math.max(-60, Math.min(12, Math.round((c.volumeDb + delta) * 10) / 10)) } : c)) } }), { undoable: false });
  };

  const autoMix = async () => {
    setBusy(true);
    try {
      await engine.init();
      const end = Math.max(0, ...project.clips.map((c) => c.startTick + c.lengthTicks));
      // measure the busiest 8 bars: the loudest section if labeled, else the start
      const loud = [...project.sections].sort((a, b) => b.lengthTicks - a.lengthTicks).find((s) => /hook|chorus|drop/i.test(s.name)) ?? project.sections[0];
      const from = loud?.startTick ?? 0;
      const to = Math.min(end || from + 8 * 384, from + 8 * 384);
      const r = await renderProject(project, (id) => engine.getAssetBuffer(id), { fromTick: from, toTick: Math.max(from + 384, to), tailSec: 0.4, sampleRate: 22050 }, "quick-mix");
      if (!r) return;
      const m = mixMetrics(r.channelData, r.sampleRate);
      setMetrics(m);
      const genre = ((project.ui as { production?: { genre?: GenreId } }).production?.genre) ?? "trap";
      const { commands, notes } = autoMixCommands(project, m, loudnessTarget({ genre }));
      if (!commands.length) toast(m.lufs <= -69 ? "Nothing audible to measure — add some sounds first" : `Mix measures ≈${m.lufs} LUFS — already in a good place`, "success");
      else if (dispatchMany(commands)) toast(`${notes.join(" · ")} (undo with ⌘Z)`, "success");
    } catch (e) {
      toast(`Auto-mix failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-fill">
      <div className="page-bar">
        <h1><Icon name="mixer" /> Mix</h1>
        <span className="sub">Balance your sounds. Quick Mix for the big moves, the full mixer for detail.</span>
        <div className="spacer" />
        <button className="btn primary" disabled={busy} onClick={autoMix} title="Render a section, measure loudness & tone, and gain-stage the master and bass (undoable)">
          <Icon name="wand" /> {busy ? "Listening…" : "Auto-mix"}
        </button>
      </div>
      <div className="fill" style={{ display: "flex", flexDirection: "column" }}>
        <Coach id="mix-quick" title="Mixing made simple:">
          drag the Quick Mix sliders to balance drums, bass and music, or press <b>Auto-mix</b> and PulseForge measures your song and sets the levels. Everything here can be undone.
        </Coach>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, padding: "12px 14px 0" }}>
          {master.effects.some((e) => e.type === "limiter") && master.effects.some((e) => e.type === "gain")
            ? <LoudnessMacro master={master} />
            : <Macro label="Loudness" hint="Master output" channels={[master]} onChange={(d) => nudge([master], d)} />}
          <Macro label="Drums" hint="Kick + drum inserts" channels={byName(/^(kick|drums)\b/i)} onChange={(d) => nudge(byName(/^(kick|drums)\b/i), d)} />
          <Macro label="Bass" hint="Bass / 808 insert" channels={byName(/^bass\b/i)} onChange={(d) => nudge(byName(/^bass\b/i), d)} />
          <Macro label="Music" hint="Chords, melody & counter" channels={byName(/^(chords|melody|counter|music bus)\b/i)} onChange={(d) => nudge(byName(/^(chords|melody|counter|music bus)\b/i), d)} />
          <Macro label="Space" hint="Reverb & delay returns" channels={byName(/^(reverb|delay)\b/i)} onChange={(d) => nudge(byName(/^(reverb|delay)\b/i), d)} />
        </div>
        {metrics && (
          <p className="small dim mono" style={{ margin: "8px 16px 0" }}>Measured: ≈{metrics.lufs} LUFS · peak {metrics.peakDb} dBFS · low {(metrics.low * 100).toFixed(0)}% · mid {(metrics.mid * 100).toFixed(0)}% · high {(metrics.high * 100).toFixed(0)}%</p>
        )}
        <div style={{ flex: 1, minHeight: 0 }}><Mixer /></div>
      </div>
    </div>
  );
}
