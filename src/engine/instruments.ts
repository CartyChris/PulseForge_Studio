/**
 * Built-in instruments. Each engine is a Tone.js synthesis wrapper behind a small
 * uniform interface; presets cover the standard musical roles. All original synthesis.
 */
import * as Tone from "tone";
import { midiToName } from "../../shared/time";

export interface InstrumentInstance {
  triggerAttackRelease(midi: number, durSec: number, time: number, velocity: number): void;
  connect(dest: Tone.ToneAudioNode | AudioNode): void;
  releaseAll(time?: number): void;
  set(params: Record<string, number>): void;
  dispose(): void;
  output: Tone.ToneAudioNode;
}

export interface ParamDesc {
  key: string;
  name: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

export interface SynthEngine {
  id: string;
  name: string;
  params: ParamDesc[];
  create(params: Record<string, number>): InstrumentInstance;
}

export interface InstrumentPreset {
  id: string;
  name: string;
  category: string;
  engineId: string;
  params: Record<string, number>;
}

const n = (midi: number) => midiToName(midi);

/** Wrap a Tone poly/mono synth (plus optional FX tail) into an InstrumentInstance. */
function wrap(source: { triggerAttackRelease: (note: string, dur: number, time: number, vel: number) => void; releaseAll?: (t?: number) => void; set?: (o: any) => void; dispose: () => void }, chainOut: Tone.ToneAudioNode, extras: Tone.ToneAudioNode[] = [], applyParams?: (p: Record<string, number>) => void): InstrumentInstance {
  return {
    triggerAttackRelease: (midi, dur, time, vel) => {
      try {
        source.triggerAttackRelease(n(midi), Math.max(0.02, dur), time, vel);
      } catch {
        // note collisions at identical times are non-fatal
      }
    },
    connect: (dest) => chainOut.connect(dest as any),
    releaseAll: (t) => source.releaseAll?.(t),
    set: (p) => applyParams?.(p),
    dispose: () => {
      try { source.dispose(); } catch {}
      for (const x of extras) { try { x.dispose(); } catch {} }
      try { chainOut.dispose(); } catch {}
    },
    output: chainOut,
  };
}

const OSC_TYPES = ["sine", "triangle", "sawtooth", "square", "fatsawtooth", "fatsquare"] as const;

export const SYNTH_ENGINES: SynthEngine[] = [
  {
    id: "subtractive",
    name: "Subtractive Synth",
    params: [
      { key: "osc", name: "Oscillator", min: 0, max: 5, default: 2, step: 1 },
      { key: "detune", name: "Detune", min: 0, max: 50, default: 8 },
      { key: "unison", name: "Unison", min: 1, max: 5, default: 2, step: 1 },
      { key: "noise", name: "Noise", min: 0, max: 1, default: 0 },
      { key: "cutoff", name: "Filter Cutoff", min: 80, max: 18000, default: 4000 },
      { key: "resonance", name: "Resonance", min: 0.1, max: 12, default: 1 },
      { key: "filterEnv", name: "Filter Env Amt", min: 0, max: 4, default: 1.5 },
      { key: "attack", name: "Attack", min: 0.001, max: 3, default: 0.01 },
      { key: "decay", name: "Decay", min: 0.01, max: 3, default: 0.2 },
      { key: "sustain", name: "Sustain", min: 0, max: 1, default: 0.7 },
      { key: "release", name: "Release", min: 0.01, max: 6, default: 0.3 },
      { key: "lfoRate", name: "LFO Rate", min: 0.05, max: 20, default: 4 },
      { key: "lfoDepth", name: "LFO→Filter", min: 0, max: 1, default: 0 },
      { key: "glide", name: "Glide", min: 0, max: 0.5, default: 0 },
      { key: "mono", name: "Mono", min: 0, max: 1, default: 0, step: 1 },
    ],
    create(p) {
      const osc = OSC_TYPES[Math.round(p.osc ?? 2)] ?? "sawtooth";
      const count = Math.round(p.unison ?? 2);
      const oscType = (osc.startsWith("fat") ? osc : count > 1 ? `fat${osc === "sine" ? "sine" : osc}` : osc) as any;
      const opts = {
        oscillator: { type: oscType, count, spread: p.detune ?? 8 },
        envelope: { attack: p.attack ?? 0.01, decay: p.decay ?? 0.2, sustain: p.sustain ?? 0.7, release: p.release ?? 0.3 },
        filter: { type: "lowpass" as const, Q: p.resonance ?? 1 },
        filterEnvelope: {
          attack: p.attack ?? 0.01, decay: (p.decay ?? 0.2) * 1.5, sustain: 0.4, release: p.release ?? 0.3,
          baseFrequency: p.cutoff ?? 4000, octaves: p.filterEnv ?? 1.5,
        },
        portamento: p.mono ? p.glide ?? 0 : 0,
      };
      const synth = p.mono ? new Tone.MonoSynth(opts as any) : new Tone.PolySynth(Tone.MonoSynth, opts as any);
      const noiseGain = new Tone.Gain(p.noise ?? 0);
      const noise = new Tone.Noise("white");
      const out = new Tone.Gain(0.8);
      synth.connect(out);
      if ((p.noise ?? 0) > 0.01) {
        noise.start();
        noise.connect(noiseGain);
        noiseGain.connect(out);
      }
      const lfo = new Tone.LFO(p.lfoRate ?? 4, 0, (p.lfoDepth ?? 0) * (p.cutoff ?? 4000));
      if ((p.lfoDepth ?? 0) > 0.01) lfo.start();
      return wrap(synth as any, out, [noise, noiseGain, lfo]);
    },
  },
  {
    id: "fm",
    name: "FM Synth",
    params: [
      { key: "ratio", name: "Ratio", min: 0.25, max: 12, default: 3 },
      { key: "modIndex", name: "Mod Amount", min: 0, max: 40, default: 10 },
      { key: "attack", name: "Attack", min: 0.001, max: 2, default: 0.005 },
      { key: "decay", name: "Decay", min: 0.01, max: 4, default: 0.4 },
      { key: "sustain", name: "Sustain", min: 0, max: 1, default: 0.3 },
      { key: "release", name: "Release", min: 0.01, max: 6, default: 0.5 },
      { key: "modDecay", name: "Mod Decay", min: 0.01, max: 4, default: 0.3 },
    ],
    create(p) {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: p.ratio ?? 3,
        modulationIndex: p.modIndex ?? 10,
        envelope: { attack: p.attack ?? 0.005, decay: p.decay ?? 0.4, sustain: p.sustain ?? 0.3, release: p.release ?? 0.5 },
        modulationEnvelope: { attack: 0.002, decay: p.modDecay ?? 0.3, sustain: 0.1, release: 0.3 },
      } as any);
      const out = new Tone.Gain(0.8);
      synth.connect(out);
      return wrap(synth as any, out);
    },
  },
  {
    id: "pad",
    name: "Pad & Atmosphere",
    params: [
      { key: "attack", name: "Attack", min: 0.05, max: 6, default: 1.2 },
      { key: "release", name: "Release", min: 0.1, max: 10, default: 2.5 },
      { key: "cutoff", name: "Filter", min: 200, max: 12000, default: 2500 },
      { key: "movement", name: "Movement", min: 0, max: 1, default: 0.4 },
      { key: "texture", name: "Texture/Noise", min: 0, max: 1, default: 0.1 },
      { key: "reverb", name: "Reverb", min: 0, max: 1, default: 0.5 },
      { key: "chorusDepth", name: "Chorus", min: 0, max: 1, default: 0.5 },
    ],
    create(p) {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: 25 },
        envelope: { attack: p.attack ?? 1.2, decay: 0.5, sustain: 0.8, release: p.release ?? 2.5 },
      } as any);
      const filter = new Tone.Filter(p.cutoff ?? 2500, "lowpass");
      const chorus = new Tone.Chorus(0.6, 4, p.chorusDepth ?? 0.5).start();
      const reverb = new Tone.Reverb({ decay: 4, wet: (p.reverb ?? 0.5) * 0.7 });
      const noise = new Tone.Noise("pink");
      const noiseGain = new Tone.Gain((p.texture ?? 0.1) * 0.15);
      const lfo = new Tone.LFO(0.1 + (p.movement ?? 0.4) * 0.4, (p.cutoff ?? 2500) * 0.5, (p.cutoff ?? 2500) * 1.5);
      const out = new Tone.Gain(0.7);
      if ((p.movement ?? 0.4) > 0.02) { lfo.connect(filter.frequency); lfo.start(); }
      if ((p.texture ?? 0.1) > 0.02) { noise.start(); noise.chain(noiseGain, filter); }
      synth.chain(filter, chorus, reverb, out);
      return wrap(synth as any, out, [filter, chorus, reverb, noise, noiseGain, lfo]);
    },
  },
  {
    id: "pluck",
    name: "Lead & Pluck",
    params: [
      { key: "decay", name: "Decay", min: 0.05, max: 2, default: 0.35 },
      { key: "cutoff", name: "Brightness", min: 500, max: 16000, default: 6000 },
      { key: "glide", name: "Glide", min: 0, max: 0.4, default: 0 },
      { key: "mono", name: "Mono", min: 0, max: 1, default: 0, step: 1 },
      { key: "delay", name: "Delay", min: 0, max: 1, default: 0.25 },
      { key: "drive", name: "Drive", min: 0, max: 1, default: 0 },
    ],
    create(p) {
      const env = { attack: 0.003, decay: p.decay ?? 0.35, sustain: 0.0, release: Math.max(0.08, (p.decay ?? 0.35) * 0.7) };
      const synth = p.mono
        ? new Tone.MonoSynth({ oscillator: { type: "triangle" }, envelope: env, filterEnvelope: { attack: 0.002, decay: (p.decay ?? 0.35) * 0.8, sustain: 0.1, release: 0.2, baseFrequency: p.cutoff ?? 6000, octaves: 1 }, portamento: p.glide ?? 0 } as any)
        : new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: env } as any);
      const filter = new Tone.Filter(p.cutoff ?? 6000, "lowpass");
      const dist = new Tone.Distortion((p.drive ?? 0) * 0.6);
      const delay = new Tone.FeedbackDelay("8n", 0.3);
      delay.wet.value = (p.delay ?? 0.25) * 0.5;
      const out = new Tone.Gain(0.8);
      synth.chain(filter, dist, delay, out);
      return wrap(synth as any, out, [filter, dist, delay]);
    },
  },
  {
    id: "piano",
    name: "Piano (modeled)",
    params: [
      { key: "brightness", name: "Brightness", min: 0, max: 1, default: 0.6 },
      { key: "release", name: "Release", min: 0.1, max: 3, default: 0.8 },
      { key: "lofi", name: "Lo-Fi", min: 0, max: 1, default: 0 },
    ],
    create(p) {
      // layered FM: hammer strike partials + body — a modeled approximation, not a sample lib
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 8 + (p.brightness ?? 0.6) * 10,
        oscillator: { type: "sine" },
        modulation: { type: "triangle" },
        envelope: { attack: 0.002, decay: 1.6, sustain: 0.08, release: p.release ?? 0.8 },
        modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.02, release: 0.4 },
      } as any);
      const filter = new Tone.Filter(2500 + (p.brightness ?? 0.6) * 8000 - (p.lofi ?? 0) * 4000, "lowpass");
      const crush = new Tone.BitCrusher(8);
      crush.wet.value = (p.lofi ?? 0) * 0.6;
      const out = new Tone.Gain(0.8);
      synth.chain(filter, crush, out);
      return wrap(synth as any, out, [filter, crush]);
    },
  },
  {
    id: "epiano",
    name: "Electric Piano",
    params: [
      { key: "bell", name: "Bell", min: 0, max: 1, default: 0.4 },
      { key: "chorusDepth", name: "Chorus", min: 0, max: 1, default: 0.3 },
      { key: "release", name: "Release", min: 0.1, max: 3, default: 1 },
    ],
    create(p) {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 3 + (p.bell ?? 0.4) * 12,
        oscillator: { type: "sine" },
        envelope: { attack: 0.004, decay: 1.8, sustain: 0.15, release: p.release ?? 1 },
        modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0.05, release: 0.5 },
      } as any);
      const chorus = new Tone.Chorus(1.2, 2.5, p.chorusDepth ?? 0.3).start();
      const out = new Tone.Gain(0.8);
      synth.chain(chorus, out);
      return wrap(synth as any, out, [chorus]);
    },
  },
  {
    id: "bass808",
    name: "808 / Sub Bass",
    params: [
      { key: "glide", name: "Glide", min: 0, max: 0.3, default: 0.06 },
      { key: "drive", name: "Drive", min: 0, max: 1, default: 0.4 },
      { key: "decay", name: "Decay", min: 0.2, max: 4, default: 1.5 },
      { key: "sub", name: "Sub (pure sine)", min: 0, max: 1, default: 0, step: 1 },
    ],
    create(p) {
      const synth = new Tone.MonoSynth({
        oscillator: { type: p.sub ? "sine" : "triangle" },
        envelope: { attack: 0.004, decay: p.decay ?? 1.5, sustain: 0.3, release: 0.4 },
        filterEnvelope: { attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.3, baseFrequency: 300, octaves: 1.5 },
        portamento: p.glide ?? 0.06,
      } as any);
      const dist = new Tone.Distortion((p.drive ?? 0.4) * 0.8);
      const out = new Tone.Gain(0.9);
      synth.chain(dist, out);
      return wrap(synth as any, out, [dist]);
    },
  },
  {
    id: "bass",
    name: "Bass Synth",
    params: [
      { key: "osc", name: "Oscillator", min: 0, max: 5, default: 2, step: 1 },
      { key: "cutoff", name: "Cutoff", min: 100, max: 5000, default: 900 },
      { key: "resonance", name: "Resonance", min: 0.1, max: 10, default: 2 },
      { key: "envAmt", name: "Env Amt", min: 0, max: 4, default: 2 },
      { key: "decay", name: "Decay", min: 0.05, max: 2, default: 0.3 },
      { key: "reese", name: "Reese (detuned)", min: 0, max: 1, default: 0, step: 1 },
      { key: "glide", name: "Glide", min: 0, max: 0.3, default: 0 },
    ],
    create(p) {
      const osc = p.reese ? { type: "fatsawtooth" as const, count: 3, spread: 35 } : { type: OSC_TYPES[Math.round(p.osc ?? 2)] ?? ("sawtooth" as any) };
      const synth = new Tone.MonoSynth({
        oscillator: osc as any,
        envelope: { attack: 0.003, decay: p.decay ?? 0.3, sustain: 0.4, release: 0.2 },
        filterEnvelope: { attack: 0.003, decay: p.decay ?? 0.3, sustain: 0.2, release: 0.2, baseFrequency: p.cutoff ?? 900, octaves: p.envAmt ?? 2 },
        filter: { type: "lowpass", Q: p.resonance ?? 2 },
        portamento: p.glide ?? 0,
      } as any);
      const out = new Tone.Gain(0.85);
      synth.connect(out);
      return wrap(synth as any, out);
    },
  },
];

