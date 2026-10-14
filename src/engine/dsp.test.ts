import { describe, it, expect } from "vitest";
import { DRUM_KITS, FACTORY_SAMPLES, getKitSound } from "./kits";
import { FACTORY_RATE, synthKick, mulberry32, resampleLinear } from "./dsp";
import { computePeaks, detectTransients, detectSilence, estimateBpm, isNonSilent, normalizeBuffer, nearestZeroCrossing, estimateKey } from "./analysis";

describe("factory sound synthesis", () => {
  it("all kits render all 18 roles, non-silent, bounded, finite", () => {
    expect(DRUM_KITS.length).toBeGreaterThanOrEqual(4); // spec minimum; expansion kits welcome
    for (const kit of DRUM_KITS) {
      expect(kit.sounds).toHaveLength(18);
      for (const s of kit.sounds) {
        const data = s.render();
        expect(data.length).toBeGreaterThan(FACTORY_RATE * 0.02);
        expect(isNonSilent(data)).toBe(true);
        for (let i = 0; i < data.length; i += 97) {
          expect(Number.isFinite(data[i])).toBe(true);
          expect(Math.abs(data[i]!)).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });
  it("factory samples all render non-silent", () => {
    expect(FACTORY_SAMPLES.length).toBeGreaterThanOrEqual(18);
    for (const s of FACTORY_SAMPLES) {
      const data = s.render();
      expect(isNonSilent(data)).toBe(true);
    }
  });
  it("synthesis is deterministic", () => {
    const a = synthKick({ tune: 1 });
    const b = synthKick({ tune: 1 });
    expect(a.length).toBe(b.length);
    expect(a[1000]).toBe(b[1000]);
  });
  it("kit sound lookup falls back safely", () => {
    expect(getKitSound("trap-808", "kick").role).toBe("kick");
    expect(getKitSound("nope", "kick").role).toBe("kick");
  });
  it("prng is deterministic", () => {
    const r1 = mulberry32(42), r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe("analysis", () => {
  const rate = 44100;
  it("peaks cover the waveform", () => {
    const data = new Float32Array(rate);
    for (let i = 0; i < rate; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.8;
    const peaks = computePeaks(data, 100);
    expect(peaks).toHaveLength(200);
    expect(peaks[1]).toBeGreaterThan(0.7);
    expect(peaks[0]).toBeLessThan(-0.7);
  });
  it("detects transients of a drum pattern", () => {
    const data = new Float32Array(rate * 2);
    const hits = [0.1, 0.6, 1.1, 1.6];
    for (const h of hits) {
      const start = Math.floor(h * rate);
      for (let i = 0; i < 4000; i++) data[start + i]! += Math.sin((2 * Math.PI * 200 * i) / rate) * Math.exp(-i / 3000);
    }
    const onsets = detectTransients(data, rate);
    expect(onsets.length).toBeGreaterThanOrEqual(3);
    expect(onsets.length).toBeLessThanOrEqual(6);
    expect(Math.abs(onsets[0]! / rate - 0.1)).toBeLessThan(0.05);
  });
  it("detects silence regions", () => {
    const data = new Float32Array(rate * 2);
    for (let i = 0; i < rate * 0.5; i++) data[i] = Math.sin(i / 10) * 0.5;
    for (let i = Math.floor(rate * 1.5); i < rate * 2; i++) data[i] = Math.sin(i / 10) * 0.5;
    const regions = detectSilence(data, rate);
    expect(regions.length).toBe(1);
    expect(regions[0]![0] / rate).toBeCloseTo(0.5, 0);
  });
  it("estimates BPM of a synthetic 120bpm click track", () => {
    const data = new Float32Array(rate * 8);
    for (let beat = 0; beat < 16; beat++) {
      const start = Math.floor(beat * 0.5 * rate);
      for (let i = 0; i < 2000 && start + i < data.length; i++) data[start + i]! += Math.sin((2 * Math.PI * 800 * i) / rate) * Math.exp(-i / 800);
    }
    const bpm = estimateBpm(data, rate);
    expect(bpm).not.toBeNull();
    expect([60, 120, 240]).toContain(Math.round(bpm! / 10) * 10);
  });
  it("returns null BPM for unrhythmic audio", () => {
    const rnd = mulberry32(1);
    const data = new Float32Array(rate);
    for (let i = 0; i < data.length; i++) data[i] = (rnd() - 0.5) * 0.001;
    expect(estimateBpm(data.subarray(0, 1000), rate)).toBeNull();
  });
  it("estimates key of a C major arpeggio approximately", () => {
    const data = new Float32Array(rate * 4);
    const freqs = [261.63, 329.63, 392.0];
    for (let i = 0; i < data.length; i++) {
      const f = freqs[Math.floor(i / rate) % 3]!;
      data[i] = Math.sin((2 * Math.PI * f * i) / rate) * 0.5;
    }
    const key = estimateKey(data, rate);
    expect(key).toMatch(/C major|A minor|E minor|G major/);
  });
  it("normalize hits target peak", () => {
    const data = new Float32Array([0.1, -0.2, 0.05]);
    const out = normalizeBuffer(data, 0.98);
    expect(Math.max(...Array.from(out).map(Math.abs))).toBeCloseTo(0.98, 5);
  });
  it("zero crossing finder", () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = Math.sin((2 * Math.PI * 10 * i) / 1000);
    const zc = nearestZeroCrossing(data, 30);
    expect(Math.abs(data[zc]!)).toBeLessThan(0.07);
  });
  it("resample changes length proportionally", () => {
    const data = new Float32Array(1000).fill(0.5);
    expect(resampleLinear(data, 44100, 22050).length).toBe(500);
  });
});
