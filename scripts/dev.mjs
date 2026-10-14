// Dev launcher: backend (tsx watch) + Vite dev server, one command.
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["tsx", "watch", "server/index.ts"], { stdio: "inherit", env: { ...process.env, PF_API_PORT: "7801" } }),
  spawn("npx", ["vite"], { stdio: "inherit" }),
];
const kill = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", kill);
process.on("SIGTERM", kill);
procs.forEach((p) => p.on("exit", (code) => { if (code && code !== 0) { kill(); process.exit(code); } }));
