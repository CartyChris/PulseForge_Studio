/**
 * Apply a song blueprint to a loop: split the source pattern into one pattern per layer
 * (Drums / Bass / Music / Lead), give each layer a playlist track, and lay the sections out with
 * the layers each section calls for. Pure: returns a new project (one undo step in the store).
 */
import { newId, type Channel, type Clip, type Pattern, type Project, type Section, type Track } from "../../shared/project";
import { LAYERS, type Blueprint, type Layer } from "../../shared/blueprints";
import { INSTRUMENT_PRESETS } from "../engine/instruments";
import { PPQ } from "../../shared/time";

const BAR = PPQ * 4;
const LAYER_NAMES: Record<Layer, string> = { drums: "Drums", bass: "Bass", music: "Music", lead: "Lead" };
const LAYER_COLORS: Record<Layer, string> = { drums: "#ff6a3d", bass: "#ffc94d", music: "#3ec6ff", lead: "#8b6cff" };
const SECTION_COLORS = ["#7b6cff", "#3ec6ff", "#4fe39a", "#ffc94d", "#ff6fcf", "#ff9f43"];

/** Which layer a channel belongs to. */
export function layerOf(ch: Channel): Layer {
  const inst = ch.instrument;
  if (inst.type === "drum-sound" || inst.type === "drum-kit") return "drums";
  const name = ch.name.toLowerCase();
  if (inst.type === "synth") {
    const cat = INSTRUMENT_PRESETS.find((p) => p.id === inst.presetId)?.category ?? "";
    if (cat === "Bass" || /bass|808/.test(inst.synthId) || /\b(808|bass|sub)\b/.test(name)) return "bass";
    if (["Synth Leads", "FM", "Brass"].includes(cat) || /\b(lead|melody|bell|flute|pluck)\b/.test(name)) return "lead";
    return "music";
  }
  // samplers: chops / loops are the "music"; named kit hits are drums
  if (/\b(808|bass)\b/.test(name)) return "bass";
  if (/\b(kick|snare|clap|hats?|perc|rim|drums?|break|breakbeat)\b/.test(name)) return "drums";
  return "music";
}

export interface BlueprintResult { project: Project; layers: Layer[]; bars: number }

export function applyBlueprint(project: Project, bp: Blueprint, sourcePatternId: string, mode: "replace" | "append" = "append"): BlueprintResult {
  const src = project.patterns.find((p) => p.id === sourcePatternId);
  if (!src) throw new Error("Pick the pattern (loop) to build the song from");
  const byLayer = new Map<Layer, Pattern>();
  for (const layer of LAYERS) {
    const chanIds = project.channels.filter((c) => layerOf(c) === layer).map((c) => c.id);
    const steps = Object.fromEntries(Object.entries(src.steps).filter(([id, s]) => chanIds.includes(id) && s.length));
    const notes = Object.fromEntries(Object.entries(src.notes).filter(([id, n]) => chanIds.includes(id) && n.length));
    if (!Object.keys(steps).length && !Object.keys(notes).length) continue;
    byLayer.set(layer, { ...src, id: newId("pat"), name: `${src.name} · ${LAYER_NAMES[layer]}`, color: LAYER_COLORS[layer], steps, notes });
  }
  if (!byLayer.size) throw new Error("That pattern is empty: add some steps or notes first");

  const tracks: Track[] = [...project.tracks];
  const trackFor = new Map<Layer, string>();
  for (const layer of byLayer.keys()) {
    const name = `${LAYER_NAMES[layer]} (song)`;
    let t = tracks.find((x) => x.name === name && x.kind === "pattern");
    if (!t) {
      t = { id: newId("trk"), name, color: LAYER_COLORS[layer], kind: "pattern", height: 56, muted: false, soloed: false, mixerChannelId: null, groupId: null, armed: false, inputDeviceId: null } as Track;
      tracks.push(t);
    }
    trackFor.set(layer, t.id);
  }

  const replace = mode === "replace";
  const keptClips = replace ? project.clips.filter((c) => c.kind !== "pattern") : [...project.clips];
  const songEnd = replace ? 0 : Math.max(0, ...project.clips.map((c) => c.startTick + c.lengthTicks));
  let at = Math.ceil(songEnd / BAR) * BAR;
  const clips: Clip[] = [...keptClips];
  const sections: Section[] = replace ? [] : [...project.sections];
  bp.sections.forEach((sec, i) => {
    const len = sec.bars * BAR;
    sections.push({ id: newId("sec"), name: sec.name, startTick: at, lengthTicks: len, color: SECTION_COLORS[i % SECTION_COLORS.length]! });
    for (const layer of sec.layers) {
      const pat = byLayer.get(layer);
      if (!pat) continue;
      clips.push({
        id: newId("clip"), trackId: trackFor.get(layer)!, kind: "pattern", startTick: at, lengthTicks: len, patternId: pat.id,
        color: pat.color, name: `${sec.name} · ${LAYER_NAMES[layer]}`, muted: false, offsetTicks: 0, gainDb: 0, fadeInTicks: 0, fadeOutTicks: 0,
        reversed: false, pitchSemitones: 0, stretch: 1, loopSource: false, automationPoints: [],
      } as Clip);
    }
    at += len;
  });
  return {
    project: { ...project, patterns: [...project.patterns, ...byLayer.values()], tracks, clips, sections },
    layers: [...byLayer.keys()],
    bars: bp.sections.reduce((a, x) => a + x.bars, 0),
  };
}
