/**
 * Experience-level building blocks. Levels change how much is SHOWN, never what the studio can
 * do: anything hidden at a lower level is one "More tools" click away, and every feature is
 * reachable in Expert. Components:
 *   <ShowAt min="intermediate">…</ShowAt>   render only at/above a level
 *   <MoreTools label="…">…</MoreTools>      collapsible drawer; open by default in Expert
 *   <LevelSwitch/>                          segmented Beginner · Intermediate · Expert control (compact: label on the active one only)
 *   <Coach id="beat">…</Coach>              dismissible tip shown to Beginner/Intermediate
 */
import { useState, type ReactNode } from "react";
import { useStudio, levelRank, type Level } from "../../state/store";
import { Icon, type IconName } from "./Icons";

export function useLevel(): Level {
  return useStudio((s) => s.level);
}
export function atLeast(level: Level, min: Level): boolean {
  return levelRank(level) >= levelRank(min);
}

export function ShowAt({ min, children }: { min: Level; children: ReactNode }) {
  const level = useLevel();
  return atLeast(level, min) ? <>{children}</> : null;
}

export function MoreTools({ label = "More tools", children, min = "beginner" }: { label?: string; children: ReactNode; min?: Level }) {
  const level = useLevel();
  const [open, setOpen] = useState(level === "expert");
  if (!atLeast(level, min)) return null;
  if (level === "expert") return <>{children}</>;
  return (
    <>
      <button className={`btn small ghost ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide extra tools" : "Show more tools"}>
        <Icon name="sliders" size={14} /> {open ? "Fewer" : label}
      </button>
      {open && <span className="more-tools">{children}</span>}
    </>
  );
}

export const LEVEL_INFO: Record<Level, { label: string; icon: IconName; blurb: string }> = {
  beginner: { label: "Beginner", icon: "seedling", blurb: "Big, simple controls and guided steps. The AI Producer and drum pads front and center." },
  intermediate: { label: "Intermediate", icon: "rocket", blurb: "Every production page with clean toolbars — advanced tools one click away." },
  expert: { label: "Expert", icon: "crown", blurb: "Everything at once: browser + inspector panels, dense toolbars, every generator and editor." },
};

export function LevelSwitch({ compact = false }: { compact?: boolean }) {
  const { level, setLevel, toast } = useStudio();
  return (
    <div className={`seg level-seg ${compact ? "compact" : ""}`} role="radiogroup" aria-label="Experience level">
      {(Object.keys(LEVEL_INFO) as Level[]).map((l) => (
        <button key={l} role="radio" aria-checked={level === l} className={level === l ? "on" : ""}
          title={`${LEVEL_INFO[l].label} — ${LEVEL_INFO[l].blurb}`}
          onClick={() => { if (l !== level) { setLevel(l); toast(`${LEVEL_INFO[l].label} mode — ${LEVEL_INFO[l].blurb}`); } }}>
          <Icon name={LEVEL_INFO[l].icon} size={14} />{(!compact || level === l) && <span>{LEVEL_INFO[l].label}</span>}
        </button>
      ))}
    </div>
  );
}

function dismissedKey(id: string) { return `pf_coach_${id}`; }

export function Coach({ id, title, children, max = "intermediate" }: { id: string; title: string; children: ReactNode; max?: Level }) {
  const level = useLevel();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(dismissedKey(id)) === "1"; } catch { return false; } });
  if (hidden || levelRank(level) > levelRank(max)) return null;
  return (
    <div className="coach" role="note">
      <Icon name="sparkles" size={16} />
      <div><strong>{title}</strong> <span>{children}</span></div>
      <button className="icon-btn" aria-label="Dismiss tip" onClick={() => { setHidden(true); try { localStorage.setItem(dismissedKey(id), "1"); } catch {} }}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
