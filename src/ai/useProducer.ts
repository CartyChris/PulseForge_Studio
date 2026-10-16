/**
 * Producer runtime: wires the end-to-end harness (producer-agent.ts) to the real studio — the
 * project store, the offline renderer, the live sound catalog and whichever AI is connected.
 * Module-level store so a run survives page navigation (start on Home, watch on Producer).
 */
import { create } from "zustand";
import { useStudio } from "../state/store";
import { api, type ProviderInfo } from "../api";
import { runProducer, buildCatalog, type ProducerRunState, type ProducerRequest, type ProducerDeps } from "./producer-agent";
import type { ProductionSpec } from "../../shared/producer";
import { localRevise } from "../../shared/director";
import { projectSummary } from "../state/composition";
import { renderProject } from "../engine/render";
import { engine } from "../engine/engine";
import { DRUM_KITS } from "../engine/kits";
import { INSTRUMENT_PRESETS } from "../engine/instruments";
import { DRUM_ROLES } from "../../shared/composition";

/** Preference order for "Auto": subscriptions via CLI first, then keys, then local models. */
const AUTO_ORDER = [
  "cli-claude", "cli-codex", "cli-kimi", "cli-grok", "anthropic", "openai", "openrouter", "gemini", "xai",
  "zai-coding", "kimi-coding", "moonshot", "zai", "deepseek", "mistral", "groq", "together", "anthropic-compatible",
  "openai-compatible", "ollama", "lmstudio",
];

export type ProviderChoice = "auto" | "offline" | string;

/** "Error: Error: x" → "x" (server errors arrive already stringified). */
export const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^(Error:\s*)+/, "");
const MAX_AUTO_TRIES = 3;

interface ProducerStore {
  run: ProducerRunState | null;
  running: boolean;
  providers: ProviderInfo[];
  choice: ProviderChoice;
  review: boolean;
  autoApply: boolean;
  lastRequest: ProducerRequest | null;
  reviseLog: string[];
  controller: AbortController | null;
  /** brains that failed this session (e.g. CLI not logged in): Auto skips them until providers are refreshed */
  failed: Record<string, string>;
  setChoice(c: ProviderChoice): void;
  setReview(v: boolean): void;
  setAutoApply(v: boolean): void;
  refreshProviders(): Promise<void>;
  resolvedProvider(): ProviderInfo | null;
  candidates(): ProviderInfo[];
  start(req: ProducerRequest): Promise<ProducerRunState | null>;
  cancel(): void;
  variation(): Promise<void>;
  revise(text: string): Promise<void>;
  applyPendingFixes(): void;
}

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export const catalogText = () => buildCatalog(DRUM_KITS, INSTRUMENT_PRESETS, DRUM_ROLES);

