/**
 * Audio-graph construction + event scheduling, shared verbatim by live playback
 * (engine.ts) and offline export (render.ts). Whatever context Tone currently has
 * (live or offline) is where the graph is built.
 */
import * as Tone from "tone";
import type { Project, MixerChannel } from "../../shared/project";
import { MASTER_ID } from "../../shared/project";
import { ticksToSeconds } from "../../shared/time";
import { createEffect, type EffectNode, EFFECT_DEFS } from "./effects";
import { createInstrument, type InstrumentInstance } from "./instruments";
import { SamplerInstrument, DEFAULT_SAMPLER_PARAMS, bufferFromMono } from "./sampler";
import { getKit, getKitSound } from "./kits";
import { FACTORY_RATE, mulberry32, synthMetronomeTick } from "./dsp";
import type { EventList } from "./events";

export interface MixerNodes {
  channel: MixerChannel;
  input: Tone.Gain;
  volume: Tone.Volume;
  panner: Tone.Panner;
  post: Tone.Gain;
  effects: EffectNode[];
  sendGains: Tone.Gain[];
  duck?: { follower: Tone.Follower; scale: Tone.Scale; gain: Tone.Gain };
  meter?: Tone.Meter;
}

export interface BuiltGraph {
  mixer: Map<string, MixerNodes>;
  instruments: Map<string, InstrumentInstance>; // channelId -> instrument
  drumPlayers: Map<string, SamplerInstrument>; // channelId (drum-sound channels) -> player
  dispose(): void;
}

export type BufferResolver = (assetId: string) => AudioBuffer | null;

const drumBufferCache = new Map<string, AudioBuffer>();
export function getDrumBuffer(kitId: string, soundIdOrRole: string): AudioBuffer {
  const sound = getKitSound(kitId, soundIdOrRole);
  let buf = drumBufferCache.get(sound.id);
  if (!buf) {
    buf = bufferFromMono(sound.render(), FACTORY_RATE);
    drumBufferCache.set(sound.id, buf);
  }
  return buf;
}

