/**
 * Chop & Screw panel (top of the Sample page): get a sound, screw/chop/spin it, give it a vintage
 * sampler character, fit it to the project, chop it to pads and flip the chops. Big, labelled
 * buttons; every result is a NEW asset (the original never changes) and every edit is undoable.
 */
import { useState } from "react";
import { useStudio } from "../state/store";
import type { AudioAsset } from "../../shared/project";
import {
  screw, rateToSemitones, slowedReverb, chopRepeat, stutter, backspin, tapeStop, vintageSampler, VINTAGE_PRESETS,
  timeStretch, pitchShift, fitPlan,
} from "../engine/chop";
import { estimateBpm, estimateKey } from "../engine/analysis";
import { chopsFromMarkers, autoChopPoints, type FlipStyle } from "../../shared/chops";
import { assetChannels, saveAudio, chopToPads, chopPadsFor, flipPads, useGenerate } from "../audio/sampling";
import { SAMPLE_STARTERS } from "../ai/sample-starters";
import { importAudioData } from "../audio/assets";
import { getHost } from "../host/adapter";
import { runAnalysis } from "../workers/analysis-client";
import { Icon } from "./shell/Icons";
import { ShowAt, AiOnly } from "./shell/Level";

interface Props {
  asset: AudioAsset | undefined;
  sel: { start: number; end: number } | null;
  markers: number[];
  setMarkers: (m: number[]) => void;
}

const yieldUI = () => new Promise((r) => setTimeout(r, 30));

