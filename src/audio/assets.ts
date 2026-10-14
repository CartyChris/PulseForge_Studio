/**
 * Audio asset lifecycle: import files, decode to engine buffers, persist blobs
 * (OPFS/IDB), cache waveform peaks, create derived assets (slices, edits, renders).
 * Originals are always preserved: destructive-feeling edits write NEW assets.
 */
import type { AudioAsset, Project } from "../../shared/project";
import { newId } from "../../shared/project";
import { engine } from "../engine/engine";
import { getBlobStore, safeBlobKey } from "../storage/blobs";
import { encodeWav } from "../../shared/wav";
import { getPeaks, runAnalysis } from "../workers/analysis-client";
import { FACTORY_SAMPLES } from "../engine/kits";
import { bufferFromMono } from "../engine/sampler";
import { FACTORY_RATE } from "../engine/dsp";

const AUDIO_MIME = new Set([
  "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/aac", "audio/mp4",
  "audio/x-m4a", "audio/ogg", "audio/flac", "audio/x-flac", "audio/aiff", "audio/x-aiff",
]);
const AUDIO_EXT = /\.(wav|mp3|aac|m4a|ogg|flac|aif|aiff)$/i;
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

const peaksCache = new Map<string, Float32Array>();

export function isAudioFile(file: { name: string; type?: string }): boolean {
  return AUDIO_EXT.test(file.name) || AUDIO_MIME.has(file.type ?? "");
}

/** Import raw encoded audio → stored blob + decoded engine buffer + asset metadata. */
export async function importAudioData(
  name: string,
  data: ArrayBuffer,
  source: AudioAsset["source"],
  extra: Partial<AudioAsset> = {},
): Promise<AudioAsset> {
  if (data.byteLength > MAX_IMPORT_BYTES) throw new Error(`File too large (max ${MAX_IMPORT_BYTES / 1024 / 1024}MB)`);
  await engine.init();
  const id = newId("asset");
  const buffer = await engine.loadAssetBuffer(id, data);
  const blobKey = safeBlobKey(`${id}_${name}`);
  const store = await getBlobStore();
  await store.put(blobKey, data);
  const asset: AudioAsset = {
    id,
    name: name.replace(/\.[^.]+$/, ""),
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: Math.min(2, buffer.numberOfChannels) as 1 | 2,
    source,
    blobKey,
    originalBlobKey: source === "import" || source === "recording" ? blobKey : null,
    licenseNote: extra.licenseNote ?? "",
    tags: extra.tags ?? [],
    favorite: false,
    bpmEstimate: null,
    keyEstimate: null,
    aiMeta: extra.aiMeta ?? null,
    ...extra,
  } as AudioAsset;
  // background analysis (BPM/key) — non-blocking
  void analyzeAssetInBackground(asset, buffer);
  return asset;
}

async function analyzeAssetInBackground(asset: AudioAsset, buffer: AudioBuffer): Promise<void> {
  try {
    if (buffer.duration < 1.5 || buffer.duration > 600) return;
    const mono = buffer.getChannelData(0);
    const { promise } = runAnalysis("analyze", mono, buffer.sampleRate);
    const result = await promise;
    asset.bpmEstimate = result.bpm ?? null;
    asset.keyEstimate = result.key ?? null;
  } catch {}
}

/** Ensure an asset's buffer is loaded into the engine (from blob storage). */
export async function ensureAssetLoaded(asset: AudioAsset): Promise<AudioBuffer | null> {
  const existing = engine.getAssetBuffer(asset.id);
  if (existing) return existing;
  const store = await getBlobStore();
  const data = await store.get(asset.blobKey);
  if (!data) return null;
  try {
    return await engine.loadAssetBuffer(asset.id, data);
  } catch {
    return null;
  }
}

export async function ensureProjectAssetsLoaded(project: Project): Promise<void> {
  await engine.init();
  await Promise.all(project.assets.map((a) => ensureAssetLoaded(a)));
}

/** Waveform peaks for display (worker-computed, cached). */
export async function assetPeaks(asset: AudioAsset, buckets = 1000): Promise<Float32Array | null> {
  const key = `${asset.id}:${buckets}`;
  const cached = peaksCache.get(key);
  if (cached) return cached;
  const buffer = await ensureAssetLoaded(asset);
  if (!buffer) return null;
  const peaks = await getPeaks(buffer.getChannelData(0), buffer.sampleRate, buckets);
  peaksCache.set(key, peaks);
  if (peaksCache.size > 300) peaksCache.delete(peaksCache.keys().next().value!);
  return peaks;
}

export function invalidatePeaks(assetId: string): void {
  for (const k of [...peaksCache.keys()]) if (k.startsWith(assetId)) peaksCache.delete(k);
}

/** Create a new asset from raw channel data (slices, edits, resamples, renders). */
export async function assetFromChannelData(
  name: string,
  channelData: Float32Array[],
  sampleRate: number,
  source: AudioAsset["source"],
  extra: Partial<AudioAsset> = {},
): Promise<AudioAsset> {
  const wav = encodeWav(channelData, sampleRate, 32);
  return importAudioData(`${name}.wav`, wav, source, extra);
}

/** Slice a region of an asset into a new asset (non-destructive). */
export async function sliceAsset(asset: AudioAsset, startSec: number, endSec: number, name?: string): Promise<AudioAsset> {
  const buffer = await ensureAssetLoaded(asset);
  if (!buffer) throw new Error("Source audio unavailable");
  const s = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const e = Math.min(buffer.length, Math.ceil(endSec * buffer.sampleRate));
  if (e - s < 32) throw new Error("Selection too short");
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    channels.push(buffer.getChannelData(c).slice(s, e));
  }
  return assetFromChannelData(name ?? `${asset.name} slice`, channels, buffer.sampleRate, "slice", { tags: [...asset.tags, "slice"] });
}

/** Factory sample → registered asset (rendered from DSP, stored like any other). */
export async function factorySampleAsset(sampleId: string): Promise<AudioAsset> {
  const def = FACTORY_SAMPLES.find((s) => s.id === sampleId);
  if (!def) throw new Error(`Unknown factory sample ${sampleId}`);
  const data = def.render();
  return assetFromChannelData(def.name, [data], FACTORY_RATE, "factory", {
    tags: [...def.tags, "factory"],
    licenseNote: "PulseForge factory sound — synthesized, no license restrictions.",
  });
}

/** Preview a factory sample without creating an asset. */
export function previewFactorySample(sampleId: string): (() => void) | null {
  const def = FACTORY_SAMPLES.find((s) => s.id === sampleId);
  if (!def) return null;
  return engine.previewBuffer(bufferFromMono(def.render(), FACTORY_RATE));
}

export async function deleteAssetBlobs(asset: AudioAsset): Promise<void> {
  const store = await getBlobStore();
  await store.delete(asset.blobKey);
  engine.releaseAssetBuffer(asset.id);
  invalidatePeaks(asset.id);
}
