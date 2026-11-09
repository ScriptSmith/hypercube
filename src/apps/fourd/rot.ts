/**
 * Rotations of four-dimensional space, as 4 x 4 matrices (row-major, `m[r * 4 + c]`, applied as
 * `y = M x`). Pure.
 *
 * A turn in a coordinate plane is the basic move (a dial turns the shape in the xw plane, say).
 * Every change is followed by Gram-Schmidt on the rows, so days of small turns never drift away
 * from a rotation. Easing between two orientations goes through a pair of unit quaternions: every
 * rotation of 4D space is `v -> a v b` for unit quaternions a and b (v read as a quaternion), and
 * slerping a and b gives a rotation at every step, however far apart the ends are.
 */

export type Mat4 = Float64Array;
export type Vec4 = [number, number, number, number];
export type Quat = [number, number, number, number];

export const identity = (out: Mat4 = new Float64Array(16)): Mat4 => {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
};

export const copyMat = (src: Mat4, out: Mat4 = new Float64Array(16)): Mat4 => {
  out.set(src);
  return out;
};

const tmpA = new Float64Array(16);

/** `a * b` into `out`, which may be `a` or `b`. */
export const mul = (a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 => {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      tmpA[r * 4 + c] = s;
    }
  }
  out.set(tmpA);
  return out;
};

export const transpose = (m: Mat4, out: Mat4 = new Float64Array(16)): Mat4 => {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) tmpA[c * 4 + r] = m[r * 4 + c]!;
  out.set(tmpA);
  return out;
};

/**
 * The turn by `angle` in the plane of axes i and j that carries axis i towards axis j: e_i goes
 * to cos e_i + sin e_j.
 */
export const planeTurn = (
  i: number,
  j: number,
  angle: number,
  out: Mat4 = new Float64Array(16),
): Mat4 => {
  identity(out);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[i * 4 + i] = c;
  out[j * 4 + j] = c;
  out[j * 4 + i] = s;
  out[i * 4 + j] = -s;
  return out;
};

/** `m v` into `out`. `v` may have fewer than four entries; the rest count as 0. */
export const apply = (m: Mat4, v: ArrayLike<number>, out: number[] | Float64Array): void => {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  const w = v[3] ?? 0;
  for (let r = 0; r < 4; r++) {
    out[r] = m[r * 4]! * x + m[r * 4 + 1]! * y + m[r * 4 + 2]! * z + m[r * 4 + 3]! * w;
  }
};

/**
 * Gram-Schmidt on the rows, in place, twice over for accuracy, then a sign fix so the
 * determinant stays +1. Returns false (and leaves the identity) if the rows were degenerate.
 */
export const orthonormalize = (m: Mat4): boolean => {
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < 4; r++) {
      for (let p = 0; p < r; p++) {
        let d = 0;
        for (let c = 0; c < 4; c++) d += m[r * 4 + c]! * m[p * 4 + c]!;
        for (let c = 0; c < 4; c++) m[r * 4 + c] = m[r * 4 + c]! - d * m[p * 4 + c]!;
      }
      let n = 0;
      for (let c = 0; c < 4; c++) n += m[r * 4 + c]! * m[r * 4 + c]!;
      n = Math.sqrt(n);
      if (!(n > 1e-9) || !Number.isFinite(n)) {
        identity(m);
        return false;
      }
      for (let c = 0; c < 4; c++) m[r * 4 + c] = m[r * 4 + c]! / n;
    }
  }
  if (det(m) < 0) for (let c = 0; c < 4; c++) m[12 + c] = -m[12 + c]!;
  return true;
};

export const det = (m: Mat4): number => {
  const a = (r: number, c: number) => m[r * 4 + c]!;
  const s0 = a(0, 0) * a(1, 1) - a(1, 0) * a(0, 1);
  const s1 = a(0, 0) * a(1, 2) - a(1, 0) * a(0, 2);
  const s2 = a(0, 0) * a(1, 3) - a(1, 0) * a(0, 3);
  const s3 = a(0, 1) * a(1, 2) - a(1, 1) * a(0, 2);
  const s4 = a(0, 1) * a(1, 3) - a(1, 1) * a(0, 3);
  const s5 = a(0, 2) * a(1, 3) - a(1, 2) * a(0, 3);
  const c5 = a(2, 2) * a(3, 3) - a(3, 2) * a(2, 3);
  const c4 = a(2, 1) * a(3, 3) - a(3, 1) * a(2, 3);
  const c3 = a(2, 1) * a(3, 2) - a(3, 1) * a(2, 2);
  const c2 = a(2, 0) * a(3, 3) - a(3, 0) * a(2, 3);
  const c1 = a(2, 0) * a(3, 2) - a(3, 0) * a(2, 2);
  const c0 = a(2, 0) * a(3, 1) - a(3, 0) * a(2, 1);
  return s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
};

