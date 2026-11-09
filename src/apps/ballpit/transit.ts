/**
 * Balls in the pipes. A route is a pipe path (pipes.ts) plus a speed profile: an optional pause
 * at the intake, a hard push up to cruising speed, then a steady whoosh to the end. Its positions
 * are sampled every STEP_MS when it's built, so a ball's place at any moment is a table lookup,
 * and both ends of a hand-off between frames can tell where a ball is from its start time.
 *
 * Several balls share a pipe at once without running into each other: every route lists the
 * junctions it passes (nodes), and a new ball's start is pushed back until it passes each node
 * at least a ball's length of time after or before every ball already booked through it. Balls
 * on one pipe move at the same speed, so clear at the junctions means clear in between.
 *
 * The pool is fixed: at most `cap` balls in transit, and a bounded ring of bookings per node.
 */
import { type Path, type PathPoint, nearestS, type Pt, pointAt } from "./pipes";

export const STEP_MS = 8;

export interface Profile {
  /** Ms the ball waits at the intake before it goes. */
  pause: number;
  /** Speed at the start and cruising speed, px/s, and the push between them, px/s². */
  v0: number;
  v1: number;
  accel: number;
}

export interface NodeSpot extends Pt {
  id: string;
}

export interface Route {
  readonly path: Path;
  readonly profile: Profile;
  /** Ball radius in this pipe. */
  readonly r: number;
  /** Ms from start to the end of the path. */
  readonly duration: number;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  /** Nodes the ball passes: ms after its start, and how long it keeps the node busy. */
  readonly nodes: readonly { id: string; t: number; h: number }[];
  /** Speed at the end, px/s, along `exit`. */
  readonly vEnd: number;
  readonly exit: { dx: number; dy: number };
}

/**
 * Space kept between balls at a node, in ball diameters. More than one, because two balls that
 * cross at right angles come closest a little after or before the node.
 */
const GAP = 1.5;

const timeAt = (p: Profile, s: number): number => {
  const a = Math.max(1, p.accel);
  const v0 = Math.max(0, Math.min(p.v0, p.v1));
  const sA = (p.v1 * p.v1 - v0 * v0) / (2 * a);
  if (s <= 0) return 0;
  const t = s < sA ? (-v0 + Math.sqrt(v0 * v0 + 2 * a * s)) / a : (p.v1 - v0) / a + (s - sA) / p.v1;
  return p.pause + t * 1000;
};

const distAt = (p: Profile, ms: number): number => {
  const t = (ms - p.pause) / 1000;
  if (t <= 0) return 0;
  const a = Math.max(1, p.accel);
  const v0 = Math.max(0, Math.min(p.v0, p.v1));
  const tA = (p.v1 - v0) / a;
  if (t < tA) return v0 * t + 0.5 * a * t * t;
  return v0 * tA + 0.5 * a * tA * tA + p.v1 * (t - tA);
};

export const buildRoute = (
  path: Path,
  profile: Profile,
  r: number,
  nodes: readonly NodeSpot[] = [],
): Route => {
  const L = path.length;
  const duration = timeAt(profile, L);
  const n = Math.max(2, Math.ceil(duration / STEP_MS) + 1);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const p: PathPoint = { x: 0, y: 0, dx: 0, dy: -1 };
  for (let i = 0; i < n; i++) {
    pointAt(path, distAt(profile, i * STEP_MS), p);
    xs[i] = p.x;
    ys[i] = p.y;
  }
  pointAt(path, L, p);
  const exit = { dx: p.dx, dy: p.dy };
  const clear = GAP * 2 * r;
  const timeAfter = (s: number) =>
    s + clear <= L ? timeAt(profile, s + clear) : duration + ((s + clear - L) / profile.v1) * 1000;
  const booked = nodes.map((nd) => {
    const s = nearestS(path, nd, Math.max(2, r / 2));
    const t = timeAt(profile, s);
    return { id: nd.id, t, h: Math.max(STEP_MS * 2, timeAfter(s) - t) };
  });
  const vEnd = L <= 0 ? 0 : (L - distAt(profile, duration - STEP_MS)) / (STEP_MS / 1000);
  return {
    path,
    profile,
    r,
    duration,
    xs,
    ys,
    nodes: booked,
    vEnd: Math.min(profile.v1, Math.max(0, vEnd)),
    exit,
  };
};

/** Where a route's ball is `ms` after its start. */
export const placeAt = (route: Route, ms: number, out: Pt): Pt => {
  const last = route.xs.length - 1;
  if (ms >= route.duration) {
    out.x = route.xs[last]!;
    out.y = route.ys[last]!;
    return out;
  }
  const i = Math.max(0, Math.min(last - 1, Math.floor(ms / STEP_MS)));
  const t0 = i * STEP_MS;
  // The last sample is the end of the path, which comes before a whole step has passed.
  const t1 = Math.min((i + 1) * STEP_MS, route.duration);
  const u = Math.max(0, Math.min(1, (ms - t0) / Math.max(1e-6, t1 - t0)));
  out.x = route.xs[i]! + (route.xs[i + 1]! - route.xs[i]!) * u;
  out.y = route.ys[i]! + (route.ys[i + 1]! - route.ys[i]!) * u;
  return out;
};

