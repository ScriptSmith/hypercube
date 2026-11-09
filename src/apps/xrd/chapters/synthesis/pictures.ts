/**
 * The two pictures for chapter 9's swap, our own drawings as simple shapes: a lorikeet on a
 * branch, side on, and a sea turtle from above. Pure: each is a grid of densities from 0 to 1 with
 * soft edges, made once per size.
 */

export type PictureId = "lorikeet" | "turtle";

type Field = (x: number, y: number) => number;

/** Soft step: 1 well inside (d < 0), 0 well outside; `w` is the edge's width. */
const soft = (d: number, w: number) => {
  const t = Math.max(0, Math.min(1, 0.5 - d / w));
  return t * t * (3 - 2 * t);
};

/** Signed distance (roughly) to an ellipse, in the picture's units. */
const ellipse =
  (cx: number, cy: number, rx: number, ry: number, angle = 0) =>
  (x: number, y: number): number => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * c + dy * s) / rx;
    const v = (-dx * s + dy * c) / ry;
    return (Math.hypot(u, v) - 1) * Math.min(rx, ry);
  };

/** Signed distance to a convex or simple polygon, negative inside. */
const polygon =
  (pts: readonly (readonly [number, number])[]) =>
  (x: number, y: number): number => {
    let inside = false;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      const ex = xj - xi;
      const ey = yj - yi;
      const t = Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, Math.hypot(x - xi - t * ex, y - yi - t * ey));
    }
    return inside ? -best : best;
  };

/** A thick straight stroke between two points. */
const bar =
  (x0: number, y0: number, x1: number, y1: number, r: number) =>
  (x: number, y: number): number => {
    const ex = x1 - x0;
    const ey = y1 - y0;
    const t = Math.max(0, Math.min(1, ((x - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - x0 - t * ex, y - y0 - t * ey) - r;
  };

type Layer = { d: (x: number, y: number) => number; v: number };

/** Paint layers in order: each sets the density inside it to its value. */
const paint =
  (layers: readonly Layer[], w: number): Field =>
  (x, y) => {
    let out = 0;
    for (const l of layers) {
      const k = soft(l.d(x, y), w);
      if (k > 0) out = out * (1 - k) + l.v * k;
    }
    return out;
  };

const lorikeet = (w: number): Field =>
  paint(
    [
      { d: bar(0.12, 0.72, 0.9, 0.67, 0.022), v: 0.55 },
      {
        d: polygon([
          [0.34, 0.56],
          [0.4, 0.61],
          [0.15, 0.88],
          [0.09, 0.84],
        ]),
        v: 0.9,
      },
      { d: ellipse(0.48, 0.5, 0.2, 0.125, -0.5), v: 1 },
      { d: ellipse(0.45, 0.49, 0.15, 0.065, -0.58), v: 0.6 },
      { d: ellipse(0.64, 0.33, 0.095, 0.09), v: 1 },
      {
        d: polygon([
          [0.715, 0.295],
          [0.805, 0.35],
          [0.712, 0.395],
        ]),
        v: 0.75,
      },
      { d: ellipse(0.49, 0.665, 0.022, 0.03), v: 0.9 },
      { d: ellipse(0.555, 0.655, 0.022, 0.03), v: 0.9 },
      { d: ellipse(0.665, 0.31, 0.019, 0.019), v: 0 },
    ],
    w,
  );

const turtle = (w: number): Field => {
  const shell = ellipse(0.47, 0.5, 0.25, 0.19);
  const inner = ellipse(0.47, 0.5, 0.14, 0.1);
  return paint(
    [
      { d: ellipse(0.61, 0.25, 0.12, 0.045, -0.65), v: 0.85 },
      { d: ellipse(0.61, 0.75, 0.12, 0.045, 0.65), v: 0.85 },
      { d: ellipse(0.29, 0.31, 0.075, 0.038, 0.65), v: 0.85 },
      { d: ellipse(0.29, 0.69, 0.075, 0.038, -0.65), v: 0.85 },
      {
        d: polygon([
          [0.24, 0.47],
          [0.24, 0.53],
          [0.15, 0.5],
        ]),
        v: 0.85,
      },
      { d: ellipse(0.775, 0.5, 0.075, 0.058), v: 0.9 },
      { d: shell, v: 1 },
      // The shell's plates: a ring and spokes a little thinner.
      { d: (x, y) => Math.abs(inner(x, y)) - 0.008, v: 0.5 },
      { d: bar(0.47, 0.4, 0.47, 0.31, 0.008), v: 0.5 },
      { d: bar(0.47, 0.6, 0.47, 0.69, 0.008), v: 0.5 },
      { d: bar(0.33, 0.5, 0.22, 0.5, 0.008), v: 0.5 },
      { d: bar(0.61, 0.5, 0.72, 0.5, 0.008), v: 0.5 },
      { d: ellipse(0.8, 0.475, 0.012, 0.012), v: 0 },
      { d: ellipse(0.8, 0.525, 0.012, 0.012), v: 0 },
    ],
    w,
  );
};

const cache = new Map<string, Float32Array>();
const MAX_CACHED = 6;

/** The picture as n × n densities, row by row, top row first. */
export const picture = (id: PictureId, n: number): Float32Array => {
  const key = `${id}:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = 1.6 / n;
  const f = id === "lorikeet" ? lorikeet(w) : turtle(w);
  const out = new Float32Array(n * n);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) out[row * n + col] = f((col + 0.5) / n, (row + 0.5) / n);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
};
