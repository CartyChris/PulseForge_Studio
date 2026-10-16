/**
 * The visualizer feed: one shared per-animation-frame snapshot of the music that every visual
 * (full-screen visualizer, top-bar LCD, Home backdrop, ambient glow) reads from. It fuses
 *   - the SONG: exact kick / snare / hat / bass / chord / lead hits from the project's event list,
 *     each channel's colour, the key-derived palette, beat & bar phase, the current section;
 *   - the SOUND: a 2048-point spectrum (log-binned), six bands, stereo waveforms, level, and
 *     spectral-flux onsets that stand in for roles the song data can't see (audio clips, samples).
 * Computed at most once per frame however many views read it.
 */
import { engine } from "../engine/engine";
import { useStudio } from "../state/store";
import { PPQ, ticksPerBar } from "../../shared/time";
import { bandEnergies, logSpectrum, levels, Envelope, OnsetDetector, AutoGain, type Bands } from "./analysis";
import { buildVizIndex, hitsBetween, paletteForKey, hexToRgb, type VizIndex, type VizHit, type VizPalette, type VizRole, type Rgb } from "./song";

export const SPEC_BINS = 128;
export const WAVE_LEN = 1024;
export const MAX_ORBS = 8;

export interface VizOrb { id: string; color: Rgb; role: VizRole; level: number; hits: number }

export interface VizFrame {
  time: number; dt: number; playing: boolean;
  bpm: number; ticks: number; beats: number; beatPhase: number; barPhase: number; bar: number; beatsPerBar: number;
  rms: number; peak: number; energy: number;
  bands: Bands;
  kick: number; snare: number; hat: number; cymbal: number; perc: number; bass: number; chords: number; lead: number; audio: number;
  /** pitch of the newest lead/bass note (for hue shifts), -1 if none yet */
  leadPitch: number; bassPitch: number;
  spectrum: Float32Array; peaks: Float32Array; waveL: Float32Array; waveR: Float32Array;
  orbs: VizOrb[];
  hits: VizHit[];
  palette: VizPalette;
  accent: Rgb;
  section: string; projectName: string; key: string; scale: string;
  index: VizIndex;
  /** the step grid being heard: the loop, or the current 4-bar window of the song */
  grid: VizIndex["grid"];
  /** playhead position within `grid` in steps (-100 when stopped) */
  stepPos: number;
}

const WINDOW_TICKS = 64 * 24;

const ROLE_ENV: Record<VizRole, [number, number]> = {
  kick: [0.004, 0.22], snare: [0.004, 0.26], hat: [0.002, 0.09], cymbal: [0.01, 0.9], perc: [0.003, 0.14],
  bass: [0.01, 0.35], chords: [0.02, 0.6], lead: [0.01, 0.35], pad: [0.05, 1.2], audio: [0.02, 0.5],
};

class Feed {
  private last = -1;
  private frame: VizFrame | null = null;
  private t0 = performance.now();
  private prevTicks = 0;
  private wasPlaying = false;
  private indexKey = "";
  private index: VizIndex | null = null;
  private envs = new Map<string, Envelope>();
  private bandEnv: Record<keyof Bands, Envelope> = {
    sub: new Envelope(0.02, 0.3), bass: new Envelope(0.02, 0.28), lowMid: new Envelope(0.02, 0.25),
    mid: new Envelope(0.015, 0.22), highMid: new Envelope(0.01, 0.18), air: new Envelope(0.008, 0.15),
  };
  private rmsEnv = new Envelope(0.02, 0.3);
  private bandAgc: Record<keyof Bands, AutoGain> = { sub: new AutoGain(), bass: new AutoGain(), lowMid: new AutoGain(), mid: new AutoGain(), highMid: new AutoGain(), air: new AutoGain() };
  private rmsAgc = new AutoGain(6, 3, 0.06);
  private peakEnv = new Envelope(0.001, 0.4);
  private onsetKick = new OnsetDetector(35, 150, 1.45, 0.02, 0.12);
  private onsetSnare = new OnsetDetector(1500, 5000, 1.5, 0.015, 0.12);
  private onsetHat = new OnsetDetector(7000, 15000, 1.5, 0.012, 0.06);
  /** last time (s) the song data delivered a hit per role: onsets only fill roles the song can't see */
  private songRoleAt = new Map<VizRole, number>();
  private chanEnv = new Map<string, { env: Envelope; hits: number }>();
  private specBuf: Float32Array<ArrayBuffer> | null = null;
  private waveBufL = new Float32Array(2048);
  private waveBufR = new Float32Array(2048);
  private spectrum = new Float32Array(SPEC_BINS);
  private peaks = new Float32Array(SPEC_BINS);
  private waveL = new Float32Array(WAVE_LEN);
  private waveR = new Float32Array(WAVE_LEN);
  private leadPitch = -1;
  private bassPitch = -1;
  private paletteKey = "";
  private palette: VizPalette = paletteForKey("C", "minor");
  private accentHex = "";
  private accent: Rgb = [1, 0.42, 0.24];
  private gridIdx: VizIndex | null = null;
  private gridWs = -1;
  private gridWin: VizIndex["grid"] | null = null;