export function buildGraph(project: Project, destination: Tone.ToneAudioNode | AudioNode, withMeters: boolean): BuiltGraph {
  const mixer = new Map<string, MixerNodes>();
  const soloActive = project.mixer.channels.some((c) => c.soloed);

  // 1. create all mixer channel strips
  for (const ch of project.mixer.channels) {
    const input = new Tone.Gain(1);
    const volume = new Tone.Volume(ch.volumeDb);
    const panner = new Tone.Panner(ch.pan);
    const post = new Tone.Gain(1);
    const effects: EffectNode[] = [];
    let head: Tone.ToneAudioNode = input;
    for (const fx of ch.effects) {
      if (!fx.enabled) continue;
      try {
        const node = createEffect(fx.type, fx.params);
        head.connect(node.input);
        head = node.output;
        effects.push(node);
      } catch {
        // an effect that fails to construct must not silence the channel
      }
    }
    let duck: MixerNodes["duck"];
    if (ch.sidechainFromId) {
      const duckGain = new Tone.Gain(0); // signal-driven: follower adds (1-env)
      const follower = new Tone.Follower(0.06);
      const scale = new Tone.Scale(1, 0.15); // env 0..1 -> gain 1..0.15
      follower.connect(scale);
      scale.connect(duckGain.gain);
      head.connect(duckGain);
      head = duckGain;
      duck = { follower, scale, gain: duckGain };
    }
    head.connect(volume);
    volume.connect(panner);
    panner.connect(post);
    const muted = ch.muted || (soloActive && !ch.soloed && ch.kind !== "master");
    volume.mute = muted;
    let meter: Tone.Meter | undefined;
    if (withMeters) {
      meter = new Tone.Meter({ smoothing: 0.7 });
      post.connect(meter);
    }
    mixer.set(ch.id, { channel: ch, input, volume, panner, post, effects, sendGains: [], duck, meter });
  }

  // 2. routing: channel -> output (default master), sends, sidechain keys
  for (const ch of project.mixer.channels) {
    const nodes = mixer.get(ch.id)!;
    if (ch.kind === "master") {
      nodes.post.connect(destination as any);
    } else {
      const target = mixer.get(ch.outputId ?? MASTER_ID) ?? mixer.get(MASTER_ID)!;
      nodes.post.connect(target.input);
    }
    for (const send of ch.sends) {
      const target = mixer.get(send.toChannelId);
      if (!target || send.toChannelId === ch.id) continue;
      const g = new Tone.Gain(Tone.dbToGain(send.levelDb));
      (send.preFader ? nodes.input : nodes.post).connect(g);
      g.connect(target.input);
      nodes.sendGains.push(g);
    }
    if (ch.sidechainFromId && nodes.duck) {
      const key = mixer.get(ch.sidechainFromId);
      if (key) key.post.connect(nodes.duck.follower);
    }
  }

  // 3. rack channels: instruments + drum players
  const disposables: Array<{ dispose(): void }> = [];
  const instruments = new Map<string, InstrumentInstance>();
  const drumPlayers = new Map<string, SamplerInstrument>();
  const resolveOut = (mixerChannelId: string | null): Tone.Gain => (mixer.get(mixerChannelId ?? MASTER_ID) ?? mixer.get(MASTER_ID)!).input;

  for (const ch of project.channels) {
    const chanGain = new Tone.Gain(Tone.dbToGain(ch.volumeDb));
    const chanPan = new Tone.Panner(ch.pan);
    chanGain.connect(chanPan);
    chanPan.connect(resolveOut(ch.mixerChannelId));
    const inst = ch.instrument;
    if (inst.type === "drum-sound") {
      const player = new SamplerInstrument(getDrumBuffer(inst.kitId, inst.soundId), { ...DEFAULT_SAMPLER_PARAMS, pitchTrack: false, polyphony: 4 });
      player.connect(chanGain);
      drumPlayers.set(ch.id, player);
    } else if (inst.type === "drum-kit") {
      // one channel that plays whole kit by role (used by AI composition tracks)
      const player = new SamplerInstrument(getDrumBuffer(inst.kitId, "kick"), { ...DEFAULT_SAMPLER_PARAMS, pitchTrack: false, polyphony: 12 });
      player.connect(chanGain);
      drumPlayers.set(ch.id, player);
    } else if (inst.type === "synth") {
      const instObj = createInstrument(inst.synthId, inst.params);
      instObj.connect(chanGain);
      instruments.set(ch.id, instObj);
    } else if (inst.type === "sampler") {
      const buffer = inst.assetId ? bufferResolverRef.current?.(inst.assetId) ?? null : null;
      const sampler = new SamplerInstrument(buffer, { ...DEFAULT_SAMPLER_PARAMS, ...(inst.params as any) });
      sampler.connect(chanGain);
      instruments.set(ch.id, sampler);
    }
    disposables.push(chanGain, chanPan);
  }

  function dispose() {
    for (const inst of instruments.values()) inst.dispose();
    for (const p of drumPlayers.values()) p.dispose();
    for (const m of mixer.values()) {
      m.effects.forEach((e) => e.dispose());
      m.sendGains.forEach((g) => { try { g.dispose(); } catch {} });
      if (m.duck) { try { m.duck.follower.dispose(); m.duck.scale.dispose(); m.duck.gain.dispose(); } catch {} }
      try { m.input.dispose(); m.volume.dispose(); m.panner.dispose(); m.post.dispose(); m.meter?.dispose(); } catch {}
    }
    disposables.forEach((d) => { try { d.dispose(); } catch {} });
  }

  return { mixer, instruments, drumPlayers, dispose };
}

/** Buffer resolver is injected per build so offline render can reuse live buffers. */
export const bufferResolverRef: { current: BufferResolver | null } = { current: null };

export interface ScheduleOptions {
  seed?: number;
  /** where clip audio sources connect: mixer channel input via this lookup */
  onActiveVoices?: (delta: number) => void;
}

/**
 * Schedule an EventList onto the CURRENT Tone transport (live or offline).
 * Returns scheduled ids + a starter for audio clips overlapping the start position.
 */
