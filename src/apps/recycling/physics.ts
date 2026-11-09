/**
 * Motion shared by the frames and the screen, so an item falling across the bezel follows one
 * path on both. Falls have linear drag (a terminal speed, so a long drop doesn't arrive as a
 * blur); ejected items follow plain parabolas, so their landing on a belt can be aimed exactly.
 * Units: venue px of the touch frames (on the screen, "bank units") and seconds; y grows down.
 */

export interface Fall {
  /** Start time, ms on whichever clock the caller uses. */
  t0: number;
  x0: number;
  y0: number;
  vx0: number;
  vy0: number;
  g: number;
  tau: number;
}

export interface Motion {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Where a fall is `t` seconds after it started. */
export const fallAt = (f: Fall, t: number, out: Motion = { x: 0, y: 0, vx: 0, vy: 0 }): Motion => {
  const s = Math.max(0, t);
  const e = Math.exp(-s / f.tau);
  const vt = f.g * f.tau;
  out.x = f.x0 + f.vx0 * f.tau * (1 - e);
  out.y = f.y0 + vt * s + (f.vy0 - vt) * f.tau * (1 - e);
  out.vx = f.vx0 * e;
  out.vy = vt + (f.vy0 - vt) * e;
  return out;
};

/**
 * Seconds until a fall reaches height `y` going down, or null if it never does within `max`.
 * A fall's height only ever increases once it is moving down, so bisection is safe after the top.
 */
export const fallTimeTo = (f: Fall, y: number, max = 20): number | null => {
  const m: Motion = { x: 0, y: 0, vx: 0, vy: 0 };
  // The top of the arc, if it starts upward.
  let lo = 0;
  if (f.vy0 < 0) {
    const vt = f.g * f.tau;
    // vy(t) = 0 where e = vt / (vt - vy0).
    lo = -f.tau * Math.log(vt / (vt - f.vy0));
  }
  if (fallAt(f, lo, m).y >= y) return lo === 0 && f.y0 >= y ? 0 : lo;
  if (fallAt(f, max, m).y < y) return null;
  let hi = max;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (fallAt(f, mid, m).y < y) lo = mid;
    else hi = mid;
  }
  return hi;
};

export interface Arc {
  vx: number;
  vy: number;
  /** Seconds to land. */
  time: number;
}

/**
 * A parabola from (x0, y0) to (x1, y1) under gravity `g` whose top is `rise` above the higher
 * of the two points.
 */
export const arcTo = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  g: number,
  rise: number,
): Arc => {
  const apex = Math.min(y0, y1) - Math.max(1, rise);
  const vy = -Math.sqrt(2 * g * (y0 - apex));
  const up = -vy / g;
  const down = Math.sqrt((2 * (y1 - apex)) / g);
  const time = up + down;
  return { vx: (x1 - x0) / time, vy, time };
};

/** Position on a parabola `t` seconds after it started. */
export const arcAt = (
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  g: number,
  t: number,
): { x: number; y: number; vx: number; vy: number } => ({
  x: x0 + vx * t,
  y: y0 + vy * t + 0.5 * g * t * t,
  vx,
  vy: vy + g * t,
});

/** One step of a thrown item: gravity and a little air drag (semi-implicit Euler). */
export const flyStep = (m: Motion, g: number, tau: number, dt: number): void => {
  const k = Math.exp(-dt / tau);
  m.vx *= k;
  m.vy = m.vy * k + g * dt;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
};

export interface Mouth {
  /** Opening left and right edge and the height of its rim. */
  x0: number;
  x1: number;
  y: number;
}

/**
 * Where a thrown item first crosses one of these openings' heights going down, near enough to
 * that opening to be heading for it. Returns the opening's index, the crossing x and the time.
 */
export const predictCrossing = (
  start: Motion,
  mouths: readonly Mouth[],
  g: number,
  tau: number,
  reach: number,
  maxS = 3,
  dt = 1 / 120,
): { index: number; x: number; t: number } | null => {
  const m: Motion = { ...start };
  let t = 0;
  while (t < maxS) {
    const py = m.y;
    flyStep(m, g, tau, dt);
    t += dt;
    // Of the openings crossed in this step, the one it is over, else the nearest.
    let best: { index: number; x: number; t: number } | null = null;
    let bestMiss = Infinity;
    for (let i = 0; i < mouths.length; i++) {
      const o = mouths[i]!;
      if (!(py < o.y && m.y >= o.y)) continue;
      const f = (o.y - py) / Math.max(1e-6, m.y - py);
      const x = m.x - m.vx * dt * (1 - f);
      const miss = x < o.x0 ? o.x0 - x : x > o.x1 ? x - o.x1 : 0;
      if (miss <= reach && miss < bestMiss) {
        best = { index: i, x, t: t - dt * (1 - f) };
        bestMiss = miss;
      }
    }
    if (best) return best;
  }
  return null;
};

/**
 * Bend a throw a little towards the opening it is heading for: `share` of the distance from
 * where it would cross to the opening's middle, by changing only the sideways speed.
 */
export const assistThrow = (
  start: Motion,
  mouths: readonly Mouth[],
  g: number,
  tau: number,
  reach: number,
  share: number,
): { vx: number; vy: number; target: number | null } => {
  const hit = predictCrossing(start, mouths, g, tau, reach);
  if (!hit || hit.t <= 0.02) return { vx: start.vx, vy: start.vy, target: hit?.index ?? null };
  const o = mouths[hit.index]!;
  const mid = (o.x0 + o.x1) / 2;
  const miss = mid - hit.x;
  // Sideways distance covered by a speed change dv over time t with drag: dv * tau * (1 - e^-t/tau).
  const k = tau * (1 - Math.exp(-hit.t / tau));
  const dv = (miss * share) / Math.max(1e-3, k);
  return { vx: start.vx + dv, vy: start.vy, target: hit.index };
};
