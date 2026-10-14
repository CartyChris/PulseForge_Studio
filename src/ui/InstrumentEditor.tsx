/** Instrument Editor: full parameter surface + preset switch + on-screen keyboard. */
import { useEffect, useState } from "react";
import { useStudio } from "../state/store";
import { getEngine, INSTRUMENT_PRESETS } from "../engine/instruments";
import { engine } from "../engine/engine";
import { midiToName } from "../../shared/time";
import { idb } from "../storage/db";

interface UserPreset { name: string; engineId: string; params: Record<string, number> }
const USER_PRESETS_KEY = "userPresets";

export function InstrumentEditor() {
  const { project, selection, select, update, toast } = useStudio();
  const [octave, setOctave] = useState(4);
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  useEffect(() => { idb.get<UserPreset[]>("kv", USER_PRESETS_KEY).then((v) => setUserPresets(v ?? [])); }, []);
  const channel = project.channels.find((c) => c.id === selection.channelId) ?? project.channels[0];

  if (!channel) {
    return <div className="rack"><p className="dim">Add a channel first (Channel Rack → + Add Channel).</p></div>;
  }

  const inst = channel.instrument;

  const setParam = (key: string, v: number) => {
    update((p) => ({
      ...p,
      channels: p.channels.map((c) =>
        c.id === channel.id && c.instrument.type === "synth"
          ? { ...c, instrument: { ...c.instrument, params: { ...c.instrument.params, [key]: v } } }
          : c,
      ),
    }));
    engine.setInstrumentParam(channel.id, key, v);
  };

  return (
    <div className="rack">
      <div className="rack-toolbar">
        <select className="sel" value={channel.id} onChange={(e) => select({ channelId: e.target.value })} aria-label="Channel">
          {project.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {inst.type === "synth" && (
          <select className="sel" value={inst.presetId} aria-label="Preset"
            onChange={(e) => {
              const preset = INSTRUMENT_PRESETS.find((p) => p.id === e.target.value);
              if (!preset) return;
              update((p) => ({
                ...p,
                channels: p.channels.map((c) =>
                  c.id === channel.id ? { ...c, instrument: { type: "synth", synthId: preset.engineId, presetId: preset.id, params: preset.params } } : c,
                ),
              }));
            }}>
            {INSTRUMENT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.category} / {p.name}</option>)}
          </select>
        )}
        {inst.type === "synth" && (
          <>
            <button className="btn small" title="Save current parameters as a user preset" onClick={async () => {
              const name = prompt("Preset name?", `${channel.name} patch`);
              if (!name) return;
              const next = [...userPresets.filter((u) => u.name !== name), { name, engineId: inst.synthId, params: { ...inst.params } }];
              await idb.put("kv", next, USER_PRESETS_KEY);
              setUserPresets(next);
              toast(`Preset "${name}" saved`, "success");
            }}>Save Preset</button>
            {userPresets.some((u) => u.engineId === inst.synthId) && (
              <select className="sel" value="" aria-label="User presets" onChange={(e) => {
                const u = userPresets.find((x) => x.name === e.target.value);
                if (!u) return;
                update((p) => ({
                  ...p,
                  channels: p.channels.map((c) =>
                    c.id === channel.id && c.instrument.type === "synth"
                      ? { ...c, instrument: { ...c.instrument, params: { ...u.params } } } : c),
                }));
                toast(`Loaded "${u.name}"`);
              }}>
                <option value="" disabled>My presets…</option>
                {userPresets.filter((u) => u.engineId === inst.synthId).map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {inst.type === "synth" && (() => {
        const eng = getEngine(inst.synthId);
        return (
          <div className="card" style={{ maxWidth: 640 }}>
            <h3>{eng.name}</h3>
            {eng.params.map((p) => {
              const value = inst.params[p.key] ?? p.default;
              return (
                <div className="knob-row" key={p.key}>
                  <label>{p.name}</label>
                  <input type="range" min={p.min} max={p.max} step={p.step ?? (p.max - p.min) / 200} value={value}
                    onChange={(e) => setParam(p.key, Number(e.target.value))} />
                  <span className="val">{Number(value).toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        );
      })()}
      {inst.type === "sampler" && <p className="dim">Sampler parameters are in the Inspector (right panel). Play it below.</p>}
      {(inst.type === "drum-sound" || inst.type === "drum-kit") && <p className="dim">Drum channel — audition below, program it in the Channel Rack.</p>}

      <div className="card" style={{ maxWidth: 640, marginTop: 12 }}>
        <h3>Keyboard <span className="dim small">(octave {octave} — Z/X to shift, A–K plays while this tab is open)</span></h3>
        <div className="row">
          <button className="btn small" onClick={() => setOctave((o) => Math.max(0, o - 1))}>− oct</button>
          <button className="btn small" onClick={() => setOctave((o) => Math.min(7, o + 1))}>+ oct</button>
        </div>
        <div className="row" style={{ gap: 2, marginTop: 8, alignItems: "flex-start" }}>
          {Array.from({ length: 13 }, (_, i) => {
            const pitch = (octave + 1) * 12 + i;
            const black = [1, 3, 6, 8, 10].includes(i % 12);
            return (
              <button key={i}
                style={{
                  width: black ? 26 : 34, height: black ? 60 : 96,
                  background: black ? "#0a0d14" : "#dde4f2", color: black ? "#dde4f2" : "#0a0d14",
                  border: "1px solid var(--line)", borderRadius: "0 0 4px 4px", cursor: "pointer", fontSize: 9,
                  marginLeft: black ? -14 : 0, marginRight: black ? -14 : 0, zIndex: black ? 2 : 1, position: "relative",
                }}
                title={midiToName(pitch)}
                onMouseDown={() => engine.auditionNote(channel.id, pitch, 0.5, 0.85)}>
                {!black && midiToName(pitch)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
