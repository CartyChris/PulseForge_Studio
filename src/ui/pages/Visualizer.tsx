/**
 * Visualizer — a full-bleed, song-aware light show for whatever is playing. Ten GPU scenes react
 * to the song's real kicks, snares, hats, bass and chords (from its patterns), its spectrum and
 * its key colours. Move, click and drag to play with the light; tap the performance pads to hit
 * drums *and* visuals; record the screen + sound as a video for socials.
 *
 * Levels: Beginner gets scenes, Auto, full screen and record; Intermediate adds the Look panel and
 * the "what it hears" signal strip; Expert adds the fine render controls.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useStudio, usePlayhead } from "../../state/store";
import { engine } from "../../engine/engine";
import { getHost } from "../../host/adapter";
import { useVizPrefs } from "../../viz/prefs";
import { SCENES } from "../../viz/scenes";
import { vizFeed, type VizFrame } from "../../viz/feed";
import { roleForChannel } from "../../viz/song";
import type { ColorMode } from "../../viz/renderer";
import { useVizCanvas } from "../../viz/useVizCanvas";
import { Icon } from "../shell/Icons";
import { atLeast, useLevel } from "../shell/Level";
import type { Channel } from "../../../shared/project";

/** a gradient swatch per scene for the picker */
export const SCENE_SWATCH: Record<string, string> = {
  flow: "conic-gradient(from 200deg, #ff6a3d, #ff6fcf, #8b6cff, #3ec6ff, #ff6a3d)",
  halo: "radial-gradient(circle at 50% 50%, #fff 0 8%, #8b6cff 9% 30%, #0000 31%), conic-gradient(#3ec6ff, #8b6cff, #ff6fcf, #3ec6ff)",
  nebula: "radial-gradient(circle at 35% 40%, #ffb36b, #b14bff 45%, #1b1440 80%)",
  skyline: "linear-gradient(180deg, #2a0f4a 0 40%, #ff6fcf 41% 55%, #ffb36b 56% 60%, #12062a 61%)",
  orbs: "radial-gradient(circle at 30% 35%, #4fe39a 0 22%, #0000 23%), radial-gradient(circle at 68% 60%, #ff6a3d 0 26%, #0000 27%), radial-gradient(circle at 60% 25%, #3ec6ff 0 14%, #0000 15%), #10121a",
  matrix: "repeating-linear-gradient(90deg, #ff6a3d55 0 3px, #0000 3px 7px), repeating-linear-gradient(0deg, #3ec6ff66 0 3px, #0000 3px 7px), #0d0f17",
  warp: "repeating-radial-gradient(circle at 50% 50%, #8b6cff 0 2px, #0b0b18 3px 7px)",
  galaxy: "radial-gradient(circle at 50% 50%, #fff 0 6%, #ffd166 10%, #8b6cff 35%, #090a14 70%)",
  kaleido: "conic-gradient(#ff6a3d, #ffc94d, #4fe39a, #3ec6ff, #8b6cff, #ff6fcf, #ff6a3d)",
  phosphor: "radial-gradient(ellipse at 50% 50%, #4fe39a 0 6%, #0000 40%), repeating-linear-gradient(0deg, #4fe39a22 0 1px, #0000 1px 6px), #04100a",
};

const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: "song", label: "Song key", hint: "Colours from the song's key and mode (minor keys run cooler)" },
  { id: "channels", label: "Instruments", hint: "Your channels' own colours" },
  { id: "accent", label: "Studio", hint: "Your studio accent colour" },
  { id: "rainbow", label: "Spectrum", hint: "A slowly cycling rainbow" },
  { id: "mono", label: "Mono", hint: "White light with an accent" },
];

const SIGNALS: { key: keyof Pick<VizFrame, "kick" | "snare" | "hat" | "bass" | "chords" | "lead">; label: string; color: string }[] = [
  { key: "kick", label: "Kick", color: "#ff6a3d" },
  { key: "snare", label: "Snare", color: "#ffc94d" },
  { key: "hat", label: "Hats", color: "#5ee6d0" },
  { key: "bass", label: "Bass", color: "#ff6fcf" },
  { key: "chords", label: "Chords", color: "#3ec6ff" },
  { key: "lead", label: "Lead", color: "#8b6cff" },
];

