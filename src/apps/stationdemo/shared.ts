/** A puck two players knock back and forth, kept inside the band both of them can reach. */
export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  live: boolean;
}

export interface Paddle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export const PUCK_VENUE_PX = 46;
const MIN_SPEED = 320;
const MAX_SPEED = 1500;

export const newPuck = (): Puck => ({ x: 0, y: 0, vx: 0, vy: 0, live: false });

/** Advances the puck by `dt` s inside `band` across a frame `width` wide. Sizes in stage px. */
export const stepPuck = (
  puck: Puck,
  band: { top: number; bottom: number },
  width: number,
  unit: number,
  paddles: readonly Paddle[],
  dt: number,
  random: () => number,
): void => {
  const r = PUCK_VENUE_PX * unit;
  const top = band.top + r;
  const bottom = Math.max(top, band.bottom - r);
  if (!puck.live) {
    const dir = random() < 0.5 ? -1 : 1;
    Object.assign(puck, {
      x: width / 2,
      y: (top + bottom) / 2,
      vx: dir * 520 * unit,
      vy: (random() - 0.5) * 400 * unit,
      live: true,
    });
  }
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  if (puck.x < r || puck.x > width - r) {
    puck.x = Math.min(width - r, Math.max(r, puck.x));
    puck.vx = -puck.vx;
  }
  if (puck.y < top || puck.y > bottom) {
    puck.y = Math.min(bottom, Math.max(top, puck.y));
    puck.vy = -puck.vy;
  }
  for (const p of paddles) {
    const dx = puck.x - p.x;
    const dy = puck.y - p.y;
    const dist = Math.hypot(dx, dy);
    const reach = r + p.r;
    if (dist >= reach || dist === 0) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    puck.x = p.x + nx * reach;
    puck.y = p.y + ny * reach;
    // Bounce off the paddle as if it were moving, so a swipe sends the puck faster.
    const rel = (puck.vx - p.vx) * nx + (puck.vy - p.vy) * ny;
    if (rel < 0) {
      puck.vx -= 2 * rel * nx;
      puck.vy -= 2 * rel * ny;
    }
  }
  const speed = Math.hypot(puck.vx, puck.vy);
  const lo = MIN_SPEED * unit;
  const hi = MAX_SPEED * unit;
  if (speed > 0 && (speed < lo || speed > hi)) {
    const k = Math.min(hi, Math.max(lo, speed)) / speed;
    puck.vx *= k;
    puck.vy *= k;
  }
};
