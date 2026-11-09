/**
 * Moving a vehicle between two fixes along its route's shape rather than straight across the
 * map. A fix snaps to a shape within SNAP_M; the path follows the shape forwards from the first
 * fix to the second, and is used only when it isn't much longer than the straight line (a shape
 * that loops back would otherwise send the vehicle the long way round).
 */

export const SNAP_M = 100;
/** A shape path may be at most this many times the straight distance (plus slack). */
const DETOUR = 3;
const DETOUR_SLACK_M = 60;
/** A shape path with more points than this falls back to a straight line. */
export const MAX_PATH_POINTS = 96;

export interface ShapeLine {
  /** Flat x, y pairs in local metres. */
  pts: Float32Array;
  /** Distance along the shape at each point. */
  cum: Float32Array;
  /** x0, y0, x1, y1. */
  box: [number, number, number, number];
}

export const makeShapeLine = (pts: Float32Array): ShapeLine => {
  const n = pts.length / 2;
  const cum = new Float32Array(n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2]!;
    const y = pts[i * 2 + 1]!;
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(x - pts[i * 2 - 2]!, y - pts[i * 2 - 1]!);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { pts, cum, box: [x0, y0, x1, y1] };
};

export interface Projection {
  /** Distance from the point to the shape. */
  d: number;
  /** Distance along the shape. */
  s: number;
  /** Segment index: the projection lies between points `seg` and `seg + 1`. */
  seg: number;
  x: number;
  y: number;
}

/** The nearest point on the shape to (x, y). */
export const project = (line: ShapeLine, x: number, y: number): Projection => {
  const p = line.pts;
  const n = p.length / 2;
  const best: Projection = { d: Infinity, s: 0, seg: 0, x: p[0] ?? 0, y: p[1] ?? 0 };
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2]!;
    const ay = p[i * 2 + 1]!;
    const dx = p[i * 2 + 2]! - ax;
    const dy = p[i * 2 + 3]! - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = Math.hypot(x - qx, y - qy);
    if (d < best.d) {
      best.d = d;
      best.seg = i;
      best.x = qx;
      best.y = qy;
      best.s = line.cum[i]! + t * Math.sqrt(len2);
    }
  }
  return best;
};

const near = (line: ShapeLine, x: number, y: number, m: number): boolean =>
  x >= line.box[0] - m && x <= line.box[2] + m && y >= line.box[1] - m && y <= line.box[3] + m;

/**
 * A path from (ax, ay) to (bx, by) as flat x, y pairs. Along the best matching shape when one
 * fits, otherwise the straight line. The path starts and ends exactly at the two points.
 */
export const pathBetween = (
  shapes: readonly ShapeLine[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number[] => {
  const straight = Math.hypot(bx - ax, by - ay);
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const line of shapes) {
    if (!near(line, ax, ay, SNAP_M) || !near(line, bx, by, SNAP_M)) continue;
    const a = project(line, ax, ay);
    if (a.d > SNAP_M) continue;
    const b = project(line, bx, by);
    if (b.d > SNAP_M) continue;
    const along = b.s - a.s;
    if (along < -5) continue;
    if (along > DETOUR * straight + DETOUR_SLACK_M) continue;
    if (b.seg - a.seg > MAX_PATH_POINTS) continue;
    const score = a.d + b.d;
    if (score >= bestScore) continue;
    const out = [ax, ay, a.x, a.y];
    for (let i = a.seg + 1; i <= b.seg; i++) out.push(line.pts[i * 2]!, line.pts[i * 2 + 1]!);
    out.push(b.x, b.y, bx, by);
    best = out;
    bestScore = score;
  }
  return dedupe(best ?? [ax, ay, bx, by]);
};

/** Drop repeated points, which would make zero-length steps. */
const dedupe = (pts: number[]): number[] => {
  const out: number[] = [pts[0]!, pts[1]!];
  for (let i = 2; i < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (Math.abs(x - out[out.length - 2]!) < 0.01 && Math.abs(y - out[out.length - 1]!) < 0.01)
      continue;
    out.push(x, y);
  }
  if (out.length === 2) out.push(out[0]!, out[1]!);
  return out;
};

/** The direction of travel (compass radians) along the nearest shape at (x, y), if one is near. */
export const shapeHeading = (shapes: readonly ShapeLine[], x: number, y: number): number | null => {
  let bestD = SNAP_M;
  let heading: number | null = null;
  for (const line of shapes) {
    if (!near(line, x, y, SNAP_M)) continue;
    const p = project(line, x, y);
    if (p.d >= bestD) continue;
    const i = p.seg;
    const dx = line.pts[i * 2 + 2]! - line.pts[i * 2]!;
    const dy = line.pts[i * 2 + 3]! - line.pts[i * 2 + 1]!;
    if (dx === 0 && dy === 0) continue;
    bestD = p.d;
    heading = Math.atan2(dx, dy);
  }
  return heading;
};