export function getEngine(id: string): SynthEngine {
  return SYNTH_ENGINES.find((e) => e.id === id) ?? SYNTH_ENGINES[0]!;
}

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  // Pianos
  { id: "piano-studio", name: "Studio Piano", category: "Piano", engineId: "piano", params: { brightness: 0.6, release: 0.8 } },
  { id: "piano-soft", name: "Soft Piano", category: "Piano", engineId: "piano", params: { brightness: 0.3, release: 1.2 } },
  { id: "piano-dark", name: "Dark Piano", category: "Piano", engineId: "piano", params: { brightness: 0.12, release: 1.0 } },
  { id: "piano-lofi", name: "Lo-Fi Piano", category: "Piano", engineId: "piano", params: { brightness: 0.4, release: 0.7, lofi: 0.7 } },
  // Electric pianos
  { id: "ep-classic", name: "Classic Electric", category: "Electric Piano", engineId: "epiano", params: { bell: 0.35, chorusDepth: 0.2 } },
  { id: "ep-warm", name: "Warm Keys", category: "Electric Piano", engineId: "epiano", params: { bell: 0.15, chorusDepth: 0.25, release: 1.4 } },
  { id: "ep-bell", name: "Bell Keys", category: "Electric Piano", engineId: "epiano", params: { bell: 0.9, chorusDepth: 0.3 } },
  { id: "ep-chorus", name: "Chorus Keys", category: "Electric Piano", engineId: "epiano", params: { bell: 0.4, chorusDepth: 0.9 } },
  // Organ
  { id: "organ", name: "Organ", category: "Keys", engineId: "subtractive", params: { osc: 0, unison: 3, detune: 4, cutoff: 6000, attack: 0.02, decay: 0.1, sustain: 1, release: 0.08 } },
  // Basses
  { id: "bass-sub", name: "Sub Bass", category: "Bass", engineId: "bass808", params: { sub: 1, drive: 0.1, decay: 2 } },
  { id: "bass-808", name: "808 Bass", category: "Bass", engineId: "bass808", params: { glide: 0.08, drive: 0.5, decay: 1.8 } },
  { id: "bass-electric", name: "Electric Bass", category: "Bass", engineId: "bass", params: { osc: 1, cutoff: 700, envAmt: 1.2, decay: 0.4 } },
  { id: "bass-synth", name: "Synth Bass", category: "Bass", engineId: "bass", params: { osc: 2, cutoff: 1200, envAmt: 2.5, decay: 0.25 } },
  { id: "bass-reese", name: "Reese Bass", category: "Bass", engineId: "bass", params: { reese: 1, cutoff: 800, decay: 0.6 } },
  { id: "bass-pluck", name: "Pluck Bass", category: "Bass", engineId: "bass", params: { osc: 2, cutoff: 1500, envAmt: 3, decay: 0.12 } },
  // Pads
  { id: "pad-strings", name: "Strings Pad", category: "Pads", engineId: "pad", params: { attack: 0.8, release: 2, cutoff: 3500, movement: 0.3, chorusDepth: 0.4 } },
  { id: "pad-choir", name: "Choir Pad", category: "Pads", engineId: "pad", params: { attack: 1.5, release: 3, cutoff: 1800, texture: 0.3, reverb: 0.8 } },
  { id: "pad-ambient", name: "Ambient Texture", category: "Pads", engineId: "pad", params: { attack: 2.5, release: 5, cutoff: 1500, movement: 0.8, texture: 0.5, reverb: 0.9 } },
  // Leads & plucks
  { id: "lead-synth", name: "Synth Lead", category: "Leads", engineId: "pluck", params: { decay: 1.2, cutoff: 9000, mono: 1, glide: 0.05, drive: 0.4, delay: 0.3 } },
  { id: "pluck", name: "Pluck", category: "Leads", engineId: "pluck", params: { decay: 0.3, cutoff: 7000, delay: 0.3 } },
  { id: "pluck-guitar", name: "Guitar-ish Pluck", category: "Leads", engineId: "pluck", params: { decay: 0.6, cutoff: 4200, delay: 0.12, drive: 0.15 } },
  // FM voices
  { id: "bell", name: "Bell", category: "FM", engineId: "fm", params: { ratio: 7.01, modIndex: 18, decay: 2.5, sustain: 0, release: 2, modDecay: 1.5 } },
  { id: "mallet", name: "Mallet", category: "FM", engineId: "fm", params: { ratio: 5, modIndex: 8, decay: 0.6, sustain: 0, release: 0.5, modDecay: 0.15 } },
  { id: "fm-keys", name: "FM Keys", category: "FM", engineId: "fm", params: { ratio: 2, modIndex: 6, decay: 1.2, sustain: 0.2, release: 0.8, modDecay: 0.5 } },
  { id: "fm-bass", name: "FM Bass", category: "FM", engineId: "fm", params: { ratio: 1, modIndex: 12, decay: 0.4, sustain: 0.3, release: 0.3, modDecay: 0.2 } },
  { id: "fm-metallic", name: "Metallic", category: "FM", engineId: "fm", params: { ratio: 11.3, modIndex: 30, decay: 1.5, sustain: 0, release: 1.2, modDecay: 0.8 } },
  // Misc roles
  { id: "brass", name: "Brass", category: "Ensemble", engineId: "subtractive", params: { osc: 2, unison: 3, detune: 12, cutoff: 2500, filterEnv: 2, attack: 0.06, decay: 0.3, sustain: 0.8, release: 0.25 } },
  { id: "synth-chord", name: "Synth Chord", category: "Ensemble", engineId: "subtractive", params: { osc: 4, unison: 4, detune: 20, cutoff: 3000, attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.4 } },
  { id: "percussion", name: "Tuned Percussion", category: "FM", engineId: "fm", params: { ratio: 3.7, modIndex: 14, decay: 0.35, sustain: 0, release: 0.3, modDecay: 0.08 } },
  { id: "sfx", name: "SFX Generator", category: "FX", engineId: "subtractive", params: { osc: 3, noise: 0.6, cutoff: 3000, resonance: 8, lfoRate: 6, lfoDepth: 0.8, attack: 0.05, decay: 1, sustain: 0.3, release: 1 } },

  // ---- expansion round: all synthesized, original patches over the built-in engines ----
  // Bass
  { id: "bass-wobble", name: "Wobble Bass", category: "Bass", engineId: "subtractive", params: { osc: 2, mono: 1, cutoff: 900, resonance: 7, lfoRate: 2.5, lfoDepth: 0.9, decay: 1.5, sustain: 0.8, release: 0.2 } },
  { id: "bass-acid", name: "Acid Bass", category: "Bass", engineId: "bass", params: { osc: 2, cutoff: 1400, resonance: 8, envAmt: 3.5, decay: 0.18, glide: 0.06 } },
  { id: "bass-growl", name: "Growl Bass", category: "Bass", engineId: "fm", params: { ratio: 0.5, modIndex: 22, decay: 0.5, sustain: 0.5, release: 0.2, modDecay: 0.35 } },
  { id: "bass-deep-house", name: "Deep House Bass", category: "Bass", engineId: "bass", params: { osc: 1, cutoff: 500, resonance: 1.5, envAmt: 1.2, decay: 0.3 } },
  { id: "bass-808-long", name: "808 Long Tail", category: "Bass", engineId: "bass808", params: { glide: 0.1, drive: 0.35, decay: 3.5 } },
  { id: "bass-808-distorted", name: "808 Distorted", category: "Bass", engineId: "bass808", params: { glide: 0.06, drive: 0.95, decay: 1.6 } },
  { id: "bass-picked", name: "Picked Bass", category: "Bass", engineId: "pluck", params: { decay: 0.5, cutoff: 2400, mono: 1, glide: 0.02, drive: 0.25, delay: 0 } },
  // Leads
  { id: "lead-super", name: "Supersaw Lead", category: "Leads", engineId: "subtractive", params: { osc: 2, unison: 5, detune: 25, cutoff: 9000, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.3 } },
  { id: "lead-square", name: "Square Lead", category: "Leads", engineId: "subtractive", params: { osc: 1, mono: 1, glide: 0.06, cutoff: 6000, attack: 0.005, sustain: 0.9, release: 0.15 } },
  { id: "lead-whistle", name: "Whistle Lead", category: "Leads", engineId: "subtractive", params: { osc: 0, mono: 1, glide: 0.09, cutoff: 12000, lfoRate: 5.5, lfoDepth: 0.15, attack: 0.05, sustain: 1, release: 0.2 } },
  { id: "lead-trance", name: "Trance Pluck", category: "Leads", engineId: "pluck", params: { decay: 0.22, cutoff: 10000, delay: 0.55, drive: 0.2 } },
  { id: "lead-retro", name: "Retro Chip", category: "Leads", engineId: "subtractive", params: { osc: 1, unison: 1, cutoff: 14000, attack: 0.001, decay: 0.08, sustain: 0.6, release: 0.05 } },
  // Keys
  { id: "keys-house-organ", name: "House Organ", category: "Keys", engineId: "epiano", params: { bell: 0.6, chorusDepth: 0.15, release: 0.3 } },
  { id: "keys-clav", name: "Clav", category: "Keys", engineId: "pluck", params: { decay: 0.4, cutoff: 5200, drive: 0.35, delay: 0 } },
  { id: "keys-music-box", name: "Music Box", category: "Keys", engineId: "fm", params: { ratio: 4, modIndex: 10, decay: 1.6, sustain: 0, release: 1.8, modDecay: 0.1 } },
  { id: "keys-dream", name: "Dream Keys", category: "Keys", engineId: "epiano", params: { bell: 0.25, chorusDepth: 0.6, release: 2.6 } },
  { id: "piano-grand-bright", name: "Bright Grand", category: "Piano", engineId: "piano", params: { brightness: 0.9, release: 0.9 } },
  { id: "piano-tape", name: "Tape Piano", category: "Piano", engineId: "piano", params: { brightness: 0.35, release: 1.4, lofi: 0.45 } },
  // Pads
  { id: "pad-warm-analog", name: "Warm Analog Pad", category: "Pads", engineId: "pad", params: { attack: 0.6, release: 2.5, cutoff: 2200, movement: 0.2, texture: 0, chorusDepth: 0.6, reverb: 0.5 } },
  { id: "pad-dark-drone", name: "Dark Drone", category: "Pads", engineId: "pad", params: { attack: 3, release: 8, cutoff: 700, movement: 0.5, texture: 0.35, reverb: 0.95 } },
  { id: "pad-shimmer", name: "Shimmer Pad", category: "Pads", engineId: "pad", params: { attack: 1.2, release: 4, cutoff: 8000, movement: 0.7, texture: 0.15, chorusDepth: 0.8, reverb: 0.85 } },
  { id: "pad-vapor", name: "Vaporwave Pad", category: "Pads", engineId: "pad", params: { attack: 0.9, release: 3.5, cutoff: 3200, movement: 0.55, texture: 0.25, chorusDepth: 1, reverb: 0.7 } },
  { id: "pad-cinematic", name: "Cinematic Swell", category: "Pads", engineId: "pad", params: { attack: 4.5, release: 6, cutoff: 4500, movement: 0.4, texture: 0.2, reverb: 0.9 } },
  // FM / bells / mallets
  { id: "fm-kalimba", name: "Kalimba", category: "FM", engineId: "fm", params: { ratio: 6, modIndex: 6, decay: 0.5, sustain: 0, release: 0.4, modDecay: 0.05 } },
  { id: "fm-glass", name: "Glass Bells", category: "FM", engineId: "fm", params: { ratio: 9.02, modIndex: 14, decay: 3, sustain: 0, release: 2.5, modDecay: 1 } },
  { id: "fm-marimba", name: "Marimba", category: "FM", engineId: "fm", params: { ratio: 4.99, modIndex: 5, decay: 0.4, sustain: 0, release: 0.35, modDecay: 0.06 } },
  { id: "fm-gong", name: "Gong", category: "FM", engineId: "fm", params: { ratio: 3.51, modIndex: 34, decay: 3.8, sustain: 0, release: 3, modDecay: 2.2 } },
  { id: "fm-toy-piano", name: "Toy Piano", category: "FM", engineId: "fm", params: { ratio: 8, modIndex: 9, decay: 0.9, sustain: 0, release: 0.7, modDecay: 0.2 } },
  // Ensemble / world-ish
  { id: "strings-staccato", name: "Staccato Strings", category: "Ensemble", engineId: "subtractive", params: { osc: 2, unison: 4, detune: 15, cutoff: 4500, attack: 0.03, decay: 0.25, sustain: 0.3, release: 0.2 } },
  { id: "choir-ahh", name: "Ahh Choir", category: "Ensemble", engineId: "pad", params: { attack: 0.5, release: 1.8, cutoff: 1600, movement: 0.25, texture: 0.4, chorusDepth: 0.5, reverb: 0.6 } },
  { id: "flute-air", name: "Airy Flute", category: "Ensemble", engineId: "subtractive", params: { osc: 0, noise: 0.15, mono: 1, cutoff: 9000, attack: 0.09, sustain: 0.9, release: 0.3 } },
  { id: "pluck-koto", name: "Koto Pluck", category: "Leads", engineId: "pluck", params: { decay: 0.7, cutoff: 3800, delay: 0.18, drive: 0.1 } },
  { id: "pluck-harp", name: "Harp", category: "Leads", engineId: "pluck", params: { decay: 1.1, cutoff: 6500, delay: 0.1 } },
  // FX / texture
  { id: "sfx-riser-synth", name: "Playable Riser", category: "FX", engineId: "subtractive", params: { osc: 2, unison: 5, detune: 40, noise: 0.4, cutoff: 2000, lfoRate: 0.3, lfoDepth: 1, attack: 1.5, sustain: 1, release: 2 } },
  { id: "sfx-laser", name: "Laser Zap", category: "FX", engineId: "fm", params: { ratio: 0.25, modIndex: 40, decay: 0.25, sustain: 0, release: 0.15, modDecay: 0.04 } },
  { id: "sfx-underwater", name: "Underwater", category: "FX", engineId: "pad", params: { attack: 0.3, release: 2, cutoff: 500, movement: 0.9, texture: 0.5, reverb: 0.9 } },
];

export function getPreset(presetId: string): InstrumentPreset {
  return INSTRUMENT_PRESETS.find((p) => p.id === presetId) ?? INSTRUMENT_PRESETS[0]!;
}

export function createInstrument(engineId: string, params: Record<string, number>): InstrumentInstance {
  const engine = getEngine(engineId);
  const defaults: Record<string, number> = {};
  for (const p of engine.params) defaults[p.key] = p.default;
  return engine.create({ ...defaults, ...params });
}
