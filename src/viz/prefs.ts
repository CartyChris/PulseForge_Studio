/** Visualizer + appearance preferences (per device, localStorage). Projects are unaffected. */
import { create } from "zustand";
import { DEFAULT_VIZ_SETTINGS, type VizSettings } from "./renderer";
import { SCENES } from "./scenes";

export interface VizPrefs {
  scene: string;
  auto: boolean;
  settings: VizSettings;
  /** live LCD spectrum in the top bar */
  lcd: boolean;
  /** live visual behind the Home hero */
  backdrop: boolean;
  /** the app's ambient glow breathes with the beat */
  ambient: boolean;
  /** show the "what it hears" signal panel on the Visualizer */
  signals: boolean;
}

const KEY = "pf_viz_prefs";
const DEFAULTS: VizPrefs = { scene: "flow", auto: false, settings: DEFAULT_VIZ_SETTINGS, lcd: true, backdrop: true, ambient: true, signals: true };

function load(): VizPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<VizPrefs>;
    const scene = SCENES.some((s) => s.id === v.scene) ? v.scene! : DEFAULTS.scene;
    return { ...DEFAULTS, ...v, scene, settings: { ...DEFAULT_VIZ_SETTINGS, ...(v.settings ?? {}) } };
  } catch { return DEFAULTS; }
}

export const useVizPrefs = create<VizPrefs & { set(patch: Partial<VizPrefs>): void; setSettings(patch: Partial<VizSettings>): void }>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch);
    persist(get());
  },
  setSettings(patch) {
    set({ settings: { ...get().settings, ...patch } });
    persist(get());
  },
}));

function persist(p: VizPrefs): void {
  try {
    const { scene, auto, settings, lcd, backdrop, ambient, signals } = p;
    localStorage.setItem(KEY, JSON.stringify({ scene, auto, settings, lcd, backdrop, ambient, signals }));
  } catch {}
}
