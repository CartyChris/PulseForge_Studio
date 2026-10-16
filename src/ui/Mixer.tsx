/** Mixer: channel strips with faders, pan, mute/solo, meters, effect chains,
 * sends, sidechain, buses, routing display, chain presets. */
import { useEffect, useState } from "react";
import { useStudio } from "../state/store";
import type { MixerChannel, EffectInstance } from "../../shared/project";
import { MASTER_ID, newId } from "../../shared/project";
import { EFFECT_DEFS, EFFECT_CHAIN_PRESETS } from "../engine/effects";
import type { EffectType } from "../../shared/project";
import { engine } from "../engine/engine";
import { atLeast, useLevel } from "./shell/Level";
import { useRef } from "react";

/** Live FFT spectrum of the master bus, drawn outside React's render loop. */
function Spectrum() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const an = engine.getAnalyser();
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (!an) return;
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const bars = 32;
      const bw = canvas.width / bars;
      for (let i = 0; i < bars; i++) {
        // log-ish bin mapping so lows don't dominate the display
        const bin = Math.min(data.length - 1, Math.floor(Math.pow(i / bars, 1.7) * data.length));
        const h = (data[bin]! / 255) * canvas.height;
        g.fillStyle = `hsl(${20 + (i / bars) * 30}, 80%, ${45 + (h / canvas.height) * 20}%)`;
        g.fillRect(i * bw + 1, canvas.height - h, bw - 2, h);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={80} height={36} title="Master spectrum" style={{ borderRadius: 3, background: "#090c12", border: "1px solid var(--line)" }} />;
}

