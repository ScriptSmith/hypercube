/**
 * The plush prizes: their outlines for the physics, in cabinet units (u, y up, about 25 cm of a
 * real machine each), and their colours. Drawing is in plush.ts.
 */

export const DESIGN_IDS = [
  "bear",
  "bunny",
  "octopus",
  "whale",
  "dino",
  "star",
  "heart",
  "cactus",
  "avocado",
  "frog",
] as const;
export type DesignId = (typeof DESIGN_IDS)[number];

export type Pt = readonly [number, number];

export type Part =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "poly"; points: readonly Pt[] };

export interface Colourway {
  main: string;
  light: string;
  dark: string;
  /** Muzzle, belly, flesh or pot. */
  accent: string;
}

export interface Design {
  id: DesignId;
  parts: readonly Part[];
  /** The drawing's extent round the body's origin, u. */
  box: { x0: number; y0: number; x1: number; y1: number };
  colourways: readonly Colourway[];
}

/** A convex polygon round an ellipse, at most 8 points. */
export const ellipse = (cx: number, cy: number, a: number, b: number, n = 8): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + a * Math.cos(t), cy + b * Math.sin(t)] as const;
  });

const box = (cx: number, cy: number, hw: number, hh: number, angle = 0): Pt[] => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [cx + x! * c - y! * s, cy + x! * s + y! * c] as const);
};

const circle = (x: number, y: number, r: number): Part => ({ kind: "circle", x, y, r });
const poly = (points: readonly Pt[]): Part => ({ kind: "poly", points });

/** Five-pointed star: the middle and one triangle per point, all convex. */
const STAR_OUT = 0.33;
const STAR_IN = 0.15;
const starPoint = (k: number, r: number): Pt => {
  const a = Math.PI / 2 + (k * Math.PI) / 5;
  return [r * Math.cos(a), r * Math.sin(a)];
};
const starParts = (): Part[] => {
  const inner = Array.from({ length: 5 }, (_, i) => starPoint(2 * i + 1, STAR_IN));
  const parts: Part[] = [poly(inner)];
  for (let i = 0; i < 5; i++) {
    parts.push(poly([starPoint(2 * i, STAR_OUT), inner[i]!, inner[(i + 4) % 5]!]));
  }
  return parts;
};

const egg = (cx: number, cy: number, top: number, bottom: number, h: number): Pt[] =>
  Array.from({ length: 8 }, (_, i) => {
    const t = (i / 8) * Math.PI * 2;
    const s = Math.sin(t);
    const a = s > 0 ? top + (bottom - top) * (1 - s) * 0.5 : bottom;
    return [cx + a * Math.cos(t), cy + h * s] as const;
  });

