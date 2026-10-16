/**
 * Groove library: named drum patterns by style, written as step grids (16 chars = 1 bar of 16ths,
 * 32 = 2 bars). Cells: "x" hit · "X" accent · "o" soft · "g" ghost · "r"/"R" ratchet (2/3 hits) · "." rest.
 * Rows use the kit roles every PulseForge drum kit provides (shared/composition DRUM_ROLES), so a
 * groove loads on any kit. Patterns are written for this library in the style of each genre —
 * rhythms, not transcriptions of any recording.
 */
import type { DrumRole } from "./composition";
import { parseGrid } from "./producer";
import type { Step } from "./project";

export interface Groove {
  id: string;
  name: string;
  category: GrooveCategory;
  /** suggested tempo */
  bpm: number;
  /** 0…0.75, applied to the pattern */
  swing: number;
  /** suggested kit id (any kit works) */
  kit: string;
  rows: Partial<Record<DrumRole, string>>;
  tip?: string;
}

export const GROOVE_CATEGORIES = [
  "Boom Bap & Golden Era", "Trap", "Drill", "Memphis, Phonk & Houston", "Lo-Fi & Jazz", "R&B & Neo-Soul",
  "Funk, Breaks & Pop", "House & Garage", "Techno & Electro", "Drum & Bass, Jungle", "Latin, Afro & Caribbean",
  "Club & Footwork", "Half-time & Dubstep",
] as const;
export type GrooveCategory = (typeof GROOVE_CATEGORIES)[number];

const g = (id: string, name: string, category: GrooveCategory, bpm: number, swing: number, kit: string, rows: Groove["rows"], tip?: string): Groove => ({ id, name, category, bpm, swing, kit, rows, tip });

