/**
 * Our own 2D kite models, in the plane of the sky with the wind horizontal. Lengths are in sky
 * units (1 is the height of the sky the kites fly in) and time in seconds, so the same numbers
 * fly a kite across a whole bank's screen or a lone panel's small sky. Every kite is tied to an
 * anchor on the sky's bottom edge, above its control.
 *
 * Spool kite: a point mass on a taut line, tracked as the line's angle `theta` from the right
 * horizon (pi/2 overhead) and its length. The sail is a flat plate held by the bridle at `BETA`
 * from square to the line, so the wind pushes it up the wind window until the plate meets the
 * wind edge on; a tail adds drag and gravity pulls it down. Reeling in hauls the line, which adds
 * airspeed along it: the kite climbs steadily, and the line goes out as it does. Let go, it
 * drifts down slowly as the line winds back to its resting length, then hovers low. The ground,
 * the sky's sides and its own column (the strip of sky above its spool) hold it in; it never
 * crashes.
 *
 * Stunt kite: flies along its heading inside its wind window (an ellipse above the anchor, set a
 * little downwind), fast in the middle and slow at the edges, where it slides. The lower handle
 * turns it that way and both handles pulled make it faster. Let go, it climbs to the top of the
 * window and parks. A dive into the ground lands it with a bump; it relaunches after 2 s.
 */

export interface SkyBounds {
  /** Left and right limits of the kites' centres, sky units. */
  xmin: number;
  xmax: number;
  /** Lowest a kite flies (just above the tree tops). */
  floor: number;
  /** Highest point of the sky. */
  top: number;
}

/** Wind speed in sky units a second at (x, y). */
export type WindFn = (x: number, y: number) => number;

/** Wind speed, sky units a second, that a breezy day's mean (one wind unit) blows at. */
export const WIND_SPEED = 0.6;

export const SPOOL = {
  /** Resting and longest line, sky units. */
  rest: 0.24,
  max: 0.93,
  /** Bridle angle from square to the line. */
  beta: 0.45,
  /** Sail force per unit airspeed squared, and the tail's drag. */
  sail: 18,
  tail: 2.2,
  gravity: 0.3,
  /** Damping of the swing, per second. */
  damp: 1.6,
  /** Line speed outwards while reeled in, and back in while let go, sky units a second. */
  out: 0.34,
  back: 0.085,
  /** Haul speed, sky units a second, while the spool is held (a full pull). */
  hold: 0.45,
  fullPull: 0.45,
  /** Force that holds a kite at its column's side, against the wind. */
  keep: 4,
} as const;

export const STUNT = {
  /** Speed in sky units a second in a breezy wind, in the middle of the window. */
  speed: 0.5,
  /** Turn rate, rad/s, with one handle all the way down and the other up. */
  turn: 3.4,
  /** Speed at the window's edge, as a fraction of the middle's. */
  edge: 0.32,
  /** Extra speed with both handles all the way down. */
  boost: 0.9,
  /** Seconds on the ground after a crash. */
  down: 2,
} as const;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number) => {
  const f = clamp((x - e0) / (e1 - e0), 0, 1);
  return f * f * (3 - 2 * f);
};
export const angleDiff = (to: number, from: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Shared by both kinds: what the renderer and the network need. */
export interface KiteBase {
  /** Anchor x on the sky's bottom edge, sky units. */
  ax: number;
  x: number;
  y: number;
  /** Position before the last step, for interpolated drawing. */
  px: number;
  py: number;
  /** Drawn angle of the kite's spine, radians, 0 pointing up (positive leans left). */
  spin: number;
  /** Line tension, 0 (slack) to about 1 (taut). */
  tension: number;
  /** -1 to 1: which way the wind has been blowing at the kite lately. */
  side: number;
  /** 0 to 1: how strongly a tangle shakes it (eases towards `tangled`). */
  tangle: number;
  tangled: boolean;
  /** Seconds flown, for wobbles. */
  age: number;
}

export interface SpoolKite extends KiteBase {
  kind: "spool";
  /** The kite's centre stays between these x, sky units: the column above its spool. */
  colMin: number;
  colMax: number;
  theta: number;
  omega: number;
  length: number;
  lengthRate: number;
  /** 0 to 1: how hard the spool has been pulled lately. */
  pull: number;
  /** In the top band of the sky, trailing sparkles. */
  sparkle: boolean;
}

export type StuntPhase = "fly" | "down";

export interface StuntKite extends KiteBase {
  kind: "stunt";
  heading: number;
  speed: number;
  phase: StuntPhase;
  phaseT: number;
  /** 0 to 1: settled at the top of the window with the handles let go. */
  parked: number;
}

export type Kite = SpoolKite | StuntKite;

export interface StuntWindow {
  /** Half width and height of the window, sky units. */
  a: number;
  b: number;
  /** How far downwind the window's centre sits from the anchor. */
  shift: number;
}

const base = (ax: number): KiteBase => ({
  ax,
  x: ax,
  y: 0,
  px: ax,
  py: 0,
  spin: 0,
  tension: 0.5,
  side: 1,
  tangle: 0,
  tangled: false,
  age: 0,
});

/** The column of sky a spool kite's centre keeps to, sky units. */
export type Column = readonly [number, number];

const OPEN: Column = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];

