/** Left navigation rail — what you see depends on your experience level (KISS for beginners),
 * and anyone can pin or hide sections on top of that ("Customize"), from a four-page beat
 * station to the full studio. Hidden sections stay one ⌘K away; nothing is ever removed. */
import { create } from "zustand";
import { useStudio, type Tab, type Level, levelRank } from "../../state/store";
import { Icon, type IconName } from "./Icons";

export interface NavItem { tab: Tab; label: string; icon: IconName; min: Level; group: string; hint: string; hero?: boolean; /** hidden while AI features are off */ ai?: boolean }

export const NAV: NavItem[] = [
  { tab: "home", label: "Home", icon: "home", min: "beginner", group: "Create", hint: "Start here: make a beat, open a project, learn the basics" },
  { tab: "producer", label: "AI Producer", icon: "sparkles", min: "beginner", group: "Create", hint: "Describe a beat — get a finished, mixed arrangement", hero: true, ai: true },
  { tab: "channel-rack", label: "Beat", icon: "pads", min: "beginner", group: "Create", hint: "Drum pads & step sequencer" },
  { tab: "audio-editor", label: "Sample", icon: "wave", min: "beginner", group: "Create", hint: "Chop & screw, flip samples, make loops from a prompt" },
  { tab: "piano-roll", label: "Melody", icon: "keys", min: "beginner", group: "Create", hint: "Draw notes, chords and melodies" },
  { tab: "instrument", label: "Instrument", icon: "knob", min: "intermediate", group: "Create", hint: "Sound-design the selected instrument" },
  { tab: "playlist", label: "Song", icon: "song", min: "beginner", group: "Arrange", hint: "Arrange patterns and audio into a full song" },
  { tab: "recording", label: "Record", icon: "mic", min: "beginner", group: "Arrange", hint: "Record vocals or instruments" },
  { tab: "mixer", label: "Mix", icon: "mixer", min: "beginner", group: "Mix", hint: "Levels, effects and the master chain" },
  { tab: "visualizer", label: "Visualizer", icon: "viz", min: "beginner", group: "Mix", hint: "A song-aware light show: 10 interactive scenes, full screen, record a video" },
  { tab: "library", label: "Sounds", icon: "library", min: "beginner", group: "Sounds", hint: "Kits, instruments, samples & sound packs" },
  { tab: "sound-lab", label: "Sound Lab", icon: "flask", min: "intermediate", group: "Sounds", hint: "Generate sounds with AI audio providers, split stems", ai: true },
  { tab: "ai-assistant", label: "AI Chat", icon: "chat", min: "intermediate", group: "Sounds", hint: "Chat with AI to compose, edit and mix", ai: true },
  { tab: "connections", label: "Connect", icon: "plug", min: "beginner", group: "Setup", hint: "Connect your AI subscriptions, local models & API keys", ai: true },
  { tab: "resources", label: "Resources", icon: "globe", min: "expert", group: "Setup", hint: "Sample-pack sites & the pack importer" },
];

/** Per-device section overrides on top of the level: pinned (shown at any level) or hidden. */
type Override = "show" | "hide";
const NAV_KEY = "pf_nav_custom";
function loadOverrides(): Partial<Record<Tab, Override>> {
  try { return JSON.parse(localStorage.getItem(NAV_KEY) ?? "{}") as Partial<Record<Tab, Override>>; } catch { return {}; }
}
export const useNavCustom = create<{ overrides: Partial<Record<Tab, Override>>; set(tab: Tab, v: Override | null): void; apply(o: Partial<Record<Tab, Override>>): void }>((set, get) => ({
  overrides: loadOverrides(),
  set(tab, v) {
    const o = { ...get().overrides };
    if (v === null) delete o[tab]; else o[tab] = v;
    set({ overrides: o });
    try { localStorage.setItem(NAV_KEY, JSON.stringify(o)); } catch {}
  },
  apply(o) {
    set({ overrides: o });
    try { localStorage.setItem(NAV_KEY, JSON.stringify(o)); } catch {}
  },
}));

export interface WorkspacePreset { id: string; name: string; blurb: string; icon: IconName; tabs: Tab[] | null }
export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  { id: "level", name: "Match my level", blurb: "Exactly what your experience level shows", icon: "sliders", tabs: null },
  { id: "minimal", name: "Just make beats", blurb: "AI Producer, Beat, Song and the Visualizer. Nothing else", icon: "seedling", tabs: ["home", "producer", "channel-rack", "playlist", "visualizer"] },
  { id: "beatmaker", name: "Beat maker", blurb: "Drums, sampling, arranging, mixing and sounds", icon: "pads", tabs: ["home", "producer", "channel-rack", "audio-editor", "playlist", "mixer", "visualizer", "library"] },
  { id: "songwriter", name: "Songwriter", blurb: "Melody, chords, recording vocals and AI chat", icon: "keys", tabs: ["home", "producer", "piano-roll", "playlist", "recording", "mixer", "visualizer", "ai-assistant"] },
  { id: "full", name: "Full studio", blurb: "Every section, whatever your level", icon: "crown", tabs: NAV.map((n) => n.tab) },
];

/** sections the level allows (ignores customization): what the app may fall back from */
export function levelNav(level: Level, ai = useStudio.getState().aiEnabled): NavItem[] {
  return NAV.filter((n) => levelRank(level) >= levelRank(n.min) && (ai || !n.ai));
}
/** sections shown in the rail: the level's, plus pinned, minus hidden (Home always stays) */
export function visibleNav(level: Level, overrides = useNavCustom.getState().overrides, ai = useStudio.getState().aiEnabled): NavItem[] {
  return NAV.filter((n) => {
    if (n.tab === "home") return true;
    if (n.ai && !ai) return false;
    const o = overrides[n.tab];
    if (o === "hide") return false;
    return o === "show" || levelRank(level) >= levelRank(n.min);
  });
}

export function NavRail({ onHelp }: { onHelp: () => void }) {
  const { tab, setTab, level } = useStudio();
  const overrides = useNavCustom((s) => s.overrides);
  const ai = useStudio((s) => s.aiEnabled);
  const items = visibleNav(level, overrides, ai);
  let lastGroup = "";
  return (
    <nav className="nav-rail" aria-label="Studio sections">
      {items.map((n) => {
        const showGroup = level !== "beginner" && n.group !== lastGroup;
        lastGroup = n.group;
        return (
          <div key={n.tab} style={{ display: "contents" }}>
            {showGroup && <div className="nav-group-label">{n.group}</div>}
            <button className={`nav-item ${tab === n.tab ? "active" : ""} ${n.hero ? "featured" : ""}`} onClick={() => setTab(n.tab)}
              title={n.hint} aria-current={tab === n.tab ? "page" : undefined}>
              <span className="nav-ico"><Icon name={n.icon} size={20} /></span>
              <span className="nav-lbl">{n.label}</span>
            </button>
          </div>
        );
      })}
      <div className="nav-bottom">
        <button className="nav-item subtle" onClick={() => window.dispatchEvent(new CustomEvent("pf-settings", { detail: "workspace" }))} title="Customize which sections you see: from a 4-page beat station to the full studio">
          <span className="nav-ico"><Icon name="grid" size={18} /></span><span className="nav-lbl">Customize</span>
        </button>
        <button className="nav-item subtle" onClick={onHelp} title="Shortcuts & quick tour (?)"><span className="nav-ico"><Icon name="help" size={18} /></span><span className="nav-lbl">Help</span></button>
      </div>
    </nav>
  );
}
