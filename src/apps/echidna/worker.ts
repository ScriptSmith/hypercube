/** Builds the echidna's spines and lookup off the page's thread, and posts them back. */
import { type Built, buildBody } from "./build";

export interface WorkerRequest {
  seed: string;
}

export type WorkerResponse = { ok: true; built: Built } | { ok: false; error: string };

/** The worker scope, typed by hand: the project's DOM lib and the webworker lib conflict. */
declare const self: {
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

self.onmessage = (e) => {
  try {
    const built = buildBody(e.data.seed);
    self.postMessage({ ok: true, built }, [
      built.words.buffer,
      built.spineData.buffer,
      built.noise.buffer,
    ]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
