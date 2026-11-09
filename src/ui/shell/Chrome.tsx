/** Shell chrome: page frame (title + coach tip), status bar, first-run onboarding, help sheet. */
import { useEffect, useState, type ReactNode } from "react";
import { useStudio, type Level } from "../../state/store";
import { useProducer } from "../../ai/useProducer";
import { Icon, BrandMark, type IconName } from "./Icons";
import { Coach, LEVEL_INFO, atLeast } from "./Level";
import { NAV, visibleNav } from "./NavRail";

export function PageFrame({ title, icon, sub, tipTitle, tip, children }: { title: string; icon: IconName; sub?: string; tipTitle?: string; tip?: ReactNode; children: ReactNode }) {
  return (
    <div className="page-fill">
      <div className="page-bar" style={{ minHeight: 44, padding: "6px 16px" }}>
        <h1 style={{ fontSize: 15 }}><Icon name={icon} /> {title}</h1>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {tip && <Coach id={`page-${title.toLowerCase()}`} title={tipTitle ?? "Tip:"}>{tip}</Coach>}
      <div className="fill">{children}</div>
    </div>
  );
}

export function StatusBar({ showLeft, showRight, toggleLeft, toggleRight }: { showLeft: boolean; showRight: boolean; toggleLeft: () => void; toggleRight: () => void }) {
  const { tab, project, level, dirty, lastSavedAt, playMode } = useStudio();
  const brain = useProducer((s) => s.resolvedProvider());
  const aiEnabled = useStudio((s) => s.aiEnabled);
  const hint = NAV.find((n) => n.tab === tab)?.hint ?? "";
  return (
    <footer className="statusbar">
      {atLeast(level, "intermediate") && (
        <>
          <button className={`btn small ghost ${showLeft ? "on" : ""}`} onClick={toggleLeft} title="Show/hide the sound browser panel"><Icon name="panelLeft" size={13} /> Browser</button>
          <button className={`btn small ghost ${showRight ? "on" : ""}`} onClick={toggleRight} title="Show/hide the inspector panel"><Icon name="panelRight" size={13} /> Inspector</button>
        </>
      )}
      <span className="hint">{hint}</span>
      <span><b>{project.name}</b> · {project.bpm} BPM · {project.key} {project.scale} · {playMode === "song" ? "Song" : "Pattern"} mode</span>
      {aiEnabled
        ? <span title="Who the AI Producer uses"><Icon name="sparkles" size={11} /> {brain?.name ?? "Offline producer"}</span>
        : <span title="AI features are off (top bar or Settings → Workspace)">AI off</span>}
      <span>{dirty ? "● unsaved (autosaves)" : `✓ saved${lastSavedAt ? ` ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`}</span>
      <span>{LEVEL_INFO[level].label}</span>
    </footer>
  );
}

export function Onboarding() {
  const { needsOnboarding, finishOnboarding, setTab, aiEnabled, setAiEnabled } = useStudio();
  const [pick, setPick] = useState<Level>("beginner");
  if (!needsOnboarding) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal onboard" role="dialog" aria-labelledby="pf-welcome">
        <div className="row"><BrandMark size={40} /><div><div className="faint small">PulseForge Studio 2.0</div><h1 id="pf-welcome">Welcome. Let's make some music.</h1></div></div>
        <p className="dim">How much of the studio do you want to see, and do you want AI? You can change both any time from the top bar. Nothing is ever taken away, it's just tidied up.</p>
        <div className="level-cards">
          {(Object.keys(LEVEL_INFO) as Level[]).map((l) => (
            <button key={l} className={`level-card ${pick === l ? "on" : ""}`} onClick={() => setPick(l)} aria-pressed={pick === l}>
              <Icon name={LEVEL_INFO[l].icon} size={26} />
              <b>{LEVEL_INFO[l].label}</b>
              <span>{LEVEL_INFO[l].blurb}</span>
            </button>
          ))}
        </div>
        <div className="onboard-ai" role="radiogroup" aria-label="AI features">
          <button role="radio" aria-checked={aiEnabled} className={`level-card ${aiEnabled ? "on" : ""}`} onClick={() => setAiEnabled(true)}>
            <Icon name="sparkles" size={22} /><b>With AI</b><span>The AI Producer turns a sentence into a finished beat, plus AI Chat and AI sounds.</span>
          </button>
          <button role="radio" aria-checked={!aiEnabled} className={`level-card ${!aiEnabled ? "on" : ""}`} onClick={() => setAiEnabled(false)}>
            <Icon name="pads" size={22} /><b>Studio only</b><span>A pure beat-making and production app: pads, steps, piano roll, sampling, arrangement, mixer. No AI anywhere.</span>
          </button>
        </div>
        <ul className="small dim" style={{ lineHeight: 1.7, paddingLeft: 18 }}>
          {aiEnabled && <li><b>AI Producer</b>: describe a beat and get a finished, mixed song. Works offline, and better with your AI subscriptions connected.</li>}
          <li><b>Beat · Melody · Song · Mix</b>: build everything by hand, FL-style, with 22 drum kits and 100+ instruments.</li>
        </ul>
        <div className="row end">
          {aiEnabled && <button className="btn" onClick={() => { finishOnboarding(pick); setTab("connections"); }}><Icon name="plug" size={14} /> Connect my AI first</button>}
          <button className="btn primary big" onClick={() => { finishOnboarding(pick); setTab("home"); }}>Let's go <Icon name="chevron" size={16} /></button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / Pause"], ["Esc", "Cancel / close"], ["⌘Z / ⌘⇧Z", "Undo / Redo"], ["⌘S / ⌘⇧S", "Save / Save As"],
  ["⌘K", "Command palette (search every action)"], ["⌥1 … ⌥9", "Jump to section"], ["1 … 8", "Play drum pads (Beat page)"],
  ["R", "Record"], ["M", "Metronome"], ["⌘A", "Select all"], ["⌘D", "Duplicate"], ["Delete", "Delete selection"],
  ["P / B", "Pencil / Select tool"], ["S", "Split (Song)"], ["+ / −", "Zoom"], ["← → ↑ ↓", "Nudge / transpose"], ["⇧↑ / ⇧↓", "Octave (Melody)"],
  ["← / →", "Previous / next scene (Visualizer)"], ["F · H · A", "Full screen · hide controls · Auto scenes (Visualizer)"], ["?", "This help"],
];

export function HelpSheet() {
  const [open, setOpen] = useState(false);
  const level = useStudio((s) => s.level);
  useEffect(() => {
    const h = () => setOpen((o) => !o);
    window.addEventListener("pf-cheatsheet", h);
    return () => window.removeEventListener("pf-cheatsheet", h);
  }, []);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal" style={{ minWidth: 560 }}>
        <div className="row"><h2 style={{ margin: 0 }}>Help & shortcuts</h2><div className="spacer" /><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Icon name="close" /></button></div>
        <h3 className="section">Where things are</h3>
        <div className="grid two" style={{ gap: 6 }}>
          {visibleNav(level).map((n, i) => (
            <div key={n.tab} className="row small" style={{ alignItems: "flex-start" }}>
              <span className="kbd">⌥{i + 1 <= 9 ? i + 1 : "·"}</span><Icon name={n.icon} size={15} /><span><b>{n.label}</b> <span className="dim">{n.hint}</span></span>
            </div>
          ))}
        </div>
        <h3 className="section">Keyboard</h3>
        <div className="grid two" style={{ gap: 4 }}>
          {SHORTCUTS.map(([k, d]) => <div key={k} className="row small" style={{ justifyContent: "space-between" }}><span className="kbd">{k}</span><span className="dim">{d}</span></div>)}
        </div>
        <p className="small faint">Tips were dismissed? <button className="btn small ghost" onClick={() => { Object.keys(localStorage).filter((k) => k.startsWith("pf_coach_")).forEach((k) => localStorage.removeItem(k)); location.reload(); }}>Show all tips again</button></p>
      </div>
    </div>
  );
}
