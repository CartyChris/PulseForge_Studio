/**
 * Browser-side glue for the sampling features: read an asset's audio, save results as new library
 * assets (originals are never modified), preview, place on the Song, chop to pads (one undo step),
 * flip chops, render/screw the whole song, and run prompt → audio generation jobs.
 */
import { create } from "zustand";
import { useStudio } from "../state/store";
import { ensureAssetLoaded, assetFromChannelData, ensureProjectAssetsLoaded } from "./assets";
import { renderProject } from "../engine/render";
import { engine } from "../engine/engine";
import { generateAudio, type GenerateAudioRequest, type GeneratedClip } from "../ai/generate-audio";
import { useProducer, catalogText } from "../ai/useProducer";
import { projectSummary } from "../state/composition";
import { chopPattern, flipChops, MAX_PADS, type Chop, type FlipStyle } from "../../shared/chops";
import { screw, slowedReverb } from "../engine/chop";
import { newId, type AudioAsset, type Channel, type Step } from "../../shared/project";
import type { ProducerRunState } from "../ai/producer-agent";

export async function assetChannels(asset: AudioAsset): Promise<{ data: Float32Array[]; sr: number } | null> {
  const buf = await ensureAssetLoaded(asset);
  if (!buf) return null;
  const data: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) data.push(buf.getChannelData(c).slice());
  return { data, sr: buf.sampleRate };
}

export interface SaveOpts { tags?: string[]; bpm?: number | null; key?: string | null; license?: string; source?: AudioAsset["source"] }

/** Save audio as a new library asset (selected afterwards). */
export async function saveAudio(name: string, data: Float32Array[], sr: number, o: SaveOpts = {}): Promise<AudioAsset> {
  const asset = await assetFromChannelData(name, data, sr, o.source ?? "slice", {
    tags: o.tags ?? [], bpmEstimate: o.bpm ?? null, keyEstimate: o.key ?? null,
    licenseNote: o.license ?? "Made in PulseForge from your own source audio. Check the source's license before releasing.",
  });
  const s = useStudio.getState();
  s.addAsset(asset);
  s.select({ assetId: asset.id });
  return asset;
}

let stopCurrent: (() => void) | null = null;
export async function previewChannels(data: Float32Array[], sr: number): Promise<void> {
  await engine.init().catch(() => {});
  stopCurrent?.();
  const buf = new AudioBuffer({ length: data[0]!.length, numberOfChannels: data.length, sampleRate: sr });
  data.forEach((d, i) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, i));
  stopCurrent = engine.previewBuffer(buf);
}
export async function previewAsset(asset: AudioAsset): Promise<void> {
  const ch = await assetChannels(asset);
  if (ch) await previewChannels(ch.data, ch.sr);
}
export const stopPreview = () => { stopCurrent?.(); stopCurrent = null; };

/** Put an asset on the Song: on a "Samples" audio track, at the start or after the song. */
export function placeOnSong(assetId: string, at: "start" | "end" = "end"): void {
  const s = useStudio.getState();
  let track = s.project.tracks.find((t) => t.kind === "audio" && t.name === "Samples") ?? s.project.tracks.find((t) => t.kind === "audio");
  if (!track) {
    s.dispatch({ type: "createTrack", name: "Samples", kind: "audio", color: "#5ee6d0" });
    track = useStudio.getState().project.tracks.at(-1)!;
  }
  const p = useStudio.getState().project;
  const bar = 384;
  const end = Math.ceil(Math.max(0, ...p.clips.map((c) => c.startTick + c.lengthTicks)) / bar) * bar;
  s.dispatch({ type: "placeAudioClip", trackId: track.id, assetId, startTick: at === "start" ? 0 : end });
}

/** "Soul Keys (8-bar loop, 84 BPM, D minor) screwed 80%.wav" → "Soul Keys" (pad-sized, never cut mid-word) */
export function shortName(name: string): string {
  const base = name.replace(/\.(wav|mp3|aiff?|flac|ogg|m4a)$/i, "").split(" (")[0]!.trim();
  if (base.length <= 18) return base || "Sample";
  const cut = base.slice(0, 18);
  return cut.slice(0, cut.lastIndexOf(" ") > 6 ? cut.lastIndexOf(" ") : 18);
}

