import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { useStudio, usePlayhead } from "./state/store";
import { engine } from "./engine/engine";
import { insertComposition, projectSummary } from "./state/composition";
import { applyCommands } from "./state/commands";
import { importAudioData, assetFromChannelData, sliceAsset, ensureProjectAssetsLoaded } from "./audio/assets";
import { renderProjectToWav, renderProject } from "./engine/render";
import { validateComposition } from "../shared/composition";
import { validateEditPlan } from "../shared/commands";
import { parseWavHeader, decodeWavSamples, peakLevel } from "../shared/wav";
import { saveProject, loadProjectWithRecovery, PROJECT_TEMPLATES } from "./storage/projects";
import { applyPulseTune } from "./ui/PulseTune";
import { EFFECT_DEFS } from "./engine/effects";
import { INSTRUMENT_PRESETS } from "./engine/instruments";
import { DRUM_KITS } from "./engine/kits";
import * as notetools from "../shared/notetools";
import * as patterntools from "../shared/patterntools";

/**
 * Scripting/testing surface. Used by the e2e suite and available to a future host
 * (AI OS) for programmatic control. Everything routes through the same validated
 * store/commands as the UI — no privileged paths.
 */
(window as unknown as Record<string, unknown>).__pulseforge = {
  useStudio, usePlayhead, engine,
  insertComposition, projectSummary, applyCommands,
  importAudioData, assetFromChannelData, sliceAsset, ensureProjectAssetsLoaded,
  renderProjectToWav, renderProject,
  validateComposition, validateEditPlan,
  applyPulseTune,
  EFFECT_DEFS, INSTRUMENT_PRESETS, DRUM_KITS,
  notetools, patterntools,
  parseWavHeader, decodeWavSamples, peakLevel,
  saveProject, loadProjectWithRecovery, PROJECT_TEMPLATES,
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