export interface Ball {
  active: boolean;
  route: Route;
  /** Local ms (performance.now) the ball sets off. */
  start: number;
  /** Chart block and answer, and drawing colour and shade. */
  block: number;
  answer: number;
  color: number;
  tint: number;
  /** A bot's press: drawn faded, and it never lands in a tube. */
  ghost: boolean;
  /** It ends in a tube on this frame (rather than leaving by the frame's edge). */
  lands: boolean;
}

export type BallInfo = Pick<Ball, "block" | "answer" | "color" | "tint" | "ghost" | "lands">;

export interface Transit {
  readonly balls: readonly Ball[];
  readonly count: number;
  readonly cap: number;
  /**
   * The earliest start at or after `earliest` (local ms) at which `route` stays clear of every
   * booked ball, or null if that would be more than `maxDelay` ms late.
   */
  plan(route: Route, earliest: number, maxDelay: number): number | null;
  /** Book a ball. Null when the pool is full. */
  add(route: Route, start: number, info: BallInfo): Ball | null;
  /** Hand over and free every ball that has reached the end of its route by `now`. */
  due(now: number, cb: (b: Ball) => void): void;
  /** Forget every booking (the pipes changed). Balls already moving carry on. */
  forget(): void;
  clear(): void;
}

/** Bookings kept per node; old ones are overwritten first. */
const RING = 48;
const PLAN_TRIES = 64;

interface Ring {
  t: Float64Array;
  h: Float64Array;
  next: number;
}

export const createTransit = (cap: number, now: () => number): Transit => {
  const empty = buildRoute(
    { segs: [], length: 0, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
    {
      pause: 0,
      v0: 0,
      v1: 1,
      accel: 1,
    },
    1,
  );
  const balls: Ball[] = Array.from({ length: Math.max(1, cap) }, () => ({
    active: false,
    route: empty,
    start: 0,
    block: 0,
    answer: 0,
    color: 0,
    tint: 0,
    ghost: false,
    lands: false,
  }));
  let count = 0;
  const rings = new Map<string, Ring>();
  /** Node ids come from the layout, so this map is bounded by it; this is a hard stop anyway. */
  const MAX_NODES = 1024;

  const ringOf = (id: string): Ring | null => {
    let r = rings.get(id);
    if (!r) {
      if (rings.size >= MAX_NODES) return null;
      r = { t: new Float64Array(RING).fill(-Infinity), h: new Float64Array(RING), next: 0 };
      rings.set(id, r);
    }
    return r;
  };

  return {
    balls,
    get count() {
      return count;
    },
    cap: balls.length,
    plan(route, earliest, maxDelay) {
      if (count >= balls.length) return null;
      let s = earliest;
      // A booking long before this ball could reach any node can't be in its way.
      const old = Math.min(earliest, now()) - 1000;
      for (let tries = 0; tries < PLAN_TRIES; tries++) {
        let moved = false;
        for (const nd of route.nodes) {
          const ring = rings.get(nd.id);
          if (!ring) continue;
          const at = s + nd.t;
          for (let i = 0; i < RING; i++) {
            const t = ring.t[i]!;
            if (t < old) continue;
            const need = Math.max(nd.h, ring.h[i]!);
            if (Math.abs(at - t) < need) {
              // A little past the booking, so rounding can't leave it just short again.
              s = t + need - nd.t + 0.5;
              moved = true;
              break;
            }
          }
          if (moved) break;
        }
        if (s - earliest > maxDelay) return null;
        if (!moved) return s;
      }
      return null;
    },
    add(route, start, info) {
      if (count >= balls.length) return null;
      const b = balls.find((x) => !x.active);
      if (!b) return null;
      b.active = true;
      b.route = route;
      b.start = start;
      b.block = info.block;
      b.answer = info.answer;
      b.color = info.color;
      b.tint = info.tint;
      b.ghost = info.ghost;
      b.lands = info.lands;
      count++;
      for (const nd of route.nodes) {
        const ring = ringOf(nd.id);
        if (!ring) continue;
        ring.t[ring.next] = start + nd.t;
        ring.h[ring.next] = nd.h;
        ring.next = (ring.next + 1) % RING;
      }
      return b;
    },
    due(t, cb) {
      if (count === 0) return;
      for (const b of balls) {
        if (!b.active || t - b.start < b.route.duration) continue;
        b.active = false;
        count--;
        cb(b);
      }
    },
    forget() {
      rings.clear();
    },
    clear() {
      for (const b of balls) {
        b.active = false;
        b.route = empty;
      }
      count = 0;
      rings.clear();
    },
  };
};
