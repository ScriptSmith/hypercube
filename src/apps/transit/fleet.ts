/**
 * Every vehicle on the map and how it moves. Positions arrive in snapshots (live every 15 s or so,
 * or from the replay); each new fix starts a leg from where the vehicle is drawn now to the fix,
 * along its route's shape when one matches, timed to last about as long as the gap between its
 * fixes. So vehicles keep moving at their real pace, a fix behind, and never jump.
 *
 * Everything is bounded: the number of vehicles, each leg's points and each trail's samples.
 * Vehicles not heard for three minutes fade out and are dropped.
 */
import { dist } from "./geo";
import { pathBetween, shapeHeading } from "./match";
import { modeOf, type Network, shapesFor } from "./network";
import type { Snapshot } from "./replay";
import type { Mode } from "./routes";

export const MAX_VEHICLES = 3000;
export const TRAIL_MAX = 48;
export const TRAIL_EVERY_MS = 2500;
export const TRAIL_MS = 120_000;
export const FADE_AFTER_MS = 180_000;
export const FADE_OUT_MS = 20_000;
export const FADE_IN_MS = 1200;
export const RETIRE_MS = 1500;
/** A fix this far from where the vehicle is drawn is a jump, not a journey. */
export const TELEPORT_M = 2500;
const MIN_LEG_MS = 6000;
const MAX_LEG_MS = 40_000;
const STILL_M = 3;
const TURN_RATE = 5;

export interface Vehicle {
  readonly key: number;
  route: string;
  mode: Mode;
  dir: number;
  source: Snapshot["source"];
  /** The current leg, flat x, y pairs in local metres, with distances along it. */
  path: Float32Array;
  cum: Float32Array;
  total: number;
  legStart: number;
  legDur: number;
  cursor: number;
  /** Unix seconds of the latest fix. */
  fixTs: number;
  /** Where it is drawn now. */
  x: number;
  y: number;
  /** Compass radians. */
  heading: number;
  headingKnown: boolean;
  born: number;
  heard: number;
  retired: number;
  alpha: number;
  /** Ring buffer of recent positions, oldest at `trailStart`. */
  trail: Float32Array;
  trailT: Float64Array;
  trailStart: number;
  trailN: number;
  lastSample: number;
  lastStep: number;
}

const wrap = (a: number): number => {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r < -Math.PI) r += 2 * Math.PI;
  return r;
};

const legOf = (
  pts: readonly number[],
): { path: Float32Array; cum: Float32Array; total: number } => {
  const path = Float32Array.from(pts);
  const n = path.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] =
      cum[i - 1]! +
      Math.hypot(path[i * 2]! - path[i * 2 - 2]!, path[i * 2 + 1]! - path[i * 2 - 1]!);
  }
  return { path, cum, total: cum[n - 1] ?? 0 };
};

export interface Fleet {
  readonly vehicles: ReadonlyMap<number, Vehicle>;
  apply(snap: Snapshot, now: number, net: Network): void;
  step(now: number): void;
  /** Fade out the vehicles `pick` selects, such as the replay's once live data arrives. */
  retire(pick: (v: Vehicle) => boolean, now: number): void;
  /** Recompute modes after the network changes. */
  remode(net: Network): void;
  /** Vehicles drawn now (alpha above zero). */
  count(): number;
  clear(): void;
}

