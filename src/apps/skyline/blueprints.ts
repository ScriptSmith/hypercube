/**
 * Building outlines: our own set of six shapes, each made of 4 to 12 block slots and sized to
 * the lot and the sky above it. Pure.
 *
 * A slot is one block: `x` is its left edge in units from the building's left edge (halves are
 * allowed, for setbacks), `r` its row from the ground. A slot is supported when it is on the
 * ground or every slot under it is filled, and it is a top slot when nothing sits on it; roofs
 * fit only top slots.
 */
import type { Rng } from "../../core/types";

export type Shape = "slab" | "stepped" | "twin" | "spire" | "long" | "round";
export const SHAPES: readonly Shape[] = ["slab", "stepped", "twin", "spire", "long", "round"];

export interface Slot {
  x: number;
  r: number;
  /** Indices of the slots directly under this one (empty on the ground). */
  below: number[];
  top: boolean;
}

export interface Blueprint {
  shape: Shape;
  /** Width and height in blocks. */
  cols: number;
  rows: number;
  slots: Slot[];
}

export const MIN_SLOTS = 4;
export const MAX_SLOTS = 12;

/** Fewest rows each shape needs to read as itself. */
const MIN_ROWS: Record<Shape, number> = {
  slab: 3,
  stepped: 4,
  twin: 3,
  spire: 4,
  long: 2,
  round: 3,
};
/** Narrowest lot each shape fits. */
const MIN_COLS: Record<Shape, number> = {
  slab: 2,
  stepped: 2,
  twin: 3,
  spire: 2,
  long: 3,
  round: 2,
};

const finish = (shape: Shape, raw: { x: number; r: number }[]): Blueprint => {
  const slots: Slot[] = raw
    .slice()
    .sort((a, b) => a.r - b.r || a.x - b.x)
    .map((s) => ({ x: s.x, r: s.r, below: [], top: true }));
  const overlaps = (a: Slot, b: Slot) => Math.min(a.x, b.x) + 1 - Math.max(a.x, b.x) > 0.01;
  slots.forEach((s, i) => {
    slots.forEach((o, j) => {
      if (o.r === s.r - 1 && overlaps(s, o)) s.below.push(j);
      if (o.r === s.r + 1 && overlaps(s, o)) slots[i]!.top = false;
    });
  });
  const cols = Math.max(...slots.map((s) => s.x + 1)) - Math.min(...slots.map((s) => s.x));
  const rows = Math.max(...slots.map((s) => s.r)) + 1;
  return { shape, cols, rows, slots };
};

const grid = (w: number, rows: number, x0 = 0, r0 = 0) => {
  const out: { x: number; r: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < w; c++) out.push({ x: x0 + c, r: r0 + r });
  return out;
};

/**
 * The shape at about `rows` rows on a lot `maxCols` blocks wide, within the slot limits, or null
 * when it doesn't fit.
 */
export const makeBlueprint = (shape: Shape, rows: number, maxCols: number): Blueprint | null => {
  if (maxCols < MIN_COLS[shape] || rows < MIN_ROWS[shape]) return null;
  switch (shape) {
    case "slab": {
      const w = 2;
      return finish(shape, grid(w, Math.min(rows, Math.floor(MAX_SLOTS / w))));
    }
    case "stepped": {
      const widths = maxCols >= 3 ? [3, 3, 2, 2, 1, 1, 1] : [2, 2, 1, 1, 1, 1];
      const base = widths[0]!;
      const raw: { x: number; r: number }[] = [];
      for (let r = 0; r < rows && r < widths.length; r++) {
        const w = widths[r]!;
        if (raw.length + w > MAX_SLOTS) break;
        for (let c = 0; c < w; c++) raw.push({ x: (base - w) / 2 + c, r });
      }
      return finish(shape, raw);
    }
    case "twin": {
      const tall = Math.min(rows, 1 + Math.floor((MAX_SLOTS - 3) / 2));
      const raw = grid(3, 1);
      for (let r = 1; r < tall; r++) raw.push({ x: 0, r }, { x: 2, r });
      return finish(shape, raw);
    }
    case "spire": {
      const w = 2;
      const body = Math.min(rows - 1, Math.floor((MAX_SLOTS - 1) / w));
      const raw = grid(w, body);
      raw.push({ x: 0.5, r: body });
      return finish(shape, raw);
    }
    case "long": {
      const w = Math.min(4, maxCols);
      return finish(shape, grid(w, Math.max(2, Math.min(rows, 3, Math.floor(MAX_SLOTS / w)))));
    }
    case "round": {
      const w = 2;
      return finish(shape, grid(w, Math.min(rows, 6)));
    }
  }
};

/** Shapes that fit a lot `maxCols` wide under `maxRows` rows. */
export const fittingShapes = (maxRows: number, maxCols: number): Shape[] =>
  SHAPES.filter((s) => maxCols >= MIN_COLS[s] && maxRows >= MIN_ROWS[s]);

/**
 * A blueprint for a lot, different in shape from `avoid` when possible. Tall shapes use most of
 * the rows on offer; the long block stays low.
 */
export const pickBlueprint = (
  rng: Rng,
  maxRows: number,
  maxCols: number,
  avoid: readonly Shape[] = [],
): Blueprint => {
  const fits = fittingShapes(maxRows, maxCols);
  const fresh = fits.filter((s) => !avoid.includes(s));
  const pool = fresh.length > 0 ? fresh : fits;
  if (pool.length === 0) return finish("slab", grid(2, 2));
  const shape = rng.pick(pool);
  const lo = MIN_ROWS[shape];
  const hi = Math.max(lo, maxRows);
  const rows =
    shape === "long" ? Math.min(hi, 2 + rng.int(2)) : hi - rng.int(Math.min(2, hi - lo + 1));
  return makeBlueprint(shape, rows, maxCols) ?? finish("slab", grid(2, Math.max(2, lo)));
};

const isFilled = (filled: readonly (number | null)[], i: number) =>
  filled[i] !== null && filled[i] !== undefined;

/** A slot is supported when it is on the ground or everything under it is filled. */
export const supported = (bp: Blueprint, filled: readonly (number | null)[], i: number) =>
  bp.slots[i]?.below.every((j) => isFilled(filled, j)) ?? false;

/** A slot accepts a block when it is free, supported, and (for a roof) a top slot. */
export const accepts = (
  bp: Blueprint,
  filled: readonly (number | null)[],
  i: number,
  kind: number,
): boolean => {
  const s = bp.slots[i];
  if (!s || isFilled(filled, i) || !supported(bp, filled, i)) return false;
  return kind !== 3 || s.top;
};
