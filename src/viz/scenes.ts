/**
 * Visualizer scenes — GLSL ES 3.00 fragment programs (plus an optional point-sprite pass) that
 * share one uniform prelude. Every scene reads the same song-aware inputs: per-role hit envelopes
 * (uKick, uSnare, …), six bands, a log spectrum + peak texture, stereo waveforms, the step grid of
 * the loop, per-channel orbs in their channel colours, the key palette, the pointer and ripples.
 * Scenes draw into a float feedback buffer (uPrev = last frame) so trails are per-scene choices.
 */

export interface SceneDef {
  id: string;
  name: string;
  blurb: string;
  /** GLSL ES 3.00 fragment program (PRELUDE + main) */
  frag: string;
  /** optional additive point pass: vertex shader + point count */
  points?: { vert: string; count: number };
  /** energy band this scene suits, used by Auto */
  mood: "calm" | "groove" | "hype";
}

export const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime, uBeats, uBeatPhase, uBarPhase, uPlaying, uDt;
uniform float uKick, uSnare, uHat, uCymbal, uBass, uChord, uLead, uRms, uEnergy, uPeak;
uniform vec4 uBandsA; // sub, bass, lowMid, mid
uniform vec2 uBandsB; // highMid, air
uniform vec3 uColA, uColB, uColC;
uniform vec2 uPointer;
uniform float uPointerDown;
uniform vec2 uPointerVel;
uniform vec4 uRipples[4]; // xy, age (s, <0 = unused), strength
uniform vec4 uKickRings[6]; // x = age (s, <0 = unused), y = strength
uniform vec4 uOrbs[8]; // xy, radius, level
uniform vec3 uOrbCol[8];
uniform int uOrbCount;
uniform float uIntensity, uSpeed, uTrails, uTravel, uHueShift;
uniform sampler2D uSpec;  // 128×2: row 0 spectrum, row 1 peaks
uniform sampler2D uWave;  // 1024×2: row 0 left, row 1 right (0.5 = zero)
uniform sampler2D uGrid;  // 64×16 step grid (velocity)
uniform sampler2D uPrev;  // last frame (feedback)
uniform float uGridSteps, uGridRows, uStepPos;
uniform vec3 uRowCol[16];

