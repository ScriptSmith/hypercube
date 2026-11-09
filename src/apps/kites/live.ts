/**
 * Today's real wind from Open-Meteo's forecast API (current wind speed, gusts and direction at
 * 10 m). Only the group's leader fetches, at most every 10 minutes and with a timeout; everyone
 * else uses what the leader last sent. Any failure leaves the wind breezy until the next try.
 * The data is CC BY 4.0, so the attribution shows while live wind is in use.
 */
import type { WindMsg } from "./wire";

export const ATTRIBUTION = "Weather data by Open-Meteo.com";
export const FETCH_EVERY_MS = 10 * 60_000;
/** After a failure, try again sooner. */
export const RETRY_MS = 2 * 60_000;
export const TIMEOUT_MS = 8000;

export const forecastUrl = (lat: number, lon: number): string => {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    wind_speed_unit: "ms",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
};

/** The wind in a forecast response, or null when it isn't there or makes no sense. */
export const parseForecast = (body: unknown): WindMsg | null => {
  if (typeof body !== "object" || body === null) return null;
  const current = (body as { current?: unknown }).current;
  if (typeof current !== "object" || current === null) return null;
  const c = current as Record<string, unknown>;
  const speed = c.wind_speed_10m;
  const gusts = c.wind_gusts_10m;
  const from = c.wind_direction_10m;
  const ok = (v: unknown, max: number): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
  if (!ok(speed, 60) || !ok(from, 360)) return null;
  return { speed, gusts: ok(gusts, 90) ? Math.max(gusts, speed) : speed, from };
};

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Fetch the current wind once. Resolves null on any failure or after TIMEOUT_MS. */
export const fetchWind = async (
  lat: number,
  lon: number,
  fetcher: Fetcher = (u, i) => fetch(u, i),
  timeoutMs = TIMEOUT_MS,
): Promise<WindMsg | null> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetcher(forecastUrl(lat, lon), { signal: abort.signal });
    if (!res.ok) return null;
    return parseForecast(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export interface LiveWind {
  /** Ask for a fetch if this frame leads and one is due. `now` is local ms. */
  tick(now: number, leader: boolean): void;
  /** The latest wind, from our own fetch or the leader's message, or null. */
  readonly wind: WindMsg | null;
  /** Local ms of the latest wind. */
  readonly at: number;
  /** Use a wind the leader sent. */
  heard(w: WindMsg, now: number): void;
  readonly fetches: number;
  readonly failures: number;
  dispose(): void;
}

export const createLiveWind = (opts: {
  lat: number;
  lon: number;
  /** Called with each wind this frame fetched, to share with the group. */
  onFetched(w: WindMsg): void;
  fetcher?: Fetcher;
}): LiveWind => {
  let wind: WindMsg | null = null;
  let at = Number.NEGATIVE_INFINITY;
  let nextAt = 0;
  let busy = false;
  let fetches = 0;
  let failures = 0;
  let disposed = false;
  return {
    tick(now, leader) {
      if (!leader || busy || disposed || now < nextAt) return;
      busy = true;
      fetches++;
      nextAt = now + FETCH_EVERY_MS;
      void fetchWind(opts.lat, opts.lon, opts.fetcher).then((w) => {
        busy = false;
        if (disposed) return;
        if (!w) {
          failures++;
          nextAt = now + RETRY_MS;
          return;
        }
        wind = w;
        at = now;
        opts.onFetched(w);
      });
    },
    get wind() {
      return wind;
    },
    get at() {
      return at;
    },
    heard(w, now) {
      wind = w;
      at = now;
      // Someone else leads: don't fetch the moment we take over.
      nextAt = Math.max(nextAt, now + FETCH_EVERY_MS / 2);
    },
    get fetches() {
      return fetches;
    },
    get failures() {
      return failures;
    },
    dispose() {
      disposed = true;
    },
  };
};
