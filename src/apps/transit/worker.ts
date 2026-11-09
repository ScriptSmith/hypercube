/**
 * The app's network and parsing thread. Every request the app makes goes through here, map
 * glyphs and tile metadata included, so the page stays responsive and a failed request never
 * prints a console error on the page (a refused or unreachable server is a normal state for this
 * app). It also parses the day's static GTFS and decodes the realtime feed.
 */
import { createNetworkBuilder, type PackedNetwork, readCsvStream } from "./gtfs";
import { decodeFeed } from "./pbf";
import type { Snapshot } from "./replay";
import { feedToSnapshot } from "./wire";

export type WorkerRequest =
  | { id: number; op: "fetch"; url: string; timeout: number }
  | { id: number; op: "feed"; url: string; timeout: number }
  | { id: number; op: "static"; base: string; timeout: number };

export type WorkerResponse =
  | { id: number; ok: true; data: ArrayBuffer }
  | { id: number; ok: true; snap: Snapshot }
  | { id: number; ok: true; net: PackedNetwork }
  | { id: number; ok: false; error: string };

/** The worker scope, typed by hand: the project's DOM lib and the webworker lib conflict. */
declare const self: {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

/** Trip id to direction, kept from the day's trips to fill in what the feed leaves out. */
let tripDirection: Map<string, number> | null = null;

const withTimeout = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await run(abort.signal);
  } finally {
    clearTimeout(timer);
  }
};

const getBytes = (url: string, timeout: number, cache?: RequestCache) =>
  withTimeout(timeout, async (signal) => {
    const res = await fetch(url, { signal, cache });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });

const loadStatic = async (base: string, timeout: number): Promise<PackedNetwork> => {
  const builder = createNetworkBuilder({ tolerance: 5, quantum: 1, headsigns: true });
  for (const [name, row] of [
    ["routes", builder.route],
    ["trips", builder.trip],
    ["shapes", builder.shapePoint],
  ] as const) {
    await withTimeout(timeout, async (signal) => {
      const res = await fetch(`${base}${name}.txt.gz`, { signal });
      if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`);
      await readCsvStream(res.body, true, row);
    });
  }
  tripDirection = builder.tripDirection;
  return builder.build();
};

const reply = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  const fail = (err: unknown) => reply({ id: m.id, ok: false, error: String(err) });
  if (m.op === "fetch") {
    getBytes(m.url, m.timeout).then((data) => reply({ id: m.id, ok: true, data }, [data]), fail);
  } else if (m.op === "feed") {
    getBytes(m.url, m.timeout, "no-store")
      .then((data) => {
        const snap = feedToSnapshot(
          decodeFeed(data),
          Date.now() / 1000,
          tripDirection ?? undefined,
        );
        reply({ id: m.id, ok: true, snap });
      })
      .catch(fail);
  } else if (m.op === "static") {
    loadStatic(m.base, m.timeout).then((net) => reply({ id: m.id, ok: true, net }), fail);
  }
};