/** Largest entry of `M Mᵀ - I`: 0 for an exact rotation. */
export const orthoError = (m: Mat4): number => {
  let worst = 0;
  for (let r = 0; r < 4; r++) {
    for (let p = 0; p < 4; p++) {
      let d = 0;
      for (let c = 0; c < 4; c++) d += m[r * 4 + c]! * m[p * 4 + c]!;
      worst = Math.max(worst, Math.abs(d - (r === p ? 1 : 0)));
    }
  }
  return worst;
};

const tmpTurn = new Float64Array(16);

/** Turn `m` by `angle` in the world's (i, j) plane, in place: `m = P m`, then re-orthonormalise. */
export const turnBy = (m: Mat4, i: number, j: number, angle: number): Mat4 => {
  if (angle === 0 || !Number.isFinite(angle)) return m;
  planeTurn(i, j, angle, tmpTurn);
  mul(tmpTurn, m, m);
  orthonormalize(m);
  return m;
};

// ---- Turning one direction onto another ---------------------------------------------------

/**
 * The rotation in the plane of unit vectors `a` and `u` by `frac` of the angle between them, so
 * `frac` = 1 carries `a` onto `u`. When they are opposite, the plane is any one containing `a`.
 */
export const alignTurn = (
  a: ArrayLike<number>,
  u: ArrayLike<number>,
  frac: number,
  out: Mat4 = new Float64Array(16),
): Mat4 => {
  const e1 = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0];
  const dot =
    e1[0]! * (u[0] ?? 0) + e1[1]! * (u[1] ?? 0) + e1[2]! * (u[2] ?? 0) + e1[3]! * (u[3] ?? 0);
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  identity(out);
  if (theta < 1e-9) return out;
  let e2 = [0, 1, 2, 3].map((k) => (u[k] ?? 0) - dot * e1[k]!);
  let n = Math.hypot(...e2);
  if (n < 1e-9) {
    // Opposite: pick the coordinate axis least like `a` and take its part across `a`.
    let best = 0;
    for (let k = 1; k < 4; k++) if (Math.abs(e1[k]!) < Math.abs(e1[best]!)) best = k;
    e2 = [0, 1, 2, 3].map((k) => (k === best ? 1 : 0) - e1[best]! * e1[k]!);
    n = Math.hypot(...e2);
  }
  e2 = e2.map((x) => x / n);
  const phi = theta * frac;
  const c = Math.cos(phi) - 1;
  const s = Math.sin(phi);
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 4; col++) {
      out[r * 4 + col] =
        out[r * 4 + col]! +
        c * (e1[r]! * e1[col]! + e2[r]! * e2[col]!) +
        s * (e2[r]! * e1[col]! - e1[r]! * e2[col]!);
    }
  }
  return out;
};

/** The angle (radians) between two unit vectors. */
export const angleBetween = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let d = 0;
  for (let k = 0; k < 4; k++) d += (a[k] ?? 0) * (b[k] ?? 0);
  return Math.acos(Math.max(-1, Math.min(1, d)));
};

// ---- Quaternion pairs -----------------------------------------------------------------------

/** Quaternion product, components [real, i, j, k]. */
export const qmul = (p: ArrayLike<number>, q: ArrayLike<number>, out: number[] = [0, 0, 0, 0]) => {
  const [a0, a1, a2, a3] = [p[0]!, p[1]!, p[2]!, p[3]!];
  const [b0, b1, b2, b3] = [q[0]!, q[1]!, q[2]!, q[3]!];
  out[0] = a0 * b0 - a1 * b1 - a2 * b2 - a3 * b3;
  out[1] = a0 * b1 + a1 * b0 + a2 * b3 - a3 * b2;
  out[2] = a0 * b2 - a1 * b3 + a2 * b0 + a3 * b1;
  out[3] = a0 * b3 + a1 * b2 - a2 * b1 + a3 * b0;
  return out;
};

const unit = (k: number): Quat => [
  k === 0 ? 1 : 0,
  k === 1 ? 1 : 0,
  k === 2 ? 1 : 0,
  k === 3 ? 1 : 0,
];