export const useProducer = create<ProducerStore>((set, get) => ({
  run: null,
  running: false,
  providers: [],
  choice: load("pf_producer_ai", "auto"),
  review: load("pf_producer_review", "1") === "1",
  autoApply: load("pf_producer_autoapply", "0") === "1",
  lastRequest: null,
  reviseLog: [],
  controller: null,
  failed: {},

  setChoice(c) { save("pf_producer_ai", c); set({ choice: c }); },
  setReview(v) { save("pf_producer_review", v ? "1" : "0"); set({ review: v }); },
  setAutoApply(v) { save("pf_producer_autoapply", v ? "1" : "0"); set({ autoApply: v }); },

  async refreshProviders() {
    try { set({ providers: (await api.providers()).providers.filter((p) => p.kind === "text"), failed: {} }); } catch { set({ providers: [] }); }
  },

  resolvedProvider() {
    return get().candidates()[0] ?? null;
  },

  /** Brains to try, best first. A specific choice is tried alone; Auto walks AUTO_ORDER, skipping failures. */
  candidates() {
    const { choice, providers, failed } = get();
    if (choice === "offline") return [];
    if (choice !== "auto") { const p = providers.find((x) => x.id === choice); return p ? [p] : []; }
    const out: ProviderInfo[] = [];
    for (const id of AUTO_ORDER) {
      const p = providers.find((x) => x.id === id && x.configured);
      if (p && !failed[p.id]) out.push(p);
    }
    return out;
  },

  async start(req) {
    if (get().running) return null;
    const studio = useStudio.getState();
    const provider = get().resolvedProvider();
    const controller = new AbortController();
    set({ running: true, controller, lastRequest: req, run: null });
    studio.setFlags({ aiBusy: true, cloudActive: !!provider && !provider.id.startsWith("cli-") && !["ollama", "lmstudio"].includes(provider.id) });
    await engine.init().catch(() => {});
    engine.stop();

    // Auto: try connected brains in order until one answers; remember failures for this session
    const tries = get().candidates().slice(0, MAX_AUTO_TRIES);
    const brainNotes: string[] = [];
    let used: ProviderInfo | null = null;
    const withBrains = async <T,>(call: (id: string) => Promise<T>): Promise<T> => {
      const list = used ? [used] : tries.filter((p) => !get().failed[p.id]); // don't re-try a brain that just failed
      let last: unknown = new Error(tries.length ? "none of your connected AIs answered (see above)" : "no AI connected");
      for (const p of list) {
        try {
          const out = await call(p.id);
          if (!used) { used = p; if (p !== tries[0]) brainNotes.push(`Planned with ${p.name} (${brainNotes.length ? "after the brains above failed" : "fallback"}).`); }
          return out;
        } catch (e) {
          last = e;
          if (controller.signal.aborted) throw e;
          set({ failed: { ...get().failed, [p.id]: errText(e) } });
          if (list.length > 1) brainNotes.push(`${p.name} didn't answer: ${errText(e).slice(0, 140)}`);
        }
      }
      throw new Error(errText(last));
    };

    const deps: ProducerDeps = {
      planWithAI: tries.length ? async (prompt, catalog) => withBrains(async (id) => (await api.producePlan(id, prompt, catalog)).spec) : undefined,
      critiqueWithAI: tries.length ? async (goal, spec, metrics, summary) => withBrains(async (id) => (await api.produceCritique(id, goal, spec, metrics, summary)).critique) : undefined,
      getProject: () => useStudio.getState().project,
      commit: (next) => useStudio.getState().update(() => next),
      dispatchMany: (cmds) => useStudio.getState().dispatchMany(cmds),
      undo: () => useStudio.getState().undo(),
      render: async (project, fromTick, toTick) => {
        const r = await renderProject(project, (id) => engine.getAssetBuffer(id), { fromTick, toTick, tailSec: 0.4, sampleRate: 22050 }, "producer-preview");
        return r ? { channelData: r.channelData, sampleRate: r.sampleRate } : null;
      },
      catalog: catalogText,
      projectSummary,
      signal: controller.signal,
    };
    const result = await runProducer({ ...req, review: get().review, autoApplyFixes: get().autoApply }, deps, (s) => set({ run: { ...s, notes: [...brainNotes, ...s.notes] } }));
    result.notes = [...brainNotes, ...result.notes];
    set({ running: false, controller: null, run: result });
    studio.setFlags({ aiBusy: false, cloudActive: false });
    if (!result.error) {
      const p = useStudio.getState().project;
      useStudio.getState().select({ patternId: p.patterns[0]?.id ?? null, channelId: p.channels[0]?.id ?? null });
      useStudio.getState().setPlayMode("song");
      void useStudio.getState().save();
      studio.toast(`Beat ready — ${result.spec ? result.summary : "done"}`, "success");
    } else if (result.error !== "Cancelled") {
      studio.toast(`Producer stopped: ${result.error}`, "error");
    }
    return result;
  },

  cancel() { get().controller?.abort(); },

  async variation() {
    const spec = get().run?.spec;
    if (!spec) return;
    const next: ProductionSpec = { ...spec, seed: ((spec.seed ?? 1) * 1103515245 + 12345) % 2_000_000_000 };
    set({ reviseLog: [...get().reviseLog, "New variation"] });
    await get().start({ prompt: get().lastRequest?.prompt ?? "", spec: next });
  },

  async revise(text) {
    const spec = get().run?.spec;
    if (!spec || !text.trim()) return;
    const studio = useStudio.getState();
    const provider = get().resolvedProvider();
    if (provider) {
      try {
        set({ running: true });
        const { result } = await api.produceRevise(provider.id, text, spec, projectSummary(studio.project), catalogText());
        set({ running: false });
        if (result.action === "respec") {
          set({ reviseLog: [...get().reviseLog, `${text} → ${result.explanation || "revised plan"}`] });
          await get().start({ prompt: text, spec: result.spec });
        } else {
          const ok = studio.dispatchMany(result.plan.commands);
          set({ reviseLog: [...get().reviseLog, `${text} → ${result.plan.title}${ok ? "" : " (failed — nothing changed)"}`] });
          if (ok) studio.toast(`${result.plan.title} — undo with ⌘Z`, "success");
        }
        return;
      } catch (e) {
        set({ running: false, failed: get().choice === "auto" ? { ...get().failed, [provider.id]: errText(e) } : get().failed });
        studio.toast(`AI revision failed (${errText(e).slice(0, 100)}) — using the offline producer`, "error");
      }
    }
    const { spec: next, changes } = localRevise(spec, text);
    set({ reviseLog: [...get().reviseLog, `${text} → ${changes.join(", ")}`] });
    await get().start({ prompt: text, spec: next });
  },

  applyPendingFixes() {
    const run = get().run;
    if (!run?.pendingFixes?.length) return;
    if (useStudio.getState().dispatchMany(run.pendingFixes)) {
      useStudio.getState().toast(`Applied ${run.pendingFixes.length} producer fixes — undo with ⌘Z`, "success");
      set({ run: { ...run, pendingFixes: [] } });
    }
  },
}));
