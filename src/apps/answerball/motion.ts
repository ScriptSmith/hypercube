/**
 * Where everything is at a show time: the ball's rotation, and for each window the die's pose,
 * the prompt's strength and the liquid's slosh. All of it is worked out from the plan and the
 * time, never accumulated, so nothing drifts over days.
 *
 * Frames: venue (y up, longitude 0 towards +z), the ball's own frame (the single window looks
 * along +z), and each window's frame (x right and y up for someone outside, z out through the
 * glass). Lengths are in ball radii.
 */
import {
  DEG,
  IDENTITY3,
  type Mat3,
  multiply3,
  rotationAbout,
  transpose3,
  apply3,
  type Vec3,
} from "../../core/sphere";
import { FACE_RADIUS, facePose, INRADIUS, VERTICES } from "./die";
import {
  dotQ,
  mat3FromQuat,
  mulQ,
  negQ,
  type Quat,
  quatAbout,
  quatFromMat3,
  slerpFixed,
} from "./rotation";
import { type Cycle, type Show, type Stage, WINDOW_RADIUS } from "./show";

/** The die's front face fills this share of the window, corner to centre. */
const FILL = 0.86;
/** Face circumradius in ball radii, and the die's scale (its circumradius). */
export const FACE_SIZE = FILL * Math.sin(WINDOW_RADIUS);
export const DIE_SCALE = FACE_SIZE / FACE_RADIUS;
/** Where the die's front face sits at rest: its corners just inside the curved glass. */
export const CONTACT_Z = Math.sqrt(1 - FACE_SIZE * FACE_SIZE) - 0.002;
export const REST_Z = CONTACT_Z - INRADIUS * DIE_SCALE;
/** How far below its rest the die waits in the dark, and where the shake stirs it up to. */
export const DEEP = 0.62;
export const MID = 0.2;

/** The quickest a shake rocks back and forth, a second. */
const MAX_ROCK_HZ = 3;
/** Turns per second of the ball with three or six windows. */
const SPIN = { calm: 1 / 240, lively: 1 / 150 };

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const smootherstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const stage = (c: Cycle, id: Stage["id"]): Stage => c.stages.find((s) => s.id === id)!;

/**
 * Share of a turn done at `u` (0 to 1) of its time: eased in, past the end by `over`, and settled
 * back by the end.
 */
export const turnEase = (u: number, over: number): number => {
  const a = 0.74;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < a) return (1 + over) * smootherstep(u / a);
  return 1 + over * 0.5 * (1 + Math.cos((Math.PI * (u - a)) / (1 - a)));
};

/** The rocks of a shake, `tau` seconds into it: an angle, radians. */
export const rockAngle = (c: Cycle, tau: number, length: number): number => {
  if (tau <= 0 || tau >= length || length <= 0) return 0;
  const f = Math.min(MAX_ROCK_HZ, c.rocks / length);
  const env =
    (1 - Math.exp(-tau / 0.05)) *
    Math.exp((-1.6 * tau) / length) *
    (1 - smoothstep((tau - 0.82 * length) / (0.18 * length)));
  return c.amplitude * env * Math.sin(2 * Math.PI * f * tau);
};

/** The window's pose angles (latitude and bearing) during a cycle with one window. */
export const poseAt = (c: Cycle, at: number): { pitch: number; yaw: number } => {
  const turn = c.stages[0]!;
  const len = turn.end - turn.start;
  const u = len > 0 ? (at - turn.start) / len : 1;
  if (u >= 1) return { ...c.to };
  const travel = Math.hypot(
    c.to.pitch - c.from.pitch,
    (c.to.yaw - c.from.yaw) * Math.cos(c.to.pitch),
  );
  const over = travel > 1e-6 ? c.overshoot / travel : 0;
  const p = turnEase(u, over);
  const fromDown = c.from.pitch < -89 * DEG;
  const toDown = c.to.pitch < -89 * DEG;
  // Straight down, a change of bearing only spins the window in place, so do it there.
  const py = fromDown && !toDown ? smootherstep(u / 0.75) : p;
  return { pitch: mix(c.from.pitch, c.to.pitch, p), yaw: mix(c.from.yaw, c.to.yaw, py) };
};

