import { describe, it, expect, vi } from "vitest";
import { createEmptyProject, MASTER_ID, type Project } from "../../shared/project";
import type { DawCommand } from "../../shared/commands";
import { ProductionSpecSchema } from "../../shared/producer";
import { applyCommands } from "../state/commands";
import { mixMetrics } from "../engine/analysis";
import { runProducer, autoMixCommands, loudnessTarget, buildCatalog, type ProducerDeps, type ProducerRunState } from "./producer-agent";

/** A sine "render" at a chosen level — lets us drive the mix stage deterministically. */
function sine(amp: number, freq = 220, sec = 2, sr = 8000) {
  const d = new Float32Array(sec * sr);
  for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return { channelData: [d, d.slice()], sampleRate: sr };
}

function harness(over: Partial<ProducerDeps> = {}, renderAmps: number[] = [0.05, 0.2]) {
  let project: Project = createEmptyProject();
  const history: Project[] = [];
  const amps = [...renderAmps];
  const deps: ProducerDeps = {
    getProject: () => project,
    commit: (next) => { history.push(project); project = next; },
    dispatchMany: (cmds: DawCommand[]) => { history.push(project); project = applyCommands(project, cmds); return true; },
    undo: () => { project = history.pop() ?? project; },
    render: vi.fn(async () => sine(amps.shift() ?? 0.2)),
    catalog: () => "kits: trap-808",
    projectSummary: () => "summary",
    ...over,
  };
  return { deps, get project() { return project; } };
}

describe("mixMetrics", () => {
  it("measures level, peak and band balance plausibly", () => {
    const loud = mixMetrics(sine(0.5).channelData, 8000);
    const quiet = mixMetrics(sine(0.05).channelData, 8000);
    expect(loud.lufs - quiet.lufs).toBeGreaterThan(19); // 20 dB apart
    expect(loud.lufs - quiet.lufs).toBeLessThan(21);
    expect(loud.peakDb).toBeCloseTo(-6, 0);
    expect(loud.crestDb).toBeCloseTo(3, 0); // sine crest factor ≈ 3 dB
    expect(mixMetrics(sine(0.5, 60).channelData, 8000).low).toBeGreaterThan(0.8);
    expect(mixMetrics(sine(0.5, 3000).channelData, 8000).low).toBeLessThan(0.05);
    expect(mixMetrics([new Float32Array(100)], 8000).lufs).toBe(-70); // silence
  });
});

