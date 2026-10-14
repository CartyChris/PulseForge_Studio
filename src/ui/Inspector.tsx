/** Right inspector: context-sensitive properties for the current selection. */
import { useStudio } from "../state/store";
import { getEngine, INSTRUMENT_PRESETS } from "../engine/instruments";
import { DEFAULT_SAMPLER_PARAMS } from "../engine/sampler";
import { clamp } from "../../shared/time";

export function Inspector() {
  const { project, selection, update, dispatch, setTab } = useStudio();
  const channel = project.channels.find((c) => c.id === selection.channelId);
  const clip = project.clips.find((c) => c.id === selection.clipIds[0]);
  const asset = project.assets.find((a) => a.id === selection.assetId);

  return (
    <>
      <div className="panel-header"><span>Inspector</span></div>
      <div className="panel-body" style={{ padding: 10 }}>
        <details>
          <summary className="dim small" style={{ cursor: "pointer" }}>Project Notes {project.notes ? "●" : ""}</summary>
          <textarea
            className="search-box" style={{ width: "100%", margin: "6px 0", minHeight: 70, resize: "vertical" }}
            placeholder="Session notes, ideas, mix TODOs — saved with the project and included in portable exports"
            value={project.notes}
            onChange={(e) => update((p) => ({ ...p, notes: e.target.value }), { undoable: false })}
          />
        </details>
        {channel && (
          <>
            <h3 className="section">Channel — {channel.name}</h3>
            {channel.instrument.type === "synth" && <SynthParams channelId={channel.id} />}
            {channel.instrument.type === "sampler" && <SamplerParams channelId={channel.id} />}
            {(channel.instrument.type === "drum-sound" || channel.instrument.type === "drum-kit") && (
              <p className="dim small">Drum channel · kit: {channel.instrument.kitId}</p>
            )}
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => setTab("instrument")}>Open Instrument Editor</button>
          </>
        )}

        {clip && (
          <>
            <h3 className="section">Clip — {clip.name ?? clip.kind}</h3>
            <div className="knob-row"><label>Gain (dB)</label>
              <input type="range" min={-48} max={24} step={0.5} value={clip.gainDb}
                onChange={(e) => dispatch({ type: "setClipGain", clipId: clip.id, gainDb: Number(e.target.value) })} />
              <span className="val">{clip.gainDb}</span></div>
            <div className="knob-row"><label>Fade in (ticks)</label>
              <input type="range" min={0} max={clip.lengthTicks} step={12} value={clip.fadeInTicks}
                onChange={(e) => dispatch({ type: "setClipFades", clipId: clip.id, fadeInTicks: Number(e.target.value) })} />
              <span className="val">{clip.fadeInTicks}</span></div>
            <div className="knob-row"><label>Fade out (ticks)</label>
              <input type="range" min={0} max={clip.lengthTicks} step={12} value={clip.fadeOutTicks}
                onChange={(e) => dispatch({ type: "setClipFades", clipId: clip.id, fadeOutTicks: Number(e.target.value) })} />
              <span className="val">{clip.fadeOutTicks}</span></div>
            {clip.kind === "audio" && (
              <>
                <div className="knob-row"><label>Pitch (st)</label>
                  <input type="range" min={-24} max={24} step={1} value={clip.pitchSemitones}
                    onChange={(e) => update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, pitchSemitones: Number(e.target.value) } : c)) }))} />
                  <span className="val">{clip.pitchSemitones}</span></div>
                <div className="knob-row"><label>Stretch</label>
                  <input type="range" min={0.25} max={4} step={0.05} value={clip.stretch}
                    onChange={(e) => update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, stretch: Number(e.target.value) } : c)) }))} />
                  <span className="val">×{clip.stretch.toFixed(2)}</span></div>
                <p className="faint small">Pitch & stretch are repitch-style (rate-based).</p>
              </>
            )}
            {clip.kind === "automation" && clip.automationTarget && (
              <AutomationEditor clipId={clip.id} />
            )}
          </>
        )}

        {asset && !clip && (
          <>
            <h3 className="section">Asset — {asset.name}</h3>
            <p className="dim small">
              {asset.durationSec.toFixed(2)}s · {asset.sampleRate}Hz · source: {asset.source}<br />
              {asset.bpmEstimate && <>~{asset.bpmEstimate} BPM (local estimate)<br /></>}
              {asset.keyEstimate && <>~{asset.keyEstimate} (local estimate)<br /></>}
              {asset.tags.length > 0 && <>tags: {asset.tags.join(", ")}<br /></>}
            </p>
            {asset.licenseNote && <p className="warn small">{asset.licenseNote}</p>}
            {asset.aiMeta && (
              <p className="dim small">AI: {asset.aiMeta.providerId} {asset.aiMeta.model}<br />prompt: “{asset.aiMeta.prompt.slice(0, 120)}”</p>
            )}
          </>
        )}

        {!channel && !clip && !asset && <p className="faint small">Select a channel, clip, or asset to edit its properties.</p>}
      </div>
    </>
  );
}