/** The ball's frame in the venue for a window looking at `pitch` and `yaw`, before any rock. */
export const poseRotation = (pitch: number, yaw: number): Mat3 =>
  multiply3(rotationAbout([0, 1, 0], yaw), rotationAbout([1, 0, 0], -pitch));

/** The axis a shake rocks about, in the venue, for a window facing `yaw`. */
const rockAxis = (c: Cycle, yaw: number, down: boolean): Vec3 => {
  if (down) return [Math.cos(yaw + c.axisMix), 0, -Math.sin(yaw + c.axisMix)];
  const m = c.axisMix;
  const nod: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  return [nod[0] * Math.cos(m), Math.sin(m), nod[2] * Math.cos(m)];
};

export interface Motion {
  /** The ball's rotation (ball frame to venue) at show time `t`. */
  ball(t: number): Mat3;
  /** Each window's frame in the ball's frame (window frame to ball). */
  readonly windows: readonly Mat3[];
  die(lane: number, t: number): DiePose;
  /** How strongly the prompt shows, 0 to 1. */
  prompt(lane: number, t: number): number;
  /** The liquid's lag behind a rock, in the window's plane, ball radii. */
  slosh(lane: number, t: number, ball: Mat3): [number, number];
  /** The window's centre in the venue at `t`. */
  aim(lane: number, ball: Mat3): Vec3;
}

export interface DiePose {
  /** Die frame to window frame. */
  rot: Mat3;
  /** The die's centre in the window frame, ball radii. */
  pos: Vec3;
  /** How far the die is behind its rest against the glass, ball radii. */
  depth: number;
  /** The text's angle in the window, radians (0 is upright for a side window). */
  angle: number;
}

/** How far a die at `rot` would poke through the glass at rest depth, ball radii. */
export const poke = (rot: Mat3): number => {
  let top = -1;
  for (const v of VERTICES) {
    const z = rot[6] * v[0] + rot[7] * v[1] + rot[8] * v[2];
    if (z > top) top = z;
  }
  return Math.max(0, top - INRADIUS) * DIE_SCALE;
};

/** Angle of the tumble, `tau` seconds into the shake. */
const tumble = (c: Cycle, tau: number, decay: number): number => {
  const rise = 0.12;
  const k = 1 / (1 / rise + 1 / decay);
  return c.tumbleSpeed * (decay * (1 - Math.exp(-tau / decay)) - k * (1 - Math.exp(-tau / k)));
};