#define PI 3.14159265359
#define TAU 6.28318530718
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; mat2 r = mat2(.8, .6, -.6, .8); for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02 + .13; a *= .5; } return v; }
float fbm3(vec2 p) { float v = 0., a = .5; mat2 r = mat2(.8, .6, -.6, .8); for (int i = 0; i < 3; i++) { v += a * noise(p); p = r * p * 2.02 + .13; a *= .5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float spec(float x) { return texture(uSpec, vec2(clamp(x, 0., 1.), .25)).r; }
float peakAt(float x) { return texture(uSpec, vec2(clamp(x, 0., 1.), .75)).r; }
float wave(float x, float ch) { return texture(uWave, vec2(x, ch < .5 ? .25 : .75)).r * 2. - 1.; }
vec3 pal(float t) {
  t = fract(t + uHueShift);
  return t < .3333 ? mix(uColA, uColB, t * 3.) : t < .6667 ? mix(uColB, uColC, (t - .3333) * 3.) : mix(uColC, uColA, (t - .6667) * 3.);
}
vec2 cuv() { return (vUv - .5) * vec2(uRes.x / uRes.y, 1.); }
float aspect() { return uRes.x / uRes.y; }
float ripples(vec2 p) {
  float r = 0.;
  for (int i = 0; i < 4; i++) {
    vec4 R = uRipples[i];
    if (R.z < 0.) continue;
    float d = length(p - R.xy);
    r += R.w * exp(-R.z * 2.4) * smoothstep(.05, 0., abs(d - R.z * .85));
  }
  return r;
}
float glowLine(float d, float w) { return w / (abs(d) + w * .6); }
`;

export const VERT_FULLSCREEN = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
out vec2 vUv;
void main() { vec2 p = P[gl_VertexID]; vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }
`;

/** Classic Flow — an homage to the iTunes visualizer: luminous ribbons in a zooming, spinning feedback tunnel. */
const FLOW = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  vec2 q = vUv - .5;
  float zoom = 1. - (.003 + .014 * uKick * uIntensity + .004 * uBass) * uSpeed;
  q = rot(.002 * uSpeed + .01 * (uBandsA.y - .3) * sin(uTime * .21)) * q * zoom;
  q += .0012 * vec2(sin(uTime * .63), cos(uTime * .47)) + uPointerVel * .02;
  vec3 prev = texture(uPrev, q + .5).rgb;
  prev *= .78 + .14 * uTrails;
  prev = mix(prev, prev.gbr, .015); // slow hue drift in the trails
  vec3 col = vec3(0.);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float amp = .06 + .2 * spec(.04 + fi * .11) * uIntensity;
    float x = p.x;
    float y = amp * sin(x * (2.1 + fi * .63) + uTime * (.55 + fi * .13) * uSpeed + fi * 1.9) * cos(x * 1.27 - uTime * .37 + fi);
    y += .04 * wave(fract(x * .35 + .5 + fi * .13), mod(fi, 2.)) * (1. + 2.5 * uRms);
    y += (fi - 2.5) * .04 * sin(uTime * .19 + fi);
    float d = abs(p.y - y);
    float w = .0022 + .003 * uEnergy + .002 * uKick;
    float core = exp(-d / w);
    float halo = exp(-d / (w * 9.)) * .18;
    col += pal(fi * .16 + uTime * .025) * (core + halo) * (.3 + .8 * uRms + .7 * uKick + .2 * uLead);
  }
  col *= .5 * uIntensity;
  col += pal(.62) * .004 / (length(p - uPointer) + .02) * (.2 + uPointerDown);
  col += ripples(p) * pal(.33) * 1.2;
  outColor = vec4(prev + col, 1.);
}`;

/** Nebula — domain-warped gas clouds in the key's colours; the core swells with the kick, stars twinkle on the hats. */
const NEBULA = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  vec2 m = uPointer * .55;
  p *= 1.5 - .25 * uKick * uIntensity;
  float t = uTime * .045 * uSpeed;
  vec2 q = vec2(fbm(p * 1.15 + t), fbm(p * 1.15 - t + 3.1));
  vec2 r = vec2(fbm(p * 1.6 + 2. * q + vec2(1.7, 9.2) + t * 1.4 + m), fbm(p * 1.6 + 2. * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.35 + 2.4 * r);
  float dens = smoothstep(.38, .9, f);
  float wisp = smoothstep(.55, .95, fbm(p * 3.1 + 3. * r - t));
  vec3 col = uColC * .22 * smoothstep(.15, .6, f);
  col = mix(col, uColA, dens);
  col = mix(col, uColB, clamp(length(q) - .45, 0., 1.) * dens);
  col *= .2 + 1.1 * dens + (.35 * uBandsA.y + .45 * uKick + .2 * uChord) * dens;
  col += mix(uColB, vec3(1.), .25) * wisp * (.25 + .5 * uHat + .3 * uBandsB.x);
  float core = exp(-length(p - m * .6) * 2.6) * (.18 + .9 * uKick + .3 * uRms);
  col += core * mix(uColA, vec3(1.), .35);
  vec2 g = floor(vUv * uRes / 2.5);
  float s = hash12(g);
  float star = step(.9975, s) * (.45 + .55 * sin(uTime * (2. + s * 4.) + s * 90.)) * (.4 + 2. * uHat + .5 * uBandsB.y);
  col += star;
  col += ripples(p) * uColB * 1.5;
  vec3 prev = texture(uPrev, vUv).rgb;
  outColor = vec4(mix(col * uIntensity * .75, prev, .3 * uTrails), 1.);
}`;