function padChannels(channels: Channel[]): Channel[] {
  const drums = channels.filter((c) => c.instrument.type === "drum-sound");
  const samplers = channels.filter((c) => c.instrument.type === "sampler" && c.instrument.assetId);
  return [...drums, ...samplers].slice(0, 8);
}

export function VisualizerPage() {
  const prefs = useVizPrefs();
  const level = useLevel();
  const { project, toast } = useStudio();
  const playing = usePlayhead((s) => s.playing);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [idleUi, setIdleUi] = useState(false);
  const [hideUi, setHideUi] = useState(false);
  const [panel, setPanel] = useState(false);
  const [pads, setPads] = useState(false);
  const [full, setFull] = useState(false);
  const [title, setTitle] = useState<{ name: string; blurb: string; n: number } | null>(null);
  const [recAt, setRecAt] = useState<number | null>(null);
  const [recTime, setRecTime] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const hud = useRef<{ pos?: HTMLElement | null; section?: HTMLElement | null; leds: (HTMLElement | null)[]; bands: (HTMLElement | null)[] }>({ leds: [], bands: [] });
  const auto = useRef({ section: "", bar: -1 });
  const hudText = useRef({ pos: "", section: "" });
  const scene = SCENES.find((s) => s.id === prefs.scene) ?? SCENES[0]!;
  const showSignals = atLeast(level, "intermediate") && prefs.signals;
  const expert = atLeast(level, "expert");
  const padList = padChannels(project.channels);

  const announce = useCallback((id: string) => {
    const s = SCENES.find((x) => x.id === id);
    if (s) setTitle({ name: s.name, blurb: s.blurb, n: Date.now() });
  }, []);
  useEffect(() => { if (!title) return; const t = setTimeout(() => setTitle(null), 2600); return () => clearTimeout(t); }, [title]);

  const choose = useCallback((id: string) => { prefs.set({ scene: id }); announce(id); }, [prefs, announce]);
  const step = useCallback((dir: number) => {
    const i = SCENES.findIndex((s) => s.id === useVizPrefs.getState().scene);
    choose(SCENES[(i + dir + SCENES.length) % SCENES.length]!.id);
  }, [choose]);

  const onFrame = useCallback((f: VizFrame) => {
    if (!f.playing) auto.current.bar = -1;
    // HUD text (only touch the DOM when it changes)
    const beat = Math.floor(f.beats % f.beatsPerBar) + 1;
    const pos = `${f.bar + 1}.${beat}`;
    if (hud.current.pos && pos !== hudText.current.pos) { hud.current.pos.textContent = pos; hudText.current.pos = pos; }
    const sec = f.section || (f.playing ? "" : "Paused");
    if (hud.current.section && sec !== hudText.current.section) { hud.current.section.textContent = sec; hudText.current.section = sec; }
    SIGNALS.forEach((s, i) => { const el = hud.current.leds[i]; if (el) el.style.setProperty("--v", (f[s.key] as number).toFixed(3)); });
    const b = [f.bands.sub, f.bands.bass, f.bands.lowMid, f.bands.mid, f.bands.highMid, f.bands.air];
    b.forEach((v, i) => { const el = hud.current.bands[i]; if (el) el.style.setProperty("--v", Math.min(1, v * 1.6).toFixed(3)); });
    // Auto: change scene on a new section, or every 16 bars on the downbeat, matching the energy
    const p = useVizPrefs.getState();
    if (p.auto && f.playing) {
      const a = auto.current;
      // first frame of a play (or a seek backwards): note where we are, don't switch yet
      if (a.bar < 0 || f.bar < a.bar) { a.bar = f.bar; a.section = f.section; return; }
      const sectionChange = f.section && f.section !== a.section;
      if (sectionChange || (f.bar - a.bar >= 16 && f.barPhase < 0.08)) {
        a.section = f.section; a.bar = f.bar;
        const mood = f.energy > 0.5 ? "hype" : f.energy > 0.25 ? "groove" : "calm";
        const pool = SCENES.filter((s) => s.id !== p.scene && s.mood === mood);
        const next = (pool.length ? pool : SCENES.filter((s) => s.id !== p.scene))[Math.floor(Math.random() * Math.max(1, pool.length || SCENES.length - 1))];
        if (next) { useVizPrefs.getState().set({ scene: next.id }); setTitle({ name: next.name, blurb: f.section ? `${f.section} · ${next.blurb}` : next.blurb, n: Date.now() }); }
      }
    }
  }, []);

  const r = useVizCanvas(canvas, { scene: prefs.scene, settings: prefs.settings, maxDpr: 1.5, onFrame });

  // auto-hide the controls while the music plays and the pointer rests (Apple TV style)
  const wake = useCallback(() => {
    setIdleUi(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { if (usePlayhead.getState().playing && !document.querySelector(".viz-page .viz-pop")) setIdleUi(true); }, 3200);
  }, []);
  useEffect(() => { wake(); return () => clearTimeout(idleTimer.current); }, [wake, playing]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void wrap.current?.requestFullscreen?.().catch(() => toast("Full screen isn't available here", "error"));
  }, [toast]);
  useEffect(() => {
    const h = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const hitPad = useCallback((ch: Channel, i: number) => {
    const pitch = ch.instrument.type === "sampler" ? (ch.instrument.params.rootNote ?? 60) : 48;
    void engine.auditionNote(ch.id, pitch, 0.4, 0.95);
    const role = roleForChannel(ch);
    vizFeed.trigger(role, 0.95, ch.id);
    // a ripple from where the pad would sit on a 4×2 grid across the lower screen
    const x = 0.2 + (i % 4) * 0.2, y = i < 4 ? 0.62 : 0.78;
    r.current?.burst(x, y, 1);
    wake();
  }, [r, wake]);

  const stopRec = useCallback(() => { recorder.current?.stop(); }, []);
  const startRec = useCallback(async () => {
    const c = canvas.current;
    if (!c || typeof MediaRecorder === "undefined" || !("captureStream" in c)) { toast("Video recording isn't supported in this browser", "error"); return; }
    await engine.init();
    const stream = (c as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(60);
    engine.getOutputStream()?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      setRecAt(null);
      recorder.current = null;
      const type = mr.mimeType || "video/webm";
      const blob = new Blob(chunks, { type });
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const name = `${useStudio.getState().project.name.replace(/[^\w\- ]+/g, "").trim() || "PulseForge"} - ${SCENES.find((s) => s.id === useVizPrefs.getState().scene)?.name ?? "Visualizer"}.${ext}`;
      if (blob.size < 1000) { toast("The recording came out empty. Try again with the music playing", "error"); return; }
      await getHost().exportFiles([{ name, mime: type, data: blob }]);
      toast(`Saved “${name}” (${(blob.size / 1e6).toFixed(1)} MB)`, "success");
    };
    mr.start(500);
    recorder.current = mr;
    setRecAt(Date.now());
    if (!engine.playing) await engine.play();
  }, [toast]);
  useEffect(() => {
    if (recAt === null) return;
    const t = setInterval(() => setRecTime(Math.floor((Date.now() - recAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [recAt]);
  useEffect(() => () => { recorder.current?.stop(); }, []);

  // keys: ← → scenes · F full screen · H hide controls · A auto · 1–8 performance pads
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (k === "f") toggleFull();
      else if (k === "h") setHideUi((v) => !v);
      else if (k === "a") { const on = !useVizPrefs.getState().auto; useVizPrefs.getState().set({ auto: on }); toast(on ? "Auto: scenes follow the song's sections and energy" : "Auto off"); }
      else if (/^[1-8]$/.test(e.key) && !e.repeat) { const i = Number(e.key) - 1; const ch = padChannels(useStudio.getState().project.channels)[i]; if (ch) hitPad(ch, i); }
      else return;
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggleFull, toast, hitPad, wake]);

  const pointer = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    r.current?.setPointer((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, e.buttons > 0);
    wake();
  };
  const down = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    r.current?.burst((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, 1);
    pointer(e);
  };
  const wheel = (e: React.WheelEvent) => {
    const s = useVizPrefs.getState().settings;
    const intensity = Math.max(0.3, Math.min(1.6, s.intensity - e.deltaY * 0.0015));
    useVizPrefs.getState().setSettings({ intensity });
  };

  const st = prefs.settings;
  const slider = (label: string, key: "intensity" | "speed" | "trails" | "bloom" | "grain" | "aberration", min: number, max: number, stepV: number, hint: string) => (
    <label className="viz-slider" title={hint}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={stepV} value={st[key]} onChange={(e) => prefs.setSettings({ [key]: Number(e.target.value) })} />
      <em>{key === "grain" ? Math.round((st[key] / 0.12) * 100) : Math.round(st[key] * 100)}%</em>
    </label>
  );

  const chromeHidden = hideUi || idleUi;
  return (
    <div ref={wrap} className={`viz-page ${chromeHidden ? "chrome-off" : ""} ${idleUi ? "idle" : ""} ${full ? "is-full" : ""}`}
      onPointerMove={wake}>
      <canvas ref={canvas} className="viz-canvas" onPointerMove={pointer} onPointerDown={down} onPointerUp={pointer} onWheel={wheel}
        aria-label={`${scene.name} visualizer`} />

      {title && <div key={title.n} className="viz-title" aria-live="polite"><b>{title.name}</b><span>{title.blurb}</span></div>}

      {!playing && !title && (
        <div className="viz-hint">
          <button className="viz-play-hero" onClick={() => void engine.play()} aria-label="Play"><Icon name="play" size={30} /></button>
          <span>Press <span className="kbd">Space</span> to play. Move, click and drag to play with the light.</span>
        </div>
      )}

      <div className="viz-chrome">
        <div className="viz-now glass">
          <div className="viz-now-art" style={{ background: SCENE_SWATCH[scene.id] }} />
          <div className="viz-now-text">
            <b title={project.name}>{project.name}</b>
            <span><i ref={(el) => { hud.current.section = el; }} /> <i className="mono" ref={(el) => { hud.current.pos = el; }}>1.1</i> · {project.bpm} BPM · {project.key} {project.scale}</span>
          </div>
        </div>

        {showSignals && (
          <div className="viz-signals glass" title="What the visualizer is reacting to. Hits come straight from your patterns, so they land exactly on the beat">
            {SIGNALS.map((s, i) => (
              <span key={s.key} className="led" style={{ ["--c" as string]: s.color } as CSSProperties} ref={(el) => { hud.current.leds[i] = el; }}><i />{s.label}</span>
            ))}
            <span className="bands">{["Sub", "Bass", "Low", "Mid", "High", "Air"].map((b, i) => <i key={b} title={b} ref={(el) => { hud.current.bands[i] = el; }} />)}</span>
          </div>
        )}

        {pads && (
          <div className="viz-pads">
            {padList.length === 0 && <span className="small dim">Add drums on the Beat page to perform here</span>}
            {padList.map((ch, i) => (
              <button key={ch.id} className="viz-pad" style={{ ["--pad" as string]: ch.color } as CSSProperties} onPointerDown={(e) => { e.stopPropagation(); hitPad(ch, i); }}>
                <small>{i + 1}</small><span>{ch.name}</span>
              </button>
            ))}
          </div>
        )}

        {panel && (
          <div className="viz-pop glass" role="dialog" aria-label="Look">
            <div className="row"><b>Look</b><div className="spacer" /><button className="icon-btn" onClick={() => setPanel(false)} aria-label="Close"><Icon name="close" size={14} /></button></div>
            <div className="viz-colors" role="radiogroup" aria-label="Colours">
              {COLOR_MODES.map((m) => (
                <button key={m.id} role="radio" aria-checked={st.colorMode === m.id} className={st.colorMode === m.id ? "on" : ""} title={m.hint} onClick={() => prefs.setSettings({ colorMode: m.id })}>{m.label}</button>
              ))}
            </div>
            {slider("Intensity", "intensity", 0.3, 1.6, 0.01, "How hard the visuals react (scroll on the visual to change it too)")}
            {atLeast(level, "intermediate") && <>
              {slider("Speed", "speed", 0.2, 2, 0.01, "How fast things drift and spin")}
              {slider("Trails", "trails", 0, 1, 0.01, "How long light lingers")}
              {slider("Glow", "bloom", 0, 1.5, 0.01, "Bloom around bright light")}
            </>}
            {expert && <>
              {slider("Film grain", "grain", 0, 0.12, 0.005, "Analog grain")}
              {slider("Lens split", "aberration", 0, 2, 0.01, "Chromatic aberration that kicks with the drums")}
              <label className="viz-slider" title="Render resolution. Adaptive keeps it smooth on any Mac">
                <span>Quality</span>
                <select className="sel" value={st.quality} onChange={(e) => prefs.setSettings({ quality: Number(e.target.value) })}>
                  <option value={0}>Adaptive</option><option value={1}>Full</option><option value={0.75}>Balanced</option><option value={0.5}>Battery saver</option>
                </select>
              </label>
              <label className="row small"><input type="checkbox" checked={prefs.signals} onChange={(e) => prefs.set({ signals: e.target.checked })} /> Show what it hears</label>
            </>}
            <p className="small faint" style={{ margin: "6px 0 0" }}>Tip: scroll on the visual for intensity · drag to bend it · click for a shockwave.</p>
          </div>
        )}

        <div className="viz-dock glass" role="toolbar" aria-label="Visualizer controls">
          <button className={`viz-btn primary ${playing ? "on" : ""}`} onClick={() => (engine.playing ? engine.pause() : void engine.play())} aria-label={playing ? "Pause" : "Play"} title="Play / Pause (Space)">
            <Icon name={playing ? "pause" : "play"} size={18} />
          </button>
          <button className="viz-btn" onClick={() => step(-1)} aria-label="Previous scene" title="Previous scene (←)"><Icon name="chevron" size={16} style={{ transform: "scaleX(-1)" }} /></button>
          <div className="viz-scenes" role="radiogroup" aria-label="Scenes">
            {SCENES.map((s) => (
              <button key={s.id} role="radio" aria-checked={s.id === prefs.scene} className={`viz-scene ${s.id === prefs.scene ? "on" : ""}`} onClick={() => choose(s.id)} title={s.blurb}>
                <i style={{ background: SCENE_SWATCH[s.id] }} /><span>{s.name}</span>
              </button>
            ))}
          </div>
          <button className="viz-btn" onClick={() => step(1)} aria-label="Next scene" title="Next scene (→)"><Icon name="chevron" size={16} /></button>
          <span className="viz-sep" />
          <button className={`viz-btn ${prefs.auto ? "on" : ""}`} onClick={() => prefs.set({ auto: !prefs.auto })} aria-pressed={prefs.auto} title="Auto (A): scenes change with the song's sections and energy">
            <Icon name="shuffle" size={16} /><span className="lbl">Auto</span>
          </button>
          <button className={`viz-btn ${panel ? "on" : ""}`} onClick={() => setPanel((v) => !v)} aria-expanded={panel} title="Colours, intensity and glow"><Icon name="palette" size={16} /><span className="lbl">Look</span></button>
          <button className={`viz-btn ${pads ? "on" : ""}`} onClick={() => setPads((v) => !v)} aria-pressed={pads} title="Performance pads (keys 1–8): hit drums and visuals together"><Icon name="pads" size={16} /><span className="lbl">Pads</span></button>
          <button className={`viz-btn ${recAt !== null ? "rec" : ""}`} onClick={() => (recAt !== null ? stopRec() : void startRec())}
            title={recAt !== null ? "Stop and save the video" : "Record a video of the visualizer with your song's audio"}>
            <Icon name={recAt !== null ? "stop" : "video"} size={16} /><span className="lbl">{recAt !== null ? `${Math.floor(recTime / 60)}:${String(recTime % 60).padStart(2, "0")}` : "Record"}</span>
          </button>
          <button className="viz-btn" onClick={() => setHideUi(true)} title="Hide controls (H)" aria-label="Hide controls"><Icon name="eyeOff" size={16} /></button>
          <button className="viz-btn" onClick={toggleFull} title="Full screen (F)" aria-label="Full screen"><Icon name={full ? "contract" : "expand"} size={16} /></button>
        </div>
      </div>
      {hideUi && <button className="viz-unhide glass" onClick={() => setHideUi(false)} title="Show controls (H)"><Icon name="eye" size={15} /></button>}
    </div>
  );
}
