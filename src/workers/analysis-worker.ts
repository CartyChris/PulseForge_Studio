/// <reference lib="webworker" />
/**
 * Analysis worker: waveform peaks, transient/silence detection, BPM & key estimates.
 * Keeps the UI thread free while big buffers are crunched.
 */
import { computePeaks, detectTransients, detectSilence, estimateBpm, estimateKey } from "../engine/analysis";

export interface AnalysisRequest {
  id: string;
  kind: "peaks" | "analyze" | "transients";
  data: Float32Array;
  sampleRate: number;
  buckets?: number;
  sensitivity?: number;
}
export interface AnalysisResponse {
  id: string;
  kind: AnalysisRequest["kind"];
  peaks?: Float32Array;
  transients?: number[];
  silence?: Array<[number, number]>;
  bpm?: number | null;
  key?: string | null;
  error?: string;
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const req = e.data;
  try {
    if (req.kind === "peaks") {
      const peaks = computePeaks(req.data, req.buckets ?? 1000);
      (self as unknown as Worker).postMessage({ id: req.id, kind: req.kind, peaks } satisfies AnalysisResponse, [peaks.buffer]);
    } else if (req.kind === "transients") {
      const transients = detectTransients(req.data, req.sampleRate, req.sensitivity ?? 1.5);
      (self as unknown as Worker).postMessage({ id: req.id, kind: req.kind, transients } satisfies AnalysisResponse);
    } else {
      const resp: AnalysisResponse = {
        id: req.id,
        kind: req.kind,
        transients: detectTransients(req.data, req.sampleRate),
        silence: detectSilence(req.data, req.sampleRate),
        bpm: estimateBpm(req.data, req.sampleRate),
        key: req.data.length > req.sampleRate * 2 ? estimateKey(req.data, req.sampleRate) : null,
      };
      (self as unknown as Worker).postMessage(resp);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, kind: req.kind, error: String(err) } satisfies AnalysisResponse);
  }
};