/** Skyline — synthwave: a striped sun that pumps with the kick, a mirrored spectrum city and an endless grid driven by the tempo. */
const SKYLINE = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  float horizon = -.04;
  vec3 col = mix(uColC * .1, uColA * .32 + uColB * .1, smoothstep(-.05, .55, p.y));
  col += vec3(.02, .0, .04) * (1. - smoothstep(-.1, .5, p.y));
  vec2 sp = p - vec2(uPointer.x * .12, .13 + uPointer.y * .03);
  float sr = .19 + .025 * uKick * uIntensity;
  float sd = length(sp);
  float band = sp.y < .02 ? step(.42 + .25 * (.02 - sp.y) * 6., fract((sp.y - uTime * .015) * 26.)) : 1.;
  vec3 sunCol = mix(uColB * 1.25 + .1, mix(uColA, vec3(1., .95, .7), .45), smoothstep(-.18, .2, sp.y));
  col = mix(col, sunCol, smoothstep(sr, sr - .004, sd) * band);
  col += uColA * .025 / (abs(sd - sr) + .025) * (.25 + .9 * uKick);
  if (p.y > horizon) {
    float hw = aspect() * .5;
    float x = abs(p.x) / hw;
    float n = 56.;
    float b = floor(x * n) / n;
    float h = spec(b * .9 + .02) * .34 * uIntensity + .004;
    float pk = peakAt(b * .9 + .02) * .34 * uIntensity + .006;
    float y = p.y - horizon;
    float gap = step(.14, fract(x * n));
    float bar = step(y, h) * gap;
    vec3 bc = mix(uColC * 1.1, uColB * 1.3, y / max(h, .01));
    col = mix(col, bc + .15 * uSnare, bar * .92);
    col += gap * smoothstep(.004, .0, abs(y - pk)) * mix(uColA, vec3(1.), .5);
  } else {
    float d = horizon - p.y;
    float z = .22 / d;
    vec2 g = vec2(p.x * z * 1.6, (z + uTravel) * 1.2);
    vec2 fw = fwidth(g);
    vec2 gd = abs(fract(g - .5) - .5) / max(fw, 1e-4);
    float line = 1. - min(min(gd.x, gd.y), 1.);
    float fade = smoothstep(0., .22, d);
    col = mix(uColC * .04, uColA * .06, fade);
    col += line * mix(uColB, uColA, .4) * (.55 + 1.2 * uKick) * (.25 + fade);
    // the sun and the city reflected in the floor
    col += sunCol * .22 * exp(-abs(p.x - uPointer.x * .12) * 6.) * exp(-d * 9.) * (.5 + uKick);
  }
  col += uColB * exp(-abs(p.y - horizon) * 60.) * (.5 + .8 * uBandsA.y);
  col += ripples(p) * uColA;
  outColor = vec4(col, 1.);
}`;

/** Halo — a radial spectrum crown around a breathing core, waveform ring inside, shockwaves on every kick. */
const HALO = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv() - uPointer * .07;
  float r = length(p);
  float a = atan(p.y, p.x);
  float aa = fract((a + uTime * .08 * uSpeed + uBarPhase * .25) / TAU);
  float sx = abs(aa * 2. - 1.);
  float sv = spec(sx * .88 + .03);
  float R0 = .16 + .03 * uKick * uIntensity + .015 * uBandsA.y;
  float bars = 120.;
  float cell = fract(aa * bars);
  float mask = smoothstep(.5, .32, abs(cell - .5));
  float len = sv * .22 * uIntensity + .003;
  vec3 c = pal(sx * .55 + uTime * .015);
  vec3 col = vec3(0.);
  float inBar = step(R0, r) * step(r, R0 + len) * mask;
  col += inBar * c * (.45 + .5 * smoothstep(R0, R0 + len, r) + .4 * uKick);
  col += c * exp(-abs(r - (R0 + len)) * 160.) * mask * sv * .6;
  float pr = R0 + peakAt(sx * .88 + .03) * .22 * uIntensity + .012;
  col += mask * smoothstep(.003, 0., abs(r - pr)) * mix(c, vec3(1.), .5) * .7;
  float wv = wave(fract(aa), step(.5, fract(aa * 2.)));
  float wr = R0 - .035 + wv * .045 * (1. + 2. * uRms);
  col += mix(uColB, vec3(1.), .3) * exp(-abs(r - wr) * 400.) * .8;
  col += uColA * smoothstep(R0 - .01, R0 - .12, r) * (.04 + .25 * uKick + .08 * uBandsA.x);
  col += mix(uColA, vec3(1.), .5) * exp(-r * 45.) * (.25 + .6 * uSnare);
  for (int i = 0; i < 6; i++) {
    vec4 k = uKickRings[i];
    if (k.x < 0.) continue;
    float rr = R0 + k.x * .75;
    col += pal(.12 * float(i) + .3) * k.y * exp(-k.x * 2.4) * exp(-abs(r - rr) * 220.) * .7;
  }
  vec2 q = (vUv - .5) * (.992 - .006 * uKick) + .5;
  vec3 prev = texture(uPrev, q).rgb * (.35 + .35 * uTrails);
  outColor = vec4(prev + col + ripples(p) * uColC, 1.);
}`;

