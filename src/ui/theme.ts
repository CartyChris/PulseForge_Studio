/** Theme colours for canvas-drawn editors (they can't use CSS variables directly). Re-read from
 * the document when the theme or accent changes; cheap to call every draw. */
export interface CanvasTheme { bg0: string; bg1: string; bg2: string; bg3: string; bg4: string; accent: string; accentRgb: [number, number, number]; text: string; cyan: string; yellow: string }

let cache: { key: string; t: CanvasTheme } | null = null;

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xff6a3d;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function canvasTheme(): CanvasTheme {
  const root = document.documentElement;
  const key = `${root.dataset.theme ?? ""}|${root.style.getPropertyValue("--ember")}`;
  if (cache && cache.key === key) return cache.t;
  const cs = getComputedStyle(root);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const accent = v("--ember", "#ff6a3d");
  const t: CanvasTheme = {
    bg0: v("--bg0", "#07080d"), bg1: v("--bg1", "#0d0f17"), bg2: v("--bg2", "#131620"), bg3: v("--bg3", "#1b1f2c"), bg4: v("--bg4", "#252a3b"),
    accent, accentRgb: rgbOf(accent), text: v("--text", "#eef0f7"), cyan: v("--cyan", "#3ec6ff"), yellow: v("--yellow", "#ffc94d"),
  };
  cache = { key, t };
  return t;
}

export function rgba([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}
