/** Promise-based client for the analysis worker, with job cancellation. */
import type { AnalysisRequest, AnalysisResponse } from "./analysis-worker";
import { newId } from "../../shared/project";

let worker: Worker | null = null;
const pending = new Map<string, { resolve: (r: AnalysisResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<AnalysisResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
  }
  return worker;
}

export function runAnalysis(kind: AnalysisRequest["kind"], data: Float32Array, sampleRate: number, extra: Partial<AnalysisRequest> = {}): { promise: Promise<AnalysisResponse>; cancel: () => void } {
  const id = newId("job");
  const copy = data.slice(); // transfer a copy; caller keeps its buffer
  const promise = new Promise<AnalysisResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, kind, data: copy, sampleRate, ...extra } satisfies AnalysisRequest, [copy.buffer]);
  });
  return {
    promise,
    cancel: () => {
      // worker jobs are short; cancellation just abandons the result
      pending.delete(id);
    },
  };
}

export async function getPeaks(data: Float32Array, sampleRate: number, buckets: number): Promise<Float32Array> {
  const { promise } = runAnalysis("peaks", data, sampleRate, { buckets });
  return (await promise).peaks ?? new Float32Array(buckets * 2);
}