/** Warp — fly down a tunnel woven from the spectrum; speed follows the energy, snares flash the walls. */
const WARP = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  p += uPointer * .18 * (1. - length(p));
  float r = length(p) + 1e-3;
  float a = atan(p.y, p.x);
  float depth = .3 / r + uTravel * 1.6;
  float tw = a / PI * 4. + uTime * .04 * uSpeed + .12 / r * sin(uTime * .17);
  vec2 g = vec2(tw * 3., depth * 2.2);
  vec2 f = abs(fract(g) - .5);
  vec2 fw = max(fwidth(g), 1e-4);
  float dl = min((.5 - f.x) / fw.x, (.5 - f.y) / fw.y);
  float line = 1. - smoothstep(0., 1.6, dl);
  float halo = (1. - smoothstep(0., 9., dl)) * .25;
  float ring = spec(fract(depth * .06));
  float cellId = hash12(floor(g));
  float tile = step(.8, cellId) * (.35 + 1.4 * uHat) * (.5 + .5 * sin(cellId * 40. + uTime * 2.));
  float fade = smoothstep(.02, .3, r);
  vec3 c = pal(depth * .05 + tw * .03);
  vec3 col = c * ((line + halo) * (.7 + 1.4 * uKick + .5 * uBandsA.y) * (.6 + ring) + tile * .3) * fade;
  col += c * ring * .12 * fade;
  col += mix(uColA, vec3(1.), .5) * exp(-r * 12.) * (.3 + 1.4 * uSnare + .3 * uRms);
  col *= 1. + .8 * uSnare * smoothstep(.25, .9, r);
  col *= uIntensity;
  vec3 prev = texture(uPrev, (vUv - .5) * 1.01 + .5).rgb;
  outColor = vec4(col + prev * .3 * uTrails + ripples(p) * uColB, 1.);
}`;

/** Phosphor — a glowing analog scope: a stereo / phase portrait of the waveform drawn as a beam with phosphor decay. */
const PHOSPHOR = PRELUDE + /* glsl */ `
void main() {
  vec2 q = (vUv - .5) * (.997 - .004 * uKick) + .5;
  vec3 prev = texture(uPrev, q).rgb;
  prev *= .74 + .18 * uTrails;
  prev = mix(prev, prev.brg, .02);
  vec2 p = cuv();
  vec2 gp = abs(fract(p * 6. + .5) - .5);
  vec3 grid = uColC * .012 * smoothstep(.01, 0., min(gp.x, gp.y));
  grid += uColC * .025 * smoothstep(.003, 0., min(abs(p.x), abs(p.y)));
  outColor = vec4(prev + grid + ripples(p) * uColA, 1.);
}`;
const PHOSPHOR_POINTS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uWave;
uniform vec2 uRes;
uniform float uTime, uKick, uRms, uPeak, uIntensity, uDpr, uBeats;
uniform vec3 uColA, uColB, uColC;
uniform vec2 uPointer;
out vec3 vCol;
void main() {
  float half_ = 4096.;
  float id = float(gl_VertexID);
  float gain = .55 / max(uPeak, .08) * (.75 + .35 * uIntensity);
  vec2 xy;
  if (id < half_) {
    // polar scope: the waveform wrapped around a ring that breathes with the kick
    float u = id / half_;
    float l = texture(uWave, vec2(u, .25)).r * 2. - 1.;
    float ang = u * 6.2831853 + uBeats * .25;
    float rad = .36 + .05 * uKick + l * .2 * gain;
    xy = vec2(cos(ang), sin(ang)) * rad;
    vCol = mix(uColA, uColB, u) * (.22 + .25 * uRms) * (1. + .8 * uKick);
  } else {
    // XY / phase portrait in the middle (stereo where there is any, a delay embedding for mono)
    float u = (id - half_) / half_;
    float l = texture(uWave, vec2(u * .75, .25)).r * 2. - 1.;
    float r = texture(uWave, vec2(u * .75, .75)).r * 2. - 1.;
    float d = texture(uWave, vec2(u * .75 + .2, .25)).r * 2. - 1.;
    float stereo = clamp(abs(l - r) * 6., 0., 1.);
    xy = mix(vec2(l, d), vec2(l, r), stereo) * .3 * gain;
    xy = mat2(.7071, -.7071, .7071, .7071) * xy;
    vCol = mix(uColB, uColC, u) * (.24 + .25 * uRms);
  }
  xy += uPointer * .25;
  xy.x *= uRes.y / uRes.x;
  gl_Position = vec4(xy * 1.8, 0., 1.);
  gl_PointSize = (1.5 + 1.5 * uKick) * uDpr;
}`;

