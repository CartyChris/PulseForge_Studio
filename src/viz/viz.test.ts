import { describe, expect, it } from "vitest";
import { bandEnergies, logSpectrum, levels, Envelope, OnsetDetector, normDb } from "./analysis";
import { buildVizIndex, hitsBetween, paletteForKey, roleForChannel, hexToRgb } from "./song";
import { PROJECT_TEMPLATES } from "../storage/projects";
import { TICKS_PER_STEP } from "../../shared/time";

const SR = 48000, FFT = 2048, N = FFT / 2;
/** a dB spectrum that is loud (−20 dB) only around `hz` */
function toneSpectrum(hz: number, width = 3): Float32Array {
  const s = new Float32Array(N).fill(-120);
  const bin = Math.round((hz / (SR / 2)) * N);
  for (let i = Math.max(0, bin - width); i <= Math.min(N - 1, bin + width); i++) s[i] = -20;
  return s;
}

describe("viz analysis", () => {
  it("normDb clamps and handles -Infinity", () => {
    expect(normDb(-Infinity)).toBe(0);
    expect(normDb(0)).toBe(1);
    expect(normDb(-57)).toBeCloseTo(0.5, 1);
  });

  it("puts a 100 Hz tone in the bass band and a 9 kHz tone in the air band", () => {
    const lo = bandEnergies(toneSpectrum(100), SR, FFT);
    expect(lo.bass).toBeGreaterThan(0.1);
    expect(lo.air).toBe(0);
    const hi = bandEnergies(toneSpectrum(9000, 40), SR, FFT);
    expect(hi.air).toBeGreaterThan(0.05);
    expect(hi.bass).toBe(0);
  });

  it("log spectrum maps low tones to low bins and high tones to high bins", () => {
    const out = new Float32Array(64);
    logSpectrum(toneSpectrum(80), SR, out);
    const peakLo = out.indexOf(Math.max(...out));
    logSpectrum(toneSpectrum(8000, 20), SR, out);
    const peakHi = out.indexOf(Math.max(...out));
    expect(peakLo).toBeLessThan(16);
    expect(peakHi).toBeGreaterThan(44);
  });

  it("levels measures rms and peak", () => {
    const b = new Float32Array(1000);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((i / 1000) * Math.PI * 20);
    const l = levels(b);
    expect(l.peak).toBeCloseTo(1, 2);
    expect(l.rms).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("envelope rises fast and falls slow, independent of frame rate", () => {
    const a = new Envelope(0.01, 0.3), b = new Envelope(0.01, 0.3);
    for (let i = 0; i < 60; i++) a.step(1, 1 / 60);
    for (let i = 0; i < 120; i++) b.step(1, 1 / 120);
    expect(a.value).toBeGreaterThan(0.99);
    expect(Math.abs(a.value - b.value)).toBeLessThan(1e-3);
    for (let i = 0; i < 6; i++) a.step(0, 1 / 60); // 100 ms of silence
    expect(a.value).toBeGreaterThan(0.6);
  });

  it("onset detector fires on a new hit, not on a steady tone, and honours the refractory time", () => {
    const d = new OnsetDetector(40, 160);
    const quiet = new Float32Array(N).fill(-120), hit = toneSpectrum(80, 6);
    let t = 0, fires = 0;
    for (let i = 0; i < 30; i++) { if (d.step(quiet, SR, FFT, (t += 1 / 60))) fires++; }
    expect(fires).toBe(0);
    expect(d.step(hit, SR, FFT, (t += 1 / 60))).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) { if (d.step(hit, SR, FFT, (t += 1 / 60))) fires++; } // steady = no flux
    expect(fires).toBe(0);
  });
});

describe("song-aware viz index", () => {
  const project = PROJECT_TEMPLATES.find((t) => t.id === "lofi-tape")!.create();
  // the pattern with the most drum hits
  const drumPat = [...project.patterns].sort((a, b) => Object.values(b.steps).flat().length - Object.values(a.steps).flat().length)[0]!;

  it("classifies kit channels into kick/snare/hat roles", () => {
    const roles = project.channels.map(roleForChannel);
    expect(roles).toContain("kick");
    expect(roles).toContain("snare");
    expect(roles).toContain("hat");
  });

  it("indexes the pattern's hits sorted by tick with channel roles, and a step grid", () => {
    const idx = buildVizIndex(project, "pattern", drumPat.id);
    expect(idx.hits.length).toBeGreaterThan(4);
    for (let i = 1; i < idx.hits.length; i++) expect(idx.hits[i]!.tick).toBeGreaterThanOrEqual(idx.hits[i - 1]!.tick);
    const kickTicks = idx.hits.filter((h) => h.role === "kick").map((h) => h.tick);
    expect(kickTicks).toContain(0);
    expect(idx.grid.rows.length).toBeGreaterThan(0);
    const firstRow = idx.grid.rows.findIndex((r) => r.role === "kick");
    expect(idx.grid.cells[firstRow * 64]).toBeGreaterThan(0);
  });

  it("hitsBetween returns each hit once across frames, including at a loop wrap", () => {
    const idx = buildVizIndex(project, "pattern", drumPat.id);
    const len = idx.endTick;
    let seen = 0, prev = 0;
    for (let t = 7; t <= len * 2; t += 7) { // two passes through the loop, wrapping
      const cur = t % len;
      seen += hitsBetween(idx, prev, cur, 0).length;
      prev = cur;
    }
    expect(seen).toBe(idx.hits.length * 2 - idx.hits.filter((h) => h.tick === 0).length * 0);
  });

  it("a seek (jump of many bars) fires nothing", () => {
    const idx = buildVizIndex(project, "pattern", drumPat.id);
    expect(hitsBetween(idx, 0, TICKS_PER_STEP * 16 * 8)).toEqual([]);
  });

  it("song mode indexes the whole arrangement", () => {
    const song = buildVizIndex(project, "song", null);
    const one = buildVizIndex(project, "pattern", drumPat.id);
    expect(song.endTick).toBeGreaterThan(one.endTick);
    expect(song.hits.length).toBeGreaterThan(one.hits.length);
    expect(new Set(song.hits.map((h) => h.role)).size).toBeGreaterThanOrEqual(4); // drums + bass + music
  });

  it("palettes differ by key and minor keys are cooler", () => {
    const c = paletteForKey("C", "major"), cm = paletteForKey("C", "minor"), g = paletteForKey("G", "major");
    expect(c.hue).not.toBe(cm.hue);
    expect(Math.abs(g.hue - c.hue)).toBe(30);
    for (const v of [...c.a, ...cm.b, ...g.c]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(cm.minor).toBe(true);
  });

  it("hexToRgb parses short and long hex", () => {
    expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#ff0000")).toEqual([1, 0, 0]);
  });
});
