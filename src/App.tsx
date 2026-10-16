/** PulseForge Studio 2.0 shell: top bar · level-aware nav rail · pages · side panels · status bar. */
import { useEffect, useState } from "react";
import { useStudio, startTransportLoop, levelRank, type Tab } from "./state/store";
import { TransportBar } from "./ui/TransportBar";
import { Browser } from "./ui/Browser";
import { Inspector } from "./ui/Inspector";
import { PianoRoll } from "./ui/PianoRoll";
import { Playlist } from "./ui/Playlist";
import { AudioEditor } from "./ui/AudioEditor";
import { InstrumentEditor } from "./ui/InstrumentEditor";
import { AIAssistant } from "./ui/AIAssistant";
import { SoundLab } from "./ui/SoundLab";
import { Recording } from "./ui/Recording";
import { ResourceHub } from "./ui/ResourceHub";
import { CommandPalette } from "./ui/CommandPalette";
import { NavRail, visibleNav, levelNav, useNavCustom } from "./ui/shell/NavRail";
import { AmbientGlow } from "./ui/viz/LiveVisuals";
import { Icon } from "./ui/shell/Icons";
import { PageFrame, StatusBar, Onboarding, HelpSheet } from "./ui/shell/Chrome";
import { Home } from "./ui/pages/Home";
import { Producer } from "./ui/pages/Producer";
import { Connections } from "./ui/pages/Connections";
import { BeatPage } from "./ui/pages/Beat";
import { MixPage } from "./ui/pages/Mix";
import { ProgressionPicker } from "./ui/ProgressionPicker";
import { SongTools } from "./ui/pages/SongTools";
import { VisualizerPage } from "./ui/pages/Visualizer";
import { installKeyboardShortcuts } from "./keyboard";
import { setHost, StandaloneHostAdapter } from "./host/adapter";
import { initUiPrefs } from "./ui/Settings";
import { recentProjects, loadProjectWithRecovery, saveProject, PROJECT_TEMPLATES } from "./storage/projects";
import { ensureProjectAssetsLoaded } from "./audio/assets";
import { engine } from "./engine/engine";
import { completeOpenRouterBrowserOAuth } from "./ai/oauth-client";

/** Pages that use the full width (no browser/inspector side panels). */
const FULL_WIDTH: Tab[] = ["home", "producer", "connections", "library", "resources", "visualizer"];
const isDesktop = typeof window !== "undefined" && !!(window as unknown as { pulseforgeDesktop?: { isDesktop?: boolean } }).pulseforgeDesktop?.isDesktop;

function Library() {
  const level = useStudio((s) => s.level);
  return (
    <PageFrame title="Sounds" icon="library" sub="22 drum kits, 100+ instruments, factory one-shots, your imports and sound packs"
      tip={<>Click <b>+rack</b> on any sound to add it to your beat, drag samples onto Song lanes, or star favorites. Use <b>+ zip</b> / <b>+ folder</b> to import packs.</>}>
      <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
        <div className="side-panel" style={{ width: levelRank(level) >= 1 ? 420 : "100%", maxWidth: "100%" }}><Browser /></div>
        {levelRank(level) >= 1 && <div style={{ flex: 1, minWidth: 0 }}><ResourceHub /></div>}
      </div>
    </PageFrame>
  );
}

/** Melody opens on a melodic part that has notes (the Beat page leaves a drum channel selected,
 * and an empty piano roll reads as "nothing here"). Prefers the Melody/lead part. Mount only. */