/** Kaleido — a kaleidoscope folding fractal clouds and spectrum rings; it changes facets every four bars. */
const KALEIDO = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  float seg = 6. + 2. * floor(mod(uBeats / 16., 4.));
  float r = length(p);
  float a = atan(p.y, p.x) + uTime * .04 * uSpeed + uKick * .02;
  float s = TAU / seg;
  a = mod(a, s); a = abs(a - s * .5);
  vec2 q = vec2(cos(a), sin(a)) * r;
  q *= 2.4 - .5 * uKick * uIntensity;
  q += uPointer * .6;
  float t = uTime * .09 * uSpeed;
  float f = fbm(q * 1.4 + vec2(t, -t * .7) + fbm3(q * 2.1 - t) * 1.6);
  float shape = smoothstep(.48, .78, f);
  float edge = smoothstep(.02, 0., abs(f - .6)) * .8;
  float rings = smoothstep(.85, 1., sin(r * 30. - uBeats * PI) * .5 + .5);
  vec3 col = pal(f * 1.3 + r * .35 + uTime * .02) * (shape * (.55 + .5 * uBandsA.y) + edge * (.4 + uHat));
  col += pal(r + .3) * rings * spec(r * 1.4) * .7;
  col += pal(.5) * uKick * exp(-r * 4.) * .6;
  col += pal(.8) * uSnare * .25 * smoothstep(.5, .0, abs(fract(r * 4. - uBeats) - .5)) * shape;
  col *= uIntensity * .85;
  vec3 prev = texture(uPrev, (vUv - .5) * .995 + .5).rgb;
  outColor = vec4(mix(col, prev, .35 * uTrails) + ripples(p) * uColA, 1.);
}`;

/** Orbs — your mix as liquid light: each instrument is a glowing metaball in its channel colour, pulsing on its own hits. */
const ORBS = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  float field = 0.;
  vec3 cacc = vec3(0.);
  vec2 grad = vec2(0.);
  float lit = 0.;
  for (int i = 0; i < 8; i++) {
    if (i >= uOrbCount) break;
    vec4 o = uOrbs[i];
    vec2 d = p - o.xy;
    float dd = dot(d, d) + 1e-4;
    float k = o.z * o.z / dd;
    field += k;
    cacc += uOrbCol[i] * k;
    lit += o.w * k;
    grad += -2. * k * d / dd;
  }
  vec3 base = cacc / max(field, 1e-3);
  float glow = lit / max(field, 1e-3);
  float edge = smoothstep(.95, 1.05, field);
  vec3 n = normalize(vec3(-grad * .03, 1.));
  vec3 L = normalize(vec3(uPointer * 1.4 + vec2(-.35, .55), .9));
  float diff = clamp(dot(n, L), 0., 1.);
  float spec_ = pow(clamp(dot(reflect(-L, n), vec3(0., 0., 1.)), 0., 1.), 48.);
  float fres = pow(1. - n.z, 2.2);
  vec3 bg = mix(uColC * .03, uColA * .05, vUv.y);
  bg += base * smoothstep(.25, 1., field) * .18 * (1. + glow);
  vec3 liquid = base * (.22 + .7 * diff) * (1. + 1.2 * glow) + mix(base, vec3(1.), .4) * fres * .55 + spec_ * .55;
  vec3 col = mix(bg, liquid, edge);
  col += ripples(p) * uColB;
  vec3 prev = texture(uPrev, vUv).rgb;
  outColor = vec4(mix(col * uIntensity, prev, .25 * uTrails), 1.);
}`;

