/** Piano Roll: canvas note editor — draw/select/drag/resize, velocity lane, scale
 * highlighting, chord stamp, arpeggiate, quantize/humanize/legato, ghost notes, MIDI I/O. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio, usePlayhead } from "../state/store";
import type { Note } from "../../shared/project";
import { newId } from "../../shared/project";
import { SCALES, CHORD_SHAPES, NOTE_NAMES, midiToName, inScale, snapTicks, TICKS_PER_STEP, clamp } from "../../shared/time";
import { engine } from "../engine/engine";
import { getHost } from "../host/adapter";
import { parseMidi } from "../midi";
import { ShowAt, MoreTools } from "./shell/Level";
import { strum, flam, roll, velocityRamp, snapToScale, harmonize, invertPitches, retrograde, scaleLength, removeOverlaps, DEFAULT_STRUM_TICKS } from "../../shared/notetools";

const KEY_H = 14;
const MIN_PITCH = 21, MAX_PITCH = 108;
const KEYS_W = 56;

import type { Project } from "../../shared/project";

type Drag =
  | { kind: "move"; startX: number; startY: number; orig: Note[]; preDrag: Project }
  | { kind: "resize"; noteId: string; orig: Note[]; preDrag: Project }
  | { kind: "marquee"; startX: number; startY: number; x: number; y: number }
  | null;

export function PianoRoll() {
  const { project, selection, select, update, dispatch, zoom, setZoom, snap, toast, prTool: tool, setPrTool: setTool, pushUndo } = useStudio();
  // subscribe at 16th-note resolution so playing doesn't force 60fps canvas redraws
  const playheadQ = usePlayhead((s) => (s.playing ? Math.floor(s.ticks / TICKS_PER_STEP) : -1));
  const playing = playheadQ >= 0;
  const positionTicks = playheadQ * TICKS_PER_STEP;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const velRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const movedRef = useRef(false);
  const [ghost, setGhost] = useState(true);
  const [noteLen, setNoteLen] = useState(TICKS_PER_STEP * 2);
  const [chord, setChord] = useState<string>("none");
  const [lane, setLane] = useState<"velocity" | "pan">("velocity");

  const pattern = project.patterns.find((p) => p.id === selection.patternId) ?? project.patterns[0];
  const channel = project.channels.find((c) => c.id === selection.channelId) ?? project.channels[0];
  const pxPerTick = zoom.pianoRoll;

  const notes = useMemo(() => (pattern && channel ? pattern.notes[channel.id] ?? [] : []), [pattern, channel]);

  // open centered near C4-C5 (or on existing notes) instead of the piano's top
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focusPitch = notes.length ? Math.round(notes.reduce((a, n) => a + n.pitch, 0) / notes.length) : 60;
    el.scrollTop = Math.max(0, (MAX_PITCH - focusPitch) * KEY_H - el.clientHeight / 2);
  }, [channel?.id]); // scroll only when switching channels, not on every note edit
  const patternTicks = (pattern?.lengthSteps ?? 16) * TICKS_PER_STEP;
  const gridW = Math.max(600, patternTicks * pxPerTick + 100);
  const gridH = (MAX_PITCH - MIN_PITCH + 1) * KEY_H;

  const rootPc = NOTE_NAMES.indexOf(project.key as any) >= 0 ? NOTE_NAMES.indexOf(project.key as any) : 0;
  const scalePcs = SCALES[project.scale] ?? SCALES.minor!;

  const setNotes = (next: Note[], undoable = true) => {
    if (!pattern || !channel) return;
    update((p) => ({
      ...p,
      patterns: p.patterns.map((x) => (x.id === pattern.id ? { ...x, notes: { ...x.notes, [channel.id]: next } } : x)),
    }), { undoable });
  };

  const selectedSet = new Set(selection.noteIds);

  const pitchAtY = (y: number) => MAX_PITCH - Math.floor(y / KEY_H);
  const yAtPitch = (pitch: number) => (MAX_PITCH - pitch) * KEY_H;
  const tickAtX = (x: number) => x / pxPerTick;
  const grid = snapTicks(snap as any, project.timeSignature);
  const snapT = (t: number) => (snap === "none" ? Math.round(t) : Math.round(t / grid) * grid);

  // ---------- drawing ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = gridW * dpr;
    canvas.height = gridH * dpr;
    canvas.style.width = `${gridW}px`;
    canvas.style.height = `${gridH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gridW, gridH);

    // row backgrounds (scale highlight)
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const y = yAtPitch(pitch);
      const inKey = inScale(pitch, rootPc, scalePcs);
      const isRoot = ((pitch % 12) + 12) % 12 === rootPc;
      ctx.fillStyle = isRoot ? "#1c2438" : inKey ? "#161d2e" : "#10141f";
      ctx.fillRect(0, y, gridW, KEY_H);
    }
    // vertical grid
    for (let t = 0; t <= patternTicks; t += TICKS_PER_STEP) {
      const x = t * pxPerTick;
      const isBar = t % (TICKS_PER_STEP * 16) === 0;
      const isBeat = t % 96 === 0;
      ctx.strokeStyle = isBar ? "#3a4666" : isBeat ? "#2c3650" : "#1c2333";
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridH);
      ctx.stroke();
    }
    // horizontal lines
    ctx.strokeStyle = "#181f30";
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const y = yAtPitch(pitch) + KEY_H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridW, y);
      ctx.stroke();
    }
    // ghost notes from other channels
    if (ghost && channel) {
      ctx.fillStyle = "rgba(138,147,166,0.18)";
      for (const [chId, chNotes] of Object.entries(pattern.notes)) {
        if (chId === channel.id) continue;
        for (const n of chNotes) {
          ctx.fillRect(n.startTick * pxPerTick, yAtPitch(n.pitch) + 1, Math.max(3, n.lengthTicks * pxPerTick - 1), KEY_H - 2);
        }
      }
    }
    // notes
    for (const n of notes) {
      const x = n.startTick * pxPerTick;
      const w = Math.max(4, n.lengthTicks * pxPerTick - 1);
      const y = yAtPitch(n.pitch) + 1;
      const sel = selectedSet.has(n.id);
      const alpha = 0.45 + n.velocity * 0.55;
      ctx.fillStyle = sel ? `rgba(255,209,102,${alpha})` : `rgba(232,102,60,${alpha})`;
      ctx.fillRect(x, y, w, KEY_H - 2);
      ctx.strokeStyle = sel ? "#ffd166" : "#a34328";
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, KEY_H - 3);
      // resize handle
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x + w - 4, y, 4, KEY_H - 2);
    }
    // marquee
    if (drag?.kind === "marquee") {
      ctx.strokeStyle = "#4cc2ff";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(drag.startX, drag.x), Math.min(drag.startY, drag.y), Math.abs(drag.x - drag.startX), Math.abs(drag.y - drag.startY));
      ctx.setLineDash([]);
    }
    // playhead
    if (playing) {
      const x = (positionTicks % patternTicks) * pxPerTick;
      ctx.strokeStyle = "#4cc2ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridH);
      ctx.stroke();
    }
  }, [notes, pattern, channel, pxPerTick, selection.noteIds, drag, ghost, playing, positionTicks, project.key, project.scale, gridW, gridH, patternTicks, rootPc, scalePcs]);

  // velocity lane
  useEffect(() => {
    const canvas = velRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = gridW * dpr;
    canvas.height = 90 * dpr;
    canvas.style.width = `${gridW}px`;
    canvas.style.height = "90px";
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gridW, 90);
    if (lane === "pan") {
      ctx.strokeStyle = "#2c3650";
      ctx.beginPath(); ctx.moveTo(0, 44); ctx.lineTo(gridW, 44); ctx.stroke();
    }
    for (const n of notes) {
      const x = n.startTick * pxPerTick;
      const w = Math.max(3, Math.min(8, n.lengthTicks * pxPerTick));
      const sel = selectedSet.has(n.id);
      ctx.fillStyle = sel ? "#ffd166" : lane === "pan" ? "#4cc2ff" : "#e8663c";
      if (lane === "velocity") {
        const h = n.velocity * 82;
        ctx.fillRect(x, 88 - h, w, h);
      } else {
        const h = n.pan * 40; // -1..1 → bar from the center line
        if (h >= 0) ctx.fillRect(x, 44 - h, w, Math.max(2, h));
        else ctx.fillRect(x, 44, w, Math.max(2, -h));
      }
    }
  }, [notes, pxPerTick, selection.noteIds, gridW, lane]);

  if (!pattern || !channel) {
    return <div className="rack"><p className="dim">Add a channel in the Channel Rack first — the Piano Roll edits one channel's notes inside the selected pattern.</p></div>;
  }

  // ---------- interactions ----------
  const noteAt = (x: number, y: number): { note: Note; onEdge: boolean } | null => {
    const pitch = pitchAtY(y);
    const tick = tickAtX(x);
    for (const n of [...notes].reverse()) {
      if (n.pitch === pitch && tick >= n.startTick && tick <= n.startTick + n.lengthTicks) {
        const w = n.lengthTicks * pxPerTick;
        const edgePx = (n.startTick + n.lengthTicks) * pxPerTick - x;
        // generous FL-style tail grab: up to 12px but never more than a third of the note
        return { note: n, onEdge: edgePx < Math.min(12, Math.max(5, w / 3)) };
      }
    }
    return null;
  };

  const canvasPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) return;
    const { x, y } = canvasPos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const hit = noteAt(x, y);

    if (e.button === 2) {
      // right-click: delete note
      if (hit) setNotes(notes.filter((n) => n.id !== hit.note.id));
      return;
    }

    if (hit) {
      const ids = selectedSet.has(hit.note.id) ? selection.noteIds : [hit.note.id];
      select({ noteIds: ids });
      const preDrag = useStudio.getState().project;
      // alt-drag clones the selection FL-style, then moves the copies
      if (e.altKey && !hit.onEdge) {
        const src = notes.filter((n) => ids.includes(n.id));
        const copies = src.map((n) => ({ ...n, id: newId("n") }));
        const merged = [...notes, ...copies];
        setNotes(merged, false);
        select({ noteIds: copies.map((n) => n.id) });
        setDrag({ kind: "move", startX: x, startY: y, orig: merged.map((n) => ({ ...n })), preDrag });
        return;
      }
      if (hit.onEdge) setDrag({ kind: "resize", noteId: hit.note.id, orig: notes.map((n) => ({ ...n })), preDrag });
      else setDrag({ kind: "move", startX: x, startY: y, orig: notes.map((n) => ({ ...n })), preDrag });
      return;
    }

    if (tool === "select") {
      setDrag({ kind: "marquee", startX: x, startY: y, x, y });
      return;
    }

    // pencil: create note(s) — chord stamp if chosen
    const pitch = clamp(pitchAtY(y), MIN_PITCH, MAX_PITCH);
    const startTick = Math.max(0, snapT(tickAtX(x)));
    const shape = chord !== "none" ? CHORD_SHAPES[chord] ?? [0] : [0];
    const created: Note[] = shape.map((iv) => ({
      id: newId("n"), pitch: clamp(pitch + iv, 0, 127), startTick, lengthTicks: noteLen,
      velocity: 0.8, pan: 0, probability: 1,
    }));
    setNotes([...notes, ...created]);
    select({ noteIds: created.map((n) => n.id) });
    engine.auditionNote(channel.id, pitch, 0.3, 0.8);
    setDrag({ kind: "move", startX: x, startY: y, orig: [...notes.map((n) => ({ ...n })), ...created], preDrag: useStudio.getState().project });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) {
      // hover affordance: resize cursor at note tails, grab over note bodies
      const { x, y } = canvasPos(e);
      const hit = noteAt(x, y);
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = hit ? (hit.onEdge ? "ew-resize" : "grab") : tool === "select" ? "default" : "crosshair";
      return;
    }
    movedRef.current = true;
    const { x, y } = canvasPos(e);
    if (drag.kind === "marquee") {
      setDrag({ ...drag, x, y });
      return;
    }
    if (drag.kind === "move") {
      const dTicks = snapT(tickAtX(x)) - snapT(tickAtX(drag.startX));
      const dPitch = pitchAtY(y) - pitchAtY(drag.startY);
      const moved = drag.orig.map((n) =>
        selectedSet.has(n.id)
          ? { ...n, startTick: Math.max(0, n.startTick + dTicks), pitch: clamp(n.pitch + dPitch, 0, 127) }
          : n,
      );
      setNotes(moved, false);
      return;
    }
    if (drag.kind === "resize") {
      const anchor = drag.orig.find((n) => n.id === drag.noteId)!;
      const newLen = Math.max(6, snapT(tickAtX(x)) - anchor.startTick);
      const scale = newLen / anchor.lengthTicks;
      const resized = drag.orig.map((n) =>
        selectedSet.has(n.id) ? { ...n, lengthTicks: Math.max(6, Math.round(n.lengthTicks * scale)) } : n,
      );
      setNotes(resized, false);
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "marquee") {
      const x0 = Math.min(drag.startX, drag.x), x1 = Math.max(drag.startX, drag.x);
      const y0 = Math.min(drag.startY, drag.y), y1 = Math.max(drag.startY, drag.y);
      const ids = notes.filter((n) => {
        const nx0 = n.startTick * pxPerTick, nx1 = (n.startTick + n.lengthTicks) * pxPerTick;
        const ny = yAtPitch(n.pitch);
        return nx1 >= x0 && nx0 <= x1 && ny + KEY_H >= y0 && ny <= y1;
      }).map((n) => n.id);
      select({ noteIds: ids });
    } else if (drag && movedRef.current) {
      // the gesture already wrote its result via non-undoable updates;
      // record the pre-drag project so ⌘Z restores the true "before"
      pushUndo(drag.preDrag);
    }
    movedRef.current = false;
    setDrag(null);
  };

  const targetIds = selection.noteIds.length ? selection.noteIds : notes.map((n) => n.id);
  const editTargets = (fn: (n: Note) => Note) => {
    const set = new Set(targetIds);
    setNotes(notes.map((n) => (set.has(n.id) ? fn(n) : n)));
  };

  /** Apply a pure note transform to the selection (or everything when nothing is selected). */
  const transform = (fn: (sel: Note[]) => Note[]) => {
    const sel = notes.filter((n) => selectedSet.has(n.id));
    if (sel.length) {
      const ids = new Set(sel.map((n) => n.id));
      setNotes([...notes.filter((n) => !ids.has(n.id)), ...fn(sel)]);
    } else {
      setNotes(fn(notes));
    }
  };

  const actions = {
    strum: () => transform((s) => strum(s, DEFAULT_STRUM_TICKS, "up")),
    flam: () => transform((s) => flam(s)),
    roll: () => transform((s) => roll(s, 4, "up")),
    rampUp: () => transform((s) => velocityRamp(s, 0.35, 1)),
    rampDown: () => transform((s) => velocityRamp(s, 1, 0.35)),
    snapScale: () => transform((s) => snapToScale(s, rootPc, scalePcs)),
    harmonize: () => transform((s) => harmonize(s, scalePcs.includes(4) ? 4 : 3)),
    invert: () => transform((s) => invertPitches(s)),
    retrograde: () => transform((s) => retrograde(s)),
    staccato: () => transform((s) => scaleLength(s, 0.5)),
    fixOverlaps: () => transform((s) => removeOverlaps(s)),
    quantize: () => dispatch({ type: "quantizeNotes", patternId: pattern.id, channelId: channel.id, grid: "step", amount: 1 }),
    humanize: () => dispatch({ type: "humanizeNotes", patternId: pattern.id, channelId: channel.id, timingTicks: 4, velocityAmount: 0.12 }),
    legato: () => {
      const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
      const out = sorted.map((n, i) => {
        const next = sorted.slice(i + 1).find((m) => m.startTick > n.startTick);
        return next ? { ...n, lengthTicks: Math.max(6, next.startTick - n.startTick) } : n;
      });
      setNotes(out);
    },
    arpeggiate: () => {
      // spread simultaneous notes into a rising arpeggio within their length
      const groups = new Map<number, Note[]>();
      for (const n of notes) {
        const g = groups.get(n.startTick) ?? [];
        g.push(n);
        groups.set(n.startTick, g);
      }
      const out: Note[] = [];
      for (const [, g] of groups) {
        if (g.length < 2) { out.push(...g); continue; }
        const sortedG = [...g].sort((a, b) => a.pitch - b.pitch);
        const stepLen = Math.max(6, Math.round(sortedG[0]!.lengthTicks / sortedG.length));
        sortedG.forEach((n, i) => out.push({ ...n, startTick: n.startTick + i * stepLen, lengthTicks: stepLen }));
      }
      setNotes(out);
    },
    duplicate: () => {
      const sel = notes.filter((n) => selectedSet.has(n.id));
      const src = sel.length ? sel : notes;
      if (!src.length) return;
      const span = Math.max(...src.map((n) => n.startTick + n.lengthTicks)) - Math.min(...src.map((n) => n.startTick));
      const offset = Math.max(span, grid);
      const copies = src.map((n) => ({ ...n, id: newId("n"), startTick: n.startTick + offset }));
      setNotes([...notes, ...copies]);
      select({ noteIds: copies.map((n) => n.id) });
    },
    selectAll: () => select({ noteIds: notes.map((n) => n.id) }),
    deleteSel: () => setNotes(notes.filter((n) => !selectedSet.has(n.id))),
    importMidi: async () => {
      const files = await getHost().importFiles({ accept: [".mid", ".midi"], multiple: false });
      if (!files[0]) return;
      try {
        const parsed = parseMidi(files[0].data);
        if (!parsed.notes.length) return toast("MIDI file contained no notes", "error");
        dispatch({ type: "addNotes", patternId: pattern.id, channelId: channel.id, replace: false, notes: parsed.notes.map(({ id: _id, ...n }) => n) });
        if (parsed.bpm) toast(`Imported ${parsed.notes.length} notes (file tempo ${parsed.bpm} BPM)`, "success");
        else toast(`Imported ${parsed.notes.length} notes`, "success");
      } catch (e) {
        toast(`MIDI import failed: ${e}`, "error");
      }
    },
    exportMidi: async () => {
      const { notesToMidi } = await import("../midi");
      const data = notesToMidi(notes, project.bpm, `${pattern.name}-${channel.name}`);
      await getHost().exportFiles([{ name: `${pattern.name}-${channel.name}.mid`, mime: "audio/midi", data }]);
    },
  };

  return (
    <div className="piano-roll">
      <div className="pr-toolbar">
        <select className="sel" value={channel.id} onChange={(e) => select({ channelId: e.target.value, noteIds: [] })} aria-label="Channel">
          {project.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="sel" value={pattern.id} onChange={(e) => select({ patternId: e.target.value, noteIds: [] })} aria-label="Pattern"
          title="Pattern (♪ = has notes for this part)">
          {project.patterns.map((p) => <option key={p.id} value={p.id}>{(p.notes[channel.id]?.length ?? 0) > 0 ? "♪ " : ""}{p.name}</option>)}
        </select>
        <button className={`tbtn ${tool === "pencil" ? "active" : ""}`} title="Pencil (P)" onClick={() => setTool("pencil")}>✏</button>
        <button className={`tbtn ${tool === "select" ? "active" : ""}`} title="Select (B)" onClick={() => setTool("select")}>▭</button>
        <select className="sel" title="New note length" value={noteLen} onChange={(e) => setNoteLen(Number(e.target.value))}>
          {[[24, "1/16"], [48, "1/8"], [96, "1/4"], [192, "1/2"], [384, "1 bar"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="sel" title="Chord stamp" value={chord} onChange={(e) => setChord(e.target.value)}>
          <option value="none">Single note</option>
          {Object.keys(CHORD_SHAPES).map((c) => <option key={c} value={c}>{c} chord</option>)}
        </select>
        <select className="sel" title="Key" value={project.key} onChange={(e) => update((p) => ({ ...p, key: e.target.value }))}>
          {NOTE_NAMES.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select className="sel" title="Scale" value={project.scale} onChange={(e) => update((p) => ({ ...p, scale: e.target.value }))}>
          {Object.keys(SCALES).map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn small" onClick={actions.quantize} title="Quantize to step grid">Quantize</button>
        <button className="btn small" onClick={actions.duplicate} title="Duplicate selection (⌘D)">Dup</button>
        <button className="btn small" onClick={() => editTargets((n) => ({ ...n, pitch: clamp(n.pitch + 12, 0, 127) }))} title="Octave up">+8va</button>
        <button className="btn small" onClick={() => editTargets((n) => ({ ...n, pitch: clamp(n.pitch - 12, 0, 127) }))} title="Octave down">-8va</button>
        <ShowAt min="intermediate">
        <label className="row small dim"><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />ghosts</label>
        <button className="btn small" onClick={actions.humanize}>Humanize</button>
        <button className="btn small" onClick={actions.legato}>Legato</button>
        <button className="btn small" onClick={actions.arpeggiate}>Arpeggiate</button>
        <button className="btn small" onClick={actions.strum} title="Strum chords (offset stacked notes in pitch order)">Strum</button>
        <button className="btn small" onClick={actions.roll} title="Note repeat — subdivide each note into fast hits">Roll</button>
        <button className="btn small" onClick={actions.snapScale} title={`Snap every note into ${project.key} ${project.scale}`}>Snap→Key</button>
        <button className="btn small" onClick={actions.harmonize} title="Add a harmony layer a third/fifth above">Harmonize</button>
        </ShowAt>
        <MoreTools min="intermediate">
        <button className="btn small" onClick={actions.flam} title="Add a quiet grace note before each note">Flam</button>
        <button className="btn small" onClick={actions.rampUp} title="Velocity crescendo across the selection">Vel↗</button>
        <button className="btn small" onClick={actions.rampDown} title="Velocity diminuendo across the selection">Vel↘</button>
        <button className="btn small" onClick={actions.invert} title="Mirror pitches around the average (melodic inversion)">Invert</button>
        <button className="btn small" onClick={actions.retrograde} title="Reverse the selection in time">Reverse</button>
        <button className="btn small" onClick={actions.staccato} title="Shorten notes to 50%">Stacc.</button>
        <button className="btn small" onClick={actions.fixOverlaps} title="Trim overlapping same-pitch notes">Fix Overlaps</button>
        <button className="btn small" onClick={() => editTargets((n) => ({ ...n, pitch: clamp(n.pitch + 1, 0, 127) }))} title="Semitone up">+1</button>
        <button className="btn small" onClick={() => editTargets((n) => ({ ...n, pitch: clamp(n.pitch - 1, 0, 127) }))} title="Semitone down">-1</button>
        </MoreTools>
        <div className="spacer" />
        <ShowAt min="intermediate">
        <button className="btn small" onClick={actions.importMidi}>Import MIDI</button>
        <button className="btn small" onClick={actions.exportMidi} disabled={!notes.length}>Export MIDI</button>
        </ShowAt>
        <button className="btn small" title="Zoom out (-)" onClick={() => setZoom("pianoRoll", Math.max(0.15, pxPerTick / 1.3))}>−</button>
        <button className="btn small" title="Zoom in (+)" onClick={() => setZoom("pianoRoll", Math.min(3, pxPerTick * 1.3))}>+</button>
      </div>

      <div className="pr-body" ref={scrollRef}>
        <div className="pr-keys" style={{ width: KEYS_W, height: gridH }}>
          {Array.from({ length: MAX_PITCH - MIN_PITCH + 1 }, (_, i) => {
            const pitch = MAX_PITCH - i;
            const black = [1, 3, 6, 8, 10].includes(pitch % 12);
            return (
              <div key={pitch}
                style={{
                  height: KEY_H, fontSize: 9, display: "flex", alignItems: "center", paddingLeft: 6,
                  background: black ? "#0a0d14" : "#1d2436", color: black ? "#5a6478" : "#aeb6c8",
                  borderBottom: "1px solid #10141f", cursor: "pointer", width: KEYS_W,
                }}
                title={`Audition ${midiToName(pitch)}`}
                onMouseDown={() => engine.auditionNote(channel.id, pitch, 0.4, 0.85)}
              >
                {pitch % 12 === 0 ? midiToName(pitch) : ""}
              </div>
            );
          })}
        </div>
        <div className="pr-grid">
          <canvas
            ref={canvasRef}
            className="pr-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>

      <div className="velocity-lane">
        <select className="sel" value={lane} onChange={(e) => setLane(e.target.value as any)} aria-label="Lane mode"
          style={{ position: "absolute", left: 4, top: 4, zIndex: 2 }}>
          <option value="velocity">Velocity</option>
          <option value="pan">Pan</option>
        </select>
        <canvas
          ref={velRef}
          style={{ marginLeft: KEYS_W }}
          title={lane === "velocity" ? "Velocity lane — drag to set velocity" : "Pan lane — drag around the center line"}
          onPointerDown={(e) => {
            const preDrag = useStudio.getState().project;
            const rect = velRef.current!.getBoundingClientRect();
            const apply = (ev: { clientX: number; clientY: number }) => {
              const x = ev.clientX - rect.left;
              const yn = (ev.clientY - rect.top) / 88;
              const tick = x / pxPerTick;
              const current = useStudio.getState().project.patterns.find((p) => p.id === pattern.id)?.notes[channel.id] ?? [];
              const target = current.filter((n) => Math.abs(n.startTick - tick) < grid / 2 && (!selection.noteIds.length || selectedSet.has(n.id)));
              if (target.length) {
                const set = new Set(target.map((n) => n.id));
                setNotes(current.map((n) => set.has(n.id)
                  ? lane === "velocity"
                    ? { ...n, velocity: clamp(1 - yn, 0.05, 1) }
                    : { ...n, pan: clamp((0.5 - yn) * 2, -1, 1) }
                  : n), false);
              }
            };
            apply(e);
            const move = (ev: PointerEvent) => apply(ev);
            const up = () => {
              pushUndo(preDrag);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      </div>
    </div>
  );
}
