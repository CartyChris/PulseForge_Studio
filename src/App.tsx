/** PulseForge Studio shell: layout, tabs, panels, startup project load, shortcuts. */
import { useEffect, useState } from "react";
import { useStudio, startTransportLoop, type Tab } from "./state/store";
import { TransportBar } from "./ui/TransportBar";
import { Browser } from "./ui/Browser";
import { Inspector } from "./ui/Inspector";
import { ChannelRack } from "./ui/ChannelRack";
import { PianoRoll } from "./ui/PianoRoll";
import { Playlist } from "./ui/Playlist";
import { Mixer } from "./ui/Mixer";
import { AudioEditor } from "./ui/AudioEditor";
import { InstrumentEditor } from "./ui/InstrumentEditor";
import { AIAssistant } from "./ui/AIAssistant";
import { SoundLab } from "./ui/SoundLab";
import { Recording } from "./ui/Recording";
import { ResourceHub } from "./ui/ResourceHub";
import { CommandPalette } from "./ui/CommandPalette";
import { installKeyboardShortcuts } from "./keyboard";
import { setHost, StandaloneHostAdapter } from "./host/adapter";
import { initUiPrefs } from "./ui/Settings";
import { recentProjects, loadProjectWithRecovery, saveProject, PROJECT_TEMPLATES } from "./storage/projects";
import { ensureProjectAssetsLoaded } from "./audio/assets";
import { engine } from "./engine/engine";

const TABS: Array<[Tab, string]> = [
  ["channel-rack", "Channel Rack"],
  ["piano-roll", "Piano Roll"],
  ["playlist", "Playlist"],
  ["audio-editor", "Audio Editor"],
  ["mixer", "Mixer"],
  ["instrument", "Instrument"],
  ["recording", "Recording"],
  ["ai-assistant", "AI Assistant"],
  ["sound-lab", "Sound Lab"],
  ["resources", "Resources"],
];

export function App() {
  const { tab, setTab, toasts, dismissToast, projectLoaded, setProject, toast, paletteOpen, reducedMotion, uiScale } = useStudio();
  const [leftW, setLeftW] = useState(230);
  const [rightW, setRightW] = useState(250);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setHost(new StandaloneHostAdapter((n) => useStudio.getState().toast(`${n.title}${n.body ? ` — ${n.body}` : ""}`, n.kind ?? "info")));
    initUiPrefs();
    startTransportLoop();
    const uninstall = installKeyboardShortcuts();
    (async () => {
      try {
        const recent = await recentProjects();
        if (recent[0]) {
          const rec = await loadProjectWithRecovery(recent[0]);
          if (rec) {
            setProject(rec.project);
            await ensureProjectAssetsLoaded(rec.project);
            if (rec.recovered) toast("Recovered unsaved changes from autosave", "info");
            return;
          }
        }
        const p = PROJECT_TEMPLATES.find((t) => t.id === "hiphop-90")!.create();
        await saveProject(p);
        setProject(p);
      } catch (e) {
        toast(`Startup problem: ${e}`, "error");
        const p = PROJECT_TEMPLATES[0]!.create();
        setProject(p);
      }
    })();
    return uninstall;
  }, [setProject, toast]);

  // audio context needs a user gesture — arm on first interaction
  useEffect(() => {
    if (started) return;
    const arm = async () => {
      await engine.init();
      setStarted(true);
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [started]);

  const resize = (side: "l" | "r") => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "l" ? leftW : rightW;
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - startX;
      if (side === "l") setLeftW(Math.max(160, Math.min(420, startW + d)));
      else setRightW(Math.max(180, Math.min(460, startW - d)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`app ${reducedMotion ? "reduced-motion" : ""}`} style={{ zoom: uiScale }}>
      <TransportBar />
      <div className="main-row">
        {showLeft && (
          <div className="side-panel" style={{ width: leftW }}>
            <Browser />
            <div className="resizer" onPointerDown={resize("l")} />
          </div>
        )}
        <div className="workspace">
          <div className="tabs" role="tablist">
            <button className="tab" title="Toggle browser panel" onClick={() => setShowLeft(!showLeft)}>{showLeft ? "◧" : "◨"}</button>
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
            <div className="spacer" />
            <button className="tab" title="Toggle inspector panel" onClick={() => setShowRight(!showRight)}>{showRight ? "◨" : "◧"}</button>
          </div>
          <div className="workspace-body">
            {!projectLoaded ? (
              <div style={{ display: "grid", placeItems: "center", height: "100%" }} className="dim">Forging your studio…</div>
            ) : (
              <>
                {tab === "channel-rack" && <ChannelRack />}
                {tab === "piano-roll" && <PianoRoll />}
                {tab === "playlist" && <Playlist />}
                {tab === "audio-editor" && <AudioEditor />}
                {tab === "mixer" && <Mixer />}
                {tab === "instrument" && <InstrumentEditor />}
                {tab === "recording" && <Recording />}
                {tab === "ai-assistant" && <AIAssistant />}
                {tab === "sound-lab" && <SoundLab />}
                {tab === "resources" && <ResourceHub />}
              </>
            )}
          </div>
        </div>
        {showRight && (
          <div className="side-panel right" style={{ width: rightW }}>
            <Inspector />
            <div className="resizer" onPointerDown={resize("r")} />
          </div>
        )}
      </div>

      {paletteOpen && <CommandPalette />}
      <CheatSheet />

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

/** "?" keyboard-shortcut cheat sheet overlay. */
function CheatSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen((o) => !o);
    window.addEventListener("pf-cheatsheet", h);
    return () => window.removeEventListener("pf-cheatsheet", h);
  }, []);
  if (!open) return null;
  const rows: Array<[string, string]> = [
    ["Space", "Play / Pause"], ["Esc", "Cancel edit / close overlay"],
    ["⌘Z / ⌘⇧Z", "Undo / Redo"], ["⌘S / ⌘⇧S", "Save / Save As"],
    ["R", "Record"], ["M", "Metronome"],
    ["⌘A", "Select all (active editor)"], ["⌘D", "Duplicate selection"],
    ["Delete", "Delete selection"], ["P / B", "Pencil / Select tool"],
    ["S", "Split (Playlist)"], ["⌘K", "Command palette"],
    ["+ / -", "Zoom in / out"], ["← → ↑ ↓", "Nudge / transpose selection"],
    ["⇧↑ / ⇧↓", "Transpose octave (Piano Roll)"], ["?", "This cheat sheet"],
  ];
  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="modal" style={{ minWidth: 460 }}>
        <h2>Keyboard Shortcuts</h2>
        {rows.map(([k, d]) => (
          <div key={k} className="row" style={{ justifyContent: "space-between", padding: "3px 0" }}>
            <span className="mono" style={{ color: "var(--cyan)" }}>{k}</span><span className="dim">{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