/** Matrix — your actual beat as a field of lights: every row is an instrument, every column a step, lit as the playhead sweeps. */
const MATRIX = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  vec3 ro = vec3(0., 1.05, -1.1);
  vec3 rd = normalize(vec3(p.x, p.y - .42, 1.));
  rd.xz = rot(uPointer.x * .35) * rd.xz;
  rd.yz = rot(uPointer.y * .12) * rd.yz;
  vec3 col = mix(uColC * .02, uColA * .05, smoothstep(-.2, .5, p.y));
  float steps = max(uGridSteps, 1.);
  float rows = max(uGridRows, 1.);
  if (rd.y < -.001) {
    float t = -ro.y / rd.y;
    vec3 hp = ro + rd * t;
    float W = 3.3, D = 2.9;
    vec2 gc = vec2((hp.x / W + .5) * steps, (hp.z / D) * rows);
    float fog = exp(-t * .22);
    if (gc.x > 0. && gc.x < steps && gc.y > 0. && gc.y < rows) {
      vec2 cid = floor(gc);
      vec2 cf = fract(gc) - .5;
      float v = texture(uGrid, vec2((cid.x + .5) / 64., (cid.y + .5) / 16.)).r;
      float age = mod(uStepPos - cid.x + steps, steps);
      float lit = exp(-age * .6) * uPlaying;
      vec3 rc = uRowCol[int(min(cid.y, 15.))];
      float box = smoothstep(.43, .38, max(abs(cf.x), abs(cf.y)));
      float soft = smoothstep(.75, .2, length(cf));
      vec3 on = rc * (.35 + 3. * lit * v) + vec3(1.) * lit * v * .4;
      col += box * (v > 0. ? on : rc * .05 + .015) * fog;
      col += soft * (v > 0. ? rc * lit * v * .6 : vec3(0.)) * fog;
      float head = exp(-abs(gc.x - mod(uStepPos, steps) - .5) * 1.4) * uPlaying;
      col += head * mix(uColA, vec3(1.), .3) * .18 * fog;
    } else {
      col += uColC * .015 * fog;
    }
  }
  col += uColA * .05 * (uKick + .3 * uBass) * exp(-abs(p.y + .02) * 4.);
  col += ripples(p) * uColA;
  vec3 prev = texture(uPrev, vUv + vec2(0., .0015)).rgb;
  outColor = vec4(col * uIntensity + prev * .45 * uTrails, 1.);
}`;

/** Galaxy — thirty thousand stars in spiral arms that spin with the groove and breathe with the kick. */
const GALAXY = PRELUDE + /* glsl */ `
void main() {
  vec2 p = cuv();
  vec3 prev = texture(uPrev, (vUv - .5) * (.996 - .006 * uKick) + .5).rgb * (.15 + .25 * uTrails);
  float r = length(p - uPointer * .1);
  vec3 col = mix(uColA, vec3(1., .95, .85), .5) * exp(-r * 16.) * (.25 + .8 * uKick + .25 * uRms);
  col += uColB * exp(-r * 3.) * .04 * (1. + uBandsA.y);
  outColor = vec4(prev + col + ripples(p) * uColC, 1.);
}`;
const GALAXY_POINTS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes, uPointer;
uniform float uTime, uKick, uSnare, uHat, uRms, uIntensity, uSpeed, uDpr, uTravel, uBandsHi;
uniform vec3 uColA, uColB, uColC;
out vec3 vCol;
float h(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float i = float(gl_VertexID);
  float arm = mod(i, 3.);
  float r = pow(h(i * 1.17), .55) * 1.25;
  float spread = (h(i * 3.31) - .5) * (.55 - r * .25);
  float ang = arm * 2.0944 + r * 3.4 + spread + uTravel * .35 / (.35 + r);
  float pump = 1. + .09 * uKick * (1.2 - r) * uIntensity;
  vec3 pos = vec3(cos(ang) * r * pump, (h(i * 7.7) - .5) * .08 * (1.3 - r), sin(ang) * r * pump);
  float tilt = .95 + uPointer.y * .6;
  pos.yz = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * pos.yz;
  float yaw = uPointer.x * .8;
  pos.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * pos.xz;
  float z = pos.z + 2.4;
  vec2 xy = pos.xy / z * 2.2;
  xy.x *= uRes.y / uRes.x;
  gl_Position = vec4(xy, 0., 1.);
  float tw = .5 + .5 * sin(uTime * (1. + h(i) * 5.) + i);
  float sparkle = step(.985, h(i * .37)) * uHat * 3.;
  gl_PointSize = (1. + 1.4 * h(i * 5.1) + sparkle) * uDpr * (2.2 / z);
  float t = fract(r * .55 + arm * .12);
  vec3 c = t < .5 ? mix(uColA, uColB, t * 2.) : mix(uColB, uColC, t * 2. - 1.);
  vCol = mix(c, vec3(1.), .2 * (1. - r)) * (.07 + .09 * tw + .08 * uRms + sparkle * .25) * (1. + .6 * uSnare) * (.3 + r);
}`;

