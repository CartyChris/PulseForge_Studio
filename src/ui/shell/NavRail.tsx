/** Left navigation rail — what you see depends on your experience level (KISS for beginners). */
import { useStudio, type Tab, type Level, levelRank } from "../../state/store";
import { Icon, type IconName } from "./Icons";

export interface NavItem { tab: Tab; label: string; icon: IconName; min: Level; group: string; hint: string; hero?: boolean }

export const NAV: NavItem[] = [
  { tab: "home", label: "Home", icon: "home", min: "beginner", group: "Create", hint: "Start here: make a beat, open a project, learn the basics" },
  { tab: "producer", label: "AI Producer", icon: "sparkles", min: "beginner", group: "Create", hint: "Describe a beat — get a finished, mixed arrangement", hero: true },
  { tab: "channel-rack", label: "Beat", icon: "pads", min: "beginner", group: "Create", hint: "Drum pads & step sequencer" },
  { tab: "piano-roll", label: "Melody", icon: "keys", min: "beginner", group: "Create", hint: "Draw notes, chords and melodies" },
  { tab: "instrument", label: "Instrument", icon: "knob", min: "intermediate", group: "Create", hint: "Sound-design the selected instrument" },
  { tab: "playlist", label: "Song", icon: "song", min: "beginner", group: "Arrange", hint: "Arrange patterns and audio into a full song" },
  { tab: "recording", label: "Record", icon: "mic", min: "beginner", group: "Arrange", hint: "Record vocals or instruments" },
  { tab: "audio-editor", label: "Audio", icon: "wave", min: "intermediate", group: "Arrange", hint: "Chop, slice, tune and stretch audio" },
  { tab: "mixer", label: "Mix", icon: "mixer", min: "beginner", group: "Mix", hint: "Levels, effects and the master chain" },
  { tab: "library", label: "Sounds", icon: "library", min: "beginner", group: "Sounds", hint: "Kits, instruments, samples & sound packs" },
  { tab: "sound-lab", label: "Sound Lab", icon: "flask", min: "intermediate", group: "Sounds", hint: "Generate sounds with AI audio providers, split stems" },
  { tab: "ai-assistant", label: "AI Chat", icon: "chat", min: "intermediate", group: "Sounds", hint: "Chat with AI to compose, edit and mix" },
  { tab: "connections", label: "Connect", icon: "plug", min: "beginner", group: "Setup", hint: "Connect your AI subscriptions, local models & API keys" },
  { tab: "resources", label: "Resources", icon: "globe", min: "expert", group: "Setup", hint: "Sample-pack sites & the pack importer" },
];

export function visibleNav(level: Level): NavItem[] {
  return NAV.filter((n) => levelRank(level) >= levelRank(n.min));
}

export function NavRail({ onHelp }: { onHelp: () => void }) {
  const { tab, setTab, level } = useStudio();
  const items = visibleNav(level);
  let lastGroup = "";
  return (
    <nav className="nav-rail" aria-label="Studio sections">
      {items.map((n) => {
        const showGroup = level !== "beginner" && n.group !== lastGroup;
        lastGroup = n.group;
        return (
          <div key={n.tab} style={{ display: "contents" }}>
            {showGroup && <div className="nav-group-label">{n.group}</div>}
            <button className={`nav-item ${tab === n.tab ? "active" : ""} ${n.hero ? "hero" : ""}`} onClick={() => setTab(n.tab)}
              title={n.hint} aria-current={tab === n.tab ? "page" : undefined}>
              <Icon name={n.icon} size={21} />
              <span>{n.label}</span>
            </button>
          </div>
        );
      })}
      <div className="nav-bottom">
        <button className="nav-item" onClick={onHelp} title="Shortcuts & quick tour (?)"><Icon name="help" size={20} /><span>Help</span></button>
      </div>
    </nav>
  );
}
