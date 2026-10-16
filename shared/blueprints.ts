/**
 * Song blueprints: arrangement templates that turn one loop into a full song. Each section lists
 * which layers play (drums / bass / music = chords, keys, samples / lead = melodies), so intros strip
 * down, hooks hit with everything, breakdowns drop the drums — the moves producers make by hand.
 */
export const LAYERS = ["drums", "bass", "music", "lead"] as const;
export type Layer = (typeof LAYERS)[number];

export interface BlueprintSection { name: string; bars: number; layers: Layer[] }
export interface Blueprint { id: string; name: string; blurb: string; sections: BlueprintSection[] }

const ALL: Layer[] = ["drums", "bass", "music", "lead"];
const s = (name: string, bars: number, layers: Layer[] = ALL): BlueprintSection => ({ name, bars, layers });

export const BLUEPRINTS: Blueprint[] = [
  { id: "rap-song", name: "Rap Song (~3 min)", blurb: "Intro, hook, two verses, bridge, hook, outro", sections: [
    s("Intro", 8, ["music"]), s("Hook", 8), s("Verse 1", 16, ["drums", "bass", "music"]), s("Hook", 8),
    s("Verse 2", 16, ["drums", "bass", "music"]), s("Bridge", 8, ["music", "lead"]), s("Hook", 8), s("Outro", 8, ["music"]) ] },
  { id: "trap-banger", name: "Trap Banger (~2:30)", blurb: "Short intro, hook-first, two verses", sections: [
    s("Intro", 4, ["music", "lead"]), s("Hook", 16), s("Verse 1", 16, ["drums", "bass", "music"]), s("Hook", 16),
    s("Verse 2", 8, ["drums", "bass", "music"]), s("Hook", 16), s("Outro", 4, ["music"]) ] },
  { id: "boom-bap-3", name: "Boom Bap · 3 Verses", blurb: "Classic 16-bar verses with 8-bar hooks", sections: [
    s("Intro", 4, ["music"]), s("Verse 1", 16, ["drums", "bass", "music"]), s("Hook", 8), s("Verse 2", 16, ["drums", "bass", "music"]),
    s("Hook", 8), s("Verse 3", 16, ["drums", "bass", "music"]), s("Hook", 8), s("Outro", 8, ["music", "drums"]) ] },
  { id: "pop-radio", name: "Pop Radio Edit", blurb: "Verse / pre / chorus ×2, bridge, double chorus", sections: [
    s("Intro", 4, ["music", "lead"]), s("Verse 1", 8, ["drums", "bass", "music"]), s("Pre-Chorus", 4, ["bass", "music"]), s("Chorus", 8),
    s("Verse 2", 8, ["drums", "bass", "music"]), s("Pre-Chorus", 4, ["bass", "music"]), s("Chorus", 8), s("Bridge", 8, ["music", "lead"]),
    s("Chorus", 8), s("Chorus", 8), s("Outro", 4, ["music"]) ] },
  { id: "club-edit", name: "Club Edit (DJ-friendly)", blurb: "Long drum intro/outro for mixing, two drops", sections: [
    s("Intro", 16, ["drums"]), s("Build", 8, ["drums", "music"]), s("Drop", 16), s("Breakdown", 16, ["music", "lead"]),
    s("Build", 8, ["drums", "music"]), s("Drop", 16), s("Outro", 16, ["drums"]) ] },
  { id: "lofi-tape", name: "Lo-Fi Beat Tape", blurb: "Mellow A/B loop with a breakdown", sections: [
    s("Intro", 4, ["music"]), s("A", 16, ["drums", "bass", "music"]), s("B", 16), s("Break", 8, ["music"]),
    s("A", 16, ["drums", "bass", "music"]), s("Outro", 4, ["music"]) ] },
  { id: "screw-tape", name: "Chopped & Screwed Tape", blurb: "Long verses and a chopped breakdown; screw it afterwards", sections: [
    s("Intro", 8, ["music"]), s("Verse", 16, ["drums", "bass", "music"]), s("Chop", 4, ["music"]), s("Verse", 16),
    s("Chop", 4, ["drums", "music"]), s("Outro", 8, ["music", "lead"]) ] },
  { id: "drill-song", name: "Drill Song", blurb: "Hook-heavy drill structure", sections: [
    s("Intro", 4, ["music", "lead"]), s("Hook", 8), s("Verse 1", 16), s("Hook", 8), s("Verse 2", 16), s("Hook", 8), s("Outro", 4, ["music"]) ] },
  { id: "riddim", name: "Riddim / Afro Groove", blurb: "Groove-forward: keeps the drums rolling", sections: [
    s("Intro", 8, ["drums", "music"]), s("Verse", 16, ["drums", "bass", "music"]), s("Chorus", 8), s("Verse", 16, ["drums", "bass", "music"]),
    s("Chorus", 8), s("Instrumental", 8, ["drums", "bass", "lead"]), s("Chorus", 8), s("Outro", 8, ["drums", "music"]) ] },
  { id: "rnb-ballad", name: "R&B Slow Jam", blurb: "Gentle build, big final chorus", sections: [
    s("Intro", 4, ["music"]), s("Verse 1", 8, ["bass", "music"]), s("Chorus", 8), s("Verse 2", 8, ["drums", "bass", "music"]),
    s("Chorus", 8), s("Bridge", 8, ["music", "lead"]), s("Chorus", 8), s("Outro", 4, ["music", "lead"]) ] },
  { id: "snippet", name: "Beat Snippet (1 min)", blurb: "Instagram/TikTok length: in, hit, out", sections: [
    s("Intro", 4, ["music", "lead"]), s("Main", 16), s("Outro", 4, ["music"]) ] },
];

export const blueprintBars = (b: Blueprint) => b.sections.reduce((a, x) => a + x.bars, 0);
