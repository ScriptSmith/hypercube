/**
 * A few small air bubbles in a window's liquid, against the inside of the glass. They float up in
 * the room: up a side-facing window until they gather under its upper rim, and away from the
 * glass altogether when the window faces down, so a down-facing window is clear. A shake swirls
 * them. Positions are in window radii, x right and y up as seen from outside.
 */
import type { Rng } from "../../core/types";

export const BUBBLES = 6;
/** Bubbles keep this far inside the window's edge, window radii. */
const RIM = 0.05;
/** Buoyant pull, window radii a second squared, and the liquid's drag time, s. */
const LIFT = 0.55;
const DRAG = 0.7;

export interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** How much it shows, 0 to 1. */
  alpha: number;
}

export interface Bubbles {
  readonly list: readonly Bubble[];
  /**
   * Advance by `dt` s. `up` is the room's up in the window's frame (x, y in the glass's plane,
   * z out through it).
   */
  step(dt: number, up: readonly [number, number, number]): void;
  /** Stir them, as a shake does. */
  swirl(strength: number): void;
}

/** How much of a bubble stays against the glass with the room's up at `up` in the window frame. */
export const clinging = (up: readonly [number, number, number]): number => {
  const along = Math.hypot(up[0], up[1]);
  const t = Math.min(1, Math.max(0, (along - 0.45) / 0.3));
  return t * t * (3 - 2 * t);
};

export const createBubbles = (rng: Rng): Bubbles => {
  const list: Bubble[] = [];
  const place = (b: Bubble, up: readonly [number, number, number]) => {
    const l = Math.hypot(up[0], up[1]) || 1;
    const ux = up[0] / l;
    const uy = up[1] / l;
    const along = rng.range(-0.55, 0.55);
    const height = rng.range(0.35, 0.75);
    b.x = ux * height - uy * along;
    b.y = uy * height + ux * along;
    b.vx = 0;
    b.vy = 0;
  };
  for (let i = 0; i < BUBBLES; i++) {
    const b: Bubble = { x: 0, y: 0, vx: 0, vy: 0, r: 0.014 + 0.032 * rng.next() ** 2, alpha: 0 };
    place(b, [0, 1, 0]);
    list.push(b);
  }
  let hidden = true;

  return {
    list,
    step(dt, up) {
      const target = clinging(up);
      if (hidden && target > 0.05) {
        // Back against the glass after a down-facing spell: they float in from above.
        for (const b of list) place(b, up);
        hidden = false;
      }
      const drag = Math.exp(-dt / DRAG);
      const fade = 1 - Math.exp(-dt / 0.5);
      for (const b of list) {
        b.vx = (b.vx + up[0] * LIFT * dt) * drag;
        b.vy = (b.vy + up[1] * LIFT * dt) * drag;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const max = 1 - RIM - b.r;
        const d = Math.hypot(b.x, b.y);
        if (d > max) {
          const nx = b.x / d;
          const ny = b.y / d;
          b.x = nx * max;
          b.y = ny * max;
          const out = b.vx * nx + b.vy * ny;
          if (out > 0) {
            b.vx -= out * nx;
            b.vy -= out * ny;
          }
        }
        b.alpha += (target - b.alpha) * fade;
      }
      // Bubbles don't overlap: push touching pairs apart, so they line up under the rim.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = (a.r + b.r) * 1.1;
          if (d >= min) continue;
          const push = (min - Math.max(d, 1e-6)) / 2;
          const nx = d > 1e-6 ? dx / d : 1;
          const ny = d > 1e-6 ? dy / d : 0;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
      if (target < 0.02 && list.every((b) => b.alpha < 0.02)) hidden = true;
    },
    swirl(strength) {
      const spin = (rng.next() < 0.5 ? -1 : 1) * strength;
      for (const b of list) {
        b.vx += -b.y * spin + rng.range(-0.3, 0.3) * strength;
        b.vy += b.x * spin + rng.range(-0.3, 0.3) * strength;
      }
    },
  };
};