/** A spool kite hovering at rest downwind of its anchor, inside `col`. */
export const createSpool = (ax: number, side = 1, col: Column = OPEN): SpoolKite => {
  const k: SpoolKite = {
    ...base(ax),
    kind: "spool",
    colMin: Math.min(col[0], ax),
    colMax: Math.max(col[1], ax),
    theta: side >= 0 ? 0.95 : Math.PI - 0.95,
    omega: 0,
    length: SPOOL.rest,
    lengthRate: 0,
    pull: 0,
    sparkle: false,
  };
  k.side = side >= 0 ? 1 : -1;
  keepInColumn(k);
  k.px = k.x;
  k.py = k.y;
  return k;
};

/** The line angles that keep a kite on a line of `len` between `xmin` and `xmax`. */
const columnRange = (ax: number, len: number, xmin: number, xmax: number): [number, number] => [
  Math.acos(clamp((xmax - ax) / len, -1, 1)),
  Math.acos(clamp((xmin - ax) / len, -1, 1)),
];

/** Swing the line into the kite's column if it is outside (a new column, or a reset). */
export const keepInColumn = (k: SpoolKite): void => {
  const [lo, hi] = columnRange(k.ax, k.length, k.colMin, k.colMax);
  if (k.theta < lo || k.theta > hi) {
    k.theta = clamp(k.theta, lo, hi);
    k.omega = 0;
  }
  placeSpool(k);
};

export const placeSpool = (k: SpoolKite): void => {
  k.x = k.ax + k.length * Math.cos(k.theta);
  k.y = k.length * Math.sin(k.theta);
};

/** Back to the resting line, low and downwind. Keeps the anchor and the column. */
export const resetSpool = (k: SpoolKite, side = k.side): void => {
  const fresh = createSpool(k.ax, side, [k.colMin, k.colMax]);
  Object.assign(k, fresh);
};

/**
 * The angle range the line may take at length `len` in `sky`, keeping the kite inside the sky
 * and between `xmin` and `xmax`.
 */
export const thetaRange = (
  ax: number,
  len: number,
  sky: SkyBounds,
  xmin = sky.xmin,
  xmax = sky.xmax,
): [number, number] => {
  const f = Math.asin(clamp(sky.floor / len, 0, 1));
  const [right, left] = columnRange(ax, len, Math.max(sky.xmin, xmin), Math.min(sky.xmax, xmax));
  const lo = Math.max(f, right);
  const hi = Math.min(Math.PI - f, left);
  return lo <= hi ? [lo, hi] : [Math.PI / 2, Math.PI / 2];
};

/**
 * One step of a spool kite. `haul` is the line hauled in by the hand, sky units a second
 * (`SPOOL.hold` while the spool is held, 0 when let go).
 */
