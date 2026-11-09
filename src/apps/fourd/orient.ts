/**
 * Orientations: the resting pose, the "first" buttons, the eased turn to one, and the slow turn
 * a bank shows when nobody touches. Pure.
 *
 * "Corner first" means a corner meets the cut before anything else as the lever moves from its
 * start. The button turns the shape the least it can: of all its corners it takes the one nearest
 * that way and turns it there in one plane, so whatever else the shape was doing is kept. The
 * resting pose is "facet first" (cell first in four dimensions, face first in three, edge first in
 * two), reached the same way from the shape's own coordinates.
 */
import {
  alignTurn,
  angleBetween,
  apply,
  copyMat,
  identity,
  type Mat4,
  mul,
  orthonormalize,
  planeTurn,
  type Vec4,
} from "./rot";
import { featureDirs, type Shape } from "./shapes";
import { HIDDEN } from "./slice";
import type { Dim } from "./shapes";

/** The way a "first" face points: towards where the cut starts. */
export const firstWay = (dim: Dim): Vec4 => {
  const u: Vec4 = [0, 0, 0, 0];
  // The cut rises with the lever on 3D and 4D stages, and falls on a 2D stage (cutOf).
  u[HIDDEN[dim]] = dim === 2 ? 1 : -1;
  return u;
};

export interface TurnPath {
  /** The chosen face's direction now, and where it goes. */
  a: Vec4;
  u: Vec4;
  /** Radians the turn covers. */
  angle: number;
}

/**
 * The least turn that puts a k-face first from orientation `from`, or null for the ball (or a
 * face it already shows first).
 */
export const presetPath = (shape: Shape, from: Mat4, k: number): TurnPath | null => {
  const dirs = featureDirs(shape.family, shape.dim, k);
  if (dirs.length === 0) return null;
  const u = firstWay(shape.dim);
  let best: Vec4 | null = null;
  let bestDot = -Infinity;
  const a: Vec4 = [0, 0, 0, 0];
  for (const d of dirs) {
    apply(from, d, a);
    const dot = a[0] * u[0] + a[1] * u[1] + a[2] * u[2] + a[3] * u[3];
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = [a[0], a[1], a[2], a[3]];
    }
  }
  if (!best) return null;
  const angle = angleBetween(best, u);
  return angle < 1e-6 ? null : { a: best, u, angle };
};

const tmp = new Float64Array(16);

/** The orientation `frac` of the way along `path` from `from`, into `out`. */
export const pathAt = (
  path: TurnPath | null,
  from: Mat4,
  frac: number,
  out: Mat4 = new Float64Array(16),
): Mat4 => {
  if (!path || frac <= 0) return copyMat(from, out);
  alignTurn(path.a, path.u, Math.min(1, frac), tmp);
  mul(tmp, from, out);
  orthonormalize(out);
  return out;
};

const restCache = new Map<Shape, Mat4>();

/** The resting orientation: facet first. */
export const restRot = (shape: Shape): Mat4 => {
  let r = restCache.get(shape);
  if (!r) {
    const id = identity();
    r = pathAt(presetPath(shape, id, shape.dim - 1), id, 1);
    restCache.set(shape, r);
  }
  return r;
};

/** Smooth start and stop. */
export const ease = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** How long a "first" button's turn takes. */
export const PRESET_MS = 1500;

/** A turn in progress towards a "first" orientation. */
export interface Turning {
  from: Mat4;
  path: TurnPath;
  start: number;
  ms: number;
}

export const startTurning = (
  shape: Shape,
  from: Mat4,
  k: number,
  now: number,
  ms = PRESET_MS,
): Turning | null => {
  const path = presetPath(shape, from, k);
  return path ? { from: copyMat(from), path, start: now, ms } : null;
};

/** The orientation of a turn at `now`, into `out`; true once it has arrived. */
export const turningAt = (t: Turning, now: number, out: Mat4): boolean => {
  const f = (now - t.start) / t.ms;
  pathAt(t.path, t.from, ease(f), out);
  return f >= 1;
};

// ---- A bank's slow turn -----------------------------------------------------------------------

/** Periods (s) of the slow turn's three planes; long and unrelated, so it never quite repeats. */
const SLOW_PERIODS = [47, 61, 83] as const;
const SLOW_PLANES: Record<Dim, [number, number][]> = {
  2: [[0, 1]],
  3: [
    [1, 2],
    [0, 1],
    [0, 2],
  ],
  4: [
    [0, 3],
    [1, 3],
    [0, 2],
  ],
};

const frac = (x: number) => x - Math.floor(x);
const tmpP = new Float64Array(16);

/**
 * The bank's slow turn at shared-clock time `ms`: the same everywhere, without messages. Angles
 * come from the time modulo each period, so a clock in the trillions of ms keeps full precision.
 */
export const slowTurn = (shape: Shape, ms: number, out: Mat4 = new Float64Array(16)): Mat4 => {
  copyMat(restRot(shape), out);
  const planes = SLOW_PLANES[shape.dim];
  planes.forEach(([i, j], n) => {
    const period = SLOW_PERIODS[n]! * 1000;
    const a = frac((ms % (period * 1000)) / period) * Math.PI * 2;
    planeTurn(i, j, a, tmpP);
    mul(tmpP, out, out);
  });
  orthonormalize(out);
  return out;
};
