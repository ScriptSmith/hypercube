/**
 * The live feed. brisbus's proxy serves the GTFS-realtime feed on a free tier shared with its own
 * users, so only the group's leader fetches it, every 15 s with a timeout, and relays the region's
 * vehicles to the group. A frame that hears nothing from the leader for 45 s (or has no room)
 * fetches for itself but doesn't relay. Failures back off. Preview frames never fetch.
 */
import type { Snapshot } from "./replay";

export const FEED_URL = "https://brisbus.adsm.dev/";
export const FETCH_EVERY_MS = 15_000;
export const FETCH_TIMEOUT_MS = 10_000;
/** A frame that hears nothing from the leader for this long fetches for itself. */
export const SILENCE_MS = 45_000;
/** A frame without a room yet waits this long for one before fetching on its own. */
export const OFFLINE_GRACE_MS = 4000;
/** Live data counts as current for this long; after that the replay plays. */
export const LIVE_FRESH_MS = 60_000;
/** After failures, wait this long before trying again (the last value repeats). */
export const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000] as const;

/** Fetch and decode the feed once; null on any failure or timeout. */
export type FeedFetcher = () => Promise<Snapshot | null>;

export interface LiveFeed {
  /** Fetch if this frame should and one is due. `now` is local ms. */
  tick(now: number, leader: boolean, online: boolean): void;
  /** A snapshot chunk from the leader. */
  heard(now: number): void;
  /** Local ms of the latest live data, fetched or heard. */
  readonly lastLive: number;
  readonly fetches: number;
  readonly failures: number;
  readonly busy: boolean;
  dispose(): void;
}

export const createLiveFeed = (opts: {
  fetcher: FeedFetcher;
  /** Local ms. */
  clock: () => number;
  /** A snapshot this frame fetched. */
  onFetched(snap: Snapshot, relay: boolean): void;
  /** Local ms when the feed starts: a non-leader waits SILENCE_MS from here for the leader. */
  start: number;
}): LiveFeed => {
  let lastHeard = opts.start;
  let lastLive = Number.NEGATIVE_INFINITY;
  let nextAt = 0;
  let busy = false;
  let streak = 0;
  let fetches = 0;
  let failures = 0;
  let disposed = false;

  return {
    tick(now, leader, online) {
      if (disposed || busy || now < nextAt) return;
      if (!online && now - opts.start < OFFLINE_GRACE_MS) return;
      const silent = now - lastHeard > SILENCE_MS;
      if (online && !leader && !silent) return;
      const relay = online && leader;
      busy = true;
      fetches++;
      nextAt = now + FETCH_EVERY_MS;
      opts.fetcher().then(
        (snap) => {
          busy = false;
          if (disposed) return;
          if (!snap) {
            failures++;
            nextAt = opts.clock() + BACKOFF_MS[Math.min(streak, BACKOFF_MS.length - 1)]!;
            streak++;
            return;
          }
          streak = 0;
          lastLive = opts.clock();
          opts.onFetched(snap, relay);
        },
        () => {
          busy = false;
          failures++;
          streak++;
        },
      );
    },
    heard(now) {
      lastHeard = now;
      lastLive = now;
      // The leader is back: don't fetch the moment this frame next counts as silent.
      nextAt = Math.max(nextAt, now + FETCH_EVERY_MS);
    },
    get lastLive() {
      return lastLive;
    },
    get fetches() {
      return fetches;
    },
    get failures() {
      return failures;
    },
    get busy() {
      return busy;
    },
    dispose() {
      disposed = true;
    },
  };
};

/**
 * Which data to show: live while it is fresh; otherwise the replay, once a live frame has waited
 * `bootWaitMs` for its first live data (preview frames and the replay variant play it at once).
 */
export const pickSource = (o: {
  live: LiveFeed | null;
  hasReplay: boolean;
  now: number;
  mountedAt: number;
  bootWaitMs: number;
}): "live" | "replay" | "none" => {
  if (o.live && o.now - o.live.lastLive < LIVE_FRESH_MS) return "live";
  if (o.hasReplay && (!o.live || o.now - o.mountedAt > o.bootWaitMs)) return "replay";
  return "none";
};
