/**
 * Built-in instruments. Each engine is a Tone.js synthesis wrapper behind a small
 * uniform interface; presets cover the standard musical roles. All original synthesis.
 */
import * as Tone from "tone";
import { midiToName } from "../../shared/time";
import { createSampledEngines, SAMPLE_MANIFEST, SAMPLED_ENGINE_PREFIX, sampledEngineId } from "./sampled";

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

// ---------------------------------------------------------------------------
// 2.0 synthesis engines: Karplus–Strong strings, drawbar organ, supersaw, AM,
// swell brass, ensemble strings. All original synthesis over Tone.js primitives.
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (p: Record<string, number>, k: string, d: number) => (Number.isFinite(p[k]) ? (p[k] as number) : d);

/** Monophonic sources (NoiseSynth etc.) throw when restarted at the exact same time — skip duplicates. */
function makeOncePerTime() {
  let last = -1;
  return (time: number) => {
    if (time <= last + 0.0005) return false;
    last = time;
    return true;
  };
}

/** Hammond footages expressed as harmonics of the 16' fundamental (the oscillator plays an octave down). */
const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16] as const;
const DRAWBAR_KEYS = ["db16", "db513", "db8", "db4", "db223", "db2", "db135", "db113", "db1"] as const;
const DRAWBAR_NAMES = ["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"] as const;

function drawbarPartials(p: Record<string, number>): number[] {
  const partials = new Array(16).fill(0);
  DRAWBAR_KEYS.forEach((k, i) => {
    const level = clamp(Math.round(num(p, k, 0)), 0, 8);
    // each drawbar step ≈ 3 dB, 8 = full
    if (level > 0) partials[DRAWBAR_HARMONICS[i]! - 1] += Math.pow(10, (-(8 - level) * 3) / 20);
  });
  if (partials.every((v) => v === 0)) partials[1] = 1; // all bars in: fall back to a plain 8'
  return partials;
}

