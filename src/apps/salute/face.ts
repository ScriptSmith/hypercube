/**
 * The face's layout and the hand's path, shared by the shader and the tests.
 *
 * The face has its own axes: z out through the middle of the face, y to the top of the head and
 * x to the right of someone looking at it (so the face's own right side is at negative x).
 * Features are laid out on the face plane, the stereographic projection of the ball from the
 * back of the head: (x, y) = 2 (px, py) / (1 + pz). Near the middle of the face a unit is a
 * radian of arc, and a circle on the plane is a circle on the ball.
 */
import { DEG, type Mat3, multiply3, rotationAbout, type Vec3 } from "../../core/sphere";

export type Vec2 = readonly [number, number];

/** A direction in the face's axes to the face plane. */
export const toPlane = (p: Vec3): Vec2 => {
  const k = 2 / Math.max(1 + p[2], 1e-6);
  return [p[0] * k, p[1] * k];
};

/** A point of the face plane to a unit direction in the face's axes. */
export const fromPlane = (q: Vec2): Vec3 => {
  const r2 = q[0] * q[0] + q[1] * q[1];
  return [(4 * q[0]) / (4 + r2), (4 * q[1]) / (4 + r2), (4 - r2) / (4 + r2)];
};

/** Angle between the middle of the face and a point of the face plane, radians. */
export const offAxis = (q: Vec2): number => 2 * Math.atan(Math.hypot(q[0], q[1]) / 2);

/**
 * The face's axes in the room for a bearing (round the vertical, 0 towards +z), a pitch (the
 * elevation the face points at, negative downwards) and a roll about the way it faces (positive
 * tips the top of the head towards the face's own right, where the hand is). Rows are
 * the axes, so the matrix turns a room direction into the face's own. With `aim`, a point of
 * the face plane, that point rather than the middle of the face is what points along the
 * bearing and pitch: the head turned a little to show what is there.
 */
export const faceFrame = (bearing: number, pitch: number, roll = 0, aim?: Vec2): Mat3 => {
  const sb = Math.sin(bearing);
  const cb = Math.cos(bearing);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const z: Vec3 = [sb * cp, sp, cb * cp];
  const y0: Vec3 = [-sb * sp, cp, -cb * sp];
  const x0: Vec3 = [cb, 0, -sb];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const x: Vec3 = [x0[0] * cr + y0[0] * sr, x0[1] * cr + y0[1] * sr, x0[2] * cr + y0[2] * sr];
  const y: Vec3 = [y0[0] * cr - x0[0] * sr, y0[1] * cr - x0[1] * sr, y0[2] * cr - x0[2] * sr];
  const m: Mat3 = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  if (!aim || (aim[0] === 0 && aim[1] === 0)) return m;
  // The shortest turn, in the face's own axes, that carries its middle to the aimed point.
  const p = fromPlane(aim);
  const off = Math.hypot(p[0], p[1]);
  return multiply3(rotationAbout([-p[1], p[0], 0], Math.atan2(off, p[2])), m);
};

/** Each eye's middle (x mirrored for the other eye) and the half-sizes of its white. */
export const EYE = { x: 0.3, y: 0.09, rx: 0.105, ry: 0.15 } as const;
export const PUPIL = { rx: 0.064, ry: 0.082, travel: 0.034 } as const;
/**
 * A brow: a rounded stroke from its inner end to its outer end (x mirrored), bowed upwards by
 * `arch` in the middle, and raised by `lift` at a full brow lift.
 */
export const BROW = {
  inner: [0.17, 0.335],
  outer: [0.45, 0.34],
  arch: 0.04,
  half: 0.03,
  lift: 0.055,
} as const;
/** The mouth: a stroke `firm` wide when set straight, `wide` in a full smile `depth` deep. */
export const MOUTH = { y: -0.31, firm: 0.105, wide: 0.17, depth: 0.085, half: 0.024 } as const;
export const CHEEK = { x: 0.52, y: -0.13, r: 0.13 } as const;

/**
 * The hand, in its own coordinates: x from the wrist to the fingertips, y across it, the thumb
 * on the negative side. `tip` is the radius of the arc the fingertips end on.
 */
