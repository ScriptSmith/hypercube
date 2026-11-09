/**
 * Convex hulls of a few dozen points, in the plane and in space. Pure.
 *
 * A slice of a convex polytope is the hull of the points where its edges cross the cut. Those
 * points are often coincident (the cut through a corner) or coplanar (a cube's face), and the
 * slice can be a single point, a segment or a flat polygon when the cut just touches the shape.
 * The 3D hull here finds the points' true dimension first, then for a solid lists every face
 * plane that has all points on one side and orders the points on it, so faces come out as whole
 * polygons (a cube has six squares, not twelve triangles) and their edges are the real edges.
 * With at most 48 points that brute-force search is quick, and it never meets the degenerate
 * cases that trip incremental hulls.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const MAX_POINTS = 48;

export interface Hull3 {
  kind: "empty" | "point" | "segment" | "polygon" | "solid";
  /** The distinct points the hull uses. */
  points: Vec3[];
  /**
   * Faces as loops of indices into `points`, counter-clockwise seen from outside. A polygon has
   * one face; a segment has one "face" of its two ends; a point one of one.
   */
  faces: number[][];
  /** Outward unit normal per face (a polygon's is one side of its plane). */
  normals: Vec3[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));

/**
 * Indices of the hull's corners, counter-clockwise, with points on its edges left out.
 * Monotone chain. Fewer than three distinct points come back as they are (one or two indices).
 */
export const hull2 = (pts: readonly Vec2[], eps = 1e-9): number[] => {
  const idx = pts.map((_, i) => i);
  idx.sort((i, j) => pts[i]![0] - pts[j]![0] || pts[i]![1] - pts[j]![1]);
  const uniq: number[] = [];
  for (const i of idx) {
    const last = uniq[uniq.length - 1];
    if (last !== undefined) {
      const p = pts[last]!;
      const q = pts[i]!;
      if (Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps) continue;
    }
    uniq.push(i);
  }
  if (uniq.length < 3) return uniq;
  const turn = (o: number, a: number, b: number) => {
    const O = pts[o]!;
    const A = pts[a]!;
    const B = pts[b]!;
    return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  };
  // Scale the collinearity test to the points' spread.
  let span = 0;
  for (const i of uniq) span = Math.max(span, Math.abs(pts[i]![0]), Math.abs(pts[i]![1]));
  const tol = eps * Math.max(1, span * span);
  const lower: number[] = [];
  for (const i of uniq) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= tol)
      lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = uniq.length - 1; k >= 0; k--) {
    const i = uniq[k]!;
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= tol)
      upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  const out = lower.concat(upper);
  // All collinear: the two ends.
  if (out.length < 3) return [uniq[0]!, uniq[uniq.length - 1]!];
  return out;
};

const empty = (): Hull3 => ({ kind: "empty", points: [], faces: [], normals: [] });

/** Points in the plane through `o` spanned by unit `e1`, `e2`, as a polygon face. */
const planeHull = (pts: readonly Vec3[], o: Vec3, e1: Vec3, e2: Vec3, eps: number) => {
  const flat: Vec2[] = pts.map((p) => {
    const d = sub(p, o);
    return [dot(d, e1), dot(d, e2)];
  });
  return hull2(flat, eps);
};

/**
 * The hull of `input` (at most MAX_POINTS are used). `eps` is the distance under which points
 * count as the same, or as lying on a line or plane, relative to the points' spread.
 */
