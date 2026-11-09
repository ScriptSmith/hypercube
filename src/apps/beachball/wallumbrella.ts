/**
 * A beach umbrella planted in the sand, in the plane of the wall with the balls and toys, so
 * they bounce off its canopy and pole. Its outline is a chain of capsules about its foot: the
 * pole, the canopy's ribs from the rim up to the top, and the valance hanging at each edge.
 *
 * It stands fixed, but a knock makes it rock on its foot as if the sand gave a little (a damped
 * spring, a few degrees at most), and a glancing blow or a swipe across the canopy turns it on
 * its pole. The outline rocks with it; the turn is only drawn, since it is round.
 *
 * Its canopy folds: the ribs swing down about the crown until the cloth hangs furled round the
 * pole. Closed, it can be pulled out of the sand and laid down, out of the way of a game of
 * volleyball, and stood up again, where it opens.
 */

/** Where the umbrella stands and how big it is, metres; heights are from the wall's bottom. */
export interface UmbrellaLayout {
  x: number;
  /** The canopy's rim and the top of its crown. */
  rim: number;
  top: number;
  /** Half the canopy's width. */
  radius: number;
}

/** A real beach umbrella's size: canopy 2.4 m across, its rim and crown above the sand. */
export const UMBRELLA_RADIUS = 1.2;
export const UMBRELLA_RIM = 1.58;
export const UMBRELLA_TOP = 2.06;
/** The valance hangs this far below the rim. */
export const VALANCE = 0.075;
/** Half the thickness of the pole and of the canopy as things feel them. */
export const POLE_SKIN = 0.03;
export const CANOPY_SKIN = 0.03;

export type UmbrellaPart = "pole" | "canopy";

/** How each part takes a hit: the canopy is taut and springy, the pole firm. */
export const UMBRELLA_FEEL: Readonly<Record<UmbrellaPart, { bounce: number; grip: number }>> = {
  pole: { bounce: 0.5, grip: 0.3 },
  canopy: { bounce: 0.62, grip: 0.35 },
};

export interface Segment {
  /** Ends about the foot, metres, as it stands upright. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  skin: number;
  part: UmbrellaPart;
}

/** The canopy's height above its rim at a share `u` of its radius out from the pole. */
export const canopyRise = (u: number) => 1 - Math.min(1, Math.abs(u)) ** 1.5;

/** The ribs' angle below the crown when the canopy is furled, radians. */
export const RIB_CLOSED = (84 * Math.PI) / 180;

/**
 * A point on a rib a share `u` of the way from the crown out to the rim, on a canopy folded
 * `fold` (0 open, 1 furled): how far out from the pole it is and how high, both from the foot.
 * Open, it follows the canopy's dome; folding, each rib swings down about the crown.
 */
export const ribPoint = (
  radius: number,
  rim: number,
  top: number,
  u: number,
  fold: number,
): readonly [number, number] => {
  const rise = top - rim;
  const open = Math.atan2(rise, radius);
  const a = open + (RIB_CLOSED - open) * fold;
  const length = Math.hypot(radius, rise);
  const dome = rise * (u - u ** 1.5) * (1 - fold);
  return [u * length * Math.cos(a), top - u * length * Math.sin(a) + dome];
};

/** The umbrella's outline about its foot (on the sand at `floor`), as it stands upright. */
export const umbrellaSegments = (u: UmbrellaLayout, floor: number, fold = 0): Segment[] => {
  const rim = u.rim - floor;
  const top = u.top - floor;
  const at = (s: number) => ribPoint(u.radius, rim, top, s, fold);
  const out: Segment[] = [{ ax: 0, ay: 0, bx: 0, by: top, skin: POLE_SKIN, part: "pole" }];
  const steps = [1, 0.7, 0.38, 0];
  const hang = VALANCE * (1 - 0.6 * fold);
  for (const side of [-1, 1]) {
    for (let i = 0; i + 1 < steps.length; i++) {
      const [ax, ay] = at(steps[i]!);
      const [bx, by] = at(steps[i + 1]!);
      out.push({ ax: side * ax, ay, bx: side * bx, by, skin: CANOPY_SKIN, part: "canopy" });
    }
    const [x, y] = at(1);
    out.push({
      ax: side * x,
      ay: y,
      bx: side * x * 0.995,
      by: y - hang,
      skin: CANOPY_SKIN,
      part: "canopy",
    });
  }
  return out;
};

/** Seconds to fold or unfold the canopy, to stand the umbrella up, and a held finger to fold it. */
export const FOLD_S = 0.8;
export const RISE_S = 0.7;
export const HOLD_S = 0.7;
/** A finger dragging the closed umbrella this far pulls it out of the sand, metres. */
export const PULL = 0.2;
/**
 * Closed and laid down, it is a long body: discs along its pole and its furled canopy about its
 * foot, metres, as it stands upright.
 */
export const BROLLY_DISCS: readonly (readonly [number, number, number])[] = [
  [0, 0.04, 0.03],
  [0, 0.2, 0.03],
  [0, 0.36, 0.03],
  [0, 0.52, 0.03],
  [0, 0.68, 0.035],
  [0, 0.84, 0.06],
  [0, 0.99, 0.08],
  [0, 1.15, 0.09],
  [0, 1.31, 0.09],
  [0, 1.47, 0.085],
  [0, 1.63, 0.075],
  [0, 1.79, 0.06],
  [0, 1.94, 0.045],
  [0, UMBRELLA_TOP + 0.04, 0.04],
];

/** The point of segment a to b nearest (x, y), as a share along it. */
export const nearestOn = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return 0;
  return Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
};