const EXPANSION_ENGINES: SynthEngine[] = [
  {
    id: "string",
    name: "Plucked String (Karplus–Strong)",
    params: [
      { key: "brightness", name: "Brightness", min: 0, max: 1, default: 0.55 },
      { key: "damping", name: "Damping", min: 0, max: 1, default: 0.3 },
      { key: "pick", name: "Pick Hardness", min: 0, max: 1, default: 0.35 },
      { key: "body", name: "Body", min: 0, max: 1, default: 0.5 },
      { key: "bodyFreq", name: "Body Tone", min: 60, max: 800, default: 200 },
      { key: "octave", name: "Octave Course", min: 0, max: 1, default: 0 },
      { key: "chorus", name: "Chorus", min: 0, max: 1, default: 0 },
      { key: "buzz", name: "Buzz", min: 0, max: 1, default: 0 },
      { key: "release", name: "Release", min: 0.02, max: 3, default: 0.6 },
      { key: "voices", name: "Voices", min: 2, max: 12, default: 8, step: 1 },
    ],
    create(p) {
      const brightness = num(p, "brightness", 0.55);
      const damping = num(p, "damping", 0.3);
      const resonance = clamp(0.999 - damping * 0.12, 0.5, 0.999);
      const dampHz = 900 + brightness * 6000; // LowpassCombFilter dampening (Tone caps at ~7 kHz)
      const attackNoise = 0.4 + num(p, "pick", 0.35) * 7.6;
      const release = num(p, "release", 0.6);
      const ctx = Tone.getContext();
      const pre = new Tone.Gain(1);
      const body = new Tone.Filter({ type: "peaking", frequency: num(p, "bodyFreq", 200), Q: 1.4, gain: num(p, "body", 0.5) * 9 });
      const air = new Tone.Filter(2500 + brightness * 12000, "lowpass");
      const dist = new Tone.Distortion(0.3 + num(p, "buzz", 0) * 0.5);
      dist.wet.value = num(p, "buzz", 0) * 0.7;
      const chorus = new Tone.Chorus(1.5, 3.5, 0.6).start();
      chorus.wet.value = num(p, "chorus", 0) * 0.8;
      const out = new Tone.Gain(0.9);
      pre.chain(body, dist, air, chorus, out);
      const count = clamp(Math.round(num(p, "voices", 8)), 2, 12);
      const voices = Array.from({ length: count }, () => {
        const pluck = new Tone.PluckSynth({ context: ctx, attackNoise, dampening: dampHz, resonance, release } as any);
        const g = new Tone.Gain({ gain: 0, context: ctx });
        pluck.connect(g);
        g.connect(pre);
        return { pluck, g, busyUntil: 0 };
      });
      let rr = 0;
      const octaveLevel = num(p, "octave", 0);
      const strike = (midi: number, dur: number, time: number, vel: number) => {
        // prefer a free voice, else steal round-robin
        let idx = voices.findIndex((v) => v.busyUntil <= time);
        if (idx < 0) idx = rr++ % voices.length;
        const v = voices[idx]!;
        v.busyUntil = time + dur + release;
        v.g.gain.setValueAtTime(clamp(vel, 0, 1) * 0.9, time);
        v.pluck.triggerAttack(Tone.Frequency(midi, "midi").toFrequency(), time);
        v.pluck.triggerRelease(time + Math.max(0.02, dur));
      };
      return {
        triggerAttackRelease: (midi, dur, time, vel) => {
          try {
            strike(midi, dur, time, vel);
            if (octaveLevel > 0.01 && midi + 12 <= 120) strike(midi + 12, dur, time + 0.006, vel * octaveLevel);
          } catch { /* overlapping retrigger is non-fatal */ }
        },
        connect: (dest) => out.connect(dest as any),
        releaseAll: (t) => { for (const v of voices) { try { v.pluck.triggerRelease(t ?? Tone.now()); } catch {} } },
        set: () => {},
        dispose: () => {
          for (const v of voices) { try { v.pluck.dispose(); v.g.dispose(); } catch {} }
          for (const n of [pre, body, dist, air, chorus, out]) { try { n.dispose(); } catch {} }
        },
        output: out,
      };
    },
  },
  {
    id: "organ",
    name: "Drawbar Organ",
    params: [
      ...DRAWBAR_KEYS.map((k, i) => ({ key: k, name: `Drawbar ${DRAWBAR_NAMES[i]}`, min: 0, max: 8, default: [8, 8, 8, 0, 0, 0, 0, 0, 0][i]!, step: 1 })),
      { key: "perc", name: "Percussion", min: 0, max: 1, default: 0 },
      { key: "percHarm", name: "Perc 2nd/3rd", min: 0, max: 1, default: 1, step: 1 },
      { key: "percDecay", name: "Perc Decay", min: 0.05, max: 1.5, default: 0.25 },
      { key: "click", name: "Key Click", min: 0, max: 1, default: 0.3 },
      { key: "rotary", name: "Rotary Depth", min: 0, max: 1, default: 0.4 },
      { key: "rotarySpeed", name: "Rotary Speed", min: 0.3, max: 8, default: 0.8 },
      { key: "drive", name: "Overdrive", min: 0, max: 1, default: 0 },
      { key: "tone", name: "Cabinet Tone", min: 1500, max: 16000, default: 7000 },
      { key: "release", name: "Release", min: 0.01, max: 2, default: 0.06 },
    ],
    create(p) {
      const release = num(p, "release", 0.06);
      const ctx = Tone.getContext();
      const tonewheels = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "custom", partials: drawbarPartials(p) },
        envelope: { attack: 0.004, decay: 0.01, sustain: 1, release },
      } as any);
      tonewheels.maxPolyphony = 24;
      const percLevel = num(p, "perc", 0);
      const perc = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: num(p, "percDecay", 0.25), sustain: 0, release: num(p, "percDecay", 0.25) },
      } as any);
      const percGain = new Tone.Gain(percLevel * 0.8);
      const clickLevel = num(p, "click", 0.3);
      const click = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.012, sustain: 0, release: 0.01 } } as any);
      const clickHp = new Tone.Filter(2200, "highpass");
      const clickGain = new Tone.Gain(clickLevel * 0.12);
      const clickOnce = makeOncePerTime();
      const mix = new Tone.Gain(0.42);
      tonewheels.connect(mix);
      perc.chain(percGain, mix);
      click.chain(clickHp, clickGain, mix);
      const drive = num(p, "drive", 0);
      const dist = new Tone.Distortion({ distortion: 0.2 + drive * 0.7, oversample: "2x" } as any);
      dist.wet.value = drive > 0.01 ? 1 : 0;
      const driveComp = new Tone.Gain(1 - drive * 0.45);
      const rot = num(p, "rotary", 0.4);
      const speed = num(p, "rotarySpeed", 0.8);
      const vibrato = new Tone.Vibrato({ frequency: speed, depth: rot * 0.12 } as any);
      const trem = new Tone.Tremolo({ frequency: speed * 0.9, depth: rot * 0.35, spread: 120 } as any).start();
      const pan = new Tone.AutoPanner({ frequency: speed, depth: rot * 0.6 } as any).start();
      const cab = new Tone.Filter(num(p, "tone", 7000), "lowpass");
      const out = new Tone.Gain(0.9);
      mix.chain(dist, driveComp, vibrato, trem, pan, cab, out);
      const percInterval = num(p, "percHarm", 1) >= 0.5 ? 19 : 12;
      return {
        triggerAttackRelease: (midi, dur, time, vel) => {
          const d = Math.max(0.03, dur);
          // organs are not velocity sensitive; keep a little so humanised MIDI still breathes
          const v = 0.75 + clamp(vel, 0, 1) * 0.25;
          try { tonewheels.triggerAttackRelease(Tone.Frequency(midi - 12, "midi").toFrequency(), d, time, v); } catch {}
          if (percLevel > 0.01) { try { perc.triggerAttackRelease(Tone.Frequency(midi + percInterval, "midi").toFrequency(), d, time, v); } catch {} }
          if (clickLevel > 0.01 && clickOnce(time)) { try { click.triggerAttackRelease(0.015, time, v); } catch {} }
        },
        connect: (dest) => out.connect(dest as any),
        releaseAll: (t) => { try { tonewheels.releaseAll(t); perc.releaseAll(t); } catch {} },
        set: () => {},
        dispose: () => {
          for (const n of [tonewheels, perc, percGain, click, clickHp, clickGain, mix, dist, driveComp, vibrato, trem, pan, cab, out] as Array<{ dispose(): unknown }>) { try { n.dispose(); } catch {} }
          void ctx;
        },
        output: out,
      };
    },
  },
  {
    id: "supersaw",
    name: "Supersaw (7-voice)",
    params: [
      { key: "detune", name: "Detune", min: 0, max: 100, default: 35 },
      { key: "osc", name: "Saw / Square", min: 0, max: 1, default: 0, step: 1 },
      { key: "cutoff", name: "Filter Cutoff", min: 100, max: 18000, default: 5000 },
      { key: "resonance", name: "Resonance", min: 0.1, max: 12, default: 1 },
      { key: "filterEnv", name: "Filter Env Amt", min: 0, max: 5, default: 1.5 },
      { key: "filterDecay", name: "Filter Decay", min: 0.02, max: 3, default: 0.4 },
      { key: "attack", name: "Attack", min: 0.001, max: 3, default: 0.01 },
      { key: "decay", name: "Decay", min: 0.01, max: 3, default: 0.3 },
      { key: "sustain", name: "Sustain", min: 0, max: 1, default: 0.8 },
      { key: "release", name: "Release", min: 0.01, max: 6, default: 0.35 },
      { key: "width", name: "Stereo Width", min: 0, max: 1, default: 0.5 },
      { key: "mono", name: "Mono", min: 0, max: 1, default: 0, step: 1 },
      { key: "glide", name: "Glide", min: 0, max: 0.5, default: 0 },
    ],
    create(p) {
      const opts = {
        oscillator: { type: num(p, "osc", 0) >= 0.5 ? "fatsquare" : "fatsawtooth", count: 7, spread: num(p, "detune", 35) },
        envelope: { attack: num(p, "attack", 0.01), decay: num(p, "decay", 0.3), sustain: num(p, "sustain", 0.8), release: num(p, "release", 0.35) },
        filter: { type: "lowpass" as const, Q: num(p, "resonance", 1), rolloff: -24 },
        filterEnvelope: {
          attack: Math.max(0.001, num(p, "attack", 0.01) * 0.6), decay: num(p, "filterDecay", 0.4), sustain: 0.35, release: num(p, "release", 0.35),
          baseFrequency: num(p, "cutoff", 5000), octaves: num(p, "filterEnv", 1.5),
        },
        portamento: num(p, "mono", 0) >= 0.5 ? num(p, "glide", 0) : 0,
      };
      const synth = num(p, "mono", 0) >= 0.5 ? new Tone.MonoSynth(opts as any) : new Tone.PolySynth(Tone.MonoSynth, opts as any);
      const chorus = new Tone.Chorus(0.8, 3, 0.7).start();
      chorus.wet.value = num(p, "width", 0.5);
      const out = new Tone.Gain(0.55);
      synth.chain(chorus, out);
      return wrap(synth as any, out, [chorus]);
    },
  },
  {
    id: "am",
    name: "AM Synth",
    params: [
      { key: "harmonicity", name: "Harmonicity", min: 0.25, max: 8, default: 2 },
      { key: "osc", name: "Carrier Wave", min: 0, max: 3, default: 0, step: 1 },
      { key: "modOsc", name: "Modulator Wave", min: 0, max: 3, default: 1, step: 1 },
      { key: "attack", name: "Attack", min: 0.001, max: 3, default: 0.01 },
      { key: "decay", name: "Decay", min: 0.01, max: 4, default: 0.6 },
      { key: "sustain", name: "Sustain", min: 0, max: 1, default: 0.4 },
      { key: "release", name: "Release", min: 0.01, max: 6, default: 0.8 },
      { key: "modDecay", name: "Mod Decay", min: 0.01, max: 4, default: 0.5 },
      { key: "modSustain", name: "Mod Sustain", min: 0, max: 1, default: 0.5 },
      { key: "brightness", name: "Brightness", min: 300, max: 18000, default: 9000 },
      { key: "chorus", name: "Chorus", min: 0, max: 1, default: 0.2 },
    ],
    create(p) {
      const waves = ["sine", "triangle", "square", "sawtooth"] as const;
      const synth = new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: num(p, "harmonicity", 2),
        oscillator: { type: waves[clamp(Math.round(num(p, "osc", 0)), 0, 3)] },
        modulation: { type: waves[clamp(Math.round(num(p, "modOsc", 1)), 0, 3)] },
        envelope: { attack: num(p, "attack", 0.01), decay: num(p, "decay", 0.6), sustain: num(p, "sustain", 0.4), release: num(p, "release", 0.8) },
        modulationEnvelope: { attack: 0.005, decay: num(p, "modDecay", 0.5), sustain: num(p, "modSustain", 0.5), release: num(p, "release", 0.8) },
      } as any);
      const filter = new Tone.Filter(num(p, "brightness", 9000), "lowpass");
      const chorus = new Tone.Chorus(1.1, 2.8, 0.5).start();
      chorus.wet.value = num(p, "chorus", 0.2);
      const out = new Tone.Gain(0.75);
      synth.chain(filter, chorus, out);
      return wrap(synth as any, out, [filter, chorus]);
    },
  },
  {
    id: "brass",
    name: "Swell Brass",
    params: [
      { key: "cutoff", name: "Base Cutoff", min: 100, max: 6000, default: 600 },
      { key: "envAmt", name: "Bwaa Amount", min: 0, max: 5, default: 2.6 },
      { key: "swell", name: "Swell Time", min: 0.005, max: 1.5, default: 0.12 },
      { key: "resonance", name: "Resonance", min: 0.1, max: 8, default: 1.2 },
      { key: "attack", name: "Attack", min: 0.001, max: 2, default: 0.04 },
      { key: "sustain", name: "Sustain", min: 0, max: 1, default: 0.85 },
      { key: "release", name: "Release", min: 0.02, max: 4, default: 0.3 },
      { key: "detune", name: "Ensemble Detune", min: 0, max: 40, default: 12 },
      { key: "breath", name: "Breath Noise", min: 0, max: 1, default: 0.15 },
      { key: "vibrato", name: "Vibrato", min: 0, max: 1, default: 0.15 },
    ],
    create(p) {
      const swell = num(p, "swell", 0.12);
      const rel = num(p, "release", 0.3);
      const synth = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: num(p, "detune", 12) },
        envelope: { attack: num(p, "attack", 0.04), decay: 0.25, sustain: num(p, "sustain", 0.85), release: rel },
        filter: { type: "lowpass", Q: num(p, "resonance", 1.2), rolloff: -24 },
        filterEnvelope: { attack: swell, decay: 0.35 + swell, sustain: 0.55, release: rel, baseFrequency: num(p, "cutoff", 600), octaves: num(p, "envAmt", 2.6) },
      } as any);
      const breathLevel = num(p, "breath", 0.15);
      const breath = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: Math.max(0.005, swell * 0.6), decay: 0.25, sustain: 0.2, release: rel } } as any);
      const breathBp = new Tone.Filter({ type: "bandpass", frequency: 1400, Q: 0.9 });
      const breathGain = new Tone.Gain(breathLevel * 0.22);
      const breathOnce = makeOncePerTime();
      const vib = new Tone.Vibrato({ frequency: 5.2, depth: num(p, "vibrato", 0.15) * 0.08 } as any);
      const out = new Tone.Gain(0.7);
      synth.chain(vib, out);
      breath.chain(breathBp, breathGain, out);
      return {
        triggerAttackRelease: (midi, dur, time, vel) => {
          const d = Math.max(0.03, dur);
          try { synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), d, time, vel); } catch {}
          if (breathLevel > 0.01 && breathOnce(time)) { try { breath.triggerAttackRelease(d, time, vel); } catch {} }
        },
        connect: (dest) => out.connect(dest as any),
        releaseAll: (t) => { try { synth.releaseAll(t); } catch {} },
        set: () => {},
        dispose: () => { for (const n of [synth, breath, breathBp, breathGain, vib, out] as Array<{ dispose(): unknown }>) { try { n.dispose(); } catch {} } },
        output: out,
      };
    },
  },
  {
    id: "strings-synth",
    name: "Ensemble Strings",
    params: [
      { key: "attack", name: "Attack", min: 0.01, max: 4, default: 0.45 },
      { key: "release", name: "Release", min: 0.05, max: 6, default: 1.2 },
      { key: "cutoff", name: "Brightness", min: 300, max: 14000, default: 4200 },
      { key: "detune", name: "Detune", min: 0, max: 60, default: 18 },
      { key: "vibratoRate", name: "Vibrato Rate", min: 0.5, max: 9, default: 5.4 },
      { key: "vibratoDepth", name: "Vibrato Depth", min: 0, max: 1, default: 0.25 },
      { key: "ensemble", name: "Ensemble", min: 0, max: 1, default: 0.6 },
      { key: "octave", name: "Octave Layer", min: 0, max: 1, default: 0 },
    ],
    create(p) {
      const env = { attack: num(p, "attack", 0.45), decay: 0.4, sustain: 0.9, release: num(p, "release", 1.2) };
      const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 3, spread: num(p, "detune", 18) }, envelope: env } as any);
      const octLevel = num(p, "octave", 0);
      const upper = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 2, spread: num(p, "detune", 18) * 0.7 }, envelope: env } as any);
      const upperGain = new Tone.Gain(octLevel * 0.5);
      const lp = new Tone.Filter({ type: "lowpass", frequency: num(p, "cutoff", 4200), Q: 0.5, rolloff: -24 });
      const hp = new Tone.Filter(110, "highpass");
      const vib = new Tone.Vibrato({ frequency: num(p, "vibratoRate", 5.4), depth: num(p, "vibratoDepth", 0.25) * 0.1 } as any);
      const chorus = new Tone.Chorus(0.7, 4.5, 0.8).start();
      chorus.wet.value = num(p, "ensemble", 0.6);
      const out = new Tone.Gain(0.6);
      synth.connect(lp);
      upper.chain(upperGain, lp);
      lp.chain(hp, vib, chorus, out);
      return {
        triggerAttackRelease: (midi, dur, time, vel) => {
          const d = Math.max(0.03, dur);
          try { synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), d, time, vel); } catch {}
          if (octLevel > 0.01) { try { upper.triggerAttackRelease(Tone.Frequency(midi + 12, "midi").toFrequency(), d, time, vel); } catch {} }
        },
        connect: (dest) => out.connect(dest as any),
        releaseAll: (t) => { try { synth.releaseAll(t); upper.releaseAll(t); } catch {} },
        set: () => {},
        dispose: () => { for (const n of [synth, upper, upperGain, lp, hp, vib, chorus, out] as Array<{ dispose(): unknown }>) { try { n.dispose(); } catch {} } },
        output: out,
      };
    },
  },
];

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
  ...EXPANSION_ENGINES,
];

