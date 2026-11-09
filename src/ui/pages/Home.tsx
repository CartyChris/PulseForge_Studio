/** Home — the front door: describe a beat, one-click genres, continue or start fresh, learn. */
import { useEffect, useState } from "react";
import { useStudio } from "../../state/store";
import { useProducer } from "../../ai/useProducer";
import { GENRES, GENRE_IDS, type GenreId } from "../../../shared/producer";
import { listProjects, loadProjectWithRecovery, saveProject, duplicateProject, deleteProject, importPortableProject, PROJECT_TEMPLATES, type ProjectListEntry } from "../../storage/projects";
import { getHost } from "../../host/adapter";
import { ensureProjectAssetsLoaded } from "../../audio/assets";
import { engine } from "../../engine/engine";
import { Icon } from "../shell/Icons";
import { LevelSwitch, LEVEL_INFO, ShowAt, useAi, AiSwitch } from "../shell/Level";
import { VizBackdrop } from "../viz/LiveVisuals";
import { useVizPrefs } from "../../viz/prefs";

export const GENRE_COLORS: Record<GenreId, string> = {
  trap: "#ff6a3d", drill: "#8b6cff", "boom-bap": "#ffc94d", lofi: "#7fd1ae", rnb: "#ff6fcf", pop: "#3ec6ff",
  house: "#4fe39a", techno: "#9aa7ff", dnb: "#ff9f43", dubstep: "#c56cff", afrobeats: "#ffd166", reggaeton: "#ff8fa3",
  dancehall: "#5ee6d0", phonk: "#ff4d5e", "jersey-club": "#7ab8ff", synthwave: "#ff7bd5", screwed: "#a06cff",
};

export const IDEAS = [
  "dark trap beat with eerie bells, 140 bpm",
  "chill lo-fi study beat with rhodes",
  "summer afrobeats with marimba",
  "uk drill with sliding 808s and strings",
  "festival house drop with sidechain",
  "phonk drift beat, distorted cowbells",
  "smooth r&b slow jam in Eb major",
  "80s synthwave with a big arp",
];

export function useProduceAndGo() {
  const setTab = useStudio((s) => s.setTab);
  const start = useProducer((s) => s.start);
  return (prompt: string, genre?: GenreId) => {
    setTab("producer");
    void start({ prompt: prompt || (genre ? GENRES[genre].name : "beat"), overrides: genre ? { genre } : undefined });
  };
}

export async function openProjectById(id: string) {
  const s = useStudio.getState();
  engine.stop();
  const rec = await loadProjectWithRecovery(id);
  if (!rec) return s.toast("Project could not be loaded", "error");
  s.setProject(rec.project);
  await ensureProjectAssetsLoaded(rec.project);
  if (rec.recovered) s.toast("Recovered a newer autosave of this project", "info");
}

/** Home: the AI front door, or — with AI off — the studio's project shelf. */
export function Home() {
  return useAi() ? <AiHome /> : <StudioHome />;
}

