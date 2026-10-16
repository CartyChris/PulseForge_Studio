import { describe, it, expect, vi } from "vitest";
import { generateAudio, foldTail, loopSpec, stemChannelIds, detectAudioRequest, type GenerateAudioDeps } from "./generate-audio";
import { ProductionSpecSchema, buildProduction } from "../../shared/producer";
import { createEmptyProject, type Project } from "../../shared/project";
import { applyProduction } from "../state/production";
import { PPQ } from "../../shared/time";

/** fake offline renderer: a quiet sine of the right length (so the mix stage has something to measure) */
function fakeDeps(over: Partial<GenerateAudioDeps> = {}) {
  const calls: Array<{ from: number; to: number; sampleRate: number; tailSec: number; only?: string[] }> = [];
  const deps: GenerateAudioDeps = {
    render: vi.fn(async (p: Project, from: number, to: number, o) => {
      calls.push({ from, to, sampleRate: o.sampleRate, tailSec: o.tailSec, only: o.onlyMixerChannelIds });
      const n = Math.round((((to - from) / PPQ) * (60 / p.bpm) + o.tailSec) * o.sampleRate);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = 0.05 * Math.sin(i / 7);
      return { channelData: [d, d.slice()], sampleRate: o.sampleRate };
    }),
    catalog: () => "kits",
    projectSummary: () => "summary",
    ...over,
  };
  return { deps, calls };
}

describe("prompt → audio", () => {
  it("full song: one clip covering the whole arrangement at 44.1 kHz, tagged with BPM and key", async () => {
    const { deps, calls } = fakeDeps();
    const r = await generateAudio({ prompt: "dark trap beat 140 bpm", output: "song" }, deps);
    expect(r.clips).toHaveLength(1);
    const c = r.clips[0]!;
    expect(c.role).toBe("song");
    expect(c.sampleRate).toBe(44100);
    expect(c.bpm).toBe(140);
    expect(c.key).toMatch(/^[A-G]#? \w+/);
    expect(c.bars).toBeGreaterThan(16); // a real arrangement, not a loop
    expect(calls.at(-1)).toMatchObject({ from: 0, sampleRate: 44100 });
  });

  it("loop: exactly N bars long (seamless — the tail is folded in), single-section spec", async () => {
    const { deps } = fakeDeps();
    const r = await generateAudio({ prompt: "lofi keys 80 bpm", output: "loop", loopBars: 4 }, deps);
    expect(r.clips).toHaveLength(1);
    const c = r.clips[0]!;
    expect(c.channelData[0]!.length).toBe(Math.round(16 * (60 / c.bpm) * 44100)); // 4 bars × 4 beats
    expect(r.spec.sections ?? []).toHaveLength(1);
  });

  it("stems: the loop plus one solo render per stem, each soloing only its own tracks + returns", async () => {
    const { deps, calls } = fakeDeps();
    const r = await generateAudio({ prompt: "boom bap 90 bpm", output: "stems", loopBars: 2 }, deps);
    expect(r.clips.map((c) => c.role)).toEqual(["loop", "drums", "bass", "chords", "melody"]);
    const solos = calls.filter((c) => c.only);
    expect(solos).toHaveLength(4);
    for (const s of solos) expect(s.only!.length).toBeGreaterThan(0);
  });

  it("uses the AI plan when available and falls back to offline when it fails", async () => {
    const plan = vi.fn(async () => ProductionSpecSchema.parse({ genre: "house", bpm: 124, title: "From AI" }));
    const ok = await generateAudio({ prompt: "x", output: "loop", loopBars: 2 }, fakeDeps({ plan }).deps);
    expect(ok.usedAI).toBe(true);
    expect(ok.clips[0]!.bpm).toBe(124);
    const bad = await generateAudio({ prompt: "trap", output: "loop", loopBars: 2 }, fakeDeps({ plan: async () => { throw new Error("401 bad key"); } }).deps);
    expect(bad.usedAI).toBe(false);
    expect(bad.notes.join(" ")).toMatch(/AI planning failed.*401/);
  });

  it("drum-less sample loops: parts restrict what is written", () => {
    const s = loopSpec(ProductionSpecSchema.parse({ genre: "rnb" }), 8, ["chords", "melody"]);
    expect(s.sections).toEqual([expect.objectContaining({ bars: 8, parts: ["chords", "melody"] })]);
    const p = applyProduction(createEmptyProject(), buildProduction(s));
    expect(p.channels.some((c) => c.instrument.type === "drum-sound")).toBe(false);
  });

  it("stemChannelIds walks up through buses; foldTail wraps the tail onto the start", () => {
    const p = applyProduction(createEmptyProject(), buildProduction(ProductionSpecSchema.parse({ genre: "trap", seed: 3 })));
    const chords = stemChannelIds(p, "chords").map((id) => p.mixer.channels.find((c) => c.id === id)!.name);
    expect(chords.some((n) => /^chords/i.test(n))).toBe(true);
    expect(chords.some((n) => /music bus/i.test(n))).toBe(true); // chords feed the Music Bus — must be soloed too
    expect(chords.some((n) => /^(kick|drums|bass)\b/i.test(n))).toBe(false);
    const folded = foldTail([Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.05, 0.05])], 4);
    expect([...folded[0]!].map((v) => +v.toFixed(3))).toEqual([0.15, 0.25, 0.3, 0.4]);
  });
});

describe("chat: detect audio requests", () => {
  it("recognises loops, stems and rendered songs; ignores normal compose/edit chat", () => {
    expect(detectAudioRequest("make me a dusty soul loop to chop")).toEqual({ output: "loop", parts: ["chords", "melody"], loopBars: undefined });
    expect(detectAudioRequest("give me stems for a drill beat")).toMatchObject({ output: "stems" });
    expect(detectAudioRequest("generate a 4 bar drum break")).toEqual({ output: "loop", parts: ["drums"], loopBars: 4 });
    expect(detectAudioRequest("render a full trap song as audio")).toMatchObject({ output: "song" });
    expect(detectAudioRequest("write a chorus melody over my chords")).toBeNull();
    expect(detectAudioRequest("make the drums punchier")).toBeNull();
    expect(detectAudioRequest("dark afrobeats", true)).toMatchObject({ output: "song" }); // Create-audio mode
    expect(detectAudioRequest("lofi sample", true)).toMatchObject({ output: "loop" });
  });
});