  /** song mode: the 4-bar window under the playhead, rebuilt only when the window moves */
  private windowGrid(idx: VizIndex, ticks: number): { grid: VizIndex["grid"]; start: number } {
    if (idx.endTick <= WINDOW_TICKS + 1) return { grid: idx.grid, start: 0 };
    const ws = Math.floor(ticks / WINDOW_TICKS) * WINDOW_TICKS;
    if (ws !== this.gridWs || idx !== this.gridIdx || !this.gridWin) {
      this.gridWs = ws; this.gridIdx = idx;
      const rows = idx.grid.rows;
      const cells = new Float32Array(16 * 64);
      const rowOf = new Map(rows.map((r, i) => [r.id, i]));
      for (const h of idx.hits) {
        if (h.tick < ws) continue;
        if (h.tick >= ws + WINDOW_TICKS) break;
        const r = rowOf.get(h.channelId);
        if (r === undefined) continue;
        const st = Math.floor((h.tick - ws) / 24);
        cells[r * 64 + st] = Math.max(cells[r * 64 + st]!, h.velocity);
      }
      this.gridWin = { rows, steps: 64, cells };
    }
    return { grid: this.gridWin, start: ws };
  }

  private env(role: string): Envelope {
    let e = this.envs.get(role);
    if (!e) { const [a, r] = ROLE_ENV[role as VizRole] ?? [0.01, 0.3]; e = new Envelope(a, r); this.envs.set(role, e); }
    return e;
  }

  private indexProject: unknown = null;
  private indexBuiltAt = 0;
  /** rebuilt when the project (immutable: every edit is a new object), play mode or pattern
   * changes — at most 4×/s, so dragging a fader doesn't re-index the song every frame */
  private ensureIndex(): VizIndex {
    const st = useStudio.getState();
    const p = st.project;
    const key = `${p.id}|${st.playMode}|${st.selection.patternId}`;
    const now = performance.now();
    const stale = p !== this.indexProject && now - this.indexBuiltAt > 250;
    if (!this.index || key !== this.indexKey || stale) {
      this.indexKey = key;
      this.indexProject = p;
      this.indexBuiltAt = now;
      try { this.index = buildVizIndex(p, st.playMode, st.selection.patternId); }
      catch { this.index = { hits: [], endTick: 0, channels: [], grid: { rows: [], steps: 16, cells: new Float32Array(16 * 64) } }; }
    }
    return this.index;
  }

  /** A live hit that isn't in the song data (a pad tapped on the Visualizer or Beat page). */
  trigger(role: VizRole, velocity = 0.9, channelId?: string): void {
    this.env(role === "pad" ? "chords" : role).kick(0.55 + 0.45 * velocity);
    this.songRoleAt.set(role, (performance.now() - this.t0) / 1000);
    if (channelId) {
      let c = this.chanEnv.get(channelId);
      if (!c) { c = { env: new Envelope(0.005, 0.35), hits: 0 }; this.chanEnv.set(channelId, c); }
      c.env.kick(0.55 + 0.45 * velocity);
      c.hits++;
    }
  }