export const createMotion = (show: Show): Motion => {
  const turning = show.options.windows > 1;
  const spin = SPIN[show.options.pace] * 2 * Math.PI;
  const period = (2 * Math.PI) / spin;
  const seats = show.seats;
  const windows: Mat3[] = turning ? seats.map((s) => poseRotation(s.pitch, s.yaw)) : [IDENTITY3];
  // The windows of a row share one plan, so only the first of each rocks the ball.
  const leaders = seats.map((s) => seats.findIndex((x) => x.row === s.row));
  const rockers = leaders.filter((l, i) => l === i);
  const spinYaw = (t: number) => (((t % period) + period) % period) * spin;

  const textAngle = (c: Cycle, t: number): number =>
    c.spinStart + c.spinRate * (t - (c.start + stage(c, "rise").start));

  /** The die waiting in the dark after `prev`'s answer, slowly turning. */
  const waiting = (prev: Cycle | null, c: Cycle, t: number): Mat3 => {
    if (!prev) {
      const base = facePose(c.answer, 0);
      return multiply3(rotationAbout(c.driftAxis, c.driftRate * (t - c.start)), base);
    }
    const sinkStart = prev.start + stage(prev, "sink").start;
    return multiply3(
      rotationAbout(prev.driftAxis, prev.driftRate * (t - sinkStart)),
      held(prev, sinkStart),
    );
  };

  const contactAt = (c: Cycle) => (c.long ? 0.62 : 0.82);

  /** Rocking against the glass after the die arrives, `since` seconds after it touched. */
  const wobble = (c: Cycle, since: number): Mat3 => {
    if (since <= 0) return IDENTITY3;
    const decay = c.long ? 0.9 : 0.5;
    const a = c.wobble * Math.exp(-since / decay) * Math.sin(2 * Math.PI * 1.6 * since);
    return rotationAbout([Math.cos(c.wobbleAngle), Math.sin(c.wobbleAngle), 0], a);
  };

  const contactTime = (c: Cycle) => {
    const r = stage(c, "rise");
    return c.start + r.start + contactAt(c) * (r.end - r.start);
  };

  /** The die's orientation while it holds the answer. */
  const held = (c: Cycle, t: number): Mat3 => {
    const h = stage(c, "hold");
    const tau = t - (c.start + h.start);
    const bob = rotationAbout(
      [Math.cos(c.wobbleAngle + 1.7), Math.sin(c.wobbleAngle + 1.7), 0],
      0.6 * DEG * Math.sin(2 * Math.PI * 0.13 * tau),
    );
    return multiply3(
      bob,
      multiply3(wobble(c, t - contactTime(c)), facePose(c.answer, textAngle(c, t))),
    );
  };

  // The die drifts about in the depths, the same from one answer to the next.
  const wander = (c: Cycle, t: number): [number, number] => [
    0.035 * Math.sin(0.31 * t + 2.1 * c.lane),
    0.03 * Math.sin(0.23 * t + 1.3 * c.lane + 0.8),
  ];

  /** The tumble while shaken and rising, as a quaternion that turns smoothly with time. */
  const tumbleQ = (c: Cycle, prev: Cycle | null, t: number): Quat => {
    const s = stage(c, "shake");
    const r = stage(c, "rise");
    const shakeStart = c.start + s.start;
    const pre = quatFromMat3(waiting(prev, c, shakeStart));
    const decay = s.end - s.start + 0.5 * (r.end - r.start);
    return mulQ(quatAbout(c.tumbleAxis, tumble(c, t - shakeStart, decay)), pre);
  };

  const shaken = (c: Cycle, prev: Cycle | null, t: number): Mat3 =>
    mat3FromQuat(tumbleQ(c, prev, t));

  /** The answer's resting pose, as a quaternion that turns smoothly with the text's angle. */
  const restQ = (c: Cycle, t: number): Quat =>
    mulQ(quatAbout([0, 0, 1], textAngle(c, t)), quatFromMat3(facePose(c.answer, 0)));

  /**
   * The rising die, `e` of the way from its tumble to rest. The way round is chosen once, at the
   * rise's start, so the die never snaps to the other way part way up.
   */
  const rising = (c: Cycle, prev: Cycle | null, t: number, e: number): Mat3 => {
    const start = c.start + stage(c, "rise").start;
    const flip = dotQ(tumbleQ(c, prev, start), restQ(c, start)) < 0;
    const rest = restQ(c, t);
    return mat3FromQuat(slerpFixed(tumbleQ(c, prev, t), flip ? negQ(rest) : rest, e));
  };

  const die = (lane: number, t: number): DiePose => {
    const c = show.cycle(lane, t);
    const prev = show.previous(c);
    const at = t - c.start;
    const s = show.stageAt(c, at);
    let rot: Mat3;
    let depth: number;
    let xy: [number, number];
    switch (s.id) {
      case "turn":
      case "prompt":
        rot = waiting(prev, c, t);
        depth = DEEP;
        xy = wander(c, t);
        break;
      case "shake": {
        rot = shaken(c, prev, t);
        const u = (at - s.start) / Math.max(1e-6, s.end - s.start);
        depth = mix(DEEP, MID, smoothstep(u));
        xy = wander(c, t);
        break;
      }
      case "rise": {
        const u = (at - s.start) / Math.max(1e-6, s.end - s.start);
        const cu = contactAt(c);
        const turnTo = c.long ? 0.97 : 0.86;
        const e = smootherstep(u / turnTo);
        rot = multiply3(wobble(c, t - contactTime(c)), rising(c, prev, t, e));
        if (u < cu) depth = MID * Math.pow(1 - u / cu, 2.2);
        else {
          const v = (u - cu) / (1 - cu);
          depth = (c.long ? 0.03 : 0.012) * Math.sin(Math.PI * v) * (1 - v);
        }
        const w = wander(c, c.start + s.start);
        const k = 1 - smootherstep(u / 0.9);
        xy = [w[0] * k, w[1] * k];
        break;
      }
      case "hold": {
        rot = held(c, t);
        const tau = at - s.start;
        depth = 0.004 * 0.5 * (1 - Math.cos((2 * Math.PI * tau) / 3.4));
        xy = [
          0.003 * Math.sin((2 * Math.PI * tau) / 4.1),
          0.0025 * Math.sin((2 * Math.PI * tau) / 5.3),
        ];
        break;
      }
      default: {
        const start = c.start + s.start;
        const u = (at - s.start) / Math.max(1e-6, s.end - s.start);
        rot = multiply3(rotationAbout(c.driftAxis, c.driftRate * (t - start)), held(c, start));
        const h = stage(c, "hold");
        const tau = s.start - h.start;
        const d0 = 0.004 * 0.5 * (1 - Math.cos((2 * Math.PI * tau) / 3.4));
        depth = mix(d0, DEEP, smoothstep(u));
        const b: [number, number] = [
          0.003 * Math.sin((2 * Math.PI * tau) / 4.1),
          0.0025 * Math.sin((2 * Math.PI * tau) / 5.3),
        ];
        const w = wander(c, t);
        const k = smoothstep(u);
        xy = [mix(b[0], w[0], k), mix(b[1], w[1], k)];
      }
    }
    const total = depth + poke(rot);
    return { rot, pos: [xy[0], xy[1], REST_Z - total], depth: total, angle: textAngle(c, t) };
  };

  const rockOf = (c: Cycle, t: number, yaw: number, down: boolean): Mat3 => {
    const s = stage(c, "shake");
    const a = rockAngle(c, t - (c.start + s.start), s.end - s.start);
    return a === 0 ? IDENTITY3 : rotationAbout(rockAxis(c, yaw, down), a);
  };

  const ball = (t: number): Mat3 => {
    if (!turning) {
      const c = show.cycle(0, t);
      const p = poseAt(c, t - c.start);
      return multiply3(rockOf(c, t, p.yaw, c.down), poseRotation(p.pitch, p.yaw));
    }
    const yaw = spinYaw(t);
    let m = rotationAbout([0, 1, 0], yaw);
    for (const i of rockers) {
      const c = show.cycle(i, t);
      m = multiply3(rockOf(c, t, yaw + seats[i]!.yaw, false), m);
    }
    return m;
  };

  const prompt = (lane: number, t: number): number => {
    if (!show.options.prompt) return 0;
    const c = show.cycle(lane, t);
    const p = stage(c, "prompt");
    const at = t - c.start;
    const len = p.end - p.start;
    if (len <= 0.2 || at < p.start || at > p.end + 0.4) return 0;
    const fade = Math.min(0.5, len / 3);
    return (
      smoothstep((at - p.start) / fade) * (1 - smoothstep((at - (p.end - fade)) / (fade + 0.4)))
    );
  };

  const slosh = (lane: number, t: number, ballRot: Mat3): [number, number] => {
    // The liquid follows the rock that moves the ball: its row's first window's.
    const lead = turning ? leaders[lane]! : lane;
    const c = show.cycle(lead, t);
    const s = stage(c, "shake");
    const len = s.end - s.start;
    const tau = t - (c.start + s.start);
    if (tau <= 0 || tau > len + 1.6) return [0, 0];
    const f = Math.min(MAX_ROCK_HZ, c.rocks / len);
    const env = (1 - Math.exp(-tau / 0.1)) * Math.exp(-tau / (0.45 * len + 0.5));
    const a = 0.02 * (c.amplitude / (5 * DEG)) * env * Math.cos(2 * Math.PI * f * tau - 0.6);
    // The window's centre moves at right angles to the rock's axis; the liquid lags behind it.
    const toVenue = multiply3(ballRot, windows[lane]!);
    let k: Vec3;
    if (turning) k = rockAxis(c, spinYaw(t) + seats[lead]!.yaw, false);
    else {
      const yaw = c.down ? Math.atan2(ballRot[1], ballRot[7]) : Math.atan2(toVenue[2], toVenue[8]);
      k = rockAxis(c, yaw, c.down);
    }
    const toWindow = transpose3(toVenue);
    const kw = apply3(toWindow, k);
    const l = Math.hypot(kw[0], kw[1]) || 1;
    return [(-kw[1] / l) * a, (kw[0] / l) * a];
  };

  const aim = (lane: number, ballRot: Mat3): Vec3 =>
    apply3(multiply3(ballRot, windows[lane]!), [0, 0, 1]);

  return { ball, windows, die, prompt, slosh, aim };
};
