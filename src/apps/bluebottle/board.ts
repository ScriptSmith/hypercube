/**
 * The beach as a grid of cells, row-major from the top left: cell `i` is at column `i % cols`,
 * row `Math.floor(i / cols)`. A board is the hidden layout of one patch; a spec is everything
 * needed to generate the same board on every frame.
 */
import { type Density, isDensity, REGION_COLS } from "./config";

export interface Spec {
  /** Base seed of a run of patches. */
  b: number;
  /** Patch number within the run. */
  n: number;
  cols: number;
  rows: number;
  /** Rows, counted up from the bottom, that are in the child band and kept sparse. */
  kid: number;
  dens: Density;
  /** Columns per region (crabs and openings work region by region). */
  rw: number;
  /** Shared-clock ms when the patch begins. */
  start: number;
}

export interface Board {
  cols: number;
  rows: number;
  size: number;
  /** 1 where a bluebottle hides. */
  bottle: Uint8Array;
  /** Bluebottles among each cell's eight neighbours. */
  count: Uint8Array;
  /** Cells dug before anyone touches the patch. */
  openings: readonly number[];
  bottles: number;
  /** Cells without a bluebottle: the patch is clear when all of them are dug. */
  safe: number;
}

export interface Neighbours {
  /** Eight slots per cell, -1 where the neighbour is off the grid. */
  list: Int32Array;
  /** How many of the eight are on the grid. */
  n: Uint8Array;
}

const cache = new Map<string, Neighbours>();

/** The neighbour table for a grid size, shared and kept for a few sizes. */
export const neighbours = (cols: number, rows: number): Neighbours => {
  const key = `${cols}x${rows}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = cols * rows;
  const list = new Int32Array(size * 8).fill(-1);
  const n = new Uint8Array(size);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let k = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          list[i * 8 + k] = rr * cols + cc;
          k++;
        }
      }
      n[i] = k;
    }
  }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  const out = { list, n };
  cache.set(key, out);
  return out;
};

export const countsFor = (cols: number, rows: number, bottle: Uint8Array): Uint8Array => {
  const nb = neighbours(cols, rows);
  const size = cols * rows;
  const count = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    let s = 0;
    const base = i * 8;
    for (let k = 0; k < nb.n[i]!; k++) s += bottle[nb.list[base + k]!]!;
    count[i] = s;
  }
  return count;
};

export const makeBoard = (
  cols: number,
  rows: number,
  bottle: Uint8Array,
  openings: readonly number[],
): Board => {
  let bottles = 0;
  for (let i = 0; i < bottle.length; i++) bottles += bottle[i]!;
  return {
    cols,
    rows,
    size: cols * rows,
    bottle,
    count: countsFor(cols, rows, bottle),
    openings: [...openings],
    bottles,
    safe: cols * rows - bottles,
  };
};

/** Chebyshev distance between two cells. */
export const distance = (cols: number, a: number, b: number): number =>
  Math.max(
    Math.abs((a % cols) - (b % cols)),
    Math.abs(Math.floor(a / cols) - Math.floor(b / cols)),
  );

/** Whether row `r` (0 at the top) is in the child band of a spec. */
export const isKidRow = (spec: Pick<Spec, "rows" | "kid">, r: number): boolean =>
  r >= spec.rows - spec.kid;

/** The region a cell belongs to. */
export const regionOf = (cols: number, rw: number, i: number): number =>
  Math.floor((i % cols) / Math.max(1, rw));

export const regionCount = (cols: number, rw: number): number =>
  Math.max(1, Math.ceil(cols / Math.max(1, rw)));

/** Stable text for a spec, used to key caches and compare patches. */
export const specKey = (s: Spec): string =>
  `${s.b}:${s.n}:${s.cols}x${s.rows}:${s.kid}:${s.dens}:${s.rw}`;

/** The same patch (start time aside, which is advisory). */
export const samePatch = (a: Spec | null, b: Spec | null): boolean =>
  a !== null && b !== null && specKey(a) === specKey(b);

/** Patch order: a later patch of a run, or a run with a larger base seed, wins. */
export const comparePatch = (a: Spec, b: Spec): number => a.n - b.n || a.b - b.b;

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export const MAX_COLS = 160;
export const MAX_ROWS = 24;

export const decodeSpec = (v: unknown): Spec | null => {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  const { b, n, cols, rows, kid, dens, rw, start } = d;
  if (!int(b, 0, 2 ** 32 - 1) || !int(n, 0, 2 ** 31) || !int(cols, 1, MAX_COLS)) return null;
  if (!int(rows, 1, MAX_ROWS) || !int(kid, 0, rows) || !isDensity(dens)) return null;
  if (!int(rw, 1, MAX_COLS) || typeof start !== "number" || !Number.isFinite(start)) return null;
  return { b, n, cols, rows, kid, dens, rw, start };
};

export const encodeSpec = (s: Spec): Spec => ({
  b: s.b,
  n: s.n,
  cols: s.cols,
  rows: s.rows,
  kid: s.kid,
  dens: s.dens,
  rw: s.rw,
  start: Math.round(s.start),
});

/** A spec for a fresh run of patches. */
export const freshSpec = (opts: {
  b: number;
  cols: number;
  rows: number;
  kid: number;
  dens: Density;
  start: number;
  rw?: number;
}): Spec => ({
  b: opts.b >>> 0,
  n: 1,
  cols: opts.cols,
  rows: opts.rows,
  kid: Math.min(opts.rows, Math.max(0, opts.kid)),
  dens: opts.dens,
  rw: opts.rw ?? REGION_COLS,
  start: opts.start,
});

/** The patch after `s`, which begins at `start`. */
export const nextSpec = (s: Spec, start: number): Spec => ({ ...s, n: s.n + 1, start });
