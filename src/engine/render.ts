/**
 * Offline rendering — the same graph + scheduling code as live playback, run inside
 * Tone.Offline. Produces Float32 channel data, encoded to WAV by shared/wav.ts.
 */
import * as Tone from "tone";
import type { Project } from "../../shared/project";
import { PPQ, ticksToSeconds } from "../../shared/time";
import { buildEventList } from "./events";
import { buildGraph, scheduleEvents, bufferResolverRef, type BufferResolver } from "./graph";
import { encodeWav, type BitDepth } from "../../shared/wav";
import { ensureSampledInstrumentsLoaded } from "./sampled";

export interface RenderOptions {
  sampleRate?: number;
  bitDepth?: BitDepth;
  fromTick?: number;
  toTick?: number;
  tailSec?: number;
  normalize?: boolean;
  /** render only these mixer channels (stem export); null = full mix */
  onlyMixerChannelIds?: string[] | null;
}

export interface RenderResult {
  channelData: Float32Array[];
  sampleRate: number;
  durationSec: number;
  peak: number;
  clipped: boolean;
}

const cancelFlags = new Map<string, boolean>();
export function cancelRender(renderId: string): void {
  cancelFlags.set(renderId, true);
}

export async function renderProject(project: Project, resolveBuffer: BufferResolver, opts: RenderOptions = {}, renderId = "default"): Promise<RenderResult | null> {
  cancelFlags.set(renderId, false);
  const sampleRate = opts.sampleRate ?? 44100;
  const tail = opts.tailSec ?? 2;
  const events = buildEventList(project);
  const from = opts.fromTick ?? 0;
  const to = opts.toTick ?? events.endTick;
  const durationSec = Math.max(0.5, ticksToSeconds(Math.max(1, to - from), project.bpm) + tail);

  // stem isolation: solo requested channels in a project copy
  let renderedProject = project;
  if (opts.onlyMixerChannelIds?.length) {
    const keep = new Set(opts.onlyMixerChannelIds);
    renderedProject = {
      ...project,
      mixer: {
        channels: project.mixer.channels.map((c) => ({
          ...c,
          soloed: keep.has(c.id),
          muted: c.muted && !keep.has(c.id),
        })),
      },
    };
  }

  // every export / region render goes through here: sampled sets must be decoded BEFORE the offline
  // graph is built, or those notes would be silent in the file
  await ensureSampledInstrumentsLoaded(renderedProject);

  const buffer = await Tone.Offline(
    async () => {
      const transport = Tone.getTransport();
      transport.PPQ = PPQ;
      transport.bpm.value = renderedProject.bpm;
      transport.timeSignature = [renderedProject.timeSignature.num, renderedProject.timeSignature.den];
      bufferResolverRef.current = resolveBuffer;
      const graph = buildGraph(renderedProject, Tone.getDestination() as unknown as Tone.ToneAudioNode, false);
      const shifted = from > 0 ? shiftEvents(events, from) : events;
      scheduleEvents(renderedProject, shifted, graph, resolveBuffer, { seed: 987654 });
      transport.start(0);
    },
    durationSec,
    2,
    sampleRate,
  );

  if (cancelFlags.get(renderId)) return null;

  const channelData = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()] as Float32Array[];
  let peak = 0;
  for (const ch of channelData) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  const clipped = peak > 0.999;
  if (opts.normalize && peak > 0) {
    const g = 0.98 / peak;
    for (const ch of channelData) for (let i = 0; i < ch.length; i++) ch[i]! *= g;
    peak = 0.98;
  }
  return { channelData, sampleRate, durationSec, peak, clipped };
}

function shiftEvents(events: ReturnType<typeof buildEventList>, fromTick: number): ReturnType<typeof buildEventList> {
  const sh = <T extends { tick: number }>(arr: T[]) =>
    arr.filter((e) => e.tick >= fromTick).map((e) => ({ ...e, tick: e.tick - fromTick }));
  return { notes: sh(events.notes), drums: sh(events.drums), audio: sh(events.audio), automation: sh(events.automation), endTick: events.endTick - fromTick };
}

export async function renderProjectToWav(project: Project, resolveBuffer: BufferResolver, opts: RenderOptions = {}, renderId = "default"): Promise<{ wav: ArrayBuffer; result: RenderResult } | null> {
  const result = await renderProject(project, resolveBuffer, opts, renderId);
  if (!result) return null;
  return { wav: encodeWav(result.channelData, result.sampleRate, opts.bitDepth ?? 16), result };
}
