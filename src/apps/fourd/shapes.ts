/**
 * The shapes, from textbook definitions, every one with circumradius 1 so a lever's travel suits
 * them all. Pure.
 *
 * Four families, each in two, three and four dimensions: cubes (square, cube, tesseract), the
 * pyramid or simplex (triangle, tetrahedron, 5-cell), the diamond or cross-polytope (square turned
 * 45°, octahedron, 16-cell) and the ball (circle, sphere, 4-ball). Polytopes are vertex and edge
 * lists; the ball is drawn as a few great circles and sliced analytically. Points are 4-vectors,
 * zero past the shape's own dimensions.
 */
import type { Vec4 } from "./rot";

export type Family = "cube" | "pyramid" | "diamond" | "ball";
export const FAMILIES: readonly Family[] = ["cube", "pyramid", "diamond", "ball"];
export type Dim = 2 | 3 | 4;

export interface Shape {
  family: Family;
  dim: Dim;
  /** Polytope corners, or for the ball the points of its drawn rings. */
  verts: Vec4[];
  edges: [number, number][];
  /** True for the ball: sliced analytically, its rings are only drawn. */
  round: boolean;
}

const pad = (v: readonly number[]): Vec4 => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
const norm = (v: readonly number[]) => Math.hypot(...v);
const scaleTo = (v: readonly number[], r: number) => {
  const n = norm(v) || 1;
  return v.map((x) => (x * r) / n);
};

/** Corners ±1/√n on every axis; edges join corners differing on one axis. */
const cube = (n: Dim): Shape => {
  const s = 1 / Math.sqrt(n);
  const verts: Vec4[] = [];
  for (let i = 0; i < 1 << n; i++) {
    verts.push(pad(Array.from({ length: n }, (_, k) => ((i >> k) & 1 ? s : -s))));
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let k = 0; k < n; k++) {
      const j = i ^ (1 << k);
      if (i < j) edges.push([i, j]);
    }
  }
  return { family: "cube", dim: n, verts, edges, round: false };
};

/** Corners ±e_k; every pair is an edge except opposite corners. */
const diamond = (n: Dim): Shape => {
  const verts: Vec4[] = [];
  for (let k = 0; k < n; k++) {
    for (const s of [1, -1]) {
      const v: Vec4 = [0, 0, 0, 0];
      v[k] = s;
      verts.push(v);
    }
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (Math.floor(i / 2) !== Math.floor(j / 2)) edges.push([i, j]);
    }
  }
  return { family: "diamond", dim: n, verts, edges, round: false };
};

/**
 * n + 1 corners on the unit sphere, each pair at the same distance: the basis vectors of
 * n + 1 dimensions, centred and written in an orthonormal basis of their hyperplane.
 */
const pyramid = (n: Dim): Shape => {
  const m = n + 1;
  // An orthonormal basis of {x : Σx = 0} in m dimensions, by Gram-Schmidt on e_k - e_{k+1}.
  const basis: number[][] = [];
  for (let k = 0; k < n; k++) {
    let v: number[] = Array.from({ length: m }, (_, i) => (i === k ? 1 : i === k + 1 ? -1 : 0));
    for (const b of basis) {
      const d = v.reduce((s, x, i) => s + x * b[i]!, 0);
      v = v.map((x, i) => x - d * b[i]!);
    }
    basis.push(scaleTo(v, 1));
  }
  const verts: Vec4[] = [];
  for (let i = 0; i < m; i++) {
    const e = Array.from({ length: m }, (_, k) => (k === i ? 1 : 0) - 1 / m);
    verts.push(
      pad(
        scaleTo(
          basis.map((b) => b.reduce((s, x, k) => s + x * e[k]!, 0)),
          1,
        ),
      ),
    );
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) edges.push([i, j]);
  return { family: "pyramid", dim: n, verts, edges, round: false };
};

const RING_STEPS = 48;

/** Great circles through pairs of coordinate axes, plus a few tilted ones in four dimensions. */
const ball = (n: Dim): Shape => {
  const planes: [number[], number[]][] = [];
  const e = (k: number) => Array.from({ length: 4 }, (_, i) => (i === k ? 1 : 0));
  if (n === 2) planes.push([e(0), e(1)]);
  else if (n === 3) planes.push([e(0), e(2)], [e(0), e(1)], [e(2), e(1)]);
  else {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) planes.push([e(i), e(j)]);
    const h = Math.SQRT1_2;
    planes.push(
      [
        [h, 0, 0, h],
        [0, h, h, 0],
      ],
      [
        [h, 0, 0, -h],
        [0, h, -h, 0],
      ],
    );
  }
  const verts: Vec4[] = [];
  const edges: [number, number][] = [];
  const steps = n === 2 ? 72 : RING_STEPS;
  for (const [u, v] of planes) {
    const start = verts.length;
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      verts.push(pad(u.map((x, i) => x * Math.cos(a) + v[i]! * Math.sin(a))));
      edges.push([start + s, start + ((s + 1) % steps)]);
    }
  }
  return { family: "ball", dim: n, verts, edges, round: true };
};

const cache = new Map<string, Shape>();

export const shapeOf = (family: Family, dim: Dim): Shape => {
  const key = `${family}${dim}`;
  let s = cache.get(key);
  if (!s) {
    s =
      family === "cube"
        ? cube(dim)
        : family === "diamond"
          ? diamond(dim)
          : family === "pyramid"
            ? pyramid(dim)
            : ball(dim);
    cache.set(key, s);
  }
  return s;
};

/** Every k-element subset of 0..n-1, in order. */
const subsets = (n: number, k: number): number[][] => {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < n; i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
};

/** Every sign pattern for `k` entries. */
const signs = (k: number): number[][] =>
  Array.from({ length: 1 << k }, (_, i) =>
    Array.from({ length: k }, (_, j) => ((i >> j) & 1 ? -1 : 1)),
  );

/**
 * Unit directions from the centre to the middles of every k-dimensional face: k = 0 corners,
 * 1 edges, 2 faces, 3 cells. Empty for the ball, which has none.
 */
export const featureDirs = (family: Family, dim: Dim, k: number): Vec4[] => {
  if (family === "ball" || k < 0 || k >= dim) return [];
  const out: Vec4[] = [];
  if (family === "cube") {
    // A k-face has k free coordinates; its middle is ±1 on the dim - k fixed ones.
    const fixed = dim - k;
    for (const axes of subsets(dim, fixed)) {
      for (const sg of signs(fixed)) {
        const v = [0, 0, 0, 0];
        axes.forEach((a, i) => (v[a] = sg[i]!));
        out.push(pad(scaleTo(v, 1)));
      }
    }
  } else if (family === "diamond") {
    // A k-face joins k + 1 corners on different axes.
    for (const axes of subsets(dim, k + 1)) {
      for (const sg of signs(k + 1)) {
        const v = [0, 0, 0, 0];
        axes.forEach((a, i) => (v[a] = sg[i]!));
        out.push(pad(scaleTo(v, 1)));
      }
    }
  } else {
    const verts = shapeOf("pyramid", dim).verts;
    for (const set of subsets(verts.length, k + 1)) {
      const v = [0, 0, 0, 0];
      for (const i of set) for (let c = 0; c < 4; c++) v[c] = v[c]! + verts[i]![c]!;
      out.push(pad(scaleTo(v, 1)));
    }
  }
  return out;
};
