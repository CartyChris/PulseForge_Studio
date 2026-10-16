/**
 * Beat — drum pads + kit switcher + one-click genre grooves above the Channel Rack.
 * Pads audition the current kit (also keys 1–8); "Groove" writes an authentic genre beat into the
 * current pattern using the producer engine; "Kit" swaps every drum sound while keeping your steps.
 */
import { useEffect, useRef, useState } from "react";
import { useStudio, usePlayhead } from "../../state/store";
import { ChannelRack } from "../ChannelRack";
import { DRUM_KITS, getKit } from "../../engine/kits";
import { engine } from "../../engine/engine";
import { buildProduction, ProductionSpecSchema, GENRES, GENRE_IDS, type GenreId } from "../../../shared/producer";
import { newId, type Channel, type Step } from "../../../shared/project";
import { Icon } from "../shell/Icons";
import { Coach, ShowAt, useLevel } from "../shell/Level";
import { GENRE_COLORS } from "./Home";
import { GrooveLibrary } from "../GrooveLibrary";
import { recordTap, nextRepeatTick, REPEAT_RATES, type RepeatRate } from "../../../shared/patterntools";
import { GROOVES } from "../../../shared/grooves";

const PAD_COLORS = ["#ff6a3d", "#ffc94d", "#3ec6ff", "#4fe39a", "#8b6cff", "#ff6fcf", "#5ee6d0", "#ff9f43"];

/** Write a genre's groove into the current pattern (creating any missing drum channels). One undo step. */
export function applyGroove(genre: GenreId): string {
  const s = useStudio.getState();
  const project = s.project;
  const pattern = project.patterns.find((p) => p.id === s.selection.patternId) ?? project.patterns[0];
  if (!pattern) return "Create a pattern first";
  const prod = buildProduction(ProductionSpecSchema.parse({
    genre, seed: Math.floor(Math.random() * 1e9),
    sections: [{ name: "Groove", role: "hook", bars: 2, energy: 0.9, parts: ["drums"] }],
  }));
  const drums = prod.parts.find((x) => x.role === "drums")?.drums ?? {};
  const kitId = (project.channels.find((c) => c.instrument.type === "drum-sound")?.instrument as { kitId?: string } | undefined)?.kitId ?? GENRES[genre].kit;
  const kit = getKit(kitId);
  s.update((p) => {
    const channels: Channel[] = [...p.channels];
    const steps: Record<string, Step[]> = { ...pattern.steps };
    for (const [role, hits] of Object.entries(drums)) {
      let ch = channels.find((c) => c.instrument.type === "drum-sound" && getKit(c.instrument.kitId).sounds.find((x) => x.id === (c.instrument as { soundId: string }).soundId)?.role === role);
      if (!ch) {
        const sound = kit.sounds.find((x) => x.role === role) ?? kit.sounds[0]!;
        ch = { id: newId("ch"), name: sound.name, color: PAD_COLORS[channels.length % PAD_COLORS.length]!, instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id }, volumeDb: role.startsWith("hat") ? -6 : 0, pan: 0, muted: false, soloed: false, mixerChannelId: null };
        channels.push(ch);
      }
      // the groove is 2 bars; tile it across the pattern length
      const tiled: Step[] = [];
      for (let off = 0; off < pattern.lengthSteps; off += 32) for (const h of hits) if (h.index + off < pattern.lengthSteps) tiled.push({ index: h.index + off, velocity: h.velocity, probability: h.probability, micro: h.micro });
      steps[ch.id] = tiled;
    }
    return { ...p, channels, patterns: p.patterns.map((x) => (x.id === pattern.id ? { ...x, steps, swing: GENRES[genre].swing } : x)) };
  });
  return `${GENRES[genre].name} groove written into “${pattern.name}” (undo with ⌘Z)`;
}