const PAD_COLORS = ["#ff6a3d", "#ffc94d", "#3ec6ff", "#4fe39a", "#8b6cff", "#ff6fcf", "#5ee6d0", "#ff9f43"];
const CHOP_NAME = / chop (\d+)$/;

/**
 * MPC-style chop: one sampler pad per chop (all reading the same asset — no copies), plus a pattern
 * that plays them back in the original order. One undo step. Returns the new pattern id.
 */
export function chopToPads(asset: AudioAsset, chops: Chop[], bpm: number): { patternId: string; pads: number } {
  const use = chops.slice(0, MAX_PADS);
  const dur = asset.durationSec || use.at(-1)?.endSec || 1;
  const { lengthSteps, hits } = chopPattern(use, bpm);
  const base = shortName(asset.name);
  const channels: Channel[] = use.map((c, i) => ({
    id: newId("ch"), name: `${base} chop ${i + 1}`, color: PAD_COLORS[i % PAD_COLORS.length]!,
    instrument: { type: "sampler", assetId: asset.id, params: {
      rootNote: 60, startNorm: c.startSec / dur, endNorm: Math.min(1, c.endSec / dur), loop: false, loopStartNorm: 0, loopEndNorm: 1,
      attack: 0.002, decay: 0.1, sustain: 1, release: 0.03, filterHz: 20000, gainDb: 0, pan: 0, polyphony: 4, mono: false,
      portamento: 0, reverse: false, velocityAmount: 0.6, pitchTrack: true,
    } },
    volumeDb: -3, pan: 0, muted: false, soloed: false, mixerChannelId: null,
  }));
  const steps: Record<string, Step[]> = {};
  for (const h of hits) (steps[channels[h.chop]!.id] ??= []).push({ index: h.step, velocity: h.velocity, probability: 1, micro: 0 });
  const patternId = newId("pat");
  const s = useStudio.getState();
  s.update((p) => ({
    ...p,
    channels: [...p.channels, ...channels],
    patterns: [...p.patterns, { id: patternId, name: `${base} chops`, color: "#ffc94d", lengthSteps, steps, notes: {}, swing: 0 }],
  }));
  s.select({ patternId, channelId: channels[0]?.id ?? null });
  return { patternId, pads: channels.length };
}

/** The chop pads that exist for an asset, in pad order. */
export function chopPadsFor(assetId: string): Channel[] {
  return useStudio.getState().project.channels
    .filter((c) => c.instrument.type === "sampler" && c.instrument.assetId === assetId && CHOP_NAME.test(c.name))
    .sort((a, b) => Number(CHOP_NAME.exec(a.name)![1]) - Number(CHOP_NAME.exec(b.name)![1]));
}

/** Write a re-arranged pattern ("flip") from an asset's chop pads. Returns the pattern name or null. */
export function flipPads(asset: AudioAsset, style: FlipStyle, seed = Math.floor(Math.random() * 1e9)): string | null {
  const pads = chopPadsFor(asset.id);
  if (!pads.length) return null;
  const dur = asset.durationSec || 1;
  const chops: Chop[] = pads.map((c) => {
    const pr = (c.instrument as { params: { startNorm: number; endNorm: number } }).params;
    return { startSec: pr.startNorm * dur, endSec: pr.endNorm * dur };
  });
  const s = useStudio.getState();
  const flipped = flipChops(chopPattern(chops, s.project.bpm), pads.length, style, seed);
  const steps: Record<string, Step[]> = {};
  for (const h of flipped.hits) (steps[pads[h.chop]!.id] ??= []).push({ index: h.step, velocity: h.velocity, probability: 1, micro: 0 });
  const name = `${shortName(asset.name)} ${style} ${s.project.patterns.filter((p) => p.name.includes(` ${style} `) || p.name.endsWith(` ${style}`)).length + 1}`;
  const patternId = newId("pat");
  s.update((p) => ({ ...p, patterns: [...p.patterns, { id: patternId, name, color: "#ff6fcf", lengthSteps: flipped.lengthSteps, steps, notes: {}, swing: 0 }] }));
  s.select({ patternId });
  return name;
}

