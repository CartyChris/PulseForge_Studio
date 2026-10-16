/**
 * Chord progression library + a strict roman-numeral voicer.
 *
 * Numerals are read relative to the progression's own mode (major: I ii iii IV V vi vii°,
 * minor: i ii° III iv v VI VII). Case sets the quality explicitly — UPPER = major, lower = minor —
 * so borrowed chords work: "iv" in a major progression is a minor iv, "bVII" is a flat-seven major,
 * "V7" in minor is the harmonic-minor dominant. Suffixes: 7, maj7, 9, add9, sus2, sus4, °/dim, +/aug.
 */
import type { Note } from "./project";
import { TICKS_PER_STEP } from "./time";

export type ProgressionMode = "major" | "minor";
export interface Progression {
  id: string;
  name: string;
  mode: ProgressionMode;
  numerals: string[];
  moods: string[];
  /** where you hear it (style, not specific songs) */
  styles: string[];
}

const p = (id: string, name: string, mode: ProgressionMode, numerals: string, moods: string, styles: string): Progression =>
  ({ id, name, mode, numerals: numerals.split(/\s+/), moods: moods.split(","), styles: styles.split(",") });

export const PROGRESSIONS: Progression[] = [
  // ── major ──
  p("pop-axis", "Pop Axis", "major", "I V vi IV", "uplifting,anthemic", "pop,rock,edm"),
  p("sensitive", "Sensitive Female", "major", "vi IV I V", "emotional,hopeful", "pop,trap,rnb"),
  p("doo-wop", "Doo-Wop / 50s", "major", "I vi IV V", "nostalgic,sweet", "soul,pop,oldies"),
  p("royal-road", "Royal Road", "major", "IV V iii vi", "bittersweet,cinematic", "j-pop,anime,lofi"),
  p("canon", "Canon Walk", "major", "I V vi iii IV I IV V", "classic,warm", "pop,orchestral"),
  p("jazz-251", "ii–V–I", "major", "ii7 V7 Imaj7 Imaj7", "smooth,jazzy", "jazz,lofi,neo-soul"),
  p("neo-soul-1", "Neo-Soul Climb", "major", "IVmaj7 iii7 ii7 Imaj7", "silky,laid-back", "neo-soul,rnb,lofi"),
  p("gospel", "Gospel Lift", "major", "I IV I/3 IV V vi", "uplifting,spiritual", "gospel,rnb"),
  p("mixolydian-rock", "Mixolydian Rock", "major", "I bVII IV I", "bold,classic", "rock,funk"),
  p("borrowed-iv", "Borrowed Minor Four", "major", "I iii IV iv", "tender,nostalgic", "ballad,indie,pop"),
  p("plagal", "Plagal Shine", "major", "I IV I IV", "bright,simple", "country,pop,reggae"),
  p("happy-island", "Island Bounce", "major", "I IV V IV", "sunny,carefree", "reggae,dancehall,afrobeats"),
  p("lofi-cozy", "Cozy Lo-Fi", "major", "Imaj7 vi7 ii7 V7", "cozy,mellow", "lofi,jazz-hop"),
  p("dreamy-maj9", "Dreamy Ninths", "major", "Imaj7 IVmaj7 Imaj7 IVmaj7", "floating,dreamy", "lofi,rnb,ambient"),
  p("rnb-turn", "R&B Turnaround", "major", "ii7 iii7 IVmaj7 V7", "smooth,romantic", "rnb,neo-soul"),
  p("ascending", "Ascending Hope", "major", "IV V vi V", "rising,hopeful", "edm,pop,cinematic"),
  p("afro-major", "Afro Major Loop", "major", "I vi ii V", "joyful,dance", "afrobeats,highlife"),
  p("country-roads", "Back Roads", "major", "I V IV I", "homey,open", "country,folk"),
  p("bossa-major", "Bossa Changes", "major", "Imaj7 ii7 iii7 bIIImaj7", "breezy,sophisticated", "bossa,jazz"),
  p("synthwave-major", "Neon Drive", "major", "vi IV V iii", "retro,driving", "synthwave,80s"),
  p("sus-pad", "Suspended Glow", "major", "Isus2 IVsus2 vi Vsus4", "airy,open", "ambient,worship,pop"),
  p("house-maj", "House Piano", "major", "IVmaj7 V7 iii7 vi7", "euphoric,warm", "house,garage"),
  p("blues-12", "12-Bar Blues", "major", "I7 IV7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7", "gritty,soulful", "blues,rock,funk"),
  p("gospel-turn", "Church Turnaround", "major", "I vi ii V7", "warm,soulful", "gospel,soul"),
  // ── minor ──
  p("andalusian", "Andalusian Cadence", "minor", "i VII VI V", "dramatic,flamenco", "latin,trap,cinematic"),
  p("epic-minor", "Epic Minor", "minor", "i VI III VII", "epic,dark", "trap,drill,edm,rock"),
  p("sad-trap", "Sad Trap", "minor", "i iv VI V", "sad,moody", "trap,emo-rap"),
  p("drill-dark", "Drill Menace", "minor", "i VI VII i", "menacing,cold", "drill,trap"),
  p("phrygian-dark", "Phrygian Dark", "minor", "i bII i bII", "sinister,tense", "phonk,metal,drill"),
  p("aeolian-loop", "Aeolian Loop", "minor", "i VII VI VII", "brooding,hypnotic", "trap,phonk,techno"),
  p("minor-251", "Minor ii–V–i", "minor", "ii° V7 i i", "noir,jazzy", "jazz,lofi,boom-bap"),
  p("boom-bap-minor", "Boom Bap Minor", "minor", "i7 iv7 i7 v7", "dusty,soulful", "boom-bap,lofi"),
  p("dorian-groove", "Dorian Groove", "minor", "i7 IV7 i7 IV7", "funky,cool", "funk,neo-soul,house"),
  p("harmonic-minor", "Harmonic Minor Tension", "minor", "i iv V7 i", "classical,tense", "drill,trap,cinematic"),
  p("lament", "Lament Bass", "minor", "i v/7 VI V", "melancholy,classical", "cinematic,trap"),
  p("rnb-minor", "Late-Night R&B", "minor", "i7 VImaj7 iv7 v7", "sultry,late-night", "rnb,trap-soul"),
  p("reggaeton-minor", "Reggaeton Minor", "minor", "i VI III VII", "sexy,dance", "reggaeton,latin pop"),
  p("afro-minor", "Afro Minor", "minor", "i iv VII III", "groovy,warm", "afrobeats,amapiano"),
  p("synthwave-minor", "Night Drive", "minor", "i VI VII v", "retro,dark", "synthwave,darkwave"),
  p("techno-stab", "Minor Stab", "minor", "i i VI VII", "driving,hypnotic", "techno,house"),
  p("emotional-minor", "Emotional Rise", "minor", "VI VII i i", "emotional,cinematic", "trap,pop,edm"),
  p("memphis-minor", "Memphis Tape", "minor", "i bII VII i", "eerie,lo-fi", "phonk,memphis"),
  p("screw-minor", "Screwed Soul", "minor", "i7 VImaj7 VII7 i7", "syrupy,hazy", "chopped & screwed,houston"),
  p("dnb-minor", "Liquid Minor", "minor", "i7 VImaj7 III7 VII7", "liquid,flowing", "dnb,liquid"),
  p("two-chord", "Two-Chord Vamp", "minor", "i VII", "hypnotic,minimal", "drill,afro,funk"),
  p("dubstep-minor", "Wobble Minor", "minor", "i i iv VI", "heavy,dark", "dubstep,riddim"),
  p("ballad-minor", "Minor Ballad", "minor", "i III VII iv", "tender,longing", "ballad,rnb"),
  p("jersey-minor", "Club Minor", "minor", "i VI III V", "bouncy,urgent", "jersey club,baltimore"),
];

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const ROMANS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];

