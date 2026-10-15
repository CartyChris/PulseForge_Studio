/**
 * Local director — turns a plain-English request into a ProductionSpec with no AI at all.
 * "dark trap beat 140 bpm in F# minor with bells" → genre trap, bpm 140, key F#, scale minor,
 * melody instrument bell. This is the offline path of the end-to-end producer, and the
 * fallback whenever a model is unavailable or returns something unusable.
 */
import type { GenreId, ProductionSpec } from "./producer";
import { GENRES, ProductionSpecSchema, normalizeKey } from "./producer";

const GENRE_WORDS: Array<[RegExp, GenreId]> = [
  [/\b(uk\s*drill|ny\s*drill|drill)\b/i, "drill"],
  [/\bphonk\b|\bmemphis\b|\bdrift\b/i, "phonk"],
  [/\bjersey(\s*club)?\b|\bclub\s*music\b/i, "jersey-club"],
  [/\bboom[\s-]*bap\b|\b90s\s*hip[\s-]*hop\b|\bold[\s-]*school\b/i, "boom-bap"],
  [/\blo[\s-]*fi\b|\blofi\b|\bstudy\s*beat|\bchillhop\b/i, "lofi"],
  [/\br\s*&\s*b\b|\brnb\b|\br\s*n\s*b\b|\bneo[\s-]*soul\b|\bslow\s*jam\b/i, "rnb"],
  [/\bdrum\s*(and|&|n)\s*bass\b|\bdnb\b|\bd&b\b|\bjungle\b|\bliquid\b/i, "dnb"],
  [/\bdancehall\b|\bsoca\b|\bisland\b|\breggae\b/i, "dancehall"],
  [/\bdub[\s-]*step\b|\bbrostep\b|\briddim\b/i, "dubstep"],
  [/\bafro[\s-]*(beats?|pop|house)?\b|\bamapiano\b|\bnaija\b/i, "afrobeats"],
  [/\breggaet[oó]n\b|\bdembow\b|\blatin\s*trap\b|\bperreo\b/i, "reggaeton"],
  [/\btechno\b|\bwarehouse\b|\bacid\b|\bindustrial\b/i, "techno"],
  [/\b(deep|tech|progressive|disco|garage|future)?\s*house\b|\bedm\b|\bdance\b/i, "house"],
  [/\bsynth[\s-]*wave\b|\bretro[\s-]*wave\b|\b80'?s\b|\boutrun\b|\bvaporwave\b/i, "synthwave"],
  [/\bpop\b|\bradio\b|\bmainstream\b/i, "pop"],
  [/\btrap\b|\brage\b|\bplugg\b|\bhip[\s-]*hop\b|\brap\b|\b808s?\b/i, "trap"],
];

/** instrument words → preset ids (first existing wins at apply time) */
const INSTRUMENT_WORDS: Array<[RegExp, "melody" | "chords" | "bass" | "counter", string]> = [
  [/\bbells?\b|\bglock/i, "melody", "bell"],
  [/\bflutes?\b/i, "melody", "flute"],
  [/\bguitar|acoustic\b/i, "melody", "nylon-guitar"],
  [/\bmarimba|kalimba/i, "melody", "marimba"],
  [/\bpluck/i, "melody", "pluck"],
  [/\bsupersaw|trance\s*lead/i, "melody", "supersaw-lead"],
  [/\bstrings?\b|\borchestra|cinematic|violin|cello/i, "counter", "strings-ensemble"],
  [/\bbrass|horns?\b|trumpet/i, "counter", "brass-section"],
  [/\bchoir|vocal\s*pad/i, "counter", "choir-ahh"],
  [/\bpiano\b|\bkeys\b/i, "chords", "grand-piano"],
  [/\brhodes|electric\s*piano|\bep\b/i, "chords", "ep-classic"],
  [/\borgan\b/i, "chords", "b3-organ"],
  [/\bpads?\b|\batmospher/i, "chords", "pad-warm-analog"],
  [/\breese\b/i, "bass", "bass-reese"],
  [/\bwobble/i, "bass", "bass-wobble"],
  [/\bdistorted\s*808|\bdirty\s*808|\bhard\s*808/i, "bass", "bass-808-distorted"],
];

const MOOD_WORDS = /\b(dark|evil|sinister|haunting|menacing|aggressive|hard|grim|ominous|gritty|angry|happy|bright|uplifting|joyful|summer|sunny|fun|feel[\s-]?good|positive|sad|melancholic|emotional|heartbreak|lonely|nostalgic|chill|relaxed|calm|mellow|smooth|dreamy|epic|cinematic|bouncy|groovy|energetic|hype|romantic|spacey|mysterious)\b/gi;

export interface DirectorResult {
  spec: ProductionSpec;
  /** what the director understood, for showing the user */
  understood: string[];
}

export function directFromPrompt(prompt: string, seed?: number): DirectorResult {
  const understood: string[] = [];
  const text = prompt.slice(0, 2000);

  const genre = GENRE_WORDS.find(([re]) => re.test(text))?.[1] ?? "trap";
  understood.push(`genre: ${GENRES[genre].name}${GENRE_WORDS.some(([re]) => re.test(text)) ? "" : " (default)"}`);

  const bpmMatch = /\b(\d{2,3})\s*(bpm|beats\s*per\s*minute)\b/i.exec(text) ?? /\btempo\s*(?:of\s*)?(\d{2,3})\b/i.exec(text);
  let bpm: number | undefined;
  if (bpmMatch) {
    const n = Number(bpmMatch[1]);
    if (n >= 50 && n <= 200) { bpm = n; understood.push(`tempo: ${n} BPM`); }
  }

  // "in F# minor", "A minor", "key of Bb", "Cm", "C# min"
  let key: string | undefined, scale: string | undefined;
  // uppercase letter required unless a quality word follows ("in a dark mood" must NOT read as A)
  const keyMatch = /\b(?:in|key(?:\s+of)?)\s+([A-G][#b♯♭]?)(?![a-z])\s*(major|minor|maj|min|m(?![a-z]))?/.exec(text)
    ?? /\b([a-gA-G][#b♯♭]?)\s*(major|minor)\b/i.exec(text)
    ?? /\b([A-G][#b♯♭]?)(maj|min|m)\b/.exec(text);
  if (keyMatch) {
    const k = normalizeKey(keyMatch[1]);
    if (k) {
      key = k;
      const q = (keyMatch[2] ?? "").toLowerCase();
      if (q.startsWith("maj")) scale = "major";
      else if (q === "m" || q.startsWith("min")) scale = "minor";
      understood.push(`key: ${k}${scale ? ` ${scale}` : ""}`);
    }
  }
  if (!scale) {
    const sm = /\b(harmonic minor|melodic minor|dorian|phrygian|lydian|mixolydian|pentatonic|blues)\b/i.exec(text);
    if (sm) { scale = sm[1]!.toLowerCase() === "pentatonic" ? "pentatonic minor" : sm[1]!.toLowerCase(); understood.push(`scale: ${scale}`); }
  }

  const moods = [...new Set((text.match(MOOD_WORDS) ?? []).map((w) => w.toLowerCase()))];
  if (moods.length) understood.push(`mood: ${moods.join(", ")}`);

  const length: ProductionSpec["length"] = /\b(short|quick|loop|30\s*sec|1\s*min)\b/i.test(text) ? "short" : /\b(long|extended|full\s*song|4\s*min|5\s*min)\b/i.test(text) ? "extended" : "standard";
  if (length !== "standard") understood.push(`length: ${length}`);

  const instruments: ProductionSpec["instruments"] = {};
  for (const [re, slot, preset] of INSTRUMENT_WORDS) {
    if (re.test(text) && !instruments[slot]) { instruments[slot] = preset; understood.push(`${slot}: ${preset}`); }
  }

  const mix: ProductionSpec["mix"] = {};
  if (/\bsidechain|pumping|pump\b/i.test(text)) { mix.sidechain = true; understood.push("sidechain pumping"); }
  if (/\b(wet|spacious|reverb|ambient|spacey|huge)\b/i.test(text)) mix.reverb = 0.65;
  if (/\b(dry|tight|punchy)\b/i.test(text)) mix.reverb = 0.15;
  if (/\b(distorted|gritty|saturated|crunchy|dirty)\b/i.test(text)) mix.saturation = 0.8;

  const swing = /\b(swing|swung|shuffle|bounce|bouncy)\b/i.test(text) ? Math.max(GENRES[genre].swing, 0.45) : undefined;
  if (swing) understood.push("swing");

  const title = makeTitle(genre, moods, seed);
  const spec = ProductionSpecSchema.parse({
    title, genre, mood: moods.join(" "), bpm, key, scale, swing, length, instruments, mix, seed,
    notes: `Local director interpretation of: "${text.slice(0, 300)}"`,
  });
  return { spec, understood };
}

const TITLE_A = ["Midnight", "Neon", "Velvet", "Obsidian", "Golden", "Static", "Crimson", "Lunar", "Hollow", "Electric", "Paper", "Glass", "Smoke", "Cobalt", "Ember"];
const TITLE_B = ["Drive", "Echoes", "Signals", "Rooftops", "Tides", "Engines", "Mirage", "Pulse", "Avenue", "Orbit", "Static", "Fever", "Ritual", "Skyline", "Run"];

function makeTitle(genre: GenreId, moods: string[], seed = 0): string {
  let h = seed ^ genre.length * 2654435761;
  for (const m of moods) for (let i = 0; i < m.length; i++) h = Math.imul(h ^ m.charCodeAt(i), 16777619);
  h >>>= 0;
  return `${TITLE_A[h % TITLE_A.length]} ${TITLE_B[(h >>> 8) % TITLE_B.length]}`;
}
