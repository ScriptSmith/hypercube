/**
 * The pre-made shapes visitors put in the stream. Each outline is a simple polygon on a
 * 100-unit grid centred on the origin with y pointing down (as drawn); a shape's `size` in venue
 * px is the length of those 100 units. The same polygon is the solid in the flow (triangulated
 * and drawn into the mask) and the picture on top of it.
 */

export type ShapeId = "wing" | "disc" | "block" | "plate" | "car" | "bird" | "building";

export const SHAPE_IDS: readonly ShapeId[] = [
  "wing",
  "disc",
  "block",
  "plate",
  "car",
  "bird",
  "building",
];

export type Point = readonly [number, number];

export interface ShapeDef {
  id: ShapeId;
  outline: readonly Point[];
  /**
   * True for shapes that turn with the stream (a wing or plate meets the wind nose first
   * whichever way it blows); false for things that stay upright (a car, a bird, a building).
   */
  aligned: boolean;
  /** Resting angle in degrees, anticlockwise as drawn, relative to the stream when aligned. */
  rest: number;
  /** Details drawn over the silhouette: SVG path data on the same 100-unit grid. */
  details: string;
  /** Length scale for the force arrows, in the 100-unit grid. */
  span: number;
}

/** `n` points round a full circle (y down, so increasing angles run clockwise as drawn). */
const ring = (cx: number, cy: number, r: number, n: number): Point[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });

/** `n` points along an arc from angle `from` to `to`, both ends included. */
const arc = (cx: number, cy: number, r: number, from: number, to: number, n: number): Point[] =>
  Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / (n - 1);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });

/**
 * A cambered aerofoil from the NACA four-digit formulas (Abbott and von Doenhoff, "Theory of
 * Wing Sections"): chord 100 with the nose at x = -50, so it faces a stream blowing to the right.
 */
const aerofoil = (camber: number, at: number, thickness: number, stations = 22): Point[] => {
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = 0; i <= stations; i++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / stations));
    const yt =
      5 *
      thickness *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc =
      x < at
        ? (camber / (at * at)) * (2 * at * x - x * x)
        : (camber / ((1 - at) * (1 - at))) * (1 - 2 * at + 2 * at * x - x * x);
    const dyc =
      x < at ? ((2 * camber) / (at * at)) * (at - x) : ((2 * camber) / (1 - at) ** 2) * (at - x);
    const th = Math.atan(dyc);
    upper.push([(x - yt * Math.sin(th)) * 100 - 50, -(yc + yt * Math.cos(th)) * 100]);
    lower.push([(x + yt * Math.sin(th)) * 100 - 50, -(yc - yt * Math.cos(th)) * 100]);
  }
  // Nose first along the top, then back along the bottom (the trailing edge is shared).
  const out = [...upper, ...lower.slice(1, -1).reverse()];
  const cy = out.reduce((s, p) => s + p[1], 0) / out.length;
  return out.map(([x, y]) => [x, y - cy] as const);
};

const wheelArc = (cx: number): Point[] => arc(cx, 8, 9, -0.25, Math.PI + 0.25, 9);

const car: Point[] = [
  [-50, 6],
  [-50, -2],
  [-46, -6],
  [-20, -9],
  [-8, -19],
  [18, -19],
  [33, -10],
  [48, -8],
  [50, -2],
  [50, 6],
  ...wheelArc(30),
  ...wheelArc(-30),
];

const bird: Point[] = [
  [-50, 2],
  [-44, -6],
  [-36, -13],
  [-26, -17],
  [-17, -15],
  [-10, -9],
  [-5, -7],
  [-5, -11],
  [0, -15],
  [5, -11],
  [5, -7],
  [10, -9],
  [17, -15],
  [26, -17],
  [36, -13],
  [44, -6],
  [50, 2],
  [42, 0],
  [34, -4],
  [26, -6],
  [18, -4],
  [11, 2],
  [6, 8],
  [3, 15],
  [-3, 15],
  [-6, 8],
  [-11, 2],
  [-18, -4],
  [-26, -6],
  [-34, -4],
  [-42, 0],
];

const building: Point[] = [
  [-22, 50],
  [-22, -18],
  [-14, -18],
  [-14, -40],
  [-5, -40],
  [-5, -50],
  [5, -50],
  [5, -40],
  [14, -40],
  [14, -18],
  [22, -18],
  [22, 50],
];