function MelodyPage() {
  useEffect(() => {
    const st = useStudio.getState();
    const p = st.project;
    const melodic = new Map(p.channels.filter((c) => c.instrument.type !== "drum-sound").map((c) => [c.id, c.name]));
    const cur = p.patterns.find((x) => x.id === st.selection.patternId);
    const ch = st.selection.channelId;
    if (cur && ch && melodic.has(ch) && (cur.notes[ch]?.length ?? 0) > 0) return;
    let best: { patternId: string; channelId: string } | null = null;
    let score = 0;
    for (const pt of p.patterns) {
      for (const [cid, notes] of Object.entries(pt.notes)) {
        if (!melodic.has(cid) || !notes.length) continue;
        const sc = notes.length + (/melody|lead/i.test(`${pt.name} ${melodic.get(cid) ?? ""}`) ? 10_000 : 0);
        if (sc > score) { score = sc; best = { patternId: pt.id, channelId: cid }; }
      }
    }
    if (best) st.select(best);
    else if (!ch || !melodic.has(ch)) { const first = [...melodic.keys()][0]; if (first) st.select({ channelId: first }); }
  }, []);
  const [progOpen, setProgOpen] = useState(false);
  return (
    <PageFrame title="Melody" icon="keys" sub="Piano roll" tip={<>Click the grid to add notes, drag to move, drag a note's right edge to lengthen, right-click to delete. Stuck? <b>Chord progressions</b> writes a whole progression in your key.</>}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="row" style={{ padding: "6px 12px 0" }}>
          <button className="btn small primary" onClick={() => setProgOpen(true)}><Icon name="keys" size={14} /> Chord progressions</button>
          <span className="small faint">~50 progressions by mood, spelled in your key</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}><PianoRoll /></div>
      </div>
      {progOpen && <ProgressionPicker onClose={() => setProgOpen(false)} />}
    </PageFrame>
  );
}

function renderTab(tab: Tab) {
  switch (tab) {
    case "home": return <Home />;
    case "producer": return <Producer />;
    case "connections": return <Connections />;
    case "library": return <Library />;
    case "channel-rack": return <BeatPage />;
    case "mixer": return <MixPage />;
    case "piano-roll": return <MelodyPage />;
    case "playlist": return (
      <PageFrame title="Song" icon="song" sub="Arrangement" tip={<>This is your whole song. Got a loop? <b>Song blueprint</b> turns it into a full arrangement. Drag clips to move them, drag their edges to trim, double-click an empty lane to place the selected pattern.</>}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <SongTools />
          <div style={{ flex: 1, minHeight: 0 }}><Playlist /></div>
        </div>
      </PageFrame>
    );
    case "recording": return (
      <PageFrame title="Record" icon="mic" sub="Vocals & instruments" tip={<>Wear headphones to avoid feedback, pick your microphone, then press Record. Each take lands on a track you can trim, tune (PulseTune) and mix.</>}>
        <Recording />
      </PageFrame>
    );
    case "instrument": return <PageFrame title="Instrument" icon="knob" sub="Sound design for the selected channel"><InstrumentEditor /></PageFrame>;
    case "audio-editor": return (
      <PageFrame title="Sample" icon="wave" sub="Chop & screw · flip · fit to your beat · slice, tune, stretch"
        tip={<>Get a sound (import, a free <b>starter loop</b>, or describe one), drag on the waveform to select a part, then <b>Screw</b>, <b>Chop</b> or give it a vintage sampler sound. <b>Chop to pads</b> turns it into playable pads with a pattern.</>}>
        <AudioEditor />
      </PageFrame>
    );
    case "ai-assistant": return <PageFrame title="AI Chat" icon="chat" sub="Compose, edit and mix by chatting. Every change is previewed and undoable"><AIAssistant /></PageFrame>;
    case "sound-lab": return <PageFrame title="Sound Lab" icon="flask" sub="Generate sounds, music & voice with audio AI providers · stem extractor"><SoundLab /></PageFrame>;
    case "visualizer": return <VisualizerPage />;
    case "resources": return <PageFrame title="Resources" icon="globe" sub="Sample-pack sites & pack importer"><ResourceHub /></PageFrame>;
  }
}

