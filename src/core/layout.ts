/**
 * Shared geometry for setups where touch frames sit in a row under a screen. Positions are
 * fractions: `u` across one frame (0 left edge, 1 right edge) and the returned value across
 * the whole bank, which maps directly onto the screen above it because the screen spans the
 * bank exactly.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fraction across a bank of `count` frames for fraction `u` inside the frame at `pos`. */
export const bankFraction = (pos: number, u: number, count: number): number => {
  const n = Math.max(1, count);
  return clamp01((Math.min(Math.max(pos, 0), n - 1) + clamp01(u)) / n);
};

/** The frame (`pos`) and fraction inside it (`u`) for a fraction across the bank. */
export const fromBankFraction = (f: number, count: number): { pos: number; u: number } => {
  const n = Math.max(1, count);
  const x = clamp01(f) * n;
  const pos = Math.min(n - 1, Math.floor(x));
  return { pos, u: x - pos };
};

/**
 * Fraction across both screens of a corner setup, where side 0's right edge meets side 1's
 * left edge at the corner (the simulator draws it this way).
 */
export const cornerFraction = (side: number, pos: number, u: number, count: number): number =>
  (Math.min(Math.max(side, 0), 1) + bankFraction(pos, u, count)) / 2;

/** The side and fraction across that side's bank for a fraction across both corner screens. */
export const fromCornerFraction = (f: number): { side: number; f: number } => {
  const x = clamp01(f) * 2;
  const side = x >= 1 ? 1 : 0;
  return { side, f: clamp01(x - side) };
};
