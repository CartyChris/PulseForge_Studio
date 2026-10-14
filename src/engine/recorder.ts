/**
 * Recording engine: mic capture via getUserMedia + MediaRecorder, input metering,
 * monitoring, count-in, punch in/out, loop takes, latency calibration/compensation.
 * Dry recordings are always preserved as their own assets.
 */
import * as Tone from "tone";
import { engine } from "./engine";

export interface InputDevice {
  deviceId: string;
  label: string;
}

export interface RecorderState {
  permission: "unknown" | "granted" | "denied";
  active: boolean;
  monitoring: boolean;
  recording: boolean;
  level: number; // 0..1 peak
  deviceId: string | null;
}

type Listener = (s: RecorderState) => void;

class Recorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private monitorGain: GainNode | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private recordStartAudioTime = 0;
  latencyCompMs = Number(localStorage.getItem("pf_latency_comp") ?? 0);

  state: RecorderState = {
    permission: "unknown",
    active: false,
    monitoring: false,
    recording: false,
    level: 0,
    deviceId: null,
  };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn({ ...this.state });
  }

  async listDevices(): Promise<InputDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  async open(deviceId?: string): Promise<void> {
    await engine.init();
    this.close();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      this.state.permission = "denied";
      this.emit();
      throw new Error(`Microphone access failed: ${e}`);
    }
    this.state.permission = "granted";
    this.state.active = true;
    this.state.deviceId = deviceId ?? null;

    const ctx = Tone.getContext().rawContext as AudioContext;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.source.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);

    const buf = new Float32Array(this.analyser.fftSize);
    this.meterTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
      this.state.level = peak;
      this.emit();
    }, 60);
    this.emit();
  }

  setMonitoring(on: boolean): void {
    if (this.monitorGain) this.monitorGain.gain.value = on ? 1 : 0;
    this.state.monitoring = on;
    this.emit();
  }

  /** Start capturing. Returns a stop() that resolves with the recorded blob + timing. */
  startCapture(): { stop: () => Promise<{ blob: Blob; startedAtAudioTime: number }> } {
    if (!this.stream) throw new Error("Input not open — select a microphone first");
    this.chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/mp4";
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.mediaRecorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recordStartAudioTime = (Tone.getContext().rawContext as AudioContext).currentTime;
    this.mediaRecorder.start(250);
    this.state.recording = true;
    this.emit();
    return {
      stop: () =>
        new Promise((resolve) => {
          const mr = this.mediaRecorder!;
          mr.onstop = () => {
            this.state.recording = false;
            this.emit();
            resolve({ blob: new Blob(this.chunks, { type: mr.mimeType }), startedAtAudioTime: this.recordStartAudioTime });
          };
          mr.stop();
        }),
    };
  }

  isCapturing(): boolean {
    return this.state.recording;
  }

  outputLatencyMs(): number {
    const ctx = Tone.getContext().rawContext as AudioContext;
    return Math.round(((ctx.outputLatency ?? 0) + ctx.baseLatency) * 1000);
  }

  setLatencyComp(ms: number): void {
    this.latencyCompMs = ms;
    localStorage.setItem("pf_latency_comp", String(ms));
  }

  /**
   * Latency calibration: plays 4 loud clicks while recording; measures the offset
   * between scheduled click times and their arrival in the recording.
   * Requires the mic to hear the output (speakers on) OR a loopback cable.
   */
  async calibrate(): Promise<{ measuredMs: number } | { error: string }> {
    if (!this.stream) return { error: "Open a microphone first" };
    await engine.init();
    const ctx = Tone.getContext().rawContext as AudioContext;
    const capture = this.startCapture();
    const clickTimes: number[] = [];
    const t0 = ctx.currentTime + 0.3;
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * 0.5;
      clickTimes.push(t);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = 2000;
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    }
    await new Promise((r) => setTimeout(r, 2600));
    const { blob, startedAtAudioTime } = await capture.stop();
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const data = buf.getChannelData(0);
      // find first strong transient after each expected time
      const offsets: number[] = [];
      for (const t of clickTimes) {
        const expectSample = Math.floor((t - startedAtAudioTime) * buf.sampleRate);
        let found = -1;
        let peak = 0;
        for (let i = Math.max(0, expectSample - buf.sampleRate * 0.05); i < Math.min(data.length, expectSample + buf.sampleRate * 0.4); i++) {
          const a = Math.abs(data[i]!);
          if (a > 0.25 && a > peak) { peak = a; found = i; }
        }
        if (found >= 0) offsets.push(((found - expectSample) / buf.sampleRate) * 1000);
      }
      if (offsets.length < 2) return { error: "Could not hear the clicks — raise speaker volume and try again, or set compensation manually." };
      offsets.sort((a, b) => a - b);
      const measuredMs = Math.round(offsets[Math.floor(offsets.length / 2)]!);
      this.setLatencyComp(measuredMs);
      return { measuredMs };
    } catch (e) {
      return { error: `Analysis failed: ${e}` };
    }
  }

  close(): void {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    try { if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop(); } catch {}
    this.mediaRecorder = null;
    try { this.source?.disconnect(); this.analyser?.disconnect(); this.monitorGain?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.state = { ...this.state, active: false, monitoring: false, recording: false, level: 0 };
    this.emit();
  }
}

export const recorder = new Recorder();
