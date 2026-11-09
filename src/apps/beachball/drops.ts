/**
 * A drying drop of water or two on the vinyl. Drops ride with the ball, slide slowly downhill
 * (down in the room, whichever way the ball faces) when they are big enough and the slope is
 * steep enough, are flung sideways by a hard toss, and shrink until they are gone. New ones
 * form on the top of the ball, where nobody sees them appear, and slide into view.
 */
import { DEG, direction, type Mat3, type Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";

export const MAX_DROPS = 3;
/** Fresh radius, radians of the ball. */
export const DROP_SIZE = [0.012, 0.022] as const;
/** Seconds from forming to dry. */
export const DROP_LIFE = [70, 180] as const;
/** Seconds after a drop forms before the next may. */
export const DROP_GAP = [20, 80] as const;
/** Drops kept on the ball, unless more are already there. */
const WANT = 2;
const GROW = 2.5;
/** Fastest slide, radians a second, for the biggest drop on a vertical surface. */
export const SLIDE = 0.012;
/** Below this radius a drop holds on wherever it is. */
const STICK = 0.011;
/** Share of the downhill pull below which a drop stays put. */
const GRIP = 0.3;
/** How strongly a spin's outward pull acts, against gravity's 1. */
const SPIN_PULL = 0.04;

export interface Drop {
  /** Unit direction in the ball's frame. */
  p: Vec3;
  /** Velocity along the surface in the ball's frame, radians a second. */
  v: Vec3;
  size: number;
  life: number;
  age: number;
}

export interface DropsOptions {
  /** Latitudes in the room, radians, where new drops form. */
  form: { bottom: number; top: number };
  /** Latitudes in the room where the first drops are, already partly dry. */
  start: { bottom: number; top: number };
}

export interface Drops {
  readonly list: readonly Drop[];
  /** Radius now, radians. */
  radius(d: Drop): number;
  /** A unit tangent along the drop's slide (or any tangent while it is still), and its stretch. */
  shape(d: Drop): { along: Vec3; stretch: number };
  step(dt: number, rotation: Mat3, omega: Vec3): void;
  setOptions(o: DropsOptions): void;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** The room's vector `v` in the ball's frame (the rotation's transpose). */
const toBall = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];
const smooth = (u: number): number => {
  const a = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return a * a * (3 - 2 * a);
};

export const createDrops = (rng: Rng, initial: DropsOptions, rotation: Mat3): Drops => {
  let opts = initial;
  const list: Drop[] = [];
  let t = 0;
  let nextForm = rng.range(DROP_GAP[0], DROP_GAP[1]);

  const radius = (d: Drop) =>
    d.size * Math.sqrt(Math.max(0, 1 - d.age / d.life)) * smooth(d.age / GROW);

  const make = (band: { bottom: number; top: number }, m: Mat3, age: number) => {
    const lat = rng.range(Math.min(band.bottom, band.top), Math.max(band.bottom, band.top));
    const p = toBall(m, direction(lat, rng.range(-Math.PI, Math.PI)));
    const life = rng.range(DROP_LIFE[0], DROP_LIFE[1]);
    list.push({
      p,
      v: [0, 0, 0],
      size: rng.range(DROP_SIZE[0], DROP_SIZE[1]),
      life,
      age: Math.min(age, life * 0.6),
    });
  };

  for (let i = 0; i < WANT; i++) make(opts.start, rotation, rng.range(GROW, 60));

  return {
    list,
    radius,
    shape(d) {
      const speed = Math.hypot(d.v[0], d.v[1], d.v[2]);
      if (speed > 1e-6) {
        return { along: normalize(d.v), stretch: 1 + Math.min(0.8, (0.8 * speed) / SLIDE) };
      }
      const ref: Vec3 = Math.abs(d.p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const k = dot(ref, d.p);
      return {
        along: normalize([ref[0] - k * d.p[0], ref[1] - k * d.p[1], ref[2] - k * d.p[2]]),
        stretch: 1,
      };
    },
    step(dt, m, omega) {
      t += dt;
      const down = toBall(m, [0, -1, 0]);
      const w = toBall(m, omega);
      const w2 = dot(w, w);
      const ease = 1 - Math.exp(-dt / 0.6);
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i]!;
        d.age += dt;
        if (d.age >= d.life) {
          list.splice(i, 1);
          continue;
        }
        const p = d.p;
        // Gravity along the surface, plus a spin's outward pull, also along the surface.
        const wp = dot(w, p);
        const pull: Vec3 = [
          down[0] + SPIN_PULL * (w2 * p[0] - wp * w[0]),
          down[1] + SPIN_PULL * (w2 * p[1] - wp * w[1]),
          down[2] + SPIN_PULL * (w2 * p[2] - wp * w[2]),
        ];
        const k = dot(pull, p);
        const along: Vec3 = [pull[0] - k * p[0], pull[1] - k * p[1], pull[2] - k * p[2]];
        const strength = Math.hypot(along[0], along[1], along[2]);
        const r = radius(d);
        const big = smooth((r - STICK) / (DROP_SIZE[1] - STICK));
        const speed = (SLIDE * big * Math.max(0, strength - GRIP)) / (1 - GRIP);
        const s = strength > 1e-9 ? speed / strength : 0;
        d.v = [
          d.v[0] + (along[0] * s - d.v[0]) * ease,
          d.v[1] + (along[1] * s - d.v[1]) * ease,
          d.v[2] + (along[2] * s - d.v[2]) * ease,
        ];
        d.p = normalize([p[0] + d.v[0] * dt, p[1] + d.v[1] * dt, p[2] + d.v[2] * dt]);
        const kv = dot(d.v, d.p);
        d.v = [d.v[0] - kv * d.p[0], d.v[1] - kv * d.p[1], d.v[2] - kv * d.p[2]];
      }
      if (t >= nextForm && list.length < Math.min(WANT, MAX_DROPS)) {
        make(opts.form, m, 0);
        nextForm = t + rng.range(DROP_GAP[0], DROP_GAP[1]);
      }
    },
    setOptions(o) {
      opts = o;
    },
  };
};

/** Where drops form and start, for a ball whose people see up to `viewTop`. */
export const dropBands = (view: { top: number; bottom: number }): DropsOptions => {
  const formBottom = Math.min(view.top + 10 * DEG, 72 * DEG);
  const span = view.top - view.bottom;
  return {
    form: { bottom: formBottom, top: Math.min(formBottom + 12 * DEG, 84 * DEG) },
    start: { bottom: view.bottom + 0.2 * span, top: view.top - 0.1 * span },
  };
};
