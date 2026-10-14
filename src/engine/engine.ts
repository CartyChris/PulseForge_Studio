/**
 * Live audio engine singleton. Owns the Tone context, the current built graph,
 * transport control, metering, and asset buffers. All musical timing runs on the
 * audio clock via Tone's lookahead scheduler (Transport PPQ matched to project PPQ).
 */
import * as Tone from "tone";
import type { Project } from "../../shared/project";
import { PPQ, ticksPerBar, TICKS_PER_STEP } from "../../shared/time";
import { buildGraph, scheduleEvents, scheduleMetronome, bufferResolverRef, type BuiltGraph } from "./graph";
import { buildEventList } from "./events";

export interface EngineStatus {
  running: boolean;
  playing: boolean;
  positionTicks: number;
  sampleRate: number;
  outputLatencyMs: number;
  masterPeakDb: number;
  masterRmsDb: number;
  clipped: boolean;
  contextState: string;
}

class AudioEngine {
  private graph: BuiltGraph | null = null;
  private project: Project | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private scheduled: { ids: number[]; startAudioAt(t: number): void; disposeSources(): void } | null = null;
  private metronomeIds: number[] = [];
  private structuralSig = "";
  private meterNode: AudioWorkletNode | null = null;
  private meterData = { peak: 0, rms: 0, clipped: false };
  private masterTap: Tone.Gain | null = null;
  private rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private _initialized = false;
  playing = false;
  /** FL-style playback switch: "pattern" loops the rack's active pattern; "song" plays the playlist. */
  playMode: "pattern" | "song" = "pattern";
  activePatternId: string | null = null;

