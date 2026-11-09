import { bankFraction } from "../../core/layout";

/**
 * Geometry of the round dish on the screen above a bank, where drops land, and how conditions
 * are laid out and blended across a world (slices on the dish, regions on a wall).
 * All lengths are venue px of the frame they belong to.
 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The dish on a screen: as large as the screen allows, leaving a strip below for slice marks. */
export const dishFor = (width: number, height: number): Circle => {
  const bottom = height * 0.065;
  const r = Math.max(1, Math.min(width / 2 - height * 0.03, (height - bottom - height * 0.03) / 2));
  return { x: width / 2, y: height * 0.03 + r, r };
};

/** The square around a circle, which is the dish's simulation world. */
export const boxOf = (c: Circle): Box => ({
  x: c.x - c.r,
  y: c.y - c.r,
  width: 2 * c.r,
  height: 2 * c.r,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where a drop lands on the screen: directly above where it left its touch frame (fraction `u`
 * across frame `pos` of `count`), higher for a stronger flick, and kept inside the dish with
 * `inset` to spare so the stamp fits.
 */
export const landing = (
  pos: number,
  u: number,
  count: number,
  strength: number,
  screen: { width: number; height: number },
  dish: Circle,
  inset: number,
): { x: number; y: number } => {
  const r = Math.max(1, dish.r - inset);
  const x = clamp(bankFraction(pos, u, count) * screen.width, dish.x - r * 0.96, dish.x + r * 0.96);
  const half = Math.sqrt(Math.max(0, r * r - (x - dish.x) ** 2));
  const bottom = dish.y + half;
  const top = dish.y - half;
  const s = clamp(strength, 0, 1);
  return { x, y: bottom - (bottom - top) * (0.12 + 0.76 * s) };
};

/** Where a flicked drop lands in a frame's own culture (`area`), for when there is no screen. */
export const localLanding = (
  x: number,
  strength: number,
  area: Box,
  inset: number,
): { x: number; y: number } => {
  const s = clamp(strength, 0, 1);
  const top = area.y + inset;
  const bottom = area.y + area.height - inset;
  return {
    x: clamp(x, area.x + inset, area.x + area.width - inset),
    y: bottom - (bottom - top) * (0.15 + 0.8 * s),
  };
};

/** One slice of a world: a range of fractions across it with its own condition. */
export interface Slice {
  from: number;
  to: number;
  value: number;
}

/**
 * Slices for a bank: each touch frame covers its share of the width, split evenly among its pads
 * (two for a merged pair). `values` is indexed by pad across the whole bank; `pads[pos]` says how
 * many pads the frame at `pos` has (1 when unknown).
 */
export const bankSlices = (
  count: number,
  pads: readonly number[],
  valueOf: (pos: number, pad: number) => number,
): Slice[] => {
  const n = Math.max(1, count);
  const out: Slice[] = [];
  for (let pos = 0; pos < n; pos++) {
    const k = Math.max(1, Math.min(4, pads[pos] ?? 1));
    for (let pad = 0; pad < k; pad++) {
      out.push({
        from: (pos + pad / k) / n,
        to: (pos + (pad + 1) / k) / n,
        value: valueOf(pos, pad),
      });
    }
  }
  return out;
};

/** Equal regions across a world. */
export const evenSlices = (values: readonly number[]): Slice[] =>
  values.map((value, i) => ({ from: i / values.length, to: (i + 1) / values.length, value }));

/**
 * The condition at fraction `f` across a world: the two presets to mix and how far to go from
 * `a` to `b`. Within `blend` (a fraction of the world) of a border between slices with different
 * values, conditions cross over smoothly.
 */
export const conditionAt = (
  f: number,
  slices: readonly Slice[],
  blend: number,
  fallback: number,
): { a: number; b: number; t: number } => {
  if (slices.length === 0) return { a: fallback, b: fallback, t: 0 };
  let i = slices.findIndex((s) => f < s.to);
  if (i < 0) i = slices.length - 1;
  const s = slices[i]!;
  const half = Math.max(1e-6, blend / 2);
  const prev = slices[i - 1];
  const next = slices[i + 1];
  if (prev && f - s.from < half) {
    const t = smooth((f - s.from + half) / (2 * half));
    return { a: prev.value, b: s.value, t };
  }
  if (next && s.to - f < half) {
    const t = smooth((f - (s.to - half)) / (2 * half));
    return { a: s.value, b: next.value, t };
  }
  return { a: s.value, b: s.value, t: 0 };
};

const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
