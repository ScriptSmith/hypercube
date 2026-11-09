import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MS,
  createLiveFeed,
  FEED_URL,
  FETCH_EVERY_MS,
  LIVE_FRESH_MS,
  OFFLINE_GRACE_MS,
  pickSource,
  SILENCE_MS,
} from "../../../src/apps/transit/feed";
import { createIO } from "../../../src/apps/transit/io";
import type { Snapshot } from "../../../src/apps/transit/replay";
import { buildFeed } from "./helpers";

const T = 1_792_675_000;
const snap: Snapshot = { t: T, vehicles: [], source: "live" };
const flush = () => new Promise((r) => setTimeout(r, 0));

const feedWith = (results: (Snapshot | null)[]) => {
  let now = 0;
  const fetched: Snapshot[] = [];
  const relays: boolean[] = [];
  const fetcher = vi.fn(async () => results.shift() ?? null);
  const live = createLiveFeed({
    fetcher,
    clock: () => now,
    start: 0,
    onFetched(s, relay) {
      fetched.push(s);
      relays.push(relay);
    },
  });
  return {
    live,
    fetcher,
    fetched,
    relays,
    async at(t: number, leader: boolean, online = true) {
      now = t;
      live.tick(t, leader, online);
      await flush();
    },
  };
};

describe("live feed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetches only on the leader, every 15 s, and relays what it fetched", async () => {
    const f = feedWith([snap, snap, snap]);
    await f.at(0, true);
    await f.at(5000, true);
    await f.at(FETCH_EVERY_MS, true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.relays).toEqual([true, true]);
    expect(f.live.lastLive).toBe(FETCH_EVERY_MS);
  });

  it("leaves a non-leader quiet while the leader is heard, then fetches without relaying", async () => {
    const f = feedWith([snap]);
    await f.at(1000, false);
    f.live.heard(20_000);
    await f.at(20_000 + SILENCE_MS - 1, false);
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.at(20_000 + SILENCE_MS + 1, false);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.relays).toEqual([false]);
  });

  it("fetches for itself with no room, after a grace for joining one, and doesn't relay", async () => {
    const f = feedWith([snap]);
    await f.at(0, false, false);
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.at(OFFLINE_GRACE_MS, false, false);
    expect(f.relays).toEqual([false]);
  });

  it("backs off after failures and recovers", async () => {
    const f = feedWith([null, null, null, snap]);
    await f.at(0, true);
    expect(f.live.failures).toBe(1);
    await f.at(BACKOFF_MS[0] - 1, true);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await f.at(BACKOFF_MS[0], true);
    expect(f.live.failures).toBe(2);
    const second = BACKOFF_MS[0] + BACKOFF_MS[1];
    await f.at(second - 1, true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await f.at(second, true);
    await f.at(second + BACKOFF_MS[2], true);
    expect(f.fetched).toHaveLength(1);
    expect(f.live.fetches).toBe(4);
  });

  it("never runs two fetches at once", async () => {
    let release: (s: Snapshot | null) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Snapshot | null>((r) => (release = r)));
    const live = createLiveFeed({ fetcher, clock: () => 0, start: 0, onFetched() {} });
    live.tick(0, true, true);
    live.tick(FETCH_EVERY_MS * 3, true, true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(snap);
    await flush();
    live.tick(FETCH_EVERY_MS * 3, true, true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("source choice", () => {
  const live = (lastLive: number) =>
    ({ lastLive }) as unknown as Parameters<typeof pickSource>[0]["live"];

  it("plays live while it is fresh, the replay after the boot wait, and nothing before", () => {
    const base = { hasReplay: true, mountedAt: 0, bootWaitMs: 8000 };
    expect(pickSource({ ...base, live: live(-Infinity), now: 3000 })).toBe("none");
    expect(pickSource({ ...base, live: live(-Infinity), now: 8001 })).toBe("replay");
    expect(pickSource({ ...base, live: live(9000), now: 10_000 })).toBe("live");
    expect(pickSource({ ...base, live: live(9000), now: 9000 + LIVE_FRESH_MS + 1 })).toBe("replay");
  });

  it("plays the replay at once without a live feed (preview, replay variant)", () => {
    expect(
      pickSource({ live: null, hasReplay: true, now: 0, mountedAt: 0, bootWaitMs: 8000 }),
    ).toBe("replay");
    expect(
      pickSource({ live: null, hasReplay: false, now: 0, mountedAt: 0, bootWaitMs: 8000 }),
    ).toBe("none");
  });
});

describe("fetching the feed (main-thread fallback, fetch mocked)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const io = () => createIO(() => null);

  it("decodes a feed into the region's vehicles", async () => {
    const body = buildFeed(T, [{ id: "a", route: "60-1", lat: -27.47, lon: 153.02, timestamp: T }]);
    const fetch = vi.fn(async () => new Response(body as unknown as BodyInit));
    vi.stubGlobal("fetch", fetch);
    const s = await io().feed(FEED_URL, 5000);
    expect(fetch).toHaveBeenCalledWith(FEED_URL, expect.objectContaining({ cache: "no-store" }));
    expect(s?.vehicles.map((v) => v.route)).toEqual(["60"]);
  });

  it("gives null on an HTTP error, a refused request or a garbled body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 })),
    );
    expect(await io().feed(FEED_URL, 5000)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await io().feed(FEED_URL, 5000)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Uint8Array.from([0x0a, 0x50]) as unknown as BodyInit)),
    );
    expect(await io().feed(FEED_URL, 5000)).toBeNull();
  });

  it("gives null after the timeout when the server never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const pending = io().feed(FEED_URL, 5000);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toBeNull();
  });

  it("has no static data without the worker", async () => {
    expect(await io().loadStatic("https://example.invalid/", 1000)).toBeNull();
  });
});

describe("the worker client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A worker that answers each request with `answer`, or never. */
  const fakeWorker = (answer: ((req: { id: number; op: string }) => unknown) | null) => {
    const w = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null as unknown,
      posted: [] as { id: number; op: string }[],
      postMessage(req: { id: number; op: string }) {
        w.posted.push(req);
        if (answer) queueMicrotask(() => w.onmessage?.({ data: answer(req) }));
      },
      terminate: vi.fn(),
    };
    return w;
  };

  it("matches answers to requests", async () => {
    const w = fakeWorker((req) => ({ id: req.id, ok: true, snap }));
    const client = createIO(() => w as unknown as Worker);
    expect(await client.feed(FEED_URL, 1000)).toEqual(snap);
    expect(w.posted[0]).toMatchObject({ op: "feed", url: FEED_URL });
    expect(client.pending).toBe(0);
  });

  it("settles a request the worker never answers, and on dispose", async () => {
    vi.useFakeTimers();
    const w = fakeWorker(null);
    const client = createIO(() => w as unknown as Worker);
    const a = client.feed(FEED_URL, 1000);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await a).toBeNull();
    const b = client.fetchBytes("https://example.invalid/x", 1000);
    client.dispose();
    await expect(b).rejects.toThrow();
    expect(w.terminate).toHaveBeenCalled();
  });

  it("falls back to the main thread when the worker can't start", async () => {
    const client = createIO(() => {
      throw new Error("no workers here");
    });
    expect(client.threaded).toBe(false);
  });
});