export const GROOVES: Groove[] = [
  // ── Boom Bap & Golden Era ──────────────────────────────────────────────────────────────────
  g("bb-classic", "Classic Boom Bap", "Boom Bap & Golden Era", 90, 0.55, "boom-bap", {
    kick: "x.........x.....|x.x.......x.....", snare: "....x.......x...|....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x." }),
  g("bb-dusty", "Dusty Ghost Snares", "Boom Bap & Golden Era", 88, 0.6, "boom-bap", {
    kick: "x......x..x.....|x......x.x......", snare: "....X..g....X...|....X..g....X.g.", "hat-closed": "x.xox.xox.xox.xo|x.xox.xox.xox.xo" }, "Ghost snares are what make it breathe; keep them quiet."),
  g("bb-east", "East Coast Knock", "Boom Bap & Golden Era", 94, 0.5, "boom-bap", {
    kick: "x.x.......x..x..|x.x.......x.....", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", "hat-open": "..............o." }),
  g("bb-sp", "SP Swing Chop Beat", "Boom Bap & Golden Era", 92, 0.62, "boom-bap", {
    kick: "x.....x...x.....|x.....x..x......", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", rimshot: ".......g.......g" }, "Pairs well with the SP-1200 sampler character."),
  g("bb-dilla", "Drunk Swing (Dilla-style)", "Boom Bap & Golden Era", 86, 0.7, "boom-bap", {
    kick: "x......x.x......|x.......xx......", snare: "....x.......x...", "hat-closed": "xox.xoxxxox.xoxx", clap: "............x..." }, "Max swing plus a humanize pass on the hats gives the unquantized lean."),
  g("bb-west", "West Coast Bounce", "Boom Bap & Golden Era", 96, 0.35, "modern-hiphop", {
    kick: "x..x......x..x..", clap: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", tambourine: "....x.......x..." }),
  g("bb-bap-break", "Boom Bap Break Fill", "Boom Bap & Golden Era", 90, 0.55, "boom-bap", {
    kick: "x.........x.....|x.....x...x.x...", snare: "....x.......x...|....x..g.g..xgxx", "hat-closed": "x.x.x.x.x.x.x.x.|x.x.x.x.x.x....." }, "Bar 2 ends with a snare fill into the next loop."),
  g("bb-griselda", "Sparse Grimy Loop", "Boom Bap & Golden Era", 84, 0.4, "boom-bap", {
    kick: "x.........x.....", snare: "....x.......x...", rimshot: "..g.......g....." }, "Almost nothing, so the sample carries the beat."),

  // ── Trap ───────────────────────────────────────────────────────────────────────────────────
  g("trap-atl", "ATL Trap", "Trap", 140, 0, "trap-808", {
    kick: "x.........x.....|x......x..x.....", "kick-808": "x.........x.....|x......x..x.....", snare: "........x.......", "hat-closed": "x.x.x.x.x.x.xRx.|x.x.x.xrx.x.x.x." }, "Rolls (R/r) on the hats are the signature: vary them every bar."),
  g("trap-rolls", "Triplet Hat Rolls", "Trap", 145, 0, "trap-808", {
    kick: "x......x..x.....", snare: "........x.......", "hat-closed": "xxRxxxxRxxxxxxRR", "hat-open": "......o........." }),
  g("trap-dark", "Dark Trap Bounce", "Trap", 136, 0, "trap-808", {
    kick: "x.....x...x.....|x.x.......x...x.", snare: "........x.......", clap: "........x.......", "hat-closed": "x.x.x.x.xxx.x.x.", perc: "...o.......o...." }),
  g("trap-rage", "Rage / Distorted", "Trap", 150, 0, "trap-808", {
    kick: "x.x...x...x.x...", "kick-808": "x.x...x...x.x...", snare: "........x.......", "hat-closed": "x.x.x.x.x.x.x.x.", crash: "x..............." }, "Distort the 808 hard; let the kick and 808 hit together."),
  g("trap-plugg", "Plugg Bounce", "Trap", 150, 0, "trap-808", {
    kick: "x.......x.x.....", snare: "........x.......", "hat-closed": "x...x...x...x...", clap: "........x......." }, "Sparse hats, airy melodies: half the notes of normal trap."),
  g("trap-hard", "Hard Trap Half-Time", "Trap", 142, 0, "trap-808", {
    kick: "x.........x..x..|x.....x...x.....", snare: "........x.......", "hat-closed": "x.x.x.x.x.x.x.x.|x.x.x.x.xRx.x.R.", "hat-open": "..............o." }),
  g("trap-melodic", "Melodic Trap", "Trap", 130, 0, "trap-808", {
    kick: "x......x..x.....", snare: "........x.......", "hat-closed": "x.xxx.x.x.xxx.x.", snap: "........x......." }),
  g("trap-memphis-roll", "Trap with Cowbell Accents", "Trap", 140, 0, "trap-808", {
    kick: "x.........x.....", snare: "........x.......", "hat-closed": "x.x.x.x.x.x.x.x.", cowbell: "x..x..x...x..x.." }),

  // ── Drill ──────────────────────────────────────────────────────────────────────────────────
  g("drill-uk", "UK Drill", "Drill", 142, 0, "drill-uk", {
    kick: "x.........x..x..", snare: "........x.....x.|.......xx.......", "hat-closed": "x..x..x.x..x..x.|x..x..x.x.x..x.." }, "Snares off the grid and skippy hats are the drill feel."),
  g("drill-ny", "NY / Brooklyn Drill", "Drill", 144, 0, "drill-uk", {
    kick: "x.....x...x.....|x.......x.x.....", snare: "........x.......|........x....x..", "hat-closed": "x..x..x...x..x..|x..x..x..x..x.x.", perc: "..o.......o....." }),
  g("drill-chicago", "Chicago Drill", "Drill", 135, 0, "drill-uk", {
    kick: "x.........x.....|x.....x...x.....", snare: "........x.......", "hat-closed": "x.x.xRx.x.x.xRx.", clap: "........x......." }),
  g("drill-jersey", "Jersey Drill", "Drill", 144, 0, "drill-uk", {
    kick: "x.....x...x...x.", snare: "........x.......", "hat-closed": "x..x..x.x..x..x.", clap: "....x.......x..." }),

  // ── Memphis, Phonk & Houston ─────────────────────────────────────────────────────────────────
  g("memphis-tape", "Memphis Tape (90s)", "Memphis, Phonk & Houston", 70, 0.15, "phonk", {
    kick: "x.....x...x.....|x.....x.x.......", snare: "....x.......x...", cowbell: "x.x.x.x.x.x.x.x.", "hat-closed": "..x...x...x...x." }, "Run it through the Cassette character for the tape-dub sound."),
  g("phonk-drift", "Drift Phonk", "Memphis, Phonk & Houston", 140, 0, "phonk", {
    kick: "x.....x.x.....x.", snare: "....x.......x...", cowbell: "x..x..x.x..x..x.", "hat-closed": "x.x.x.x.x.x.x.x." }),
  g("phonk-house", "Brazilian Phonk", "Memphis, Phonk & Houston", 130, 0, "phonk", {
    kick: "x...x...x...x...", snare: "....x.......x...", cowbell: "..x...x...x...xx", "hat-open": "..o...o...o...o." }),
  g("houston-screw", "Houston Screwed (slow)", "Memphis, Phonk & Houston", 66, 0.1, "trap-808", {
    kick: "x.........x.....|x.......x.x.....", snare: "....x.......x...", "hat-closed": "x...x...x...x...", clap: "....x.......x..." }, "Build it at ~85 BPM, then Screw the song to 0.78× for the real thing."),
  g("houston-chop", "Chopped Bounce", "Memphis, Phonk & Houston", 70, 0.12, "trap-808", {
    kick: "x.....x...x.....|x.....x...x...xx", snare: "....x.......x...|....x.......x.xx", "hat-closed": "x.x.x.x.x.x.x.x." }, "The doubled hits at the end of bar 2 imitate a DJ chop."),
  g("memphis-cowbell", "Cowbell Rattle", "Memphis, Phonk & Houston", 72, 0.1, "phonk", {
    kick: "x.........x.....", snare: "....x.......x...", cowbell: "xxx.xxx.xxx.xxx.", "hat-closed": "x.x.x.x.x.x.x.x." }),

  // ── Lo-Fi & Jazz ─────────────────────────────────────────────────────────────────────────────
  g("lofi-study", "Lo-Fi Study Beat", "Lo-Fi & Jazz", 78, 0.55, "lofi-dust", {
    kick: "x.........x.....|x......x..x.....", snare: "....x.......x...", "hat-closed": "x.xox.xox.xox.xo", rimshot: "..........g....." }, "Add the SP-404 Vinyl character on the drum bus."),
  g("lofi-lazy", "Lazy Sunday", "Lo-Fi & Jazz", 72, 0.65, "lofi-dust", {
    kick: "x......x..x.....", snare: "....x.......x..g", "hat-closed": "x.x.x.x.x.x.x.x.", shaker: "oooooooooooooooo" }),
  g("jazz-swing", "Jazz Ride Swing", "Lo-Fi & Jazz", 120, 0.66, "acoustic-essentials", {
    kick: "x.......x.......", ride: "x...x.xx....x.xx", "hat-closed": "....x.......x...", snare: "..........g....g" }, "Ride pattern carries the swing; keep the kick feathered."),
  g("jazz-brush", "Brush Ballad", "Lo-Fi & Jazz", 70, 0.5, "acoustic-essentials", {
    kick: "x.......x.......", snare: "o.o.o.o.o.o.o.o.", rimshot: "....x.......x..." }),

  // ── R&B & Neo-Soul ───────────────────────────────────────────────────────────────────────────
  g("rnb-90s", "90s R&B Groove", "R&B & Neo-Soul", 92, 0.3, "rnb", {
    kick: "x..x......x.....|x..x....x.x.....", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", snap: "....x.......x..." }),
  g("rnb-modern", "Modern R&B", "R&B & Neo-Soul", 70, 0.2, "rnb", {
    kick: "x.....x...x.....", snare: "........x.......", "hat-closed": "x.xxx.x.x.xxx.xR", snap: "........x......." }),
  g("neosoul", "Neo-Soul Pocket", "R&B & Neo-Soul", 84, 0.62, "rnb", {
    kick: "x......x.x......|x.......x.x....x", snare: "....x..g....x...", "hat-closed": "xoxoxoxoxoxoxoxo", rimshot: "..g.......g....." }),
  g("rnb-slowjam", "Slow Jam", "R&B & Neo-Soul", 64, 0.25, "rnb", {
    kick: "x.......x.x.....", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", "hat-open": ".......o.......o" }),

  // ── Funk, Breaks & Pop ───────────────────────────────────────────────────────────────────────
  g("funk-drummer", "Funky Drummer-style", "Funk, Breaks & Pop", 100, 0.2, "acoustic-essentials", {
    kick: "x.x...x...x..x..", snare: "....x..g.g..x..g", "hat-closed": "xxxxxxxoxxxxxxxx", "hat-open": ".......o........" }, "A 16th-note hat with ghost snares between the backbeats."),
  g("think-style", "Think Break-style", "Funk, Breaks & Pop", 110, 0.15, "acoustic-essentials", {
    kick: "x.........x.x...", snare: "....x..x.x..x...", "hat-closed": "x.x.x.x.x.x.x.x." }),
  g("amen-style", "Amen-style Break", "Funk, Breaks & Pop", 136, 0, "acoustic-essentials", {
    kick: "x.x.......xx....|x.x.......x.....", snare: "....x..x.x..x..x|....x..x.x....x.", ride: "x.x.x.x.x.x.x.x.", crash: "................|..........x....." }, "Chop it and pitch it up for jungle."),
  g("pop-four", "Pop Four-on-the-Floor", "Funk, Breaks & Pop", 120, 0, "pop", {
    kick: "x...x...x...x...", clap: "....x.......x...", "hat-closed": "..x...x...x...x.", tambourine: "x.x.x.x.x.x.x.x." }),
  g("pop-ballad", "Pop Ballad", "Funk, Breaks & Pop", 76, 0, "pop", {
    kick: "x.......x.x.....", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", crash: "x..............." }),
  g("rock-basic", "Rock Beat", "Funk, Breaks & Pop", 118, 0, "acoustic-essentials", {
    kick: "x.......x.x.....", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", crash: "x..............." }),

  // ── House & Garage ───────────────────────────────────────────────────────────────────────────
  g("house-classic", "Classic House", "House & Garage", 124, 0.1, "house", {
    kick: "x...x...x...x...", clap: "....x.......x...", "hat-open": "..x...x...x...x.", "hat-closed": "x.x.x.x.x.x.x.x." }),
  g("house-deep", "Deep House", "House & Garage", 122, 0.2, "house", {
    kick: "x...x...x...x...", clap: "....x.......x...", "hat-closed": "..x...x...x..xx.", shaker: "xoxoxoxoxoxoxoxo", rimshot: "...g......g....." }),
  g("house-tech", "Tech House", "House & Garage", 126, 0.05, "house", {
    kick: "x...x...x...x...", clap: "....x.......x...", "hat-open": "..x...x...x...x.", perc: ".x....x..x....x." }),
  g("ukg-2step", "UK Garage 2-Step", "House & Garage", 132, 0.4, "house", {
    kick: "x.........x.....|x......x..x.....", snare: "....x.......x...", "hat-closed": "..x.x.x...x.xxx.", rimshot: "......x.......x." }, "Skip the kick on beat 3: that hole is the 2-step."),
  g("speed-garage", "Speed Garage", "House & Garage", 134, 0.25, "house", {
    kick: "x...x...x...x...", snare: "....x.......x...", "hat-open": "..x...x...x...x.", shaker: "xxxxxxxxxxxxxxxx" }),
  g("amapiano", "Amapiano Log Drum Groove", "House & Garage", 113, 0.3, "afrobeats", {
    kick: "x...x...x...x...", "kick-808": "...x..x.....x...", rimshot: "..x...x..x.x..x.", shaker: "xoxoxoxoxoxoxoxo", clap: "....x.......x..." }, "Use a pitched 808/log-drum sound for the syncopated low hits."),

  // ── Techno & Electro ─────────────────────────────────────────────────────────────────────────
  g("techno-driving", "Driving Techno", "Techno & Electro", 132, 0, "techno", {
    kick: "x...x...x...x...", "hat-open": "..x...x...x...x.", "hat-closed": "xxxxxxxxxxxxxxxx", clap: "....x.......x..." }),
  g("techno-hypno", "Hypnotic Techno", "Techno & Electro", 128, 0, "techno", {
    kick: "x...x...x...x...", perc: "..x..x....x..x..", ride: "..x...x...x...x." }),
  g("electro-808", "Electro Funk 808", "Techno & Electro", 118, 0.1, "classic-808", {
    kick: "x.....x...x.....|x.....x.x.......", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", cowbell: "..x.......x....." }),

  // ── Drum & Bass, Jungle ──────────────────────────────────────────────────────────────────────
  g("dnb-two-step", "DnB Two-Step", "Drum & Bass, Jungle", 174, 0, "dnb", {
    kick: "x.........x.....", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", ride: "..x...x...x...x." }),
  g("dnb-rolling", "Rolling DnB", "Drum & Bass, Jungle", 174, 0, "dnb", {
    kick: "x.........x..x..", snare: "....x..g....x...", "hat-closed": "x.xox.xox.xox.xo", shaker: "xxxxxxxxxxxxxxxx" }),
  g("jungle-chop", "Jungle Chop", "Drum & Bass, Jungle", 165, 0, "dnb", {
    kick: "x.x.......xx....|x.........x.x...", snare: "....x..x.x..x..x|....x..x..x.x.xx", "hat-closed": "x.x.x.x.x.x.x.x." }),
  g("breakbeat", "Big Beat Breakbeat", "Drum & Bass, Jungle", 128, 0.1, "acoustic-essentials", {
    kick: "x.x.......x.....", snare: "....x.......x..x", "hat-closed": "x.x.x.x.x.x.x.x.", crash: "x..............." }),

  // ── Latin, Afro & Caribbean ──────────────────────────────────────────────────────────────────
  g("dembow", "Dembow", "Latin, Afro & Caribbean", 95, 0, "reggaeton", {
    kick: "x...x...x...x...", snare: "...x..x....x..x.", "hat-closed": "x.x.x.x.x.x.x.x." }, "Kick on every beat, snare on the 'and-a' pattern: the reggaeton engine."),
  g("reggaeton-modern", "Modern Reggaeton", "Latin, Afro & Caribbean", 92, 0, "reggaeton", {
    kick: "x...x...x...x...", snare: "...x..x....x..x.", clap: "......x.......x.", shaker: "xoxoxoxoxoxoxoxo", "kick-808": "x.....x.x......." }),
  g("afrobeats", "Afrobeats", "Latin, Afro & Caribbean", 104, 0.3, "afrobeats", {
    kick: "x.....x...x.....", rimshot: "...x..x....x..x.", shaker: "xoxoxoxoxoxoxoxo", "conga-high": "..x.......x..x..", clap: "....x.......x..." }),
  g("afroswing", "Afroswing", "Latin, Afro & Caribbean", 100, 0.4, "afrobeats", {
    kick: "x......x..x.....", snare: "....x.......x...", rimshot: "..x..x....x..x..", "hat-closed": "x.xox.xox.xox.xo" }),
  g("dancehall", "Dancehall One-Drop", "Latin, Afro & Caribbean", 98, 0.2, "dancehall", {
    kick: "........x.......", rimshot: "........x.......", "hat-closed": "x.x.x.x.x.x.x.x.", perc: "..x...x...x...x." }, "Nothing on beat 1 — that's the one-drop."),
  g("dancehall-modern", "Modern Dancehall", "Latin, Afro & Caribbean", 100, 0.15, "dancehall", {
    kick: "x..x..x...x..x..", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", clap: "......x.......x." }),
  g("bossa", "Bossa Nova", "Latin, Afro & Caribbean", 130, 0.1, "acoustic-essentials", {
    kick: "x..x.x..x..x.x..", rimshot: "x..x..x...x..x..", "hat-closed": "x.x.x.x.x.x.x.x." }),
  g("samba", "Samba Groove", "Latin, Afro & Caribbean", 100, 0.2, "world-perc", {
    kick: "x......xx......x", tambourine: "xoxxxoxxxoxxxoxx", agogo: "x.x..x.x..x.x...", "conga-low": "...x.......x...." }),
  g("cumbia", "Cumbia", "Latin, Afro & Caribbean", 96, 0.1, "world-perc", {
    kick: "x.......x.......", "conga-high": "..x...x...x...x.", shaker: "x.xxx.xxx.xxx.xx", cowbell: "x...x...x...x..." }),

  // ── Club & Footwork ──────────────────────────────────────────────────────────────────────────
  g("jersey-club", "Jersey Club", "Club & Footwork", 140, 0, "jersey-club", {
    kick: "x...x...x.x.x...|x...x...x.x.x.x.", clap: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x.", "vox-hey": "..........x....." }, "The triplet-ish kick run (x.x.x) is the bounce."),
  g("baltimore", "Baltimore Club", "Club & Footwork", 130, 0, "jersey-club", {
    kick: "x...x...x...xx.x", snare: "....x.......x...", "hat-closed": "x.x.x.x.x.x.x.x." }),
  g("footwork", "Footwork / Juke", "Club & Footwork", 160, 0, "classic-808", {
    kick: "x..x..x...x..x..|x..x..x..x..x...", clap: "....x.......x...", "hat-closed": "..x...x...x...x.", "tom-low": "...........x..x." }, "Triplet kick patterns at 160: half-time feel, double-time energy."),
  g("bmore-hey", "Club Hey Chant", "Club & Footwork", 135, 0, "jersey-club", {
    kick: "x...x...x...x...", clap: "....x.......x...", "vox-hey": "x.......x.x....." }),

  // ── Half-time & Dubstep ──────────────────────────────────────────────────────────────────────
  g("dubstep", "Dubstep Half-Time", "Half-time & Dubstep", 140, 0, "dubstep", {
    kick: "x.........x.....|x.....x.........", snare: "........x.......", "hat-closed": "..x...x...x...x." }),
  g("future-halftime", "Future Half-Time", "Half-time & Dubstep", 85, 0.1, "dubstep", {
    kick: "x.........x..x..", snare: "........x.......", "hat-closed": "x.xox.xox.xox.xo", perc: "......g.......g." }),
];

export const GROOVE_COUNT = GROOVES.length;
export function getGroove(id: string): Groove | undefined {
  return GROOVES.find((x) => x.id === id);
}

/** Grid length in steps (bars bars × 16), ignoring "|" bar separators. */
export const gridSteps = (grid: string) => grid.replace(/\|/g, "").length;

/**
 * Steps for each row, sized for a pattern: the pattern grows to fit a 2-bar groove (never shrinks),
 * and shorter grids repeat to fill it.
 */
export function grooveToSteps(groove: Groove, patternLengthSteps: number): { lengthSteps: number; rows: Partial<Record<DrumRole, Step[]>> } {
  const longest = Math.max(16, ...Object.values(groove.rows).filter((r): r is string => !!r).map(gridSteps));
  const lengthSteps = Math.min(256, Math.max(patternLengthSteps, Math.ceil(longest / 16) * 16));
  const rows: Partial<Record<DrumRole, Step[]>> = {};
  for (const [role, grid] of Object.entries(groove.rows) as Array<[DrumRole, string | undefined]>) {
    if (!grid) continue;
    rows[role] = parseGrid(grid, lengthSteps).map((h) => ({ index: h.index, velocity: h.velocity, probability: h.probability, micro: h.micro }));
  }
  return { lengthSteps, rows };
}