export interface ParsedChord { rootPc: number; intervals: number[]; bassPc: number | null; label: string }

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/**
 * Parse one numeral (e.g. "bVII", "iv7", "Imaj7", "ii°", "V7", "I/3") in a key.
 * Returns the chord's root pitch class, its intervals above the root, and an optional bass note.
 */
export function parseNumeral(numeral: string, keyPc: number, mode: ProgressionMode): ParsedChord | null {
  const [main, slash] = numeral.split("/");
  // longest numerals first, or "iv" would parse as "i" + suffix "v"
  const m = /^([b#♭♯]?)(vii|vi|v|iv|iii|ii|i|VII|VI|V|IV|III|II|I)(.*)$/.exec(main ?? "");
  if (!m) return null;
  const acc = m[1] === "b" || m[1] === "♭" ? -1 : m[1] === "#" || m[1] === "♯" ? 1 : 0;
  const roman = m[2]!;
  const degree = ROMANS.indexOf(roman.toLowerCase());
  if (degree < 0) return null;
  const steps = mode === "major" ? MAJOR_STEPS : MINOR_STEPS;
  const rootPc = (((keyPc + steps[degree]! + acc) % 12) + 12) % 12;
  const upper = roman === roman.toUpperCase();
  const suffix = m[3] ?? "";
  let third = upper ? 4 : 3, fifth = 7;
  if (/°|dim/.test(suffix)) { third = 3; fifth = 6; }
  if (/\+|aug/.test(suffix)) { third = 4; fifth = 8; }
  let intervals = [0, third, fifth];
  if (/sus2/.test(suffix)) intervals = [0, 2, 7];
  if (/sus4/.test(suffix)) intervals = [0, 5, 7];
  if (/maj7/.test(suffix)) intervals.push(11);
  else if (/7/.test(suffix)) intervals.push(/°|dim/.test(suffix) ? 9 : 10);
  if (/maj9/.test(suffix)) intervals.push(11, 14);
  else if (/9/.test(suffix) && !/add9/.test(suffix)) intervals.push(10, 14);
  if (/add9/.test(suffix)) intervals.push(14);
  // slash: "I/3" = 3rd of the chord in the bass; "v/7" = a scale degree (7th) in the bass
  let bassPc: number | null = null;
  if (slash) {
    const n = Number(slash);
    if (n === 3) bassPc = (rootPc + intervals[1]!) % 12;
    else if (n === 5) bassPc = (rootPc + intervals[2]!) % 12;
    else if (n >= 1 && n <= 7) bassPc = (keyPc + steps[n - 1]!) % 12;
  }
  const quality = intervals[1] === 3 && intervals[2] === 6 ? "dim" : intervals[1] === 3 ? "m" : intervals[2] === 8 ? "aug" : intervals[1] === 2 ? "sus2" : intervals[1] === 5 ? "sus4" : "";
  const ext = /maj7/.test(suffix) ? "maj7" : /maj9/.test(suffix) ? "maj9" : /add9/.test(suffix) ? "add9" : /9/.test(suffix) ? "9" : /7/.test(suffix) ? "7" : "";
  const label = `${NAMES[rootPc]}${quality}${ext}${bassPc !== null ? `/${NAMES[bassPc]}` : ""}`;
  return { rootPc, intervals, bassPc, label };
}

export type ChordRhythm = "whole" | "half" | "stabs" | "pulse8" | "arp";
export const CHORD_RHYTHMS: Array<{ id: ChordRhythm; name: string }> = [
  { id: "whole", name: "Held chords" }, { id: "half", name: "Two per bar" }, { id: "stabs", name: "Stabs (offbeat)" },
  { id: "pulse8", name: "8th pulse" }, { id: "arp", name: "Arpeggio (16ths)" },
];

/**
 * Write a progression as piano-roll notes: one chord per `barsPerChord` bar(s), close-voiced around
 * middle C (voice-led: each chord's inversion is chosen to stay near the previous one), with an
 * optional bass note an octave below.
 */
export function progressionNotes(prog: Progression, keyPc: number, opts: { barsPerChord?: number; rhythm?: ChordRhythm; bass?: boolean; velocity?: number } = {}): { notes: Array<Omit<Note, "id">>; labels: string[]; lengthSteps: number } {
  const barsPer = opts.barsPerChord ?? 1;
  const rhythm = opts.rhythm ?? "whole";
  const vel = opts.velocity ?? 0.78;
  const bar = 16 * TICKS_PER_STEP;
  const notes: Array<Omit<Note, "id">> = [];
  const labels: string[] = [];
  let prevCenter = 62;
  prog.numerals.forEach((num, ci) => {
    const ch = parseNumeral(num, keyPc, prog.mode);
    if (!ch) return;
    labels.push(ch.label);
    // voice: choose the inversion whose average pitch is closest to the previous chord
    const pcs = ch.intervals.map((iv) => ch.rootPc + iv);
    let best: number[] = [];
    let bestDist = Infinity;
    for (let inv = 0; inv < pcs.length; inv++) {
      for (const base of [48, 60]) {
        const voiced = pcs.map((pc, k) => base + pc + (k < inv ? 12 : 0));
        const center = voiced.reduce((a, b) => a + b, 0) / voiced.length;
        const d = Math.abs(center - prevCenter);
        if (voiced.every((v) => v >= 52 && v <= 79) && d < bestDist) { bestDist = d; best = voiced; }
      }
    }
    if (!best.length) best = pcs.map((pc) => 60 + (pc % 12));
    prevCenter = best.reduce((a, b) => a + b, 0) / best.length;
    const start = ci * barsPer * bar;
    const len = barsPer * bar;
    const hits: Array<[number, number]> = rhythm === "whole" ? [[0, len]]
      : rhythm === "half" ? Array.from({ length: barsPer * 2 }, (_, k) => [k * bar / 2, bar / 2 - 6] as [number, number])
      : rhythm === "stabs" ? Array.from({ length: barsPer * 4 }, (_, k) => [k * bar / 4 + bar / 8, bar / 8] as [number, number])
      : rhythm === "pulse8" ? Array.from({ length: barsPer * 8 }, (_, k) => [k * bar / 8, bar / 8 - 4] as [number, number])
      : [];
    if (rhythm === "arp") {
      const seq = [...best, best[1]! + 12, ...best.slice().reverse()];
      for (let k = 0; k < barsPer * 16; k++) notes.push({ pitch: seq[k % seq.length]!, startTick: start + k * TICKS_PER_STEP, lengthTicks: TICKS_PER_STEP - 2, velocity: vel * (k % 4 === 0 ? 1 : 0.8), pan: 0, probability: 1 });
    } else {
      for (const [off, dur] of hits) for (const pitch of best) notes.push({ pitch, startTick: start + off, lengthTicks: Math.max(6, dur), velocity: vel, pan: 0, probability: 1 });
    }
    if (opts.bass) notes.push({ pitch: 36 + ((ch.bassPc ?? ch.rootPc) % 12), startTick: start, lengthTicks: len - 6, velocity: vel, pan: 0, probability: 1 });
  });
  const lengthSteps = Math.min(256, Math.max(16, prog.numerals.length * barsPer * 16));
  return { notes, labels, lengthSteps };
}