function SynthParams({ channelId }: { channelId: string }) {
  const { project, update } = useStudio();
  const channel = project.channels.find((c) => c.id === channelId);
  if (!channel || channel.instrument.type !== "synth") return null;
  const inst = channel.instrument;
  const eng = getEngine(inst.synthId);
  const preset = INSTRUMENT_PRESETS.find((p) => p.id === inst.presetId);
  return (
    <>
      <p className="dim small">{eng.name}{preset ? ` · ${preset.name}` : ""}</p>
      {eng.params.map((p) => {
        const value = inst.params[p.key] ?? p.default;
        return (
          <div className="knob-row" key={p.key}>
            <label>{p.name}</label>
            <input type="range" min={p.min} max={p.max} step={p.step ?? (p.max - p.min) / 200} value={value}
              onChange={(e) => {
                const v = Number(e.target.value);
                update((proj) => ({
                  ...proj,
                  channels: proj.channels.map((c) =>
                    c.id === channelId && c.instrument.type === "synth"
                      ? { ...c, instrument: { ...c.instrument, params: { ...c.instrument.params, [p.key]: v } } }
                      : c,
                  ),
                }));
              }} />
            <span className="val">{Number(value).toFixed(2)}</span>
          </div>
        );
      })}
      <p className="faint small">Changes rebuild the instrument voice (brief rebuild on release).</p>
    </>
  );
}

function SamplerParams({ channelId }: { channelId: string }) {
  const { project, update } = useStudio();
  const channel = project.channels.find((c) => c.id === channelId);
  if (!channel || channel.instrument.type !== "sampler") return null;
  const inst = channel.instrument;
  const params = { ...DEFAULT_SAMPLER_PARAMS, ...inst.params };
  const asset = project.assets.find((a) => a.id === inst.assetId);
  const numRows: Array<[keyof typeof params, string, number, number, number]> = [
    ["rootNote", "Root note (MIDI)", 12, 108, 1],
    ["startNorm", "Start", 0, 1, 0.001],
    ["endNorm", "End", 0, 1, 0.001],
    ["attack", "Attack", 0, 2, 0.005],
    ["decay", "Decay", 0, 4, 0.01],
    ["sustain", "Sustain", 0, 1, 0.01],
    ["release", "Release", 0, 4, 0.01],
    ["filterHz", "Filter (Hz)", 40, 20000, 10],
    ["gainDb", "Gain (dB)", -48, 24, 0.5],
    ["pan", "Pan", -1, 1, 0.05],
    ["polyphony", "Polyphony", 1, 32, 1],
    ["portamento", "Portamento", 0, 2, 0.01],
    ["velocityAmount", "Velocity amt", 0, 1, 0.01],
  ];
  const set = (key: string, v: number | boolean) =>
    update((proj) => ({
      ...proj,
      channels: proj.channels.map((c) =>
        c.id === channelId && c.instrument.type === "sampler"
          ? { ...c, instrument: { ...c.instrument, params: { ...c.instrument.params, [key]: v } as any } }
          : c,
      ),
    }));
  return (
    <>
      <p className="dim small">Sampler · {asset?.name ?? "no sample loaded"}</p>
      {numRows.map(([key, label, min, max, step]) => (
        <div className="knob-row" key={key}>
          <label>{label}</label>
          <input type="range" min={min} max={max} step={step} value={Number(params[key])}
            onChange={(e) => set(key, clamp(Number(e.target.value), min, max))} />
          <span className="val">{Number(params[key]).toFixed(step >= 1 ? 0 : 2)}</span>
        </div>
      ))}
      {(["loop", "mono", "reverse", "pitchTrack"] as const).map((key) => (
        <label className="row small dim" key={key}>
          <input type="checkbox" checked={Boolean(params[key])} onChange={(e) => set(key, e.target.checked)} /> {key}
        </label>
      ))}
    </>
  );
}

function AutomationEditor({ clipId }: { clipId: string }) {
  const { project, update } = useStudio();
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip?.automationTarget) return null;
  return (
    <>
      <p className="dim small">Automation → {clip.automationTarget.kind}{clip.automationTarget.param ? ` (${clip.automationTarget.param})` : ""}</p>
      <div className="knob-row"><label>Target</label>
        <select className="sel" style={{ flex: 1 }} value={clip.automationTarget.mixerChannelId ?? "master"}
          onChange={(e) => update((p) => ({
            ...p,
            clips: p.clips.map((c) => (c.id === clipId ? { ...c, automationTarget: { ...c.automationTarget!, mixerChannelId: e.target.value } } : c)),
          }))}>
          {project.mixer.channels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {clip.automationPoints.map((pt, i) => (
        <div className="knob-row" key={i}>
          <label>@{pt.tick}t</label>
          <input type="range" min={0} max={1} step={0.01} value={pt.value}
            onChange={(e) => update((p) => ({
              ...p,
              clips: p.clips.map((c) => (c.id === clipId ? { ...c, automationPoints: c.automationPoints.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) } : c)),
            }), { undoable: false })} />
          <span className="val">{pt.value.toFixed(2)}</span>
        </div>
      ))}
      <button className="btn small" onClick={() => update((p) => ({
        ...p,
        clips: p.clips.map((c) => (c.id === clipId ? { ...c, automationPoints: [...c.automationPoints, { tick: Math.round(clip.lengthTicks / 2), value: 0.5, curve: 0 }].sort((a, b) => a.tick - b.tick) } : c)),
      }))}>+ point</button>
    </>
  );
}
