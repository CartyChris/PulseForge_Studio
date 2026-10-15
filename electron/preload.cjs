/**
 * Minimal, sandboxed preload. Exposes ONLY static facts as window.pulseforgeDesktop:
 *   { version, platform, isDesktop: true }
 * No IPC, no Node APIs. The frontend can use isDesktop to pad its top bar ~78px on the
 * left for the macOS traffic lights (the window uses titleBarStyle "hiddenInset").
 */
"use strict";
const { contextBridge } = require("electron");

const arg = (process.argv || []).find((a) => a.startsWith("--pf-version="));
const version = arg ? arg.slice("--pf-version=".length) : "unknown";

contextBridge.exposeInMainWorld(
  "pulseforgeDesktop",
  Object.freeze({ version, platform: process.platform, isDesktop: true }),
);
