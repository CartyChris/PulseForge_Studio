/**
 * Export pipeline: full-mix / region / stem WAV via the offline renderer,
 * MIDI export, portable project archives. Files leave through the host adapter.
 */
import type { Project } from "../../shared/project";
import { MASTER_ID } from "../../shared/project";
import { renderProjectToWav, cancelRender, type RenderOptions } from "../engine/render";
import { engine } from "../engine/engine";
import { ensureProjectAssetsLoaded } from "./assets";
import { getHost } from "../host/adapter";
import { notesToMidi } from "../midi";
import { exportPortableProject } from "../storage/projects";
import type { BitDepth } from "../../shared/wav";
import { peakLevel } from "../../shared/wav";

export interface ExportSettings {
  sampleRate: number;
  bitDepth: BitDepth;
  normalize: boolean;
  tailSec: number;
  fromTick?: number;
  toTick?: number;
}

export interface ExportSummary {
  file: string;
  durationSec: number;
  peakDb: number;
  clipped: boolean;
}

const resolveBuffer = (id: string) => engine.getAssetBuffer(id);

export async function exportMixWav(project: Project, settings: ExportSettings, fileName?: string): Promise<ExportSummary | null> {
  await ensureProjectAssetsLoaded(project);
  const out = await renderProjectToWav(project, resolveBuffer, toRenderOptions(settings), "export");
  if (!out) return null;
  const name = fileName ?? `${project.name}.wav`;
  await getHost().exportFiles([{ name, mime: "audio/wav", data: out.wav }]);
  return summary(name, out.result.durationSec, out.result.peak, out.result.clipped);
}

export function cancelExport(): void {
  cancelRender("export");
}

/** One WAV per selected mixer channel (or per track-connected channel). */
export async function exportStems(project: Project, settings: ExportSettings, mixerChannelIds?: string[]): Promise<ExportSummary[]> {
  await ensureProjectAssetsLoaded(project);
  const ids = mixerChannelIds?.length
    ? mixerChannelIds
    : project.mixer.channels.filter((c) => c.kind !== "master").map((c) => c.id);
  const results: ExportSummary[] = [];
  const files: Array<{ name: string; mime: string; data: ArrayBuffer }> = [];
  for (const id of ids) {
    const chan = project.mixer.channels.find((c) => c.id === id);
    if (!chan) continue;
    const out = await renderProjectToWav(project, resolveBuffer, { ...toRenderOptions(settings), onlyMixerChannelIds: [id, MASTER_ID] }, "export");
    if (!out) return results; // cancelled
    files.push({ name: `${project.name} - ${chan.name}.wav`, mime: "audio/wav", data: out.wav });
    results.push(summary(`${chan.name}.wav`, out.result.durationSec, out.result.peak, out.result.clipped));
  }
  if (files.length) await getHost().exportFiles(files);
  return results;
}

export async function exportMidi(project: Project, patternId?: string): Promise<void> {
  const notes = project.patterns
    .filter((p) => !patternId || p.id === patternId)
    .flatMap((p) => Object.values(p.notes).flat());
  if (!notes.length) throw new Error("No notes to export");
  const data = notesToMidi(notes, project.bpm, project.name);
  await getHost().exportFiles([{ name: `${project.name}.mid`, mime: "audio/midi", data }]);
}

export async function exportPortable(project: Project): Promise<void> {
  const blob = await exportPortableProject(project);
  await getHost().exportFiles([{ name: `${project.name}.pfproj`, mime: "application/zip", data: blob }]);
}

function toRenderOptions(s: ExportSettings): RenderOptions {
  return {
    sampleRate: s.sampleRate,
    bitDepth: s.bitDepth,
    normalize: s.normalize,
    tailSec: s.tailSec,
    fromTick: s.fromTick,
    toTick: s.toTick,
  };
}

function summary(file: string, durationSec: number, peak: number, clipped: boolean): ExportSummary {
  return { file, durationSec, peakDb: peak > 0 ? Math.round(20 * Math.log10(peak) * 10) / 10 : -Infinity, clipped };
}

/** Render a project region to an asset-ready buffer (resampling workflow). */
export async function renderRegionToChannelData(project: Project, fromTick: number, toTick: number): Promise<{ channelData: Float32Array[]; sampleRate: number; nonSilent: boolean } | null> {
  await ensureProjectAssetsLoaded(project);
  const res = await (await import("../engine/render")).renderProject(project, resolveBuffer, { fromTick, toTick, tailSec: 0.5 }, "region-render");
  if (!res) return null;
  return { channelData: res.channelData, sampleRate: res.sampleRate, nonSilent: peakLevel(res.channelData) > 0.001 };
}