/**
 * Sampled instruments (Salamander piano, VSCO 2 CE orchestra): one engine per manifest entry,
 * id "sampled-<instrumentId>". If its samples cannot load, the instance plays this synth preset instead.
 */
const SAMPLED_FALLBACK_PRESET: Record<string, string> = {
  "grand-piano": "piano-studio", "strings-ensemble": "strings-synth-lush", violin: "strings-synth-lush", cello: "strings-synth-dark",
  pizzicato: "pluck", harp: "harp-plucked", flute: "flute-air", clarinet: "flute-air", oboe: "lead-whistle",
  trumpet: "brass-stabs", "french-horn": "brass-soft-horns", trombone: "brass-swell", "brass-section": "brass-swell",
  glockenspiel: "bell", marimba: "fm-marimba", xylophone: "mallet", timpani: "percussion",
};
SYNTH_ENGINES.push(
  ...createSampledEngines((instrumentId) => {
    const preset = INSTRUMENT_PRESETS.find((p) => p.id === (SAMPLED_FALLBACK_PRESET[instrumentId] ?? "pad-strings"));
    return preset && !preset.engineId.startsWith(SAMPLED_ENGINE_PREFIX) ? createInstrument(preset.engineId, preset.params) : null;
  }),
);

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
  { id: "pad-strings", name: "Strings Pad", category: "Synth Pads", engineId: "pad", params: { attack: 0.8, release: 2, cutoff: 3500, movement: 0.3, chorusDepth: 0.4 } },
  { id: "pad-choir", name: "Choir Pad", category: "Synth Pads", engineId: "pad", params: { attack: 1.5, release: 3, cutoff: 1800, texture: 0.3, reverb: 0.8 } },
  { id: "pad-ambient", name: "Ambient Texture", category: "Synth Pads", engineId: "pad", params: { attack: 2.5, release: 5, cutoff: 1500, movement: 0.8, texture: 0.5, reverb: 0.9 } },
  // Leads & plucks
  { id: "lead-synth", name: "Synth Lead", category: "Synth Leads", engineId: "pluck", params: { decay: 1.2, cutoff: 9000, mono: 1, glide: 0.05, drive: 0.4, delay: 0.3 } },
  { id: "pluck", name: "Pluck", category: "Synth Leads", engineId: "pluck", params: { decay: 0.3, cutoff: 7000, delay: 0.3 } },
  { id: "pluck-guitar", name: "Guitar-ish Pluck", category: "Synth Leads", engineId: "pluck", params: { decay: 0.6, cutoff: 4200, delay: 0.12, drive: 0.15 } },
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
  { id: "lead-super", name: "Supersaw Lead", category: "Synth Leads", engineId: "subtractive", params: { osc: 2, unison: 5, detune: 25, cutoff: 9000, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.3 } },
  { id: "lead-square", name: "Square Lead", category: "Synth Leads", engineId: "subtractive", params: { osc: 1, mono: 1, glide: 0.06, cutoff: 6000, attack: 0.005, sustain: 0.9, release: 0.15 } },
  { id: "lead-whistle", name: "Whistle Lead", category: "Synth Leads", engineId: "subtractive", params: { osc: 0, mono: 1, glide: 0.09, cutoff: 12000, lfoRate: 5.5, lfoDepth: 0.15, attack: 0.05, sustain: 1, release: 0.2 } },
  { id: "lead-trance", name: "Trance Pluck", category: "Synth Leads", engineId: "pluck", params: { decay: 0.22, cutoff: 10000, delay: 0.55, drive: 0.2 } },
  { id: "lead-retro", name: "Retro Chip", category: "Synth Leads", engineId: "subtractive", params: { osc: 1, unison: 1, cutoff: 14000, attack: 0.001, decay: 0.08, sustain: 0.6, release: 0.05 } },
  // Keys
  { id: "keys-house-organ", name: "House Organ", category: "Keys", engineId: "epiano", params: { bell: 0.6, chorusDepth: 0.15, release: 0.3 } },
  { id: "keys-clav", name: "Clav", category: "Keys", engineId: "pluck", params: { decay: 0.4, cutoff: 5200, drive: 0.35, delay: 0 } },
  { id: "keys-music-box", name: "Music Box", category: "Keys", engineId: "fm", params: { ratio: 4, modIndex: 10, decay: 1.6, sustain: 0, release: 1.8, modDecay: 0.1 } },
  { id: "keys-dream", name: "Dream Keys", category: "Keys", engineId: "epiano", params: { bell: 0.25, chorusDepth: 0.6, release: 2.6 } },
  { id: "piano-grand-bright", name: "Bright Grand", category: "Piano", engineId: "piano", params: { brightness: 0.9, release: 0.9 } },
  { id: "piano-tape", name: "Tape Piano", category: "Piano", engineId: "piano", params: { brightness: 0.35, release: 1.4, lofi: 0.45 } },
  // Pads
  { id: "pad-warm-analog", name: "Warm Analog Pad", category: "Synth Pads", engineId: "pad", params: { attack: 0.6, release: 2.5, cutoff: 2200, movement: 0.2, texture: 0, chorusDepth: 0.6, reverb: 0.5 } },
  { id: "pad-dark-drone", name: "Dark Drone", category: "Synth Pads", engineId: "pad", params: { attack: 3, release: 8, cutoff: 700, movement: 0.5, texture: 0.35, reverb: 0.95 } },
  { id: "pad-shimmer", name: "Shimmer Pad", category: "Synth Pads", engineId: "pad", params: { attack: 1.2, release: 4, cutoff: 8000, movement: 0.7, texture: 0.15, chorusDepth: 0.8, reverb: 0.85 } },
  { id: "pad-vapor", name: "Vaporwave Pad", category: "Synth Pads", engineId: "pad", params: { attack: 0.9, release: 3.5, cutoff: 3200, movement: 0.55, texture: 0.25, chorusDepth: 1, reverb: 0.7 } },
  { id: "pad-cinematic", name: "Cinematic Swell", category: "Synth Pads", engineId: "pad", params: { attack: 4.5, release: 6, cutoff: 4500, movement: 0.4, texture: 0.2, reverb: 0.9 } },
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
  { id: "pluck-koto", name: "Koto Pluck", category: "Synth Leads", engineId: "pluck", params: { decay: 0.7, cutoff: 3800, delay: 0.18, drive: 0.1 } },
  { id: "pluck-harp", name: "Harp", category: "Synth Leads", engineId: "pluck", params: { decay: 1.1, cutoff: 6500, delay: 0.1 } },
  // FX / texture
  { id: "sfx-riser-synth", name: "Playable Riser", category: "FX", engineId: "subtractive", params: { osc: 2, unison: 5, detune: 40, noise: 0.4, cutoff: 2000, lfoRate: 0.3, lfoDepth: 1, attack: 1.5, sustain: 1, release: 2 } },
  { id: "sfx-laser", name: "Laser Zap", category: "FX", engineId: "fm", params: { ratio: 0.25, modIndex: 40, decay: 0.25, sustain: 0, release: 0.15, modDecay: 0.04 } },
  { id: "sfx-underwater", name: "Underwater", category: "FX", engineId: "pad", params: { attack: 0.3, release: 2, cutoff: 500, movement: 0.9, texture: 0.5, reverb: 0.9 } },
  // ---- 2.0: plucked strings (Karplus–Strong "string" engine) ----
  { id: "nylon-guitar", name: "Nylon Guitar", category: "Guitar", engineId: "string", params: { brightness: 0.32, damping: 0.34, pick: 0.22, body: 0.65, bodyFreq: 180, release: 0.7 } },
  { id: "steel-guitar", name: "Steel-String Acoustic", category: "Guitar", engineId: "string", params: { brightness: 0.68, damping: 0.22, pick: 0.45, body: 0.5, bodyFreq: 220, release: 0.8 } },
  { id: "twelve-string-guitar", name: "12-String Acoustic", category: "Guitar", engineId: "string", params: { brightness: 0.62, damping: 0.24, pick: 0.4, body: 0.45, bodyFreq: 210, octave: 0.55, chorus: 0.35, release: 0.8 } },
  { id: "electric-guitar-clean", name: "Clean Electric Guitar", category: "Guitar", engineId: "string", params: { brightness: 0.55, damping: 0.14, pick: 0.3, body: 0.15, bodyFreq: 400, chorus: 0.3, release: 0.4 } },
  { id: "sitar", name: "Sitar-ish", category: "Guitar", engineId: "string", params: { brightness: 0.9, damping: 0.08, pick: 0.85, body: 0.35, bodyFreq: 450, buzz: 0.55, chorus: 0.15, release: 1.2 } },
  { id: "koto", name: "Koto", category: "Guitar", engineId: "string", params: { brightness: 0.72, damping: 0.42, pick: 0.62, body: 0.4, bodyFreq: 320, release: 0.5 } },
  { id: "banjo", name: "Banjo", category: "Guitar", engineId: "string", params: { brightness: 0.95, damping: 0.62, pick: 0.75, body: 0.75, bodyFreq: 500, release: 0.25 } },
  { id: "harp-plucked", name: "Plucked Harp (synth)", category: "Strings", engineId: "string", params: { brightness: 0.42, damping: 0.1, pick: 0.08, body: 0.3, bodyFreq: 260, chorus: 0.1, release: 1.6 } },
  { id: "bass-guitar", name: "Bass Guitar (fingered)", category: "Bass", engineId: "string", params: { brightness: 0.28, damping: 0.3, pick: 0.3, body: 0.45, bodyFreq: 90, release: 0.25, voices: 4 } },

  // ---- 2.0: drawbar organs ----
  { id: "b3-organ", name: "B3 Jazz Organ", category: "Organ", engineId: "organ", params: { db16: 8, db513: 8, db8: 8, db4: 0, db223: 0, db2: 0, db135: 0, db113: 0, db1: 0, perc: 0.7, percHarm: 1, percDecay: 0.22, click: 0.45, rotary: 0.45, rotarySpeed: 0.8, drive: 0.08, tone: 6500, release: 0.05 } },
  { id: "gospel-organ", name: "Gospel Organ", category: "Organ", engineId: "organ", params: { db16: 8, db513: 8, db8: 8, db4: 8, db223: 0, db2: 0, db135: 0, db113: 0, db1: 8, perc: 0.35, percHarm: 0, percDecay: 0.4, click: 0.5, rotary: 0.75, rotarySpeed: 6.2, drive: 0.2, tone: 8500, release: 0.08 } },
  { id: "rock-organ", name: "Rock Overdrive Organ", category: "Organ", engineId: "organ", params: { db16: 8, db513: 8, db8: 8, db4: 6, db223: 0, db2: 4, db135: 0, db113: 0, db1: 2, perc: 0.3, percHarm: 1, percDecay: 0.18, click: 0.6, rotary: 0.6, rotarySpeed: 5.8, drive: 0.7, tone: 5000, release: 0.06 } },
  { id: "church-organ", name: "Church Organ (Full Stops)", category: "Organ", engineId: "organ", params: { db16: 8, db513: 6, db8: 8, db4: 8, db223: 6, db2: 8, db135: 5, db113: 6, db1: 7, perc: 0, click: 0, rotary: 0.05, rotarySpeed: 0.4, drive: 0, tone: 12000, release: 0.9 } },
  { id: "house-organ", name: "House Organ", category: "Organ", engineId: "organ", params: { db16: 0, db513: 0, db8: 8, db4: 8, db223: 0, db2: 8, db135: 0, db113: 0, db1: 6, perc: 0.9, percHarm: 0, percDecay: 0.12, click: 0.7, rotary: 0.1, rotarySpeed: 1.2, drive: 0.15, tone: 10000, release: 0.03 } },

  // ---- 2.0: supersaw ----
  { id: "supersaw-lead", name: "Trance Supersaw Lead", category: "Supersaw", engineId: "supersaw", params: { detune: 38, cutoff: 6500, resonance: 1.5, filterEnv: 1.2, filterDecay: 0.35, attack: 0.005, decay: 0.4, sustain: 0.85, release: 0.35, width: 0.55, mono: 1, glide: 0.04 } },
  { id: "supersaw-chords", name: "Festival Supersaw Chords", category: "Supersaw", engineId: "supersaw", params: { detune: 50, cutoff: 3800, resonance: 1, filterEnv: 2.2, filterDecay: 0.6, attack: 0.008, decay: 0.6, sustain: 0.7, release: 0.5, width: 0.85 } },
  { id: "future-bass-chords", name: "Future Bass Chords", category: "Supersaw", engineId: "supersaw", params: { detune: 28, cutoff: 1800, resonance: 3.5, filterEnv: 3.2, filterDecay: 0.45, attack: 0.02, decay: 0.5, sustain: 0.55, release: 0.6, width: 1 } },
  { id: "hoover", name: "Hoover-ish", category: "Supersaw", engineId: "supersaw", params: { osc: 1, detune: 85, cutoff: 2200, resonance: 2.5, filterEnv: 2, filterDecay: 0.8, attack: 0.03, decay: 0.8, sustain: 0.9, release: 0.4, width: 1, mono: 1, glide: 0.14 } },

  // ---- 2.0: AM voices ----
  { id: "am-bell", name: "AM Bells", category: "Keys", engineId: "am", params: { harmonicity: 3.48, osc: 0, modOsc: 0, attack: 0.002, decay: 2.2, sustain: 0, release: 2, modDecay: 1.4, modSustain: 0.1, brightness: 14000, chorus: 0.25 } },
  { id: "am-keys", name: "AM Soft Keys", category: "Keys", engineId: "am", params: { harmonicity: 2, osc: 1, modOsc: 0, attack: 0.004, decay: 1.1, sustain: 0.25, release: 0.7, modDecay: 0.45, modSustain: 0.2, brightness: 6500, chorus: 0.35 } },
  { id: "am-soft-lead", name: "AM Soft Lead", category: "Synth Leads", engineId: "am", params: { harmonicity: 1, osc: 1, modOsc: 1, attack: 0.03, decay: 0.3, sustain: 0.85, release: 0.4, modDecay: 0.6, modSustain: 0.7, brightness: 7000, chorus: 0.15 } },
  { id: "am-glass-pad", name: "AM Glass Pad", category: "Synth Pads", engineId: "am", params: { harmonicity: 4.01, osc: 0, modOsc: 1, attack: 1.2, decay: 1.5, sustain: 0.7, release: 3, modDecay: 2.5, modSustain: 0.6, brightness: 9000, chorus: 0.7 } },

  // ---- 2.0: synth brass ----
  { id: "brass-swell", name: "Synth Brass Swell", category: "Brass", engineId: "brass", params: { cutoff: 450, envAmt: 2.8, swell: 0.45, resonance: 1, attack: 0.25, sustain: 0.9, release: 0.6, detune: 14, breath: 0.2, vibrato: 0.2 } },
  { id: "brass-stabs", name: "Synth Brass Stabs", category: "Brass", engineId: "brass", params: { cutoff: 700, envAmt: 3.2, swell: 0.04, resonance: 1.6, attack: 0.008, sustain: 0.6, release: 0.18, detune: 10, breath: 0.08, vibrato: 0 } },
  { id: "brass-80s", name: "80s Poly Brass", category: "Brass", engineId: "brass", params: { cutoff: 900, envAmt: 2.4, swell: 0.12, resonance: 2, attack: 0.03, sustain: 0.8, release: 0.35, detune: 28, breath: 0, vibrato: 0.1 } },
  { id: "brass-soft-horns", name: "Soft Synth Horns", category: "Brass", engineId: "brass", params: { cutoff: 300, envAmt: 1.6, swell: 0.3, resonance: 0.7, attack: 0.12, sustain: 0.9, release: 0.5, detune: 8, breath: 0.35, vibrato: 0.25 } },

  // ---- 2.0: ensemble strings ----
  { id: "strings-synth-lush", name: "Lush Synth Strings", category: "Strings", engineId: "strings-synth", params: { attack: 0.6, release: 1.8, cutoff: 5200, detune: 22, vibratoRate: 5.2, vibratoDepth: 0.3, ensemble: 0.75, octave: 0.25 } },
  { id: "string-machine", name: "String Machine", category: "Strings", engineId: "strings-synth", params: { attack: 0.25, release: 1, cutoff: 7000, detune: 30, vibratoRate: 6, vibratoDepth: 0.15, ensemble: 1, octave: 0.5 } },
  { id: "strings-synth-dark", name: "Dark Legato Strings", category: "Strings", engineId: "strings-synth", params: { attack: 0.9, release: 2.2, cutoff: 1800, detune: 14, vibratoRate: 4.8, vibratoDepth: 0.35, ensemble: 0.5, octave: 0 } },
  { id: "strings-synth-tremolo", name: "Fast Synth Strings", category: "Strings", engineId: "strings-synth", params: { attack: 0.06, release: 0.5, cutoff: 6000, detune: 18, vibratoRate: 7.5, vibratoDepth: 0.4, ensemble: 0.6, octave: 0.15 } },

  // ---- 2.0: real sampled instruments (one per manifest entry; preset id = instrument id) ----
  ...SAMPLE_MANIFEST.instruments.map((inst): InstrumentPreset => ({
    id: inst.id, name: inst.name, category: inst.category, engineId: sampledEngineId(inst.id), params: {},
  })),
  // sampled variations
  { id: "grand-piano-mellow", name: "Grand Piano Mellow", category: "Piano", engineId: "sampled-grand-piano", params: { brightness: 3800, velocity: 0.85, release: 1.4 } },
  { id: "grand-piano-felt", name: "Grand Piano Felt (soft)", category: "Piano", engineId: "sampled-grand-piano", params: { brightness: 1900, velocity: 0.5, release: 1.8, volume: 2 } },
  { id: "strings-ensemble-soft", name: "Strings Ensemble Soft Swell", category: "Strings", engineId: "sampled-strings-ensemble", params: { attack: 0.35, release: 1.4, brightness: 6500, velocity: 0.5 } },
  { id: "brass-section-swell", name: "Brass Section Swell", category: "Brass", engineId: "sampled-brass-section", params: { attack: 0.18, release: 0.9, brightness: 9000 } },
  { id: "harp-soft", name: "Harp Soft", category: "Strings", engineId: "sampled-harp", params: { brightness: 5000, velocity: 0.6, release: 2 } },
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
