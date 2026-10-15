import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYNTH_ENGINES, INSTRUMENT_PRESETS, getEngine } from "./instruments";
import { SAMPLE_MANIFEST, noteNameToMidi, sampledEngineId, sampleUrl, sampledInstrumentIdsInProject, getSampleSetState, ensureSampledInstrumentsLoaded } from "./sampled";
import { decodeWavSamples } from "../../shared/wav";

// Node has no AudioContext, so Tone nodes cannot be instantiated here (live playback/export are
// verified in the browser). These checks guard the data contracts that break silently at runtime:
// a preset pointing at a missing engine / out-of-range param, a missing contract id, or a manifest
// referencing a sample file that isn't shipped (or is silent / truncated).

const SAMPLES_DIR = fileURLToPath(new URL("../../public/samples", import.meta.url));
const CONTRACT_IDS = [
  "grand-piano", "strings-ensemble", "pizzicato", "flute", "brass-section", "french-horn", "glockenspiel",
  "marimba", "harp", "nylon-guitar", "steel-guitar", "electric-guitar-clean", "b3-organ", "supersaw-lead", "supersaw-chords",
];
// ids that existed before 2.0 — saved projects reference them, they must never disappear
const LEGACY_IDS = [
  "piano-studio", "piano-soft", "piano-dark", "piano-lofi", "ep-classic", "ep-warm", "ep-bell", "ep-chorus", "organ",
  "bass-sub", "bass-808", "bass-electric", "bass-synth", "bass-reese", "bass-pluck", "pad-strings", "pad-choir", "pad-ambient",
  "lead-synth", "pluck", "pluck-guitar", "bell", "mallet", "fm-keys", "fm-bass", "fm-metallic", "brass", "synth-chord",
  "percussion", "sfx", "bass-wobble", "bass-acid", "bass-growl", "bass-deep-house", "bass-808-long", "bass-808-distorted",
  "bass-picked", "lead-super", "lead-square", "lead-whistle", "lead-trance", "lead-retro", "keys-house-organ", "keys-clav",
  "keys-music-box", "keys-dream", "piano-grand-bright", "piano-tape", "pad-warm-analog", "pad-dark-drone", "pad-shimmer",
  "pad-vapor", "pad-cinematic", "fm-kalimba", "fm-glass", "fm-marimba", "fm-gong", "fm-toy-piano", "strings-staccato",
  "choir-ahh", "flute-air", "pluck-koto", "pluck-harp", "sfx-riser-synth", "sfx-laser", "sfx-underwater",
];
const LEGACY_ENGINES = ["subtractive", "fm", "pad", "pluck", "piano", "epiano", "bass808", "bass"];
const NEW_ENGINES = ["string", "organ", "supersaw", "am", "brass", "strings-synth"];