export function scheduleEvents(
  project: Project,
  events: EventList,
  graph: BuiltGraph,
  resolveBuffer: BufferResolver,
  opts: ScheduleOptions = {},
): { ids: number[]; startAudioAt(startTick: number): void; disposeSources(): void } {
  const transport = Tone.getTransport();
  const ctx = Tone.getContext(); // capture: schedule callbacks fire while another context may be global
  const rng = mulberry32(opts.seed ?? 1234567);
  const ids: number[] = [];
  const liveSources: Array<Tone.ToneBufferSource | Tone.GrainPlayer> = [];
  const bpm = project.bpm;

  const kitByChannel = new Map<string, { kitId: string }>();
  for (const ch of project.channels) {
    if (ch.instrument.type === "drum-kit") kitByChannel.set(ch.id, { kitId: ch.instrument.kitId });
  }

  for (const ev of events.drums) {
    ids.push(
      transport.schedule((time) => {
        if (ev.probability < 1 && rng() > ev.probability) return;
        const player = graph.drumPlayers.get(ev.channelId);
        player?.trigger(time, ev.velocity);
      }, `${Math.max(0, Math.round(ev.tick))}i`),
    );
  }
  for (const ev of events.notes) {
    const durSec = ticksToSeconds(ev.durTicks, bpm);
    ids.push(
      transport.schedule((time) => {
        if (ev.probability < 1 && rng() > ev.probability) return;
        const inst = graph.instruments.get(ev.channelId);
        if (inst) {
          inst.triggerAttackRelease(ev.pitch, durSec, time, ev.velocity);
          return;
        }
        // drum-kit channels play roles by pitch: map C1.. up through kit sounds
        const kit = kitByChannel.get(ev.channelId);
        const player = graph.drumPlayers.get(ev.channelId);
        if (kit && player) {
          const sounds = getKit(kit.kitId).sounds;
          const sound = sounds[((ev.pitch % sounds.length) + sounds.length) % sounds.length]!;
          player.setBuffer(getDrumBuffer(kit.kitId, sound.id));
          player.trigger(time, ev.velocity);
        }
      }, `${Math.max(0, Math.round(ev.tick))}i`),
    );
  }

  const startAudioEvent = (ev: (typeof events.audio)[number], time: number, extraOffsetSec: number) => {
    let buffer = resolveBuffer(ev.assetId);
    if (!buffer) return;
    if (ev.reversed) {
      const rev = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const src = buffer.getChannelData(c), dst = rev.getChannelData(c);
        for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i]!;
      }
      buffer = rev;
    }
    const target = graph.mixer.get(ev.mixerChannelId ?? MASTER_ID) ?? graph.mixer.get(MASTER_ID)!;
    const env = new Tone.Gain({ gain: Tone.dbToGain(ev.gainDb), context: ctx });
    env.connect(target.input);
    // stretch=1 → plain buffer source, pitch via playback rate (repitch, cheapest).
    // stretch≠1 → granular playback: rate handles time, detune handles pitch, independently.
    const granular = ev.stretch !== 1;
    const playbackRate = granular ? 1 / ev.stretch : Math.pow(2, ev.pitchSemitones / 12);
    let source: Tone.ToneBufferSource | Tone.GrainPlayer;
    if (granular) {
      source = new Tone.GrainPlayer({
        url: buffer as any, playbackRate, detune: ev.pitchSemitones * 100,
        grainSize: 0.12, overlap: 0.05, context: ctx,
      });
    } else {
      source = new Tone.ToneBufferSource({ url: buffer as any, playbackRate, context: ctx });
    }
    source.connect(env);
    const remainDur = Math.max(0.01, ev.durSec - extraOffsetSec);
    const g = env.gain;
    const base = Tone.dbToGain(ev.gainDb);
    if (ev.fadeInSec > 0 && extraOffsetSec < ev.fadeInSec) {
      g.setValueAtTime(base * (extraOffsetSec / ev.fadeInSec), time);
      g.linearRampToValueAtTime(base, time + (ev.fadeInSec - extraOffsetSec));
    }
    if (ev.fadeOutSec > 0) {
      const foStart = time + remainDur - ev.fadeOutSec;
      if (foStart > time) {
        g.setValueAtTime(base, foStart);
        g.linearRampToValueAtTime(0, time + remainDur);
      }
    }
    source.start(time, ev.offsetSec + extraOffsetSec * playbackRate, remainDur);
    if (source instanceof Tone.GrainPlayer) {
      source.stop(time + remainDur);
      source.onstop = () => { try { source.dispose(); env.dispose(); } catch {} };
    } else {
      source.onended = () => { try { source.dispose(); env.dispose(); } catch {} };
    }
    liveSources.push(source);
  };

  for (const ev of events.audio) {
    ids.push(transport.schedule((time) => startAudioEvent(ev, time, 0), `${Math.max(0, Math.round(ev.tick))}i`));
  }

  for (const ev of events.automation) {
    ids.push(
      transport.schedule((time) => {
        applyAutomationValue(project, graph, ev.target, ev.value, time);
      }, `${Math.max(0, Math.round(ev.tick))}i`),
    );
  }

  return {
    ids,
    /** start audio clips already in progress at startTick (seek/mid-song play) */
    startAudioAt(startTick: number) {
      const startSec = ticksToSeconds(startTick, bpm);
      for (const ev of events.audio) {
        const evStartSec = ticksToSeconds(ev.tick, bpm);
        if (evStartSec < startSec && evStartSec + ev.durSec > startSec) {
          startAudioEvent(ev, Tone.now() + 0.05, startSec - evStartSec);
        }
      }
    },
    disposeSources() {
      liveSources.splice(0).forEach((s) => { try { s.stop(); s.dispose(); } catch {} });
    },
  };
}

