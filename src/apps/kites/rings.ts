/**
 * Rings drifting across the sky with the wind. Like gusts they are a pure function of the seed
 * and the shared clock: slot `k` may hold a ring born on the upwind edge, at a height of its own,
 * which then drifts downwind at a share of the wind's travel speed and bobs a little. A touch
 * frame and the screen above it compute the same rings, so only a catch needs a message.
 */
import { mix, travelSpeed, unit, windDir, type WindField } from "./wind";

export interface Ring {
  /** The ring's slot, unique over the day. */
  id: number;
  /** Fraction across the sky (or bank), and height in sky units. */
  f: number;
  h: number;
}

/** Seconds per ring slot, and the chance a slot holds one. */
export const RING_EVERY = 7;
const RING_CHANCE = 0.8;
/** Rings travel at this share of the wind's travel speed. */
const RING_PACE = 0.42;
const RING_SALT = 0x5f3759df;
/** Rings start and end this far outside the sky. */
const EDGE = 0.06;
const MAX_RINGS = 8;
/** Longest a ring can take to cross, seconds. */
const LIFE = (1 + 2 * EDGE) / (0.12 * 0.35 * RING_PACE);

/** Rings over the sky at shared time `t` (s), into `out`. */
export const ringsAt = (w: WindField, t: number, out: Ring[]): Ring[] => {
  out.length = 0;
  const k1 = Math.floor(t / RING_EVERY);
  const k0 = Math.floor((t - LIFE) / RING_EVERY);
  const seed = (w.seed ^ RING_SALT) >>> 0;
  for (let k = k1; k >= k0 && out.length < MAX_RINGS; k--) {
    const h = mix(seed, k);
    if (unit(h, 0) >= RING_CHANCE) continue;
    const born = (k + unit(h, 1)) * RING_EVERY;
    if (t < born) continue;
    const dir = windDir(w, born);
    if (Math.abs(dir) < 0.3) continue;
    const sign = Math.sign(dir);
    const speed = travelSpeed(w, born) * RING_PACE;
    const f = (sign > 0 ? -EDGE : 1 + EDGE) + sign * speed * (t - born);
    if (f < -EDGE || f > 1 + EDGE) continue;
    const bob = 0.022 * Math.sin(((t - born) / 5) * Math.PI * 2 + unit(h, 3) * 6.28);
    out.push({ id: k >>> 0, f, h: 0.34 + 0.48 * unit(h, 2) + bob });
  }
  return out;
};

/** True when a kite at world (x, y) is inside ring `r` of radius `radius` in a sky `width` wide. */
export const inRing = (r: Ring, x: number, y: number, width: number, radius: number): boolean =>
  Math.hypot(x - r.f * width, y - r.h) < radius * 0.8;

/** Rings already caught, oldest dropped first. */
export interface Caught {
  has(id: number): boolean;
  add(id: number): void;
  clear(): void;
  readonly size: number;
}

export const createCaught = (max = 32): Caught => {
  const ids = new Set<number>();
  return {
    has: (id) => ids.has(id),
    add(id) {
      ids.add(id);
      if (ids.size > max) ids.delete(ids.values().next().value!);
    },
    clear: () => ids.clear(),
    get size() {
      return ids.size;
    },
  };
};