export const POINT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - .5;
  float a = smoothstep(.5, 0., length(c));
  outColor = vec4(vCol * a * a * 2.2, 1.);
}`;

export const POST = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime, uKick, uSnare, uBloom, uGrain, uAberr, uVignette, uExposure, uFlash;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vUv;
  vec2 c = uv - .5;
  float ab = uAberr * (.0015 + .007 * uKick);
  vec3 col;
  col.r = texture(uScene, uv + c * ab).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - c * ab).b;
  vec3 bloom = max(textureLod(uScene, uv, 2.).rgb - .35, 0.) * .5 + max(textureLod(uScene, uv, 4.).rgb - .25, 0.) * .45 + max(textureLod(uScene, uv, 6.).rgb - .18, 0.) * .4;
  col += bloom * uBloom;
  col *= uExposure * (1. + uFlash * uSnare * .35);
  col = col * (2.51 * col + .03) / (col * (2.43 * col + .59) + .14); // ACES fit
  col *= 1. - uVignette * dot(c, c) * 1.5;
  col += (hash12(uv * uRes + fract(uTime * 7.) * 91.) - .5) * uGrain;
  outColor = vec4(clamp(col, 0., 1.), 1.);
}`;

export const SCENES: SceneDef[] = [
  { id: "flow", name: "Classic Flow", blurb: "An homage to the iTunes visualizer: ribbons of light in a spinning feedback tunnel", frag: FLOW, mood: "groove" },
  { id: "halo", name: "Halo", blurb: "A radial spectrum crown with a shockwave on every kick", frag: HALO, mood: "hype" },
  { id: "nebula", name: "Nebula", blurb: "Gas clouds in your song's key colours; stars twinkle on the hats", frag: NEBULA, mood: "calm" },
  { id: "skyline", name: "Skyline", blurb: "Synthwave sun, a spectrum city and a grid that runs at your tempo", frag: SKYLINE, mood: "groove" },
  { id: "orbs", name: "Orbs", blurb: "Every instrument is a liquid orb in its channel colour, pulsing on its own hits", frag: ORBS, mood: "calm" },
  { id: "matrix", name: "Beat Matrix", blurb: "Your actual pattern as a field of lights, lit as the playhead sweeps", frag: MATRIX, mood: "groove" },
  { id: "warp", name: "Warp", blurb: "Fly down a tunnel woven from the spectrum; snares flash the walls", frag: WARP, mood: "hype" },
  { id: "galaxy", name: "Galaxy", blurb: "30,000 stars in spiral arms that spin with the groove", frag: GALAXY, points: { vert: GALAXY_POINTS, count: 30000 }, mood: "calm" },
  { id: "kaleido", name: "Kaleido", blurb: "A kaleidoscope that changes facets every four bars", frag: KALEIDO, mood: "hype" },
  { id: "phosphor", name: "Phosphor", blurb: "An analog scope: your waveform as a glowing beam", frag: PHOSPHOR, points: { vert: PHOSPHOR_POINTS, count: 4096 }, mood: "calm" },
];
