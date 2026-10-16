// Production launcher: builds if needed, starts the backend (which also serves dist/),
// waits for health, optionally opens the browser.
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const port = flag("--port", process.env.PF_PORT ?? "7800");
const apiPort = flag("--api-port", process.env.PF_API_PORT ?? String(Number(port) + 1));
const noOpen = args.includes("--no-open");

if (!existsSync(path.join(root, "dist", "index.html"))) {
  console.log("[pulseforge] no production build found — running vite build…");
  execSync("npx vite build", { cwd: root, stdio: "inherit" });
}

// If a PulseForge is already running on this port, just open it instead of failing
// with EADDRINUSE. If something else owns the port, say so clearly.
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
  if (r.ok) {
    const body = await r.json().catch(() => ({}));
    if (String(body.name ?? "").includes("PulseForge")) {
      console.log(`[pulseforge] already running → http://127.0.0.1:${port}`);
      if (!noOpen && process.platform === "darwin") spawn("open", [`http://127.0.0.1:${port}`]);
      process.exit(0);
    }
    console.error(`[pulseforge] port ${port} is in use by another app. Set PF_PORT to a free port, e.g. PF_PORT=7900 npm run start`);
    process.exit(1);
  }
} catch {} // nothing on the port — normal startup


const server = spawn("npx", ["tsx", "server/index.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PF_API_PORT: apiPort, PF_STATIC_PORT: port, PF_SERVE_STATIC: "1" },
});
server.on("exit", (code) => process.exit(code ?? 0));

const healthURL = `http://127.0.0.1:${port}/api/health`;
const started = Date.now();
const wait = async () => {
  while (Date.now() - started < 120000) {
    try {
      const r = await fetch(healthURL);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
if (await wait()) {
  console.log(`[pulseforge] ready → http://127.0.0.1:${port}`);
  if (!noOpen && process.platform === "darwin") spawn("open", [`http://127.0.0.1:${port}`]);
} else {
  console.error(`[pulseforge] server did not become healthy at ${healthURL} within 120s (still starting — it will keep trying)`);
}
