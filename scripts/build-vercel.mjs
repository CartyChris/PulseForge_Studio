#!/usr/bin/env node
// Vercel build (Build Output API v3): vite build → static files, and the API bundled by esbuild
// into ONE self-contained function. Bundling avoids relying on Vercel compiling the server's
// TypeScript (its ESM imports are extension-less, which Node can't resolve at runtime).
//
//   node scripts/build-vercel.mjs      (Vercel runs this via vercel.json "buildCommand")
//
// Output: .vercel/output/{config.json, static/**, functions/api.func/{index.mjs,.vc-config.json}}
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".vercel", "output");
const step = (m) => console.log(`\n[build-vercel] ${m}`);

step("vite build");
const vite = spawnSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: root, stdio: "inherit" });
if (vite.status !== 0) process.exit(vite.status || 1);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

step("static files");
fs.cpSync(path.join(root, "dist"), path.join(out, "static"), { recursive: true });

step("bundling the API function with esbuild");
const fn = path.join(out, "functions", "api.func");
fs.mkdirSync(fn, { recursive: true });
const esbuild = await import("esbuild");
const result = await esbuild.build({
  entryPoints: [path.join(root, "api", "index.ts")],
  outfile: path.join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  legalComments: "inline",
  logLevel: "warning",
  // bundled CommonJS dependencies (fastify & co.) call require() for Node built-ins
  banner: { js: "import { createRequire as __pfCreateRequire } from 'node:module'; const require = __pfCreateRequire(import.meta.url);" },
  // electron only exists in the desktop app; pino's optional pretty transport is never used
  external: ["electron", "pino-pretty"],
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`[build-vercel] api.func/index.mjs ${(bytes / 1024).toFixed(0)} KiB, ${Object.keys(result.metafile.inputs).length} inputs`);
fs.writeFileSync(path.join(fn, "package.json"), JSON.stringify({ type: "module" }));
fs.writeFileSync(path.join(fn, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs22.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  maxDuration: 60,
}, null, 2));

step("routes");
const immutable = { "Cache-Control": "public, max-age=31536000, immutable" };
fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "^/samples/(.*)$", headers: immutable, continue: true },
    { src: "^/assets/(.*)$", headers: immutable, continue: true },
    // every /api/* call goes to the one function; the original path travels in __pfp
    { src: "^/api/(.*)$", dest: "/api?__pfp=$1" },
    { handle: "filesystem" },
  ],
}, null, 2));
console.log("[build-vercel] done → .vercel/output");
