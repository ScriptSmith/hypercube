/**
 * Closed-form motion under gravity with linear drag, in sky units with y up. Shells and stars
 * are pure functions of their start state and time, so every frame that holds the same record
 * draws it in the same place, and a late record is simply evaluated further along.
 *
 *   x(t) = x0 + vx F(t)
 *   y(t) = y0 + vy F(t) - g (t - F(t)) / k,   F(t) = (1 - e^(-kt)) / k
 *
 * with series forms as k goes to 0.
 */

export interface Ballistic {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity, sky units per s², pulling towards -y. */
  g: number;
  /** Linear drag, per s. */
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

const SMALL_K = 1e-4;

/** F(t) = (1 - e^(-kt)) / k: distance covered per unit of initial speed. */
export const reach = (k: number, t: number): number =>
  Math.abs(k * t) < SMALL_K ? t - (k * t * t) / 2 : (1 - Math.exp(-k * t)) / k;

/** (t - F(t)) / k: how far gravity has pulled, per unit of g. */
const fall = (k: number, t: number): number =>
  Math.abs(k * t) < 1e-3
    ? (t * t) / 2 - (k * t * t * t) / 6 + (k * k * t * t * t * t) / 24
    : (t - reach(k, t)) / k;

export const positionAt = (b: Ballistic, t: number, out: Point = { x: 0, y: 0 }): Point => {
  const f = reach(b.k, t);
  out.x = b.x + b.vx * f;
  out.y = b.y + b.vy * f - b.g * fall(b.k, t);
  return out;
};

export const velocityAt = (b: Ballistic, t: number, out: Point = { x: 0, y: 0 }): Point => {
  const e = Math.exp(-b.k * t);
  out.x = b.vx * e;
  out.y = b.vy * e - b.g * reach(b.k, t);
  return out;
};

/** When vertical speed reaches zero; Infinity if it never rises or never stops. */
export const apexTime = (b: Ballistic): number => {
  if (b.vy <= 0) return 0;
  if (b.g <= 0) return Infinity;
  if (Math.abs(b.k) < SMALL_K) return b.vy / b.g;
  return Math.log(1 + (b.k * b.vy) / b.g) / b.k;
};

/**
 * First time the path rises to height `h`, or null if it never does. y is increasing up to the
 * apex, so bisection on [0, apex] converges.
 */
export const timeToHeight = (b: Ballistic, h: number): number | null => {
  if (b.y >= h) return 0;
  const top = apexTime(b);
  if (!Number.isFinite(top)) {
    // No gravity: it climbs forever, but drag may cap the height.
    const cap = b.k > SMALL_K ? b.y + b.vy / b.k : Infinity;
    if (h >= cap) return null;
    if (b.k <= SMALL_K) return (h - b.y) / b.vy;
    return -Math.log(1 - ((h - b.y) * b.k) / b.vy) / b.k;
  }
  const p = { x: 0, y: 0 };
  if (positionAt(b, top, p).y < h) return null;
  let lo = 0;
  let hi = top;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (positionAt(b, mid, p).y < h) lo = mid;
    else hi = mid;
  }
  return hi;
};

/** First time the path reaches x = `edge`, or null if it never does. x moves one way only. */
export const timeToX = (b: Ballistic, edge: number): number | null => {
  const dx = edge - b.x;
  if (dx === 0) return 0;
  if (b.vx === 0 || Math.sign(dx) !== Math.sign(b.vx)) return null;
  const q = dx / b.vx;
  if (Math.abs(b.k) < SMALL_K) return q;
  const arg = 1 - b.k * q;
  if (arg <= 0) return null;
  return -Math.log(arg) / b.k;
};

/** Restart a path at time `t` along it: the same motion from a new origin. */
export const advance = (b: Ballistic, t: number): Ballistic => {
  const p = positionAt(b, t);
  const v = velocityAt(b, t);
  return { x: p.x, y: p.y, vx: v.x, vy: v.y, g: b.g, k: b.k };
};

/**
 * Launch speed and gravity for a shell that leaves `depth` units of climb in `exitS` seconds and
 * would top out at `apex` units above its start. Bursts are timed to happen on the way up, so
 * the shell visibly slows but never hangs.
 */
export const climbPhysics = (
  depth: number,
  exitS: number,
  apex: number,
): { v: number; g: number } => {
  const a = Math.max(apex, depth * 1.05);
  const T = (a * exitS * (1 + Math.sqrt(Math.max(0, 1 - depth / a)))) / depth;
  return { v: (2 * a) / T, g: (2 * a) / (T * T) };
};

/** Launch speed and gravity for a shell that tops out `apex` units up after `apexS` seconds. */
export const apexPhysics = (apex: number, apexS: number): { v: number; g: number } => ({
  v: (2 * apex) / apexS,
  g: (2 * apex) / (apexS * apexS),
});
