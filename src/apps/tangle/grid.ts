/**
 * The occupancy grid every collision is tested against. Cells are half a trail wide. Each cell
 * keeps the line that last laid it and the arena tick it was laid at; whether it still counts
 * (an old enough own cell, a faded trail, a snake's discarded tail) is the arena's call.
 *
 * A wrapping grid fits a whole number of cells across the arena, so its cells are a hair off
 * square, and look-ups past one edge land on the cells along the opposite edge.
 */
import { wrapInto } from "./wrap";

export interface Grid {
  readonly cols: number;
  readonly rows: number;
  /** Cell width and height in arena units. */
  readonly cw: number;
  readonly ch: number;
  /** The cell size asked for. */
  readonly cell: number;
  readonly wrap: boolean;
  /** Arena size the grid covers. */
  readonly width: number;
  readonly height: number;
  /** 0 for an empty cell, otherwise the id of the line that laid it plus 1. */
  readonly owner: Uint8Array;
  /** Arena tick the cell was last laid. */
  readonly stamp: Uint32Array;
  clear(): void;
}

export interface GridOptions {
  wrap?: boolean;
  /** Exact cell counts, so the cells fit the arena (they are then width / cols wide). */
  cols?: number;
  rows?: number;
}

export const createGrid = (
  width: number,
  height: number,
  cell: number,
  opts: GridOptions = {},
): Grid => {
  const wrap = opts.wrap === true;
  const fit = (size: number, given: number | undefined) =>
    Math.max(1, given ?? (wrap ? Math.round(size / cell) : Math.ceil(size / cell)));
  const cols = fit(width, opts.cols);
  const rows = fit(height, opts.rows);
  const owner = new Uint8Array(cols * rows);
  const stamp = new Uint32Array(cols * rows);
  return {
    cols,
    rows,
    cw: wrap || opts.cols !== undefined ? width / cols : cell,
    ch: wrap || opts.rows !== undefined ? height / rows : cell,
    cell,
    wrap,
    width,
    height,
    owner,
    stamp,
    clear() {
      owner.fill(0);
    },
  };
};

const loop = (i: number, n: number) => (i < 0 ? i + n * Math.ceil(-i / n) : i % n);

/**
 * Calls `visit` with the index of every cell whose centre lies within `r` of (x, y), stopping
 * at the first call that returns true. Returns whether one did. Allocation-free when `visit`
 * is created once.
 */
export const someCell = (
  g: Grid,
  x: number,
  y: number,
  r: number,
  visit: (i: number) => boolean,
): boolean => {
  const { cw, ch, cols, rows, wrap } = g;
  let i0 = Math.floor((x - r) / cw);
  let i1 = Math.floor((x + r) / cw);
  let j0 = Math.floor((y - r) / ch);
  let j1 = Math.floor((y + r) / ch);
  if (!wrap) {
    i0 = Math.max(0, i0);
    i1 = Math.min(cols - 1, i1);
    j0 = Math.max(0, j0);
    j1 = Math.min(rows - 1, j1);
  }
  const r2 = r * r;
  for (let j = j0; j <= j1; j++) {
    const dy = (j + 0.5) * ch - y;
    const row = (wrap ? loop(j, rows) : j) * cols;
    for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * cw - x;
      if (dx * dx + dy * dy > r2) continue;
      if (visit(row + (wrap ? loop(i, cols) : i))) return true;
    }
  }
  return false;
};

/** The cell index holding (x, y): -1 outside a solid grid; any point on a wrapping one. */
export const cellAt = (g: Grid, x: number, y: number): number => {
  if (g.wrap) {
    const i = Math.min(g.cols - 1, Math.floor(wrapInto(x, g.width) / g.cw));
    const j = Math.min(g.rows - 1, Math.floor(wrapInto(y, g.height) / g.ch));
    return j * g.cols + i;
  }
  const i = Math.floor(x / g.cw);
  const j = Math.floor(y / g.ch);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? -1 : j * g.cols + i;
};

/** Centre of cell `index`. Writes into `out`. */
export const cellCentre = (g: Grid, index: number, out: { x: number; y: number }) => {
  out.x = ((index % g.cols) + 0.5) * g.cw;
  out.y = (Math.floor(index / g.cols) + 0.5) * g.ch;
  return out;
};
