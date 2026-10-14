/** Channel Rack: FL-style step sequencer — steps, velocity, probability, micro-timing,
 * swing, euclidean/random/humanize generators, pattern management. */
import { useState } from "react";
import { useStudio, usePlayhead } from "../state/store";
import type { Step, Pattern } from "../../shared/project";
import { newId } from "../../shared/project";
import { euclideanPattern, TICKS_PER_STEP, clamp } from "../../shared/time";
import { fillEnding, ghostNotes, shiftSteps, polyrhythm, accentEvery, thin, reverseSteps } from "../../shared/patterntools";
import { DRUM_KITS } from "../engine/kits";
import { INSTRUMENT_PRESETS } from "../engine/instruments";
import { engine } from "../engine/engine";

const COLORS = ["#e8663c", "#ffd166", "#4cc2ff", "#8ef58a", "#7b6cff", "#ff7bd5", "#5ad9c9", "#f5a623"];

// groove clipboard: velocity/micro/swing feel copied from one channel, applied to others
let grooveClipboard: { velocity: number; micro: number; index: number }[] | null = null;

export function ChannelRack() {
  const { project, selection, select, update, dispatch, toast, setTab } = useStudio();
  const pattern0 = project.patterns.find((p) => p.id === selection.patternId) ?? project.patterns[0];
  // quantized to the current step so the rack re-renders ~8x/sec while playing, not 60
  const playheadStepLive = usePlayhead((s) =>
    s.playing && pattern0 ? Math.floor((s.ticks % (pattern0.lengthSteps * TICKS_PER_STEP)) / TICKS_PER_STEP) : -1,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [stepEdit, setStepEdit] = useState<{ channelId: string; index: number; x: number; y: number } | null>(null);

  const pattern = project.patterns.find((p) => p.id === selection.patternId) ?? project.patterns[0];
  if (!pattern) {
    return (
      <div className="rack">
        <p className="dim">No pattern yet.</p>
        <button className="btn primary" onClick={() => {
          dispatch({ type: "createPattern", name: "Pattern 1", lengthSteps: 16 });
        }}>Create Pattern</button>
      </div>
    );
  }

  const patchPattern = (fn: (p: Pattern) => Pattern) =>
    update((proj) => ({ ...proj, patterns: proj.patterns.map((x) => (x.id === pattern.id ? fn(x) : x)) }));

  // compute from the updater's fresh state, not the render closure — rapid
  // clicks/taps in one tick must not overwrite each other
  const toggleStep = (channelId: string, index: number) => {
    const wasOn = (pattern.steps[channelId] ?? []).some((s) => s.index === index);
    patchPattern((p) => {
      const steps = p.steps[channelId] ?? [];
      const existing = steps.some((s) => s.index === index);
      const next = existing ? steps.filter((s) => s.index !== index) : [...steps, { index, velocity: 0.85, probability: 1, micro: 0 }];
      return { ...p, steps: { ...p.steps, [channelId]: next } };
    });
    if (!wasOn) engine.auditionNote(channelId, 48, 0.3, 0.85);
  };

  const setStep = (channelId: string, index: number, patch: Partial<Step>) =>
    patchPattern((p) => ({
      ...p,
      steps: { ...p.steps, [channelId]: (p.steps[channelId] ?? []).map((s) => (s.index === index ? { ...s, ...patch } : s)) },
    }));

  const addChannel = (kind: "drum" | "preset", ref: string) => {
    if (kind === "drum") {
      const [kitId, role] = ref.split("::");
      const kit = DRUM_KITS.find((k) => k.id === kitId)!;
      if (role === "ALL") {
        // add the classic starter lineup for the kit
        for (const r of ["kick", "snare", "clap", "hat-closed", "hat-open", "perc"]) {
          const sound = kit.sounds.find((s) => s.role === r)!;
          dispatch({ type: "createChannel", name: `${sound.name}`, color: COLORS[project.channels.length % COLORS.length], instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id } });
        }
        toast(`Added ${kit.name} starter channels`, "success");
      } else {
        const sound = kit.sounds.find((s) => s.id === role) ?? kit.sounds[0]!;
        dispatch({ type: "createChannel", name: sound.name, color: COLORS[project.channels.length % COLORS.length], instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id } });
      }
    } else {
      const preset = INSTRUMENT_PRESETS.find((p) => p.id === ref)!;
      dispatch({ type: "createChannel", name: preset.name, color: COLORS[project.channels.length % COLORS.length], instrument: { type: "synth", synthId: preset.engineId, presetId: preset.id, params: preset.params } });
    }
    setAddOpen(false);
  };

  const playheadStep = playheadStepLive;

  const generators = {
    euclidean: (channelId: string) => {
      const pulses = Number(prompt("Euclidean pulses (onsets)?", "5")) || 5;
      const rot = Number(prompt("Rotation?", "0")) || 0;
      const pat = euclideanPattern(pattern.lengthSteps, pulses, rot);
      const steps: Step[] = pat.flatMap((on, i) => (on ? [{ index: i, velocity: 0.85, probability: 1, micro: 0 }] : []));
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps });
    },
    randomize: (channelId: string) => {
      const steps: Step[] = [];
      for (let i = 0; i < pattern.lengthSteps; i++) {
        if (Math.random() < 0.3) steps.push({ index: i, velocity: 0.5 + Math.random() * 0.5, probability: 1, micro: 0 });
      }
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps });
    },
    humanize: (channelId: string) => {
      const steps = (pattern.steps[channelId] ?? []).map((s) => ({
        ...s,
        velocity: clamp(s.velocity + (Math.random() - 0.5) * 0.25, 0.2, 1),
        micro: Math.round(clamp(s.micro + (Math.random() - 0.5) * 6, -12, 12)),
      }));
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps });
    },
    fill: (channelId: string) => {
      const existing = (pattern.steps[channelId] ?? []).filter((s) => s.index < pattern.lengthSteps - 4);
      const added = fillEnding(pattern.lengthSteps, 4, 0.8, Math.floor(Math.random() * 100000));
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: [...existing, ...added].sort((a, b) => a.index - b.index) });
      toast("End-of-bar fill added");
    },
    ghosts: (channelId: string) => {
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: ghostNotes(pattern.steps[channelId] ?? [], pattern.lengthSteps, 0.3, Math.floor(Math.random() * 100000)) });
      toast("Ghost notes added between hits");
    },
    shift: (channelId: string, by: number) => {
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: shiftSteps(pattern.steps[channelId] ?? [], by, pattern.lengthSteps) });
    },
    poly: (channelId: string) => {
      const n = Number(prompt("Hit every N steps (3 = 3-against-4 polyrhythm)?", "3"));
      if (!n || n < 1) return;
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: polyrhythm(pattern.lengthSteps, n) });
    },
    accent: (channelId: string) => {
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: accentEvery(pattern.steps[channelId] ?? [], 4, 0.2) });
    },
    thin: (channelId: string) => {
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: thin(pattern.steps[channelId] ?? [], 0.4, Math.floor(Math.random() * 100000)) });
    },
    reverse: (channelId: string) => {
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: reverseSteps(pattern.steps[channelId] ?? [], pattern.lengthSteps) });
    },
    variation: (channelId: string) => {
      // variation: keep downbeats, reshuffle offbeats
      const src = pattern.steps[channelId] ?? [];
      const steps: Step[] = src.filter((s) => s.index % 4 === 0);
      for (const s of src.filter((x) => x.index % 4 !== 0)) {
        if (Math.random() < 0.6) steps.push(s);
        else steps.push({ ...s, index: Math.floor(Math.random() * pattern.lengthSteps) });
      }
      const seen = new Set<number>();
      dispatch({ type: "setSteps", patternId: pattern.id, channelId, steps: steps.filter((s) => !seen.has(s.index) && seen.add(s.index)) });
    },
  };

  return (
    <div className="rack" onClick={() => setStepEdit(null)}>
      <div className="rack-toolbar">
        <select className="sel" value={pattern.id} aria-label="Pattern"
          onChange={(e) => select({ patternId: e.target.value })}>
          {project.patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn small" title="New pattern" onClick={() => {
          dispatch({ type: "createPattern", name: `Pattern ${project.patterns.length + 1}`, lengthSteps: 16 });
          const latest = useStudio.getState().project.patterns.at(-1);
          if (latest) select({ patternId: latest.id });
        }}>+ New</button>
        <button className="btn small" title="Clone pattern with contents" onClick={() => {
          const clone = { ...pattern, id: newId("pat"), name: `${pattern.name} clone`, steps: { ...pattern.steps }, notes: { ...pattern.notes } };
          update((p) => ({ ...p, patterns: [...p.patterns, clone] }));
          select({ patternId: clone.id });
        }}>Clone</button>
        <button className="btn small" onClick={() => {
          const name = prompt("Pattern name", pattern.name);
          if (name) patchPattern((p) => ({ ...p, name }));
        }}>Rename</button>
        <label className="row small dim">Length
          <input className="num-input" type="number" min={1} max={256} value={pattern.lengthSteps}
            onChange={(e) => {
              const lengthSteps = clamp(Number(e.target.value) || 16, 1, 256);
              patchPattern((p) => ({ ...p, lengthSteps }));
            }} /> steps
        </label>
        <label className="row small dim" title="Swing delays every off-16th">Swing
          <input type="range" min={0} max={1} step={0.01} value={pattern.swing}
            onChange={(e) => patchPattern((p) => ({ ...p, swing: Number(e.target.value) }))} />
          <span className="mono small">{Math.round(pattern.swing * 100)}%</span>
        </label>
        <button className="btn small" title="Copy the selected channel's groove (velocities + micro-timing)"
          disabled={!selection.channelId}
          onClick={() => {
            grooveClipboard = (pattern.steps[selection.channelId!] ?? []).map(({ index, velocity, micro }) => ({ index, velocity, micro }));
            toast(`Groove copied (${grooveClipboard.length} steps)`);
          }}>Copy Groove</button>
        <button className="btn small" title="Apply the copied groove feel to the selected channel's existing steps"
          disabled={!selection.channelId}
          onClick={() => {
            if (!grooveClipboard?.length) return toast("Copy a groove first", "error");
            const gv = new Map(grooveClipboard.map((g) => [g.index, g]));
            const steps = (pattern.steps[selection.channelId!] ?? []).map((s) => {
              const g = gv.get(s.index);
              return g ? { ...s, velocity: g.velocity, micro: g.micro } : s;
            });
            dispatch({ type: "setSteps", patternId: pattern.id, channelId: selection.channelId!, steps });
            toast("Groove applied", "success");
          }}>Paste Groove</button>
        <button className="btn small" title="Ask the AI Assistant to continue/extend this pattern"
          onClick={() => {
            const desc = project.channels
              .map((ch) => {
                const on = (pattern.steps[ch.id] ?? []).map((s) => s.index + 1).join(",");
                return on ? `${ch.name}: steps ${on}` : null;
              })
              .filter(Boolean)
              .join("; ");
            setTab("ai-assistant");
            // assistant listens for this event and prefills its prompt box
            setTimeout(() => window.dispatchEvent(new CustomEvent("pf-ai-prefill", {
              detail: `Continue this ${pattern.lengthSteps}-step drum pattern with a complementary variation as a new pattern. Current pattern "${pattern.name}" (${project.bpm} BPM): ${desc || "empty"}`,
            })), 50);
          }}>AI ▸ Continue</button>
        <div className="spacer" />
        <button className="btn small primary" onClick={() => setAddOpen(true)}>+ Add Channel</button>
      </div>

      {!project.channels.length && (
        <p className="dim">No channels yet — add a drum kit or instrument to start building a beat.</p>
      )}

      {project.channels.map((ch) => {
        const steps = pattern.steps[ch.id] ?? [];
        const noteCount = (pattern.notes[ch.id] ?? []).length;
        return (
          <div className="rack-row" key={ch.id}>
            <div className={`rack-chan ${selection.channelId === ch.id ? "selected" : ""}`}>
              <div className="chan-color" style={{ background: ch.color }} title="Change color"
                onClick={() => {
                  const idx = (COLORS.indexOf(ch.color) + 1) % COLORS.length;
                  update((p) => ({ ...p, channels: p.channels.map((c) => (c.id === ch.id ? { ...c, color: COLORS[idx]! } : c)) }));
                }} />
              <span className="chan-name" title={`${ch.name} — click to select, double-click to rename`}
                onClick={() => select({ channelId: ch.id })}
                onDoubleClick={() => {
                  const name = prompt("Channel name", ch.name);
                  if (name) update((p) => ({ ...p, channels: p.channels.map((c) => (c.id === ch.id ? { ...c, name } : c)) }));
                }}>
                {ch.name}{noteCount > 0 && <span className="dim"> ♪{noteCount}</span>}
              </span>
              <button className={`ms-btn m ${ch.muted ? "active" : ""}`} title="Mute"
                onClick={() => update((p) => ({ ...p, channels: p.channels.map((c) => (c.id === ch.id ? { ...c, muted: !c.muted } : c)) }))}>M</button>
              <button className={`ms-btn s ${ch.soloed ? "active" : ""}`} title="Solo"
                onClick={() => update((p) => ({ ...p, channels: p.channels.map((c) => (c.id === ch.id ? { ...c, soloed: !c.soloed } : c)) }))}>S</button>
              <input type="range" style={{ width: 44 }} min={-30} max={6} step={0.5} value={ch.volumeDb} title={`Volume ${ch.volumeDb} dB`}
                onChange={(e) => update((p) => ({ ...p, channels: p.channels.map((c) => (c.id === ch.id ? { ...c, volumeDb: Number(e.target.value) } : c)) }), { undoable: false })} />
              <input type="range" style={{ width: 34 }} min={-1} max={1} step={0.05} value={ch.pan} title={`Pan ${ch.pan}`}
                onChange={(e) => update((p) => ({ ...p, channels: p.channels.map((c) => (c.id === ch.id ? { ...c, pan: Number(e.target.value) } : c)) }), { undoable: false })} />
            </div>

            <div className="steps">
              {Array.from({ length: pattern.lengthSteps }, (_, i) => {
                const st = steps.find((s) => s.index === i);
                return (
                  <div
                    key={i}
                    className={`step ${st ? "on" : ""} ${i % 4 === 0 ? "beat-start" : ""} ${i === playheadStep ? "playing" : ""}`}
                    title={st ? `Step ${i + 1}: vel ${Math.round(st.velocity * 100)}%, prob ${Math.round(st.probability * 100)}%, micro ${st.micro} ticks — right-click to edit` : `Step ${i + 1}`}
                    onClick={(e) => { e.stopPropagation(); toggleStep(ch.id, i); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!st) toggleStep(ch.id, i);
                      setStepEdit({ channelId: ch.id, index: i, x: e.clientX, y: e.clientY });
                    }}
                  >
                    {st && <div className="vel" style={{ height: `${(1 - st.velocity) * 100}%` }} />}
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ gap: 3 }}>
              <button className="mini-btn" title="Open in Piano Roll" onClick={() => { select({ channelId: ch.id, patternId: pattern.id }); setTab("piano-roll"); }}>♪</button>
              <button className="mini-btn" title="Euclidean rhythm" onClick={() => generators.euclidean(ch.id)}>E</button>
              <button className="mini-btn" title="Randomize" onClick={() => generators.randomize(ch.id)}>R</button>
              <button className="mini-btn" title="Humanize velocities & timing" onClick={() => generators.humanize(ch.id)}>H</button>
              <button className="mini-btn" title="Generate variation" onClick={() => generators.variation(ch.id)}>V</button>
              <button className="mini-btn" title="End-of-bar fill" onClick={() => generators.fill(ch.id)}>F</button>
              <button className="mini-btn" title="Add ghost notes between hits" onClick={() => generators.ghosts(ch.id)}>G</button>
              <button className="mini-btn" title="Polyrhythm — hit every N steps" onClick={() => generators.poly(ch.id)}>P</button>
              <button className="mini-btn" title="Accent every 4th step" onClick={() => generators.accent(ch.id)}>A</button>
              <button className="mini-btn" title="Thin out (remove some off-beats)" onClick={() => generators.thin(ch.id)}>T</button>
              <button className="mini-btn" title="Reverse pattern in time" onClick={() => generators.reverse(ch.id)}>↔</button>
              <button className="mini-btn" title="Shift pattern one step later" onClick={() => generators.shift(ch.id, 1)}>→</button>
              <button className="mini-btn" title="Shift pattern one step earlier" onClick={() => generators.shift(ch.id, -1)}>←</button>
              <button className="mini-btn" title="Delete channel" onClick={() => {
                if (!confirm(`Remove channel "${ch.name}"?`)) return;
                update((p) => ({
                  ...p,
                  channels: p.channels.filter((c) => c.id !== ch.id),
                  patterns: p.patterns.map((pat) => {
                    const { [ch.id]: _s, ...steps2 } = pat.steps;
                    const { [ch.id]: _n, ...notes2 } = pat.notes;
                    return { ...pat, steps: steps2, notes: notes2 };
                  }),
                }));
              }}>✕</button>
            </div>
          </div>
        );
      })}

      {stepEdit && (() => {
        const st = (pattern.steps[stepEdit.channelId] ?? []).find((s) => s.index === stepEdit.index);
        if (!st) return null;
        return (
          <div className="modal" style={{ position: "fixed", left: Math.min(stepEdit.x, window.innerWidth - 300), top: Math.min(stepEdit.y, window.innerHeight - 200), minWidth: 260, zIndex: 90 }}
            onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 13 }}>Step {stepEdit.index + 1}</h2>
            <div className="knob-row"><label>Velocity</label>
              <input type="range" min={0.05} max={1} step={0.01} value={st.velocity}
                onChange={(e) => setStep(stepEdit.channelId, stepEdit.index, { velocity: Number(e.target.value) })} />
              <span className="val">{Math.round(st.velocity * 100)}%</span></div>
            <div className="knob-row"><label>Probability</label>
              <input type="range" min={0.05} max={1} step={0.01} value={st.probability}
                onChange={(e) => setStep(stepEdit.channelId, stepEdit.index, { probability: Number(e.target.value) })} />
              <span className="val">{Math.round(st.probability * 100)}%</span></div>
            <div className="knob-row"><label>Micro-timing</label>
              <input type="range" min={-12} max={12} step={1} value={st.micro}
                onChange={(e) => setStep(stepEdit.channelId, stepEdit.index, { micro: Number(e.target.value) })} />
              <span className="val">{st.micro}t</span></div>
            <div className="row end"><button className="btn small" onClick={() => setStepEdit(null)}>Done</button></div>
          </div>
        );
      })()}

      {addOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="modal" style={{ minWidth: 560 }}>
            <h2>Add Channel</h2>
            <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <h3 className="section">Drum Kits</h3>
                {DRUM_KITS.map((kit) => (
                  <div key={kit.id} style={{ marginBottom: 8 }}>
                    <div className="row">
                      <strong className="small">{kit.name}</strong>
                      <button className="mini-btn" onClick={() => addChannel("drum", `${kit.id}::ALL`)}>+ starter set</button>
                    </div>
                    <div className="row" style={{ flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                      {kit.sounds.map((s) => (
                        <button key={s.id} className="mini-btn" title={`Add ${s.name}`}
                          onMouseEnter={() => {}}
                          onClick={() => addChannel("drum", `${kit.id}::${s.id}`)}>{s.name}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <h3 className="section">Instruments</h3>
                {[...new Set(INSTRUMENT_PRESETS.map((p) => p.category))].map((cat) => (
                  <div key={cat} style={{ marginBottom: 8 }}>
                    <strong className="small">{cat}</strong>
                    <div className="row" style={{ flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                      {INSTRUMENT_PRESETS.filter((p) => p.category === cat).map((p) => (
                        <button key={p.id} className="mini-btn" onClick={() => addChannel("preset", p.id)}>{p.name}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="row end"><button className="btn" onClick={() => setAddOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