  /** The snapshot for this animation frame (pass the rAF timestamp). */
  get(now: number = performance.now()): VizFrame {
    if (this.frame && Math.abs(now - this.last) < 4) return this.frame;
    const dt = this.last < 0 ? 1 / 60 : Math.min(0.1, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const time = (now - this.t0) / 1000;
    const st = useStudio.getState();
    const p = st.project;
    const playing = engine.playing;
    const ticks = engine.positionTicks;
    const idx = this.ensureIndex();
    const tpb = ticksPerBar(p.timeSignature);

    if (`${p.key}|${p.scale}` !== this.paletteKey) { this.paletteKey = `${p.key}|${p.scale}`; this.palette = paletteForKey(p.key, p.scale); }
    const accentHex = getComputedStyleCached("--ember");
    if (accentHex !== this.accentHex) { this.accentHex = accentHex; this.accent = hexToRgb(accentHex || "#ff6a3d"); }

    // ── song hits since last frame ──
    let hits: VizHit[] = [];
    if (playing && this.wasPlaying && ticks !== this.prevTicks) {
      const wrapStart = st.playMode === "song" && p.loop.enabled ? p.loop.startTick : 0;
      hits = hitsBetween(idx, this.prevTicks, ticks, wrapStart);
    } else if (playing && !this.wasPlaying) {
      hits = idx.hits.filter((h) => Math.abs(h.tick - ticks) < 2); // starting exactly on a hit
    }
    this.prevTicks = ticks;
    this.wasPlaying = playing;
    for (const h of hits) {
      const v = 0.55 + 0.45 * h.velocity;
      const role = h.role === "pad" ? "chords" : h.role;
      this.env(role).kick(v);
      this.songRoleAt.set(h.role, time);
      if (h.role === "lead" || h.role === "chords") this.leadPitch = h.pitch;
      if (h.role === "bass") this.bassPitch = h.pitch;
      let c = this.chanEnv.get(h.channelId);
      if (!c) { c = { env: new Envelope(0.005, 0.35), hits: 0 }; this.chanEnv.set(h.channelId, c); }
      c.env.kick(v);
      c.hits++;
    }

    // ── audio analysis ──
    const tap = engine.initialized ? engine.getVizTap() : null;
    let bands: Bands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, air: 0 };
    let rms = 0, peak = 0;
    if (tap) {
      const n = tap.mono.frequencyBinCount;
      if (!this.specBuf || this.specBuf.length !== n) this.specBuf = new Float32Array(n);
      tap.mono.getFloatFrequencyData(this.specBuf);
      bands = bandEnergies(this.specBuf, tap.sampleRate, tap.mono.fftSize);
      logSpectrum(this.specBuf, tap.sampleRate, this.spectrum);
      tap.left.getFloatTimeDomainData(this.waveBufL);
      tap.right.getFloatTimeDomainData(this.waveBufR);
      // a 1024-sample window starting at a rising zero crossing, so scopes don't jitter
      let z = 0;
      for (let i = 1; i < 1024; i++) if (this.waveBufL[i - 1]! <= 0 && this.waveBufL[i]! > 0) { z = i; break; }
      for (let i = 0; i < WAVE_LEN; i++) { this.waveL[i] = this.waveBufL[z + i]!; this.waveR[i] = this.waveBufR[z + i]!; }
      const l = levels(this.waveBufL);
      rms = l.rms; peak = l.peak;
      const fresh = (role: VizRole) => time - (this.songRoleAt.get(role) ?? -99) > 2.5;
      const k = this.onsetKick.step(this.specBuf, tap.sampleRate, tap.mono.fftSize, time);
      if (k && fresh("kick")) this.env("kick").kick(0.5 + 0.5 * k);
      const s = this.onsetSnare.step(this.specBuf, tap.sampleRate, tap.mono.fftSize, time);
      if (s && fresh("snare")) this.env("snare").kick(0.45 + 0.5 * s);
      const hh = this.onsetHat.step(this.specBuf, tap.sampleRate, tap.mono.fftSize, time);
      if (hh && fresh("hat")) this.env("hat").kick(0.4 + 0.5 * hh);
    } else {
      this.spectrum.fill(0);
      this.waveL.fill(0); this.waveR.fill(0);
    }
    for (let i = 0; i < SPEC_BINS; i++) {
      const v = this.spectrum[i]!;
      this.peaks[i] = v > this.peaks[i]! ? v : Math.max(0, this.peaks[i]! - dt * 0.35);
    }
    // reactivity = a blend of absolute level and auto-gained movement, so loud masters still breathe
    const subMove = this.bandAgc.sub.step(bands.sub, dt);
    for (const b of Object.keys(this.bandEnv) as (keyof Bands)[]) {
      const moved = b === "sub" ? subMove : this.bandAgc[b].step(bands[b], dt);
      bands[b] = this.bandEnv[b].step(bands[b] * 0.35 + moved * 0.65, dt);
    }
    const rmsAbs = Math.min(1, rms * 2.2);
    const rmsS = this.rmsEnv.step(rmsAbs * 0.4 + this.rmsAgc.step(rmsAbs, dt) * 0.6, dt);
    const peakS = this.peakEnv.step(Math.min(1, peak), dt);
    // sub movement also drives the bass envelope (808 tails ring long after the note-on)
    const bassEnv = this.env("bass");
    bassEnv.step(subMove * 0.85, dt);

    const val = (r: VizRole) => this.env(r).step(0, dt);
    const kick = val("kick"), snare = val("snare"), hat = val("hat"), cymbal = val("cymbal"), perc = val("perc");
    const chords = val("chords"), lead = val("lead"), audio = val("audio");
    const bass = bassEnv.value;

    // ── per-channel orbs: the busiest channels, each in its own colour ──
    const chans = idx.channels;
    const orbs: VizOrb[] = [];
    for (const c of chans) {
      const ce = this.chanEnv.get(c.id);
      orbs.push({ id: c.id, color: hexToRgb(c.color), role: c.role, level: ce ? ce.env.step(0, dt) : 0, hits: ce?.hits ?? 0 });
    }
    orbs.sort((a, b) => b.hits - a.hits || (a.id < b.id ? -1 : 1));
    orbs.length = Math.min(orbs.length, MAX_ORBS);

    const beats = ticks / PPQ;
    const beatsPerBar = tpb / PPQ;
    const section = p.sections.find((s) => ticks >= s.startTick && ticks < s.startTick + s.lengthTicks)?.name ?? "";
    const win = this.windowGrid(idx, ticks);
    const energy = Math.min(1, rmsS * 0.6 + bands.bass * 0.25 + bands.mid * 0.25 + kick * 0.2);

    this.frame = {
      time, dt, playing, bpm: p.bpm, ticks, beats, beatPhase: beats % 1, barPhase: (ticks % tpb) / tpb, bar: Math.floor(ticks / tpb), beatsPerBar,
      rms: rmsS, peak: peakS, energy, bands,
      kick, snare, hat, cymbal, perc, bass, chords, lead, audio,
      leadPitch: this.leadPitch, bassPitch: this.bassPitch,
      spectrum: this.spectrum, peaks: this.peaks, waveL: this.waveL, waveR: this.waveR,
      orbs, hits, palette: this.palette, accent: this.accent,
      section, projectName: p.name, key: p.key, scale: p.scale, index: idx,
      grid: win.grid,
      stepPos: playing ? (ticks - win.start) / 24 % Math.max(1, win.grid.steps) : -100,
    };
    return this.frame;
  }
}

let cssCache = { at: 0, value: "" };
/** the accent colour, re-read at most twice a second (getComputedStyle is not free) */
function getComputedStyleCached(name: string): string {
  const now = performance.now();
  if (now - cssCache.at > 500 && typeof document !== "undefined") {
    cssCache = { at: now, value: getComputedStyle(document.documentElement).getPropertyValue(name).trim() };
  }
  return cssCache.value;
}

export const vizFeed = new Feed();
