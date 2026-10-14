/**
 * Built-in mixer effects. Each type maps to a Tone.js node (or small composite)
 * with declared, editable parameters. "Approximation" effects are labeled as such.
 */
import * as Tone from "tone";
import type { EffectType } from "../../shared/project";
import type { ParamDesc } from "./instruments";

export interface EffectNode {
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
  set(key: string, value: number): void;
  dispose(): void;
}

export interface EffectDef {
  type: EffectType;
  name: string;
  params: ParamDesc[];
  create(params: Record<string, number>): EffectNode;
}

function simple(node: any, map: Record<string, (n: any, v: number) => void>, extras: any[] = []): EffectNode {
  return {
    input: node,
    output: node,
    set: (k, v) => map[k]?.(node, v),
    dispose: () => { try { node.dispose(); } catch {} extras.forEach((e) => { try { e.dispose(); } catch {} }); },
  };
}

export const EFFECT_DEFS: Record<EffectType, EffectDef> = {
  eq3: {
    type: "eq3", name: "Equalizer",
    params: [
      { key: "low", name: "Low (dB)", min: -24, max: 24, default: 0 },
      { key: "mid", name: "Mid (dB)", min: -24, max: 24, default: 0 },
      { key: "high", name: "High (dB)", min: -24, max: 24, default: 0 },
      { key: "lowFreq", name: "Low X-over", min: 60, max: 1000, default: 400 },
      { key: "highFreq", name: "High X-over", min: 1000, max: 12000, default: 2500 },
    ],
    create(p) {
      const n = new Tone.EQ3({ low: p.low ?? 0, mid: p.mid ?? 0, high: p.high ?? 0, lowFrequency: p.lowFreq ?? 400, highFrequency: p.highFreq ?? 2500 });
      return simple(n, {
        low: (x, v) => (x.low.value = v), mid: (x, v) => (x.mid.value = v), high: (x, v) => (x.high.value = v),
        lowFreq: (x, v) => (x.lowFrequency.value = v), highFreq: (x, v) => (x.highFrequency.value = v),
      });
    },
  },
  compressor: {
    type: "compressor", name: "Compressor",
    params: [
      { key: "threshold", name: "Threshold", min: -60, max: 0, default: -20 },
      { key: "ratio", name: "Ratio", min: 1, max: 20, default: 4 },
      { key: "attack", name: "Attack (s)", min: 0.001, max: 0.3, default: 0.01 },
      { key: "release", name: "Release (s)", min: 0.02, max: 1, default: 0.2 },
      { key: "knee", name: "Knee", min: 0, max: 40, default: 12 },
      { key: "makeup", name: "Makeup (dB)", min: 0, max: 24, default: 0 },
    ],
    create(p) {
      const comp = new Tone.Compressor({ threshold: p.threshold ?? -20, ratio: p.ratio ?? 4, attack: p.attack ?? 0.01, release: p.release ?? 0.2, knee: p.knee ?? 12 });
      const makeup = new Tone.Gain(Tone.dbToGain(p.makeup ?? 0));
      comp.connect(makeup);
      return {
        input: comp, output: makeup,
        set: (k, v) => {
          if (k === "makeup") makeup.gain.value = Tone.dbToGain(v);
          else if ((comp as any)[k]) (comp as any)[k].value = v;
        },
        dispose: () => { comp.dispose(); makeup.dispose(); },
      };
    },
  },
  limiter: {
    type: "limiter", name: "Limiter",
    params: [{ key: "threshold", name: "Ceiling (dB)", min: -24, max: 0, default: -1 }],
    create(p) {
      const n = new Tone.Limiter(p.threshold ?? -1);
      return simple(n, { threshold: (x, v) => (x.threshold.value = v) });
    },
  },
  gate: {
    type: "gate", name: "Noise Gate",
    params: [
      { key: "threshold", name: "Threshold", min: -80, max: 0, default: -45 },
      { key: "smoothing", name: "Smoothing", min: 0.01, max: 0.5, default: 0.1 },
    ],
    create(p) {
      const n = new Tone.Gate(p.threshold ?? -45, p.smoothing ?? 0.1);
      return simple(n, { threshold: (x, v) => (x.threshold = v), smoothing: (x, v) => (x.smoothing = v) });
    },
  },
  reverb: {
    type: "reverb", name: "Reverb",
    params: [
      { key: "decay", name: "Decay (s)", min: 0.2, max: 12, default: 2.2 },
      { key: "preDelay", name: "Pre-delay", min: 0, max: 0.2, default: 0.02 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.35 },
    ],
    create(p) {
      const n = new Tone.Reverb({ decay: p.decay ?? 2.2, preDelay: p.preDelay ?? 0.02, wet: p.wet ?? 0.35 });
      return simple(n, { decay: (x, v) => (x.decay = v), preDelay: (x, v) => (x.preDelay = v), wet: (x, v) => (x.wet.value = v) });
    },
  },
  delay: {
    type: "delay", name: "Delay",
    params: [
      { key: "time", name: "Time (s)", min: 0.02, max: 1.5, default: 0.375 },
      { key: "feedback", name: "Feedback", min: 0, max: 0.95, default: 0.35 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.3 },
    ],
    create(p) {
      // maxDelay must cover the param's max (1.5s) — Tone allocates the delay buffer
      // from it and throws if delayTime is later set beyond it.
      const n = new Tone.FeedbackDelay({ delayTime: p.time ?? 0.375, feedback: p.feedback ?? 0.35, maxDelay: 2 });
      n.wet.value = p.wet ?? 0.3;
      return simple(n, { time: (x, v) => (x.delayTime.value = v), feedback: (x, v) => (x.feedback.value = v), wet: (x, v) => (x.wet.value = v) });
    },
  },
  chorus: {
    type: "chorus", name: "Chorus",
    params: [
      { key: "rate", name: "Rate (Hz)", min: 0.1, max: 8, default: 1.5 },
      { key: "depth", name: "Depth", min: 0, max: 1, default: 0.5 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.5 },
    ],
    create(p) {
      const n = new Tone.Chorus(p.rate ?? 1.5, 3.5, p.depth ?? 0.5).start();
      n.wet.value = p.wet ?? 0.5;
      return simple(n, { rate: (x, v) => (x.frequency.value = v), depth: (x, v) => (x.depth = v), wet: (x, v) => (x.wet.value = v) });
    },
  },
  flanger: {
    type: "flanger", name: "Flanger",
    params: [
      { key: "rate", name: "Rate (Hz)", min: 0.05, max: 4, default: 0.4 },
      { key: "depth", name: "Depth (ms)", min: 0.5, max: 5, default: 2 },
      { key: "feedback", name: "Feedback", min: 0, max: 0.9, default: 0.5 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.5 },
    ],
    create(p) {
      // short modulated feedback delay = classic flange
      const delay = new Tone.FeedbackDelay(0.004, p.feedback ?? 0.5);
      delay.wet.value = p.wet ?? 0.5;
      const lfo = new Tone.LFO(p.rate ?? 0.4, 0.001, 0.001 + (p.depth ?? 2) / 1000);
      lfo.connect(delay.delayTime);
      lfo.start();
      return {
        input: delay, output: delay,
        set: (k, v) => {
          if (k === "rate") lfo.frequency.value = v;
          else if (k === "depth") lfo.max = 0.001 + v / 1000;
          else if (k === "feedback") delay.feedback.value = v;
          else if (k === "wet") delay.wet.value = v;
        },
        dispose: () => { delay.dispose(); lfo.dispose(); },
      };
    },
  },
  phaser: {
    type: "phaser", name: "Phaser",
    params: [
      { key: "rate", name: "Rate (Hz)", min: 0.05, max: 8, default: 0.6 },
      { key: "octaves", name: "Octaves", min: 1, max: 6, default: 3 },
      { key: "base", name: "Base Freq", min: 100, max: 2000, default: 400 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.5 },
    ],
    create(p) {
      const n = new Tone.Phaser({ frequency: p.rate ?? 0.6, octaves: p.octaves ?? 3, baseFrequency: p.base ?? 400 });
      n.wet.value = p.wet ?? 0.5;
      return simple(n, { rate: (x, v) => (x.frequency.value = v), octaves: (x, v) => (x.octaves = v), base: (x, v) => (x.baseFrequency = v), wet: (x, v) => (x.wet.value = v) });
    },
  },
  distortion: {
    type: "distortion", name: "Distortion",
    params: [
      { key: "amount", name: "Amount", min: 0, max: 1, default: 0.4 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 1 },
    ],
    create(p) {
      const n = new Tone.Distortion(p.amount ?? 0.4);
      n.wet.value = p.wet ?? 1;
      return simple(n, { amount: (x, v) => (x.distortion = v), wet: (x, v) => (x.wet.value = v) });
    },
  },
  saturation: {
    type: "saturation", name: "Saturation",
    params: [
      { key: "drive", name: "Drive", min: 0, max: 1, default: 0.25 },
      { key: "warmth", name: "Warmth", min: 0, max: 1, default: 0.5 },
    ],
    create(p) {
      const dist = new Tone.Distortion((p.drive ?? 0.25) * 0.5);
      dist.oversample = "2x";
      const tone = new Tone.Filter(20000 - (p.warmth ?? 0.5) * 12000, "lowpass");
      dist.connect(tone);
      return {
        input: dist, output: tone,
        set: (k, v) => {
          if (k === "drive") dist.distortion = v * 0.5;
          if (k === "warmth") tone.frequency.value = 20000 - v * 12000;
        },
        dispose: () => { dist.dispose(); tone.dispose(); },
      };
    },
  },
  filter: {
    type: "filter", name: "Filter",
    params: [
      { key: "freq", name: "Cutoff", min: 20, max: 20000, default: 1000 },
      { key: "q", name: "Resonance", min: 0.1, max: 18, default: 1 },
      { key: "mode", name: "Mode (0 LP / 1 HP / 2 BP)", min: 0, max: 2, default: 0, step: 1 },
    ],
    create(p) {
      const types = ["lowpass", "highpass", "bandpass"] as const;
      const n = new Tone.Filter(p.freq ?? 1000, types[Math.round(p.mode ?? 0)] ?? "lowpass");
      n.Q.value = p.q ?? 1;
      return simple(n, {
        freq: (x, v) => (x.frequency.value = v),
        q: (x, v) => (x.Q.value = v),
        mode: (x, v) => (x.type = types[Math.round(v)] ?? "lowpass"),
      });
    },
  },
  widener: {
    type: "widener", name: "Stereo Widener",
    params: [{ key: "width", name: "Width", min: 0, max: 1, default: 0.7 }],
    create(p) {
      const n = new Tone.StereoWidener(p.width ?? 0.7);
      return simple(n, { width: (x, v) => (x.width.value = v) });
    },
  },
  tremolo: {
    type: "tremolo", name: "Tremolo",
    params: [
      { key: "rate", name: "Rate (Hz)", min: 0.5, max: 16, default: 5 },
      { key: "depth", name: "Depth", min: 0, max: 1, default: 0.6 },
    ],
    create(p) {
      const n = new Tone.Tremolo(p.rate ?? 5, p.depth ?? 0.6).start();
      return simple(n, { rate: (x, v) => (x.frequency.value = v), depth: (x, v) => (x.depth.value = v) });
    },
  },
  gain: {
    type: "gain", name: "Gain Utility",
    params: [{ key: "gain", name: "Gain (dB)", min: -48, max: 24, default: 0 }],
    create(p) {
      const n = new Tone.Gain(Tone.dbToGain(p.gain ?? 0));
      return simple(n, { gain: (x, v) => (x.gain.value = Tone.dbToGain(v)) });
    },
  },
  deesser: {
    type: "deesser", name: "De-Esser (approx.)",
    params: [
      { key: "freq", name: "Sibilance Freq", min: 3000, max: 12000, default: 6500 },
      { key: "amount", name: "Reduction (dB)", min: 0, max: 24, default: 8 },
    ],
    // ponytail: static sibilance dip via peaking EQ — a real de-esser is dynamic;
    // labeled "approx." in the UI, upgrade path is a worklet envelope follower.
    create(p) {
      const n = new Tone.Filter({ type: "peaking", frequency: p.freq ?? 6500, Q: 3 });
      n.gain.value = -(p.amount ?? 8);
      return simple(n, { freq: (x, v) => (x.frequency.value = v), amount: (x, v) => (x.gain.value = -v) });
    },
  },
  bitcrusher: {
    type: "bitcrusher", name: "Bit Crusher",
    params: [
      { key: "bits", name: "Bits", min: 1, max: 16, default: 6, step: 1 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 1 },
    ],
    create(p) {
      const n = new Tone.BitCrusher(Math.round(p.bits ?? 6));
      n.wet.value = p.wet ?? 1;
      return simple(n, { bits: (x, v) => (x.bits.value = Math.round(v)), wet: (x, v) => (x.wet.value = v) });
    },
  },
  lofi: {
    type: "lofi", name: "Lo-Fi",
    params: [
      { key: "crush", name: "Crush", min: 0, max: 1, default: 0.4 },
      { key: "tone", name: "Tone", min: 500, max: 8000, default: 3200 },
      { key: "wobble", name: "Wobble", min: 0, max: 1, default: 0.3 },
    ],
    create(p) {
      const crush = new Tone.BitCrusher(Math.round(12 - (p.crush ?? 0.4) * 8));
      const filter = new Tone.Filter(p.tone ?? 3200, "lowpass");
      const vibrato = new Tone.Vibrato(0.9, (p.wobble ?? 0.3) * 0.4);
      crush.chain(filter, vibrato);
      return {
        input: crush, output: vibrato,
        set: (k, v) => {
          if (k === "crush") crush.bits.value = Math.round(12 - v * 8);
          if (k === "tone") filter.frequency.value = v;
          if (k === "wobble") vibrato.depth.value = v * 0.4;
        },
        dispose: () => { crush.dispose(); filter.dispose(); vibrato.dispose(); },
      };
    },
  },
  transient: {
    type: "transient", name: "Transient Shaper (approx.)",
    params: [
      { key: "attack", name: "Attack Emphasis", min: 0, max: 1, default: 0.5 },
      { key: "sustain", name: "Sustain (dB)", min: -18, max: 6, default: -6 },
    ],
    // ponytail: compressor-based approximation — slow attack lets the hit through,
    // then clamps sustain; makeup restores level. Labeled approx. in UI.
    create(p) {
      const comp = new Tone.Compressor({ threshold: -30, ratio: 6, attack: 0.002 + (1 - (p.attack ?? 0.5)) * 0.03, release: 0.15 });
      const makeup = new Tone.Gain(Tone.dbToGain(-(p.sustain ?? -6) * 0.5));
      comp.connect(makeup);
      return {
        input: comp, output: makeup,
        set: (k, v) => {
          if (k === "attack") comp.attack.value = 0.002 + (1 - v) * 0.03;
          if (k === "sustain") makeup.gain.value = Tone.dbToGain(-v * 0.5);
        },
        dispose: () => { comp.dispose(); makeup.dispose(); },
      };
    },
  },

  // ---------- expansion effects ----------
  multiband: {
    type: "multiband", name: "Multiband Compressor",
    params: [
      { key: "lowThresh", name: "Low Thresh (dB)", min: -60, max: 0, default: -24 },
      { key: "midThresh", name: "Mid Thresh (dB)", min: -60, max: 0, default: -24 },
      { key: "highThresh", name: "High Thresh (dB)", min: -60, max: 0, default: -24 },
      { key: "lowFreq", name: "Low X-over", min: 50, max: 800, default: 250 },
      { key: "highFreq", name: "High X-over", min: 800, max: 10000, default: 2500 },
    ],
    create(p) {
      const n = new Tone.MultibandCompressor({
        lowFrequency: p.lowFreq ?? 250, highFrequency: p.highFreq ?? 2500,
        low: { threshold: p.lowThresh ?? -24 }, mid: { threshold: p.midThresh ?? -24 }, high: { threshold: p.highThresh ?? -24 },
      });
      return simple(n, {
        lowThresh: (x, v) => (x.low.threshold.value = v),
        midThresh: (x, v) => (x.mid.threshold.value = v),
        highThresh: (x, v) => (x.high.threshold.value = v),
        lowFreq: (x, v) => (x.lowFrequency.value = v),
        highFreq: (x, v) => (x.highFrequency.value = v),
      });
    },
  },
  autopan: {
    type: "autopan", name: "Auto-Pan",
    params: [
      { key: "rate", name: "Rate (Hz)", min: 0.05, max: 12, default: 1 },
      { key: "depth", name: "Depth", min: 0, max: 1, default: 1 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 1 },
    ],
    create(p) {
      const n = new Tone.AutoPanner({ frequency: p.rate ?? 1, depth: p.depth ?? 1, wet: p.wet ?? 1 }).start();
      return simple(n, {
        rate: (x, v) => (x.frequency.value = v), depth: (x, v) => (x.depth.value = v), wet: (x, v) => (x.wet.value = v),
      });
    },
  },
  pingpong: {
    type: "pingpong", name: "Ping-Pong Delay",
    params: [
      { key: "time", name: "Delay (s)", min: 0.01, max: 1.5, default: 0.25 },
      { key: "feedback", name: "Feedback", min: 0, max: 0.95, default: 0.35 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.3 },
    ],
    create(p) {
      const n = new Tone.PingPongDelay({ delayTime: p.time ?? 0.25, feedback: p.feedback ?? 0.35, wet: p.wet ?? 0.3 });
      return simple(n, {
        time: (x, v) => (x.delayTime.value = v), feedback: (x, v) => (x.feedback.value = v), wet: (x, v) => (x.wet.value = v),
      });
    },
  },
  autowah: {
    type: "autowah", name: "Auto-Wah",
    params: [
      { key: "base", name: "Base Freq", min: 50, max: 1200, default: 100 },
      { key: "octaves", name: "Octaves", min: 1, max: 6, default: 4, step: 1 },
      { key: "sensitivity", name: "Sensitivity (dB)", min: -40, max: 0, default: 0 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 1 },
    ],
    create(p) {
      const n = new Tone.AutoWah({ baseFrequency: p.base ?? 100, octaves: p.octaves ?? 4, sensitivity: p.sensitivity ?? 0, wet: p.wet ?? 1 });
      // baseFrequency / octaves / sensitivity are plain properties on AutoWah, not signals
      return simple(n, {
        base: (x, v) => (x.baseFrequency = v), octaves: (x, v) => (x.octaves = v),
        sensitivity: (x, v) => (x.sensitivity = v), wet: (x, v) => (x.wet.value = v),
      });
    },
  },
  pitchshift: {
    type: "pitchshift", name: "Pitch Shifter",
    params: [
      { key: "pitch", name: "Semitones", min: -24, max: 24, default: 0, step: 1 },
      { key: "windowSize", name: "Window (s)", min: 0.03, max: 0.5, default: 0.1 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 1 },
    ],
    create(p) {
      const n = new Tone.PitchShift({ pitch: p.pitch ?? 0, windowSize: p.windowSize ?? 0.1, wet: p.wet ?? 1 });
      return simple(n, {
        pitch: (x, v) => (x.pitch = v), windowSize: (x, v) => (x.windowSize = v), wet: (x, v) => (x.wet.value = v),
      });
    },
  },
  vibrato: {
    type: "vibrato", name: "Vibrato",
    params: [
      { key: "rate", name: "Rate (Hz)", min: 0.1, max: 20, default: 5 },
      { key: "depth", name: "Depth", min: 0, max: 1, default: 0.1 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 1 },
    ],
    create(p) {
      const n = new Tone.Vibrato({ frequency: p.rate ?? 5, depth: p.depth ?? 0.1, wet: p.wet ?? 1 });
      return simple(n, {
        rate: (x, v) => (x.frequency.value = v), depth: (x, v) => (x.depth.value = v), wet: (x, v) => (x.wet.value = v),
      });
    },
  },
  ringmod: {
    type: "ringmod", name: "Ring Mod / Freq Shift",
    params: [
      { key: "shift", name: "Shift (Hz)", min: -1000, max: 1000, default: 0 },
      { key: "wet", name: "Mix", min: 0, max: 1, default: 0.5 },
    ],
    create(p) {
      const n = new Tone.FrequencyShifter({ frequency: p.shift ?? 0, wet: p.wet ?? 0.5 });
      return simple(n, { shift: (x, v) => (x.frequency.value = v), wet: (x, v) => (x.wet.value = v) });
    },
  },
};

