/**
 * WebGL2 visualizer renderer. Per frame: scene pass into a half-float feedback target (reading
 * last frame as uPrev) → optional additive point pass → mipmaps → post pass (bloom from the mip
 * chain, chromatic aberration on kicks, ACES tone-map, vignette, grain) to the screen.
 * Resolution adapts to keep the frame rate up. Falls back to a Canvas2D spectrum when WebGL2 is
 * unavailable, so a visualizer never shows a blank box.
 */
import { SCENES, VERT_FULLSCREEN, POINT_FRAG, POST, type SceneDef } from "./scenes";
import { SPEC_BINS, WAVE_LEN, MAX_ORBS, type VizFrame } from "./feed";
import { hslToRgb, type Rgb } from "./song";

export type ColorMode = "song" | "accent" | "channels" | "rainbow" | "mono";

export interface VizSettings {
  intensity: number; // 0.3..1.6
  speed: number; // 0.2..2
  trails: number; // 0..1
  bloom: number; // 0..1.5
  grain: number; // 0..0.12
  aberration: number; // 0..2
  colorMode: ColorMode;
  /** 0.35..1 resolution cap; 0 = adaptive */
  quality: number;
}
export const DEFAULT_VIZ_SETTINGS: VizSettings = { intensity: 1, speed: 1, trails: 0.7, bloom: 0.8, grain: 0.035, aberration: 1, colorMode: "song", quality: 0 };

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const UNIFORMS_COMMON = [
  "uRes", "uTime", "uBeats", "uBeatPhase", "uBarPhase", "uPlaying", "uDt", "uKick", "uSnare", "uHat", "uCymbal", "uBass", "uChord", "uLead",
  "uRms", "uEnergy", "uPeak", "uBandsA", "uBandsB", "uColA", "uColB", "uColC", "uPointer", "uPointerDown", "uPointerVel", "uRipples",
  "uKickRings", "uOrbs", "uOrbCol", "uOrbCount", "uIntensity", "uSpeed", "uTrails", "uTravel", "uHueShift", "uSpec", "uWave", "uGrid",
  "uPrev", "uGridSteps", "uGridRows", "uStepPos", "uRowCol", "uDpr", "uBandsHi",
];

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? "";
    gl.deleteShader(s);
    throw new Error(log);
  }
  return s;
}
function link(gl: WebGL2RenderingContext, vs: string, fs: string, names: string[]): Prog {
  const p = gl.createProgram()!;
  const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link failed");
  const u = new Map<string, WebGLUniformLocation | null>();
  for (const n of names) u.set(n, gl.getUniformLocation(p, n));
  return { p, u };
}

interface Ripple { x: number; y: number; t0: number; s: number }

export class VizRenderer {
  readonly gl: WebGL2RenderingContext | null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private progs = new Map<string, { scene: Prog; points?: Prog }>();
  private post: Prog | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private targets: [Target, Target] | null = null;
  private ping = 0;
  private texSpec: WebGLTexture | null = null;
  private texWave: WebGLTexture | null = null;
  private texGrid: WebGLTexture | null = null;
  private specBytes = new Uint8Array(SPEC_BINS * 2);
  private waveBytes = new Uint8Array(WAVE_LEN * 2);
  private gridBytes = new Uint8Array(64 * 16);
  private halfFloat = false;
  private sceneId = SCENES[0]!.id;
  private prevSceneId = "";
  settings: VizSettings = { ...DEFAULT_VIZ_SETTINGS };
  private pointer = { x: 0, y: 0, down: 0, vx: 0, vy: 0, lastX: 0, lastY: 0 };
  private ripples: Ripple[] = [];
  private kickRings: { t0: number; s: number }[] = [];
  private lastKick = 0;
  private travel = 0;
  private orbState = new Map<string, { a: number; r: number; x: number; y: number }>();
  private scale = 1;
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private lost = false;
  readonly errors: string[] = [];
  /** cap on device pixels per CSS pixel */
  maxDpr: number;
  private hueTime = 0;

