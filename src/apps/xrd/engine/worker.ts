/**
 * The engine's thread: one per frame, shared by every chapter on it. It runs one job at a time
 * and posts the bytes back (transferred, not copied).
 */
import { type EngineJob, run } from "./pattern";

export interface WorkerRequest {
  id: number;
  job: EngineJob;
}

export type WorkerResponse =
  | { id: number; ok: true; bytes: Uint8Array; peak: number; ms: number }
  | { id: number; ok: false; error: string };

/** The worker scope, typed by hand: the project's DOM lib and the webworker lib conflict. */
declare const self: {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

self.onmessage = (e) => {
  const { id, job } = e.data;
  const t0 = performance.now();
  try {
    const r = run(job);
    const msg: WorkerResponse = {
      id,
      ok: true,
      bytes: r.bytes,
      peak: r.peak,
      ms: performance.now() - t0,
    };
    self.postMessage(msg, [r.bytes.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) } satisfies WorkerResponse);
  }
};
