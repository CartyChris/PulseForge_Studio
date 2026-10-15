/**
 * Real sampled instruments (Salamander Grand Piano, VSCO 2 CE) — manifest types, loader,
 * AudioBuffer cache and one SynthEngine per instrument ("sampled-<instrumentId>").
 *
 * The manifest (public/samples/manifest.json, produced by scripts/fetch-samples.mjs) is bundled
 * statically so engines register synchronously; the audio files are fetched lazily from
 * `${BASE_URL}samples/...` and decoded once, then shared by every instance — live AND offline:
 * Tone.Sampler accepts raw AudioBuffers, so an instrument built inside Tone.Offline reuses the
 * cache with no network. Export paths await `ensureSampledInstrumentsLoaded(project)` first.
 *
 * An instance created before its buffers are ready stays silent and swaps in a real sampler the
 * moment the set finishes loading (no graph rebuild, so other channels' FX tails are untouched).
 * If loading FAILS (offline web build, missing files), the instance falls back to a synthesized
 * voice so the track is never silent forever. Nothing here throws into the audio graph.
 */
import * as Tone from "tone";
import manifestJson from "../../public/samples/manifest.json";
import type { InstrumentInstance, ParamDesc, SynthEngine } from "./instruments";
import type { Project } from "../../shared/project";

export interface SampleFileInfo {
  sourceUrl: string;
  sourcePage?: string;
  sourceSha1?: string;
  sourceFormat?: string;
  durationSec?: number;
  bytes?: number;
}

export interface SampledInstrumentDef {
  id: string;
  name: string;
  category: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  /** note name ("C4", "F#3") -> path relative to public/samples/ */
  notes: Record<string, string>;
  /** per-file provenance, keyed by the same relative path */
  files: Record<string, SampleFileInfo>;
  /** suggested release time (s) */
  release?: number;
  description?: string;
  sfz?: string[];
}

export interface SampleManifest {
  version: number;
  generatedBy: string;
  sampleRate: number;
  sources: Record<string, { name: string; license: string; licenseUrl: string; url: string; homepage?: string; licenseEvidence?: string }>;
  instruments: SampledInstrumentDef[];
}

export const SAMPLE_MANIFEST = manifestJson as unknown as SampleManifest; // JSON literal types are too narrow to compare directly
export const SAMPLED_ENGINE_PREFIX = "sampled-";

export function sampledEngineId(instrumentId: string): string {
  return SAMPLED_ENGINE_PREFIX + instrumentId;
}

export function getSampledInstrument(instrumentIdOrEngineId: string): SampledInstrumentDef | undefined {
  const id = instrumentIdOrEngineId.startsWith(SAMPLED_ENGINE_PREFIX) ? instrumentIdOrEngineId.slice(SAMPLED_ENGINE_PREFIX.length) : instrumentIdOrEngineId;
  return SAMPLE_MANIFEST.instruments.find((i) => i.id === id);
}