export function createEffect(type: EffectType, params: Record<string, number>): EffectNode {
  const def = EFFECT_DEFS[type];
  const defaults: Record<string, number> = {};
  for (const p of def.params) defaults[p.key] = p.default;
  return def.create({ ...defaults, ...params });
}

export interface EffectPreset {
  name: string;
  effects: Array<{ type: EffectType; params: Record<string, number> }>;
}

/** Channel-strip presets, including the vocal chains used by the Recording Studio. */
export const EFFECT_CHAIN_PRESETS: EffectPreset[] = [
  { name: "Clean Rap", effects: [
    { type: "gate", params: { threshold: -50 } },
    { type: "eq3", params: { low: -2, mid: 0, high: 2, lowFreq: 120 } },
    { type: "compressor", params: { threshold: -18, ratio: 4, attack: 0.005, release: 0.15, makeup: 4 } },
    { type: "deesser", params: { freq: 6800, amount: 8 } },
  ]},
  { name: "Aggressive Rap", effects: [
    { type: "gate", params: { threshold: -48 } },
    { type: "eq3", params: { low: -4, mid: 2, high: 3 } },
    { type: "compressor", params: { threshold: -24, ratio: 8, attack: 0.003, release: 0.1, makeup: 8 } },
    { type: "saturation", params: { drive: 0.45, warmth: 0.4 } },
  ]},
  { name: "Melodic Rap", effects: [
    { type: "eq3", params: { low: -2, high: 2 } },
    { type: "compressor", params: { threshold: -20, ratio: 5, makeup: 5 } },
    { type: "reverb", params: { decay: 1.8, wet: 0.22 } },
    { type: "delay", params: { time: 0.375, feedback: 0.3, wet: 0.15 } },
  ]},
  { name: "Intimate Vocal", effects: [
    { type: "eq3", params: { low: 1, mid: -1, high: 1 } },
    { type: "compressor", params: { threshold: -16, ratio: 3, attack: 0.02, makeup: 3 } },
    { type: "reverb", params: { decay: 0.9, wet: 0.12 } },
  ]},
  { name: "Ad-Lib Wide", effects: [
    { type: "eq3", params: { low: -8, high: 4 } },
    { type: "widener", params: { width: 1 } },
    { type: "delay", params: { time: 0.25, feedback: 0.4, wet: 0.3 } },
    { type: "reverb", params: { decay: 2.5, wet: 0.3 } },
  ]},
  { name: "Vocal Double", effects: [
    { type: "chorus", params: { rate: 0.8, depth: 0.7, wet: 0.6 } },
    { type: "eq3", params: { low: -4, high: 1 } },
    { type: "compressor", params: { threshold: -20, ratio: 4, makeup: 3 } },
  ]},
  { name: "Lo-Fi Vocal", effects: [
    { type: "lofi", params: { crush: 0.5, tone: 2800, wobble: 0.4 } },
    { type: "compressor", params: { threshold: -20, ratio: 6, makeup: 5 } },
  ]},
  { name: "Telephone Vocal", effects: [
    { type: "filter", params: { freq: 1500, q: 4, mode: 2 } },
    { type: "distortion", params: { amount: 0.25 } },
    { type: "compressor", params: { threshold: -22, ratio: 8, makeup: 6 } },
  ]},
  { name: "Podcast Voice", effects: [
    { type: "gate", params: { threshold: -52 } },
    { type: "eq3", params: { low: 2, mid: 0, high: 1, lowFreq: 100 } },
    { type: "compressor", params: { threshold: -18, ratio: 3, attack: 0.01, release: 0.25, makeup: 4 } },
    { type: "limiter", params: { threshold: -2 } },
  ]},
  { name: "Harmonized Vocal", effects: [
    { type: "chorus", params: { rate: 1.2, depth: 0.9, wet: 0.7 } },
    { type: "reverb", params: { decay: 2.2, wet: 0.3 } },
    { type: "compressor", params: { threshold: -20, ratio: 4, makeup: 3 } },
  ]},
  { name: "Background Vocal", effects: [
    { type: "eq3", params: { low: -6, mid: -2, high: 0 } },
    { type: "reverb", params: { decay: 2.8, wet: 0.4 } },
    { type: "compressor", params: { threshold: -24, ratio: 6, makeup: 2 } },
    { type: "gain", params: { gain: -6 } },
  ]},
  { name: "Drum Bus Glue", effects: [
    { type: "compressor", params: { threshold: -14, ratio: 3, attack: 0.01, release: 0.2, makeup: 3 } },
    { type: "saturation", params: { drive: 0.3 } },
  ]},
  { name: "Master Polish", effects: [
    { type: "eq3", params: { low: 1, high: 1.5 } },
    { type: "compressor", params: { threshold: -12, ratio: 2, attack: 0.03, release: 0.3, makeup: 2 } },
    { type: "widener", params: { width: 0.6 } },
    { type: "limiter", params: { threshold: -1 } },
  ]},
];