export function App() {
  const { tab, setTab, toasts, dismissToast, projectLoaded, setProject, toast, paletteOpen, reducedMotion, uiScale, level } = useStudio();
  const [leftW, setLeftW] = useState(250);
  const [rightW, setRightW] = useState(260);
  const [showLeft, setShowLeft] = useState(level === "expert");
  const [showRight, setShowRight] = useState(level === "expert");
  const [started, setStarted] = useState(false);

  // side panels follow the level's defaults whenever the level changes
  useEffect(() => { setShowLeft(level === "expert"); setShowRight(level === "expert"); }, [level]);

  // if a page isn't available at the current level (and isn't pinned), fall back to Home.
  // Sections hidden with Customize stay reachable (⌘K), so they don't bounce.
  const overrides = useNavCustom((s) => s.overrides);
  useEffect(() => {
    if (!levelNav(level).some((n) => n.tab === tab) && overrides[tab] !== "show") setTab("home");
  }, [level, tab, setTab, overrides]);

  useEffect(() => {
    setHost(new StandaloneHostAdapter((n) => useStudio.getState().toast(`${n.title}${n.body ? ` — ${n.body}` : ""}`, n.kind ?? "info")));
    initUiPrefs();
    startTransportLoop();
    const uninstall = installKeyboardShortcuts();
    void completeOpenRouterBrowserOAuth().then((r) => {
      if (r === "connected") { toast("OpenRouter connected. Your AI Producer can use it now", "success"); setTab("connections"); }
      if (r === "failed") toast("OpenRouter sign-in didn't complete. Please try again", "error");
    });
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
        setProject(PROJECT_TEMPLATES[0]!.create());
      }
    })();
    return uninstall;
  }, [setProject, toast, setTab]);

  // audio context needs a user gesture — arm on first interaction
  useEffect(() => {
    if (started) return;
    const arm = async () => { await engine.init(); setStarted(true); };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => { window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm); };
  }, [started]);

  // Beginner: the play mode follows the page, so Play does what the page suggests
  // (Song plays the arrangement; Beat/Melody loop the pattern being edited). Other levels: manual.
  useEffect(() => {
    if (level !== "beginner") return;
    const st = useStudio.getState();
    if (tab === "playlist" && st.playMode !== "song") st.setPlayMode("song");
    if ((tab === "channel-rack" || tab === "piano-roll") && st.playMode !== "pattern") st.setPlayMode("pattern");
  }, [tab, level]);

  // ⌥1…⌥9 jump between the sections visible at this level
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const n = Number(e.code.replace("Digit", ""));
      if (!(n >= 1 && n <= 9)) return;
      const item = visibleNav(useStudio.getState().level)[n - 1];
      if (item) { e.preventDefault(); setTab(item.tab); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  const resize = (side: "l" | "r") => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "l" ? leftW : rightW;
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - startX;
      if (side === "l") setLeftW(Math.max(180, Math.min(440, startW + d)));
      else setRightW(Math.max(200, Math.min(460, startW - d)));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const fullWidth = FULL_WIDTH.includes(tab);
  const panelsAllowed = level !== "beginner" && !fullWidth;

  return (
    <div className={`app lvl-${level} ${reducedMotion ? "reduced-motion" : ""} ${isDesktop ? "desktop" : ""} tab-${tab}`} style={{ zoom: uiScale }}>
      <AmbientGlow />
      <TransportBar />
      <div className="main-row">
        <NavRail onHelp={() => window.dispatchEvent(new CustomEvent("pf-cheatsheet"))} />
        {panelsAllowed && showLeft && (
          <aside className="side-panel" style={{ width: leftW }}>
            <Browser />
            <div className="resizer" onPointerDown={resize("l")} />
          </aside>
        )}
        <main className="workspace">
          <div className="workspace-body">
            {!projectLoaded
              ? <div className="empty" style={{ height: "100%" }}><span className="dim">Forging your studio…</span></div>
              : <div className="page-anim" key={tab}>{renderTab(tab)}</div>}
          </div>
        </main>
        {panelsAllowed && showRight && (
          <aside className="side-panel right" style={{ width: rightW }}>
            <Inspector />
            <div className="resizer" onPointerDown={resize("r")} />
          </aside>
        )}
      </div>
      <StatusBar showLeft={showLeft} showRight={showRight} toggleLeft={() => setShowLeft((v) => !v)} toggleRight={() => setShowRight((v) => !v)} />

      {paletteOpen && <CommandPalette />}
      <HelpSheet />
      <Onboarding />

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>)}
      </div>
    </div>
  );
}
