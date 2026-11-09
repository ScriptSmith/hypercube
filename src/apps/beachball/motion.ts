/**
 * How the ball turns: a rigid rotation driven by an angular velocity in the room's frame.
 *
 * Between tosses the ball spins lazily about its own cap-to-cap axis, that axis turns slowly
 * round the vertical (precession) and its tilt eases between poses: one cap facing the people
 * underneath, the other cap, or lying on its side, with a small nodding (nutation) on top. Now
 * and then a toss kicks in extra spin about a random axis over a fraction of a second, and air
 * drag lets it die away exponentially while the axis settles back.
 *
 * Everything follows from the random stream and the time stepped, so the same seed gives the
 * same show.
 */
import {
  DEG,
  type Mat3,
  multiply3,
  orthonormalize3,
  rotationAbout,
  type Vec3,
} from "../../core/sphere";
import type { Rng } from "../../core/types";

export type Pace = "lazy" | "lively";

const TAU = Math.PI * 2;

export interface PaceSpec {
  /** Seconds per turn about the ball's own axis. */
  spin: readonly [number, number];
  /** Seconds per turn of that axis round the vertical. */
  precess: readonly [number, number];
}

export const PACES: Record<Pace, PaceSpec> = {
  lazy: { spin: [15, 30], precess: [70, 120] },
  lively: { spin: [7, 13], precess: [35, 60] },
};

/** Seconds from one toss to the next, and from the start to the first. */
export const TOSS_GAP = [40, 120] as const;
export const FIRST_TOSS = [20, 60] as const;
/** Peak extra spin of a toss, turns a second. */
export const TOSS_SPEED = [0.35, 0.75] as const;
/** Seconds the kick takes to build up. */
export const TOSS_RAMP = [0.3, 0.6] as const;
/** Air drag's time constant, s: after three of them (10 to 20 s) 5 % of the kick is left. */
export const TOSS_TAU = [3.3, 6.5] as const;

/**
 * The fastest the ball ever turns, turns a second. Its three white gores then pass any point at
 * most 2.4 times a second, under the limit of three flashes a second.
 */
export const MAX_TURNS = 0.8;

/** Tilt of the axis from the vertical, in poses: one cap down, the other cap down, on its side. */
const POSES: readonly (readonly [number, number])[] = [
  [10 * DEG, 24 * DEG],
  [156 * DEG, 170 * DEG],
  [55 * DEG, 125 * DEG],
];
const DWELL = [15, 40] as const;
/** Fastest a pose change asks the tilt to move, on average, rad/s. */
const POSE_RATE = 6 * DEG;
/** How hard the axis is pulled back to its target, per radian off it, and the fastest. */
const PULL_GAIN = 0.4;
const PULL_RATE = 0.35;
const NUTATION = 3 * DEG;
const ORTHO_EVERY = 60;

export interface Toss {
  start: number;
  /** Unit axis in the room's frame. */
  axis: Vec3;
  /** Peak extra spin, rad/s. */
  speed: number;
  ramp: number;
  tau: number;
}

const smooth = (u: number): number => {
  const a = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return a * a * (3 - 2 * a);
};

/** How much of a toss's peak spin there is at time `t`. */
export const tossFactor = (k: Toss, t: number): number => {
  const u = t - k.start;
  if (u <= 0) return 0;
  return smooth(u / k.ramp) * Math.exp(-Math.max(0, u - k.ramp) / k.tau);
};

interface Wave {
  period: number;
  phase: number;
  weight: number;
}

const makeWave = (rng: Rng, lo: number, hi: number): Wave[] =>
  [1, 0.5, 0.33].map((weight) => ({
    period: rng.range(lo, hi),
    phase: rng.range(0, TAU),
    weight,
  }));

/** A smooth wander between 0 and 1. */
const waveAt = (w: readonly Wave[], t: number): number => {
  let sum = 0;
  let total = 0;
  for (const p of w) {
    sum += p.weight * Math.sin((TAU * t) / p.period + p.phase);
    total += p.weight;
  }
  return 0.5 + (0.5 * sum) / total;
};

