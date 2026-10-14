/** Global keyboard shortcuts. Never fires while typing in inputs/textareas. */
import { useStudio, usePlayhead } from "./state/store";
import { engine } from "./engine/engine";
import { newId } from "../shared/project";

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

export function installKeyboardShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isTyping()) return;
    const s = useStudio.getState();
    const mod = e.metaKey || e.ctrlKey;

    if (e.code === "Space") {
      e.preventDefault();
      if (engine.playing) engine.pause();
      else engine.play();
    } else if (e.key === "Escape") {
      if (s.paletteOpen) s.setFlags({ paletteOpen: false });
      else s.select({ clipIds: [], noteIds: [] });
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      s.save(true); // Save As lives in the project menu; ⌘⇧S also saves (browser can't re-prompt path)
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      s.setFlags({ paletteOpen: !s.paletteOpen });
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if (s.tab === "playlist") s.select({ clipIds: s.project.clips.map((c) => c.id) });
      else if (s.tab === "piano-roll" && s.selection.patternId && s.selection.channelId) {
        const pat = s.project.patterns.find((p) => p.id === s.selection.patternId);
        s.select({ noteIds: (pat?.notes[s.selection.channelId] ?? []).map((n) => n.id) });
      }
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (s.tab === "playlist" && s.selection.clipIds.length) {
        const clips = s.project.clips.filter((c) => s.selection.clipIds.includes(c.id));
        const copies = clips.map((c) => ({ ...c, id: newId("clip"), startTick: c.startTick + c.lengthTicks }));
        s.update((p) => ({ ...p, clips: [...p.clips, ...copies] }));
        s.select({ clipIds: copies.map((c) => c.id) });
      } else if (s.tab === "piano-roll" && s.selection.patternId && s.selection.channelId) {
        const { patternId, channelId, noteIds } = s.selection;
        const pat = s.project.patterns.find((p) => p.id === patternId);
        const all = pat?.notes[channelId] ?? [];
        const src = noteIds.length ? all.filter((n) => noteIds.includes(n.id)) : all;
        if (src.length) {
          const span = Math.max(...src.map((n) => n.startTick + n.lengthTicks)) - Math.min(...src.map((n) => n.startTick));
          const copies = src.map((n) => ({ ...n, id: newId("n"), startTick: n.startTick + Math.max(span, 24) }));
          s.update((p) => ({
            ...p,
            patterns: p.patterns.map((x) => (x.id === patternId ? { ...x, notes: { ...x.notes, [channelId]: [...all, ...copies] } } : x)),
          }));
          s.select({ noteIds: copies.map((n) => n.id) });
        }
      }
    } else if (!mod && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "b") && s.tab === "piano-roll") {
      s.setPrTool(e.key.toLowerCase() === "p" ? "pencil" : "select");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (s.tab === "playlist" && s.selection.clipIds.length) {
        s.update((p) => ({ ...p, clips: p.clips.filter((c) => !s.selection.clipIds.includes(c.id)) }));
        s.select({ clipIds: [] });
      } else if (s.tab === "piano-roll" && s.selection.noteIds.length && s.selection.patternId && s.selection.channelId) {
        const { patternId, channelId, noteIds } = s.selection;
        s.dispatch({ type: "removeNotes", patternId, channelId, noteIds });
        s.select({ noteIds: [] });
      }
    } else if (e.key === "?" && !mod) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("pf-cheatsheet"));
    } else if (e.key.toLowerCase() === "r" && !mod) {
      s.setTab("recording");
    } else if (e.key.toLowerCase() === "m" && !mod) {
      s.update((p) => ({ ...p, metronome: !p.metronome }));
    } else if ((e.key === "+" || e.key === "=") && !mod) {
      const view = s.tab === "piano-roll" ? "pianoRoll" : s.tab === "audio-editor" ? "audio" : "playlist";
      s.setZoom(view, Math.min(view === "playlist" ? 1.2 : 8, s.zoom[view] * 1.25));
    } else if (e.key === "-" && !mod) {
      const view = s.tab === "piano-roll" ? "pianoRoll" : s.tab === "audio-editor" ? "audio" : "playlist";
      s.setZoom(view, Math.max(view === "playlist" ? 0.02 : 0.15, s.zoom[view] / 1.25));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (s.tab === "playlist" && s.selection.clipIds.length) {
        e.preventDefault();
        s.update((p) => ({
          ...p,
          clips: p.clips.map((c) => (s.selection.clipIds.includes(c.id) ? { ...c, startTick: Math.max(0, c.startTick + dir * 24) } : c)),
        }));
      } else if (s.tab === "piano-roll" && s.selection.noteIds.length && s.selection.patternId && s.selection.channelId) {
        e.preventDefault();
        const { patternId, channelId, noteIds } = s.selection;
        s.update((p) => ({
          ...p,
          patterns: p.patterns.map((x) => (x.id === patternId
            ? { ...x, notes: { ...x.notes, [channelId]: (x.notes[channelId] ?? []).map((n) => (noteIds.includes(n.id) ? { ...n, startTick: Math.max(0, n.startTick + dir * 24) } : n)) } }
            : x)),
        }));
      } else if (!mod) {
        engine.seek(Math.max(0, usePlayhead.getState().ticks + dir * 96));
      }
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && s.tab === "piano-roll" && s.selection.noteIds.length && s.selection.patternId && s.selection.channelId) {
      e.preventDefault();
      const dp = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1); // shift = octave
      const { patternId, channelId, noteIds } = s.selection;
      s.update((p) => ({
        ...p,
        patterns: p.patterns.map((x) => (x.id === patternId
          ? { ...x, notes: { ...x.notes, [channelId]: (x.notes[channelId] ?? []).map((n) => (noteIds.includes(n.id) ? { ...n, pitch: Math.max(0, Math.min(127, n.pitch + dp)) } : n)) } }
          : x)),
      }));
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
