/** Settings window: Appearance (theme, accent, glass, scale), Workspace (level + which sections
 * you see), Visuals (live visualizer touches around the studio), Accessibility, About. UI prefs
 * persist to localStorage and apply on load — projects and audio are unaffected. */
import { useEffect, useState, type ReactNode } from "react";
import { useStudio, levelRank, type Tab } from "../state/store";
import { Icon, type IconName } from "./shell/Icons";
import { LevelSwitch, LEVEL_INFO, AI_INFO } from "./shell/Level";
import { NAV, WORKSPACE_PRESETS, useNavCustom, visibleNav } from "./shell/NavRail";
import { SAMPLE_MANIFEST } from "../engine/sampled";
import { useVizPrefs } from "../viz/prefs";
import { Portal } from "./shell/Portal";
import { storageStatus, requestPersistentStorage, lastBackupAt, type StorageStatus } from "../storage/backup";
import { backUpEverything, restoreFromBackup, projectCount } from "./backup-actions";

const isDesktopApp = typeof window !== "undefined" && !!(window as unknown as { pulseforgeDesktop?: { isDesktop?: boolean } }).pulseforgeDesktop?.isDesktop;
function fmtBytes(n: number | null): string {
  if (n === null) return "?";
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Where your projects live, how safe they are, and one-file backups. */
function DataPane() {
  const [st, setSt] = useState<StorageStatus | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { void storageStatus().then(setSt); void lastBackupAt().then(setLast); void projectCount().then(setCount); };
  useEffect(refresh, []);
  const pct = st?.usage != null && st?.quota ? Math.min(100, (st.usage / st.quota) * 100) : 0;
  return (
    <>
      <p className="small dim" style={{ marginTop: 0 }}>
        {isDesktopApp
          ? "Your projects and audio are saved on this Mac, inside PulseForge's own storage. Autosave runs as you work."
          : "Your projects and audio are saved in this browser on this device, never on our servers. Autosave runs as you work. Clearing site data removes them, so keep a backup."}
      </p>
      <div className="data-card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>{count ?? "…"} project{count === 1 ? "" : "s"}</b>
          <span className="small dim">{fmtBytes(st?.usage ?? null)} used{st?.quota ? ` of ${fmtBytes(st.quota)} available` : ""}</span>
        </div>
        <div className="data-meter"><i style={{ width: `${Math.max(pct, 0.6)}%` }} /></div>
        <div className="row small" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <span className={`pill ${st?.persisted ? "ok" : "warn"}`}>{st?.persisted ? "Protected: the browser won't clear it to free space" : st?.persisted === false ? "Best effort: the browser may clear it when space runs low" : "Storage protection unavailable"}</span>
          {st?.persisted === false && <button className="btn small" onClick={async () => { const ok = await requestPersistentStorage(); refresh(); useStudio.getState().toast(ok ? "Protected: your browser will keep your projects" : "The browser declined for now. It usually agrees once you've used the studio a little more. Keep a backup meanwhile", ok ? "success" : "info"); }}>Protect my projects</button>}
        </div>
      </div>
      <h3 className="section">Backups</h3>
      <div className="set-row" style={{ cursor: "default" }}>
        <span className="set-text"><b>Back up everything</b><span>Every project and all of its audio in one <span className="mono">.pfbackup</span> file. Restores in any browser or the Mac app. Last backup: {last ? new Date(last).toLocaleString() : "never"}</span></span>
        <button className="btn primary small" disabled={busy} onClick={async () => { setBusy(true); await backUpEverything(); setBusy(false); refresh(); }}><Icon name="save" size={13} /> Back up</button>
      </div>
      <div className="set-row" style={{ cursor: "default" }}>
        <span className="set-text"><b>Restore from a backup</b><span>Adds missing projects and updates older ones. Anything you've edited more recently is never overwritten.</span></span>
        <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); await restoreFromBackup(); setBusy(false); refresh(); }}>Restore…</button>
      </div>
      <h3 className="section">Export your music</h3>
      <p className="small dim" style={{ margin: 0, lineHeight: 1.55 }}>
        From the project menu ▾ in the top bar: <b>Export…</b> renders a WAV of the song, stems or a selection;
        <b> Export Portable Project</b> saves one project with its audio (<span className="mono">.pfproj</span>); <b>Export Pattern MIDI</b> for other DAWs.
        Samples, loops and bounces you make are in <b>Sounds</b>, ready to drag anywhere.
      </p>
    </>
  );
}