export const hull3 = (input: readonly Vec3[], eps = 1e-7): Hull3 => {
  const raw = input.slice(0, MAX_POINTS).filter((p) => p.every(Number.isFinite));
  if (raw.length === 0) return empty();
  let spread = 0;
  for (const p of raw) spread = Math.max(spread, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const tol = eps * Math.max(1e-6, spread);
  // Merge points closer than tol.
  const pts: Vec3[] = [];
  for (const p of raw) {
    if (
      !pts.some(
        (q) =>
          Math.abs(p[0] - q[0]) <= tol &&
          Math.abs(p[1] - q[1]) <= tol &&
          Math.abs(p[2] - q[2]) <= tol,
      )
    ) {
      pts.push([p[0], p[1], p[2]]);
    }
  }
  if (pts.length === 1) return { kind: "point", points: pts, faces: [[0]], normals: [[0, 0, 1]] };

  // The farthest pair sets a line.
  let ia = 0;
  let ib = 0;
  let far = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = len(sub(pts[i]!, pts[j]!));
      if (d > far) {
        far = d;
        ia = i;
        ib = j;
      }
    }
  }
  if (far <= tol) return { kind: "point", points: [pts[0]!], faces: [[0]], normals: [[0, 0, 1]] };
  const a = pts[ia]!;
  const dir = unit(sub(pts[ib]!, a));
  // The point farthest from that line sets a plane.
  let ic = -1;
  let off = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = sub(pts[i]!, a);
    const h = len(sub(d, scale(dir, dot(d, dir))));
    if (h > off) {
      off = h;
      ic = i;
    }
  }
  if (off <= tol || ic < 0) {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < pts.length; i++) {
      const t = dot(sub(pts[i]!, a), dir);
      if (t < dot(sub(pts[lo]!, a), dir)) lo = i;
      if (t > dot(sub(pts[hi]!, a), dir)) hi = i;
    }
    return {
      kind: "segment",
      points: [pts[lo]!, pts[hi]!],
      faces: [[0, 1]],
      normals: [[0, 0, 1]],
    };
  }
  const nrm = unit(cross(dir, sub(pts[ic]!, a)));
  // The point farthest from that plane, if any, makes it solid.
  let depth = 0;
  for (const p of pts) depth = Math.max(depth, Math.abs(dot(sub(p, a), nrm)));
  if (depth <= tol) {
    const e2 = cross(nrm, dir);
    const loop = planeHull(pts, a, dir, e2, tol);
    const points = loop.map((i) => pts[i]!);
    return {
      kind: "polygon",
      points,
      faces: [points.map((_, i) => i)],
      normals: [nrm],
    };
  }

  // Solid: every plane through three points with all points on one side is a face plane.
  const planes: { n: Vec3; d: number }[] = [];
  const onPlane = (pl: { n: Vec3; d: number }, p: Vec3) => Math.abs(dot(pl.n, p) - pl.d) <= tol;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const p = pts[i]!;
        const q = pts[j]!;
        const r = pts[k]!;
        if (planes.some((pl) => onPlane(pl, p) && onPlane(pl, q) && onPlane(pl, r))) continue;
        const c = cross(sub(q, p), sub(r, p));
        const cl = len(c);
        if (cl <= tol * Math.max(tol, len(sub(q, p)), len(sub(r, p)))) continue;
        const u = scale(c, 1 / cl);
        const d = dot(u, p);
        let above = false;
        let below = false;
        for (const s of pts) {
          const h = dot(u, s) - d;
          if (h > tol) above = true;
          else if (h < -tol) below = true;
          if (above && below) break;
        }
        if (above && below) continue;
        planes.push(above ? { n: scale(u, -1), d: -d } : { n: u, d });
      }
    }
  }
  const faces: number[][] = [];
  const normals: Vec3[] = [];
  for (const pl of planes) {
    const on: number[] = [];
    for (let i = 0; i < n; i++) if (onPlane(pl, pts[i]!)) on.push(i);
    if (on.length < 3) continue;
    const o = pts[on[0]!]!;
    // A basis with e1 x e2 = n, so counter-clockwise in it is counter-clockwise from outside.
    const helper: Vec3 = Math.abs(pl.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = unit(cross(helper, pl.n));
    const e2 = cross(pl.n, e1);
    const loop = planeHull(
      on.map((i) => pts[i]!),
      o,
      e1,
      e2,
      tol,
    );
    if (loop.length < 3) continue;
    faces.push(loop.map((li) => on[li]!));
    normals.push(pl.n);
  }
  return { kind: "solid", points: pts, faces, normals };
};

/** Volume of a solid hull (0 otherwise), by summing tetrahedra from the first point. */
export const hullVolume = (h: Hull3): number => {
  if (h.kind !== "solid") return 0;
  const o = h.points[0]!;
  let v = 0;
  for (const f of h.faces) {
    const a = h.points[f[0]!]!;
    for (let i = 1; i + 1 < f.length; i++) {
      const b = h.points[f[i]!]!;
      const c = h.points[f[i + 1]!]!;
      v += dot(sub(a, o), cross(sub(b, o), sub(c, o))) / 6;
    }
  }
  return Math.abs(v);
};

/** Every edge of the hull once, as pairs of indices into `points`. */
export const hullEdges = (h: Hull3): [number, number][] => {
  if (h.kind === "segment") return [[0, 1]];
  if (h.kind === "point" || h.kind === "empty") return [];
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const f of h.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
};
