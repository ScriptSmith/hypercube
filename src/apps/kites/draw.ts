/**
 * Drawing a set of kites with their lines and tails, the same way on the screen and on frames
 * with their own sky.
 */
import { drawKite, drawLine, drawTail, drawTwist } from "./art";
import type { Tail } from "./tail";
import type { Shape } from "./wire";

export interface KiteView {
  kind: "spool" | "stunt";
  /** Centre, px. */
  x: number;
  y: number;
  spin: number;
  size: number;
  color: string;
  shape: Shape;
  tension: number;
  alpha: number;
  glow: boolean;
  /** Where its line starts (two for a stunt kite: left, right), px. */
  starts: { x: number; y: number }[];
  tail: Tail | null;
  /** A tangle's twist that its line passes through. */
  twist: { x: number; y: number } | null;
}

/** A kite-frame point (y down, kite pointing up) on the canvas. */
export const kitePoint = (v: KiteView, lx: number, ly: number): { x: number; y: number } => {
  const c = Math.cos(v.spin);
  const s = Math.sin(v.spin);
  return { x: v.x + lx * c + ly * s, y: v.y - lx * s + ly * c };
};

/** Where the line or lines meet the kite. */
export const attachPoints = (v: KiteView): { x: number; y: number }[] =>
  v.kind === "stunt"
    ? [kitePoint(v, -0.5 * v.size, 0.2 * v.size), kitePoint(v, 0.5 * v.size, 0.2 * v.size)]
    : [kitePoint(v, 0, 0.05 * v.size)];

const TAIL_AT: Record<Shape, number> = {
  diamond: 0.45,
  delta: 0.15,
  fish: 0.5,
  bird: 0.42,
  dragon: 0.12,
};

/** Where the tail hangs from. */
export const tailPoint = (v: KiteView) => kitePoint(v, 0, TAIL_AT[v.shape] * v.size);

/** Lines, then tails, then kites, so every kite sits on top of every line. */
export const drawKiteViews = (
  g: CanvasRenderingContext2D,
  views: readonly KiteView[],
  lineWidth: number,
  t: number,
): void => {
  for (const v of views) {
    const ends = attachPoints(v);
    g.globalAlpha = v.alpha;
    for (let i = 0; i < v.starts.length; i++) {
      const s = v.starts[i]!;
      const e = ends[Math.min(i, ends.length - 1)]!;
      drawLine(g, s.x, s.y, e.x, e.y, v.tension, lineWidth, v.twist);
    }
  }
  g.globalAlpha = 1;
  for (const v of views) {
    if (v.tail) drawTail(g, v.tail, v.shape, v.color, v.size * 0.06, v.alpha);
  }
  for (const v of views) {
    drawKite(g, v.shape, v.x, v.y, v.size, v.spin, v.color, v.alpha, v.glow);
  }
  for (const v of views) {
    if (v.twist && v.alpha > 0.2)
      drawTwist(g, v.twist.x, v.twist.y, v.size * 0.16, v.color, "#f2f5fa", t);
  }
};