/** Public URL of a sample file, honoring Vite's base (Electron and Vercel both serve from "/"). */
export function sampleUrl(relPath: string): string {
  let base = "/";
  try {
    base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  } catch { /* non-Vite runtime */ }
  if (!base.endsWith("/")) base += "/";
  return `${base}samples/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

// ---------------- loader + cache ----------------

export type SampleSetState = "idle" | "loading" | "ready" | "error";

interface SetEntry {
  state: SampleSetState;
  promise: Promise<boolean> | null;
  buffers: Record<string, AudioBuffer> | null;
  error?: string;
}

const fileCache = new Map<string, Promise<AudioBuffer>>(); // relPath -> decoded buffer (shared between sets)
const sets = new Map<string, SetEntry>();
const listeners = new Set<(instrumentId: string, state: SampleSetState) => void>();

/** Swap the fetch+decode step (tests, or a host that reads files directly). */
export const sampleFetcherRef: { current: ((url: string) => Promise<ArrayBuffer>) | null } = { current: null };

function entry(id: string): SetEntry {
  let e = sets.get(id);
  if (!e) { e = { state: "idle", promise: null, buffers: null }; sets.set(id, e); }
  return e;
}

export function getSampleSetState(instrumentId: string): SampleSetState {
  return sets.get(instrumentId)?.state ?? "idle";
}

/** Cached buffers for an instrument (note -> AudioBuffer), or null until fully loaded. */
export function getLoadedSampleBuffers(instrumentId: string): Record<string, AudioBuffer> | null {
  const e = sets.get(instrumentId);
  return e?.state === "ready" ? e.buffers : null;
}

export function onSampleSetChange(fn: (instrumentId: string, state: SampleSetState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(id: string, state: SampleSetState) {
  for (const fn of [...listeners]) { try { fn(id, state); } catch { /* listener errors are not ours */ } }
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  if (sampleFetcherRef.current) return sampleFetcherRef.current(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
  return res.arrayBuffer();
}

function decodeFile(relPath: string): Promise<AudioBuffer> {
  let p = fileCache.get(relPath);
  if (!p) {
    p = (async () => {
      const data = await fetchArrayBuffer(sampleUrl(relPath));
      // decode on the LIVE context's raw context (the offline one may be the global one mid-render,
      // but AudioBuffers are context-independent either way)
      const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
      return await raw.decodeAudioData(data.slice(0));
    })();
    p.catch(() => fileCache.delete(relPath)); // allow a retry later
    fileCache.set(relPath, p);
  }
  return p;
}

/**
 * Load one instrument's sample set. Resolves true when the set is ready (now or already),
 * false on failure. Never rejects.
 */
export function loadSampledInstrument(instrumentId: string): Promise<boolean> {
  const def = getSampledInstrument(instrumentId);
  if (!def) return Promise.resolve(false);
  const e = entry(def.id);
  if (e.state === "ready") return Promise.resolve(true);
  if (e.promise) return e.promise;
  e.state = "loading";
  e.error = undefined;
  emit(def.id, "loading");
  e.promise = (async () => {
    try {
      const pairs = await Promise.all(Object.entries(def.notes).map(async ([note, rel]) => [note, await decodeFile(rel)] as const));
      e.buffers = Object.fromEntries(pairs);
      e.state = "ready";
      emit(def.id, "ready");
      return true;
    } catch (err) {
      e.state = "error";
      e.error = String((err as Error)?.message ?? err);
      e.promise = null; // a later call may retry
      console.warn(`[pulseforge] sampled instrument "${def.id}" failed to load — using synth fallback:`, e.error);
      emit(def.id, "error");
      return false;
    }
  })();
  return e.promise;
}

/** Instrument ids (manifest ids) a project's synth channels use. */
export function sampledInstrumentIdsInProject(project: Pick<Project, "channels">): string[] {
  const ids = new Set<string>();
  for (const ch of project.channels) {
    const inst = ch.instrument;
    if (inst.type === "synth" && inst.synthId.startsWith(SAMPLED_ENGINE_PREFIX)) {
      const def = getSampledInstrument(inst.synthId);
      if (def) ids.add(def.id);
    }
  }
  return [...ids];
}

/** True when every sampled set the project uses is decoded and cached. */
export function sampledInstrumentsReady(project: Pick<Project, "channels">): boolean {
  return sampledInstrumentIdsInProject(project).every((id) => getSampleSetState(id) === "ready");
}

/**
 * Load only the sample sets this project uses. Resolves (never rejects) once each is ready or
 * has failed; the result says whether ALL of them are ready.
 */
export async function ensureSampledInstrumentsLoaded(project: Pick<Project, "channels">): Promise<boolean> {
  const ids = sampledInstrumentIdsInProject(project);
  if (!ids.length) return true;
  const results = await Promise.all(ids.map((id) => loadSampledInstrument(id)));
  return results.every(Boolean);
}

// ---------------- engines ----------------

export const SAMPLED_PARAMS = (def: SampledInstrumentDef): ParamDesc[] => [
  { key: "attack", name: "Attack", min: 0, max: 2, default: 0 },
  { key: "release", name: "Release", min: 0.02, max: 6, default: def.release ?? 0.6 },
  { key: "brightness", name: "Brightness", min: 300, max: 20000, default: 20000 },
  { key: "velocity", name: "Velocity Sens.", min: 0, max: 1, default: 0.7 },
  { key: "volume", name: "Volume", min: -24, max: 12, default: 0 },
];

type FallbackFactory = (instrumentId: string) => InstrumentInstance | null;

const finite = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Build the "sampled-<id>" engines. `fallback` makes a synth voice used only if loading fails. */
export function createSampledEngines(fallback: FallbackFactory): SynthEngine[] {
  return SAMPLE_MANIFEST.instruments.map((def) => ({
    id: sampledEngineId(def.id),
    name: `${def.name} (sampled)`,
    params: SAMPLED_PARAMS(def),
    create(p: Record<string, number>): InstrumentInstance {
      const ctx = Tone.getContext(); // later-built voices must live in the graph's context (live or offline)
      const params = {
        attack: finite(p.attack, 0),
        release: finite(p.release, def.release ?? 0.6),
        brightness: finite(p.brightness, 20000),
        velocity: finite(p.velocity, 0.7),
        volume: finite(p.volume, 0),
      };
      const out = new Tone.Gain({ gain: Tone.dbToGain(params.volume), context: ctx });
      const filter = new Tone.Filter({ frequency: Math.min(params.brightness, ctx.sampleRate * 0.45), type: "lowpass", rolloff: -12, context: ctx });
      filter.connect(out);
      let sampler: Tone.Sampler | null = null;
      let fallbackInst: InstrumentInstance | null = null;
      let disposed = false;
      let unsubscribe: (() => void) | null = null;

      const build = (buffers: Record<string, AudioBuffer>) => {
        if (disposed || sampler) return;
        try {
          sampler = new Tone.Sampler({ urls: buffers, attack: params.attack, release: params.release, curve: "exponential", context: ctx } as any);
          sampler.connect(filter);
        } catch (err) {
          sampler = null;
          console.warn(`[pulseforge] could not build sampler for "${def.id}":`, err);
        }
      };
      const useFallback = () => {
        if (disposed || sampler || fallbackInst) return;
        try {
          fallbackInst = fallback(def.id);
          fallbackInst?.connect(filter);
        } catch { fallbackInst = null; }
      };

      const ready = getLoadedSampleBuffers(def.id);
      if (ready) build(ready);
      else {
        unsubscribe = onSampleSetChange((id, state) => {
          if (id !== def.id) return;
          if (state === "ready") {
            const bufs = getLoadedSampleBuffers(def.id);
            if (bufs) {
              build(bufs);
              if (sampler && fallbackInst) { try { fallbackInst.dispose(); } catch {} fallbackInst = null; }
            }
          } else if (state === "error") useFallback();
        });
        if (getSampleSetState(def.id) === "error") useFallback();
        void loadSampledInstrument(def.id);
      }

      const vel = (v: number) => {
        const x = Math.min(1, Math.max(0, v));
        return 1 - params.velocity + params.velocity * x;
      };

      return {
        triggerAttackRelease: (midi, dur, time, velocity) => {
          if (sampler) {
            try {
              sampler.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), Math.max(0.02, dur), time, vel(velocity));
            } catch { /* identical-time collisions are non-fatal */ }
          } else if (fallbackInst) {
            fallbackInst.triggerAttackRelease(midi, dur, time, vel(velocity));
          }
          // else: still loading — stay silent rather than throw
        },
        connect: (dest) => out.connect(dest as any),
        releaseAll: (t) => {
          try { sampler?.releaseAll(t); } catch {}
          fallbackInst?.releaseAll(t);
        },
        set: (next) => {
          if (typeof next.attack === "number") { params.attack = next.attack; if (sampler) sampler.attack = next.attack; }
          if (typeof next.release === "number") { params.release = next.release; if (sampler) sampler.release = next.release; }
          if (typeof next.brightness === "number") { params.brightness = next.brightness; filter.frequency.value = Math.min(next.brightness, ctx.sampleRate * 0.45); }
          if (typeof next.velocity === "number") params.velocity = next.velocity;
          if (typeof next.volume === "number") { params.volume = next.volume; out.gain.value = Tone.dbToGain(next.volume); }
        },
        dispose: () => {
          disposed = true;
          unsubscribe?.();
          try { sampler?.dispose(); } catch {}
          try { fallbackInst?.dispose(); } catch {}
          try { filter.dispose(); out.dispose(); } catch {}
        },
        output: out,
      };
    },
  }));
}

/** Parse "C#4"/"Db4" style note names (C4 = 60). Null when invalid or outside 0..127. */
export function noteNameToMidi(name: string): number | null {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = base[m[1]!]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return midi >= 0 && midi <= 127 ? midi : null;
}