function AiHome() {
  const { project, setTab, level, setProject, toast, reducedMotion } = useStudio();
  const backdrop = useVizPrefs((v) => v.backdrop) && !reducedMotion;
  const { running, providers, refreshProviders, resolvedProvider } = useProducer();
  const produce = useProduceAndGo();
  const [prompt, setPrompt] = useState("");
  const [recent, setRecent] = useState<ProjectListEntry[]>([]);

  useEffect(() => { void refreshProviders(); listProjects().then((l) => setRecent(l.slice(0, 5))).catch(() => {}); }, [refreshProviders]);
  const provider = resolvedProvider();
  const connected = providers.filter((p) => p.configured).length;

  const newFromTemplate = async (id: string) => {
    const tpl = PROJECT_TEMPLATES.find((t) => t.id === id) ?? PROJECT_TEMPLATES[0]!;
    const p = tpl.create();
    await saveProject(p);
    engine.stop();
    setProject(p);
    setTab("channel-rack");
    toast(`New project from “${tpl.name}”`, "success");
  };

  return (
    <div className="page">
      <div className="page-narrow">
        <section className={`hero ${backdrop ? "has-backdrop" : ""}`}>
          {backdrop && <VizBackdrop scene="nebula" intensity={0.75} />}
          <div className="hero-eyebrow"><span className="dot" /> PulseForge Studio 2.0</div>
          <h1>What are we making today?</h1>
          <p>Describe a beat in your own words. PulseForge plans it, writes every part in key, arranges a full song, mixes it, and plays it back. Everything stays editable.</p>
          <div className="prompt-row">
            <textarea className="prompt-box" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. a dark trap beat with eerie bells and hard 808s at 140 bpm"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && prompt.trim()) { e.preventDefault(); produce(prompt); } }} />
            <button className="btn primary big" disabled={running || !prompt.trim()} onClick={() => produce(prompt)}>
              <Icon name="sparkles" /> {running ? "Producing…" : "Make it"}
            </button>
          </div>
          <div className="idea-row">
            {IDEAS.slice(0, level === "beginner" ? 6 : 8).map((i) => <button key={i} className="chip" onClick={() => setPrompt(i)}>{i}</button>)}
          </div>
          <p className="small" style={{ margin: "14px 0 0" }}>
            {provider
              ? <><span className="pill ai"><Icon name="bolt" size={12} /> {provider.name}</span> plans your beats. </>
              : <><span className="pill">Offline producer</span> No AI needed. Connect a subscription or key for smarter plans. </>}
            <button className="btn small ghost" onClick={() => setTab("connections")}><Icon name="plug" size={13} /> {connected ? `${connected} connected` : "Connect AI"}</button>
          </p>
        </section>

        <h3 className="section">One-click beats</h3>
        <div className="genre-grid">
          {GENRE_IDS.map((g) => (
            <button key={g} className="genre-tile" style={{ ["--tile" as string]: GENRE_COLORS[g] }} disabled={running} onClick={() => produce("", g)}
              title={`Produce a full ${GENRES[g].name} beat`}>
              <em>{GENRES[g].bpm[0]}–{GENRES[g].bpm[1]}</em>
              <b>{GENRES[g].name}</b>
              <span>{GENRES[g].blurb}</span>
            </button>
          ))}
        </div>

        <div className="grid two" style={{ marginTop: 22 }}>
          <div className="card">
            <h3><Icon name="pads" /> Start your own</h3>
            <p className="small dim" style={{ marginTop: 0 }}>Build it yourself with the drum pads, piano roll and playlist.</p>
            <div className="row wrap">
              {PROJECT_TEMPLATES.slice(0, level === "beginner" ? 3 : 8).map((t) => (
                <button key={t.id} className="btn small" onClick={() => newFromTemplate(t.id)} title={t.description}>{t.name}</button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn small ghost" onClick={() => setTab("channel-rack")}><Icon name="chevron" size={13} /> Keep working on “{project.name}”</button>
            </div>
          </div>

          <div className="card">
            <h3><Icon name="layers" /> Continue</h3>
            {!recent.length && <p className="small dim">Your saved projects will show up here.</p>}
            {recent.map((r) => (
              <div key={r.id} className="list-row" style={{ cursor: "pointer" }} onClick={() => { void openProjectById(r.id); setTab("playlist"); }}>
                <Icon name="song" />
                <div className="grow"><div className="title">{r.name}</div><div className="meta">{r.bpm} BPM · {new Date(r.modifiedAt).toLocaleDateString()}</div></div>
                <Icon name="chevron" size={14} />
              </div>
            ))}
          </div>

          <div className="card">
            <h3><Icon name={LEVEL_INFO[level].icon} /> Your workspace: {LEVEL_INFO[level].label}</h3>
            <p className="small dim" style={{ marginTop: 0 }}>{LEVEL_INFO[level].blurb}</p>
            <LevelSwitch />
            <p className="small faint" style={{ marginBottom: 0 }}>Switching never removes anything. Higher levels show more controls at once, and every feature is in Expert.</p>
          </div>

          <ShowAt min="beginner">
            <div className="card">
              <h3><Icon name="help" /> Your first beat in 60 seconds</h3>
              <ol className="small dim" style={{ paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
                <li>Click a <b>genre tile</b> above, or describe a beat and press <b>Make it</b>.</li>
                <li>Press <span className="kbd">Space</span> to play. Open <b>Beat</b> to tap your own drums on the pads.</li>
                <li>Not quite right? On the AI Producer page type “faster”, “darker”, or “another version”.</li>
                <li><b>Export</b> a WAV from the project menu ▾ in the top bar.</li>
              </ol>
            </div>
          </ShowAt>
        </div>
      </div>
    </div>
  );
}

const TEMPLATE_COLORS = ["#ff6a3d", "#8b6cff", "#3ec6ff", "#4fe39a", "#ffc94d", "#ff6fcf", "#5ee6d0", "#ff9f43", "#9aa7ff", "#a06cff", "#7fd1ae", "#ff8fa3"];

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Home with AI off: a pure-production front door — your projects in the hero, templates below. */
function StudioHome() {
  const { project, setTab, level, setProject, toast, reducedMotion } = useStudio();
  const backdrop = useVizPrefs((v) => v.backdrop) && !reducedMotion;
  const [all, setAll] = useState<ProjectListEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const refresh = () => listProjects().then((l) => setAll(l.filter((p) => !p.autosave))).catch(() => setAll([]));
  useEffect(() => { void refresh(); }, []);

  const list = (all ?? [])
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.modifiedAt.localeCompare(a.modifiedAt)));

  const open = async (id: string) => {
    if (id !== project.id) await openProjectById(id);
    setTab("playlist");
  };
  const newFrom = async (id: string, goTo: "channel-rack" | "playlist" = "channel-rack") => {
    const tpl = PROJECT_TEMPLATES.find((t) => t.id === id) ?? PROJECT_TEMPLATES[0]!;
    const p = tpl.create();
    await saveProject(p);
    engine.stop();
    setProject(p);
    setTab(goTo);
    toast(`New project from “${tpl.name}”`, "success");
  };
  const duplicate = async (id: string) => {
    const copy = await duplicateProject(id);
    if (copy) { toast(`Duplicated as “${copy.name}”`, "success"); void refresh(); }
  };
  const remove = async (p: ProjectListEntry) => {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    await deleteProject(p.id);
    toast(`Deleted “${p.name}”`);
    void refresh();
  };
  const importOne = async () => {
    const files = await getHost().importFiles({ accept: [".pfproj", ".zip"], multiple: false });
    if (!files[0]) return;
    try {
      const imported = await importPortableProject(files[0].data);
      await openProjectById(imported.id);
      toast(`Imported “${imported.name}”`, "success");
      void refresh();
    } catch (e) { toast(`Import failed: ${e}`, "error"); }
  };

  return (
    <div className="page">
      <div className="page-narrow">
        <section className={`hero studio-hero ${backdrop ? "has-backdrop" : ""}`}>
          {backdrop && <VizBackdrop scene="nebula" intensity={0.75} />}
          <div className="hero-eyebrow"><span className="dot" /> PulseForge Studio 2.0 · Production mode</div>
          <h1>Your projects</h1>
          <p>Pick up a session or start a new one. Pads, steps, piano roll, sampling, arrangement and a full mixer, all yours.</p>

          <div className="projects-box">
            <div className="projects-bar">
              <input className="search-box" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects" />
              <div className="seg" role="radiogroup" aria-label="Sort">
                <button role="radio" aria-checked={sort === "recent"} className={sort === "recent" ? "on" : ""} onClick={() => setSort("recent")}>Recent</button>
                <button role="radio" aria-checked={sort === "name"} className={sort === "name" ? "on" : ""} onClick={() => setSort("name")}>A–Z</button>
              </div>
              <div className="spacer" />
              <button className="btn small" onClick={importOne} title="Open a portable .pfproj project"><Icon name="export" size={13} style={{ transform: "rotate(180deg)" }} /> Import</button>
              <button className="btn small primary" onClick={() => void newFrom("blank")}><Icon name="plus" size={14} /> New project</button>
            </div>
            <div className="projects-list" role="list">
              {all === null && <div className="projects-empty dim small">Loading your projects…</div>}
              {all !== null && !list.length && (
                <div className="projects-empty">
                  <b>{q ? "No projects match" : "No saved projects yet"}</b>
                  <span className="dim small">{q ? "Try another name." : "Start one below from a template, or press New project."}</span>
                </div>
              )}
              {list.map((p, i) => {
                const current = p.id === project.id;
                return (
                  <div key={p.id} role="listitem" className={`project-row ${current ? "current" : ""}`} onClick={() => void open(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") void open(p.id); }} tabIndex={0} title={`Open “${p.name}”`}>
                    <span className="project-art" style={{ ["--c" as string]: TEMPLATE_COLORS[i % TEMPLATE_COLORS.length] }}><Icon name="song" size={16} /></span>
                    <span className="project-text">
                      <b>{p.name}{current && <em className="pill ok">Open now</em>}</b>
                      <span>{p.bpm} BPM · edited {ago(p.modifiedAt)}</span>
                    </span>
                    <button className="icon-btn" title="Duplicate" aria-label={`Duplicate ${p.name}`} onClick={(e) => { e.stopPropagation(); void duplicate(p.id); }}><Icon name="copy" size={15} /></button>
                    <button className="icon-btn danger" disabled={current} title={current ? "This project is open: open another one to delete it" : "Delete"} aria-label={`Delete ${p.name}`}
                      onClick={(e) => { e.stopPropagation(); void remove(p); }}><Icon name="trash" size={15} /></button>
                    <span className="btn small project-open">{current ? "Continue" : "Open"} <Icon name="chevron" size={13} /></span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <h3 className="section">Start from a template</h3>
        <div className="genre-grid">
          {PROJECT_TEMPLATES.map((t, i) => (
            <button key={t.id} className="genre-tile" style={{ ["--tile" as string]: TEMPLATE_COLORS[i % TEMPLATE_COLORS.length] }} onClick={() => void newFrom(t.id, t.id === "blank" ? "channel-rack" : "playlist")} title={t.description}>
              <b>{t.name}</b>
              <span>{t.description}</span>
            </button>
          ))}
        </div>

        <div className="grid two" style={{ marginTop: 22 }}>
          <div className="card">
            <h3><Icon name={LEVEL_INFO[level].icon} /> Your workspace: {LEVEL_INFO[level].label}</h3>
            <p className="small dim" style={{ marginTop: 0 }}>{LEVEL_INFO[level].blurb}</p>
            <LevelSwitch />
            <p className="small faint" style={{ marginBottom: 6 }}>AI features are off, so this is a pure production studio. Want the AI Producer and AI Chat back?</p>
            <AiSwitch />
          </div>
          <div className="card">
            <h3><Icon name="help" /> Your first beat in 60 seconds</h3>
            <ol className="small dim" style={{ paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
              <li>Pick a <b>template</b> above, or press <b>New project</b>.</li>
              <li>On <b>Beat</b>, open the <b>Groove Library</b> or tap the pads and click squares to place hits.</li>
              <li>Press <span className="kbd">Space</span> to play. Add chords on <b>Melody</b>, chop a sample on <b>Sample</b>.</li>
              <li>Arrange on <b>Song</b>, balance on <b>Mix</b>, then <b>Export</b> a WAV from the project menu ▾.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