const KEY = "pf_ui_prefs";
const ACCENTS = [
  { name: "Ember", c: "#ff6a3d" },
  { name: "Sky", c: "#4cc2ff" },
  { name: "Violet", c: "#8b6cff" },
  { name: "Mint", c: "#4fe39a" },
  { name: "Rose", c: "#ff6fcf" },
  { name: "Gold", c: "#ffc94d" },
  { name: "Coral", c: "#ff5f6d" },
  { name: "Ice", c: "#9ed8ff" },
];

export const THEMES: { id: string; name: string; blurb: string; swatch: string }[] = [
  { id: "midnight", name: "Midnight", blurb: "Deep blue-black, the signature look", swatch: "linear-gradient(135deg, #0b0d16, #1a1f33)" },
  { id: "graphite", name: "Graphite", blurb: "Neutral studio grey", swatch: "linear-gradient(135deg, #111113, #2a2a2f)" },
  { id: "obsidian", name: "Obsidian", blurb: "True black, for OLED and dark rooms", swatch: "linear-gradient(135deg, #000, #141414)" },
  { id: "aurora", name: "Aurora", blurb: "Teal night with northern-light glow", swatch: "linear-gradient(135deg, #04100f, #10283a)" },
  { id: "dusk", name: "Dusk", blurb: "Warm plum, like a late session", swatch: "linear-gradient(135deg, #120a12, #2b1630)" },
];

interface UiPrefs { accent: string; scale: number; reducedMotion: boolean; compact: boolean; theme: string; glass: boolean }
const DEFAULTS: UiPrefs = { accent: "#ff6a3d", scale: 1, reducedMotion: false, compact: false, theme: "midnight", glass: true };

function hexToSoft(hex: string): string {
  return `${hex}33`; // 20% alpha for the "-soft" glow variables
}

/** Apply prefs to CSS variables + document. Called on load and on every change. */
export function applyUiPrefs(p: UiPrefs): void {
  const root = document.documentElement;
  root.style.setProperty("--ember", p.accent);
  root.style.setProperty("--ember-soft", hexToSoft(p.accent));
  root.dataset.theme = THEMES.some((t) => t.id === p.theme) ? p.theme : "midnight";
  root.classList.toggle("no-glass", !p.glass);
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Call once at startup: restores saved accent/scale/motion before first paint of controls. */
export function initUiPrefs(): void {
  const p = loadUiPrefs();
  applyUiPrefs(p);
  const s = useStudio.getState();
  if (p.scale !== 1) s.setUiScale(p.scale);
  if (p.reducedMotion) s.setFlags({ reducedMotion: true });
}

type Pane = "appearance" | "workspace" | "visuals" | "data" | "access" | "about";
const PANES: { id: Pane; label: string; icon: IconName }[] = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "workspace", label: "Workspace", icon: "grid" },
  { id: "visuals", label: "Visuals", icon: "viz" },
  { id: "access", label: "Accessibility", icon: "eye" },
  { id: "data", label: "Your data", icon: "save" },
  { id: "about", label: "About & credits", icon: "help" },
];

