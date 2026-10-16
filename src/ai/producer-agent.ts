/**
 * The end-to-end producer harness: one request → a finished, mixed, reviewed beat.
 *
 *   1 Plan     AI model writes a ProductionSpec (or the local director does, offline / on failure)
 *   2 Compose  the deterministic engine turns the spec into parts (always in key, on grid)
 *   3 Arrange  parts become an FL-style session (tracks, patterns, mixer, sends, automation)
 *   4 Mix      offline-render the loudest section → measure → rule-based gain staging → re-measure
 *              (the fix is kept only if it measurably moved toward target; otherwise undone)
 *   5 Review   optional AI critique of the measurements → conservative mixer fixes
 *
 * Every dependency is injected (AI calls, project access, offline render), so the whole loop is
 * unit-testable and identical in the desktop app, on Vercel and offline. Every project change is
 * a normal undoable store update — "undo" reverts the AI's work like anyone else's.
 */
import type { Project } from "../../shared/project";
import { MASTER_ID } from "../../shared/project";
import type { DawCommand } from "../../shared/commands";
import { buildProduction, describeProduction, GENRES, type Production, type ProductionSpec, ProductionSpecSchema } from "../../shared/producer";
import { directFromPrompt } from "../../shared/director";
import type { ProduceCritique } from "../../shared/producer-ai";
import { applyProduction } from "../state/production";
import { mixMetrics, type MixMetrics } from "../engine/analysis";

export type StageId = "plan" | "compose" | "arrange" | "mix" | "review";
export interface StageState { id: StageId; label: string; status: "pending" | "running" | "done" | "skipped" | "error"; detail?: string }

export interface ProducerRunState {
  stages: StageState[];
  spec?: ProductionSpec;
  production?: Production;
  metricsBefore?: MixMetrics;
  metrics?: MixMetrics;
  critique?: ProduceCritique;
  /** critique commands not yet applied (when autoApply is off) */
  pendingFixes?: DawCommand[];
  usedAI: boolean;
  notes: string[];
  summary?: string;
  error?: string;
}

export interface ProducerRequest {
  prompt: string;
  /** a ready spec (revision / variation) — skips planning entirely */
  spec?: ProductionSpec;
  /** explicit UI choices always win over both the AI and the director */
  overrides?: Partial<Pick<ProductionSpec, "genre" | "bpm" | "key" | "scale" | "length" | "swing">> & { seed?: number };
  mode?: "replace" | "append";
  review?: boolean;
  autoApplyFixes?: boolean;
}

export interface ProducerDeps {
  planWithAI?: (prompt: string, catalog: string) => Promise<ProductionSpec>;
  critiqueWithAI?: (goal: string, spec: ProductionSpec, metricsText: string, projectSummary: string) => Promise<ProduceCritique>;
  getProject(): Project;
  commit(next: Project): void;
  dispatchMany(cmds: DawCommand[]): boolean;
  undo(): void;
  render(project: Project, fromTick: number, toTick: number): Promise<{ channelData: Float32Array[]; sampleRate: number } | null>;
  catalog(): string;
  projectSummary(p: Project): string;
  signal?: AbortSignal;
}

const errMsg = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^(Error:\s*)+/, "");

const STAGE_LABELS: Record<StageId, string> = {
  plan: "Planning the beat", compose: "Writing the music", arrange: "Arranging the song", mix: "Mixing & mastering", review: "Producer review",
};

/** Loudness targets by form (≈ LUFS). */
export function loudnessTarget(spec: Pick<ProductionSpec, "genre">): number {
  const form = GENRES[spec.genre].form;
  return form === "edm" ? -8.5 : form === "chill" ? -12 : spec.genre === "rnb" ? -11 : -9.5;
}

/**
 * Rule-based gain staging from measurements. Uses the producer's own master chain
 * (eq3 → compressor → limiter): loudness moves via the compressor's makeup gain (pre-limiter, so
 * louder never means clipping), tone via the master EQ, low end via the Bass insert.
 */