/** BASIS[k][l] is the matrix of v -> e_k v e_l, a signed permutation. */
const BASIS: Float64Array[][] = [0, 1, 2, 3].map((k) =>
  [0, 1, 2, 3].map((l) => {
    const m = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      const col = qmul(qmul(unit(k), unit(c)), unit(l));
      for (let r = 0; r < 4; r++) m[r * 4 + c] = col[r]!;
    }
    return m;
  }),
);

/** The rotation `v -> a v b`. */
export const fromPair = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  out: Mat4 = new Float64Array(16),
) => {
  const t: number[] = [0, 0, 0, 0];
  const t2: number[] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    qmul(a, unit(c), t);
    qmul(t, b, t2);
    for (let r = 0; r < 4; r++) out[r * 4 + c] = t2[r]!;
  }
  return out;
};

/**
 * Unit quaternions a and b with `m` = (v -> a v b). The sixteen matrices v -> e_k v e_l are
 * orthogonal with squared norm 4, and m is the sum of a_k b_l times them, so a_k b_l is m's
 * component along each, divided by 4: a rank-one matrix whose row and column give b and a.
 * (a, b) and (-a, -b) are the same rotation.
 */
export const toPair = (m: Mat4): { a: Quat; b: Quat } => {
  const A: number[] = Array.from({ length: 16 }, () => 0);
  for (let k = 0; k < 4; k++) {
    for (let l = 0; l < 4; l++) {
      const B = BASIS[k]![l]!;
      let s = 0;
      for (let i = 0; i < 16; i++) s += m[i]! * B[i]!;
      A[k * 4 + l] = s / 4;
    }
  }
  let row = 0;
  let best = -1;
  for (let k = 0; k < 4; k++) {
    let n = 0;
    for (let l = 0; l < 4; l++) n += A[k * 4 + l]! ** 2;
    if (n > best) {
      best = n;
      row = k;
    }
  }
  const bn = Math.sqrt(best) || 1;
  const b: Quat = [0, 1, 2, 3].map((l) => A[row * 4 + l]! / bn) as Quat;
  const a: Quat = [0, 1, 2, 3].map((k) => {
    let s = 0;
    for (let l = 0; l < 4; l++) s += A[k * 4 + l]! * b[l]!;
    return s;
  }) as Quat;
  const an = Math.hypot(...a) || 1;
  for (let k = 0; k < 4; k++) a[k] = a[k]! / an;
  return { a, b };
};

const qdot = (p: ArrayLike<number>, q: ArrayLike<number>) =>
  p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]! + p[3]! * q[3]!;

/** Spherical interpolation between unit quaternions (no sign flip: the caller picks the signs). */
export const slerpQ = (p: ArrayLike<number>, q: ArrayLike<number>, t: number): Quat => {
  const d = Math.max(-1, Math.min(1, qdot(p, q)));
  const theta = Math.acos(d);
  let s0: number;
  let s1: number;
  if (theta < 1e-6) {
    s0 = 1 - t;
    s1 = t;
  } else {
    const sn = Math.sin(theta);
    s0 = Math.sin((1 - t) * theta) / sn;
    s1 = Math.sin(t * theta) / sn;
  }
  const out = [0, 1, 2, 3].map((k) => s0 * p[k]! + s1 * q[k]!) as Quat;
  const n = Math.hypot(...out) || 1;
  return out.map((x) => x / n) as Quat;
};

/**
 * The rotation `t` of the way from `m0` to `m1` along their quaternion pairs, into `out`. Signs
 * are chosen so both halves take the shorter way where they can.
 */
export const slerpRot = (m0: Mat4, m1: Mat4, t: number, out: Mat4 = new Float64Array(16)): Mat4 => {
  if (t <= 0) return copyMat(m0, out);
  if (t >= 1) return copyMat(m1, out);
  const p0 = toPair(m0);
  const p1 = toPair(m1);
  if (qdot(p0.a, p1.a) + qdot(p0.b, p1.b) < 0) {
    for (let k = 0; k < 4; k++) {
      p1.a[k] = -p1.a[k]!;
      p1.b[k] = -p1.b[k]!;
    }
  }
  fromPair(slerpQ(p0.a, p1.a, t), slerpQ(p0.b, p1.b, t), out);
  orthonormalize(out);
  return out;
};

/** Frobenius distance between two matrices: 0 when equal, up to 4√2 for opposite rotations. */
export const distance = (a: Mat4, b: Mat4): number => {
  let s = 0;
  for (let i = 0; i < 16; i++) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
};
