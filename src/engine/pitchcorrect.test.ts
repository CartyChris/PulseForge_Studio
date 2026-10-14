import { describe, it, expect } from "vitest";
import { pitchCorrect, trackF0Frames } from "./analysis";
import { SCALES } from "../../shared/time";

const RATE = 44100;
function sine(freq: number, sec: number): Float32Array {
  const out = new Float32Array(Math.floor(sec * RATE));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}
/** median detected midiFloat of voiced frames */
function medianPitch(data: Float32Array): number {
  const voiced = trackF0Frames(data, RATE).map((f) => f.midiFloat).filter((m): m is number => m !== null).sort((a, b) => a - b);
  return voiced[Math.floor(voiced.length / 2)]!;
}

describe("pitchCorrect (PulseTune, experimental)", () => {
  it("pulls a 40-cent-flat A4 onto A4 at full strength hard-tune", () => {
    const flat = sine(440 * Math.pow(2, -0.4 / 12), 1.0); // ~429.9 Hz, midi ~68.6
    const fixed = pitchCorrect(flat, RATE, { rootPc: 9, scale: SCALES["minor"]!, strength: 1, retuneMs: 0, humanize: 0 });
    expect(Math.abs(medianPitch(fixed) - 69)).toBeLessThan(0.15); // within 15 cents of A4
    expect(Math.abs(medianPitch(flat) - 68.6)).toBeLessThan(0.2); // sanity: input really was flat
  });
  it("strength 0 leaves pitch unchanged", () => {
    const flat = sine(430, 1.0);
    const out = pitchCorrect(flat, RATE, { rootPc: 0, scale: SCALES["major"]!, strength: 0, retuneMs: 0, humanize: 0 });
    expect(Math.abs(medianPitch(out) - medianPitch(flat))).toBeLessThan(0.1);
  });
  it("preserves duration and stays finite/bounded", () => {
    const src = sine(300, 0.5);
    const out = pitchCorrect(src, RATE, { rootPc: 0, scale: SCALES["chromatic"]!, strength: 1, retuneMs: 20, humanize: 0.5 });
    expect(out.length).toBe(src.length);
    let peak = 0;
    for (const v of out) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1.2);
  });
});