export const DESIGNS: Record<DesignId, Design> = {
  bear: {
    id: "bear",
    parts: [
      circle(0, 0.15, 0.19),
      circle(-0.15, 0.29, 0.065),
      circle(0.15, 0.29, 0.065),
      poly(ellipse(0, -0.15, 0.22, 0.19)),
    ],
    box: { x0: -0.27, y0: -0.36, x1: 0.27, y1: 0.37 },
    colourways: [
      { main: "#a86b3c", light: "#d39a62", dark: "#6e4222", accent: "#f0d2a8" },
      { main: "#e9a0bf", light: "#f8cadb", dark: "#b8658a", accent: "#fff0f4" },
      { main: "#e8e1d4", light: "#ffffff", dark: "#b3a893", accent: "#c9a27a" },
    ],
  },
  bunny: {
    id: "bunny",
    parts: [
      circle(0, 0.05, 0.17),
      poly(ellipse(0, -0.19, 0.2, 0.15)),
      poly(box(-0.075, 0.3, 0.045, 0.13, 0.18)),
      poly(box(0.075, 0.3, 0.045, 0.13, -0.18)),
    ],
    box: { x0: -0.23, y0: -0.36, x1: 0.23, y1: 0.46 },
    colourways: [
      { main: "#f4f1fa", light: "#ffffff", dark: "#bdb4d0", accent: "#f7b6cf" },
      { main: "#c3a8ea", light: "#e2d4fb", dark: "#8a6bbf", accent: "#f7d0e6" },
      { main: "#9ad7e8", light: "#d0f0f8", dark: "#5c9fb5", accent: "#fde3ef" },
    ],
  },
  octopus: {
    id: "octopus",
    parts: [
      circle(0, 0.07, 0.24),
      poly([
        [-0.28, -0.04],
        [0.28, -0.04],
        [0.31, -0.25],
        [-0.31, -0.25],
      ]),
    ],
    box: { x0: -0.35, y0: -0.33, x1: 0.35, y1: 0.33 },
    colourways: [
      { main: "#f27fb2", light: "#ffb3d4", dark: "#b54a7e", accent: "#ffe0ee" },
      { main: "#8f7cf0", light: "#bcb0ff", dark: "#5a48b3", accent: "#e5e0ff" },
      { main: "#3fc7b4", light: "#8ae8da", dark: "#228a7c", accent: "#d8fbf5" },
    ],
  },
  whale: {
    id: "whale",
    parts: [
      poly(ellipse(0.02, 0, 0.35, 0.21)),
      poly([
        [-0.3, 0.02],
        [-0.48, 0.15],
        [-0.46, -0.06],
      ]),
    ],
    box: { x0: -0.52, y0: -0.25, x1: 0.4, y1: 0.33 },
    colourways: [
      { main: "#4a86d8", light: "#86b6f2", dark: "#2b5596", accent: "#dcebff" },
      { main: "#55b9c9", light: "#97e0eb", dark: "#2f7f8c", accent: "#e3fbff" },
      { main: "#8a95b8", light: "#bcc4de", dark: "#596282", accent: "#eef1fb" },
    ],
  },
  dino: {
    id: "dino",
    parts: [
      poly(ellipse(-0.02, -0.06, 0.26, 0.2)),
      circle(0.2, 0.17, 0.14),
      poly([
        [-0.22, 0.0],
        [-0.48, -0.15],
        [-0.2, -0.18],
      ]),
    ],
    box: { x0: -0.5, y0: -0.3, x1: 0.36, y1: 0.36 },
    colourways: [
      { main: "#6cc04a", light: "#a6e37f", dark: "#3d7f27", accent: "#e9f7b5" },
      { main: "#f29a3c", light: "#ffc684", dark: "#b0611c", accent: "#ffe8c4" },
      { main: "#9b6fd6", light: "#c8a8f5", dark: "#64409a", accent: "#f0e4ff" },
    ],
  },
  star: {
    id: "star",
    parts: starParts(),
    box: { x0: -0.35, y0: -0.3, x1: 0.35, y1: 0.36 },
    colourways: [
      { main: "#ffd23f", light: "#fff09a", dark: "#c99a12", accent: "#fff6cc" },
      { main: "#ff8fc8", light: "#ffc4e2", dark: "#c45690", accent: "#ffe6f3" },
      { main: "#7fd6ff", light: "#c0ecff", dark: "#3f97c4", accent: "#e8f8ff" },
    ],
  },
  heart: {
    id: "heart",
    parts: [
      circle(-0.12, 0.08, 0.15),
      circle(0.12, 0.08, 0.15),
      poly([
        [-0.26, 0.03],
        [0.26, 0.03],
        [0, -0.29],
      ]),
    ],
    box: { x0: -0.29, y0: -0.31, x1: 0.29, y1: 0.25 },
    colourways: [
      { main: "#ff6b8e", light: "#ffa6bb", dark: "#c43a5c", accent: "#ffe3ea" },
      { main: "#c77dff", light: "#e2b8ff", dark: "#8645bf", accent: "#f6e8ff" },
      { main: "#ff9ec4", light: "#ffd0e2", dark: "#cc6390", accent: "#fff0f6" },
    ],
  },
  cactus: {
    id: "cactus",
    parts: [
      poly(box(0, 0.04, 0.12, 0.26)),
      poly(box(-0.19, 0.0, 0.08, 0.05)),
      poly(box(-0.24, 0.1, 0.055, 0.11)),
      poly(box(0.19, 0.08, 0.08, 0.05)),
      poly(box(0.24, 0.17, 0.055, 0.1)),
      poly([
        [-0.17, -0.22],
        [0.17, -0.22],
        [0.13, -0.4],
        [-0.13, -0.4],
      ]),
    ],
    box: { x0: -0.31, y0: -0.42, x1: 0.31, y1: 0.33 },
    colourways: [
      { main: "#4fb06a", light: "#8ad99d", dark: "#2c7442", accent: "#d9825b" },
      { main: "#7cc36a", light: "#b4e6a3", dark: "#4b8a3c", accent: "#5f9fe0" },
    ],
  },
  avocado: {
    id: "avocado",
    parts: [poly(egg(0, 0, 0.17, 0.25, 0.32))],
    box: { x0: -0.27, y0: -0.34, x1: 0.27, y1: 0.34 },
    colourways: [
      { main: "#4f7d2c", light: "#7aa84a", dark: "#2f4f19", accent: "#dfeb9a" },
      { main: "#3f6b2a", light: "#6a9a45", dark: "#24401a", accent: "#e8f0a6" },
    ],
  },
  frog: {
    id: "frog",
    parts: [poly(ellipse(0, -0.05, 0.3, 0.2)), circle(-0.16, 0.15, 0.09), circle(0.16, 0.15, 0.09)],
    box: { x0: -0.33, y0: -0.27, x1: 0.33, y1: 0.26 },
    colourways: [
      { main: "#6fcf5a", light: "#a8ec8f", dark: "#3f8f2f", accent: "#f2f7c4" },
      { main: "#3fb8a8", light: "#86e2d6", dark: "#23786d", accent: "#e4fbf6" },
    ],
  },
};

/** Area of a part, u². */
export const partArea = (p: Part): number => {
  if (p.kind === "circle") return Math.PI * p.r * p.r;
  let a = 0;
  const n = p.points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p.points[i]!;
    const [x1, y1] = p.points[(i + 1) % n]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
};

/** Width and height of a design's drawing, u. */
export const designSize = (d: Design): { w: number; h: number } => ({
  w: d.box.x1 - d.box.x0,
  h: d.box.y1 - d.box.y0,
});