const lerp = (r: readonly [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

interface Pose {
  /** Tilt it moves from and to, radians from the vertical. */
  from: number;
  to: number;
  /** When the move starts, how long it takes and how long the pose then holds. */
  at: number;
  move: number;
  hold: number;
  kind: number;
}

export interface MotionOptions {
  pace: Pace;
  toss: boolean;
}

export interface Motion {
  /** Seconds of show stepped so far. */
  readonly time: number;
  /** Turns the ball's frame into the room's. */
  readonly rotation: Mat3;
  /** Angular velocity in the room's frame, rad/s. */
  readonly omega: Vec3;
  /** Tosses still adding spin. */
  readonly tosses: readonly Toss[];
  readonly tossCount: number;
  /** When the next toss is due, or Infinity with tosses off. */
  readonly nextToss: number;
  /** The ball's cap-to-cap axis (its +y pole) in the room's frame. */
  axis(): Vec3;
  /** Angle of that axis from straight up, radians. */
  tilt(): number;
  /** Where the tilt is heading. */
  targetTilt(): number;
  /** The spin there would be with no toss. */
  lazyOmega(): Vec3;
  step(dt: number): void;
  /** Toss now; the next scheduled toss is then at least the shortest gap away. */
  toss(): void;
}

export const createMotion = (rng: Rng, opts: MotionOptions): Motion => {
  const shape = rng.fork("shape");
  const poseRng = rng.fork("pose");
  const tossRng = rng.fork("toss");
  const pace = PACES[opts.pace] ?? PACES.lazy;
  const spinWave = makeWave(shape, 70, 230);
  const precessWave = makeWave(shape, 90, 300);
  const spinSign = shape.next() < 0.5 ? -1 : 1;
  const precessSign = shape.next() < 0.5 ? -1 : 1;
  const nutationPeriod = shape.range(6, 9);

  const tiltIn = (kind: number) => {
    const r = POSES[kind]!;
    return poseRng.range(r[0], r[1]);
  };
  const firstKind = poseRng.int(POSES.length);
  const firstTilt = tiltIn(firstKind);
  let pose: Pose = {
    from: firstTilt,
    to: firstTilt,
    at: 0,
    move: 0,
    hold: poseRng.range(DWELL[0], DWELL[1]),
    kind: firstKind,
  };
  const nextPose = (prev: Pose): Pose => {
    const kind = (prev.kind + 1 + poseRng.int(POSES.length - 1)) % POSES.length;
    const to = tiltIn(kind);
    return {
      from: prev.to,
      to,
      at: prev.at + prev.move + prev.hold,
      move: Math.max(8, Math.abs(to - prev.to) / POSE_RATE),
      hold: poseRng.range(DWELL[0], DWELL[1]),
      kind,
    };
  };

  /** Where the tilt is heading and how fast, within the pose `step` keeps current. */
  const tiltTarget = (time: number): [number, number] => {
    const u = pose.move > 0 ? (time - pose.at) / pose.move : 1;
    const k = u <= 0 || u >= 1 ? 0 : (6 * u * (1 - u)) / pose.move;
    const w = TAU / nutationPeriod;
    return [
      pose.from + (pose.to - pose.from) * smooth(u) + NUTATION * Math.sin(w * time),
      (pose.to - pose.from) * k + NUTATION * w * Math.cos(w * time),
    ];
  };

  const precessRate = (time: number) =>
    (precessSign * TAU) / lerp(pace.precess, waveAt(precessWave, time));

  let t = 0;
  let steps = 0;
  // The target's heading, which turns at the precession rate.
  let heading = shape.range(0, TAU);
  let rotation: Mat3 = multiply3(
    rotationAbout([0, 1, 0], heading),
    multiply3(rotationAbout([1, 0, 0], firstTilt), rotationAbout([0, 1, 0], shape.range(0, TAU))),
  );
  const tosses: Toss[] = [];
  let tossCount = 0;
  let nextToss = opts.toss ? tossRng.range(FIRST_TOSS[0], FIRST_TOSS[1]) : Infinity;

  const axisOf = (m: Mat3): Vec3 => [m[1], m[4], m[7]];

  const lazyAt = (m: Mat3, time: number): Vec3 => {
    const a = axisOf(m);
    // The target axis, and the turn that carries it along, so an axis on target stays on it.
    const [th, thRate] = tiltTarget(time);
    const psiRate = precessRate(time);
    const st = Math.sin(th);
    const ct = Math.cos(th);
    const sp = Math.sin(heading);
    const cp = Math.cos(heading);
    const target: Vec3 = [st * sp, ct, st * cp];
    const follow = cross(target, [
      thRate * ct * sp + psiRate * st * cp,
      -thRate * st,
      thRate * ct * cp - psiRate * st * sp,
    ]);
    // A pull towards the target the short way round, which fades out right opposite it, where
    // the short way is undecided (the target moves on, so the axis never stays there).
    const c = cross(a, target);
    const sinA = Math.hypot(c[0], c[1], c[2]);
    const angle = Math.atan2(sinA, a[0] * target[0] + a[1] * target[1] + a[2] * target[2]);
    const pull =
      sinA > 1e-12
        ? (Math.min(PULL_RATE, PULL_GAIN * angle) * smooth((Math.PI - angle) / 0.3)) / sinA
        : 0;
    const spin = (spinSign * TAU) / lerp(pace.spin, waveAt(spinWave, time));
    return [
      spin * a[0] + follow[0] + pull * c[0],
      spin * a[1] + follow[1] + pull * c[1],
      spin * a[2] + follow[2] + pull * c[2],
    ];
  };

  const omegaAt = (m: Mat3, time: number): Vec3 => {
    const w = [...lazyAt(m, time)] as [number, number, number];
    for (const k of tosses) {
      const f = k.speed * tossFactor(k, time);
      w[0] += k.axis[0] * f;
      w[1] += k.axis[1] * f;
      w[2] += k.axis[2] * f;
    }
    const len = Math.hypot(w[0], w[1], w[2]);
    const max = MAX_TURNS * TAU;
    if (len > max) {
      const s = max / len;
      w[0] *= s;
      w[1] *= s;
      w[2] *= s;
    }
    return w;
  };

  const startToss = () => {
    const z = tossRng.range(-1, 1);
    const phi = tossRng.range(0, TAU);
    const r = Math.sqrt(1 - z * z);
    tosses.push({
      start: t,
      axis: [r * Math.cos(phi), z, r * Math.sin(phi)],
      speed: TAU * tossRng.range(TOSS_SPEED[0], TOSS_SPEED[1]),
      ramp: tossRng.range(TOSS_RAMP[0], TOSS_RAMP[1]),
      tau: tossRng.range(TOSS_TAU[0], TOSS_TAU[1]),
    });
    tossCount++;
  };

  let omega = omegaAt(rotation, t);

  return {
    get time() {
      return t;
    },
    get rotation() {
      return rotation;
    },
    get omega() {
      return omega;
    },
    get tosses() {
      return tosses;
    },
    get tossCount() {
      return tossCount;
    },
    get nextToss() {
      return nextToss;
    },
    axis: () => axisOf(rotation),
    tilt: () => Math.acos(Math.max(-1, Math.min(1, rotation[4]))),
    targetTilt: () => tiltTarget(t)[0],
    lazyOmega: () => lazyAt(rotation, t),
    step(dt) {
      const l = Math.hypot(omega[0], omega[1], omega[2]);
      if (l > 0) rotation = multiply3(rotationAbout(omega, l * dt), rotation);
      heading = (heading + precessRate(t) * dt) % TAU;
      t += dt;
      if (++steps % ORTHO_EVERY === 0) rotation = orthonormalize3(rotation);
      while (t >= pose.at + pose.move + pose.hold) pose = nextPose(pose);
      if (t >= nextToss) {
        startToss();
        nextToss = t + tossRng.range(TOSS_GAP[0], TOSS_GAP[1]);
      }
      for (let i = tosses.length - 1; i >= 0; i--) {
        const k = tosses[i]!;
        if (t - k.start > k.ramp + 12 * k.tau) tosses.splice(i, 1);
      }
      omega = omegaAt(rotation, t);
    },
    toss() {
      startToss();
      if (opts.toss) nextToss = Math.max(nextToss, t + TOSS_GAP[0]);
    },
  };
};