export function applyAutomationValue(
  project: Project,
  graph: BuiltGraph,
  target: { kind: string; mixerChannelId?: string; channelId?: string; effectId?: string; param?: string },
  norm: number,
  time: number,
): void {
  const ramp = 0.02;
  if (target.kind === "mixer-volume" && target.mixerChannelId) {
    const nodes = graph.mixer.get(target.mixerChannelId);
    nodes?.volume.volume.linearRampTo(-60 + norm * 72, ramp, time);
  } else if (target.kind === "mixer-pan" && target.mixerChannelId) {
    const nodes = graph.mixer.get(target.mixerChannelId);
    nodes?.panner.pan.linearRampTo(norm * 2 - 1, ramp, time);
  } else if (target.kind === "bpm") {
    Tone.getTransport().bpm.linearRampTo(20 + norm * 380, ramp, time);
  } else if (target.kind === "effect-param" && target.mixerChannelId && target.effectId && target.param) {
    const chan = project.mixer.channels.find((c) => c.id === target.mixerChannelId);
    const fxIndex = chan?.effects.filter((f) => f.enabled).findIndex((f) => f.id === target.effectId) ?? -1;
    const nodes = graph.mixer.get(target.mixerChannelId);
    const fx = chan?.effects.find((f) => f.id === target.effectId);
    if (nodes && fx && fxIndex >= 0 && nodes.effects[fxIndex]) {
      const desc = EFFECT_DEFS[fx.type].params.find((p) => p.key === target.param);
      if (desc) nodes.effects[fxIndex]!.set(target.param, desc.min + norm * (desc.max - desc.min));
    }
  } else if (target.kind === "channel-volume" && target.channelId) {
    // rack channel volume automation routes through its instrument output gain — v1 applies via mixer instead
  }
}

/** Metronome scheduling on the current transport. Returns schedule ids. */
let tickBuf: AudioBuffer | null = null;
let tockBuf: AudioBuffer | null = null;
export function scheduleMetronome(project: Project, destination: Tone.ToneAudioNode, bars: number): number[] {
  if (!tickBuf) tickBuf = bufferFromMono(synthMetronomeTick(true), FACTORY_RATE);
  if (!tockBuf) tockBuf = bufferFromMono(synthMetronomeTick(false), FACTORY_RATE);
  const transport = Tone.getTransport();
  const ctx = Tone.getContext();
  const ids: number[] = [];
  const { num, den } = project.timeSignature;
  const beatTicks = (96 * 4) / den;
  const totalBeats = bars * num;
  for (let b = 0; b < totalBeats; b++) {
    const accent = b % num === 0;
    ids.push(
      transport.schedule((time) => {
        const src = new Tone.ToneBufferSource({ url: (accent ? tickBuf : tockBuf) as any, context: ctx });
        const g = new Tone.Gain({ gain: 0.5, context: ctx });
        src.connect(g);
        g.connect(destination);
        src.start(time);
        src.onended = () => { try { src.dispose(); g.dispose(); } catch {} };
      }, `${b * beatTicks}i`),
    );
  }
  return ids;
}
