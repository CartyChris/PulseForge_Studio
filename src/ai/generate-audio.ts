/**
 * Prompt → audio. Runs the full AI Producer pipeline (plan → compose → arrange → measured auto-mix)
 * on a SCRATCH project — the user's session is never touched — then renders what was asked for into
 * audio clips for the library:
 *
 *   song   the whole arrangement, mixed and mastered
 *   loop   an N-bar loop (seamless: the reverb tail is folded back onto the start)
 *   stems  the loop as separate Drums / Bass / Chords / Melody stems + the full loop
 *
 * Every clip carries its exact BPM and key, so it drops straight into the chop / fit-to-project tools.
 */
import { runProducer, type ProducerDeps, type ProducerRunState } from "./producer-agent";
import { directFromPrompt } from "../../shared/director";
import { ProductionSpecSchema, type ProductionSpec, type PartRole } from "../../shared/producer";
import { createEmptyProject, type Project } from "../../shared/project";
import { applyCommands } from "../state/commands";
import { PPQ } from "../../shared/time";

export type AudioOutput = "song" | "loop" | "stems";
export type StemName = "drums" | "bass" | "chords" | "melody";

export interface GenerateAudioRequest {
  prompt: string;
  output: AudioOutput;
  /** skip planning and use this spec (e.g. a revised plan or a preset) */
  spec?: ProductionSpec;
  /** loop / stems length */
  loopBars?: 2 | 4 | 8;
  /** loop/stems only: restrict the parts (e.g. ["chords", "melody"] for a drum-less sample to chop) */
  parts?: PartRole[];
  /** user choices that win over the plan (applied after AI/offline planning) */
  overrides?: Partial<Pick<ProductionSpec, "genre" | "bpm" | "key" | "scale" | "length">>;
}

export interface GeneratedClip {
  name: string;
  role: "song" | "loop" | StemName;
  channelData: Float32Array[];
  sampleRate: number;
  bpm: number;
  key: string;
  bars: number;
}

export interface GenerateAudioResult {
  spec: ProductionSpec;
  summary: string;
  usedAI: boolean;
  clips: GeneratedClip[];
  notes: string[];
}

export interface GenerateAudioDeps {
  plan?: (prompt: string) => Promise<ProductionSpec>;
  render(project: Project, fromTick: number, toTick: number, opts: { sampleRate: number; tailSec: number; onlyMixerChannelIds?: string[] }): Promise<{ channelData: Float32Array[]; sampleRate: number } | null>;
  catalog(): string;
  projectSummary(p: Project): string;
  signal?: AbortSignal;
}

const TICKS_PER_BAR = PPQ * 4;
const STEM_PATTERNS: Record<StemName, RegExp> = {
  drums: /^(kick|drums|fx)\b/i,
  bass: /^bass\b/i,
  chords: /^(chords|counter)\b/i,
  melody: /^melody\b/i,
};

/** Mixer channels to solo for a stem: its tracks, any bus they feed, and the reverb/delay returns
 * (muted channels send nothing, so the returns carry only this stem's own space). */
export function stemChannelIds(project: Project, stem: StemName): string[] {
  const chans = project.mixer.channels;
  const own = chans.filter((c) => c.kind !== "master" && STEM_PATTERNS[stem].test(c.name));
  if (!own.length) return [];
  const ids = new Set(own.map((c) => c.id));
  for (const c of own) {
    let out = c.outputId;
    for (let hop = 0; out && hop < 4; hop++) { // walk up through buses (not the master)
      const bus = chans.find((x) => x.id === out);
      if (!bus || bus.kind === "master") break;
      ids.add(bus.id);
      out = bus.outputId;
    }
  }
  for (const c of chans) if (/^(reverb|delay)\b/i.test(c.name)) ids.add(c.id);
  return [...ids];
}

/** A one-section spec for loops: the hook, at full energy. */
export function loopSpec(spec: ProductionSpec, bars: number, parts?: PartRole[]): ProductionSpec {
  return ProductionSpecSchema.parse({
    ...spec,
    length: "short",
    sections: [{ name: "Loop", role: "hook", bars, energy: 0.95, ...(parts?.length ? { parts } : {}) }],
  });
}

/** Seamless loop: add everything after `loopSamples` (reverb/delay tail) back onto the start. */
export function foldTail(channelData: Float32Array[], loopSamples: number): Float32Array[] {
  return channelData.map((c) => {
    const out = new Float32Array(loopSamples);
    out.set(c.subarray(0, loopSamples));
    for (let i = loopSamples; i < c.length; i++) { const j = (i - loopSamples) % loopSamples; out[j] = out[j]! + c[i]!; }
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
    if (peak > 0.98) for (let i = 0; i < out.length; i++) out[i] = out[i]! * (0.98 / peak);
    return out;
  });
}

