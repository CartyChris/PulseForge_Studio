import { describe, it, expect } from "vitest";
import { PROGRESSIONS, parseNumeral, progressionNotes } from "./progressions";

const labels = (id: string, keyPc: number) => progressionNotes(PROGRESSIONS.find((p) => p.id === id)!, keyPc).labels;

describe("progression library", () => {
  it("45+ progressions, unique ids, every numeral parses", () => {
    expect(PROGRESSIONS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(PROGRESSIONS.map((p) => p.id)).size).toBe(PROGRESSIONS.length);
    for (const p of PROGRESSIONS) for (const n of p.numerals) expect(parseNumeral(n, 0, p.mode), `${p.id}: ${n}`).not.toBeNull();
  });
  it("spells the textbook chords", () => {
    expect(labels("pop-axis", 0)).toEqual(["C", "G", "Am", "F"]);
    expect(labels("epic-minor", 9)).toEqual(["Am", "F", "C", "G"]); // A minor: i VI III VII
    expect(labels("andalusian", 9)).toEqual(["Am", "G", "F", "E"]); // major V in minor
    expect(labels("jazz-251", 0)).toEqual(["Dm7", "G7", "Cmaj7", "Cmaj7"]);
    expect(labels("mixolydian-rock", 7)).toEqual(["G", "F", "C", "G"]); // bVII
    expect(labels("borrowed-iv", 0)).toEqual(["C", "Em", "F", "Fm"]); // borrowed minor iv
    expect(labels("phrygian-dark", 4)).toEqual(["Em", "F", "Em", "F"]); // bII
    expect(labels("minor-251", 0)).toEqual(["Ddim", "G7", "Cm", "Cm"]);
    expect(labels("gospel", 0)[2]).toBe("C/E"); // first inversion in the bass
  });
  it("voices chords in a sensible range, voice-led, one per bar by default", () => {
    const { notes, lengthSteps } = progressionNotes(PROGRESSIONS.find((p) => p.id === "pop-axis")!, 0);
    expect(lengthSteps).toBe(64);
    expect(notes).toHaveLength(12);
    for (const n of notes) { expect(n.pitch).toBeGreaterThanOrEqual(52); expect(n.pitch).toBeLessThanOrEqual(79); }
    const centers = [0, 1, 2, 3].map((b) => { const ns = notes.filter((n) => n.startTick === b * 384); return ns.reduce((a, n) => a + n.pitch, 0) / ns.length; });
    for (let i = 1; i < 4; i++) expect(Math.abs(centers[i]! - centers[i - 1]!)).toBeLessThanOrEqual(5); // smooth voice leading
  });
  it("rhythms and bass", () => {
    const prog = PROGRESSIONS.find((p) => p.id === "epic-minor")!;
    expect(progressionNotes(prog, 9, { rhythm: "stabs" }).notes.filter((n) => n.startTick < 384)).toHaveLength(12); // 4 stabs × triad
    expect(progressionNotes(prog, 9, { rhythm: "arp" }).notes.filter((n) => n.startTick < 384)).toHaveLength(16);
    const withBass = progressionNotes(prog, 9, { bass: true }).notes;
    expect(withBass.filter((n) => n.pitch < 48).map((n) => n.pitch % 12)).toEqual([9, 5, 0, 7]);
    expect(progressionNotes(prog, 9, { barsPerChord: 2 }).lengthSteps).toBe(128);
  });
});