describe("runProducer (end-to-end harness)", () => {
  it("offline: plans with the local director, arranges, mixes, and skips review", async () => {
    const h = harness();
    const updates: ProducerRunState[] = [];
    const s = await runProducer({ prompt: "dark trap 140 bpm in F# minor" }, h.deps, (u) => updates.push(u));
    expect(s.error).toBeUndefined();
    expect(s.usedAI).toBe(false);
    expect(s.spec!.genre).toBe("trap");
    expect(s.spec!.bpm).toBe(140);
    expect(h.project.tracks.length).toBeGreaterThan(3);
    expect(s.stages.map((x) => x.status)).toEqual(["done", "done", "done", "done", "skipped"]);
    expect(updates.length).toBeGreaterThan(5); // live progress
    expect(s.summary).toContain("Trap");
  });

  it("uses the AI plan, and UI overrides beat the AI", async () => {
    const planWithAI = vi.fn(async (_prompt: string, _catalog: string) => ProductionSpecSchema.parse({ genre: "house", bpm: 124, key: "A" }));
    const h = harness({ planWithAI });
    const s = await runProducer({ prompt: "house", overrides: { bpm: 126 } }, h.deps);
    expect(s.usedAI).toBe(true);
    expect(s.spec!.genre).toBe("house");
    expect(s.spec!.bpm).toBe(126);
    expect(planWithAI.mock.calls[0]![1]).toContain("trap-808"); // catalog passed to the model
  });

  it("falls back to the offline producer when the AI fails — and says so", async () => {
    const h = harness({ planWithAI: async () => { throw new Error("401 bad key"); } });
    const s = await runProducer({ prompt: "lofi study beat" }, h.deps);
    expect(s.error).toBeUndefined();
    expect(s.usedAI).toBe(false);
    expect(s.spec!.genre).toBe("lofi");
    expect(s.notes.join(" ")).toMatch(/AI planning failed.*401/);
  });

  it("mix stage: a quiet render gets makeup gain, kept only because the re-render improved", async () => {
    const h = harness({}, [0.03, 0.25]); // before: very quiet; after: louder
    const s = await runProducer({ prompt: "trap" }, h.deps);
    const comp = h.project.mixer.channels.find((c) => c.id === MASTER_ID)!.effects.find((e) => e.type === "compressor")!;
    expect(comp.params.makeup).toBeGreaterThan(0);
    expect(s.metrics!.lufs).toBeGreaterThan(s.metricsBefore!.lufs);
    expect(h.deps.render).toHaveBeenCalledTimes(2);
  });

  it("mix stage: a fix that measures WORSE is reverted (the check can fail)", async () => {
    const h = harness({}, [0.03, 0.003]); // re-render got even quieter → revert
    const s = await runProducer({ prompt: "trap" }, h.deps);
    const comp = h.project.mixer.channels.find((c) => c.id === MASTER_ID)!.effects.find((e) => e.type === "compressor")!;
    expect(comp.params.makeup).toBe(0);
    expect(s.notes.join(" ")).toMatch(/reverted/);
    expect(s.metrics).toEqual(s.metricsBefore);
  });

  it("review: applies only SAFE mixer fixes automatically; structural commands are filtered out", async () => {
    const critiqueWithAI = vi.fn(async (_g: string, _s: unknown, _m: string, _p: string) => ({
      verdict: "revise" as const, summary: "x", issues: ["bass heavy"],
      commands: [
        { type: "setTrackVolume" as const, mixerChannelId: MASTER_ID, volumeDb: -2 },
        { type: "deleteClip" as const, clipId: "anything" },
      ],
    }));
    const h = harness({ critiqueWithAI });
    const s = await runProducer({ prompt: "trap", review: true, autoApplyFixes: true }, h.deps);
    expect(h.project.mixer.channels.find((c) => c.id === MASTER_ID)!.volumeDb).toBe(-2);
    expect(s.notes.join(" ")).toMatch(/Applied 1 producer fix/);
    expect(critiqueWithAI.mock.calls[0]![2]).toMatch(/LUFS/);
  });

  it("review without auto-apply leaves fixes pending for the user", async () => {
    const h = harness({ critiqueWithAI: async () => ({ verdict: "revise", summary: "", issues: [], commands: [{ type: "setTrackPan", mixerChannelId: MASTER_ID, pan: 0.1 }] }) });
    const s = await runProducer({ prompt: "trap", review: true }, h.deps);
    expect(s.pendingFixes).toHaveLength(1);
    expect(h.project.mixer.channels.find((c) => c.id === MASTER_ID)!.pan).toBe(0);
  });

  it("cancel stops the run and marks the stage", async () => {
    const ctrl = new AbortController();
    const h = harness({ planWithAI: async () => { ctrl.abort(); return ProductionSpecSchema.parse({ genre: "pop" }); }, signal: ctrl.signal });
    const s = await runProducer({ prompt: "pop" }, h.deps);
    expect(s.error).toBe("Cancelled");
    expect(h.project.tracks).toHaveLength(0); // nothing arranged
  });

  it("append mode measures the NEW song, not bar 1 of the old one", async () => {
    const h = harness();
    await runProducer({ prompt: "trap" }, h.deps);
    const firstEnd = Math.max(...h.project.clips.map((c) => c.startTick + c.lengthTicks));
    const render = vi.fn(async () => sine(0.2));
    h.deps.render = render;
    await runProducer({ prompt: "house", mode: "append" }, h.deps);
    expect((render.mock.calls[0] as unknown[])[1]).toBeGreaterThanOrEqual(firstEnd);
  });
});

describe("autoMixCommands", () => {
  it("does nothing on silence and targets genre loudness", () => {
    expect(autoMixCommands(createEmptyProject(), mixMetrics([new Float32Array(10)], 8000), -9).commands).toHaveLength(0);
    expect(loudnessTarget({ genre: "house" })).toBe(-8.5);
    expect(loudnessTarget({ genre: "lofi" })).toBe(-12);
  });
  it("builds a readable catalog", () => {
    const c = buildCatalog([{ id: "k", name: "Kit" }], [{ id: "p", name: "Piano", category: "Piano" }], ["kick"]);
    expect(c).toContain("k (Kit)");
    expect(c).toContain("Piano: p (Piano)");
  });
});
