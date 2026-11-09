/**
 * Directions and the eye's orientation. Directions are unit vectors in venue space (y up), as
 * in `src/core/sphere.ts`: from the ball's centre, so a direction is also a point on the ball.
 */
import { DEG, type Mat3, type Vec3 } from "../../core/sphere";

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Angle between two directions, radians; accurate for tiny and near-opposite angles too. */
export const angle = (a: Vec3, b: Vec3): number => {
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b));
};

/** A unit vector at right angles to `a`. */
const perpendicular = (a: Vec3): Vec3 =>
  norm(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]));

/** `a` turned by `amount` radians about `axis` (unit), by Rodrigues' formula. */
const turn = (a: Vec3, axis: Vec3, amount: number): Vec3 => {
  const c = Math.cos(amount);
  const s = Math.sin(amount);
  const k = cross(axis, a);
  const d = dot(axis, a) * (1 - c);
  return [
    a[0] * c + k[0] * s + axis[0] * d,
    a[1] * c + k[1] * s + axis[1] * d,
    a[2] * c + k[2] * s + axis[2] * d,
  ];
};

/**
 * Along the great circle from `a` towards `b`, `t` of the way (beyond `b` for t > 1, which a
 * saccade's overshoot uses).
 */
export const slerp = (a: Vec3, b: Vec3, t: number): Vec3 => {
  const total = angle(a, b);
  if (total < 1e-9) return a;
  const c = cross(a, b);
  const axis = Math.hypot(c[0], c[1], c[2]) < 1e-9 ? perpendicular(a) : norm(c);
  return norm(turn(a, axis, total * t));
};

/**
 * `a` turned by `share` of the turn that takes `from` to `to`, as an eye carried along with a
 * moving target is.
 */
export const carry = (a: Vec3, from: Vec3, to: Vec3, share: number): Vec3 => {
  const c = cross(from, to);
  const s = Math.hypot(c[0], c[1], c[2]);
  if (s < 1e-12) return a;
  const axis: Vec3 = [c[0] / s, c[1] / s, c[2] / s];
  return norm(turn(a, axis, angle(from, to) * share));
};

/** `a` moved towards `b` by at most `step` radians. */
export const towards = (a: Vec3, b: Vec3, step: number): Vec3 => {
  const total = angle(a, b);
  if (total <= step) return b;
  return slerp(a, b, step / total);
};

/** Two unit vectors at right angles to `d` and to each other: east-like and north-like. */
export const tangents = (d: Vec3): [Vec3, Vec3] => {
  const e = Math.abs(d[1]) > 0.999 ? norm(cross([0, 0, 1], d)) : norm(cross([0, 1, 0], d));
  return [e, cross(d, e)];
};

/** `d` nudged by small angles `x` and `y` (radians) along its tangents. */
export const nudge = (d: Vec3, x: number, y: number): Vec3 => {
  const [e, n] = tangents(d);
  return norm([d[0] + e[0] * x + n[0] * y, d[1] + e[1] * x + n[1] * y, d[2] + e[2] * x + n[2] * y]);
};

/** Elevation above the horizon, radians. */
export const elevation = (d: Vec3): number => Math.asin(Math.max(-1, Math.min(1, d[1])));

/** Bearing round the vertical axis, radians, 0 towards +z (the feed's longitude). */
export const bearing = (d: Vec3): number => Math.atan2(d[0], d[2]);

export const fromAngles = (elev: number, bear: number): Vec3 => {
  const c = Math.cos(elev);
  return [c * Math.sin(bear), Math.sin(elev), c * Math.cos(bear)];
};

/**
 * The eye's primary position: looking straight down, where it looks most. Orientations follow
 * Listing's law from here (every orientation is one turn from primary about an axis at right
 * angles to it), so the iris never spins up a twist however the eye wanders. Straight up, the
 * one direction the law can't reach, is above anything the eye looks at.
 */
export const PRIMARY: Vec3 = [0, -1, 0];
const PRIMARY_X: Vec3 = [1, 0, 0];
const PRIMARY_Y: Vec3 = [0, 0, 1];

/** An eye's primary position and the iris's x and y there. */
export interface Primary {
  gaze: Vec3;
  x: Vec3;
  y: Vec3;
}

export const LOOKING_DOWN: Primary = { gaze: PRIMARY, x: PRIMARY_X, y: PRIMARY_Y };
/** On a wall the eye looks out into the room most, with its iris upright. */
export const LOOKING_OUT: Primary = { gaze: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };

/**
 * The eye's axes in venue space for a gaze and a twist about it (radians): x and y across the
 * iris, z along the gaze. Rows of the result are the axes, so it turns a venue direction into
 * the eye's own coordinates.
 */
export const eyeFrame = (gaze: Vec3, torsion = 0, primary: Primary = LOOKING_DOWN): Mat3 => {
  const g = norm(gaze);
  const c = cross(primary.gaze, g);
  const s = Math.hypot(c[0], c[1], c[2]);
  const a = Math.atan2(s, dot(primary.gaze, g));
  let x = primary.x;
  let y = primary.y;
  if (s > 1e-9) {
    const axis: Vec3 = [c[0] / s, c[1] / s, c[2] / s];
    x = turn(x, axis, a);
    y = turn(y, axis, a);
  } else if (a > Math.PI / 2) {
    // Straight away from primary: turn half round about x so the frame stays right-handed.
    y = [-primary.y[0], -primary.y[1], -primary.y[2]];
  }
  if (torsion !== 0) {
    const tc = Math.cos(torsion);
    const ts = Math.sin(torsion);
    const nx: Vec3 = [x[0] * tc + y[0] * ts, x[1] * tc + y[1] * ts, x[2] * tc + y[2] * ts];
    y = [y[0] * tc - x[0] * ts, y[1] * tc - x[1] * ts, y[2] * tc - x[2] * ts];
    x = nx;
  }
  return [x[0], x[1], x[2], y[0], y[1], y[2], g[0], g[1], g[2]];
};

export const degrees = (r: number): number => r / DEG;