export function autoMixCommands(project: Project, m: MixMetrics, target: number, opts: { tonal?: boolean } = {}): { commands: DawCommand[]; notes: string[] } {
  const tonal = opts.tonal ?? true; // bass/top-end moves: once per run, so passes don't stack them
  const commands: DawCommand[] = [];
  const notes: string[] = [];
  const master = project.mixer.channels.find((c) => c.id === MASTER_ID);
  if (!master || m.lufs <= -69) return { commands, notes };
  const comp = master.effects.find((e) => e.type === "compressor");
  const eq = master.effects.find((e) => e.type === "eq3");
  const limiter = master.effects.find((e) => e.type === "limiter");

  const delta = target - m.lufs;
  // Gain staging: the master fader sits AFTER the limiter, so pushing it above 0 dB defeats the
  // limiter's ceiling. Loudness therefore goes in BEFORE the limiter — a "drive" gain stage, else the
  // compressor's makeup — and the fader only rises above 0 dB on a master with no limiter at all.
  const limIdx = master.effects.findIndex((e) => e.type === "limiter");
  const drive = limIdx > 0 ? master.effects.slice(0, limIdx).reverse().find((e) => e.type === "gain") : undefined;
  const faderCeil = limiter ? 0 : 12;
  const driveDb = drive?.params.gain ?? 0;
  let fader = 0, driveMove = 0;
  if (m.peakDb > -0.5 && master.volumeDb > 0) {
    fader = -Math.min(master.volumeDb, m.peakDb + 1);
    notes.push(`Output peaked at ${m.peakDb} dBFS because the master fader was up ${master.volumeDb} dB — pulled it back ${(-fader).toFixed(1)} dB`);
  } else if (delta >= 1) {
    // a fader below its ceiling comes up first, as far as the peaks allow
    fader = Math.max(0, Math.min(delta, -1 - m.peakDb, faderCeil - master.volumeDb));
    if (fader >= 0.5) notes.push(`Loudness ${m.lufs} → aiming for ${target} LUFS: master +${fader.toFixed(1)} dB (peaks had room)`);
    else fader = 0;
  } else if (delta <= -1) {
    if (drive && driveDb > 0) {
      driveMove = -Math.min(driveDb, -delta);
      notes.push(`Loudness ${m.lufs} is hotter than the ${target} LUFS target: drive into the limiter ${driveMove.toFixed(1)} dB`);
    }
    const left = delta - driveMove;
    if (left <= -1) {
      fader = Math.max(-24 - master.volumeDb, left);
      notes.push(`Loudness ${m.lufs} is hotter than the ${target} LUFS target: master ${fader.toFixed(1)} dB`);
    }
  }
  if (fader !== 0) commands.push({ type: "setTrackVolume", mixerChannelId: MASTER_ID, volumeDb: Math.round((master.volumeDb + fader) * 10) / 10 });
  // whatever loudness is still missing is pushed into the limiter (it and its safety clipper hold the ceiling)
  const rest = delta - Math.max(0, fader);
  if (delta >= 1 && rest >= 1) {
    if (drive && driveDb < 24) {
      driveMove = Math.min(24 - driveDb, rest, 12);
      notes.push(`Still ${rest.toFixed(1)} dB under target: drive into the limiter +${driveMove.toFixed(1)} dB`);
    } else if (comp) {
      const makeup = Math.min(12, (comp.params.makeup ?? 0) + Math.min(6, rest));
      if (makeup > (comp.params.makeup ?? 0)) {
        commands.push({ type: "setEffectParameter", mixerChannelId: MASTER_ID, effectId: comp.id, param: "makeup", value: Math.round(makeup * 10) / 10 });
        notes.push(`Still ${rest.toFixed(1)} dB under target: master compressor makeup → ${makeup.toFixed(1)} dB`);
      }
    }
  }
  if (drive && driveMove !== 0) commands.push({ type: "setEffectParameter", mixerChannelId: MASTER_ID, effectId: drive.id, param: "gain", value: Math.round((driveDb + driveMove) * 10) / 10 });
  if (m.peakDb > -0.5 && limiter) {
    commands.push({ type: "setEffectParameter", mixerChannelId: MASTER_ID, effectId: limiter.id, param: "threshold", value: Math.max(-6, (limiter.params.threshold ?? -1) - 1) });
    notes.push(`Peaks at ${m.peakDb} dBFS — tightened the limiter`);
  }
  const bass = tonal ? project.mixer.channels.find((c) => c.name.startsWith("Bass")) : undefined;
  if (bass && m.low > 0.62) {
    commands.push({ type: "setTrackVolume", mixerChannelId: bass.id, volumeDb: Math.max(-30, bass.volumeDb - 2) });
    notes.push(`Low end is ${(m.low * 100).toFixed(0)}% of the energy — bass down 2 dB`);
  } else if (bass && m.low < 0.2) {
    commands.push({ type: "setTrackVolume", mixerChannelId: bass.id, volumeDb: Math.min(6, bass.volumeDb + 1.5) });
    notes.push(`Thin low end (${(m.low * 100).toFixed(0)}%) — bass up 1.5 dB`);
  }
  if (tonal && eq && m.high > 0.28) {
    commands.push({ type: "setEffectParameter", mixerChannelId: MASTER_ID, effectId: eq.id, param: "high", value: Math.max(-24, (eq.params.high ?? 0) - 1.5) });
    notes.push("Top end a little harsh — master high shelf −1.5 dB");
  } else if (tonal && eq && m.high < 0.04) {
    commands.push({ type: "setEffectParameter", mixerChannelId: MASTER_ID, effectId: eq.id, param: "high", value: Math.min(24, (eq.params.high ?? 0) + 1.5) });
    notes.push("Dull top end — master high shelf +1.5 dB");
  }
  return { commands, notes };
}