export async function generateAudio(req: GenerateAudioRequest, deps: GenerateAudioDeps, onUpdate: (s: ProducerRunState) => void = () => {}): Promise<GenerateAudioResult> {
  const notes: string[] = [];
  let usedAI = false;
  let base: ProductionSpec | null = req.spec ?? null;
  if (!base && deps.plan) {
    try { base = await deps.plan(req.prompt); usedAI = true; } catch (e) { notes.push(`AI planning failed (${String(e instanceof Error ? e.message : e).slice(0, 140)}), used the offline producer.`); }
  }
  if (!base) base = directFromPrompt(req.prompt).spec;
  const ov = Object.fromEntries(Object.entries(req.overrides ?? {}).filter(([, v]) => v !== undefined && v !== ""));
  if (Object.keys(ov).length) base = ProductionSpecSchema.parse({ ...base, ...ov });
  const bars = req.loopBars ?? 8;
  const spec = req.output === "song" ? base : loopSpec(base, bars, req.parts);

  // scratch session: the producer pipeline runs entirely against this local project
  let scratch: Project = createEmptyProject(spec.title, spec.bpm ?? 120);
  const history: Project[] = [];
  const producerDeps: ProducerDeps = {
    getProject: () => scratch,
    commit: (next) => { history.push(scratch); scratch = next; },
    dispatchMany: (cmds) => {
      try { history.push(scratch); scratch = applyCommands(scratch, cmds); return true; } catch { history.pop(); return false; }
    },
    undo: () => { scratch = history.pop() ?? scratch; },
    render: (p, from, to) => deps.render(p, from, to, { sampleRate: 22050, tailSec: 0.4 }),
    catalog: deps.catalog,
    projectSummary: deps.projectSummary,
    signal: deps.signal,
  };
  const run = await runProducer({ prompt: req.prompt, spec, mode: "replace", review: false }, producerDeps, onUpdate);
  if (run.error) throw new Error(run.error);
  notes.push(...run.notes.filter((n) => n !== "Using the revised plan.")); // internal: the plan is always handed in here
  const final = run.spec ?? spec;
  const key = `${scratch.key} ${scratch.scale}`;
  const bpm = scratch.bpm;
  const end = Math.max(TICKS_PER_BAR, ...scratch.clips.map((c) => c.startTick + c.lengthTicks));
  const SR = 44100;
  const clips: GeneratedClip[] = [];
  const title = final.title || "Untitled";

  if (req.output === "song") {
    const r = await deps.render(scratch, 0, end, { sampleRate: SR, tailSec: 2.5 });
    if (!r) throw new Error("Cancelled");
    clips.push({ name: `${title} (full song, ${bpm} BPM, ${key})`, role: "song", channelData: r.channelData, sampleRate: r.sampleRate, bpm, key, bars: Math.round(end / TICKS_PER_BAR) });
  } else {
    const from = scratch.sections[0]?.startTick ?? 0;
    const to = from + bars * TICKS_PER_BAR;
    const loopSamples = Math.round(((to - from) / PPQ) * (60 / bpm) * SR);
    const renderLoop = async (only?: string[]) => {
      const r = await deps.render(scratch, from, to, { sampleRate: SR, tailSec: 2, onlyMixerChannelIds: only });
      if (!r) throw new Error("Cancelled");
      return foldTail(r.channelData, loopSamples);
    };
    clips.push({ name: `${title} (${bars}-bar loop, ${bpm} BPM, ${key})`, role: "loop", channelData: await renderLoop(), sampleRate: SR, bpm, key, bars });
    if (req.output === "stems") {
      for (const stem of ["drums", "bass", "chords", "melody"] as StemName[]) {
        const ids = stemChannelIds(scratch, stem);
        if (!ids.length) continue;
        clips.push({ name: `${title} ${stem} stem (${bars} bars, ${bpm} BPM, ${key})`, role: stem, channelData: await renderLoop(ids), sampleRate: SR, bpm, key, bars });
      }
    }
  }
  return { spec: final, summary: run.summary ?? title, usedAI, clips, notes };
}

/**
 * Does a chat message ask for audio (a loop/sample/clip, stems, or a rendered song)? `force` = the
 * user is in "Create audio" mode, so anything counts and the output defaults to a full song.
 */
export function detectAudioRequest(text: string, force = false): Pick<GenerateAudioRequest, "output" | "parts" | "loopBars"> | null {
  const t = text.toLowerCase();
  const asks = /\b(make|generate|create|give me|produce|render|build|cook up|need|want|send me)\b/.test(t);
  let output: AudioOutput | null = null;
  if (/\bstems?\b|\bstem pack\b|\bmultitracks?\b/.test(t)) output = "stems";
  else if (/\b(loops?|samples?|clips?|one[- ]?shots?|snippets?|breaks?)\b/.test(t)) output = "loop";
  else if (/\b(full song|song|track|instrumental|beat)\b.*\b(audio|wav|mp3|file|render(ed)?|bounce)\b|\b(audio|wav|mp3)\b.*\b(song|track|beat)\b/.test(t)) output = "song";
  if (!output && force) output = /\b(loops?|samples?)\b/.test(t) ? "loop" : "song";
  if (!output || (!asks && !force)) return null;
  const parts: PartRole[] | undefined = /\b(drum ?break|drums? only|drum loop|break ?beat)\b/.test(t) ? ["drums"]
    : /\b(no drums|drumless|drum-less|without drums|melodic|to chop|for sampling)\b/.test(t) ? ["chords", "melody"]
    : undefined;
  const bars = /\b(2|4|8)[- ]?bars?\b/.exec(t);
  return { output, parts, loopBars: bars ? (Number(bars[1]) as 2 | 4 | 8) : undefined };
}