export function ChopScrewPanel({ asset, sel, markers, setMarkers }: Props) {
  const { project, toast, setTab, addAsset, select } = useStudio();
  const gen = useGenerate();
  const [busy, setBusy] = useState<string | null>(null);
  const [rate, setRate] = useState(0.8);
  const [repeats, setRepeats] = useState(2);
  const [starter, setStarter] = useState(SAMPLE_STARTERS[0]!.id);
  const [prompt, setPrompt] = useState("");
  const hasSel = !!sel && sel.end - sel.start > 0.02;
  const pads = asset ? chopPadsFor(asset.id).length : 0;

  /** run a DSP transform on the selection (or the whole asset) and save it as a new asset */
  const run = async (label: string, fn: (data: Float32Array[], sr: number) => Float32Array[], tag: string, keepSelOnly = true, tempo: number | "keep" | ((bpm: number) => number) = "keep") => {
    if (!asset) return;
    setBusy(label);
    await yieldUI();
    try {
      const ch = await assetChannels(asset);
      if (!ch) throw new Error("couldn't read the audio");
      let data = ch.data;
      if (keepSelOnly && hasSel) {
        const s = Math.floor(sel!.start * ch.sr), e = Math.ceil(sel!.end * ch.sr);
        data = data.map((d) => d.slice(s, e));
      }
      const out = fn(data, ch.sr);
      // carry the known tempo through the transform (screw ×rate, half-time ×0.5…) instead of re-guessing it
      const src = asset.bpmEstimate;
      const bpm = typeof tempo === "number" ? tempo : tempo === "keep" ? src : src ? Math.round(tempo(src) * 10) / 10 : null;
      const a = await saveAudio(`${asset.name.replace(/\.wav$/i, "")} ${label}`, out, ch.sr, { tags: [tag], license: asset.licenseNote || undefined, bpm });
      toast(`Created "${a.name}" (original untouched, ⌘Z to undo)`, "success");
    } catch (e) {
      toast(`${label} failed: ${String(e instanceof Error ? e.message : e)}`, "error");
    }
    setBusy(null);
  };

  /** effects that need a position in the WHOLE recording (chop/backspin/stop at the selection) */
  const atSel = (fallbackFromEnd: number) => (hasSel ? sel!.start : Math.max(0, (asset?.durationSec ?? 0) - fallbackFromEnd));

  const importAudio = async () => {
    const files = await getHost().importFiles({ accept: [".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aif", ".aiff"], multiple: true });
    for (const f of files) {
      try {
        const a = await importAudioData(f.name, f.data, "import", { licenseNote: "Imported: check this sound's license before releasing." });
        addAsset(a);
        select({ assetId: a.id });
        toast(`"${a.name}" imported`, "success");
      } catch (e) { toast(String(e), "error"); }
    }
  };

  const makeStarter = async () => {
    const s = SAMPLE_STARTERS.find((x) => x.id === starter)!;
    await gen.start({ prompt: s.name, output: "loop", spec: s.spec, parts: s.parts, loopBars: s.bars });
  };

  const fit = () => run("fit", (data, sr) => {
    const mono = data.length > 1 ? data[0]!.map((v, i) => (v + data[1]![i]!) / 2) : data[0]!;
    const bpm = asset?.bpmEstimate ?? estimateBpm(mono, sr);
    const key = asset?.keyEstimate ?? estimateKey(mono, sr);
    const plan = fitPlan(bpm, project.bpm, key, `${project.key} ${project.scale}`);
    toast(`Fit: ${plan.note}`, "info");
    let out = data;
    if (Math.abs(plan.stretch - 1) > 0.005) out = timeStretch(out, sr, plan.stretch);
    if (plan.semitones !== 0) out = pitchShift(out, sr, plan.semitones);
    return out;
  }, "fit", true, project.bpm);

  const doChop = async (mode: 8 | 16 | "markers") => {
    if (!asset) return;
    setBusy("chopping");
    await yieldUI();
    let points = markers;
    if (mode !== "markers") {
      const ch = await assetChannels(asset);
      if (!ch) { setBusy(null); return; }
      const { promise } = runAnalysis("transients", ch.data[0]!, ch.sr);
      const res = await promise.catch(() => ({ transients: [] as number[] }));
      points = autoChopPoints((res.transients ?? []).map((t) => t / ch.sr), asset.durationSec, mode);
      setMarkers(points);
    }
    const chops = chopsFromMarkers(points, asset.durationSec);
    if (chops.length < 2) { toast("Add slice markers first (or use Auto 8 / Auto 16)", "error"); setBusy(null); return; }
    const r = chopToPads(asset, chops, project.bpm);
    toast(`${r.pads} pads made from "${asset.name}", with a pattern that plays the original. Flip it below or open Beat to play the pads`, "success");
    setBusy(null);
  };

  const flip = (style: FlipStyle) => {
    if (!asset) return;
    const name = flipPads(asset, style);
    toast(name ? `New pattern "${name}" (open Beat to hear it)` : "Chop this sample to pads first", name ? "success" : "error");
  };

  const B = ({ label, icon, onClick, disabled, title, primary }: { label: string; icon?: Parameters<typeof Icon>[0]["name"]; onClick: () => void; disabled?: boolean; title?: string; primary?: boolean }) => (
    <button className={`btn ${primary ? "primary" : ""}`} onClick={onClick} disabled={!!busy || disabled} title={title}>
      {icon && <Icon name={icon} size={14} />} {label}
    </button>
  );

  return (
    <div className="chop-screw">
      <div className="cs-card">
        <h3><Icon name="plus" size={14} /> Get a sound</h3>
        <div className="row wrap">
          <B label="Import audio…" icon="library" onClick={importAudio} />
          <select className="sel" value={starter} onChange={(e) => setStarter(e.target.value)} aria-label="Sample starter" title={SAMPLE_STARTERS.find((s) => s.id === starter)?.blurb}>
            {SAMPLE_STARTERS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <B label={gen.running ? "Making…" : "Make starter loop"} icon="sparkles" onClick={makeStarter} disabled={gen.running} title="A royalty-free loop rendered by PulseForge: nothing to clear" />
        </div>
        <AiOnly><div className="row" style={{ marginTop: 6 }}>
          <input className="search-box" style={{ flex: 1, margin: 0, width: "auto" }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="…or describe one: “dusty soul piano loop, 88 bpm, A minor”"
            onKeyDown={(e) => { if (e.key === "Enter" && prompt.trim()) void gen.start({ prompt: prompt.trim(), output: "loop", parts: ["chords", "melody"] }); }} />
          <B label="Generate loop" onClick={() => void gen.start({ prompt: prompt.trim(), output: "loop", parts: ["chords", "melody"] })} disabled={gen.running || !prompt.trim()} />
        </div></AiOnly>
        {gen.running && <p className="small dim" style={{ margin: "6px 0 0" }}>{gen.run?.stages.find((s) => s.status === "running")?.label ?? "Starting"}…</p>}
      </div>

      {asset && (
        <>
          <div className="cs-card">
            <h3><Icon name="wave" size={14} /> Screw &amp; chop <span className="faint small">{hasSel ? "on your selection" : "on the whole sample (drag on the waveform to select)"}</span></h3>
            <div className="row wrap">
              <label className="row small" title="Tape slow-down: slower and lower together">Screw
                <input type="range" min={0.6} max={1} step={0.01} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={{ width: 110 }} />
                <span className="mono dim">{Math.round(rate * 100)}% · {rateToSemitones(rate).toFixed(1)} st</span>
              </label>
              <B label="Screw it" primary onClick={() => run(`screwed ${Math.round(rate * 100)}%`, (d) => screw(d, rate), "screwed", true, (b) => b * rate)} />
              <B label="Slowed + reverb" onClick={() => run("slowed+reverb", (d, sr) => slowedReverb(d, sr, Math.min(0.9, rate + 0.05)), "slowed", true, (b) => b * Math.min(0.9, rate + 0.05))} />
            </div>
            <div className="row wrap" style={{ marginTop: 6 }}>
              <B label={`Chop ×${repeats}`} onClick={() => run(`chop x${repeats}`, (d, sr) => chopRepeat(d, sr, sel!.start, sel!.end - sel!.start, repeats), "chopped", false)} disabled={!hasSel}
                title="DJ Screw-style cut-back: repeats the selected phrase, then carries on" />
              <select className="sel" value={repeats} onChange={(e) => setRepeats(Number(e.target.value))} aria-label="Chop repeats">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}×</option>)}</select>
              <B label="Stutter 1/16" onClick={() => run("stutter", (d, sr) => stutter(d, sr, atSel(1), 60 / project.bpm / 4, 4), "stutter", false)} title="Four 16th-note repeats at the selection start" />
              <B label="Backspin" onClick={() => run("backspin", (d, sr) => backspin(d, sr, hasSel ? sel!.end : atSel(0), 0.9), "backspin", false)} title="Spins the record backwards at the end of the selection" />
              <B label="Tape stop" onClick={() => run("tape stop", (d, sr) => tapeStop(d, sr, hasSel ? sel!.end - Math.min(1.2, (sel!.end - sel!.start) / 2) : atSel(1.2), 1.2), "tapestop", false)} title="Power-down at the end of the selection" />
            </div>
          </div>

          <div className="cs-card">
            <h3><Icon name="knob" size={14} /> Vintage sampler character</h3>
            <div className="row wrap">
              {Object.entries(VINTAGE_PRESETS).map(([id, p]) => (
                <B key={id} label={p.name} title={p.blurb} onClick={() => run(p.name, (d, sr) => vintageSampler(d, sr, p.o), id)} />
              ))}
            </div>
          </div>

          <div className="cs-card">
            <h3><Icon name="metronome" size={14} /> Fit &amp; stretch</h3>
            <div className="row wrap">
              <B label={`Fit to ${project.bpm} BPM · ${project.key} ${project.scale}`} primary onClick={fit} title="Estimates the sample's tempo and key, then time-stretches and transposes it (pitch kept when stretching)" />
              <ShowAt min="intermediate">
                <B label="Pitch −1" onClick={() => run("-1st", (d, sr) => pitchShift(d, sr, -1), "pitched")} title="Down a semitone, same length" />
                <B label="Pitch +1" onClick={() => run("+1st", (d, sr) => pitchShift(d, sr, 1), "pitched")} title="Up a semitone, same length" />
                <B label="Half speed (keep pitch)" onClick={() => run("half-time", (d, sr) => timeStretch(d, sr, 2), "stretched", true, (b) => b / 2)} />
                <B label="Double speed (keep pitch)" onClick={() => run("double-time", (d, sr) => timeStretch(d, sr, 0.5), "stretched", true, (b) => b * 2)} />
              </ShowAt>
            </div>
          </div>

          <div className="cs-card">
            <h3><Icon name="pads" size={14} /> Chop to pads <span className="faint small">MPC-style: one pad per chop + a pattern that plays the original</span></h3>
            <div className="row wrap">
              <B label="Auto 8 pads" primary onClick={() => void doChop(8)} title="8 chops snapped to the hits" />
              <B label="Auto 16 pads" onClick={() => void doChop(16)} />
              <B label={`Use my ${markers.length} markers`} onClick={() => void doChop("markers")} disabled={markers.length < 1} />
              <span className="faint small">|</span>
              <B label="Flip" onClick={() => flip("flip")} disabled={!pads} title="New arrangement: chop 1 on every downbeat, the rest reshuffled" />
              <B label="Reverse order" onClick={() => flip("reverse")} disabled={!pads} />
              <B label="Stutter" onClick={() => flip("stutter")} disabled={!pads} />
              <B label="Half-time" onClick={() => flip("halftime")} disabled={!pads} />
              {pads > 0 && <B label={`Play the ${pads} pads`} icon="chevron" onClick={() => setTab("channel-rack")} />}
            </div>
          </div>
        </>
      )}
      {busy && <p className="small dim">Working: {busy}…</p>}
    </div>
  );
}
