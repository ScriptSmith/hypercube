/** Polylines that items follow at a steady speed: tubes, chutes and the bucket lift. */

export interface Point {
  x: number;
  y: number;
}

export interface Path {
  pts: readonly Point[];
  /** Distance along the path at each point. */
  cum: readonly number[];
  length: number;
}

export const makePath = (pts: readonly Point[]): Path => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { pts, cum, length: cum[cum.length - 1] ?? 0 };
};

/** The point `s` along a path, and the direction it runs there (radians). */
export const pointAt = (
  path: Path,
  s: number,
  out: { x: number; y: number; angle: number } = { x: 0, y: 0, angle: 0 },
): { x: number; y: number; angle: number } => {
  const { pts, cum } = path;
  const first = pts[0];
  if (!first) {
    out.x = 0;
    out.y = 0;
    out.angle = 0;
    return out;
  }
  if (pts.length === 1 || s <= 0) {
    const b = pts[1] ?? first;
    out.x = first.x;
    out.y = first.y;
    out.angle = Math.atan2(b.y - first.y, b.x - first.x);
    return out;
  }
  let i = 1;
  while (i < pts.length - 1 && cum[i]! < s) i++;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const span = cum[i]! - cum[i - 1]!;
  const f = span > 0 ? Math.min(1, (s - cum[i - 1]!) / span) : 1;
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.angle = Math.atan2(b.y - a.y, b.x - a.x);
  return out;
};

/** A path with rounded corners, for drawing tubes and chutes. */
export const tracePath = (
  g: CanvasRenderingContext2D | Path2D,
  pts: readonly Point[],
  radius: number,
): void => {
  const first = pts[0];
  if (!first) return;
  g.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const n = pts[i + 1]!;
    g.arcTo(p.x, p.y, n.x, n.y, radius);
  }
  const last = pts[pts.length - 1]!;
  g.lineTo(last.x, last.y);
};