export const stepSpool = (
  k: SpoolKite,
  haul: number,
  wind: WindFn,
  sky: SkyBounds,
  dt: number,
): void => {
  k.px = k.x;
  k.py = k.y;
  k.age += dt;
  k.tangle += ((k.tangled ? 1 : 0) - k.tangle) * Math.min(1, dt / 0.4);
  const ux = Math.cos(k.theta);
  const uy = Math.sin(k.theta);
  const tx = -uy;
  const ty = ux;
  const W = wind(k.x, k.y);
  k.side += (Math.tanh(W / 0.08) - k.side) * Math.min(1, dt / 1.2);
  const L = k.length;
  const vx = k.lengthRate * ux + L * k.omega * tx;
  const vy = k.lengthRate * uy + L * k.omega * ty;
  const ax = W - vx + haul * ux;
  const ay = -vy + haul * uy;
  const speed = Math.hypot(ax, ay);
  const na = k.theta + clamp(k.side, -1, 1) * SPOOL.beta;
  const nx = Math.cos(na);
  const ny = Math.sin(na);
  const sail = SPOOL.sail * (1 - 0.35 * k.tangle) * speed * (ax * nx + ay * ny);
  const fx = sail * nx + SPOOL.tail * speed * ax;
  const fy = sail * ny + SPOOL.tail * speed * ay - SPOOL.gravity;
  let along = fx * tx + fy * ty;
  if (k.tangle > 0.01) along += k.tangle * 0.5 * Math.sin(k.age * 9.3);
  // Near its column's sides a damped spring eases the kite back, so it sways with the wind
  // there instead of resting against the side.
  const zone = (k.colMax - k.colMin) * 0.2;
  if (zone > 1e-6 && zone < 1e6) {
    const e =
      k.x > k.colMax - zone
        ? k.x - (k.colMax - zone)
        : k.x < k.colMin + zone
          ? k.x - (k.colMin + zone)
          : 0;
    if (e !== 0) {
      const stiff = SPOOL.keep / zone;
      const damp = 2 * Math.sqrt(stiff) * Math.min(1, Math.abs(e) / (0.25 * zone));
      along += (-stiff * e - damp * vx) * tx;
    }
  }
  const tension = fx * ux + fy * uy + L * k.omega * k.omega;
  k.tension += (clamp(tension / (SPOOL.gravity * 5), 0, 1.2) - k.tension) * Math.min(1, dt / 0.15);

  k.omega += (along / L - (2 * k.lengthRate * k.omega) / L - SPOOL.damp * k.omega) * dt;
  k.theta += k.omega * dt;

  // The line: out at a steady pace while reeled in, slowly back to rest once let go, easing at
  // both ends.
  const want = clamp(haul / SPOOL.fullPull, 0, 1);
  k.pull += (want - k.pull) * Math.min(1, dt / (want > k.pull ? 0.12 : 0.3));
  k.lengthRate =
    SPOOL.out * k.pull * smooth(0, 0.14, SPOOL.max - L) -
    SPOOL.back * (1 - k.pull) * smooth(0, 0.08, L - SPOOL.rest);
  k.length = clamp(L + k.lengthRate * dt, SPOOL.rest * 0.9, SPOOL.max);

  const [lo, hi] = thetaRange(k.ax, k.length, sky, k.colMin, k.colMax);
  if (k.theta < lo) {
    k.theta = lo;
    if (k.omega < 0) k.omega = 0;
  } else if (k.theta > hi) {
    k.theta = hi;
    if (k.omega > 0) k.omega = 0;
  }
  placeSpool(k);
  // The spine leans the way the line does, with a little shake in gusts and tangles.
  const lean = (k.theta - Math.PI / 2) * 0.45;
  k.spin = lean + k.tangle * 0.25 * Math.sin(k.age * 11) + 0.05 * Math.sin(k.age * 2.3);
  if (k.y > 0.8 * sky.top) k.sparkle = true;
  else if (k.y < 0.72 * sky.top) k.sparkle = false;
};

export const windowCentre = (k: StuntKite, win: StuntWindow): number =>
  k.ax + clamp(k.side, -1, 1) * win.shift;

/** 0 in the window's middle (on the ground below its centre), 1 on its edge. */
export const windowRadius = (k: StuntKite, win: StuntWindow, x = k.x, y = k.y): number => {
  const cx = windowCentre(k, win);
  return Math.hypot((x - cx) / win.a, y / win.b);
};

/** A stunt kite parked at the top of its window. */
export const createStunt = (ax: number, win: StuntWindow, side = 1): StuntKite => {
  const k: StuntKite = {
    ...base(ax),
    kind: "stunt",
    heading: Math.PI / 2,
    speed: 0,
    phase: "fly",
    phaseT: 0,
    parked: 1,
  };
  k.side = side >= 0 ? 1 : -1;
  k.x = windowCentre(k, win);
  k.y = win.b * 0.97;
  k.px = k.x;
  k.py = k.y;
  return k;
};

