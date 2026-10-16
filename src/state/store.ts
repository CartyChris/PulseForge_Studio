/**
 * Central studio state (Zustand): project + selection + UI + undo/redo.
 * Every project mutation goes through update()/dispatch(); the engine is synced
 * on each change and autosave runs on a debounce.
 */
import { create } from "zustand";
import type { Project, AudioAsset } from "../../shared/project";
import { createEmptyProject, newId } from "../../shared/project";
import type { DawCommand } from "../../shared/commands";
import { applyCommand } from "./commands";
import { engine } from "../engine/engine";
import { saveProject } from "../storage/projects";

export type Tab =
  | "home" | "producer" | "connections" | "library"
  | "channel-rack" | "piano-roll" | "playlist" | "audio-editor" | "mixer"
  | "instrument" | "ai-assistant" | "sound-lab" | "recording" | "resources";

/** Experience level — controls how much of the studio is visible at once (never what it can do). */
export type Level = "beginner" | "intermediate" | "expert";
export const LEVELS: Level[] = ["beginner", "intermediate", "expert"];
export const levelRank = (l: Level) => LEVELS.indexOf(l);

function loadLevel(): Level {
  try {
    const v = localStorage.getItem("pf_level");
    if (v === "beginner" || v === "intermediate" || v === "expert") return v;
  } catch {}
  return "beginner";
}
function loadTab(): Tab {
  try { if (localStorage.getItem("pf_onboarded") === "1") return "home"; } catch {}
  return "home";
}

export interface Selection {
  patternId: string | null;
  channelId: string | null;
  clipIds: string[];
  noteIds: string[];
  mixerChannelId: string | null;
  assetId: string | null;
  trackId: string | null;
}

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "error" | "success";
}

interface StudioState {
  project: Project;
  projectLoaded: boolean;
  dirty: boolean;
  lastSavedAt: string | null;
  undoStack: Project[];
  redoStack: Project[];
  tab: Tab;
  selection: Selection;
  playing: boolean;
  positionTicks: number;
  recording: boolean;
  micActive: boolean;
  cloudActive: boolean;
  aiBusy: boolean;
  snap: string;
  playMode: "pattern" | "song";
  /** active piano-roll tool — in the store so keyboard shortcuts can switch it */
  prTool: "pencil" | "select";
  toasts: Toast[];
  zoom: { playlist: number; pianoRoll: number; audio: number };
  uiScale: number;
  reducedMotion: boolean;
  paletteOpen: boolean;
  level: Level;
  /** true until the user has picked a level once (drives the welcome screen) */
  needsOnboarding: boolean;

  setLevel(level: Level): void;
  finishOnboarding(level: Level): void;
  setProject(project: Project, opts?: { resetUndo?: boolean }): void;
  update(fn: (p: Project) => Project, opts?: { undoable?: boolean }): void;
  dispatch(cmd: DawCommand): void;
  dispatchMany(cmds: DawCommand[]): boolean;
  undo(): void;
  redo(): void;
  setTab(tab: Tab): void;
  select(patch: Partial<Selection>): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: string): void;
  setTransportState(playing: boolean, positionTicks: number): void;
  setFlags(patch: Partial<Pick<StudioState, "recording" | "micActive" | "cloudActive" | "aiBusy" | "paletteOpen" | "reducedMotion">>): void;
  setSnap(snap: string): void;
  setPlayMode(mode: "pattern" | "song"): void;
  setPrTool(tool: "pencil" | "select"): void;
  /** push an explicit undo snapshot (for gestures applied via non-undoable updates) */
  pushUndo(prev: Project): void;
  setZoom(view: keyof StudioState["zoom"], value: number): void;
  setUiScale(scale: number): void;
  save(manual?: boolean): Promise<void>;
  addAsset(asset: AudioAsset): void;
}

