/**
 * Scripted motion along tubes: the climb off the top of a table, the orbit ramp, the return
 * tube, and the deck's entry chutes and holes. A ball moves along a polyline with a speed that
 * eases from `v0` to `v1` over `ms`; both ends of a crossing use the same speed at the edge, so a
 * ball that leaves one frame and enters the next keeps its pace.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Motion {
  /** Path length in px. */
  length: number;
  ms: number;
  /** Speed at the start and end, px per second. */
  v0: number;
  v1: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const polyLength = (pts: readonly Pt[]): number => {
  let d = 0;
  for (let i = 1; i < pts.length; i++)
    d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return d;
};

/** The point at distance `s` along the polyline, and the direction there. */
export const pointAlong = (
  pts: readonly Pt[],
  s: number,
): { x: number; y: number; dx: number; dy: number } => {
  let left = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l <= 0) continue;
    if (left <= l || i === pts.length - 1) {
      const k = Math.min(1, left / l);
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        dx: (b.x - a.x) / l,
        dy: (b.y - a.y) / l,
      };
    }
    left -= l;
  }
  const p = pts[0] ?? { x: 0, y: 0 };
  return { x: p.x, y: p.y, dx: 0, dy: -1 };
};

/**
 * Slopes for the cubic, limited so the motion never runs backwards or overshoots (a monotone
 * cubic needs both end slopes between 0 and 3 times the mean).
 */
const slopes = (m: Motion) => {
  const mean = m.length / Math.max(1e-6, m.ms / 1000);
  return { m0: clamp(m.v0 / mean, 0, 3), m1: clamp(m.v1 / mean, 0, 3), mean };
};

/** Distance along the path and speed `t` ms after the start. */
export const motionAt = (m: Motion, t: number): { s: number; v: number; done: boolean } => {
  if (m.length <= 0 || m.ms <= 0) return { s: m.length, v: m.v1, done: true };
  const u = clamp(t / m.ms, 0, 1);
  const { m0, m1, mean } = slopes(m);
  const u2 = u * u;
  const u3 = u2 * u;
  const p = (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) + (u3 - u2) * m1;
  const dp = (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) + (3 * u2 - 2 * u) * m1;
  return { s: p * m.length, v: dp * mean, done: t >= m.ms };
};

/** The speeds the cubic can actually reach at each end, for matching across a crossing. */
export const endSpeeds = (m: Motion): { v0: number; v1: number } => {
  const { m0, m1, mean } = slopes(m);
  return { v0: m0 * mean, v1: m1 * mean };
};

/** A smooth curve through `ctrl` (Catmull-Rom), as points about `step` px apart. */
export const smoothPath = (ctrl: readonly Pt[], step: number): Pt[] => {
  if (ctrl.length < 3) return ctrl.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...ctrl[0]! }];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]!;
    const p1 = ctrl[i]!;
    const p2 = ctrl[i + 1]!;
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]!;
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
};
