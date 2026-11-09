/**
 * Slices and shadows of a turned shape. Pure.
 *
 * A stage hides one axis: w for a 4D shape (our space is w = cut), up for a 3D shape (the flat
 * world is a horizontal sheet) and across for a 2D shape (the line world is upright). The slice
 * is where the shape crosses the cut: for a polytope the hull of the points where its edges
 * cross, for the ball a ball one dimension down of radius √(1 - cut²). The shadow of a 4D shape
 * is its perspective projection along w, from an eye at w = EYE, scaled so w = 0 keeps its size.
 */
import { type Hull3, hull2, hull3, type Vec2, type Vec3 } from "./hull";
import { apply, type Mat4, type Vec4 } from "./rot";
import type { Dim, Shape } from "./shapes";

/** Distance of the eye along w, in circumradii: the tesseract's inner cube is 0.6 of its outer. */
export const EYE = 2;
/** The lever's travel reaches this far each way, a little past the shape in any direction. */
export const REACH = 1.08;

/** The hidden axis of a stage of each dimension (x = 0, y = 1, z = 2, w = 3). */
export const HIDDEN: Record<Dim, number> = { 2: 0, 3: 1, 4: 3 };

/** The shape's corners (or ring points) after turning, into `out` (resized to fit). */
export const turned = (shape: Shape, rot: Mat4, out: Vec4[] = []): Vec4[] => {
  out.length = shape.verts.length;
  for (let i = 0; i < shape.verts.length; i++) {
    const v = (out[i] ??= [0, 0, 0, 0]);
    apply(rot, shape.verts[i]!, v);
  }
  return out;
};

/** How far the shape reaches each way along `axis` once turned. */
export const extent = (shape: Shape, rot: Mat4, axis: number): { lo: number; hi: number } => {
  if (shape.round) return { lo: -1, hi: 1 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of shape.verts) {
    const h =
      rot[axis * 4]! * v[0] +
      rot[axis * 4 + 1]! * v[1] +
      rot[axis * 4 + 2]! * v[2] +
      rot[axis * 4 + 3]! * v[3];
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return { lo, hi };
};

/** Points where the turned polytope's edges cross `axis` = `cut`, with the axis left out. */
export const crossings = (
  shape: Shape,
  pts: readonly Vec4[],
  axis: number,
  cut: number,
  eps = 1e-9,
): number[][] => {
  const keep = [0, 1, 2, 3].filter((k) => k !== axis && k < Math.max(shape.dim, axis + 1));
  const out: number[][] = [];
  const pick = (v: readonly number[]) => keep.map((k) => v[k]!);
  for (const v of pts) if (Math.abs(v[axis]! - cut) <= eps) out.push(pick(v));
  for (const [i, j] of shape.edges) {
    const a = pts[i]!;
    const b = pts[j]!;
    const ha = a[axis]! - cut;
    const hb = b[axis]! - cut;
    if (Math.abs(ha) <= eps || Math.abs(hb) <= eps) continue;
    if (ha > 0 === hb > 0) continue;
    const t = ha / (ha - hb);
    out.push(pick(a.map((x, k) => x + (b[k]! - x) * t)));
  }
  return out;
};

/** A slice of a 4D shape: a 3D body (solid, polygon, segment or point) or a ball's sphere. */
export type Slice4 = { kind: "hull"; hull: Hull3 } | { kind: "ball"; r: number } | { kind: "none" };

/**
 * The slice of a turned 4D shape at w = cut, in xyz. A cut that misses gives "none"; a cut
 * through the ball's very edge gives a ball of radius 0, drawn as a dot.
 */
export const slice4 = (shape: Shape, pts: readonly Vec4[], cut: number): Slice4 => {
  if (shape.round) {
    const r2 = 1 - cut * cut;
    return r2 < -1e-9 ? { kind: "none" } : { kind: "ball", r: Math.sqrt(Math.max(0, r2)) };
  }
  const c = crossings(shape, pts, 3, cut) as Vec3[];
  const hull = hull3(c);
  return hull.kind === "empty" ? { kind: "none" } : { kind: "hull", hull };
};

/** A slice of a 3D shape: a flat polygon in the sheet (x, z), a segment, a point or a circle. */
export type Slice3 =
  | { kind: "poly"; points: Vec2[] }
  | { kind: "circle"; r: number }
  | { kind: "none" };

/** The slice of a turned 3D shape at height y = cut, as (x, z) points round its outline. */
export const slice3 = (shape: Shape, pts: readonly Vec4[], cut: number): Slice3 => {
  if (shape.round) {
    const r2 = 1 - cut * cut;
    return r2 < -1e-9 ? { kind: "none" } : { kind: "circle", r: Math.sqrt(Math.max(0, r2)) };
  }
  const c = crossings(shape, pts, 1, cut) as Vec2[];
  if (c.length === 0) return { kind: "none" };
  const loop = hull2(c, 1e-9);
  return { kind: "poly", points: loop.map((i) => c[i]!) };
};

/** A slice of a 2D shape: the part of the upright line x = cut inside it, as y from lo to hi. */
export type Slice2 = { kind: "span"; lo: number; hi: number } | { kind: "none" };

export const slice2 = (shape: Shape, pts: readonly Vec4[], cut: number): Slice2 => {
  if (shape.round) {
    const r2 = 1 - cut * cut;
    if (r2 < -1e-9) return { kind: "none" };
    const r = Math.sqrt(Math.max(0, r2));
    return { kind: "span", lo: -r, hi: r };
  }
  const c = crossings(shape, pts, 0, cut);
  if (c.length === 0) return { kind: "none" };
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of c) {
    lo = Math.min(lo, p[0]!);
    hi = Math.max(hi, p[0]!);
  }
  return { kind: "span", lo, hi };
};

/** Perspective scale for a point at depth w along the fourth axis. */
export const depthScale = (w: number, eye = EYE): number => eye / Math.max(1e-3, eye - w);

/** A turned 4D point's shadow in xyz, into `out`. */
export const project = (v: Vec4, out: Vec3, eye = EYE): Vec3 => {
  const s = depthScale(v[3], eye);
  out[0] = v[0] * s;
  out[1] = v[1] * s;
  out[2] = v[2] * s;
  return out;
};

/** The radius that holds the shadow of anything inside the unit 4-ball, from any turn. */
export const shadowRadius = (eye = EYE): number => eye / Math.sqrt(eye * eye - 1);

/**
 * A lever position (-1 to 1) as a cut along the hidden axis. On a 2D stage the shape slides
 * right as the lever moves right, so the line meets it further left: the cut runs the other way.
 */
export const cutOf = (dim: Dim, t: number): number => (dim === 2 ? -t : t) * REACH;

/** The lever position for a cut. */
export const leverOf = (dim: Dim, cut: number): number =>
  Math.max(-1, Math.min(1, (dim === 2 ? -cut : cut) / REACH));
