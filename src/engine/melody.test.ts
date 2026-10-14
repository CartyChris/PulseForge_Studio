import { describe, it, expect } from "vitest";
import { extractMelody } from "./analysis";

function sine(freq: number, sec: number, rate: number): Float32Array {
  const out = new Float32Array(Math.floor(sec * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

describe("extractMelody (experimental hum-to-MIDI)", () => {
  it("transcribes a three-note sine melody", () => {
    const rate = 44100;
    const a4 = sine(440, 0.4, rate);   // A4 = 69
    const c5 = sine(523.25, 0.4, rate); // C5 = 72
    const e4 = sine(329.63, 0.4, rate); // E4 = 64
    const joined = new Float32Array(a4.length + c5.length + e4.length);
    joined.set(a4, 0); joined.set(c5, a4.length); joined.set(e4, a4.length + c5.length);
    const notes = extractMelody(joined, rate);
    const midis = notes.map((n) => n.midi);
    expect(midis).toContain(69);
    expect(midis).toContain(72);
    expect(midis).toContain(64);
    expect(notes.every((n) => n.durSec > 0.1)).toBe(true);
  });
  it("returns nothing for silence", () => {
    expect(extractMelody(new Float32Array(44100), 44100)).toEqual([]);
  });
});
