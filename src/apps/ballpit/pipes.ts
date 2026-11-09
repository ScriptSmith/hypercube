/**
 * Pipe geometry: a polyline whose corners are rounded into circular bends. The same path is
 * drawn (as SVG) and ridden by the balls (transit.ts), so a ball always runs down the middle of
 * the pipe it is drawn in. Venue px, y down.
 */

export interface Pt {
  x: number;
  y: number;
}

export type Seg =
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number; len: number }
  /** A bend around (cx, cy) from angle `a0`, sweeping `da` (positive turns clockwise on screen). */
  | { kind: "arc"; cx: number; cy: number; r: number; a0: number; da: number; len: number };

export interface Path {
  readonly segs: readonly Seg[];
  readonly length: number;
  readonly start: Pt;
  readonly end: Pt;
}

const line = (x0: number, y0: number, x1: number, y1: number): Seg => ({
  kind: "line",
  x0,
  y0,
  x1,
  y1,
  len: Math.hypot(x1 - x0, y1 - y0),
});

/**
 * A path through `pts` with each corner rounded to `radius` (one for all corners, or one per
 * point), or less where the segments either side are too short to fit it. Points closer than a
 * pixel to the last are dropped.
 */
export const filleted = (points: readonly Pt[], radius: number | readonly number[]): Path => {
  const pts: Pt[] = [];
  const radii: number[] = [];
  for (const [i, p] of points.entries()) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
      pts.push(p);
      radii.push(typeof radius === "number" ? radius : (radius[i] ?? 0));
    }
  }
  if (pts.length < 2) {
    const p = pts[0] ?? { x: 0, y: 0 };
    return { segs: [line(p.x, p.y, p.x, p.y)], length: 0, start: p, end: p };
  }
  const segs: Seg[] = [];
  let cur: Pt = pts[0]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const a = pts[i - 1]!;
    const b = pts[i + 1]!;
    const inLen = Math.hypot(p.x - a.x, p.y - a.y);
    const outLen = Math.hypot(b.x - p.x, b.y - p.y);
    const ux = (p.x - a.x) / inLen;
    const uy = (p.y - a.y) / inLen;
    const vx = (b.x - p.x) / outLen;
    const vy = (b.y - p.y) / outLen;
    const cross = ux * vy - uy * vx;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (Math.abs(cross) < 1e-9 || turn < 1e-6) continue;
    // Each side may give at most half its length to a bend, the end segments a little more.
    const inRoom = i === 1 ? inLen * 0.9 : inLen / 2;
    const outRoom = i === pts.length - 2 ? outLen * 0.9 : outLen / 2;
    const tan = Math.tan(turn / 2);
    const r = Math.max(0, Math.min(radii[i]!, inRoom / tan, outRoom / tan));
    const d = r * tan;
    const t1 = { x: p.x - ux * d, y: p.y - uy * d };
    const t2 = { x: p.x + vx * d, y: p.y + vy * d };
    if (Math.hypot(t1.x - cur.x, t1.y - cur.y) > 1e-6) segs.push(line(cur.x, cur.y, t1.x, t1.y));
    if (r > 1e-6) {
      const side = cross > 0 ? 1 : -1;
      // The centre is on the inside of the turn, square to the incoming direction.
      const cx = t1.x - uy * r * side;
      const cy = t1.y + ux * r * side;
      const a0 = Math.atan2(t1.y - cy, t1.x - cx);
      segs.push({ kind: "arc", cx, cy, r, a0, da: side * turn, len: r * turn });
    }
    cur = t2;
  }
  const last = pts[pts.length - 1]!;
  segs.push(line(cur.x, cur.y, last.x, last.y));
  let length = 0;
  for (const s of segs) length += s.len;
  return { segs, length, start: pts[0]!, end: last };
};

export interface PathPoint {
  x: number;
  y: number;
  /** Unit direction of travel. */
  dx: number;
  dy: number;
}