export const resetStunt = (k: StuntKite, win: StuntWindow, side = k.side): void => {
  Object.assign(k, createStunt(k.ax, win, side));
};

export interface StuntInput {
  /** True while a hand is on either handle. */
  held: boolean;
  /** How far each handle is pulled down, 0 to 1. */
  left: number;
  right: number;
}

/** One step of a stunt kite. `windRef` is the wind speed of one wind unit, sky units a second. */
export const stepStunt = (
  k: StuntKite,
  input: StuntInput,
  wind: WindFn,
  win: StuntWindow,
  sky: SkyBounds,
  dt: number,
  windRef = WIND_SPEED,
): void => {
  k.px = k.x;
  k.py = k.y;
  k.age += dt;
  k.tangle += ((k.tangled ? 1 : 0) - k.tangle) * Math.min(1, dt / 0.4);
  const W = wind(k.x, k.y);
  k.side += (Math.tanh(W / 0.08) - k.side) * Math.min(1, dt / 1.5);
  if (k.phase === "down") {
    k.phaseT += dt;
    k.tension += (0 - k.tension) * Math.min(1, dt / 0.3);
    k.spin = angleDiff(Math.PI / 2, k.heading);
    if (k.phaseT >= STUNT.down) {
      k.phase = "fly";
      k.phaseT = 0;
      const cx = windowCentre(k, win);
      k.heading = Math.PI / 2 + clamp((cx - k.x) / win.a, -1, 1) * -0.4;
      k.y = sky.floor + 0.01;
      k.speed = 0.2 * STUNT.speed;
    }
    return;
  }
  k.phaseT += dt;
  const left = clamp(input.left, 0, 1);
  const right = clamp(input.right, 0, 1);
  let turn: number;
  if (input.held) {
    turn = STUNT.turn * (left - right);
  } else {
    turn = clamp(2.4 * angleDiff(Math.PI / 2, k.heading), -STUNT.turn * 0.8, STUNT.turn * 0.8);
  }
  if (k.tangle > 0.01) turn += k.tangle * 1.8 * Math.sin(k.age * 7.1);
  k.heading = angleDiff(k.heading + turn * dt, 0);

  const e = windowRadius(k, win);
  const middle = STUNT.edge + (1 - STUNT.edge) * (1 - Math.min(1, e) ** 4);
  const gust = clamp(Math.abs(W) / windRef, 0.55, 1.7);
  const boost = input.held ? 1 + STUNT.boost * Math.min(left, right) : 1;
  const up = Math.max(0, Math.sin(k.heading));
  // Parks only near the top: at a side edge it slides up along the edge first.
  const high = smooth(0.8, 0.93, k.y / win.b);
  const parkTo = input.held ? 0 : smooth(0.8, 0.97, e) * smooth(0.6, 0.95, up) * high;
  k.parked += (parkTo - k.parked) * Math.min(1, dt / 0.5);
  const target = STUNT.speed * gust * middle * boost * (1 - 0.3 * k.tangle) * (1 - 0.94 * k.parked);
  k.speed += (target - k.speed) * Math.min(1, dt / 0.25);

  let x = k.x + k.speed * Math.cos(k.heading) * dt;
  let y = k.y + k.speed * Math.sin(k.heading) * dt;
  const cx = windowCentre(k, win);
  const r = Math.hypot((x - cx) / win.a, y / win.b);
  if (r > 1) {
    x = cx + (x - cx) / r;
    y = y / r;
  }
  if (y < sky.floor) {
    const diving = Math.sin(k.heading) < -0.3 && k.speed > 0.3 * STUNT.speed;
    y = sky.floor;
    if (diving) {
      k.phase = "down";
      k.phaseT = 0;
      k.speed = 0;
    } else if (Math.sin(k.heading) < 0) {
      k.heading = Math.atan2(-Math.sin(k.heading), Math.cos(k.heading));
    }
  }
  k.x = clamp(x, sky.xmin, sky.xmax);
  k.y = clamp(y, sky.floor, sky.top);
  k.tension +=
    (clamp(0.25 + 0.75 * (k.speed / STUNT.speed), 0, 1.2) - k.tension) * Math.min(1, dt / 0.2);
  k.spin = angleDiff(k.heading, Math.PI / 2);
};

export const kiteHeight = (k: Kite): number => k.y;