export function metricsText(m: MixMetrics, label: string): string {
  return `${label}: ≈${m.lufs} LUFS, peak ${m.peakDb} dBFS, crest ${m.crestDb} dB, energy low ${(m.low * 100).toFixed(0)}% / mid ${(m.mid * 100).toFixed(0)}% / high ${(m.high * 100).toFixed(0)}%, clipped samples ${m.clippedSamples}, ${m.durationSec.toFixed(1)} s analyzed`;
}

/** The commands an AI critic may apply automatically — mixer-level only, never structural. */
const SAFE_FIX_TYPES = new Set(["setTrackVolume", "setTrackPan", "addEffect", "setEffectParameter", "addSend", "setSidechain", "setChannelVolume", "setChannelPan"]);

export async function runProducer(req: ProducerRequest, deps: ProducerDeps, onUpdate: (s: ProducerRunState) => void = () => {}): Promise<ProducerRunState> {
  const state: ProducerRunState = {
    stages: (Object.keys(STAGE_LABELS) as StageId[]).map((id) => ({ id, label: STAGE_LABELS[id], status: "pending" })),
    usedAI: false,
    notes: [],
  };
  const emit = () => onUpdate({ ...state, stages: state.stages.map((s) => ({ ...s })), notes: [...state.notes] });
  const stage = (id: StageId, status: StageState["status"], detail?: string) => {
    const s = state.stages.find((x) => x.id === id)!;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    emit();
  };
  const aborted = () => deps.signal?.aborted === true;
  let current: StageId = "plan";

  try {
    // ── 1. plan ──
    stage("plan", "running");
    let spec: ProductionSpec | null = req.spec ?? null;
    if (spec) state.notes.push("Using the revised plan.");
    if (!spec && deps.planWithAI) {
      try {
        spec = await deps.planWithAI(req.prompt, deps.catalog());
        state.usedAI = true;
      } catch (e) {
        state.notes.push(`AI planning failed (${errMsg(e).slice(0, 160)}) — used the offline producer instead.`);
      }
    }
    if (!spec) spec = directFromPrompt(req.prompt, req.overrides?.seed).spec;
    const o = req.overrides ?? {};
    spec = ProductionSpecSchema.parse({
      ...spec,
      ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")),
      seed: o.seed ?? spec.seed ?? Math.floor(Math.random() * 2_000_000_000),
    });
    state.spec = spec;
    stage("plan", "done", `${GENRES[spec.genre].name}${spec.bpm ? ` · ${spec.bpm} BPM` : ""}${spec.key ? ` · ${spec.key} ${spec.scale ?? ""}` : ""}${state.usedAI ? " · planned by AI" : " · offline producer"}`);
    if (aborted()) throw new Error("Cancelled");

    // ── 2. compose ──
    current = "compose";
    stage("compose", "running");
    const production = buildProduction(spec);
    state.production = production;
    stage("compose", "done", describeProduction(production));
    if (aborted()) throw new Error("Cancelled");

    // ── 3. arrange ──
    current = "arrange";
    stage("arrange", "running");
    deps.commit(applyProduction(deps.getProject(), production, { mode: req.mode ?? "replace" }));
    const p = deps.getProject();
    stage("arrange", "done", `${p.tracks.length} tracks · ${p.patterns.length} patterns · ${p.mixer.channels.length} mixer channels`);
    if (aborted()) throw new Error("Cancelled");

    // ── 4. mix: render the loudest section, measure, gain-stage, re-measure ──
    current = "mix";
    stage("mix", "running", "Rendering a preview…");
    const loudestIdx = production.sections.reduce((best, s, i, arr) => (s.energy > arr[best]!.energy ? i : best), 0);
    const loudest = production.sections[loudestIdx]!;
    // the production's sections are the LAST n project sections (append mode offsets them past
    // the existing song), so take real tick positions from the project, not from bar math
    const placed = p.sections[p.sections.length - production.sections.length + loudestIdx];
    const from = placed?.startTick ?? loudest.startBar * 384;
    const to = from + Math.min(loudest.bars, 8) * 384;
    const target = loudnessTarget(spec);
    const r1 = await deps.render(deps.getProject(), from, to);
    if (!r1) throw new Error("Cancelled");
    const m1 = mixMetrics(r1.channelData, r1.sampleRate);
    state.metricsBefore = m1;
    state.metrics = m1;
    // measured loop: apply rule-based fixes, re-render, keep only what measurably helps
    const MAX_PASSES = 3;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      const cur = state.metrics!;
      if (pass > 1 && Math.abs(cur.lufs - target) <= 1.5) break; // close enough; tonal fixes ran in pass 1
      const { commands, notes } = autoMixCommands(deps.getProject(), cur, target, { tonal: pass === 1 });
      if (!commands.length || !deps.dispatchMany(commands)) break;
      stage("mix", "running", `Mix pass ${pass}: re-rendering to check…`);
      const r2 = await deps.render(deps.getProject(), from, to);
      if (!r2) throw new Error("Cancelled");
      const m2 = mixMetrics(r2.channelData, r2.sampleRate);
      const before = Math.abs(cur.lufs - target), after = Math.abs(m2.lufs - target);
      if (after <= before + 0.3 && m2.clippedSamples <= cur.clippedSamples) {
        state.metrics = m2;
        state.notes.push(...notes);
      } else {
        deps.undo(); // the fix didn't measurably help — keep the previous mix
        state.notes.push(pass === 1 ? "Auto-mix adjustment didn't measurably improve the mix, so it was reverted." : `Mix pass ${pass} didn't help, so it was reverted.`);
        break;
      }
    }
    stage("mix", "done", `≈${state.metrics!.lufs} LUFS (target ${target}) · peak ${state.metrics!.peakDb} dBFS`);
    if (aborted()) throw new Error("Cancelled");

    // ── 5. review ──
    current = "review";
    if (req.review && deps.critiqueWithAI) {
      stage("review", "running");
      try {
        const critique = await deps.critiqueWithAI(req.prompt, spec, [metricsText(state.metrics!, `${loudest.name} (loudest section)`), `Target ≈ ${target} LUFS`].join("\n"), deps.projectSummary(deps.getProject()));
        state.critique = critique;
        const safe = critique.commands.filter((c) => SAFE_FIX_TYPES.has(c.type));
        if (safe.length && req.autoApplyFixes) {
          if (deps.dispatchMany(safe)) state.notes.push(`Applied ${safe.length} producer fix${safe.length > 1 ? "es" : ""} (undo with ⌘Z).`);
        } else if (safe.length) {
          state.pendingFixes = safe;
        }
        stage("review", "done", critique.verdict === "ship" ? "Sounds good to go" : `${critique.issues.length} suggestion${critique.issues.length === 1 ? "" : "s"}`);
      } catch (e) {
        state.notes.push(`AI review unavailable (${errMsg(e).slice(0, 120)}).`);
        stage("review", "skipped", "AI review unavailable");
      }
    } else {
      stage("review", "skipped", deps.critiqueWithAI ? "Review off" : "Connect an AI provider for a producer review");
    }

    const minutes = (production.totalBars * 4 * 60) / production.spec.bpm / 60;
    state.summary = `“${production.spec.title}” — ${GENRES[spec.genre].name}, ${production.spec.bpm} BPM, ${production.spec.key} ${production.spec.scale}, ${production.sections.length} sections, ~${minutes.toFixed(1)} min.`;
    emit();
    return state;
  } catch (e) {
    state.error = String(e).replace(/^Error: /, "");
    const s = state.stages.find((x) => x.id === current)!;
    s.status = "error";
    s.detail = state.error;
    emit();
    return state;
  }
}

/** Compact sound catalog for the AI (kits + instrument presets that exist in THIS build). */
export function buildCatalog(kits: Array<{ id: string; name: string }>, presets: Array<{ id: string; name: string; category: string }>, roles: readonly string[]): string {
  const byCat = new Map<string, string[]>();
  for (const p of presets) byCat.set(p.category, [...(byCat.get(p.category) ?? []), `${p.id} (${p.name})`]);
  return [
    `Drum kits: ${kits.map((k) => `${k.id} (${k.name})`).join(", ")}`,
    `Drum roles usable in grids: ${roles.join(", ")}`,
    "Instrument presets by category:",
    ...[...byCat.entries()].map(([cat, list]) => `  ${cat}: ${list.join(", ")}`),
  ].join("\n");
}