export function SettingsButton() {
  const [open, setOpen] = useState<Pane | null>(null);
  useEffect(() => {
    const h = (e: Event) => setOpen(((e as CustomEvent).detail as Pane) || "appearance");
    window.addEventListener("pf-settings", h);
    return () => window.removeEventListener("pf-settings", h);
  }, []);
  return (
    <>
      <button className="tbtn" title="Settings" aria-label="Settings" onClick={() => setOpen("appearance")}><Icon name="settings" size={15} /></button>
      {open && <Portal><SettingsModal initial={open} onClose={() => setOpen(null)} /></Portal>}
    </>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="set-row">
      <span className="set-text"><b>{label}</b>{hint && <span>{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={on} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>
    </label>
  );
}

function SettingsModal({ onClose, initial }: { onClose: () => void; initial: Pane }) {
  const { uiScale, setUiScale, reducedMotion, setFlags, toast, level, aiEnabled, setAiEnabled } = useStudio();
  const [prefs, setPrefs] = useState<UiPrefs>(() => ({ ...loadUiPrefs(), scale: uiScale, reducedMotion }));
  const [pane, setPane] = useState<Pane>(initial);
  const viz = useVizPrefs();
  const nav = useNavCustom();

  // live-apply + persist on every change
  useEffect(() => {
    applyUiPrefs(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  }, [prefs]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const set = (patch: Partial<UiPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const shown = new Set(visibleNav(level, nav.overrides, aiEnabled).map((n) => n.tab));
  const customized = Object.keys(nav.overrides).length > 0;
  const presetActive = (tabs: Tab[] | null) => tabs === null
    ? !customized
    : customized && NAV.every((n) => n.tab === "home" || (n.ai && !aiEnabled) || shown.has(n.tab) === tabs.includes(n.tab));
  const applyPreset = (tabs: Tab[] | null, name: string) => {
    if (!tabs) nav.apply({});
    else {
      const o: Partial<Record<Tab, "show" | "hide">> = {};
      for (const n of NAV) {
        if (n.tab === "home") continue;
        const byLevel = levelRank(level) >= levelRank(n.min);
        const want = tabs.includes(n.tab);
        if (want && !byLevel) o[n.tab] = "show";
        if (!want && byLevel) o[n.tab] = "hide";
      }
      nav.apply(o);
    }
    toast(`Workspace: ${name}`, "success");
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-window" role="dialog" aria-label="Settings">
        <aside className="settings-side">
          <div className="settings-title">Settings</div>
          {PANES.map((p) => (
            <button key={p.id} className={`settings-tab ${pane === p.id ? "on" : ""}`} onClick={() => setPane(p.id)}>
              <span className="ico"><Icon name={p.icon} size={15} /></span>{p.label}
            </button>
          ))}
        </aside>
        <section className="settings-body">
          <div className="row" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{PANES.find((p) => p.id === pane)!.label}</h2>
            <div className="spacer" />
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          </div>

          {pane === "appearance" && (
            <>
              <h3 className="section">Theme</h3>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button key={t.id} className={`theme-card ${prefs.theme === t.id ? "on" : ""}`} onClick={() => set({ theme: t.id })} aria-pressed={prefs.theme === t.id}>
                    <i style={{ background: t.swatch }}><em style={{ background: prefs.accent }} /></i>
                    <b>{t.name}</b><span>{t.blurb}</span>
                  </button>
                ))}
              </div>
              <h3 className="section">Accent</h3>
              <div className="accent-row">
                {ACCENTS.map((a) => (
                  <button key={a.c} className={`accent-dot ${prefs.accent.toLowerCase() === a.c ? "on" : ""}`} title={a.name} aria-label={a.name}
                    style={{ background: a.c }} onClick={() => set({ accent: a.c })} />
                ))}
                <label className="accent-dot custom" title="Custom accent colour">
                  <input type="color" value={prefs.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Custom accent" />
                </label>
              </div>
              <h3 className="section">Surfaces</h3>
              <Toggle on={prefs.glass} onChange={(glass) => set({ glass })} label="Glass" hint="Translucent, blurred bars and panels with the ambient light behind them" />
              <div className="set-row">
                <span className="set-text"><b>Interface size</b><span>Scale everything up or down</span></span>
                <span className="row" style={{ gap: 8 }}>
                  <input type="range" min={0.7} max={1.3} step={0.05} value={prefs.scale} style={{ width: 150 }}
                    onChange={(e) => { const scale = Number(e.target.value); set({ scale }); setUiScale(scale); }} />
                  <span className="mono small dim" style={{ width: 38, textAlign: "right" }}>{Math.round(prefs.scale * 100)}%</span>
                </span>
              </div>
            </>
          )}

          {pane === "workspace" && (
            <>
              <h3 className="section">AI features</h3>
              <Toggle on={aiEnabled} onChange={(v) => setAiEnabled(v)} label={aiEnabled ? "AI is on" : "AI is off: pure production mode"}
                hint={aiEnabled ? AI_INFO.on : AI_INFO.off} />
              <h3 className="section">Experience level</h3>
              <LevelSwitch />
              <p className="small dim" style={{ margin: "8px 0 0" }}>{LEVEL_INFO[level].blurb} Levels change how much is shown at once, never what the studio can do.</p>
              <h3 className="section">Your sections</h3>
              <div className="preset-grid">
                {WORKSPACE_PRESETS.map((p) => (
                  <button key={p.id} className={`preset-card ${presetActive(p.tabs) ? "on" : ""}`} onClick={() => applyPreset(p.tabs, p.name)}>
                    <Icon name={p.icon} size={18} /><b>{p.name}</b><span>{p.blurb}</span>
                  </button>
                ))}
              </div>
              <div className="section-list">
                {NAV.filter((n) => n.tab !== "home" && (aiEnabled || !n.ai)).map((n) => {
                  const on = shown.has(n.tab);
                  const byLevel = levelRank(level) >= levelRank(n.min);
                  return (
                    <label key={n.tab} className="set-row compact">
                      <span className="sec-line">
                        <span className="sec-ico"><Icon name={n.icon} size={15} /></span>
                        <span className="set-text"><b>{n.label}{!byLevel && <em className="lvl-tag">{LEVEL_INFO[n.min].label}</em>}</b><span>{n.hint}</span></span>
                      </span>
                      <button type="button" role="switch" aria-checked={on} className={`switch ${on ? "on" : ""}`}
                        onClick={() => nav.set(n.tab, on ? (byLevel ? "hide" : null) : (byLevel ? null : "show"))}><i /></button>
                    </label>
                  );
                })}
              </div>
              <p className="small faint">Hidden sections are still one <span className="kbd">⌘K</span> away. Nothing is ever removed.</p>
            </>
          )}

          {pane === "visuals" && (
            <>
              <p className="small dim" style={{ marginTop: 0 }}>The visualizer reacts to your song itself: kicks, snares and hats come straight from your patterns, colours from its key. These are the touches around the studio.</p>
              <Toggle on={viz.lcd} onChange={(lcd) => viz.set({ lcd })} label="Live display in the top bar" hint="A spectrum and beat dots behind the position readout" />
              <Toggle on={viz.ambient} onChange={(ambient) => viz.set({ ambient })} label="Ambient glow" hint="The light behind the glass breathes with your kick and bass" />
              <Toggle on={viz.backdrop} onChange={(backdrop) => viz.set({ backdrop })} label="Live Home backdrop" hint="A visualizer scene behind the Home page's prompt" />
              <Toggle on={viz.signals} onChange={(signals) => viz.set({ signals })} label="Show what it hears" hint="Kick, snare, hats, bass, chords and lead lights on the Visualizer" />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={() => { useStudio.getState().setTab("visualizer"); onClose(); }}><Icon name="viz" size={15} /> Open the Visualizer</button>
              </div>
            </>
          )}

          {pane === "access" && (
            <>
              <Toggle on={prefs.reducedMotion} onChange={(v) => { set({ reducedMotion: v }); setFlags({ reducedMotion: v }); }}
                label="Reduce motion" hint="Turns off animations, the ambient glow and live backdrops. The Visualizer still runs when you open it" />
              <Toggle on={!prefs.glass} onChange={(v) => set({ glass: !v })} label="Reduce transparency" hint="Solid bars and panels instead of glass" />
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn" onClick={() => {
                  setPrefs(DEFAULTS); setUiScale(1); setFlags({ reducedMotion: false });
                  applyUiPrefs(DEFAULTS);
                  toast("Interface reset to defaults");
                }}>Reset appearance</button>
              </div>
              <p className="faint small" style={{ marginTop: 10 }}>Interface preferences are saved on this device and don't affect your projects or audio.</p>
            </>
          )}

          {pane === "data" && <DataPane />}

          {pane === "about" && (
            <>
              <p className="small dim" style={{ marginTop: 0 }}>PulseForge Studio 2.0: a local-first studio with an AI producer. Your projects and audio stay on this device.</p>
              <h3 className="section">Sound credits</h3>
              <div className="small dim" style={{ lineHeight: 1.6 }}>
                {[...new Map(SAMPLE_MANIFEST.instruments.map((i) => [i.attribution, i])).values()].map((i) => (
                  <p key={i.id} style={{ margin: "0 0 6px" }}>{i.attribution}</p>
                ))}
                <p style={{ margin: 0 }}>Drum kits, synths and factory one-shots are original synthesis made for PulseForge. Everything you make with these sounds is yours.</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