  constructor(private canvas: HTMLCanvasElement, opts: { maxDpr?: number } = {}) {
    this.maxDpr = opts.maxDpr ?? 1.5;
    let gl: WebGL2RenderingContext | null = null;
    try { gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }); } catch { gl = null; }
    this.gl = gl;
    if (!gl) { this.ctx2d = canvas.getContext("2d"); return; }
    this.halfFloat = !!gl.getExtension("EXT_color_buffer_float");
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.init();
  }

  private onLost = (e: Event) => { e.preventDefault(); this.lost = true; };
  private onRestored = () => { this.lost = false; this.progs.clear(); this.targets = null; this.init(); };

  private init(): void {
    const gl = this.gl!;
    this.vao = gl.createVertexArray();
    try { this.post = link(gl, VERT_FULLSCREEN, POST, ["uScene", "uRes", "uTime", "uKick", "uSnare", "uBloom", "uGrain", "uAberr", "uVignette", "uExposure", "uFlash"]); }
    catch (e) { this.errors.push(`post: ${String(e)}`); }
    const mk = (w: number, h: number, fmt: "R8") => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      void fmt;
      return t;
    };
    this.texSpec = mk(SPEC_BINS, 2, "R8");
    this.texWave = mk(WAVE_LEN, 2, "R8");
    this.texGrid = mk(64, 16, "R8");
    gl.bindTexture(gl.TEXTURE_2D, this.texGrid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private program(def: SceneDef): { scene: Prog; points?: Prog } | null {
    const gl = this.gl!;
    let pr = this.progs.get(def.id);
    if (pr) return pr;
    try {
      pr = { scene: link(gl, VERT_FULLSCREEN, def.frag, UNIFORMS_COMMON) };
      if (def.points) pr.points = link(gl, def.points.vert, POINT_FRAG, UNIFORMS_COMMON);
      this.progs.set(def.id, pr);
      return pr;
    } catch (e) {
      this.errors.push(`${def.id}: ${String(e)}`);
      console.warn(`[viz] scene ${def.id} failed to compile`, e);
      return null;
    }
  }

  /** compile every scene now (returns the ids that failed) */
  compileAll(): string[] {
    if (!this.gl) return [];
    return SCENES.filter((s) => !this.program(s)).map((s) => s.id);
  }

  setScene(id: string): void { if (SCENES.some((s) => s.id === id)) this.sceneId = id; }
  get scene(): string { return this.sceneId; }

  /** pointer in canvas-relative 0..1 coordinates (y down) */
  setPointer(nx: number, ny: number, down: boolean): void {
    const asp = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const x = (nx - 0.5) * asp, y = (0.5 - ny);
    this.pointer.vx = x - this.pointer.lastX; this.pointer.vy = y - this.pointer.lastY;
    this.pointer.lastX = x; this.pointer.lastY = y;
    this.pointer.x = x; this.pointer.y = y; this.pointer.down = down ? 1 : 0;
  }
  burst(nx: number, ny: number, strength = 1): void {
    const asp = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.ripples.push({ x: (nx - 0.5) * asp, y: 0.5 - ny, t0: performance.now() / 1000, s: strength });
    if (this.ripples.length > 4) this.ripples.shift();
  }

  private ensureTargets(w: number, h: number): void {
    const gl = this.gl!;
    if (this.targets && this.targets[0].w === w && this.targets[0].h === h) return;
    if (this.targets) for (const t of this.targets) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    const mk = (): Target => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, this.halfFloat ? gl.RGBA16F : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { fb, tex, w, h };
    };
    this.targets = [mk(), mk()];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private colors(f: VizFrame): [Rgb, Rgb, Rgb] {
    switch (this.settings.colorMode) {
      case "accent": return [f.accent, [0.55, 0.42, 1], [0.24, 0.78, 1]];
      case "channels": {
        const o = f.orbs.filter((x) => x.hits > 0);
        if (o.length >= 3) return [o[0]!.color, o[1]!.color, o[2]!.color];
        return [f.palette.a, f.palette.b, f.palette.c];
      }
      case "rainbow": {
        const h = this.hueTime * 24;
        return [hslToRgb(h, 0.9, 0.58), hslToRgb(h + 120, 0.9, 0.55), hslToRgb(h + 240, 0.9, 0.52)];
      }
      case "mono": return [[0.95, 0.96, 1], f.accent, [0.35, 0.38, 0.48]];
      default: return [f.palette.a, f.palette.b, f.palette.c];
    }
  }

  private updateOrbs(f: VizFrame, out: Float32Array, cols: Float32Array): number {
    const n = Math.min(MAX_ORBS, f.orbs.length);
    const t = f.time * this.settings.speed;
    for (let i = 0; i < n; i++) {
      const o = f.orbs[i]!;
      let s = this.orbState.get(o.id);
      if (!s) { s = { a: (i / Math.max(1, n)) * Math.PI * 2, r: 0.18 + 0.05 * (i % 3), x: 0, y: 0 }; this.orbState.set(o.id, s); }
      // kick sits in the middle; everything else orbits at a role-dependent radius and speed
      const central = o.role === "kick";
      const orbitR = central ? 0.02 : o.role === "bass" ? 0.16 : o.role === "snare" ? 0.24 : 0.3 + 0.03 * (i % 3);
      s.a += f.dt * (central ? 0.2 : 0.12 + 0.05 * (i % 4)) * this.settings.speed * (1 + f.energy);
      let tx = Math.cos(s.a) * orbitR * 1.25 + Math.sin(t * 0.3 + i) * 0.03;
      let ty = Math.sin(s.a) * orbitR * 0.85 + Math.cos(t * 0.27 + i * 1.7) * 0.03;
      // the pointer pulls orbs toward it
      const dx = this.pointer.x - tx, dy = this.pointer.y - ty;
      const pull = (0.12 + 0.5 * this.pointer.down) / (1 + 12 * (dx * dx + dy * dy));
      tx += dx * pull; ty += dy * pull;
      const k = 1 - Math.exp(-f.dt * 5);
      s.x += (tx - s.x) * k; s.y += (ty - s.y) * k;
      const radius = (central ? 0.075 : 0.045) * (1 + 0.6 * o.level * this.settings.intensity) + (o.hits > 0 ? 0.01 : 0);
      out.set([s.x, s.y, radius, o.level], i * 4);
      cols.set(o.color, i * 3);
    }
    return n;
  }

  /** render one frame of the visualizer */
  render(f: VizFrame): void {
    if (this.lost) return;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw < 2 || ch < 2) return;
    const nowMs = performance.now();
    if (this.lastFrameAt) {
      this.frameTimes.push(nowMs - this.lastFrameAt);
      if (this.frameTimes.length >= 40) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.frameTimes = [];
        if (!this.settings.quality) {
          if (avg > 24 && this.scale > 0.45) this.scale *= 0.82;
          else if (avg < 15 && this.scale < 1) this.scale = Math.min(1, this.scale * 1.1);
        }
      }
    }
    this.lastFrameAt = nowMs;
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1) * (this.settings.quality || this.scale);
    const w = Math.max(2, Math.round(cw * dpr)), h = Math.max(2, Math.round(ch * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.hueTime += f.dt;
    if (!this.gl) return this.render2d(f, w, h);

    const gl = this.gl;
    const def = SCENES.find((s) => s.id === this.sceneId) ?? SCENES[0]!;
    const prog = this.program(def);
    if (!prog || !this.post) return;
    this.ensureTargets(w, h);
    const [A, B] = this.targets!;
    const cur = this.ping ? B : A, prev = this.ping ? A : B;
    this.ping ^= 1;
    if (this.prevSceneId !== def.id) {
      // a new scene starts from a clean feedback buffer
      for (const t of this.targets!) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      this.prevSceneId = def.id;
    }

    // data textures
    for (let i = 0; i < SPEC_BINS; i++) { this.specBytes[i] = f.spectrum[i]! * 255; this.specBytes[SPEC_BINS + i] = f.peaks[i]! * 255; }
    for (let i = 0; i < WAVE_LEN; i++) {
      this.waveBytes[i] = Math.max(0, Math.min(255, (f.waveL[i]! * 0.5 + 0.5) * 255));
      this.waveBytes[WAVE_LEN + i] = Math.max(0, Math.min(255, (f.waveR[i]! * 0.5 + 0.5) * 255));
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texSpec);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEC_BINS, 2, gl.RED, gl.UNSIGNED_BYTE, this.specBytes);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWave);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE_LEN, 2, gl.RED, gl.UNSIGNED_BYTE, this.waveBytes);
    const grid = f.grid;
    if (def.id === "matrix") {
      for (let i = 0; i < 64 * 16; i++) this.gridBytes[i] = grid.cells[i]! * 255;
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texGrid);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 16, gl.RED, gl.UNSIGNED_BYTE, this.gridBytes);
    } else {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texGrid);
    }
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, prev.tex);

    // motion state
    const nowS = nowMs / 1000;
    if (f.kick > 0.6 && this.lastKick <= 0.6) { this.kickRings.push({ t0: nowS, s: f.kick }); if (this.kickRings.length > 6) this.kickRings.shift(); }
    this.lastKick = f.kick;
    this.travel += f.dt * this.settings.speed * (0.25 + (f.playing ? (f.bpm / 120) * (0.6 + 1.4 * f.energy) : 0.15));
    const ripples = new Float32Array(16).fill(-1);
    this.ripples = this.ripples.filter((r) => nowS - r.t0 < 2.5);
    this.ripples.forEach((r, i) => ripples.set([r.x, r.y, nowS - r.t0, r.s], i * 4));
    const rings = new Float32Array(24).fill(-1);
    this.kickRings = this.kickRings.filter((r) => nowS - r.t0 < 2);
    this.kickRings.forEach((r, i) => rings.set([nowS - r.t0, r.s, 0, 0], i * 4));
    const orbs = new Float32Array(MAX_ORBS * 4), orbCols = new Float32Array(MAX_ORBS * 3);
    const orbCount = def.id === "orbs" ? this.updateOrbs(f, orbs, orbCols) : 0;
    const rowCols = new Float32Array(16 * 3);
    grid.rows.forEach((r, i) => { const c = hexToRgbFast(r.color); rowCols.set(c, i * 3); });
    const [ca, cb, cc] = this.colors(f);
    const stepPos = f.stepPos;
    const hueShift = f.leadPitch >= 0 && this.settings.colorMode === "song" ? ((f.leadPitch % 12) / 12) * 0.12 : 0;
    const s = this.settings;
    this.pointer.vx *= 0.9; this.pointer.vy *= 0.9;

    const setCommon = (pr: Prog) => {
      const u = (n: string) => pr.u.get(n) ?? null;
      gl.uniform2f(u("uRes"), w, h);
      gl.uniform1f(u("uTime"), f.time);
      gl.uniform1f(u("uDt"), f.dt);
      gl.uniform1f(u("uBeats"), f.beats);
      gl.uniform1f(u("uBeatPhase"), f.beatPhase);
      gl.uniform1f(u("uBarPhase"), f.barPhase);
      gl.uniform1f(u("uPlaying"), f.playing ? 1 : 0);
      gl.uniform1f(u("uKick"), f.kick);
      gl.uniform1f(u("uSnare"), f.snare);
      gl.uniform1f(u("uHat"), f.hat);
      gl.uniform1f(u("uCymbal"), f.cymbal);
      gl.uniform1f(u("uBass"), f.bass);
      gl.uniform1f(u("uChord"), f.chords);
      gl.uniform1f(u("uLead"), f.lead);
      gl.uniform1f(u("uRms"), f.rms);
      gl.uniform1f(u("uEnergy"), f.energy);
      gl.uniform1f(u("uPeak"), f.peak);
      gl.uniform4f(u("uBandsA"), f.bands.sub, f.bands.bass, f.bands.lowMid, f.bands.mid);
      gl.uniform2f(u("uBandsB"), f.bands.highMid, f.bands.air);
      gl.uniform1f(u("uBandsHi"), f.bands.air);
      gl.uniform3fv(u("uColA"), ca); gl.uniform3fv(u("uColB"), cb); gl.uniform3fv(u("uColC"), cc);
      gl.uniform2f(u("uPointer"), this.pointer.x, this.pointer.y);
      gl.uniform1f(u("uPointerDown"), this.pointer.down);
      gl.uniform2f(u("uPointerVel"), this.pointer.vx, this.pointer.vy);
      gl.uniform4fv(u("uRipples"), ripples);
      gl.uniform4fv(u("uKickRings"), rings);
      gl.uniform4fv(u("uOrbs"), orbs);
      gl.uniform3fv(u("uOrbCol"), orbCols);
      gl.uniform1i(u("uOrbCount"), orbCount);
      gl.uniform1f(u("uIntensity"), s.intensity);
      gl.uniform1f(u("uSpeed"), s.speed);
      gl.uniform1f(u("uTrails"), s.trails);
      gl.uniform1f(u("uTravel"), this.travel);
      gl.uniform1f(u("uHueShift"), hueShift);
      gl.uniform1i(u("uSpec"), 0); gl.uniform1i(u("uWave"), 1); gl.uniform1i(u("uGrid"), 2); gl.uniform1i(u("uPrev"), 3);
      gl.uniform1f(u("uGridSteps"), grid.steps);
      gl.uniform1f(u("uGridRows"), Math.max(1, grid.rows.length));
      gl.uniform1f(u("uStepPos"), stepPos);
      gl.uniform3fv(u("uRowCol"), rowCols);
      gl.uniform1f(u("uDpr"), dpr);
    };

    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.scene.p);
    setCommon(prog.scene);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (prog.points && def.points) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(prog.points.p);
      setCommon(prog.points);
      gl.drawArrays(gl.POINTS, 0, def.points.count);
      gl.disable(gl.BLEND);
    }
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // post → screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.post.p);
    const pu = (n: string) => this.post!.u.get(n) ?? null;
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(pu("uScene"), 4);
    gl.uniform2f(pu("uRes"), w, h);
    gl.uniform1f(pu("uTime"), f.time);
    gl.uniform1f(pu("uKick"), f.kick);
    gl.uniform1f(pu("uSnare"), f.snare);
    gl.uniform1f(pu("uBloom"), s.bloom);
    gl.uniform1f(pu("uGrain"), s.grain);
    gl.uniform1f(pu("uAberr"), s.aberration);
    gl.uniform1f(pu("uVignette"), 0.9);
    gl.uniform1f(pu("uExposure"), 0.95);
    gl.uniform1f(pu("uFlash"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Canvas2D fallback: mirrored spectrum + waveform halo in the palette colours */
  private render2d(f: VizFrame, w: number, h: number): void {
    const g = this.ctx2d;
    if (!g) return;
    const [a, b] = this.colors(f);
    const css = (c: Rgb, al = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${al})`;
    g.fillStyle = "rgba(5,6,10,0.35)";
    g.fillRect(0, 0, w, h);
    const n = 64, bw = w / n / 2;
    for (let i = 0; i < n; i++) {
      const v = f.spectrum[Math.floor((i / n) * 120)]! * h * 0.6 * this.settings.intensity;
      g.fillStyle = css(i % 2 ? a : b, 0.85);
      g.fillRect(w / 2 + i * bw, h - v, bw - 1, v);
      g.fillRect(w / 2 - (i + 1) * bw, h - v, bw - 1, v);
    }
    g.strokeStyle = css(a, 0.9);
    g.lineWidth = 2;
    g.beginPath();
    const R = Math.min(w, h) * (0.18 + 0.05 * f.kick);
    for (let i = 0; i <= 256; i++) {
      const ang = (i / 256) * Math.PI * 2, r = R + f.waveL[(i * 4) % WAVE_LEN]! * R * 0.4;
      const x = w / 2 + Math.cos(ang) * r, y = h * 0.45 + Math.sin(ang) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }

  /** a small JPEG of the current frame (scene thumbnails) */
  snapshot(): string { try { return this.canvas.toDataURL("image/jpeg", 0.7); } catch { return ""; } }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    if (!gl) return;
    for (const pr of this.progs.values()) { gl.deleteProgram(pr.scene.p); if (pr.points) gl.deleteProgram(pr.points.p); }
    if (this.post) gl.deleteProgram(this.post.p);
    if (this.targets) for (const t of this.targets) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    for (const t of [this.texSpec, this.texWave, this.texGrid]) if (t) gl.deleteTexture(t);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.progs.clear(); this.targets = null; this.post = null;
    // no loseContext(): a remount (React StrictMode, HMR) gets the same canvas context back
  }
}

const rgbCache = new Map<string, Rgb>();
function hexToRgbFast(hex: string): Rgb {
  let c = rgbCache.get(hex);
  if (!c) {
    const m = /^#?([0-9a-f]{6})/i.exec(hex);
    const n = m ? parseInt(m[1]!, 16) : 0x8b6cff;
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    rgbCache.set(hex, c);
  }
  return c;
}
