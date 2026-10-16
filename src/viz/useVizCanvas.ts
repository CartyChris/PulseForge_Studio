/** React binding for a visualizer canvas: owns the renderer and its frame loop, pauses when the
 * canvas is off-screen or the window is hidden, and optionally caps the frame rate. */
import { useEffect, useRef, type RefObject } from "react";
import { VizRenderer, type VizSettings } from "./renderer";
import { vizFeed, type VizFrame } from "./feed";

export interface VizCanvasOpts {
  scene: string;
  settings: VizSettings;
  maxDpr?: number;
  /** frame-rate cap (e.g. 30 for backdrops); 0 = display rate */
  fps?: number;
  /** render even while nothing is playing (idle motion); false = freeze when stopped */
  idle?: boolean;
  onFrame?: (f: VizFrame, r: VizRenderer) => void;
}

export function useVizCanvas(ref: RefObject<HTMLCanvasElement | null>, opts: VizCanvasOpts): RefObject<VizRenderer | null> {
  const renderer = useRef<VizRenderer | null>(null);
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const r = new VizRenderer(canvas, { maxDpr: o.current.maxDpr });
    renderer.current = r;
    let visible = true;
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); });
    io.observe(canvas);
    let raf = 0, last = 0, rendered = false;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const cur = o.current;
      if (!visible || document.hidden) return;
      if (cur.fps && ts - last < 1000 / cur.fps - 2) return;
      const f = vizFeed.get(ts);
      if (cur.idle === false && !f.playing && rendered) return;
      last = ts;
      r.setScene(cur.scene);
      r.settings = cur.settings;
      r.render(f);
      rendered = true;
      cur.onFrame?.(f, r);
    };
    raf = requestAnimationFrame(loop);
    // test/diagnostics hook: step a frame by hand (background tabs get no animation frames)
    const handle = { renderer: r, canvas, step: (ts = performance.now()) => { const cur = o.current; r.setScene(cur.scene); r.settings = cur.settings; const f = vizFeed.get(ts); r.render(f); cur.onFrame?.(f, r); return f; } };
    const reg = ((window as unknown as { __pfViz?: Set<typeof handle> }).__pfViz ??= new Set());
    reg.add(handle);
    return () => { cancelAnimationFrame(raf); io.disconnect(); reg.delete(handle); r.dispose(); renderer.current = null; };
  }, [ref]);

  return renderer;
}