describe("synth engines", () => {
  it("engine ids are unique and include every legacy + 2.0 engine", () => {
    const ids = SYNTH_ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...LEGACY_ENGINES, ...NEW_ENGINES]) expect(ids, `missing engine ${id}`).toContain(id);
  });

  it("every engine param has a sane range and unique key", () => {
    for (const e of SYNTH_ENGINES) {
      expect(e.params.length, `${e.id} has no params`).toBeGreaterThan(0);
      const keys = new Set<string>();
      for (const p of e.params) {
        expect(keys.has(p.key), `${e.id}.${p.key} duplicated`).toBe(false);
        keys.add(p.key);
        expect(p.max, `${e.id}.${p.key} max<=min`).toBeGreaterThan(p.min);
        expect(p.default, `${e.id}.${p.key} default below min`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${e.id}.${p.key} default above max`).toBeLessThanOrEqual(p.max);
        expect(typeof e.create).toBe("function");
      }
    }
  });

  it("one sampled engine per manifest instrument with attack/release/brightness/velocity/volume", () => {
    for (const inst of SAMPLE_MANIFEST.instruments) {
      const eng = SYNTH_ENGINES.find((e) => e.id === sampledEngineId(inst.id));
      expect(eng, `no engine for ${inst.id}`).toBeDefined();
      expect(eng!.params.map((p) => p.key).sort()).toEqual(["attack", "brightness", "release", "velocity", "volume"]);
    }
  });
});

describe("instrument presets", () => {
  it("preset ids are unique", () => {
    const ids = INSTRUMENT_PRESETS.map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("every preset resolves to a registered engine and its params exist and are in range", () => {
    for (const preset of INSTRUMENT_PRESETS) {
      const eng = SYNTH_ENGINES.find((e) => e.id === preset.engineId);
      expect(eng, `${preset.id}: engine "${preset.engineId}" not registered`).toBeDefined();
      expect(getEngine(preset.engineId).id).toBe(preset.engineId);
      expect(preset.name.length, `${preset.id} has no name`).toBeGreaterThan(0);
      expect(preset.category.length, `${preset.id} has no category`).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(preset.params)) {
        const desc = eng!.params.find((p) => p.key === k);
        expect(desc, `${preset.id}: param "${k}" not on engine ${eng!.id}`).toBeDefined();
        expect(Number.isFinite(v), `${preset.id}.${k} not finite`).toBe(true);
        expect(v, `${preset.id}.${k}=${v} < min ${desc!.min}`).toBeGreaterThanOrEqual(desc!.min);
        expect(v, `${preset.id}.${k}=${v} > max ${desc!.max}`).toBeLessThanOrEqual(desc!.max);
      }
    }
  });

  it("all 15 contract preset ids exist", () => {
    const ids = new Set(INSTRUMENT_PRESETS.map((p) => p.id));
    for (const id of CONTRACT_IDS) expect(ids.has(id), `contract id "${id}" missing`).toBe(true);
  });

  it("contract ids with a real sample source are sampled", () => {
    for (const id of ["grand-piano", "strings-ensemble", "pizzicato", "flute", "brass-section", "french-horn", "glockenspiel", "marimba", "harp"]) {
      expect(INSTRUMENT_PRESETS.find((p) => p.id === id)!.engineId).toBe(sampledEngineId(id));
    }
  });

  it("every pre-2.0 preset id still exists", () => {
    const ids = new Set(INSTRUMENT_PRESETS.map((p) => p.id));
    for (const id of LEGACY_IDS) expect(ids.has(id), `legacy preset "${id}" removed`).toBe(true);
  });

  it("each new engine has several distinct presets", () => {
    for (const eng of NEW_ENGINES) {
      const ps = INSTRUMENT_PRESETS.filter((p) => p.engineId === eng);
      expect(ps.length, `${eng} presets`).toBeGreaterThanOrEqual(4);
      const sigs = new Set(ps.map((p) => JSON.stringify(Object.entries(p.params).sort())));
      expect(sigs.size, `${eng} has duplicate param sets`).toBe(ps.length);
    }
  });
});

describe("sample manifest", () => {
  const allFiles = new Set<string>();
  for (const inst of SAMPLE_MANIFEST.instruments) for (const f of Object.values(inst.notes)) allFiles.add(f);

  it("instrument ids are unique and carry license, attribution and source", () => {
    const ids = SAMPLE_MANIFEST.instruments.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const inst of SAMPLE_MANIFEST.instruments) {
      expect(["CC0-1.0", "CC-BY-3.0"], `${inst.id} license`).toContain(inst.license);
      expect(inst.attribution.length, `${inst.id} attribution`).toBeGreaterThan(20);
      expect(inst.sourceUrl, `${inst.id} sourceUrl`).toMatch(/^https:\/\//);
      expect(Object.keys(inst.notes).length, `${inst.id} sample count`).toBeGreaterThanOrEqual(3);
    }
  });

  it("note names parse to valid MIDI, unique per instrument", () => {
    for (const inst of SAMPLE_MANIFEST.instruments) {
      const midis = Object.keys(inst.notes).map((n) => noteNameToMidi(n));
      for (const [i, m] of midis.entries()) expect(m, `${inst.id} note "${Object.keys(inst.notes)[i]}"`).not.toBeNull();
      expect(new Set(midis).size).toBe(midis.length);
    }
  });

  it("every referenced file exists on disk, is > 1 KB and has a per-file sourceUrl", () => {
    for (const inst of SAMPLE_MANIFEST.instruments) {
      for (const rel of Object.values(inst.notes)) {
        const abs = path.join(SAMPLES_DIR, rel);
        expect(fs.existsSync(abs), `${inst.id}: missing ${rel}`).toBe(true);
        expect(fs.statSync(abs).size, `${inst.id}: ${rel} too small`).toBeGreaterThan(1024);
        expect(inst.files[rel]?.sourceUrl, `${inst.id}: ${rel} has no sourceUrl`).toMatch(/^https:\/\/(tonejs\.github\.io|raw\.githubusercontent\.com\/sgossner\/VSCO-2-CE)\//);
        expect(rel, "file names must be URL-safe (no '#')").not.toMatch(/[#?\s]/);
      }
    }
  });

  it("total public/samples size is within the 45 MB budget", () => {
    let total = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    };
    walk(SAMPLES_DIR);
    expect(total).toBeGreaterThan(5 * 1024 * 1024); // a real library, not stubs
    expect(total).toBeLessThanOrEqual(45 * 1024 * 1024);
  });

  it("no orphan files on disk outside the manifest", () => {
    const orphans: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name !== "manifest.json") {
          const rel = path.relative(SAMPLES_DIR, p).split(path.sep).join("/");
          if (!allFiles.has(rel)) orphans.push(rel);
        }
      }
    };
    walk(SAMPLES_DIR);
    expect(orphans).toEqual([]);
  });

  it("one processed WAV per VSCO instrument decodes to finite, non-silent audio of the expected length", () => {
    for (const inst of SAMPLE_MANIFEST.instruments) {
      const wavs = Object.values(inst.notes).filter((f) => f.endsWith(".wav"));
      if (inst.license === "CC0-1.0") expect(wavs.length, `${inst.id} has no wav`).toBeGreaterThan(0);
      for (const rel of [wavs[0], wavs[wavs.length - 1]].filter(Boolean) as string[]) {
        const buf = fs.readFileSync(path.join(SAMPLES_DIR, rel));
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const { info, channelData } = decodeWavSamples(ab);
        expect(info.sampleRate, rel).toBe(SAMPLE_MANIFEST.sampleRate);
        expect(info.channels, rel).toBe(1);
        expect(info.bitDepth, rel).toBe(16);
        const expectedSec = inst.files[rel]!.durationSec!;
        expect(Math.abs(info.durationSec - expectedSec), `${rel} duration ${info.durationSec} vs manifest ${expectedSec}`).toBeLessThan(0.01);
        expect(info.durationSec, `${rel} too short`).toBeGreaterThan(0.2);
        expect(info.durationSec, `${rel} over the 3.5 s cap`).toBeLessThanOrEqual(3.51);
        const ch = channelData[0]!;
        let peak = 0, sumSq = 0, finite = true;
        for (let i = 0; i < ch.length; i++) {
          const v = ch[i]!;
          if (!Number.isFinite(v)) finite = false;
          peak = Math.max(peak, Math.abs(v));
          sumSq += v * v;
        }
        expect(finite, `${rel} has non-finite samples`).toBe(true);
        expect(peak, `${rel} peak`).toBeGreaterThan(0.05);
        expect(peak, `${rel} clips`).toBeLessThanOrEqual(1);
        expect(Math.sqrt(sumSq / ch.length), `${rel} RMS (silent?)`).toBeGreaterThan(0.002);
        // leading silence was trimmed: something audible within the first 20 ms
        const firstLoud = ch.findIndex((v) => Math.abs(v) > peak * 0.01);
        expect(firstLoud / info.sampleRate, `${rel} leading silence`).toBeLessThan(0.02);
        // faded out: the last 2 ms are near zero
        const tail = ch.subarray(ch.length - Math.round(info.sampleRate * 0.002));
        expect(Math.max(...Array.from(tail, Math.abs)), `${rel} not faded`).toBeLessThan(0.02);
      }
    }
  });

  it("Salamander files are real mp3 data", () => {
    const piano = SAMPLE_MANIFEST.instruments.find((i) => i.id === "grand-piano")!;
    expect(Object.keys(piano.notes).length).toBe(30);
    for (const rel of Object.values(piano.notes)) {
      const b = fs.readFileSync(path.join(SAMPLES_DIR, rel));
      const id3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
      const sync = b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
      expect(id3 || sync, `${rel} is not mp3`).toBe(true);
    }
  });
});

describe("sampled loader (node-safe parts)", () => {
  it("sample URLs live under BASE_URL/samples and are encoded", () => {
    expect(sampleUrl("vsco/harp/A4.wav")).toBe("/samples/vsco/harp/A4.wav");
    expect(sampleUrl("salamander/Ds1.mp3").endsWith("/samples/salamander/Ds1.mp3")).toBe(true);
  });

  it("finds only the sampled sets a project uses; projects without them resolve immediately", async () => {
    const ch = (synthId: string) => ({ instrument: { type: "synth" as const, synthId, presetId: "x", params: {} } });
    const project = { channels: [ch("sampled-grand-piano"), ch("subtractive"), ch("sampled-harp"), ch("sampled-grand-piano"), ch("sampled-nope")] } as any;
    expect(sampledInstrumentIdsInProject(project).sort()).toEqual(["grand-piano", "harp"]);
    await expect(ensureSampledInstrumentsLoaded({ channels: [ch("fm")] } as any)).resolves.toBe(true);
    expect(getSampleSetState("grand-piano")).toBe("idle"); // nothing fetched for an unrelated project
  });
});
