/**
 * A tube's inside: straight walls and a rounded bottom whose corners are quarter circles of
 * radius `rad`, open at the top. The glass is drawn from this shape, and the balls are held in
 * it (pile.ts for live balls, lattice.ts for the packed rows), so the outline you see is the one
 * that holds them.
 */

export interface TubeShape {
  x0: number;
  x1: number;
  bottom: number;
  /** Radius of the two bottom corners. */
  rad: number;
}

/** Corner radius for a tube `w` wide. */
export const cornerRadius = (w: number): number => w * 0.42;

export const shapeOf = (t: { x0: number; x1: number; bottom: number }): TubeShape => ({
  x0: t.x0,
  x1: t.x1,
  bottom: t.bottom,
  rad: cornerRadius(t.x1 - t.x0),
});

/**
 * The lowest centre y at which a ball of radius `r` at `x` is inside the tube, or -Infinity if
 * it can't be at that x at all.
 */
export const lowestY = (s: TubeShape, x: number, r: number, eps = 1e-9): number => {
  if (x < s.x0 + r - eps || x > s.x1 - r + eps) return -Infinity;
  const cl = s.x0 + s.rad;
  const cr = s.x1 - s.rad;
  if (x >= cl && x <= cr) return s.bottom - r;
  const lim = Math.max(0, s.rad - r);
  const dx = x < cl ? cl - x : x - cr;
  if (dx > lim + eps) return -Infinity;
  return s.bottom - s.rad + Math.sqrt(Math.max(0, lim * lim - dx * dx));
};

/** True when a ball of radius `r` at (x, y) is inside the outline (the top is open). */
export const insideTube = (s: TubeShape, x: number, y: number, r: number, eps = 1e-6): boolean =>
  y <= lowestY(s, x, r, eps) + eps;