export const createFleet = (opts: { trails: boolean }): Fleet => {
  const vehicles = new Map<number, Vehicle>();

  const place = (v: Vehicle, x: number, y: number) => {
    const leg = legOf([x, y, x, y]);
    v.path = leg.path;
    v.cum = leg.cum;
    v.total = 0;
    v.legDur = 0;
    v.cursor = 0;
    v.x = x;
    v.y = y;
  };

  const clearTrail = (v: Vehicle) => {
    v.trailStart = 0;
    v.trailN = 0;
  };

  const advance = (v: Vehicle, now: number) => {
    const dt = Math.min(0.5, Math.max(0, (now - v.lastStep) / 1000));
    v.lastStep = now;
    if (v.total <= 0) return;
    const p = v.legDur > 0 ? Math.min(1, Math.max(0, (now - v.legStart) / v.legDur)) : 1;
    const s = p * v.total;
    const n = v.path.length / 2;
    let i = Math.min(v.cursor, n - 2);
    while (i < n - 2 && v.cum[i + 1]! < s) i++;
    while (i > 0 && v.cum[i]! > s) i--;
    v.cursor = i;
    const segLen = v.cum[i + 1]! - v.cum[i]!;
    const t = segLen > 0 ? (s - v.cum[i]!) / segLen : 1;
    const ax = v.path[i * 2]!;
    const ay = v.path[i * 2 + 1]!;
    const bx = v.path[i * 2 + 2]!;
    const by = v.path[i * 2 + 3]!;
    v.x = ax + (bx - ax) * t;
    v.y = ay + (by - ay) * t;
    if (p < 1 && segLen > 0.5) {
      const target = Math.atan2(bx - ax, by - ay);
      if (!v.headingKnown) {
        v.heading = target;
        v.headingKnown = true;
      } else {
        v.heading = wrap(v.heading + wrap(target - v.heading) * Math.min(1, dt * TURN_RATE));
      }
    }
  };

  const sample = (v: Vehicle, now: number) => {
    if (now - v.lastSample < TRAIL_EVERY_MS) return;
    v.lastSample = now;
    while (v.trailN > 0 && now - v.trailT[v.trailStart]! > TRAIL_MS) {
      v.trailStart = (v.trailStart + 1) % TRAIL_MAX;
      v.trailN--;
    }
    if (v.trailN > 0) {
      const last = (v.trailStart + v.trailN - 1) % TRAIL_MAX;
      if (dist(v.trail[last * 2]!, v.trail[last * 2 + 1]!, v.x, v.y) < STILL_M) return;
    }
    if (v.trailN === TRAIL_MAX) {
      v.trailStart = (v.trailStart + 1) % TRAIL_MAX;
      v.trailN--;
    }
    const at = (v.trailStart + v.trailN) % TRAIL_MAX;
    v.trail[at * 2] = v.x;
    v.trail[at * 2 + 1] = v.y;
    v.trailT[at] = now;
    v.trailN++;
  };

  return {
    vehicles,
    apply(snap, now, net) {
      for (const s of snap.vehicles) {
        let v = vehicles.get(s.key);
        if (!v) {
          if (vehicles.size >= MAX_VEHICLES) continue;
          const shapes = shapesFor(net, s.route, s.dir);
          const along = s.bearing >= 0 ? null : shapeHeading(shapes, s.x, s.y);
          v = {
            key: s.key,
            route: s.route,
            mode: modeOf(net, s.route),
            dir: s.dir,
            source: snap.source,
            path: new Float32Array(4),
            cum: new Float32Array(2),
            total: 0,
            legStart: now,
            legDur: 0,
            cursor: 0,
            fixTs: s.ts,
            x: s.x,
            y: s.y,
            heading: s.bearing >= 0 ? (s.bearing * Math.PI) / 180 : (along ?? 0),
            headingKnown: s.bearing >= 0 || along !== null,
            born: now,
            heard: now,
            retired: 0,
            alpha: 0,
            trail: new Float32Array(TRAIL_MAX * 2),
            trailT: new Float64Array(TRAIL_MAX),
            trailStart: 0,
            trailN: 0,
            lastSample: 0,
            lastStep: now,
          };
          place(v, s.x, s.y);
          vehicles.set(s.key, v);
          continue;
        }
        v.heard = now;
        if (v.retired && snap.source === v.source) v.retired = 0;
        if (v.route !== s.route) {
          v.route = s.route;
          v.mode = modeOf(net, s.route);
        }
        v.dir = s.dir;
        if (s.ts <= v.fixTs) continue;
        const gap = (s.ts - v.fixTs) * 1000;
        v.fixTs = s.ts;
        advance(v, now);
        const d = dist(v.x, v.y, s.x, s.y);
        if (d > TELEPORT_M) {
          place(v, s.x, s.y);
          clearTrail(v);
          v.born = now;
          continue;
        }
        if (d < STILL_M) continue;
        const leg = legOf(pathBetween(shapesFor(net, s.route, s.dir), v.x, v.y, s.x, s.y));
        v.path = leg.path;
        v.cum = leg.cum;
        v.total = leg.total;
        v.cursor = 0;
        v.legStart = now;
        v.legDur = Math.min(MAX_LEG_MS, Math.max(MIN_LEG_MS, gap));
      }
    },
    step(now) {
      for (const [key, v] of vehicles) {
        const quiet = now - v.heard;
        if (quiet > FADE_AFTER_MS + FADE_OUT_MS || (v.retired && now - v.retired > RETIRE_MS)) {
          vehicles.delete(key);
          continue;
        }
        advance(v, now);
        if (opts.trails) sample(v, now);
        let a = Math.min(1, (now - v.born) / FADE_IN_MS);
        if (quiet > FADE_AFTER_MS) a *= 1 - (quiet - FADE_AFTER_MS) / FADE_OUT_MS;
        if (v.retired) a *= 1 - (now - v.retired) / RETIRE_MS;
        v.alpha = Math.max(0, Math.min(1, a));
      }
    },
    retire(pick, now) {
      for (const v of vehicles.values()) if (!v.retired && pick(v)) v.retired = now;
    },
    remode(net) {
      for (const v of vehicles.values()) v.mode = modeOf(net, v.route);
    },
    count() {
      let n = 0;
      for (const v of vehicles.values()) if (v.alpha > 0) n++;
      return n;
    },
    clear() {
      vehicles.clear();
    },
  };
};

/** A vehicle's trail as flat x, y pairs, oldest first, ending where it is drawn now. */
export const trailPoints = (v: Vehicle, out: number[], maxAgeMs: number, now: number): number[] => {
  out.length = 0;
  for (let i = 0; i < v.trailN; i++) {
    const at = (v.trailStart + i) % TRAIL_MAX;
    if (now - v.trailT[at]! > maxAgeMs) continue;
    out.push(v.trail[at * 2]!, v.trail[at * 2 + 1]!);
  }
  out.push(v.x, v.y);
  return out;
};