/** Swap every drum channel to the same role in another kit — your steps stay exactly as they are. */
export function swapKit(kitId: string): string {
  const s = useStudio.getState();
  const kit = getKit(kitId);
  let n = 0;
  s.update((p) => ({
    ...p,
    channels: p.channels.map((c) => {
      if (c.instrument.type !== "drum-sound") return c;
      const oldRole = getKit(c.instrument.kitId).sounds.find((x) => x.id === (c.instrument as { soundId: string }).soundId)?.role;
      const sound = kit.sounds.find((x) => x.role === oldRole);
      if (!sound) return c;
      n++;
      return { ...c, name: sound.name, instrument: { type: "drum-sound", kitId: kit.id, soundId: sound.id } };
    }),
  }));
  return n ? `Switched ${n} drum sounds to the ${kit.name} kit` : "Add some drum channels first (+ Add Channel or a Groove)";
}

export function BeatPage() {
  const level = useLevel();
  const { project, toast, selection, select } = useStudio();
  const [hit, setHit] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const playing = usePlayhead((st) => st.playing);
  const [rec, setRec] = useState(false);
  const [quantize, setQuantize] = useState(true);
  const [repeat, setRepeat] = useState<RepeatRate | "off">("off");
  const repeatTimer = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const drumChannels = project.channels.filter((c) => c.instrument.type === "drum-sound");
  const currentKit = (drumChannels[0]?.instrument as { kitId?: string } | undefined)?.kitId ?? "";
  // pads: drum sounds first, then sampler pads (chops from the Sample page)
  const samplerPads = project.channels.filter((c) => c.instrument.type === "sampler" && c.instrument.assetId);
  const pads = [...drumChannels, ...samplerPads].slice(0, 16);

  /** play a pad; while Rec is on and the song is playing, write the hit into the current pattern */
  const tap = (ch: Channel, velocity = 0.95) => {
    const pitch = ch.instrument.type === "sampler" ? (ch.instrument.params.rootNote ?? 60) : 48; // samplers at their root (natural speed)
    void engine.auditionNote(ch.id, pitch, 0.4, velocity);
    setHit(ch.id);
    setTimeout(() => setHit((h) => (h === ch.id ? null : h)), 110);
    select({ channelId: ch.id });
    const ph = usePlayhead.getState();
    if (rec && ph.playing) {
      const st = useStudio.getState();
      const pat = st.project.patterns.find((x) => x.id === st.selection.patternId) ?? st.project.patterns[0];
      if (!pat) return;
      st.update((p) => ({ ...p, patterns: p.patterns.map((x) => (x.id === pat.id ? { ...x, steps: { ...x.steps, [ch.id]: recordTap(x.steps[ch.id] ?? [], ph.ticks, x.lengthSteps, velocity, quantize) } } : x)) }), { undoable: false });
    }
  };
  const stopRepeat = () => { clearTimeout(repeatTimer.current.t); clearInterval(repeatTimer.current.i); repeatTimer.current = {}; };
  /** pad down: hit now, and with Note Repeat on keep hitting on the grid until released */
  const padDown = (ch: Channel) => {
    tap(ch);
    if (repeat === "off") return;
    const rateTicks = REPEAT_RATES.find((r) => r.id === repeat)!.ticks;
    const msPerTick = 60000 / useStudio.getState().project.bpm / 96;
    const ph = usePlayhead.getState();
    const wait = ph.playing ? (nextRepeatTick(ph.ticks + 1, rateTicks) - ph.ticks) * msPerTick : rateTicks * msPerTick;
    stopRepeat();
    repeatTimer.current.t = setTimeout(() => {
      tap(ch, 0.8);
      repeatTimer.current.i = setInterval(() => tap(ch, 0.8), rateTicks * msPerTick);
    }, wait);
  };
  useEffect(() => stopRepeat, []);
  // start of a recording pass = one undo point
  useEffect(() => { if (rec) { const st = useStudio.getState(); st.pushUndo(st.project); } }, [rec]);
  // open on a pattern that actually has drums: a produced song selects its first pattern, which is
  // often a chords/melody one, and an empty-looking grid reads as "nothing happened". Mount only.
  useEffect(() => {
    const st = useStudio.getState();
    const p = st.project;
    const drumIds = new Set(p.channels.filter((c) => c.instrument.type === "drum-sound").map((c) => c.id));
    const hits = (pt: (typeof p.patterns)[number]) => Object.entries(pt.steps).reduce((n, [cid, s]) => n + (drumIds.has(cid) ? s.length : 0), 0);
    const cur = p.patterns.find((x) => x.id === st.selection.patternId);
    if (cur && hits(cur) > 0) return;
    const best = [...p.patterns].sort((a, b) => hits(b) - hits(a))[0];
    if (best && hits(best) > 0) st.select({ patternId: best.id });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || e.metaKey || e.ctrlKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 8 && pads[n - 1] && !e.repeat) tap(pads[n - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="page-fill">
      <div className="page-bar">
        <h1><Icon name="pads" /> Beat</h1>
        <span className="sub">Tap pads to hear sounds · click steps to program · right-click a step for velocity & timing</span>
        <div className="spacer" />
        <label className="small dim row">Kit
          <select className="sel" value={currentKit} onChange={(e) => toast(swapKit(e.target.value), "success")} aria-label="Drum kit">
            {!currentKit && <option value="">— choose —</option>}
            {DRUM_KITS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </label>
        <button className="btn small primary" onClick={() => setLibOpen(true)} title={`${GROOVES.length} named drum patterns by style`}><Icon name="drum" size={14} /> Groove Library</button>
        <label className="small dim row" title="Write an authentic genre drum groove into the current pattern">Groove
          <select className="sel" value="" onChange={(e) => { if (e.target.value) toast(applyGroove(e.target.value as GenreId), "success"); }} aria-label="Apply a genre groove">
            <option value="">— pick a genre —</option>
            {GENRE_IDS.map((g) => <option key={g} value={g}>{GENRES[g].name}</option>)}
          </select>
        </label>
      </div>
      <div className="fill" style={{ display: "flex", flexDirection: "column" }}>
        <Coach id="beat-pads" title="Make a beat:">
          pick a <b>Groove</b> to start from a genre beat, or tap the pads and click the squares to place hits. Bright squares play. Press <span className="kbd">Space</span> to loop the pattern.
        </Coach>
        {(level !== "expert" || pads.length > 0) && (
          <div style={{ padding: "12px 14px 0" }}>
            {pads.length === 0 ? (
              <div className="row wrap">
                <span className="small dim">No drums yet. Start with a groove:</span>
                {(["trap", "boom-bap", "house", "afrobeats", "drill", "lofi"] as GenreId[]).map((g) => (
                  <button key={g} className="chip" style={{ borderColor: GENRE_COLORS[g] }} onClick={() => toast(applyGroove(g), "success")}>{GENRES[g].name}</button>
                ))}
              </div>
            ) : (
              <ShowAt min="beginner">
                <div className="pad-tools">
                  <button className={`btn small rec ${rec ? "on" : ""}`} onClick={() => setRec((r) => !r)} aria-pressed={rec}
                    title="Record pad hits into the current pattern while it plays (press Space to play)"><Icon name="record" size={13} /> {rec ? "Recording" : "Rec"}</button>
                  <label className="row small" title="Snap recorded hits to the nearest 16th"><input type="checkbox" checked={quantize} onChange={(e) => setQuantize(e.target.checked)} />Quantize</label>
                  <label className="row small" title="Hold a pad to repeat it in time (MPC note repeat)">Note repeat
                    <select className="sel" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatRate | "off")} aria-label="Note repeat">
                      <option value="off">Off</option>
                      {REPEAT_RATES.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
                    </select>
                  </label>
                  {rec && !playing && <span className="small faint">Press Space to start: hits record while it plays</span>}
                </div>
                <div className="pad-grid" style={level === "expert" ? { gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))" } : undefined}>
                  {pads.map((ch, i) => (
                    <button key={ch.id} className={`pad ${hit === ch.id ? "hit" : ""}`} style={{ ["--pad" as string]: ch.color || PAD_COLORS[i % 8], borderColor: selection.channelId === ch.id ? ch.color : undefined }}
                      onPointerDown={() => padDown(ch)} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} title={`${ch.name}${i < 8 ? ` — key ${i + 1}` : ""}`}>
                      <small>{i < 8 ? i + 1 : ""}</small>
                      <span>{ch.name}</span>
                    </button>
                  ))}
                </div>
              </ShowAt>
            )}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}><ChannelRack /></div>
      </div>
      {libOpen && <GrooveLibrary onClose={() => setLibOpen(false)} />}
    </div>
  );
}
