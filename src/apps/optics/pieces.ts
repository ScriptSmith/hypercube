/**
 * The optical pieces and their geometry. A piece is built at the origin facing angle 0 and then
 * turned and moved; `r` is the piece's radius in venue px, which sets every dimension.
 *
 * At angle 0: a mirror, filter or splitter lies flat with its face (a mirror's silver side) up;
 * a prism points up; a lens stands upright, so light crossing it left to right is on its axis.
 */
import type { ColourBand } from "./spectrum";
import { BAND_BITS } from "./spectrum";
import {
  arc,
  MAT_ABSORB,
  MAT_FILTER,
  MAT_GLASS,
  MAT_MIRROR,
  MAT_SPLIT,
  type Surface,
  segment,
} from "./trace";

export type PieceKind = "mirror" | "filter" | "splitter" | "prism" | "convex" | "concave";
/** Fixed parts of some puzzles. */
export type FixedKind = "block" | "sky";

export const PIECE_KINDS: readonly PieceKind[] = [
  "mirror",
  "filter",
  "splitter",
  "prism",
  "convex",
  "concave",
];

/** Children's pieces sit in the low tray, the rest in the high one. */
export const CHILD_KINDS: ReadonlySet<PieceKind> = new Set(["mirror", "filter"]);
export const isChildKind = (k: PieceKind): boolean => CHILD_KINDS.has(k);

/** A bank's fixed sky splitter is this much smaller than a piece, to fit between sockets. */
export const SKY_SCALE = 0.62;

/** Detents per turn: 15 degree steps. */
export const DETENTS = 24;
export const STEP = (Math.PI * 2) / DETENTS;

export const normDetent = (d: number): number => ((d % DETENTS) + DETENTS) % DETENTS;

/** Detents after which a piece looks and acts the same again. */
export const symmetryOf = (kind: PieceKind | FixedKind): number => {
  switch (kind) {
    case "mirror":
      return DETENTS;
    case "prism":
      return DETENTS / 3;
    default:
      return DETENTS / 2;
  }
};

/** Two detents give the same optics. */
export const sameTurn = (kind: PieceKind | FixedKind, a: number, b: number): boolean =>
  normDetent(a - b) % symmetryOf(kind) === 0;

export interface Shape {
  /** Half-length of a flat piece (mirror, filter, splitter). */
  half: number;
  /** Prism circumradius. */
  prism: number;
  /** Lens half-height and the depth of each face. */
  lensHalf: number;
  lensSag: number;
  /** Concave lens: half the thickness at its middle. */
  waist: number;
  block: number;
}

export const shapeOf = (r: number): Shape => ({
  half: r * 0.86,
  prism: r * 0.95,
  lensHalf: r * 0.9,
  lensSag: r * 0.27,
  waist: r * 0.09,
  block: r * 0.5,
});

type Pt = [number, number];

const rot = (p: Pt, c: number, s: number, x: number, y: number): Pt => [
  x + p[0] * c - p[1] * s,
  y + p[0] * s + p[1] * c,
];

/** A closed polygon in screen-clockwise order (outward normals), as surfaces. */
const polygon = (pts: readonly Pt[], mat: number, extra: Partial<Surface>): Surface[] =>
  pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    return segment(a[0], a[1], b[0], b[1], mat, extra);
  });

export const prismCorners = (r: number): Pt[] => {
  const R = shapeOf(r).prism;
  // Up, lower right, lower left: clockwise on screen.
  return [-90, 30, 150].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a) * R, Math.sin(a) * R] as Pt;
  });
};

/** Radius of a lens face and the half-angle it spans, from its half-height and depth. */
export const lensFace = (half: number, sag: number): { radius: number; angle: number } => {
  const radius = (half * half + sag * sag) / (2 * sag);
  return { radius, angle: Math.asin(Math.min(1, half / radius)) };
};

export interface PieceGeom {
  kind: PieceKind | FixedKind;
  x: number;
  y: number;
  /** Detent index. */
  turn: number;
  r: number;
  band?: ColourBand;
}

/** The surfaces of a piece placed at (x, y) and turned `turn` detents, owned by `body`. */
export const surfacesOf = (p: PieceGeom, body: number): Surface[] => {
  const a = normDetent(p.turn) * STEP;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sh = shapeOf(p.r);
  const tf = (pt: Pt) => rot(pt, c, s, p.x, p.y);
  const flat = (mat: number, extra: Partial<Surface> = {}) => {
    // Left to right at angle 0, so the normal (the reflective face) points up.
    const [ax, ay] = tf([-sh.half, 0]);
    const [bx, by] = tf([sh.half, 0]);
    return [segment(ax, ay, bx, by, mat, { body, ...extra })];
  };
  switch (p.kind) {
    case "mirror":
      return flat(MAT_MIRROR);
    case "filter":
      return flat(MAT_FILTER, { bits: BAND_BITS[p.band ?? "r"] });
    case "splitter":
      return flat(MAT_SPLIT);
    case "sky": {
      const h = sh.half * SKY_SCALE;
      const [ax, ay] = tf([-h, 0]);
      const [bx, by] = tf([h, 0]);
      return [segment(ax, ay, bx, by, MAT_SPLIT, { body })];
    }
    case "prism":
      return polygon(prismCorners(p.r).map(tf), MAT_GLASS, { glass: "flint", body });
    case "block": {
      const h = sh.block;
      const pts: Pt[] = [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ];
      return polygon(pts.map(tf), MAT_ABSORB, { body });
    }
    case "convex": {
      const { radius, angle } = lensFace(sh.lensHalf, sh.lensSag);
      const off = radius - sh.lensSag;
      // Left face: its circle's centre lies to the right; the outside is away from that centre.
      const [lx, ly] = tf([off, 0]);
      const [rx, ry] = tf([-off, 0]);
      return [
        arc(lx, ly, radius, Math.PI - angle + a, 2 * angle, 1, MAT_GLASS, { body }),
        arc(rx, ry, radius, -angle + a, 2 * angle, 1, MAT_GLASS, { body }),
      ];
    }
    case "concave": {
      const { radius, angle } = lensFace(sh.lensHalf, sh.lensSag);
      const w = sh.waist;
      const edge = w + sh.lensSag;
      const [lx, ly] = tf([-w - radius, 0]);
      const [rx, ry] = tf([w + radius, 0]);
      const top = [tf([-edge, -sh.lensHalf]), tf([edge, -sh.lensHalf])] as const;
      const bottom = [tf([edge, sh.lensHalf]), tf([-edge, sh.lensHalf])] as const;
      return [
        arc(lx, ly, radius, -angle + a, 2 * angle, -1, MAT_GLASS, { body }),
        arc(rx, ry, radius, Math.PI - angle + a, 2 * angle, -1, MAT_GLASS, { body }),
        segment(top[0][0], top[0][1], top[1][0], top[1][1], MAT_GLASS, { body }),
        segment(bottom[0][0], bottom[0][1], bottom[1][0], bottom[1][1], MAT_GLASS, { body }),
      ];
    }
  }
};

/** Absorbing housing of a lamp at (x, y) facing `angle` radians: a box behind its aperture. */
export const lampHousing = (
  x: number,
  y: number,
  angle: number,
  size: number,
  body: number,
): Surface[] => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const len = size * 0.9;
  const half = size * 0.36;
  const pts: Pt[] = [
    [-len, -half],
    [-size * 0.12, -half],
    [-size * 0.12, half],
    [-len, half],
  ];
  return polygon(
    pts.map((p) => rot(p, c, s, x, y)),
    MAT_ABSORB,
    { body },
  );
};
