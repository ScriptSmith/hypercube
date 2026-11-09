/**
 * Kite tails as short Verlet chains, for drawing only. The first point is pinned to the kite; the
 * rest swing under gravity and stream downwind. Units are whatever the caller draws in (px with
 * y down).
 */

export interface Tail {
  readonly n: number;
  readonly seg: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  placed: boolean;
}

export const createTail = (n: number, seg: number): Tail => ({
  n,
  seg,
  x: new Float32Array(n),
  y: new Float32Array(n),
  px: new Float32Array(n),
  py: new Float32Array(n),
  placed: false,
});

/** Hang the tail straight down from (x, y). */
export const placeTail = (t: Tail, x: number, y: number): void => {
  for (let i = 0; i < t.n; i++) {
    t.x[i] = x;
    t.y[i] = y + i * t.seg;
    t.px[i] = t.x[i]!;
    t.py[i] = t.y[i]!;
  }
  t.placed = true;
};

/**
 * Step with the head at (hx, hy). `wind` is the sideways push and `gravity` the downward pull, in
 * px per second squared.
 */
export const stepTail = (
  t: Tail,
  hx: number,
  hy: number,
  wind: number,
  gravity: number,
  dt: number,
): void => {
  if (!t.placed || !Number.isFinite(hx + hy)) {
    placeTail(t, hx, hy);
    return;
  }
  const d = Math.min(dt, 1 / 30);
  const ax = wind * d * d;
  const ay = gravity * d * d;
  const keep = 0.94;
  for (let i = 1; i < t.n; i++) {
    const x = t.x[i]!;
    const y = t.y[i]!;
    // Further down the tail flutters more.
    const flutter = (i / t.n) * 0.6;
    t.x[i] = x + (x - t.px[i]!) * keep + ax * (1 + flutter);
    t.y[i] = y + (y - t.py[i]!) * keep + ay;
    t.px[i] = x;
    t.py[i] = y;
  }
  t.x[0] = hx;
  t.y[0] = hy;
  t.px[0] = hx;
  t.py[0] = hy;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < t.n; i++) {
      const dx = t.x[i]! - t.x[i - 1]!;
      const dy = t.y[i]! - t.y[i - 1]!;
      const len = Math.hypot(dx, dy) || 1e-6;
      const k = (len - t.seg) / len;
      // The head end is fixed; move only the free point.
      t.x[i] = t.x[i]! - dx * k;
      t.y[i] = t.y[i]! - dy * k;
    }
  }
  // A tail flung far away (a frame jumped) is put back rather than snapping across the sky.
  const reach = t.seg * t.n * 3;
  if (Math.abs(t.x[t.n - 1]! - hx) > reach || Math.abs(t.y[t.n - 1]! - hy) > reach) {
    placeTail(t, hx, hy);
  }
};
