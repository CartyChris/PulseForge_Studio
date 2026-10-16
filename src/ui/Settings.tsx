/** Settings modal: interface customization (accent color, scale, reduced motion,
 * compact mode). UI prefs persist to localStorage and apply on load — projects and
 * audio are unaffected. */
import { useEffect, useState } from "react";
import { useStudio } from "../state/store";
import { Icon } from "./shell/Icons";
import { LevelSwitch } from "./shell/Level";
import { SAMPLE_MANIFEST } from "../engine/sampled";

const KEY = "pf_ui_prefs";
const ACCENTS = [
  { name: "Ember", c: "#e8663c" },
  { name: "Cyan", c: "#4cc2ff" },
  { name: "Violet", c: "#7b6cff" },
  { name: "Mint", c: "#8ef58a" },
  { name: "Rose", c: "#ff7bd5" },
  { name: "Gold", c: "#ffd166" },
];

interface UiPrefs { accent: string; scale: number; reducedMotion: boolean; compact: boolean }
const DEFAULTS: UiPrefs = { accent: "#e8663c", scale: 1, reducedMotion: false, compact: false };

function hexToSoft(hex: string): string {
  return `${hex}33`; // 20% alpha for the "-soft" glow variables
}

/** Apply prefs to CSS variables + document. Called on load and on every change. */
export function applyUiPrefs(p: UiPrefs): void {
  const root = document.documentElement;
  root.style.setProperty("--ember", p.accent);
  root.style.setProperty("--ember-soft", hexToSoft(p.accent));
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

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="tbtn" title="Settings" aria-label="Settings" onClick={() => setOpen(true)}><Icon name="settings" size={15} /></button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { uiScale, setUiScale, reducedMotion, setFlags, toast } = useStudio();
  const [prefs, setPrefs] = useState<UiPrefs>(() => ({ ...loadUiPrefs(), scale: uiScale, reducedMotion }));

  // live-apply + persist on every change
  useEffect(() => {
    applyUiPrefs(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  }, [prefs]);

  const set = (patch: Partial<UiPrefs>) => setPrefs((p) => ({ ...p, ...patch }));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ minWidth: 440 }}>
        <h2>Settings</h2>

        <h3 className="section">Experience level</h3>
        <LevelSwitch />
        <p className="small dim" style={{ margin: "6px 0 0" }}>Beginner shows the essentials, Intermediate every page with tidy toolbars, Expert everything at once. Nothing is ever removed.</p>

        <h3 className="section">Accent color</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {ACCENTS.map((a) => (
            <button key={a.c} className="btn small" title={a.name}
              style={{ background: a.c, color: "#14100e", borderColor: prefs.accent === a.c ? "#fff" : a.c, fontWeight: 700 }}
              onClick={() => set({ accent: a.c })}>{a.name}</button>
          ))}
          <label className="row small dim" title="Custom accent color">
            Custom
            <input type="color" value={prefs.accent} onChange={(e) => set({ accent: e.target.value })}
              style={{ width: 32, height: 26, border: "none", background: "none", cursor: "pointer" }} />
          </label>
        </div>

        <h3 className="section">Interface scale</h3>
        <div className="knob-row">
          <label>Scale</label>
          <input type="range" min={0.7} max={1.3} step={0.05} value={prefs.scale}
            onChange={(e) => { const scale = Number(e.target.value); set({ scale }); setUiScale(scale); }} />
          <span className="val">{Math.round(prefs.scale * 100)}%</span>
        </div>

        <h3 className="section">Accessibility & layout</h3>
        <label className="row small" style={{ padding: "4px 0" }}>
          <input type="checkbox" checked={prefs.reducedMotion}
            onChange={(e) => { set({ reducedMotion: e.target.checked }); setFlags({ reducedMotion: e.target.checked }); }} />
          Reduced motion (disable animations & meter transitions)
        </label>

        <div className="row end" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => {
            setPrefs(DEFAULTS); setUiScale(1); setFlags({ reducedMotion: false });
            applyUiPrefs(DEFAULTS);
            toast("Interface reset to defaults");
          }}>Reset</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
        <p className="faint small" style={{ marginTop: 10 }}>Interface preferences are saved on this device and don't affect your projects or audio.</p>

        <h3 className="section">Sound credits</h3>
        <div className="small dim" style={{ lineHeight: 1.6 }}>
          {[...new Map(SAMPLE_MANIFEST.instruments.map((i) => [i.attribution, i])).values()].map((i) => (
            <p key={i.id} style={{ margin: "0 0 6px" }}>{i.attribution}</p>
          ))}
          <p style={{ margin: 0 }}>Drum kits, synths and factory one-shots are original synthesis made for PulseForge. Everything you make with these sounds is yours.</p>
        </div>
      </div>
    </div>
  );
}
