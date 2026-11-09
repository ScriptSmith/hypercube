/**
 * Tangles. Each line is taken as straight, from where it leaves the ground (or the touch frame's
 * top edge) to its kite. Two lines from different patches that cross up in the sky for more
 * than `CATCH_S`, staying in about the same place, twist together at the crossing; they come free once they have stopped crossing
 * for `FREE_S`, which reeling in or steering away does, and in any case after `MAX_S`, so nobody
 * is ever stuck. A pair that just came free can't catch again for a few seconds, and a pair
 * freed by the time limit not until its lines have come apart.
 *
 * Kites resting low lean across their downwind neighbours' lines; those crossings are near the
 * ground and don't count, or every resting kite would be caught all day. Two kites both on the
 * autopilot never catch, so an empty bank's attract doesn't fill with twists.
 */

export interface Line {
  /** Unique per kite, e.g. `frame:slot`. */
  key: string;
  /** Lines of one patch (a spool and its neighbouring stunt kite) never catch each other. */
  group: string;
  /** Flown by the autopilot. Two autopilot kites never catch, so attract stays tidy. */
  auto?: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const CATCH_S = 1;
export const FREE_S = 0.6;
export const MAX_S = 12;
const COOLDOWN_S = 4;
/** Crossings this close to where a line leaves the ground don't count: lines start side by side. */
const NEAR_START = 0.12;
/** Lines that cross at a shallow angle (under about 12 degrees) only brush past each other. */
const MIN_SIN = 0.2;
/** Crossings lower than this, in sky heights, don't count. */
export const MIN_HEIGHT = 0.22;
/**
 * A crossing that slides further than this (sky heights) while it waits to catch starts its
 * wait again: a kite sweeping through a line passes over it, one that stays across it catches.
 */
export const CATCH_DRIFT = 0.12;
const MAX_PAIRS = 512;

/** Where segments a and b cross, away from their starts, or null. */
export const crossing = (a: Line, b: Line): { x: number; y: number } | null => {
  const rx = a.x1 - a.x0;
  const ry = a.y1 - a.y0;
  const sx = b.x1 - b.x0;
  const sy = b.y1 - b.y0;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9 || Math.abs(den) < MIN_SIN * Math.hypot(rx, ry) * Math.hypot(sx, sy)) {
    return null;
  }
  const qx = b.x0 - a.x0;
  const qy = b.y0 - a.y0;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < NEAR_START || t > 1 || u < NEAR_START || u > 1) return null;
  const y = a.y0 + t * ry;
  if (y < MIN_HEIGHT) return null;
  return { x: a.x0 + t * rx, y };
};

export interface Tangle {
  a: string;
  b: string;
  x: number;
  y: number;
  /** Seconds since it caught. */
  age: number;
}

export interface TangleEvent {
  on: boolean;
  a: string;
  b: string;
  x: number;
  y: number;
}

interface PairState {
  a: string;
  b: string;
  /** Seconds crossing (before a catch) or apart (while caught). */
  run: number;
  caught: boolean;
  age: number;
  x: number;
  y: number;
  cooldown: number;
  /** Freed by the time limit while still crossing: waits for the lines to come apart. */
  spent: boolean;
  /** Where the crossing was when the wait to catch began. */
  sx: number;
  sy: number;
  seen: boolean;
}

export interface TangleTracker {
  /** Look at the lines `dt` seconds after the last look; returns tangles that began or ended. */
  update(lines: readonly Line[], dt: number): TangleEvent[];
  /** Tangles now. */
  active(): Tangle[];
  /** Keys caught in any tangle. */
  caught(key: string): boolean;
  /** End every tangle, returning the ends. */
  clear(): TangleEvent[];
  readonly size: number;
}

export const createTangles = (): TangleTracker => {
  const pairs = new Map<string, PairState>();
  const out: TangleEvent[] = [];

  const end = (p: PairState, spent = false) => {
    p.caught = false;
    p.run = 0;
    p.cooldown = COOLDOWN_S;
    p.spent = spent;
    out.push({ on: false, a: p.a, b: p.b, x: p.x, y: p.y });
  };

  return {
    update(lines, dt) {
      out.length = 0;
      for (const p of pairs.values()) p.seen = false;
      for (let i = 0; i < lines.length; i++) {
        const a = lines[i]!;
        for (let j = i + 1; j < lines.length; j++) {
          const b = lines[j]!;
          if (a.group === b.group) continue;
          const [l, r] = a.key < b.key ? [a, b] : [b, a];
          const id = `${l.key}|${r.key}`;
          const hit = crossing(l, r);
          let p = pairs.get(id);
          if (!p) {
            if (!hit) continue;
            if (pairs.size >= MAX_PAIRS) continue;
            p = {
              a: l.key,
              b: r.key,
              run: 0,
              caught: false,
              age: 0,
              x: 0,
              y: 0,
              cooldown: 0,
              spent: false,
              sx: 0,
              sy: 0,
              seen: true,
            };
            pairs.set(id, p);
          }
          p.seen = true;
          p.cooldown = Math.max(0, p.cooldown - dt);
          if (hit) {
            p.x = hit.x;
            p.y = hit.y;
          } else {
            p.spent = false;
          }
          const idle = l.auto === true && r.auto === true;
          if (p.caught) {
            p.age += dt;
            p.run = hit ? 0 : p.run + dt;
            if (p.run >= FREE_S) end(p);
            else if (p.age >= MAX_S) end(p, true);
          } else if (hit && p.cooldown <= 0 && !p.spent && !idle) {
            if (p.run === 0 || Math.hypot(hit.x - p.sx, hit.y - p.sy) > CATCH_DRIFT) {
              p.sx = hit.x;
              p.sy = hit.y;
              p.run = 0;
            }
            p.run += dt;
            if (p.run >= CATCH_S) {
              p.caught = true;
              p.run = 0;
              p.age = 0;
              out.push({ on: true, a: p.a, b: p.b, x: p.x, y: p.y });
            }
          } else {
            p.run = 0;
          }
        }
      }
      // Lines that went away (a kite reset, a frame left) free their tangles.
      for (const [id, p] of pairs) {
        if (p.seen) continue;
        if (p.caught) end(p);
        pairs.delete(id);
      }
      for (const [id, p] of pairs) {
        if (!p.caught && !p.spent && p.run === 0 && p.cooldown <= 0) pairs.delete(id);
      }
      return out;
    },
    active() {
      const list: Tangle[] = [];
      for (const p of pairs.values()) {
        if (p.caught) list.push({ a: p.a, b: p.b, x: p.x, y: p.y, age: p.age });
      }
      return list;
    },
    caught(key) {
      for (const p of pairs.values()) if (p.caught && (p.a === key || p.b === key)) return true;
      return false;
    },
    clear() {
      out.length = 0;
      for (const p of pairs.values()) if (p.caught) end(p);
      pairs.clear();
      return out;
    },
    get size() {
      return pairs.size;
    },
  };
};