/** Render the whole song (44.1 kHz) and optionally screw it / slowed+reverb it into a new asset. */
export async function renderSongToAsset(transform: "none" | "screw" | "slowed", rate = 0.8): Promise<AudioAsset | null> {
  const s = useStudio.getState();
  await engine.init().catch(() => {});
  await ensureProjectAssetsLoaded(s.project);
  const end = Math.max(0, ...s.project.clips.map((c) => c.startTick + c.lengthTicks));
  if (end <= 0) { s.toast("Nothing on the Song yet: arrange some clips first (or use a Blueprint)", "error"); return null; }
  const r = await renderProject(s.project, (id) => engine.getAssetBuffer(id), { fromTick: 0, toTick: end, tailSec: 2.5, sampleRate: 44100 }, "song-to-asset");
  if (!r) return null;
  const data = transform === "screw" ? screw(r.channelData, rate) : transform === "slowed" ? slowedReverb(r.channelData, r.sampleRate, rate) : r.channelData;
  const label = transform === "screw" ? `screwed ${Math.round(rate * 100)}%` : transform === "slowed" ? "slowed + reverb" : "bounce";
  return saveAudio(`${s.project.name} (${label})`, data, r.sampleRate, {
    tags: ["render", transform], source: "render",
    bpm: transform === "none" ? s.project.bpm : Math.round(s.project.bpm * rate * 10) / 10,
    license: "Rendered from your own PulseForge project.",
  });
}

// ── prompt → audio jobs ────────────────────────────────────────────────────────────────────
export interface GeneratedAssetInfo { assetId: string; name: string; role: GeneratedClip["role"]; bpm: number; key: string }
interface GenerateStore {
  running: boolean;
  run: ProducerRunState | null;
  results: GeneratedAssetInfo[];
  lastSummary: string;
  notes: string[];
  error: string | null;
  controller: AbortController | null;
  start(req: GenerateAudioRequest): Promise<GeneratedAssetInfo[]>;
  cancel(): void;
}

export const useGenerate = create<GenerateStore>((set, get) => ({
  running: false, run: null, results: [], lastSummary: "", notes: [], error: null, controller: null,
  async start(req) {
    if (get().running) return [];
    const controller = new AbortController();
    set({ running: true, run: null, error: null, notes: [], controller });
    const studio = useStudio.getState();
    studio.setFlags({ aiBusy: true });
    try {
      await engine.init().catch(() => {});
      const producer = useProducer.getState();
      const res = await generateAudio(req, {
        plan: producer.candidates().length ? async (prompt) => (await useProducer.getState().aiPlan(prompt)).spec : undefined,
        render: async (project, fromTick, toTick, o) => {
          const r = await renderProject(project, (id) => engine.getAssetBuffer(id), { fromTick, toTick, tailSec: o.tailSec, sampleRate: o.sampleRate, onlyMixerChannelIds: o.onlyMixerChannelIds }, "generate-audio");
          return r ? { channelData: r.channelData, sampleRate: r.sampleRate } : null;
        },
        catalog: catalogText,
        projectSummary,
        signal: controller.signal,
      }, (run) => set({ run }));
      const infos: GeneratedAssetInfo[] = [];
      for (const c of res.clips) {
        const a = await saveAudio(c.name, c.channelData, c.sampleRate, {
          source: "ai", bpm: c.bpm, key: c.key, tags: ["generated", c.role, res.spec.genre],
          license: "Generated by PulseForge from your prompt: yours to use, royalty-free.",
        });
        infos.push({ assetId: a.id, name: a.name, role: c.role, bpm: c.bpm, key: c.key });
      }
      set({ running: false, results: [...infos, ...get().results].slice(0, 40), lastSummary: res.summary, notes: res.notes, controller: null });
      studio.toast(`${infos.length} clip${infos.length === 1 ? "" : "s"} added to your library: ${res.summary}`, "success");
      return infos;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      set({ running: false, error: msg === "Cancelled" ? null : msg, controller: null });
      if (msg !== "Cancelled") studio.toast(`Couldn't generate: ${msg}`, "error");
      return [];
    } finally {
      useStudio.getState().setFlags({ aiBusy: false });
    }
  },
  cancel() { get().controller?.abort(); },
}));
