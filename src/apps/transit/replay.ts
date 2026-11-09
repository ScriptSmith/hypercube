/**
 * The bundled replay: a few minutes of the region's vehicle positions, recorded from the proxy by
 * `scripts/transit-record.mjs`. It holds numbers and route ids only: no vehicle ids or labels, no
 * names. It plays in a loop on the shared clock, so every frame in a group shows the same moment
 * without messages, and it feeds the fleet the same snapshots a live fetch would.
 */
import { REGION } from "./geo";

export interface ReplayData {
  v: 1;
  region: [number, number, number, number];
  /** Unix seconds of the first fetch. */
  start: number;
  /** Seconds the recording covers; playback loops with this period. */
  duration: number;
  /** Seconds between fetches when it was recorded. */
  every: number;
  /** Route base ids. */
  routes: string[];
  /**
   * One per vehicle and route: route index, direction (0, 1, or 2 when unknown), then fixes as
   * seconds since `start` and metres from the region's corner, the first absolute and the rest
   * as deltas.
   */
  tracks: number[][];
}

export interface Track {
  route: number;
  /** 0, 1, or -1 when unknown. */
  dir: number;
  /** Seconds since start, ascending. */
  t: Float64Array;
  x: Float32Array;
  y: Float32Array;
}

export interface Replay {
  start: number;
  duration: number;
  every: number;
  routes: string[];
  tracks: Track[];
}

/** One vehicle as a snapshot gives it, live or replayed. */
export interface SnapVehicle {
  key: number;
  /** Route base id, or "" when unknown. */
  route: string;
  dir: number;
  x: number;
  y: number;
  /** Degrees, or -1. */
  bearing: number;
  /** Unix seconds of the fix. */
  ts: number;
}

export interface Snapshot {
  /** Unix seconds of the feed (or replay moment). */
  t: number;
  vehicles: SnapVehicle[];
  source: "live" | "replay";
}

const MAX_TRACKS = 4000;
const MAX_FIXES = 400;

/** Check and unpack replay JSON. Returns null when it doesn't match this region or is malformed. */
export const decodeReplay = (data: unknown): Replay | null => {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Partial<ReplayData>;
  if (d.v !== 1 || !Array.isArray(d.region) || !Array.isArray(d.routes) || !Array.isArray(d.tracks))
    return null;
  const [w, s, e, n] = d.region;
  if (w !== REGION.west || s !== REGION.south || e !== REGION.east || n !== REGION.north)
    return null;
  const duration = Number(d.duration);
  const every = Number(d.every);
  const start = Number(d.start);
  if (!(duration > 0 && duration < 7200 && every > 0 && every < 300 && start > 0)) return null;
  const routes = d.routes.filter((r): r is string => typeof r === "string");
  if (routes.length !== d.routes.length) return null;
  const tracks: Track[] = [];
  for (const raw of d.tracks.slice(0, MAX_TRACKS)) {
    if (!Array.isArray(raw) || raw.length < 5 || (raw.length - 2) % 3 !== 0) continue;
    const route = raw[0];
    const dir = raw[1];
    if (typeof route !== "number" || route < 0 || route >= routes.length) continue;
    const count = Math.min(MAX_FIXES, (raw.length - 2) / 3);
    const t = new Float64Array(count);
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    let tt = 0;
    let xx = 0;
    let yy = 0;
    let ok = true;
    for (let i = 0; i < count; i++) {
      const a = Number(raw[2 + i * 3]);
      const b = Number(raw[3 + i * 3]);
      const c = Number(raw[4 + i * 3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
        ok = false;
        break;
      }
      tt = i === 0 ? a : tt + a;
      xx = i === 0 ? b : xx + b;
      yy = i === 0 ? c : yy + c;
      t[i] = tt;
      x[i] = xx;
      y[i] = yy;
    }
    if (!ok) continue;
    tracks.push({ route, dir: dir === 0 || dir === 1 ? dir : -1, t, x, y });
  }
  return { start, duration, every, routes, tracks };
};

/** Pack tracks for the bundle: integer seconds and metres, deltas after the first fix. */
export const encodeReplay = (r: Replay): ReplayData => ({
  v: 1,
  region: [REGION.west, REGION.south, REGION.east, REGION.north],
  start: r.start,
  duration: r.duration,
  every: r.every,
  routes: r.routes,
  tracks: r.tracks.map((tr) => {
    const out = [tr.route, tr.dir === 0 || tr.dir === 1 ? tr.dir : 2];
    let pt = 0;
    let px = 0;
    let py = 0;
    for (let i = 0; i < tr.t.length; i++) {
      const t = Math.round(tr.t[i]!);
      const x = Math.round(tr.x[i]!);
      const y = Math.round(tr.y[i]!);
      out.push(i === 0 ? t : t - pt, i === 0 ? x : x - px, i === 0 ? y : y - py);
      pt = t;
      px = x;
      py = y;
    }
    return out;
  }),
});

/** Replayed vehicle keys are negative, so they never collide with live ones. */
export const replayKey = (loop: number, track: number): number =>
  -(1 + (loop % 1000) * 10_000 + track);

/** How long after its last fix a replayed vehicle stays in snapshots. */
const STALE_S = 120;

/**
 * The snapshot the replay gives at loop time `tau` (seconds into the loop): every track's latest
 * fix at or before it. `loop` counts whole loops, so a new loop brings new keys and the previous
 * loop's vehicles fade out rather than jumping back.
 */
export const replaySnapshot = (r: Replay, tau: number, loop: number): Snapshot => {
  const vehicles: SnapVehicle[] = [];
  r.tracks.forEach((tr, i) => {
    const n = tr.t.length;
    if (n === 0 || tr.t[0]! > tau) return;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tr.t[mid]! <= tau) lo = mid;
      else hi = mid - 1;
    }
    if (tau - tr.t[lo]! > STALE_S && lo === n - 1) return;
    vehicles.push({
      key: replayKey(loop, i),
      route: r.routes[tr.route] ?? "",
      dir: tr.dir,
      x: tr.x[lo]!,
      y: tr.y[lo]!,
      bearing: -1,
      ts: r.start + loop * r.duration + tr.t[lo]!,
    });
  });
  return { t: r.start + loop * r.duration + tau, vehicles, source: "replay" };
};