const MAX_UNDO = 80;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudio = create<StudioState>((set, get) => ({
  project: createEmptyProject(),
  projectLoaded: false,
  dirty: false,
  lastSavedAt: null,
  undoStack: [],
  redoStack: [],
  tab: loadTab(),
  selection: { patternId: null, channelId: null, clipIds: [], noteIds: [], mixerChannelId: null, assetId: null, trackId: null },
  playing: false,
  positionTicks: 0,
  recording: false,
  micActive: false,
  cloudActive: false,
  aiBusy: false,
  snap: "step",
  playMode: "pattern",
  prTool: "pencil",
  toasts: [],
  zoom: { playlist: 0.12, pianoRoll: 1.5, audio: 1 },
  uiScale: 1,
  reducedMotion: false,
  paletteOpen: false,
  level: loadLevel(),
  needsOnboarding: (() => { try { return localStorage.getItem("pf_onboarded") !== "1"; } catch { return false; } })(),

  setLevel(level) {
    try { localStorage.setItem("pf_level", level); } catch {}
    set({ level });
  },
  finishOnboarding(level) {
    try { localStorage.setItem("pf_level", level); localStorage.setItem("pf_onboarded", "1"); } catch {}
    set({ level, needsOnboarding: false });
  },

  setProject(project, opts) {
    set({
      project,
      projectLoaded: true,
      dirty: false,
      ...(opts?.resetUndo !== false ? { undoStack: [], redoStack: [] } : {}),
      selection: {
        patternId: project.patterns[0]?.id ?? null,
        channelId: project.channels[0]?.id ?? null,
        clipIds: [], noteIds: [],
        mixerChannelId: project.mixer.channels[0]?.id ?? null,
        assetId: null,
        trackId: project.tracks[0]?.id ?? null,
      },
    });
    engine.applyProject(project);
    engine.setPlayContext(get().playMode, project.patterns[0]?.id ?? null);
  },

  update(fn, opts) {
    const { project, undoStack } = get();
    const next = fn(project);
    if (next === project) return;
    set({
      project: next,
      dirty: true,
      ...(opts?.undoable !== false
        ? { undoStack: [...undoStack.slice(-MAX_UNDO + 1), project], redoStack: [] }
        : {}),
    });
    engine.applyProject(next);
    scheduleAutosave(get);
  },

  dispatch(cmd) {
    try {
      get().update((p) => applyCommand(p, cmd));
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  dispatchMany(cmds) {
    const { project, undoStack } = get();
    try {
      let next = project;
      for (const cmd of cmds) next = applyCommand(next, cmd);
      set({ project: next, dirty: true, undoStack: [...undoStack.slice(-MAX_UNDO + 1), project], redoStack: [] });
      engine.applyProject(next);
      scheduleAutosave(get);
      return true;
    } catch (e) {
      get().toast(`Edit plan failed, nothing was applied: ${e}`, "error");
      return false;
    }
  },

  undo() {
    const { undoStack, redoStack, project } = get();
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    set({ project: prev, undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, project].slice(-MAX_UNDO), dirty: true });
    engine.applyProject(prev);
  },
  redo() {
    const { undoStack, redoStack, project } = get();
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    set({ project: next, redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, project].slice(-MAX_UNDO), dirty: true });
    engine.applyProject(next);
  },

  setTab: (tab) => set({ tab }),
  select(patch) {
    const selection = { ...get().selection, ...patch };
    set({ selection });
    engine.setPlayContext(get().playMode, selection.patternId);
  },
  setPlayMode(mode) {
    set({ playMode: mode });
    engine.setPlayContext(mode, get().selection.patternId);
  },
  setPrTool: (prTool) => set({ prTool }),
  pushUndo(prev) {
    set({ undoStack: [...get().undoStack.slice(-MAX_UNDO + 1), prev], redoStack: [], dirty: true });
    scheduleAutosave(get);
  },

  toast(text, kind = "info") {
    const id = newId("toast");
    set({ toasts: [...get().toasts.slice(-4), { id, text: text.slice(0, 300), kind }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setTransportState: (playing, positionTicks) => set({ playing, positionTicks }),
  setFlags: (patch) => set(patch),
  setSnap: (snap) => set({ snap }),
  setZoom: (view, value) => set({ zoom: { ...get().zoom, [view]: value } }),
  setUiScale: (uiScale) => set({ uiScale }),

  async save(manual = false) {
    const { project } = get();
    try {
      const saved = await saveProject(project);
      set({ project: saved, dirty: false, lastSavedAt: saved.modifiedAt });
      if (manual) get().toast("Project saved", "success");
    } catch (e) {
      get().toast(`Save failed: ${e}`, "error");
    }
  },

  addAsset(asset) {
    get().update((p) => ({ ...p, assets: [...p.assets, asset] }));
  },
}));

function scheduleAutosave(get: () => StudioState) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    const s = get();
    if (!s.dirty || !s.projectLoaded) return;
    try {
      await saveProject(s.project, { autosave: true });
    } catch {}
  }, 4000);
}

/**
 * Playhead position lives in its OWN tiny store so 60fps updates never re-render
 * the whole studio — only components that subscribe to it (playhead lines,
 * position display, step highlight) update per frame.
 */
export const usePlayhead = create<{ ticks: number; playing: boolean }>(() => ({ ticks: 0, playing: false }));

let rafStarted = false;
export function startTransportLoop(): void {
  if (rafStarted) return;
  rafStarted = true;
  const tick = () => {
    const pos = engine.positionTicks;
    const ph = usePlayhead.getState();
    if (ph.playing !== engine.playing || Math.abs(ph.ticks - pos) > 0.5) {
      usePlayhead.setState({ ticks: pos, playing: engine.playing });
    }
    const s = useStudio.getState();
    if (s.playing !== engine.playing) s.setTransportState(engine.playing, pos);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
