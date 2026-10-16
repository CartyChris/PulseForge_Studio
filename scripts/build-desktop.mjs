#!/usr/bin/env node
// Desktop (Electron) build: vite build -> bundle backend -> stage app -> electron-builder.
//
//   node scripts/build-desktop.mjs              full build: release/PulseForge-Studio-<version>-arm64.dmg
//   node scripts/build-desktop.mjs --skip-vite  reuse the current dist/
//   node scripts/build-desktop.mjs --dev        stage + launch Electron against current dist/ (no packaging)
//   node scripts/build-desktop.mjs --stage-only stage dist-electron/app/ and stop
//
// Idempotent: dist-electron/app is rebuilt from scratch on every run, release/ artifacts
// are overwritten. The staged app has its own package.json with NO dependencies (the
// backend is a single esbuild bundle), so electron-builder packs only what we stage.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const DEV = args.has("--dev");
const STAGE_ONLY = args.has("--stage-only");
const SKIP_VITE = DEV || STAGE_ONLY || args.has("--skip-vite");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stage = path.join(root, "dist-electron", "app");
const bin = (name) => path.join(root, "node_modules", ".bin", name);
const step = (msg) => console.log(`\n[build-desktop] ${msg}`);

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`[build-desktop] FAILED: ${cmd} ${cmdArgs.join(" ")} (exit ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}

// 1. frontend
if (!SKIP_VITE) {
  step("vite build");
  run(bin("vite"), ["build"]);
}
if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.error("[build-desktop] dist/index.html missing — run `npm run build` first (or drop --skip-vite).");
  process.exit(1);
}

// 2. icon (generated once from electron/icon/icon.svg; committed afterwards)
const icns = path.join(root, "electron", "resources", "icon.icns");
if (!fs.existsSync(icns) || fs.statSync(icns).mtimeMs < fs.statSync(path.join(root, "electron", "icon", "icon.svg")).mtimeMs) {
  step("rendering app icon");
  run(bin("electron"), [path.join(root, "electron", "icon", "render-icon.cjs")]);
}

// 3. stage app dir
step(`staging ${path.relative(root, stage)}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of ["main.cjs", "preload.cjs"]) fs.copyFileSync(path.join(root, "electron", f), path.join(stage, f));
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      productName: pkg.build?.productName ?? "PulseForge Studio",
      version: pkg.version,
      description: pkg.description,
      author: "PulseForge",
      license: "UNLICENSED",
      private: true,
      main: "main.cjs",
    },
    null,
    2,
  ),
);

// 4. backend bundle (Fastify + routes + providers) -> one CJS file
step("bundling backend with esbuild");
const esbuild = await import("esbuild");
const result = await esbuild.build({
  entryPoints: [path.join(root, "server", "index.ts")],
  outfile: path.join(stage, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
  logLevel: "warning",
  // the server is ESM source; give it a real import.meta.url inside the CJS bundle
  define: { "import.meta.url": "__pf_import_meta_url" },
  banner: { js: "const __pf_import_meta_url = require('url').pathToFileURL(__filename).href;" },
  // electron is provided by the runtime; pino's optional transports are never used (logger level "warn", no transport)
  external: ["electron", "pino-pretty"],
  metafile: true,
});
if (result.errors.length) process.exit(1);
const bytes = fs.statSync(path.join(stage, "server.cjs")).size;
console.log(`[build-desktop] server.cjs ${(bytes / 1024).toFixed(0)} KiB, ${Object.keys(result.metafile.inputs).length} inputs`);

// 4b. sanity: the bundle must load and export the API without starting a server
run(process.execPath, [
  "-e",
  `const m = require(${JSON.stringify(path.join(stage, "server.cjs"))});
   if (typeof m.buildApp !== "function" || typeof m.startServer !== "function") { console.error("bad exports", Object.keys(m)); process.exit(1); }
   console.log("[build-desktop] bundle exports OK:", Object.keys(m).join(", "));`,
], { env: { ...process.env, PF_DATA_DIR: path.join(root, "dist-electron", ".tmp-data") } });
fs.rmSync(path.join(root, "dist-electron", ".tmp-data"), { recursive: true, force: true });

if (STAGE_ONLY) {
  step("staged (stage-only) — done");
  process.exit(0);
}

// 5a. dev: launch Electron on the staged dir, frontend from the repo's dist/
if (DEV) {
  step("launching Electron (desktop:dev)");
  const child = spawn(bin("electron"), [stage], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PF_DESKTOP_WEB_DIR: path.join(root, "dist") },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
} else {
  // 5b. package
  step("electron-builder (mac arm64 dmg, unsigned)");
  const electronVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
  // electron-builder 26 collects node_modules from the app dir and, when that has none (ours has no
  // runtime deps: the web build is static and the backend is one bundle), falls back to the PROJECT dir,
  // copying the repo's whole production dependency tree into app.asar (slow, and ~dead weight). So the
  // staged app dir is made the project dir, with the package.json "build" config passed explicitly
  // and every path in it made absolute.
  const abs = (p) => (typeof p === "string" && !path.isAbsolute(p) ? path.join(root, p) : p);
  const cfg = JSON.parse(JSON.stringify(pkg.build));
  // Package OUTSIDE the repo: when the repo lives in an iCloud-synced folder (Desktop & Documents),
  // File Provider re-applies Finder info to every file there and codesign then refuses the bundle
  // ("resource fork, Finder information, or similar detritus not allowed"). Only the finished .dmg
  // (one file, signature inside) is copied back to release/.
  const outDir = path.join(os.tmpdir(), "pulseforge-release");
  fs.rmSync(outDir, { recursive: true, force: true });
  cfg.directories = { app: stage, output: outDir, buildResources: abs(cfg.directories.buildResources) };
  cfg.electronDist = abs(cfg.electronDist);
  cfg.afterPack = abs(cfg.afterPack);
  cfg.extraResources = cfg.extraResources.map((r) => ({ ...r, from: abs(r.from) }));
  cfg.mac.icon = abs(cfg.mac.icon);
  cfg.dmg.icon = abs(cfg.dmg.icon);
  cfg.electronVersion = electronVersion;
  cfg.extraMetadata = { version: pkg.version };
  const cfgPath = path.join(root, "dist-electron", "builder-config.json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  run(bin("electron-builder"), ["--mac", "dmg", "--arm64", "--publish", "never", "--projectDir", stage, "--config", cfgPath], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  const built = path.join(outDir, `PulseForge-Studio-${pkg.version}-arm64.dmg`);
  const dmg = path.join(root, "release", path.basename(built));
  if (fs.existsSync(built)) {
    fs.mkdirSync(path.dirname(dmg), { recursive: true });
    fs.copyFileSync(built, dmg);
  }
  if (!fs.existsSync(dmg)) {
    console.error(`[build-desktop] expected artifact missing: ${dmg}`);
    process.exit(1);
  }
  step(`done → ${path.relative(root, dmg)} (${(fs.statSync(dmg).size / 1048576).toFixed(1)} MiB)`);
  console.log(`[build-desktop] unpacked app (for smoke tests): ${path.join(outDir, "mac-arm64", "PulseForge Studio.app")}`);
}
