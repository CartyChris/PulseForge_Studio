/** Playlist: multitrack arrangement — pattern/audio/automation clips, drag/trim/split,
 * fades, markers, sections, ripple edit, track management, drop targets for samples. */
import { useMemo, useRef, useState } from "react";
import { useStudio, usePlayhead } from "../state/store";
import type { Clip, Track } from "../../shared/project";
import { newId } from "../../shared/project";
import { ticksPerBar, snapTicks, clamp } from "../../shared/time";
import { engine } from "../engine/engine";

const RULER_H = 34;
const COLORS = ["#e8663c", "#ffd166", "#4cc2ff", "#8ef58a", "#7b6cff", "#ff7bd5", "#5ad9c9"];

function PlaylistPlayhead({ pxPerTick, height }: { pxPerTick: number; height: number }) {
  const ticks = usePlayhead((s) => s.ticks);
  return <div className="playhead" style={{ left: ticks * pxPerTick, height }} />;
}

export function Playlist() {
  const { project, selection, select, update, dispatch, zoom, setZoom, snap, toast, setTab } = useStudio();
  const [drag, setDrag] = useState<null | { kind: "move" | "trim-l" | "trim-r"; clipId: string; startX: number; startY: number; orig: Clip; origAll: Clip[] }>(null);
  const [tool, setTool] = useState<"select" | "split">("select");
  const [ripple, setRipple] = useState(false);
  const [menu, setMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const pxPerTick = zoom.playlist;
  const tpb = ticksPerBar(project.timeSignature);
  const grid = snapTicks(snap as any, project.timeSignature);
  const snapT = (t: number) => (snap === "none" ? Math.round(t) : Math.round(t / grid) * grid);

  const songEnd = Math.max(tpb * 16, ...project.clips.map((c) => c.startTick + c.lengthTicks + tpb * 4));
  const width = songEnd * pxPerTick + 200;
  const tracksHeight = project.tracks.reduce((a, t) => a + t.height, 0);

  const clipsByTrack = useMemo(() => {
    const m = new Map<string, Clip[]>();
    for (const c of project.clips) {
      const arr = m.get(c.trackId) ?? [];
      arr.push(c);
      m.set(c.trackId, arr);
    }
    return m;
  }, [project.clips]);

  const trackTops = useMemo(() => {
    const tops = new Map<string, number>();
    let y = 0;
    for (const t of project.tracks) {
      tops.set(t.id, y);
      y += t.height;
    }
    return tops;
  }, [project.tracks]);

  const addTrack = (kind: Track["kind"]) => {
    dispatch({ type: "createTrack", name: `${kind === "audio" ? "Audio" : kind === "automation" ? "Auto" : "Track"} ${project.tracks.length + 1}`, kind, color: COLORS[project.tracks.length % COLORS.length] });
  };

  const patchClip = (id: string, patch: Partial<Clip>, undoable = true) =>
    update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), { undoable });

  const trackAtY = (y: number): Track | null => {
    let acc = 0;
    for (const t of project.tracks) {
      if (y >= acc && y < acc + t.height) return t;
      acc += t.height;
    }
    return null;
  };

  // ---------- clip interactions ----------
  const onClipPointerDown = (e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation();
    if (e.button === 2) return;
    const rect = bodyRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + bodyRef.current!.scrollLeft;
    if (tool === "split") {
      const atTick = snapT(x / pxPerTick);
      if (atTick > clip.startTick && atTick < clip.startTick + clip.lengthTicks) {
        dispatch({ type: "splitClip", clipId: clip.id, atTick });
      }
      return;
    }
    const ids = selection.clipIds.includes(clip.id) ? selection.clipIds : [clip.id];
    select({ clipIds: ids, trackId: clip.trackId, assetId: clip.assetId ?? null, patternId: clip.patternId ?? selection.patternId });
    const localX = x - clip.startTick * pxPerTick;
    const edge = 7;
    const kind = localX < edge ? "trim-l" : clip.lengthTicks * pxPerTick - localX < edge ? "trim-r" : "move";
    setDrag({ kind, clipId: clip.id, startX: x, startY: e.clientY - rect.top + bodyRef.current!.scrollTop - RULER_H, orig: { ...clip }, origAll: project.clips.map((c) => ({ ...c })) });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = bodyRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + bodyRef.current!.scrollLeft;
    const y = e.clientY - rect.top + bodyRef.current!.scrollTop - RULER_H;
    const dTicks = snapT(x / pxPerTick) - snapT(drag.startX / pxPerTick);
    if (drag.kind === "move") {
      const targetTrack = trackAtY(y);
      const selIds = new Set(selection.clipIds.length ? selection.clipIds : [drag.clipId]);
      update((p) => ({
        ...p,
        clips: drag.origAll.map((c) => {
          if (!selIds.has(c.id)) return c;
          const moved = { ...c, startTick: Math.max(0, c.startTick + dTicks) };
          if (c.id === drag.clipId && targetTrack && targetTrack.kind !== "automation") moved.trackId = targetTrack.id;
          return moved;
        }),
      }), { undoable: false });
    } else if (drag.kind === "trim-r") {
      const len = Math.max(grid, drag.orig.lengthTicks + dTicks);
      patchClip(drag.clipId, { lengthTicks: len }, false);
    } else {
      // trim-l = slip edit: move start + offset, keep end
      const shift = clamp(dTicks, -drag.orig.offsetTicks, drag.orig.lengthTicks - grid);
      patchClip(drag.clipId, {
        startTick: Math.max(0, drag.orig.startTick + shift),
        lengthTicks: drag.orig.lengthTicks - shift,
        offsetTicks: drag.orig.offsetTicks + shift,
      }, false);
    }
  };

  const onPointerUp = () => {
    if (drag) {
      if (ripple && drag.kind !== "move") {
        // ripple: shift later clips on same track by the length delta
        const cur = useStudio.getState().project.clips.find((c) => c.id === drag.clipId);
        if (cur) {
          const delta = cur.lengthTicks - drag.orig.lengthTicks + (cur.startTick - drag.orig.startTick);
          if (delta !== 0) {
            update((p) => ({
              ...p,
              clips: p.clips.map((c) =>
                c.trackId === cur.trackId && c.id !== cur.id && c.startTick >= drag.orig.startTick + drag.orig.lengthTicks
                  ? { ...c, startTick: Math.max(0, c.startTick + delta) }
                  : c,
              ),
            }));
          }
        }
      }
      update((p) => p, { undoable: false });
      // push one undoable snapshot of final state
      const finalClips = useStudio.getState().project.clips;
      useStudio.setState((s) => ({ undoStack: [...s.undoStack.slice(-79), { ...s.project, clips: drag.origAll }], redoStack: [] }));
      void finalClips;
    }
    setDrag(null);
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const rect = bodyRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + bodyRef.current!.scrollLeft;
    const y = e.clientY - rect.top + bodyRef.current!.scrollTop - RULER_H;
    const track = trackAtY(y);
    const tick = Math.max(0, snapT(x / pxPerTick));
    select({ clipIds: [] });
    if (!track) return;
    if (e.detail === 2) {
      // double-click empty space: place selected pattern (pattern tracks) or automation point lane
      if (track.kind === "automation") {
        dispatch({
          type: "createAutomation", trackId: track.id,
          target: { kind: "mixer-volume", mixerChannelId: track.mixerChannelId ?? "master" },
          startTick: tick, lengthTicks: tpb * 2,
          points: [{ tick: 0, value: 0.8, curve: 0 }, { tick: tpb * 2, value: 0.8, curve: 0 }],
        });
      } else if (selection.patternId) {
        dispatch({ type: "placePatternClip", trackId: track.id, patternId: selection.patternId, startTick: tick });
      }
    }
  };

  const rulerSeek = (e: React.MouseEvent) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + bodyRef.current!.scrollLeft;
    const tick = Math.max(0, snapT(x / pxPerTick));
    engine.seek(tick);
    usePlayhead.setState({ ticks: tick });
  };

  const menuClip = menu ? project.clips.find((c) => c.id === menu.clipId) : null;

  return (
    <div className="playlist">
      <div className="pl-toolbar">
        <button className="btn small" onClick={() => addTrack("pattern")}>+ Pattern Track</button>
        <button className="btn small" onClick={() => addTrack("audio")}>+ Audio Track</button>
        <button className="btn small" onClick={() => addTrack("automation")}>+ Automation</button>
        <span className="dim small">|</span>
        <button className={`tbtn ${tool === "select" ? "active" : ""}`} title="Select tool (B)" onClick={() => setTool("select")}>▭</button>
        <button className={`tbtn ${tool === "split" ? "active" : ""}`} title="Split tool (S) — click a clip to cut" onClick={() => setTool("split")}>✂</button>
        <label className="row small dim" title="Ripple edit: trims shift later clips">
          <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} />ripple
        </label>
        <button className="btn small" title="Add marker at playhead" onClick={() => {
          const name = prompt("Marker name", `Marker ${project.markers.length + 1}`);
          if (name) dispatch({ type: "addMarker", name, tick: usePlayhead.getState().ticks });
        }}>+ Marker</button>
        <button className="btn small" title="Label a song section over the loop region or next 4 bars" onClick={() => {
          const name = prompt("Section name (Intro, Verse, Chorus…)", "Verse");
          if (!name) return;
          const start = project.loop.enabled ? project.loop.startTick : snapT(usePlayhead.getState().ticks);
          const len = project.loop.enabled && project.loop.endTick > project.loop.startTick ? project.loop.endTick - project.loop.startTick : tpb * 4;
          dispatch({ type: "addSection", name, startTick: start, lengthTicks: len });
        }}>+ Section</button>
        <div className="spacer" />
        <span className="dim small">double-click empty lane places the selected pattern</span>
        <button className="btn small" title="Zoom out (-)" onClick={() => setZoom("playlist", Math.max(0.02, pxPerTick / 1.35))}>−</button>
        <button className="btn small" title="Zoom in (+)" onClick={() => setZoom("playlist", Math.min(1.2, pxPerTick * 1.35))}>+</button>
      </div>

      <div className="pl-body" ref={bodyRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div style={{ display: "flex", minWidth: width + 180 }}>
          {/* track heads */}
          <div className="pl-track-heads" style={{ paddingTop: RULER_H }}>
            {project.tracks.map((t) => (
              <div className="pl-track-head" key={t.id} style={{ height: t.height, borderLeft: `3px solid ${t.color}` }}>
                <span className="name" title={`${t.name} (${t.kind}) — double-click to rename`}
                  onClick={() => select({ trackId: t.id })}
                  onDoubleClick={() => {
                    const name = prompt("Track name", t.name);
                    if (name) dispatch({ type: "renameTrack", trackId: t.id, name });
                  }}>{t.name}</span>
                <button className={`ms-btn m ${t.muted ? "active" : ""}`} title="Mute track"
                  onClick={() => update((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, muted: !x.muted } : x)) }))}>M</button>
                <button className={`ms-btn s ${t.soloed ? "active" : ""}`} title="Solo track"
                  onClick={() => update((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, soloed: !x.soloed } : x)) }))}>S</button>
                <button className="mini-btn" title="Move up" onClick={() => {
                  const i = project.tracks.findIndex((x) => x.id === t.id);
                  if (i > 0) update((p) => {
                    const tracks = [...p.tracks];
                    [tracks[i - 1], tracks[i]] = [tracks[i]!, tracks[i - 1]!];
                    return { ...p, tracks };
                  });
                }}>↑</button>
                <button className="mini-btn" title="Track color" onClick={() => {
                  const idx = (COLORS.indexOf(t.color) + 1) % COLORS.length;
                  update((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, color: COLORS[idx]! } : x)) }));
                }}>◐</button>
                <button className="mini-btn" title="Delete track" onClick={() => {
                  if (!confirm(`Delete track "${t.name}" and its clips?`)) return;
                  update((p) => ({ ...p, tracks: p.tracks.filter((x) => x.id !== t.id), clips: p.clips.filter((c) => c.trackId !== t.id) }));
                }}>✕</button>
              </div>
            ))}
            {!project.tracks.length && <div style={{ width: 180, padding: 10 }} className="dim small">Add a track to arrange your song →</div>}
          </div>

          {/* timeline */}
          <div style={{ position: "relative", width, minHeight: RULER_H + tracksHeight + 60 }}
            onPointerDown={onGridPointerDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const data = e.dataTransfer.getData("application/pulseforge");
              if (!data) return;
              try {
                const payload = JSON.parse(data);
                const rect = bodyRef.current!.getBoundingClientRect();
                const x = e.clientX - rect.left + bodyRef.current!.scrollLeft;
                const y = e.clientY - rect.top + bodyRef.current!.scrollTop - RULER_H;
                const track = trackAtY(y);
                const tick = Math.max(0, snapT(x / pxPerTick));
                if (payload.kind === "asset" && track) {
                  dispatch({ type: "placeAudioClip", trackId: track.id, assetId: payload.assetId, startTick: tick });
                } else if (payload.kind === "pattern" && track) {
                  dispatch({ type: "placePatternClip", trackId: track.id, patternId: payload.patternId, startTick: tick });
                } else if (!track) {
                  toast("Drop onto a track lane (add one first)", "error");
                }
              } catch {}
            }}>
            {/* ruler */}
            <div className="pl-ruler" style={{ height: RULER_H, width }} onClick={rulerSeek} title="Click to seek">
              {Array.from({ length: Math.ceil(songEnd / tpb) + 1 }, (_, bar) => (
                <span key={bar} className="mono" style={{ position: "absolute", left: bar * tpb * pxPerTick + 3, top: 16, fontSize: 9, color: "var(--faint)" }}>{bar + 1}</span>
              ))}
              {project.sections.map((s) => (
                <div key={s.id} title={`${s.name} — click to rename, alt-click to delete`}
                  style={{ position: "absolute", left: s.startTick * pxPerTick, width: s.lengthTicks * pxPerTick, top: 0, height: 14, background: `${s.color}44`, borderLeft: `2px solid ${s.color}`, fontSize: 9, paddingLeft: 3, overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) return update((p) => ({ ...p, sections: p.sections.filter((x) => x.id !== s.id) }));
                    const name = prompt("Section name", s.name);
                    if (name) update((p) => ({ ...p, sections: p.sections.map((x) => (x.id === s.id ? { ...x, name } : x)) }));
                  }}>{s.name}</div>
              ))}
              {project.markers.map((m) => (
                <div key={m.id} title={`${m.name} — alt-click to delete`}
                  style={{ position: "absolute", left: m.tick * pxPerTick, top: 14, width: 1, height: 20, background: m.color, cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) update((p) => ({ ...p, markers: p.markers.filter((x) => x.id !== m.id) }));
                  }}>
                  <span style={{ fontSize: 8, color: m.color, position: "absolute", left: 2 }}>{m.name}</span>
                </div>
              ))}
              {project.loop.enabled && (
                <div style={{ position: "absolute", left: project.loop.startTick * pxPerTick, width: Math.max(0, (project.loop.endTick - project.loop.startTick)) * pxPerTick, top: 28, height: 5, background: "var(--cyan)", opacity: 0.7, borderRadius: 2 }}
                  title="Loop region (drag ends via ⌥-click ruler)" />
              )}
            </div>

            {/* lanes */}
            <div style={{ position: "relative", height: tracksHeight }}>
              {project.tracks.map((t) => (
                <div key={t.id} style={{ position: "absolute", top: trackTops.get(t.id), height: t.height, width, borderBottom: "1px solid var(--bg2)", background: t.kind === "automation" ? "#12182a" : undefined }} />
              ))}
              {/* bar lines */}
              {Array.from({ length: Math.ceil(songEnd / tpb) + 1 }, (_, bar) => (
                <div key={bar} style={{ position: "absolute", left: bar * tpb * pxPerTick, top: 0, bottom: 0, width: 1, background: bar % 4 === 0 ? "var(--line)" : "var(--bg2)" }} />
              ))}
              {/* clips */}
              {project.tracks.flatMap((t) =>
                (clipsByTrack.get(t.id) ?? []).map((c) => {
                  const selected = selection.clipIds.includes(c.id);
                  const pat = c.patternId ? project.patterns.find((x) => x.id === c.patternId) : null;
                  const color = c.color ?? pat?.color ?? t.color;
                  return (
                    <div key={c.id}
                      onPointerDown={(e) => onClipPointerDown(e, c)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        select({ clipIds: [c.id], assetId: c.assetId ?? null });
                        setMenu({ clipId: c.id, x: e.clientX, y: e.clientY });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (c.kind === "pattern" && c.patternId) { select({ patternId: c.patternId }); setTab("channel-rack"); }
                        if (c.kind === "audio" && c.assetId) { select({ assetId: c.assetId }); setTab("audio-editor"); }
                      }}
                      title={`${c.name ?? c.kind}${c.muted ? " (muted)" : ""} — drag to move, edges trim, double-click to open`}
                      style={{
                        position: "absolute",
                        left: c.startTick * pxPerTick,
                        top: (trackTops.get(t.id) ?? 0) + 2,
                        width: Math.max(6, c.lengthTicks * pxPerTick - 1),
                        height: t.height - 5,
                        background: c.muted ? "#333a4a" : `${color}55`,
                        border: `1px solid ${selected ? "var(--yellow)" : color}`,
                        borderRadius: 4,
                        overflow: "hidden",
                        cursor: tool === "split" ? "col-resize" : "grab",
                        fontSize: 10,
                        padding: "1px 4px",
                        color: "var(--text)",
                      }}>
                      <span style={{ pointerEvents: "none" }}>
                        {c.kind === "automation" ? "⚡ " : c.kind === "audio" ? "〜 " : "▦ "}
                        {c.name ?? pat?.name ?? "clip"}
                        {c.reversed ? " ⇤" : ""}{c.pitchSemitones ? ` ${c.pitchSemitones > 0 ? "+" : ""}${c.pitchSemitones}st` : ""}{c.stretch !== 1 ? ` ×${c.stretch.toFixed(2)}` : ""}
                      </span>
                      {c.kind === "automation" && c.automationPoints.length > 1 && (
                        <svg width="100%" height={t.height - 20} style={{ position: "absolute", left: 0, top: 14, pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 100 40">
                          <polyline fill="none" stroke={color} strokeWidth={2}
                            points={c.automationPoints.map((pt) => `${(pt.tick / c.lengthTicks) * 100},${(1 - pt.value) * 40}`).join(" ")} />
                        </svg>
                      )}
                      {(c.fadeInTicks > 0 || c.fadeOutTicks > 0) && (
                        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 100 100">
                          {c.fadeInTicks > 0 && <polygon points={`0,100 0,0 ${(c.fadeInTicks / c.lengthTicks) * 100},0`} fill="rgba(0,0,0,0.35)" />}
                          {c.fadeOutTicks > 0 && <polygon points={`${100 - (c.fadeOutTicks / c.lengthTicks) * 100},0 100,0 100,100`} fill="rgba(0,0,0,0.35)" />}
                        </svg>
                      )}
                    </div>
                  );
                }),
              )}
              <PlaylistPlayhead pxPerTick={pxPerTick} height={tracksHeight} />
            </div>
          </div>
        </div>
      </div>

      {/* clip context menu */}
      {menu && menuClip && (
        <div className="palette" style={{ left: menu.x, top: menu.y, transform: "none", width: 240, position: "fixed" }}
          onMouseLeave={() => setMenu(null)}>
          <div className="results" style={{ borderTop: "none" }}>
            {[
              ["Duplicate (⌘D)", () => {
                const copy = { ...menuClip, id: newId("clip"), startTick: menuClip.startTick + menuClip.lengthTicks };
                update((p) => ({ ...p, clips: [...p.clips, copy] }));
              }],
              [menuClip.muted ? "Unmute" : "Mute", () => dispatch({ type: "setClipMuted", clipId: menuClip.id, muted: !menuClip.muted })],
              ["Split at playhead", () => {
                const at = usePlayhead.getState().ticks;
                if (at > menuClip.startTick && at < menuClip.startTick + menuClip.lengthTicks) dispatch({ type: "splitClip", clipId: menuClip.id, atTick: Math.round(at) });
                else toast("Playhead is not inside this clip", "error");
              }],
              ["Fade in +1 beat", () => dispatch({ type: "setClipFades", clipId: menuClip.id, fadeInTicks: Math.min(menuClip.lengthTicks, menuClip.fadeInTicks + 96) })],
              ["Fade out +1 beat", () => dispatch({ type: "setClipFades", clipId: menuClip.id, fadeOutTicks: Math.min(menuClip.lengthTicks, menuClip.fadeOutTicks + 96) })],
              ["Clear fades", () => dispatch({ type: "setClipFades", clipId: menuClip.id, fadeInTicks: 0, fadeOutTicks: 0 })],
              ...(menuClip.kind === "audio" ? [
                [menuClip.reversed ? "Un-reverse" : "Reverse", () => patchClip(menuClip.id, { reversed: !menuClip.reversed })],
                ["Pitch +1 st", () => patchClip(menuClip.id, { pitchSemitones: clamp(menuClip.pitchSemitones + 1, -24, 24) })],
                ["Pitch -1 st", () => patchClip(menuClip.id, { pitchSemitones: clamp(menuClip.pitchSemitones - 1, -24, 24) })],
                ["Stretch ×2 (half speed)", () => patchClip(menuClip.id, { stretch: clamp(menuClip.stretch * 2, 0.25, 4), lengthTicks: menuClip.lengthTicks * 2 })],
                ["Stretch ×0.5 (double speed)", () => patchClip(menuClip.id, { stretch: clamp(menuClip.stretch / 2, 0.25, 4), lengthTicks: Math.max(24, Math.round(menuClip.lengthTicks / 2)) })],
                ["Clip gain +3 dB", () => dispatch({ type: "setClipGain", clipId: menuClip.id, gainDb: clamp(menuClip.gainDb + 3, -48, 24) })],
                ["Clip gain -3 dB", () => dispatch({ type: "setClipGain", clipId: menuClip.id, gainDb: clamp(menuClip.gainDb - 3, -48, 24) })],
                ["Open in Audio Editor", () => { select({ assetId: menuClip.assetId! }); setTab("audio-editor"); }],
              ] as Array<[string, () => void]> : []),
              ["Delete (⌫)", () => dispatch({ type: "deleteClip", clipId: menuClip.id })],
            ].map(([label, action]) => (
              <div key={label as string} className="result" onClick={() => { (action as () => void)(); setMenu(null); }}>
                <span>{label as string}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
