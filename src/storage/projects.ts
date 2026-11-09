/**
 * Project persistence: save/load/list/duplicate/templates/autosave + portable
 * .pfproj archives (ZIP with project.json + audio assets, path-safe on import).
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { idb } from "./db";
import { getBlobStore, safeBlobKey } from "./blobs";
import { migrateProject, newId, type Project, createEmptyProject } from "../../shared/project";
import { buildProduction, ProductionSpecSchema, type ProductionSpec } from "../../shared/producer";
import { applyProduction } from "../state/production";

export interface ProjectListEntry {
  id: string;
  name: string;
  modifiedAt: string;
  createdAt: string;
  bpm: number;
  autosave?: boolean;
}

interface StoredProject {
  id: string;
  name: string;
  modifiedAt: string;
  createdAt: string;
  bpm: number;
  json: string;
  autosave?: boolean;
}

export async function saveProject(project: Project, opts: { autosave?: boolean } = {}): Promise<Project> {
  const updated: Project = { ...project, modifiedAt: new Date().toISOString() };
  const record: StoredProject = {
    id: opts.autosave ? `autosave:${project.id}` : project.id,
    name: updated.name,
    modifiedAt: updated.modifiedAt,
    createdAt: updated.createdAt,
    bpm: updated.bpm,
    json: JSON.stringify(updated),
    autosave: opts.autosave,
  };
  await idb.put("projects", record);
  if (!opts.autosave) await pushRecent(project.id);
  return updated;
}

export async function loadProject(id: string): Promise<Project | null> {
  const rec = await idb.get<StoredProject>("projects", id);
  if (!rec) return null;
  return migrateProject(JSON.parse(rec.json));
}

/** Prefer a newer autosave over the last explicit save (crash recovery). */
export async function loadProjectWithRecovery(id: string): Promise<{ project: Project; recovered: boolean } | null> {
  const main = await idb.get<StoredProject>("projects", id);
  const auto = await idb.get<StoredProject>("projects", `autosave:${id}`);
  if (!main && !auto) return null;
  if (auto && (!main || auto.modifiedAt > main.modifiedAt)) {
    return { project: migrateProject(JSON.parse(auto.json)), recovered: !!main && auto.modifiedAt > main.modifiedAt };
  }
  return { project: migrateProject(JSON.parse(main!.json)), recovered: false };
}

/** Every project id in storage, including ones that only exist as an autosave. */
export async function allProjectIds(): Promise<string[]> {
  const keys = (await idb.getAllKeys("projects")).map(String);
  return [...new Set(keys.map((k) => (k.startsWith("autosave:") ? k.slice(9) : k)))];
}

/** Write a project exactly as given (keeps its modifiedAt) — used when restoring a backup. */
export async function restoreProjectRecord(project: Project): Promise<void> {
  const record: StoredProject = {
    id: project.id, name: project.name, modifiedAt: project.modifiedAt, createdAt: project.createdAt,
    bpm: project.bpm, json: JSON.stringify(project),
  };
  await idb.put("projects", record);
  await pushRecent(project.id);
}

export async function deleteProject(id: string): Promise<void> {
  await idb.delete("projects", id);
  await idb.delete("projects", `autosave:${id}`);
}