  setPlayContext(mode: "pattern" | "song", patternId: string | null): void {
    const changed = mode !== this.playMode || patternId !== this.activePatternId;
    this.playMode = mode;
    this.activePatternId = patternId;
    if (changed && this._initialized) {
      this.applyLoopSettings();
      if (this.playing) this.debouncedReschedule();
    }
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    await Tone.start();
    const transport = Tone.getTransport();
    transport.PPQ = PPQ;
    Tone.getContext().lookAhead = 0.05;
    this.masterTap = new Tone.Gain(1);
    this.masterTap.connect(Tone.getDestination() as any);
    // AudioWorklet master meter (peak/RMS/clip) — real-time analysis off the UI thread.
    // Must go through Tone's context API: its rawContext is a standardized-audio-context
    // wrapper that the native AudioWorkletNode constructor rejects.
    try {
      const toneCtx = Tone.getContext();
      await toneCtx.addAudioWorkletModule("/worklets/meter-processor.js");
      this.meterNode = toneCtx.createAudioWorkletNode("pf-meter");
      this.meterNode.port.onmessage = (e) => { this.meterData = e.data; };
      this.masterTap.connect(this.meterNode as unknown as Tone.ToneAudioNode);
      // a worklet whose output feeds nothing is never pulled by the graph —
      // route it to the destination through a muted gain so process() runs
      const meterSink = new Tone.Gain(0);
      Tone.connect(this.meterNode as unknown as Tone.ToneAudioNode, meterSink);
      meterSink.connect(Tone.getDestination() as any);
    } catch (err) {
      console.warn("[pulseforge] master meter worklet unavailable:", err);
      this.meterNode = null; // meter worklet is enhancement-only
    }
    this._initialized = true;
    // any project applied before init lost its transport settings (early return) —
    // re-apply now so bpm/time-signature/loop always reach the real transport
    if (this.project) this.applyProject(this.project);
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * iOS/Safari: the context may still be suspended after init() if it ran outside a
   * user gesture. Every sound-producing entry point re-attempts the resume so the
   * first real tap unlocks audio.
   */
  private async ensureRunning(): Promise<void> {
    if (Tone.getContext().state !== "running") {
      try { await Tone.start(); } catch { /* resumes on a later gesture */ }
    }
  }

  destination(): Tone.ToneAudioNode {
    return this.masterTap ?? (Tone.getDestination() as unknown as Tone.ToneAudioNode);
  }

  // ---------- asset buffers ----------
  async loadAssetBuffer(assetId: string, data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = Tone.getContext().rawContext;
    const buf = await ctx.decodeAudioData(data.slice(0));
    this.buffers.set(assetId, buf);
    return buf;
  }
  setAssetBuffer(assetId: string, buf: AudioBuffer): void {
    this.buffers.set(assetId, buf);
  }
  getAssetBuffer(assetId: string): AudioBuffer | null {
    return this.buffers.get(assetId) ?? null;
  }
  releaseAssetBuffer(assetId: string): void {
    this.buffers.delete(assetId);
  }
  bufferIds(): string[] {
    return [...this.buffers.keys()];
  }

  // ---------- project sync ----------
  applyProject(project: Project): void {
    this.project = project;
    if (!this._initialized) return;
    const transport = Tone.getTransport();
    transport.bpm.value = project.bpm;
    transport.timeSignature = [project.timeSignature.num, project.timeSignature.den];
    this.applyLoopSettings();
    const sig = JSON.stringify({
      c: project.channels, m: project.mixer.channels,
    });
    bufferResolverRef.current = (id) => this.getAssetBuffer(id);
    if (sig !== this.structuralSig) {
      this.structuralSig = sig;
      this.rebuildGraph();
    }
    if (this.playing) this.debouncedReschedule();
  }

  /** Pattern mode always loops the active pattern; song mode honors the project loop region. */
  private applyLoopSettings(): void {
    if (!this.project) return;
    const transport = Tone.getTransport();
    const pattern = this.playMode === "pattern"
      ? this.project.patterns.find((p) => p.id === this.activePatternId) ?? this.project.patterns[0]
      : undefined;
    if (pattern) {
      transport.loop = true;
      transport.loopStart = 0;
      transport.loopEnd = `${pattern.lengthSteps * TICKS_PER_STEP}i`;
    } else if (this.project.loop.enabled && this.project.loop.endTick > this.project.loop.startTick) {
      transport.loop = true;
      transport.loopStart = `${this.project.loop.startTick}i`;
      transport.loopEnd = `${this.project.loop.endTick}i`;
    } else {
      transport.loop = false;
    }
  }

  private rebuildGraph(): void {
    if (!this.project || !this.masterTap) return;
    const wasScheduled = this.scheduled !== null;
    this.clearSchedule();
    this.graph?.dispose();
    this.graph = buildGraph(this.project, this.masterTap, true);
    if (wasScheduled && this.playing) this.scheduleAll();
  }

  private debouncedReschedule(): void {
    if (this.rescheduleTimer) clearTimeout(this.rescheduleTimer);
    this.rescheduleTimer = setTimeout(() => {
      if (this.playing) {
        this.clearSchedule();
        this.scheduleAll();
      }
    }, 150);
  }

  private clearSchedule(): void {
    const transport = Tone.getTransport();
    if (this.scheduled) {
      this.scheduled.ids.forEach((id) => transport.clear(id));
      this.scheduled.disposeSources();
      this.scheduled = null;
    }
    this.metronomeIds.forEach((id) => transport.clear(id));
    this.metronomeIds = [];
  }

  private scheduleAll(): void {
    if (!this.project || !this.graph) return;
    const patternId = this.playMode === "pattern"
      ? (this.activePatternId ?? this.project.patterns[0]?.id)
      : undefined;
    const events = buildEventList(this.project, patternId ? { patternId } : undefined);
    this.scheduled = scheduleEvents(this.project, events, this.graph, (id) => this.getAssetBuffer(id));
    if (this.project.metronome && this.masterTap) {
      const bars = Math.max(8, Math.ceil(events.endTick / ticksPerBar(this.project.timeSignature)) + 4);
      this.metronomeIds = scheduleMetronome(this.project, this.masterTap, bars);
    }
  }

  // ---------- transport ----------
  async play(fromTick?: number): Promise<void> {
    await this.init();
    await this.ensureRunning();
    if (!this.project) return;
    this.applyProject(this.project); // always re-sync transport settings; sig check keeps it cheap
    if (!this.graph) this.rebuildGraph();
    const transport = Tone.getTransport();
    if (fromTick !== undefined) transport.ticks = fromTick;
    this.clearSchedule();
    this.scheduleAll();
    this.playing = true;
    transport.start();
    this.scheduled?.startAudioAt(transport.ticks);
  }

  pause(): void {
    Tone.getTransport().pause();
    this.playing = false;
    this.scheduled?.disposeSources();
    this.releaseAllVoices();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.ticks = 0;
    this.playing = false;
    this.clearSchedule();
    this.releaseAllVoices();
  }

  seek(tick: number): void {
    const transport = Tone.getTransport();
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.scheduled?.disposeSources();
      this.releaseAllVoices();
    }
    transport.ticks = Math.max(0, tick);
    if (wasPlaying) {
      this.clearSchedule();
      this.scheduleAll();
      this.scheduled?.startAudioAt(transport.ticks);
    }
  }

