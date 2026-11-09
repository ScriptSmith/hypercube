/**
 * The main thread's side of the worker: requests with ids, each settling within its timeout even
 * if the worker never answers. Without a worker (it failed to start) the same requests run on the
 * main thread, except the static data, which is too heavy to parse there.
 */
import type { PackedNetwork } from "./gtfs";
import { decodeFeed } from "./pbf";
import type { Snapshot } from "./replay";
import type { WorkerRequest, WorkerResponse } from "./worker";
import { feedToSnapshot } from "./wire";

export interface TransitIO {
  /** Bytes from `url`; rejects on failure or after `timeout` ms. */
  fetchBytes(url: string, timeout: number): Promise<ArrayBuffer>;
  /** The region's vehicles from the realtime feed, or null. */
  feed(url: string, timeout: number): Promise<Snapshot | null>;
  /** The day's network from brisbus's static files, or null. */
  loadStatic(base: string, timeout: number): Promise<PackedNetwork | null>;
  readonly threaded: boolean;
  /** Requests waiting for an answer. */
  readonly pending: number;
  dispose(): void;
}

const MAX_PENDING = 96;
/** Extra time past a request's own timeout before the client gives up on the worker. */
const GRACE_MS = 5000;

type Pending = { resolve(r: WorkerResponse): void; timer: ReturnType<typeof setTimeout> };
type Request = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, "id">
    : never
  : never;

export const createIO = (makeWorker: () => Worker | null): TransitIO => {
  let worker: Worker | null = null;
  try {
    worker = makeWorker();
  } catch {
    worker = null;
  }
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;

  if (worker) {
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      clearTimeout(p.timer);
      p.resolve(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
    };
  }

  const ask = (req: Request, timeout: number): Promise<WorkerResponse> => {
    const id = nextId++;
    if (!worker || disposed) return Promise.resolve({ id, ok: false, error: "no worker" });
    if (pending.size >= MAX_PENDING) return Promise.resolve({ id, ok: false, error: "busy" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, ok: false, error: "timeout" });
      }, timeout + GRACE_MS);
      pending.set(id, { resolve, timer });
      worker!.postMessage({ ...req, id } as WorkerRequest);
    });
  };

  const direct = async (url: string, timeout: number, cache?: RequestCache) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const res = await fetch(url, { signal: abort.signal, cache });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async fetchBytes(url, timeout) {
      if (!worker) return direct(url, timeout);
      const r = await ask({ op: "fetch", url, timeout }, timeout);
      if (r.ok && "data" in r) return r.data;
      throw new Error(r.ok ? "bad reply" : r.error);
    },
    async feed(url, timeout) {
      if (!worker) {
        try {
          return feedToSnapshot(
            decodeFeed(await direct(url, timeout, "no-store")),
            Date.now() / 1000,
          );
        } catch {
          return null;
        }
      }
      const r = await ask({ op: "feed", url, timeout }, timeout);
      return r.ok && "snap" in r ? r.snap : null;
    },
    async loadStatic(base, timeout) {
      if (!worker) return null;
      // Three files, each with its own timeout.
      const r = await ask({ op: "static", base, timeout }, timeout * 3);
      return r.ok && "net" in r ? r.net : null;
    },
    get threaded() {
      return worker !== null;
    },
    get pending() {
      return pending.size;
    },
    dispose() {
      disposed = true;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ id, ok: false, error: "disposed" });
      }
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
};
