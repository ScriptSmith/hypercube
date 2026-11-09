/**
 * A bank's strips: the space below the screen, one touch frame wide, where a thrown body climbs
 * from its slingshot to the bezel. In a strip a body feels a snapshot of the screen's heaviest
 * bodies, frozen where they were when the screen sent it (the screen sends one four times a
 * second, quantised so both ends hold the same numbers), and bounces off the strip's sides. It
 * steps at the clock's own rate whatever the screen's time factor is.
 *
 * The frame climbs its body with the newest snapshot and tells the screen the step it left at and
 * which snapshot it used; the screen climbs the same body with the same snapshot from the same
 * step, so it comes over the bezel at the same step and place. A message so late that the body
 * would already have crossed brings it in from the bottom edge, late, never part way up.
 */
import type { Pick } from "./bodies";
import { DT } from "./physics";

/**
 * A frozen view of the screen's bodies: the clock step it was taken at, x, y, pull and radius,
 * and whether sizes were true (which sets the climbing body's size).
 */
export interface Snapshot {
  k: number;
  b: readonly (readonly [number, number, number, number])[];
  z: number;
}

export type Throw = Pick | "hole";

/** Bodies' radii in a strip (bank px), whatever they are on the screen. */
export const STRIP_R: Record<Throw, number> = {
  rock: 22,
  planet: 30,
  giant: 40,
  star: 48,
  hole: 28,
};
/** With true sizes on, every body in a strip is this small. */
export const TRUE_STRIP_R = 3;
/** A body still in its strip this far below the screen has fallen away. */
const STRIP_FLOOR = 4000;
/** Above the bezel a frame keeps a body this long (steps) before letting it go. */
const ABOVE_STEPS = 60;

export interface Climber {
  id: number;
  kind: Throw;
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  r: number;
  /** Clock step of this state. */
  k: number;
  snap: Snapshot;
  strip: { x0: number; x1: number };
  /** Clock step it crossed the bezel, and how, or -1. */
  crossed: number;
  ex: number;
  ey: number;
  evx: number;
  evy: number;
  owner: string;
  pad: number;
  color: number;
  human: boolean;
  /** Fell away below. */
  lost: boolean;
}

export interface ClimbStart {
  kind: Throw;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
  owner: string;
  pad: number;
  color: number;
  human: boolean;
}

let nextClimber = 1;

export const createClimber = (
  s: ClimbStart,
  snap: Snapshot,
  strip: { x0: number; x1: number },
): Climber => ({
  id: nextClimber++,
  kind: s.kind,
  x: s.x,
  y: s.y,
  vx: s.vx,
  vy: s.vy,
  px: s.x,
  py: s.y,
  r: snap.z ? TRUE_STRIP_R : STRIP_R[s.kind],
  k: s.k,
  snap,
  strip: { x0: strip.x0, x1: strip.x1 },
  crossed: -1,
  ex: 0,
  ey: 0,
  evx: 0,
  evy: 0,
  owner: s.owner,
  pad: s.pad,
  color: s.color,
  human: s.human,
  lost: false,
});

const acc = [0, 0];

const pullOf = (snap: Snapshot, x: number, y: number, out: number[]) => {
  out[0] = 0;
  out[1] = 0;
  for (const [bx, by, gm, r] of snap.b) {
    const dx = bx - x;
    const dy = by - y;
    const r2 = dx * dx + dy * dy + r * r * 0.25;
    const f = gm / (r2 * Math.sqrt(r2));
    out[0]! += dx * f;
    out[1]! += dy * f;
  }
};

/** One clock step of a climber: velocity Verlet in the snapshot's pull, the strip's sides. */
export const stepClimber = (c: Climber): void => {
  const half = DT * 0.5;
  c.px = c.x;
  c.py = c.y;
  pullOf(c.snap, c.x, c.y, acc);
  c.vx += acc[0]! * half;
  c.vy += acc[1]! * half;
  c.x += c.vx * DT;
  c.y += c.vy * DT;
  pullOf(c.snap, c.x, c.y, acc);
  c.vx += acc[0]! * half;
  c.vy += acc[1]! * half;
  c.k++;
  if (c.crossed < 0) {
    const { x0, x1 } = c.strip;
    if (c.x < x0 + c.r) {
      c.x = 2 * (x0 + c.r) - c.x;
      c.vx = Math.abs(c.vx);
    } else if (c.x > x1 - c.r) {
      c.x = 2 * (x1 - c.r) - c.x;
      c.vx = -Math.abs(c.vx);
    }
    if (c.y < 0) {
      c.crossed = c.k;
      c.ex = c.x;
      c.ey = c.y;
      c.evx = c.vx;
      c.evy = c.vy;
    } else if (c.y > STRIP_FLOOR) {
      c.lost = true;
    }
  }
};

/** Whether a frame is done with a climber: well over the bezel or fallen away. */
export const climberDone = (c: Climber): boolean =>
  c.lost || (c.crossed >= 0 && (c.k - c.crossed > ABOVE_STEPS || c.y < -c.r * 4));

export interface Taken {
  climber: Climber;
  /** It had already crossed before the message came: it comes in late, from the bottom edge. */
  late: boolean;
}

/**
 * The screen takes over a body from a frame: climbs it with the named snapshot from the step it
 * left at, up to `nowK`. A sender whose clock runs ahead counts as now.
 */
export const takeOver = (
  s: ClimbStart,
  snap: Snapshot,
  strip: { x0: number; x1: number },
  nowK: number,
): Taken => {
  const c = createClimber({ ...s, k: Math.min(s.k, nowK) }, snap, strip);
  while (c.k < nowK && c.crossed < 0 && !c.lost) stepClimber(c);
  return { climber: c, late: c.crossed >= 0 && c.crossed < nowK };
};

/** Records the strip part of a ribbon: from the slingshot up past the bezel. */
export const predictStrip = (
  s: ClimbStart,
  snap: Snapshot,
  strip: { x0: number; x1: number },
  maxSteps: number,
  every: number,
  out: { pts: Float32Array; n: number },
): void => {
  const c = createClimber(s, snap, strip);
  const cap = out.pts.length >> 1;
  out.n = 0;
  const put = () => {
    if (out.n >= cap) return;
    out.pts[out.n * 2] = c.x;
    out.pts[out.n * 2 + 1] = c.y;
    out.n++;
  };
  put();
  for (let i = 1; i <= maxSteps; i++) {
    stepClimber(c);
    if (i % every === 0) put();
    if (c.lost || (c.crossed >= 0 && c.y < -c.r * 3)) break;
  }
};

/** Equal snapshots, for keeping one strip world while they repeat. */
export const sameSnapshot = (a: Snapshot | null, b: Snapshot | null) => !!a && !!b && a.k === b.k;