  private releaseAllVoices(): void {
    if (!this.graph) return;
    for (const inst of this.graph.instruments.values()) inst.releaseAll();
    for (const p of this.graph.drumPlayers.values()) p.releaseAll();
  }

  get positionTicks(): number {
    return this._initialized ? Tone.getTransport().ticks : 0;
  }

  // ---------- live interaction ----------
  /** Audition a note immediately (piano roll click, keyboard play). */
  async auditionNote(channelId: string, pitch: number, durSec = 0.4, velocity = 0.9): Promise<void> {
    await this.init();
    await this.ensureRunning();
    if (!this.graph) this.rebuildGraph();
    const t = Tone.now() + 0.02;
    const inst = this.graph?.instruments.get(channelId);
    if (inst) inst.triggerAttackRelease(pitch, durSec, t, velocity);
    else this.graph?.drumPlayers.get(channelId)?.trigger(t, velocity);
  }

  /** Preview an arbitrary buffer (sample browser). Returns a stop function. */
  previewBuffer(buf: AudioBuffer): () => void {
    void this.ensureRunning();
    const src = new Tone.ToneBufferSource({ url: buf as any });
    const g = new Tone.Gain(0.9);
    src.connect(g);
    g.connect(this.destination());
    src.start();
    src.onended = () => { try { src.dispose(); g.dispose(); } catch {} };
    return () => { try { src.stop(); } catch {} };
  }

  setMixerParam(mixerChannelId: string, param: "volumeDb" | "pan" | "mute", value: number | boolean): void {
    const nodes = this.graph?.mixer.get(mixerChannelId);
    if (!nodes) return;
    if (param === "volumeDb") nodes.volume.volume.value = value as number;
    else if (param === "pan") nodes.panner.pan.value = value as number;
    else if (param === "mute") nodes.volume.mute = value as boolean;
  }

  setEffectParam(mixerChannelId: string, effectId: string, param: string, value: number): void {
    const chan = this.project?.mixer.channels.find((c) => c.id === mixerChannelId);
    const nodes = this.graph?.mixer.get(mixerChannelId);
    if (!chan || !nodes) return;
    const enabled = chan.effects.filter((f) => f.enabled);
    const idx = enabled.findIndex((f) => f.id === effectId);
    if (idx >= 0) nodes.effects[idx]?.set(param, value);
  }

  setInstrumentParam(channelId: string, param: string, value: number): void {
    this.graph?.instruments.get(channelId)?.set({ [param]: value });
  }

  getMeterDb(mixerChannelId: string): number {
    const m = this.graph?.mixer.get(mixerChannelId)?.meter;
    if (!m) return -Infinity;
    const v = m.getValue();
    return typeof v === "number" ? v : Math.max(...(v as number[]));
  }

  status(): EngineStatus {
    const ctx = this._initialized ? (Tone.getContext().rawContext as AudioContext) : null;
    return {
      running: this._initialized,
      playing: this.playing,
      positionTicks: this.positionTicks,
      sampleRate: ctx?.sampleRate ?? 0,
      outputLatencyMs: ctx ? Math.round(((ctx.outputLatency ?? 0) + ctx.baseLatency) * 1000) : 0,
      masterPeakDb: this.meterData.peak > 0 ? 20 * Math.log10(this.meterData.peak) : -Infinity,
      masterRmsDb: this.meterData.rms > 0 ? 20 * Math.log10(this.meterData.rms) : -Infinity,
      clipped: this.meterData.clipped,
      contextState: ctx?.state ?? "closed",
    };
  }

  resetClip(): void {
    this.meterData.clipped = false;
    this.meterNode?.port.postMessage("reset"); // clear the worklet-side latch too
  }

  private analyser: AnalyserNode | null = null;
  /** Shared FFT analyser on the master bus (visualizers). Null until engine init. */
  getAnalyser(): AnalyserNode | null {
    if (!this.masterTap) return null;
    if (!this.analyser) {
      const raw = (this.masterTap.context.rawContext as unknown as AudioContext);
      this.analyser = raw.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.75;
      (this.masterTap.output as unknown as AudioNode).connect(this.analyser);
    }
    return this.analyser;
  }
}

export const engine = new AudioEngine();