/** The point `s` along the path (clamped to its ends), written into `out`. */
export const pointAt = (path: Path, s: number, out: PathPoint): PathPoint => {
  let rest = Math.max(0, Math.min(path.length, s));
  for (const [i, seg] of path.segs.entries()) {
    if (rest > seg.len && i < path.segs.length - 1) {
      rest -= seg.len;
      continue;
    }
    const f = seg.len > 0 ? Math.min(1, rest / seg.len) : 0;
    if (seg.kind === "line") {
      out.x = seg.x0 + (seg.x1 - seg.x0) * f;
      out.y = seg.y0 + (seg.y1 - seg.y0) * f;
      out.dx = seg.len > 0 ? (seg.x1 - seg.x0) / seg.len : 0;
      out.dy = seg.len > 0 ? (seg.y1 - seg.y0) / seg.len : -1;
    } else {
      const a = seg.a0 + seg.da * f;
      const sign = seg.da > 0 ? 1 : -1;
      out.x = seg.cx + seg.r * Math.cos(a);
      out.y = seg.cy + seg.r * Math.sin(a);
      out.dx = -Math.sin(a) * sign;
      out.dy = Math.cos(a) * sign;
    }
    return out;
  }
  out.x = path.start.x;
  out.y = path.start.y;
  out.dx = 0;
  out.dy = -1;
  return out;
};

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/**
 * SVG path data for `path`, shifted sideways by `off` (positive to the left of travel), and
 * optionally only from arc length `from` to `to`.
 */
export const svgPath = (path: Path, off = 0, from = 0, to = path.length): string => {
  const parts: string[] = [];
  let s = 0;
  let started = false;
  const p: PathPoint = { x: 0, y: 0, dx: 0, dy: 0 };
  const at = (len: number) => {
    pointAt(path, len, p);
    return { x: p.x + p.dy * off, y: p.y - p.dx * off };
  };
  for (const seg of path.segs) {
    const s0 = s;
    const s1 = s + seg.len;
    s = s1;
    const a = Math.max(from, s0);
    const b = Math.min(to, s1);
    if (b <= a && !(seg.len === 0 && a === b && !started)) continue;
    if (!started) {
      const q = at(a);
      parts.push(`M${f2(q.x)} ${f2(q.y)}`);
      started = true;
    }
    const q = at(b);
    if (seg.kind === "line") parts.push(`L${f2(q.x)} ${f2(q.y)}`);
    else {
      const r = Math.max(0.01, seg.r + (seg.da > 0 ? off : -off));
      const sweep = Math.abs(seg.da) * ((b - a) / Math.max(1e-9, seg.len));
      parts.push(
        `A${f2(r)} ${f2(r)} 0 ${sweep > Math.PI ? 1 : 0} ${seg.da > 0 ? 1 : 0} ${f2(q.x)} ${f2(q.y)}`,
      );
    }
  }
  return parts.join("");
};

/** Arc length of the point on `path` nearest to `pt`, searched every `step` px. */
export const nearestS = (path: Path, pt: Pt, step = 4): number => {
  const p: PathPoint = { x: 0, y: 0, dx: 0, dy: 0 };
  let best = 0;
  let bestD = Infinity;
  for (let s = 0; s <= path.length + step; s += step) {
    pointAt(path, s, p);
    const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = Math.min(s, path.length);
    }
  }
  return best;
};

/** The rectangle a path's pipe covers, for a pipe `outer` px across. */
export const boundsOf = (path: Path, outer: number) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const p: PathPoint = { x: 0, y: 0, dx: 0, dy: 0 };
  const step = Math.max(2, outer / 4);
  for (let s = 0; s <= path.length + step; s += step) {
    pointAt(path, s, p);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const h = outer / 2;
  return { x0: x0 - h, y0: y0 - h, x1: x1 + h, y1: y1 + h };
};

/** The last part of every feed: up beside the tube, over, and down out of the outlet. */
export interface Spout {
  answer: number;
  /** The pipe's x beside the tube, and the tube's centre. */
  x: number;
  cx: number;
  /** The outlet's y, just above the mouth, the bend radius over the top, and the straight drop to the outlet after it. */
  yOut: number;
  bend: number;
  drop: number;
  inner: number;
  wall: number;
}

/** Points from the pipe's foot at `from` up beside the tube, over and into the outlet. */
export const spoutPoints = (s: Spout, from: Pt): { pts: Pt[]; radii: number[] } => {
  const yh = s.yOut - s.bend - s.drop;
  return {
    pts: [from, { x: s.x, y: yh }, { x: s.cx, y: yh }, { x: s.cx, y: s.yOut }],
    radii: [0, s.bend, s.bend, 0],
  };
};
