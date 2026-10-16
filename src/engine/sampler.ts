/**
 * Sampler instrument: plays an AudioBuffer across the keyboard with ADSR, filter,
 * loop points, polyphony/mono, portamento, reverse, velocity response.
 * Also used (with pitchTrack off) as the drum-channel player.
 */
import * as Tone from "tone";
import type { InstrumentInstance } from "./instruments";

export interface SamplerParams {
  rootNote: number;
  startNorm: number;
  endNorm: number;
  loop: boolean;
  loopStartNorm: number;
  loopEndNorm: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterHz: number;
  gainDb: number;
  pan: number;
  polyphony: number;
  mono: boolean;
  portamento: number;
  reverse: boolean;
  velocityAmount: number;
  pitchTrack: boolean;
}

/** True for Tone's offline (render/export) context. */
export function isOfflineContext(ctx: Tone.BaseContext): boolean {
  return ctx instanceof Tone.OfflineContext || (typeof OfflineAudioContext !== "undefined" && ctx.rawContext instanceof OfflineAudioContext);
}

export const DEFAULT_SAMPLER_PARAMS: SamplerParams = {
  rootNote: 60, startNorm: 0, endNorm: 1, loop: false, loopStartNorm: 0, loopEndNorm: 1,
  attack: 0.002, decay: 0.1, sustain: 1, release: 0.1, filterHz: 20000, gainDb: 0, pan: 0,
  polyphony: 8, mono: false, portamento: 0, reverse: false, velocityAmount: 1, pitchTrack: true,
};

interface Voice {
  source: Tone.ToneBufferSource;
  env: Tone.Gain;
  startedAt: number;
}

export class SamplerInstrument implements InstrumentInstance {
  output: Tone.Gain;
  /** context captured at construction so voices created later (inside offline
   * render callbacks) bind to the same context as the rest of the graph */
  private ctx = Tone.getContext();
  private filter: Tone.Filter;
  private panner: Tone.Panner;
  private voices: Voice[] = [];
  private lastPitch: number | null = null;
  private reversedCache: AudioBuffer | null = null;

  constructor(private buffer: AudioBuffer | null, private params: SamplerParams) {
    this.output = new Tone.Gain(Tone.dbToGain(params.gainDb));
    this.filter = new Tone.Filter(params.filterHz, "lowpass");
    this.panner = new Tone.Panner(params.pan);
    this.filter.connect(this.panner);
    this.panner.connect(this.output);
  }

  private effectiveBuffer(): AudioBuffer | null {
    if (!this.buffer) return null;
    if (!this.params.reverse) return this.buffer;
    if (!this.reversedCache) {
      const rev = new AudioBuffer({ length: this.buffer.length, numberOfChannels: this.buffer.numberOfChannels, sampleRate: this.buffer.sampleRate });
      for (let c = 0; c < this.buffer.numberOfChannels; c++) {
        const src = this.buffer.getChannelData(c);
        const dst = rev.getChannelData(c);
        for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i]!;
      }
      this.reversedCache = rev;
    }
    return this.reversedCache;
  }

  triggerAttackRelease(midi: number, durSec: number, time: number, velocity: number): void {
    const buf = this.effectiveBuffer();
    if (!buf) return;
    const p = this.params;
    const rate = p.pitchTrack ? Math.pow(2, (midi - p.rootNote) / 12) : 1;
    const durTotal = buf.duration;
    const startSec = p.startNorm * durTotal;
    const endSec = Math.max(startSec + 0.01, p.endNorm * durTotal);

    if (p.mono) this.voices.splice(0).forEach((v) => this.killVoice(v, time));
    while (this.voices.length >= p.polyphony) this.killVoice(this.voices.shift()!, time);

    const env = new Tone.Gain({ gain: 0, context: this.ctx });
    env.connect(this.filter);
    const source = new Tone.ToneBufferSource({ url: buf as any, playbackRate: rate, context: this.ctx });
    if (p.loop) {
      source.loop = true;
      source.loopStart = p.loopStartNorm * durTotal;
      source.loopEnd = Math.max(source.loopStart as number + 0.01, p.loopEndNorm * durTotal);
    }
    source.connect(env);

    // portamento in mono mode: glide playbackRate from previous pitch
    if (p.mono && p.portamento > 0 && this.lastPitch !== null && p.pitchTrack) {
      const fromRate = Math.pow(2, (this.lastPitch - p.rootNote) / 12);
      source.playbackRate.setValueAtTime(fromRate, time);
      source.playbackRate.linearRampToValueAtTime(rate, time + p.portamento);
    }
    this.lastPitch = midi;

    const vel = 1 - p.velocityAmount + velocity * p.velocityAmount;
    const g = env.gain;
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(vel, time + p.attack);
    g.linearRampToValueAtTime(vel * p.sustain, time + p.attack + p.decay);
    const holdEnd = time + Math.max(durSec, p.attack + 0.01);
    g.setValueAtTime(vel * p.sustain, holdEnd);
    g.linearRampToValueAtTime(0, holdEnd + p.release);

    const playDur = p.loop ? durSec + p.release + 0.05 : Math.min((endSec - startSec) / rate, durSec + p.release + 0.05);
    source.start(time, startSec, p.loop ? undefined : playDur);
    if (p.loop) source.stop(time + playDur);

    const voice: Voice = { source, env, startedAt: time };
    this.voices.push(voice);
    source.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      // Offline renders run every Tone callback in a pre-pass BEFORE rendering audio, so disposing
      // here would disconnect the voice before it ever sounds (silent exports). The offline graph is
      // thrown away after rendering anyway; only clean up live voices.
      if (!isOfflineContext(this.ctx)) { try { source.dispose(); env.dispose(); } catch {} }
    };
  }

  /** Drum-style one-shot at natural pitch. */
  trigger(time: number, velocity: number): void {
    this.triggerAttackRelease(this.params.rootNote, this.buffer?.duration ?? 1, time, velocity);
  }

  private killVoice(v: Voice, time: number) {
    try {
      v.env.gain.cancelScheduledValues(time);
      v.env.gain.setValueAtTime(v.env.gain.value, time);
      v.env.gain.linearRampToValueAtTime(0, time + 0.01);
      v.source.stop(time + 0.02);
    } catch {}
  }

  connect(dest: Tone.ToneAudioNode | AudioNode): void {
    this.output.connect(dest as any);
  }

  releaseAll(time?: number): void {
    const t = time ?? Tone.now();
    this.voices.splice(0).forEach((v) => this.killVoice(v, t));
  }

  set(params: Record<string, number>): void {
    const p = this.params as unknown as Record<string, number | boolean>;
    for (const [k, v] of Object.entries(params)) {
      if (k in p) p[k] = typeof p[k] === "boolean" ? v > 0.5 : v;
    }
    if ("reverse" in params) this.reversedCache = null;
    this.filter.frequency.value = this.params.filterHz;
    this.panner.pan.value = this.params.pan;
    this.output.gain.value = Tone.dbToGain(this.params.gainDb);
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.buffer = buffer;
    this.reversedCache = null;
  }

  dispose(): void {
    this.releaseAll();
    setTimeout(() => {
      try { this.filter.dispose(); this.panner.dispose(); this.output.dispose(); } catch {}
    }, 100);
  }
}

/** Build an AudioBuffer from mono Float32 DSP output. */
export function bufferFromMono(data: Float32Array, sampleRate: number): AudioBuffer {
  const buf = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
  buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return buf;
}