const rect = (w: number, h: number): Point[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/** A bar `len` long and `thick` thick with round ends. */
const capsule = (len: number, thick: number): Point[] => {
  const r = thick / 2;
  const cx = len / 2 - r;
  return [
    ...arc(cx, 0, r, -Math.PI / 2, Math.PI / 2, 7),
    ...arc(-cx, 0, r, Math.PI / 2, Math.PI * 1.5, 7),
  ];
};

const windows = (xs: number[], ys: number[], w: number, h: number) =>
  xs.flatMap((x) => ys.map((y) => `M${x} ${y}h${w}v${h}h${-w}Z`)).join("");

export const SHAPES: Record<ShapeId, ShapeDef> = {
  wing: {
    id: "wing",
    outline: aerofoil(0.05, 0.4, 0.16),
    aligned: true,
    rest: -6,
    details: "",
    span: 100,
  },
  disc: {
    id: "disc",
    outline: ring(0, 0, 36, 40),
    aligned: false,
    rest: 0,
    details: "M-14 -14a20 20 0 0 1 26 -6",
    span: 72,
  },
  block: {
    id: "block",
    outline: rect(62, 62),
    aligned: false,
    rest: 0,
    details: "",
    span: 62,
  },
  plate: {
    id: "plate",
    outline: capsule(100, 10),
    aligned: true,
    rest: 60,
    details: "",
    span: 100,
  },
  car: {
    id: "car",
    outline: car,
    aligned: false,
    rest: 0,
    details:
      "M-17 -8L-7 -16H6V-8ZM10 -16H17L28 -8H10Z" +
      "M-30 8m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0" +
      "M30 8m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0",
    span: 100,
  },
  bird: {
    id: "bird",
    outline: bird,
    aligned: false,
    rest: 0,
    details: "M-2.5 -10.5h1.6v1.6h-1.6ZM0.9 -10.5h1.6v1.6h-1.6ZM-1.6 -7.5L0 -5L1.6 -7.5Z",
    span: 100,
  },
  building: {
    id: "building",
    outline: building,
    aligned: false,
    rest: 0,
    details:
      windows([-17, -8, 1, 10], [-10, 2, 14, 26, 38], 6, 7) +
      windows([-10, -1, 7], [-33, -25], 4, 5),
    span: 100,
  },
};

/** The farthest an outline reaches from its centre, in its own units. */
export const radiusOf = (poly: readonly Point[]): number =>
  Math.max(...poly.map(([x, y]) => Math.hypot(x, y)));

/** How far each shape reaches from its centre at any angle, as a share of its size. */
export const REACHES: Record<ShapeId, number> = Object.fromEntries(
  SHAPE_IDS.map((id) => [id, radiusOf(SHAPES[id].outline) / 100]),
) as Record<ShapeId, number>;

/** The farthest any shape reaches (the building's corners, a little over half its size). */
export const REACH = Math.max(...Object.values(REACHES));

/** Twice the signed area (positive when the points run anticlockwise with y up). */
export const signedArea2 = (poly: readonly Point[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a;
};

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const inTriangle = (p: Point, a: Point, b: Point, c: Point) =>
  cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;

/**
 * Triangles covering a simple polygon, by ear clipping: indices into `poly`, three per
 * triangle. Ears are cut where no other vertex lies inside them.
 */
export const triangulate = (poly: readonly Point[]): number[] => {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea2(poly) < 0) idx.reverse();
  const out: number[] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!;
      const ib = idx[i]!;
      const ic = idx[(i + 1) % idx.length]!;
      const a = poly[ia]!;
      const b = poly[ib]!;
      const c = poly[ic]!;
      if (cross(a, b, c) <= 1e-9) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTriangle(poly[j]!, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
};

const TRIANGLES = new Map<ShapeId, number[]>();

/** Cached triangulation of a shape's outline. */
export const trianglesOf = (id: ShapeId): number[] => {
  let t = TRIANGLES.get(id);
  if (!t) {
    t = triangulate(SHAPES[id].outline);
    TRIANGLES.set(id, t);
  }
  return t;
};

export const isShapeId = (v: unknown): v is ShapeId =>
  typeof v === "string" && (SHAPE_IDS as readonly string[]).includes(v);

/** SVG path data for an outline. */
export const outlinePath = (poly: readonly Point[]): string =>
  poly.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + "Z";

/**
 * An outline point placed in the venue: scaled by `size / 100`, turned by `angle` degrees
 * anticlockwise as drawn (y down), then moved to (x, y).
 */
export const place = (
  p: Point,
  x: number,
  y: number,
  angle: number,
  size: number,
): [number, number] => {
  const k = size / 100;
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Anticlockwise on screen with y down is a clockwise turn in these coordinates.
  return [x + k * (p[0] * c + p[1] * s), y + k * (-p[0] * s + p[1] * c)];
};

/** Is (px, py), in the outline's own units, inside it? (Even-odd rule.) */
export const inside = (poly: readonly Point[], px: number, py: number): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
