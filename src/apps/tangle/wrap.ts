/**
 * Geometry on an arena whose edges wrap: a line that leaves by one edge comes back at the
 * opposite one, so the arena is a torus. Positions are kept in [0, size).
 */

/** `v` brought into [0, size). */
export const wrapInto = (v: number, size: number): number => {
  const r = v % size;
  const w = r < 0 ? r + size : r;
  return w >= size ? 0 : w;
};

/** The shortest signed offset that takes one position to another `d` apart, on a loop of `size`. */
export const wrapDelta = (d: number, size: number): number => d - size * Math.round(d / size);

/** Floats per piece written by splitSegment: x0, y0, x1, y1. */
export const PIECE_FLOATS = 4;
/** Most pieces one segment can be cut into (it crosses a vertical and a horizontal edge). */
export const MAX_PIECES = 3;

/**
 * Cuts a short segment where it crosses the arena's edges and moves each piece back inside, so
 * a segment that runs off one edge is drawn as two pieces (three across a corner) and never as
 * a line across the arena. (x0, y0) is inside the W x H arena and (x1, y1) may be just outside
 * it; the segment must be shorter than the arena. Writes x0, y0, x1, y1 per piece into `out`
 * and returns how many pieces there are.
 */
export const splitSegment = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  W: number,
  H: number,
  out: Float32Array,
): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  // Where along the segment (0 to 1) it crosses a vertical and a horizontal edge.
  let tx = 2;
  let ty = 2;
  if (x1 < 0 || x1 > W) {
    const edge = x1 < 0 ? 0 : W;
    if (dx !== 0) tx = (edge - x0) / dx;
  }
  if (y1 < 0 || y1 > H) {
    const edge = y1 < 0 ? 0 : H;
    if (dy !== 0) ty = (edge - y0) / dy;
  }
  const a = Math.min(tx, ty);
  const b = Math.max(tx, ty);
  let n = 0;
  let from = 0;
  for (let p = 0; p < 3; p++) {
    const t1 = Math.min(1, p === 0 ? a : p === 1 ? b : 1);
    if (t1 <= from + 1e-9) continue;
    // Each piece lies wholly on one side of every edge; its middle says which copy it is.
    const mx = x0 + dx * ((from + t1) / 2);
    const my = y0 + dy * ((from + t1) / 2);
    const sx = Math.floor(mx / W) * W;
    const sy = Math.floor(my / H) * H;
    const k = n * PIECE_FLOATS;
    out[k] = x0 + dx * from - sx;
    out[k + 1] = y0 + dy * from - sy;
    out[k + 2] = x0 + dx * t1 - sx;
    out[k + 3] = y0 + dy * t1 - sy;
    n++;
    from = t1;
    if (t1 >= 1) break;
  }
  return n;
};