export async function listProjects(): Promise<ProjectListEntry[]> {
  const all = await idb.getAll<StoredProject>("projects");
  return all
    .filter((p) => !p.autosave)
    .map(({ id, name, modifiedAt, createdAt, bpm }) => ({ id, name, modifiedAt, createdAt, bpm }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

const RECENT_KEY = "recentProjects";
export async function recentProjects(): Promise<string[]> {
  return (await idb.get<string[]>("kv", RECENT_KEY)) ?? [];
}
async function pushRecent(id: string): Promise<void> {
  const rec = (await recentProjects()).filter((x) => x !== id);
  rec.unshift(id);
  await idb.put("kv", rec.slice(0, 12), RECENT_KEY);
}

export async function duplicateProject(id: string, newName?: string): Promise<Project | null> {
  const p = await loadProject(id);
  if (!p) return null;
  const copy: Project = { ...p, id: newId("proj"), name: newName ?? `${p.name} copy`, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() };
  await saveProject(copy);
  return copy;
}

// ---------- templates ----------
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  create(): Project;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: "blank", name: "Blank", description: "Empty project, 120 BPM", create: () => createEmptyProject("Untitled", 120) },
  {
    id: "hiphop-90",
    name: "Hip-Hop 90",
    description: "90 BPM, Modern Hip-Hop kit loaded with a 16-step rack",
    create: () => {
      const p = createEmptyProject("Hip-Hop Session", 90);
      return withStarterRack(p, "modern-hiphop");
    },
  },
  {
    id: "trap-140",
    name: "Trap 140",
    description: "140 BPM, Trap & 808 kit with an 808 bass channel",
    create: () => {
      const p = createEmptyProject("Trap Session", 140);
      const withRack = withStarterRack(p, "trap-808");
      withRack.channels.push({
        id: newId("ch"), name: "808 Bass", color: "#e8663c",
        instrument: { type: "synth", synthId: "bass808", presetId: "bass-808", params: {} },
        volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null,
      });
      return withRack;
    },
  },
  {
    id: "electronic-128",
    name: "Electronic 128",
    description: "128 BPM, Electronic kit + pad and pluck channels",
    create: () => {
      const p = createEmptyProject("Electronic Session", 128);
      const withRack = withStarterRack(p, "electronic");
      withRack.channels.push(
        { id: newId("ch"), name: "Pad", color: "#7b6cff", instrument: { type: "synth", synthId: "pad", presetId: "pad-strings", params: {} }, volumeDb: -6, pan: 0, muted: false, soloed: false, mixerChannelId: null },
        { id: newId("ch"), name: "Pluck", color: "#4cc2ff", instrument: { type: "synth", synthId: "pluck", presetId: "pluck", params: {} }, volumeDb: -3, pan: 0, muted: false, soloed: false, mixerChannelId: null },
      );
      return withRack;
    },
  },
  // complete, editable songs built by the offline producer — a running start for each style
  { id: "screwed-tape", name: "Chopped & Screwed Tape", description: "70 BPM Houston syrup: slow 808s, hazy keys, echo. Screw it further from the Song page", create: () => produced("Chopped & Screwed Tape", { genre: "screwed", bpm: 70, seed: 1101 }) },
  { id: "sample-flip", name: "Sample Flip (Boom Bap)", description: "Drums + bass only at 90 BPM: drop your sample on the Sample page and chop it to pads", create: () => produced("Sample Flip", { genre: "boom-bap", bpm: 90, seed: 2202, sections: [
    { name: "Intro", role: "intro", bars: 4, energy: 0.4, parts: ["drums"] }, { name: "Verse", role: "verse", bars: 16, energy: 0.7, parts: ["drums", "bass"] },
    { name: "Hook", role: "hook", bars: 8, energy: 0.9, parts: ["drums", "bass"] }, { name: "Outro", role: "outro", bars: 4, energy: 0.4, parts: ["drums"] } ] }) },
  { id: "lofi-tape", name: "Lo-Fi Beat Tape", description: "78 BPM dusty keys and swung drums, ready to chop or vibe to", create: () => produced("Lo-Fi Beat Tape", { genre: "lofi", bpm: 78, seed: 3303 }) },
  { id: "phonk-memphis", name: "Memphis Phonk", description: "Cowbells, distorted 808s and dark loops at 140 BPM", create: () => produced("Memphis Phonk", { genre: "phonk", bpm: 140, seed: 4404 }) },
];

function produced(name: string, spec: Partial<ProductionSpec>): Project {
  const prod = buildProduction(ProductionSpecSchema.parse({ title: name, ...spec }));
  return { ...applyProduction(createEmptyProject(name, prod.spec.bpm), prod), name };
}

function withStarterRack(p: Project, kitId: string): Project {
  const roles = ["kick", "snare", "clap", "hat-closed", "hat-open", "perc"];
  p.channels = roles.map((role, i) => ({
    id: newId("ch"),
    name: role.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    color: ["#e8663c", "#ffd166", "#4cc2ff", "#8ef58a", "#7b6cff", "#ff7bd5"][i % 6]!,
    instrument: { type: "drum-sound" as const, kitId, soundId: `${kitId}/${role}` },
    volumeDb: 0, pan: 0, muted: false, soloed: false, mixerChannelId: null,
  }));
  p.patterns = [{ id: newId("pat"), name: "Pattern 1", color: "#4cc2ff", lengthSteps: 16, steps: {}, notes: {}, swing: 0 }];
  p.tracks = [
    { id: newId("trk"), name: "Drums", color: "#e8663c", kind: "pattern" as const, height: 56, muted: false, soloed: false, mixerChannelId: null, groupId: null, armed: false, inputDeviceId: null },
  ];
  return p;
}

// ---------- portable archives ----------
const MAX_ARCHIVE_ENTRY = 512 * 1024 * 1024;

export async function exportPortableProject(project: Project): Promise<Blob> {
  const store = await getBlobStore();
  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(project, null, 2)),
  };
  for (const asset of project.assets) {
    const data = await store.get(asset.blobKey);
    if (data) files[`assets/${safeBlobKey(asset.blobKey)}`] = new Uint8Array(data);
    if (asset.originalBlobKey) {
      const orig = await store.get(asset.originalBlobKey);
      if (orig) files[`assets/${safeBlobKey(asset.originalBlobKey)}`] = new Uint8Array(orig);
    }
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: "application/zip" });
}

/** Import a .pfproj archive. Rejects traversal paths; assets copied into local storage. */
export async function importPortableProject(data: ArrayBuffer): Promise<Project> {
  const entries = unzipSync(new Uint8Array(data));
  const projectEntry = entries["project.json"];
  if (!projectEntry) throw new Error("Archive has no project.json — not a PulseForge project");
  for (const name of Object.keys(entries)) {
    if (name.includes("..") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
      throw new Error(`Unsafe path in archive: ${name}`);
    }
    if (entries[name]!.length > MAX_ARCHIVE_ENTRY) throw new Error(`Archive entry too large: ${name}`);
  }
  const project = migrateProject(JSON.parse(strFromU8(projectEntry)));
  // re-key project id so imports never overwrite an existing project
  const imported: Project = { ...project, id: newId("proj"), modifiedAt: new Date().toISOString() };
  const store = await getBlobStore();
  for (const asset of imported.assets) {
    const entry = entries[`assets/${safeBlobKey(asset.blobKey)}`];
    if (entry) await store.put(asset.blobKey, entry.slice().buffer as ArrayBuffer);
    if (asset.originalBlobKey) {
      const orig = entries[`assets/${safeBlobKey(asset.originalBlobKey)}`];
      if (orig) await store.put(asset.originalBlobKey, orig.slice().buffer as ArrayBuffer);
    }
  }
  await saveProject(imported);
  return imported;
}
