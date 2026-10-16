// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// Mode flags must be set before the backend modules load (secrets.ts reads PF_DATA_DIR at import).
process.env.PF_SERVERLESS = "1";
process.env.PF_DATA_DIR = process.env.PF_DATA_DIR ?? "/tmp/pulseforge";
process.env.PF_NO_SHELL_ENV = "1";

import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const mod = await import("../server/serverless");
  return mod.default(req, res);
}

export const config = { maxDuration: 60 };
