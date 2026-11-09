/**
 * The imagined room's light: ceiling lamps that now and then dim and come back up, and daylight
 * at two windows on opposite walls that changes as clouds pass. The pupil answers the light that reaches the eye
 * from round where it looks, so it narrows quickly when the eye turns to a
 * window or the lamps come up and widens slowly when it turns back to the dim floor. The cornea's
 * reflections dim and brighten with the same levels, so a change in the pupil has a cause you can
 * see on the eye.
 */
import type { Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";
import { bearing, elevation, norm, tangents } from "./geom";
import { ROOM } from "./physiology";

/** Bearings of the room's two windows, on opposite walls, radians, shared with the reflections. */
export const WINDOWS = [0, Math.PI];

/** The windows' extent seen from the ball's centre, radians, shared with the reflections. */
export const WINDOW_SHAPE = { halfWidth: 0.23, bottom: 0.05, top: 0.53 };

export interface RoomLight {
  /** Ceiling lamps, a share of full. */
  readonly lamps: number;
  /** Daylight at the windows, a share of a bright overcast sky. */
  readonly day: number;
  step(dt: number): void;
  /** Ramp to these levels over `ramp` seconds and hold them for `hold`, then carry on. */
  set(lamps: number, day: number, ramp: number, hold: number): void;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/**
 * A level that holds, then ramps to a new one over a set time. `next` gives the next level, how
 * long the ramp takes and how long to hold it, seconds; the first level holds for `first`.
 */
const ramped = (start: number, first: number, next: () => [number, number, number]) => {
  let from = start;
  let to = start;
  let ramp = 1;
  let t = 1;
  let hold = first;
  let value = start;
  return {
    get value() {
      return value;
    },
    set(level: number, r: number, h: number) {
      from = value;
      to = Math.max(0, Math.min(1, level));
      ramp = Math.max(0.05, r);
      hold = h;
      t = 0;
    },
    step(dt: number) {
      if (t < 1) {
        t = Math.min(1, t + dt / ramp);
        value = from + (to - from) * ease(t);
        return;
      }
      hold -= dt;
      if (hold > 0) return;
      const [level, r, h] = next();
      from = value;
      to = level;
      ramp = Math.max(0.05, r);
      hold = h;
      t = 0;
    },
  };
};

export const createRoomLight = (rng: Rng): RoomLight => {
  let dimmed = false;
  // The room starts fully lit, so the eye opens with its reflections bright.
  const lamps = ramped(1, rng.range(...ROOM.lampsOnFor), () => {
    // Mostly on; now and then dimmed for a while, as for a show, then back up quickly.
    if (dimmed) {
      dimmed = false;
      return [rng.range(0.9, 1), rng.range(...ROOM.lampsUp), rng.range(...ROOM.lampsOnFor)];
    }
    if (rng.next() < ROOM.dimChance) {
      dimmed = true;
      return [rng.range(...ROOM.dimLevel), rng.range(...ROOM.lampsDown), rng.range(...ROOM.dimFor)];
    }
    return [rng.range(0.9, 1), rng.range(2, 6), rng.range(...ROOM.lampsOnFor)];
  });
  const day = ramped(1, rng.range(...ROOM.cloudHold), () => [
    rng.range(...ROOM.dayLevel),
    rng.range(...ROOM.cloudRamp),
    rng.range(...ROOM.cloudHold),
  ]);
  return {
    get lamps() {
      return lamps.value;
    },
    get day() {
      return day.value;
    },
    step(dt) {
      lamps.step(dt);
      day.step(dt);
    },
    set(l, d, ramp, hold) {
      dimmed = l < 0.5;
      lamps.set(l, ramp, hold);
      day.set(d, ramp, hold);
    },
  };
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Luminance in cd/m² the room sends towards the ball from venue direction `r`. */
export const roomLuminance = (r: Vec3, lamps: number, day: number): number => {
  const e = elevation(r);
  const lit = ROOM.interiorLamps * lamps + ROOM.interiorDay * day;
  let l = lit * (ROOM.floor + (ROOM.wall - ROOM.floor) * smooth(-0.06, 0.02, e));
  l += lit * (ROOM.ceiling - ROOM.wall) * smooth(0.62, 0.7, e);
  if (e > WINDOW_SHAPE.bottom && e < WINDOW_SHAPE.top) {
    const b = bearing(r);
    for (const w of WINDOWS) {
      const db = Math.atan2(Math.sin(b - w), Math.cos(b - w));
      if (Math.abs(db) < WINDOW_SHAPE.halfWidth) l += ROOM.window * day;
    }
  }
  return l;
};

/**
 * Sample directions round the line of sight, in the eye's frame (z along the gaze), with weights
 * that fall away from the centre of the field: a Gaussian of ROOM.fieldSigma out to ROOM.field.
 */
const FIELD: { x: number; y: number; z: number; w: number }[] = (() => {
  const out: { x: number; y: number; z: number; w: number }[] = [];
  const rings = 6;
  let total = 0;
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * ROOM.field;
    const n = i === 0 ? 1 : 6 * i;
    // Each ring stands for a band of solid angle about sin(th) wide.
    const area = i === 0 ? 0.25 * (ROOM.field / rings) : Math.sin(th);
    const w = (area * Math.exp(-(th * th) / (2 * ROOM.fieldSigma ** 2))) / n;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * (k + 0.5 * (i % 2))) / n;
      out.push({
        x: Math.sin(th) * Math.cos(a),
        y: Math.sin(th) * Math.sin(a),
        z: Math.cos(th),
        w,
      });
      total += w;
    }
  }
  for (const s of out) s.w /= total;
  return out;
})();

/**
 * The luminance the pupil answers when the eye looks along `gaze`: the room over the field round
 * the line of sight, weighted towards its centre, cd/m².
 */
export const fieldLuminance = (gaze: Vec3, lamps: number, day: number): number => {
  const g = norm(gaze);
  const [ex, ey] = tangents(g);
  let sum = 0;
  for (const s of FIELD) {
    const d: Vec3 = [
      ex[0] * s.x + ey[0] * s.y + g[0] * s.z,
      ex[1] * s.x + ey[1] * s.y + g[1] * s.z,
      ex[2] * s.x + ey[2] * s.y + g[2] * s.z,
    ];
    sum += s.w * roomLuminance(d, lamps, day);
  }
  return sum;
};