export const HAND = {
  halfLength: 0.36,
  halfWidth: 0.15,
  corner: 0.07,
  tip: 0.235,
  thumbFrom: [-0.2, -0.125],
  thumbTo: [0.04, -0.195],
  thumbR: 0.058,
  outline: 0.02,
  /** The cuff covers this much of the wrist end. */
  cuff: 0.13,
} as const;

/** Where the hand is: its middle on the face plane, the way its fingers point and its size. */
export interface HandPose {
  x: number;
  y: number;
  /** Radians from the plane's x axis, anticlockwise. */
  angle: number;
  /** 0 when it is out of sight, 1 full size. */
  scale: number;
}

/** The hand's slope in the salute: fingertips up and in towards the brow. */
export const SALUTE_ANGLE = 38 * DEG;
/** How far beyond the brow's outer end the fingertips come to rest. */
const TOUCH_GAP = 0.02;
/** Out of sight: low on the face's right, fingers pointing up, shrunk to nothing. */
const REST = { x: -0.86, y: -0.74, angle: 82 * DEG } as const;
/** The hand swings out round the cheek on its way up, by this much at the middle of the path. */
const SWING = 0.13;
/** The part of the path over which the hand grows to full size. */
const GROW = 0.42;

const smooth = (u: number): number => {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
};

/** The outer end of the brow on the face's right, where the fingertips go, for a brow lift. */
export const browEnd = (lift: number): Vec2 => [-BROW.outer[0], BROW.outer[1] + BROW.lift * lift];

/** The fingertips of a hand pose, on the face plane. */
export const fingertips = (h: HandPose): Vec2 => [
  h.x + Math.cos(h.angle) * HAND.halfLength * h.scale,
  h.y + Math.sin(h.angle) * HAND.halfLength * h.scale,
];

/**
 * The hand for `raise` from 0 (out of sight) to 1 (fingertips at the brow); a little over 1 is
 * the snap's overshoot. `lift` is the brow lift, which the fingertips follow.
 */
export const handPose = (raise: number, lift = 0): HandPose => {
  const r = raise < 0 ? 0 : raise;
  const end = browEnd(lift);
  const tipX = end[0] - TOUCH_GAP * Math.cos(SALUTE_ANGLE);
  const tipY = end[1] + TOUCH_GAP * 0.5;
  const sx = tipX - Math.cos(SALUTE_ANGLE) * HAND.halfLength;
  const sy = tipY - Math.sin(SALUTE_ANGLE) * HAND.halfLength;
  const swing = Math.sin(Math.PI * Math.min(r, 1)) * SWING;
  return {
    x: REST.x + (sx - REST.x) * r - swing,
    y: REST.y + (sy - REST.y) * r,
    angle: REST.angle + (SALUTE_ANGLE - REST.angle) * r,
    scale: smooth(r / GROW),
  };
};

const segDist = (px: number, py: number, a: Vec2, b: Vec2): number => {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * bx + (py - a[1]) * by) / (bx * bx + by * by)));
  return Math.hypot(px - a[0] - bx * t, py - a[1] - by * t);
};

/**
 * Signed distance from a point in the hand's own coordinates to its outline (negative inside),
 * the same shape the shader draws: a rounded slab ending in a shallow arc, with the thumb.
 */
export const handDistance = (hx: number, hy: number): number => {
  const bx = Math.abs(hx) - (HAND.halfLength - HAND.corner);
  const by = Math.abs(hy) - (HAND.halfWidth - HAND.corner);
  const slab =
    Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0) - HAND.corner;
  const arc = Math.hypot(Math.max(hx - (HAND.halfLength - HAND.tip), 0), hy) - HAND.tip;
  const thumb = segDist(hx, hy, HAND.thumbFrom, HAND.thumbTo) - HAND.thumbR;
  return Math.min(Math.max(slab, arc), thumb);
};

/** Signed distance from a point of the face plane to a posed hand, in plane units. */
export const handDistanceAt = (q: Vec2, h: HandPose): number => {
  if (h.scale <= 0) return Infinity;
  const c = Math.cos(h.angle);
  const s = Math.sin(h.angle);
  const dx = (q[0] - h.x) / h.scale;
  const dy = (q[1] - h.y) / h.scale;
  return handDistance(dx * c + dy * s, dy * c - dx * s) * h.scale;
};
