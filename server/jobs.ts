/** In-memory job manager with SSE broadcast. Generated assets land in PF_DIR/assets. */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PF_DIR, ensureDir } from "./secrets";

export interface Job {
  id: string;
  kind: string;
  providerId: string;
  model: string;
  prompt: string;
  durationSec?: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  error?: string;
  assetId?: string;
  /** stem-separation jobs: stem name → assetId */
  stems?: Record<string, string>;
  mime?: string;
  licenseNote?: string;
  createdAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, Job>();
const cancelFlags = new Map<string, AbortController>();
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

let counter = 0;
export function createJob(init: Pick<Job, "kind" | "providerId" | "model" | "prompt" | "durationSec">): Job {
  const job: Job = {
    id: `job_${Date.now().toString(36)}_${(counter++).toString(36)}`,
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString(),
    ...init,
  };
  jobs.set(job.id, job);
  cancelFlags.set(job.id, new AbortController());
  emit(job);
  // bounded history
  if (jobs.size > 200) {
    const oldest = [...jobs.keys()].slice(0, jobs.size - 200);
    oldest.forEach((k) => { jobs.delete(k); cancelFlags.delete(k); });
  }
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  if (["completed", "failed", "cancelled"].includes(job.status) && !job.finishedAt) {
    job.finishedAt = new Date().toISOString();
  }
  emit(job);
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return false;
  cancelFlags.get(id)?.abort();
  updateJob(id, { status: "cancelled" });
  return true;
}

export function isCancelled(id: string): boolean {
  return jobs.get(id)?.status === "cancelled";
}

function emit(job: Job): void {
  jobEvents.emit("job", { ...job });
}

// ---------- asset storage ----------
const ASSET_DIR = () => path.join(PF_DIR, "assets");
const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac", "audio/mp4": "m4a" };

export function saveAsset(jobId: string, data: Buffer, mime: string): string {
  ensureDir();
  fs.mkdirSync(ASSET_DIR(), { recursive: true });
  const ext = EXT[mime.split(";")[0]!] ?? "bin";
  const assetId = `${jobId}.${ext}`;
  fs.writeFileSync(path.join(ASSET_DIR(), assetId), data);
  return assetId;
}

export function readAsset(assetId: string): { data: Buffer; mime: string } | null {
  // strict allowlist: job-id-shaped names only — no traversal possible
  if (!/^[a-zA-Z0-9_-]+\.[a-z0-9]{2,4}$/.test(assetId)) return null;
  const file = path.join(ASSET_DIR(), assetId);
  if (!fs.existsSync(file)) return null;
  const ext = assetId.split(".").pop()!;
  const mime = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return { data: fs.readFileSync(file), mime };
}
