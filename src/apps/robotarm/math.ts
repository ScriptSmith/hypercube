/**
 * Small vector, rotation-matrix and quaternion helpers for the simulation, so it runs without
 * three.js (tests, and the logic that must not depend on the renderer). World axes: y up, x to
 * the right of the bench, z towards the front (the viewer).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Row-major 3 x 3 rotation; its columns are the rotated x, y and z axes. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** x, y, z, w. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
/** a + b * k */
export const addScaled = (a: Vec3, b: Vec3, k: number): Vec3 =>
  v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : v3(0, 1, 0);
};
export const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 =>
  v3(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const mul = (a: Mat3, b: Mat3): Mat3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

export const apply = (m: Mat3, v: Vec3): Vec3 =>
  v3(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const col = (m: Mat3, i: 0 | 1 | 2): Vec3 => v3(m[i], m[3 + i], m[6 + i]);

/** Rotation about x: y turns towards z. */
export const rotX = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};

/** Rotation about y: z turns towards x. */
export const rotY = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

/** Rotation about z: x turns towards y. */
export const rotZ = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** Rotation by `a` about a unit axis (Rodrigues). */
export const rotAxis = (axis: Vec3, a: number): Mat3 => {
  const { x, y, z } = axis;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
};

export const quatFromMat = (m: Mat3): Quat => {
  const tr = m[0] + m[4] + m[8];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return { w: s / 4, x: (m[7] - m[5]) / s, y: (m[2] - m[6]) / s, z: (m[3] - m[1]) / s };
  }
  if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    return { w: (m[7] - m[5]) / s, x: s / 4, y: (m[1] + m[3]) / s, z: (m[2] + m[6]) / s };
  }
  if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    return { w: (m[2] - m[6]) / s, x: (m[1] + m[3]) / s, y: s / 4, z: (m[5] + m[7]) / s };
  }
  const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
  return { w: (m[3] - m[1]) / s, x: (m[2] + m[6]) / s, y: (m[5] + m[7]) / s, z: s / 4 };
};

export const matFromQuat = (q: Quat): Mat3 => {
  const { x, y, z, w } = q;
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

export const quatNormalize = (q: Quat): Quat => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};

export const quatDot = (a: Quat, b: Quat): number => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

/** Angle between two orientations, in radians, 0 to pi. */
export const quatAngle = (a: Quat, b: Quat): number =>
  2 * Math.acos(Math.min(1, Math.abs(quatDot(a, b))));

export const slerp = (a: Quat, b: Quat, f: number): Quat => {
  let d = quatDot(a, b);
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) {
    return quatNormalize({
      x: a.x + (bx - a.x) * f,
      y: a.y + (by - a.y) * f,
      z: a.z + (bz - a.z) * f,
      w: a.w + (bw - a.w) * f,
    });
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - f) * th) / s;
  const kb = Math.sin(f * th) / s;
  return {
    x: a.x * ka + bx * kb,
    y: a.y * ka + by * kb,
    z: a.z * ka + bz * kb,
    w: a.w * ka + bw * kb,
  };
};

/** Turn `a` towards `b` by at most `maxAngle` radians. */
export const quatToward = (a: Quat, b: Quat, maxAngle: number): Quat => {
  const ang = quatAngle(a, b);
  if (ang <= maxAngle || ang < 1e-6) return b;
  return slerp(a, b, maxAngle / ang);
};

/** Wrap an angle to (-pi, pi]. */
export const wrapAngle = (a: number): number => {
  const t = Math.PI * 2;
  let r = a % t;
  if (r <= -Math.PI) r += t;
  else if (r > Math.PI) r -= t;
  return r;
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The 24 rotations that map a cube onto itself, as matrices whose columns are signed unit axes.
 * Used to square a block to the jaws with the least visible turn.
 */
export const CUBE_SYMMETRIES: readonly Mat3[] = (() => {
  const out: Mat3[] = [];
  const axes: Vec3[] = [
    v3(1, 0, 0),
    v3(-1, 0, 0),
    v3(0, 1, 0),
    v3(0, -1, 0),
    v3(0, 0, 1),
    v3(0, 0, -1),
  ];
  for (const a of axes) {
    for (const b of axes) {
      if (Math.abs(dot(a, b)) > 0.5) continue;
      const c = cross(a, b);
      out.push([a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z]);
    }
  }
  return out;
})();