/** Rocking: the spring's frequency, damping ratio and moment of inertia, and the limits. */
export const ROCK_HZ = 1.1;
const ROCK_ZETA = 0.12;
export const ROCK_INERTIA = 30;
export const MAX_TILT = 0.11;
const MAX_RATE = 1.4;
/** Turning on its pole: the fastest it turns, rad/s, and how quickly that dies away, s. */
export const MAX_TURN = 5;
const TURN_TAU = 1.4;

export interface Wobble {
  /** Rocked over this far in the wall's plane, radians, anticlockwise, and how fast. */
  tilt: number;
  rate: number;
  /** Turned on its pole, radians (wrapped), and how fast. */
  yaw: number;
  yawRate: number;
}

export const createWobble = (): Wobble => ({ tilt: 0, rate: 0, yaw: 0, yawRate: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A knock: an angular impulse about the foot, and a push to its turn, rad/s. */
export const knock = (w: Wobble, angular: number, turn = 0) => {
  w.rate = clamp(w.rate + angular / ROCK_INERTIA, -MAX_RATE, MAX_RATE);
  w.yawRate = clamp(w.yawRate + turn, -MAX_TURN, MAX_TURN);
};

export const stepWobble = (w: Wobble, dt: number) => {
  const omega = 2 * Math.PI * ROCK_HZ;
  w.rate += (-omega * omega * w.tilt - 2 * ROCK_ZETA * omega * w.rate) * dt;
  w.tilt += w.rate * dt;
  if (Math.abs(w.tilt) > MAX_TILT) {
    w.tilt = Math.sign(w.tilt) * MAX_TILT;
    if (w.rate * w.tilt > 0) w.rate *= -0.3;
  }
  w.yawRate *= Math.exp(-dt / TURN_TAU);
  if (Math.abs(w.yawRate) < 1e-4) w.yawRate = 0;
  w.yaw += w.yawRate * dt;
  const t = Math.PI * 2;
  w.yaw -= t * Math.floor((w.yaw + Math.PI) / t);
  if (Math.abs(w.tilt) < 1e-6 && Math.abs(w.rate) < 1e-5) {
    w.tilt = 0;
    w.rate = 0;
  }
};

/**
 * Paint for the umbrella, sRGB. Stripes of deep blue, white and teal; no red and no yellow
 * anywhere (the lifesaving rule).
 */
export const UMBRELLA_PAINT = {
  stripes: ["#1f4fae", "#f1efe8", "#159a94", "#f1efe8"],
  pole: "#e9e8e2",
  fittings: "#1d3577",
} as const;
