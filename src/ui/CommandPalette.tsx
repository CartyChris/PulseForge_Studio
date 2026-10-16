/** Command palette (⌘K): fuzzy-ish command search over studio actions. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio, type Tab, LEVELS, levelRank } from "../state/store";
import { NAV } from "./shell/NavRail";
import { GENRES, GENRE_IDS } from "../../shared/producer";
import { useProducer } from "../ai/useProducer";
import { engine } from "../engine/engine";

export function CommandPalette() {
  const studio = useStudio();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands = useMemo(() => {
    // every section — choosing one from a lower level switches up so it's visible
    const tabs = NAV.map((n) => [n.tab, n.label, n.min] as const);
    return [
      ...tabs.map(([tab, name, min]) => ({ name: `Go to ${name}`, kbd: "", run: () => { if (levelRank(studio.level) < levelRank(min)) studio.setLevel(min); studio.setTab(tab as Tab); } })),
      ...GENRE_IDS.map((g) => ({ name: `Produce a ${GENRES[g].name} beat`, kbd: "", run: () => { studio.setTab("producer"); void useProducer.getState().start({ prompt: GENRES[g].name, overrides: { genre: g } }); } })),
      ...LEVELS.map((l) => ({ name: `Switch to ${l} mode`, kbd: "", run: () => studio.setLevel(l) })),
      { name: "Show help & shortcuts", kbd: "?", run: () => window.dispatchEvent(new CustomEvent("pf-cheatsheet")) },
      { name: "Play / Pause", kbd: "Space", run: () => (engine.playing ? engine.pause() : engine.play()) },
      { name: "Stop", kbd: "", run: () => engine.stop() },
      { name: "Save project", kbd: "⌘S", run: () => studio.save(true) },
      { name: "Undo", kbd: "⌘Z", run: () => studio.undo() },
      { name: "Redo", kbd: "⌘⇧Z", run: () => studio.redo() },
      { name: "Toggle metronome", kbd: "M", run: () => studio.update((p) => ({ ...p, metronome: !p.metronome })) },
      { name: "Toggle loop region", kbd: "", run: () => studio.update((p) => ({ ...p, loop: { ...p.loop, enabled: !p.loop.enabled } })) },
      { name: "New pattern", kbd: "", run: () => studio.dispatch({ type: "createPattern", name: `Pattern ${studio.project.patterns.length + 1}`, lengthSteps: 16 }) },
      { name: "Toggle reduced motion", kbd: "", run: () => studio.setFlags({ reducedMotion: !studio.reducedMotion }) },
      { name: "Interface scale 100%", kbd: "", run: () => studio.setUiScale(1) },
      { name: "Interface scale 90% (compact laptop)", kbd: "", run: () => studio.setUiScale(0.9) },
      { name: "Interface scale 110%", kbd: "", run: () => studio.setUiScale(1.1) },
      { name: "Full-screen studio mode", kbd: "", run: () => document.documentElement.requestFullscreen?.() },
      { name: "Exit full-screen", kbd: "", run: () => document.exitFullscreen?.().catch(() => {}) },
    ];
  }, [studio]);

  const filtered = commands.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  const close = () => studio.setFlags({ paletteOpen: false });

  return (
    <>
      <div className="modal-backdrop" style={{ background: "rgba(5,7,12,0.4)" }} onMouseDown={close} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          placeholder="Type a command…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") setIdx((i) => Math.min(filtered.length - 1, i + 1));
            else if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
            else if (e.key === "Enter" && filtered[idx]) { filtered[idx]!.run(); close(); }
          }}
        />
        <div className="results">
          {filtered.slice(0, 12).map((c, i) => (
            <div key={c.name} className={`result ${i === idx ? "active" : ""}`} onClick={() => { c.run(); close(); }}>
              <span>{c.name}</span>
              <span className="kbd">{c.kbd}</span>
            </div>
          ))}
          {!filtered.length && <div className="result dim">no matches</div>}
        </div>
      </div>
    </>
  );
}
