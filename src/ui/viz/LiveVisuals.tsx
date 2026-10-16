/**
 * Small live visuals around the studio, all fed by the shared song-aware vizFeed:
 *   <LcdSpectrum/>  the top bar's "now playing" LCD: a mirrored spectrum + beat dots (Canvas2D)
 *   <AmbientGlow/>  a soft aurora behind the glass surfaces that breathes with kick and bass
 *   <VizBackdrop/>  a GPU scene behind a hero (Home), interactive, frame-capped
 * Everything pauses when hidden and respects Reduced Motion.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { vizFeed } from "../../viz/feed";
import { useVizPrefs } from "../../viz/prefs";
import { useVizCanvas } from "../../viz/useVizCanvas";
import { useStudio } from "../../state/store";

export function LcdSpectrum() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useStudio((s) => s.reducedMotion);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    let raf = 0, last = 0, drewIdle = false;
    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || ts - last < 30) return;
      last = ts;
      const f = vizFeed.get(ts);
      if (!f.playing && drewIdle) return;
      drewIdle = !f.playing;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (!w || !h) return;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      g.clearRect(0, 0, w, h);
      const [r, gg, b] = f.accent;
      const n = 28, gap = 2 * dpr, bw = (w / 2 - gap * n) / n;
      for (let i = 0; i < n; i++) {
        const v = f.playing ? Math.pow(f.spectrum[Math.floor((i / n) * 112)]!, 1.4) : 0.04;
        const bh = Math.max(dpr, v * h * 0.92);
        const a = 0.18 + 0.5 * v;
        g.fillStyle = `rgba(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0},${a})`;
        const x1 = w / 2 + i * (bw + gap) + gap / 2, x2 = w / 2 - (i + 1) * (bw + gap) + gap / 2;
        g.fillRect(x1, (h - bh) / 2, bw, bh);
        g.fillRect(x2, (h - bh) / 2, bw, bh);
      }
    };
    if (!reduced) raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return <canvas ref={ref} className="lcd-spectrum" aria-hidden="true" />;
}

/** beat dots for the LCD: the current beat of the bar lights up */
export function LcdBeats() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0, lastBeat = -1;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const f = vizFeed.get(ts);
      const beat = f.playing ? Math.floor(f.beats % f.beatsPerBar) : -1;
      if (beat === lastBeat || !ref.current) return;
      lastBeat = beat;
      [...ref.current.children].forEach((el, i) => el.classList.toggle("on", i === beat));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span className="lcd-beats" ref={ref} aria-hidden="true"><i /><i /><i /><i /></span>;
}

export function AmbientGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const on = useVizPrefs((s) => s.ambient);
  const reduced = useStudio((s) => s.reducedMotion);
  useEffect(() => {
    const el = ref.current;
    if (!el || !on || reduced) return;
    let raf = 0, last = 0, settled = false;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || ts - last < 33) return;
      last = ts;
      const f = vizFeed.get(ts);
      const live = f.playing ? Math.min(1, f.kick * 0.7 + f.bass * 0.35 + f.rms * 0.4) : 0;
      if (!f.playing && settled) return;
      settled = !f.playing;
      el.style.setProperty("--pulse", live.toFixed(3));
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.style.setProperty("--pulse", "0"); };
  }, [on, reduced]);
  return <div ref={ref} className={`ambient ${on ? "" : "off"}`} aria-hidden="true"><i className="a1" /><i className="a2" /><i className="a3" /></div>;
}

export function VizBackdrop({ scene = "nebula", intensity = 0.8, style }: { scene?: string; intensity?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const settings = useVizPrefs((s) => s.settings);
  const r = useVizCanvas(ref, { scene, settings: { ...settings, intensity: settings.intensity * intensity, grain: 0.02, aberration: 0.4, quality: 0.6 }, maxDpr: 1, fps: 30 });
  // the backdrop sits under the hero's content, so it listens on its parent
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const pos = (e: PointerEvent) => { const b = host.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height] as const; };
    const move = (e: PointerEvent) => { const [x, y] = pos(e); r.current?.setPointer(x, y, false); };
    const down = (e: PointerEvent) => { if ((e.target as HTMLElement).closest("button, textarea, input, a")) return; const [x, y] = pos(e); r.current?.burst(x, y, 0.8); };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerdown", down);
    return () => { host.removeEventListener("pointermove", move); host.removeEventListener("pointerdown", down); };
  }, [r]);
  return <canvas ref={ref} className="viz-backdrop" style={style} aria-hidden="true" />;
}