export function Mixer() {
  const { project, selection, select, update, dispatch, toast } = useStudio();
  // routing, sends and sidechain appear from Intermediate up (Quick Mix covers beginners)
  const showRouting = atLeast(useLevel(), "intermediate");
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [fxEditor, setFxEditor] = useState<{ channelId: string; effectId: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      const next: Record<string, number> = {};
      for (const c of project.mixer.channels) next[c.id] = engine.getMeterDb(c.id);
      setMeters(next);
    }, 80);
    return () => clearInterval(t);
  }, [project.mixer.channels]);

  const patchChannel = (id: string, patch: Partial<MixerChannel>, undoable = true) => {
    update((p) => ({ ...p, mixer: { channels: p.mixer.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) } }), { undoable });
    if (patch.volumeDb !== undefined) engine.setMixerParam(id, "volumeDb", patch.volumeDb);
    if (patch.pan !== undefined) engine.setMixerParam(id, "pan", patch.pan);
  };

  const channels = [...project.mixer.channels.filter((c) => c.kind !== "master"), project.mixer.channels.find((c) => c.id === MASTER_ID)!].filter(Boolean);

  const feeding = (chanId: string) =>
    project.tracks.filter((t) => t.mixerChannelId === chanId).map((t) => t.name).join(", ");

  return (
    <div className="mixer">
      {channels.map((c) => {
        const db = meters[c.id] ?? -Infinity;
        const pct = db === -Infinity ? 0 : Math.max(0, Math.min(100, ((db + 60) / 66) * 100));
        const clipping = db > -0.5;
        const fed = feeding(c.id);
        return (
          <div key={c.id} className={`strip ${c.kind === "master" ? "master" : ""} ${selection.mixerChannelId === c.id ? "selected" : ""}`}
            onClick={() => select({ mixerChannelId: c.id })}>
            <span className="sname" title={`${c.name}${fed ? ` ← ${fed}` : ""} → ${c.kind === "master" ? "output" : c.outputId ?? "Master"} — double-click to rename`}
              onDoubleClick={() => {
                const name = prompt("Channel name", c.name);
                if (name) patchChannel(c.id, { name });
              }}>
              {c.kind === "bus" ? "⊕ " : ""}{c.name}
            </span>
            {c.kind === "master" && <Spectrum />}
            {fed && <span className="faint" style={{ fontSize: 8, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`Fed by: ${fed}`}>← {fed}</span>}

            <div className="fx-list">
              {c.effects.map((fx) => (
                <div key={fx.id} className={`fx-chip ${fx.enabled ? "" : "bypassed"}`}
                  title={`${EFFECT_DEFS[fx.type].name}${fx.presetName ? ` (${fx.presetName})` : ""} — click to edit, right-click to bypass`}
                  onClick={(e) => { e.stopPropagation(); setFxEditor({ channelId: c.id, effectId: fx.id }); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    update((p) => ({
                      ...p,
                      mixer: { channels: p.mixer.channels.map((ch) => (ch.id === c.id ? { ...ch, effects: ch.effects.map((f) => (f.id === fx.id ? { ...f, enabled: !f.enabled } : f)) } : ch)) },
                    }));
                  }}>
                  <span>{EFFECT_DEFS[fx.type].name.split(" ")[0]}</span>
                  <span className="row" style={{ gap: 1 }}>
                    <button className="mini-btn" style={{ padding: "0 2px" }} title="Move up" onClick={(e) => {
                      e.stopPropagation();
                      const i = c.effects.findIndex((f) => f.id === fx.id);
                      if (i > 0) {
                        const effects = [...c.effects];
                        [effects[i - 1], effects[i]] = [effects[i]!, effects[i - 1]!];
                        patchChannel(c.id, { effects });
                      }
                    }}>↑</button>
                    <button className="mini-btn" style={{ padding: "0 2px" }} title="Remove" onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "removeEffect", mixerChannelId: c.id, effectId: fx.id });
                    }}>✕</button>
                  </span>
                </div>
              ))}
              <select className="sel" style={{ fontSize: 9, padding: 2, maxWidth: "100%" }} value=""
                title="Add effect or chain preset"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v.startsWith("preset:")) {
                    const preset = EFFECT_CHAIN_PRESETS.find((p) => p.name === v.slice(7))!;
                    const effects: EffectInstance[] = preset.effects.map((fx) => ({ id: newId("fx"), type: fx.type, enabled: true, params: fx.params, presetName: preset.name }));
                    patchChannel(c.id, { effects: [...c.effects, ...effects] });
                    toast(`Added "${preset.name}" chain`, "success");
                  } else {
                    dispatch({ type: "addEffect", mixerChannelId: c.id, effectType: v as EffectType, params: {} });
                  }
                  e.target.value = "";
                }}>
                <option value="">+ effect…</option>
                <optgroup label="Effects">
                  {Object.values(EFFECT_DEFS).map((d) => <option key={d.type} value={d.type}>{d.name}</option>)}
                </optgroup>
                <optgroup label="Chain presets">
                  {EFFECT_CHAIN_PRESETS.map((p) => <option key={p.name} value={`preset:${p.name}`}>{p.name}</option>)}
                </optgroup>
              </select>
            </div>

            <div className="fader-area">
              <input className="fader" type="range" min={-60} max={12} step={0.5} value={c.volumeDb}
                aria-label={`${c.name} volume`}
                title={`${c.volumeDb.toFixed(1)} dB`}
                onChange={(e) => patchChannel(c.id, { volumeDb: Number(e.target.value) }, false)}
                onPointerUp={() => patchChannel(c.id, { volumeDb: c.volumeDb })} />
              <div className="meter-v" title={`${db === -Infinity ? "-∞" : db.toFixed(1)} dB`}>
                <div className="fill" style={{ height: `${pct}%` }} />
                {clipping && <div className="clip-dot" />}
              </div>
            </div>
            <span className="mono" style={{ fontSize: 9 }}>{c.volumeDb.toFixed(1)} dB</span>
            <input className="pan-knob" type="range" min={-1} max={1} step={0.05} value={c.pan}
              aria-label={`${c.name} pan`} title={`Pan ${c.pan === 0 ? "C" : c.pan < 0 ? `${Math.round(-c.pan * 100)}L` : `${Math.round(c.pan * 100)}R`}`}
              onChange={(e) => patchChannel(c.id, { pan: Number(e.target.value) }, false)} />

            <div className="row" style={{ gap: 3 }}>
              <button className={`ms-btn m ${c.muted ? "active" : ""}`} title="Mute"
                onClick={(e) => { e.stopPropagation(); dispatch({ type: "setTrackMuted", mixerChannelId: c.id, muted: !c.muted }); }}>M</button>
              {c.kind !== "master" && (
                <button className={`ms-btn s ${c.soloed ? "active" : ""}`} title="Solo"
                  onClick={(e) => { e.stopPropagation(); patchChannel(c.id, { soloed: !c.soloed }); }}>S</button>
              )}
            </div>

            {c.kind !== "master" && showRouting && (
              <>
                <select className="sel" style={{ fontSize: 9, maxWidth: "100%" }} value={c.outputId ?? MASTER_ID} title="Output routing"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => patchChannel(c.id, { outputId: e.target.value === MASTER_ID ? null : e.target.value })}>
                  {project.mixer.channels.filter((x) => x.id !== c.id && x.kind !== "track").map((x) => (
                    <option key={x.id} value={x.id}>→ {x.name}</option>
                  ))}
                </select>
                <select className="sel" style={{ fontSize: 9, maxWidth: "100%" }} value="" title="Add send to a bus"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    if (e.target.value) dispatch({ type: "addSend", fromMixerChannelId: c.id, toMixerChannelId: e.target.value, levelDb: -12 });
                    e.target.value = "";
                  }}>
                  <option value="">+ send…</option>
                  {project.mixer.channels.filter((x) => x.kind === "bus" && x.id !== c.id).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                {c.sends.map((s) => {
                  const target = project.mixer.channels.find((x) => x.id === s.toChannelId);
                  return (
                    <div key={s.toChannelId} className="row" style={{ width: "100%", gap: 2 }} title={`Send to ${target?.name}: ${s.levelDb} dB (right-click removes)`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        patchChannel(c.id, { sends: c.sends.filter((x) => x.toChannelId !== s.toChannelId) });
                      }}>
                      <span style={{ fontSize: 8 }} className="dim">{target?.name?.slice(0, 6)}</span>
                      <input type="range" style={{ flex: 1, height: 10 }} min={-60} max={6} step={1} value={s.levelDb}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchChannel(c.id, { sends: c.sends.map((x) => (x.toChannelId === s.toChannelId ? { ...x, levelDb: Number(e.target.value) } : x)) }, false)} />
                    </div>
                  );
                })}
                <select className="sel" style={{ fontSize: 9, maxWidth: "100%" }} value={c.sidechainFromId ?? ""} title="Sidechain duck: this channel ducks when the source plays"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => dispatch({ type: "setSidechain", mixerChannelId: c.id, fromMixerChannelId: e.target.value || null })}>
                  <option value="">no sidechain</option>
                  {project.mixer.channels.filter((x) => x.id !== c.id && x.kind !== "master").map((x) => (
                    <option key={x.id} value={x.id}>duck by {x.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        );
      })}

      <div className="strip" style={{ justifyContent: "center", borderStyle: "dashed" }}>
        <button className="btn small" onClick={() => dispatch({ type: "createBus", name: `Bus ${project.mixer.channels.filter((c) => c.kind === "bus").length + 1}` })}>+ Bus</button>
        <span className="dim" style={{ fontSize: 9, textAlign: "center" }}>sends & groups route here</span>
      </div>

      {fxEditor && <EffectEditor channelId={fxEditor.channelId} effectId={fxEditor.effectId} onClose={() => setFxEditor(null)} />}
    </div>
  );
}

function EffectEditor({ channelId, effectId, onClose }: { channelId: string; effectId: string; onClose: () => void }) {
  const { project, dispatch } = useStudio();
  const chan = project.mixer.channels.find((c) => c.id === channelId);
  const fx = chan?.effects.find((f) => f.id === effectId);
  if (!chan || !fx) return null;
  const def = EFFECT_DEFS[fx.type];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ minWidth: 380 }}>
        <h2>{def.name} <span className="dim small">on {chan.name}</span></h2>
        {def.name.includes("approx") && <p className="dim small">This effect is an approximation — labeled honestly, tuned to be useful.</p>}
        {def.params.map((p) => {
          const value = fx.params[p.key] ?? p.default;
          return (
            <div className="knob-row" key={p.key}>
              <label title={p.name}>{p.name}</label>
              <input type="range" min={p.min} max={p.max} step={p.step ?? (p.max - p.min) / 200} value={value}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  dispatch({ type: "setEffectParameter", mixerChannelId: channelId, effectId, param: p.key, value: v });
                  engine.setEffectParam(channelId, effectId, p.key, v);
                }} />
              <span className="val">{Number(value).toFixed(2)}</span>
            </div>
          );
        })}
        <div className="row end"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
