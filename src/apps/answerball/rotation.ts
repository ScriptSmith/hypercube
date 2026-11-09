/**
 * Rotations as unit quaternions [x, y, z, w], for blending one orientation into another without
 * the twists that blending matrices or angles would bring. Matrices are row by row, as in
 * `src/core/sphere.ts`.
 */
import type { Mat3, Vec3 } from "../../core/sphere";

export type Quat = readonly [number, number, number, number];

export const IDENTITY_Q: Quat = [0, 0, 0, 1];

export const normQ = (q: readonly number[]): Quat => {
  const l = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  return [q[0]! / l, q[1]! / l, q[2]! / l, q[3]! / l];
};

export const quatFromMat3 = (m: Mat3): Quat => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return normQ([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normQ([s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normQ([(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normQ([(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]);
};

export const mat3FromQuat = (q: Quat): Mat3 => {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
};

/** Along the shorter way from `a` to `b`, `t` of the way. */
export const slerpQ = (a: Quat, b: Quat, t: number): Quat => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let s = 1;
  if (d < 0) {
    d = -d;
    s = -1;
  }
  if (d > 0.9995) {
    return normQ([
      a[0] + (s * b[0] - a[0]) * t,
      a[1] + (s * b[1] - a[1]) * t,
      a[2] + (s * b[2] - a[2]) * t,
      a[3] + (s * b[3] - a[3]) * t,
    ]);
  }
  const th = Math.acos(Math.min(1, d));
  const sa = Math.sin((1 - t) * th) / Math.sin(th);
  const sb = (s * Math.sin(t * th)) / Math.sin(th);
  return normQ([
    a[0] * sa + b[0] * sb,
    a[1] * sa + b[1] * sb,
    a[2] * sa + b[2] * sb,
    a[3] * sa + b[3] * sb,
  ]);
};

/** Blend two rotations, `t` of the way from `a` to `b`. */
export const blend = (a: Mat3, b: Mat3, t: number): Mat3 =>
  t <= 0 ? a : t >= 1 ? b : mat3FromQuat(slerpQ(quatFromMat3(a), quatFromMat3(b), t));

/** Angle of the rotation that takes `a` to `b`, radians. */
export const angleBetweenRotations = (a: Mat3, b: Mat3): number => {
  const qa = quatFromMat3(a);
  const qb = quatFromMat3(b);
  const d = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
  return 2 * Math.acos(Math.min(1, d));
};

/** Largest error from a proper rotation: rows of unit length at right angles, determinant 1. */
export const rotationError = (m: Mat3): number => {
  const r: Vec3[] = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.max(
    Math.abs(d(r[0]!, r[0]!) - 1),
    Math.abs(d(r[1]!, r[1]!) - 1),
    Math.abs(d(r[2]!, r[2]!) - 1),
    Math.abs(d(r[0]!, r[1]!)),
    Math.abs(d(r[0]!, r[2]!)),
    Math.abs(d(r[1]!, r[2]!)),
    Math.abs(det - 1),
  );
};

export const quatAbout = (axis: Vec3, angle: number): Quat => {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2) / l;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

/** The rotation `b`, then `a`. */
export const mulQ = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

export const dotQ = (a: Quat, b: Quat): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

export const negQ = (q: Quat): Quat => [-q[0], -q[1], -q[2], -q[3]];

/**
 * From `a` to `b` exactly as given, `t` of the way, never switching to the other way round. With
 * both ends moving smoothly the result moves smoothly too, where `slerpQ`'s choice of the shorter
 * way can flip from one moment to the next.
 */
export const slerpFixed = (a: Quat, b: Quat, t: number): Quat => {
  const d = Math.max(-1, Math.min(1, dotQ(a, b)));
  const th = Math.acos(d);
  const s = Math.sin(th);
  if (s < 1e-6) return d > 0 ? b : a;
  const sa = Math.sin((1 - t) * th) / s;
  const sb = Math.sin(t * th) / s;
  return normQ([
    a[0] * sa + b[0] * sb,
    a[1] * sa + b[1] * sb,
    a[2] * sa + b[2] * sb,
    a[3] * sa + b[3] * sb,
  ]);
};
