// Dev launcher: backend (tsx watch) + Vite dev server, one command.
// Anchored to the project root so it works no matter which directory launches it.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const procs = [
  spawn("npx", ["tsx", "watch", "server/index.ts"], { stdio: "inherit", cwd: root, env: { ...process.env, PF_API_PORT: "7801" } }),
  spawn("npx", ["vite"], { stdio: "inherit", cwd: root }),
];
const kill = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", kill);
process.on("SIGTERM", kill);
procs.forEach((p) => p.on("exit", (code) => { if (code && code !== 0) { kill(); process.exit(code); } }));
