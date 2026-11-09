/**
 * Everything that moves, as plain functions of an egg's plan and the seconds since it started:
 * the egg's rocking and turn, the crack clock, the pip hole, the hatch's pieces, the chick's
 * head, eyes and beak, how dry it is, and the fades. Nothing accumulates, so a jump to any
 * moment gives the same picture as playing up to it.
 */
import {
  IDENTITY3,
  type Mat3,
  multiply3,
  rotationAbout,
  transpose3,
  type Vec3,
} from "../../core/sphere";
import { CLOCK, type CrackNet } from "./cracks";
import { type EggPlan, findStage, type Stage } from "./show";

const DEG = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const within = (s: Stage | undefined, t: number) =>
  s ? clamp01((t - s.start) / (s.end - s.start)) : 0;

/** Level tilt of the egg from its rocks and jolts, as a rotation vector (x and z). */
export const tilt = (plan: EggPlan, t: number): [number, number] => {
  let x = 0;
  let z = 0;
  for (const r of plan.rocks) {
    if (r.at > t) break;
    const age = t - r.at;
    if (age * r.decay > 6) continue;
    const a = r.amp * Math.exp(-age * r.decay) * Math.sin(2 * Math.PI * r.freq * age);
    x += a * Math.cos(r.axis);
    z += a * Math.sin(r.axis);
  }
  return [x, z];
};

/** The egg's turn about its upright axis, radians. */
export const eggYaw = (plan: EggPlan, t: number): number => plan.yaw0 + plan.spin * t;

/** The egg's orientation in the room: turned, then tilted. */
export const eggOrientation = (plan: EggPlan, t: number): Mat3 => {
  const [x, z] = tilt(plan, t);
  const yaw = rotationAbout([0, 1, 0], eggYaw(plan, t));
  const angle = Math.hypot(x, z);
  return angle > 1e-7 ? multiply3(rotationAbout([x, 0, z], angle), yaw) : yaw;
};

/** How far a crack started by an event at `at` has run, 0 to 1, over `grow` seconds. */
const grown = (t: number, at: number, grow: number) => clamp01((t - at) / grow);

/** Taps or pecks done by `t`, counting the one under way as a fraction. */
const done = (times: readonly number[], t: number, grow: number): number => {
  let n = 0;
  for (const at of times) {
    if (at > t) break;
    n += grown(t, at, grow);
  }
  return n;
};

/** The crack clock: which cracks show at `t` (see `CLOCK`). */
export const crackClock = (plan: EggPlan, t: number): number => {
  const pip = findStage(plan, "pip")!;
  const zip = findStage(plan, "zip")!;
  const hatch = findStage(plan, "hatch")!;
  if (t < pip.start) return 0;
  if (t < zip.start) {
    const n = plan.taps.length || 1;
    return lerp(CLOCK.star[0], CLOCK.star[1], done(plan.taps, t, 0.15) / n);
  }
  if (t < hatch.start) {
    const n = plan.pecks.length || 1;
    return lerp(CLOCK.zip[0], CLOCK.zip[1], done(plan.pecks, t, 0.3) / n);
  }
  const h = hatchTimes(hatch);
  if (t < h.lower)
    return lerp(
      CLOCK.final[0],
      CLOCK.final[1],
      clamp01((t - hatch.start) / (h.lower - hatch.start)),
    );
  return lerp(CLOCK.lower[0], CLOCK.lower[1], clamp01((t - h.lower) / h.lowerRun));
};

/** The pip hole's size, 0 (none) to 1 (full), growing with the taps after it opens. */
export const pipHole = (plan: EggPlan, t: number): number => {
  const from = plan.holeTap;
  const left = plan.taps.length - from;
  if (left <= 0) return 0;
  let n = 0;
  for (let i = from; i < plan.taps.length; i++) n += grown(t, plan.taps[i]!, 0.12);
  return clamp01(0.35 + (0.65 * (n - 1)) / Math.max(1, left - 1)) * (n > 0 ? 1 : 0);
};

/** Moments within the hatch stage, seconds from the egg's start. */
export const hatchTimes = (hatch: Stage) => {
  const H = hatch.end - hatch.start;
  return {
    /** The last stretch of the ring breaks, then the lower cracks run. */
    lower: hatch.start + 0.1 * H,
    lowerRun: 0.15 * H,
    capFrom: hatch.start + 0.08 * H,
    capTo: hatch.start + 0.5 * H,
    piecesFrom: hatch.start + 0.28 * H,
    piecesTo: hatch.start + 0.96 * H,
    tearFrom: hatch.start + 0.2 * H,
  };
};

export interface PieceState {
  /** Undoes the piece's turn: piece frame from egg frame. */
  inverse: Mat3;
  centre: Vec3;
  /** Size relative to where it started; shrinks as it falls away. */
  scale: number;
  alpha: number;
  /** 0 while it sits in place, 1 once it has come away. */
  loose: number;
}

export interface HatchState {
  /** True from the first moment anything moves until the last piece has gone. */
  moving: boolean;
  /** The shell is still there at all. */
  shell: boolean;
  cap: PieceState;
  pieces: PieceState[];
  /** Membrane torn away, 0 to 1. */
  tear: number;
}

const STILL: PieceState = { inverse: IDENTITY3, centre: [0, 1, 0], scale: 1, alpha: 1, loose: 0 };

/** Where the cap and each lower piece are at `t`. */
export const hatchState = (plan: EggPlan, net: CrackNet, t: number): HatchState => {
  const hatch = findStage(plan, "hatch")!;
  const h = hatchTimes(hatch);
  const pieces: PieceState[] = net.centres.map((c) => ({ ...STILL, centre: c }));
  if (t < h.capFrom) {
    return { moving: false, shell: true, cap: STILL, pieces, tear: 0 };
  }
  // The cap: hinges up a little towards the uncut side, then shrinks away into the top.
  const lift = smooth((t - h.capFrom) / (h.capTo - h.capFrom));
  const hingeAxis: Vec3 = [Math.cos(net.hinge), 0, -Math.sin(net.hinge)];
  const capTurn = rotationAbout(
    hingeAxis,
    16 * DEG * Math.sin(Math.min(1, lift * 1.6) * Math.PI * 0.5),
  );
  const cap: PieceState = {
    inverse: transpose3(capTurn),
    centre: [0, 1, 0],
    scale: lerp(1, 0.04, lift * lift),
    alpha: 1 - smooth((lift - 0.75) / 0.25),
    loose: smooth(lift * 4),
  };
  // Lower pieces come away one by one round the egg, the cup last.
  const n = pieces.length;
  const span = h.piecesTo - h.piecesFrom;
  const each = span * 0.42;
  for (let k = 0; k < n; k++) {
    const start = h.piecesFrom + ((span - each) * k) / Math.max(1, n - 1);
    const f = clamp01((t - start) / each);
    const c = net.centres[k]!;
    const fall = f * f;
    if (k === n - 1) {
      pieces[k] = {
        inverse: IDENTITY3,
        centre: c,
        scale: lerp(1, 0.05, fall),
        alpha: 1 - smooth((f - 0.7) / 0.3),
        loose: smooth(f * 5),
      };
      continue;
    }
    // A level axis that turns this piece's middle downwards.
    const len = Math.hypot(c[0], c[2]) || 1;
    const axis: Vec3 = [c[2] / len, 0, -c[0] / len];
    pieces[k] = {
      inverse: rotationAbout(axis, -70 * DEG * fall),
      centre: c,
      scale: lerp(1, 0.55, fall),
      alpha: 1 - smooth((f - 0.65) / 0.35),
      loose: smooth(f * 5),
    };
  }
  const tear = smooth((t - h.tearFrom) / (hatch.end + 2 - h.tearFrom));
  return { moving: true, shell: t < hatch.end, cap, pieces, tear };
};

/** How dry the chick's down is, 0 (just hatched) to 1 (fluffy). */
export const dryness = (plan: EggPlan, t: number): number => {
  const dry = findStage(plan, "dry")!;
  if (t <= dry.start) return 0;
  // Slow to start, quick in the middle, then the last fluffing.
  const f = within(dry, t);
  return smooth(smooth(f) * 0.85 + f * 0.15);
};

const bump = (t: number, at: number, length: number) => {
  const x = (t - at) / length;
  return x < 0 || x > 1 ? 0 : Math.sin(Math.PI * x);
};

export interface ChickPose {
  /** Chick frame from room frame, for the shader. */
  inverse: Mat3;
  /** 0 open, 1 closed. */
  lids: number;
  /** 0 shut, 1 wide (a cheep). */
  beak: number;
  /** A small flap of the wings, 0 to 1. */
  wings: number;
}

/** Face direction in the chick's own frame: forward is +z, a little below the middle, so it looks down at people. */
export const FACE_LAT = -6 * DEG;

/** The chick's yaw when it hatches: facing where its beak finished the ring, in the room. */
export const hatchYaw = (plan: EggPlan, net: CrackNet): number => {
  const hatch = findStage(plan, "hatch")!;
  return eggYaw(plan, hatch.start) + net.last.lon;
};

export const chickPose = (plan: EggPlan, net: CrackNet, t: number): ChickPose => {
  const hatch = findStage(plan, "hatch")!;
  const c = plan.chick;
  const since = Math.max(0, t - hatch.start);
  let yaw = hatchYaw(plan, net) + c.turn * Math.max(0, t - hatch.end);
  let pitch = -16 * DEG;
  // Glances ease from one to the next; the first two (lying down, then the head coming up) slowly.
  let prev = c.glances[0];
  for (let i = 1; i < c.glances.length; i++) {
    const g = c.glances[i]!;
    if (g.at > t) break;
    const ease = i === 1 ? 2.5 : 0.45;
    const f = smooth((t - g.at) / ease);
    const p = prev!;
    prev = { at: g.at, yaw: lerp(p.yaw, g.yaw, f), pitch: lerp(p.pitch, g.pitch, f) };
  }
  if (prev) {
    yaw += prev.yaw;
    pitch = prev.pitch;
  }
  let lids = 0;
  for (const b of c.blinks) {
    if (b > t) break;
    lids = Math.max(lids, bump(t, b, 0.22));
  }
  let roll = 0;
  if (c.doze) {
    const d = c.doze;
    const sleepy = smooth((t - d.at) / 2.5) * (1 - smooth((t - d.at - d.length) / 0.6));
    lids = Math.max(lids, sleepy);
    pitch -= 9 * DEG * sleepy;
    roll += 3 * DEG * sleepy * Math.sin(t * 0.5);
  }
  let beak = 0;
  for (const ch of c.cheeps) {
    if (ch > t) break;
    beak = Math.max(beak, bump(t, ch, 0.24));
  }
  let wings = 0;
  for (const s of c.shakes) {
    const age = t - s;
    if (age < 0 || age > 1.2) continue;
    const env = Math.exp(-age * 3.5);
    roll += 6 * DEG * env * Math.sin(age * 2 * Math.PI * 2.6);
    wings = Math.max(wings, env);
  }
  // Wobbly while still wet, and a slow breath always.
  const wet = 1 - dryness(plan, t);
  roll += wet * 2.5 * DEG * (Math.sin(since * 1.3) * 0.6 + Math.sin(since * 2.9 + 1) * 0.4);
  pitch += 0.6 * DEG * Math.sin(since * 2.1);
  const m = multiply3(
    rotationAbout([0, 1, 0], yaw),
    multiply3(rotationAbout([1, 0, 0], -pitch), rotationAbout([0, 0, 1], roll)),
  );
  return { inverse: transpose3(m), lids, beak, wings };
};

/** Overall brightness: up from dim as an egg starts, down to dim in its fade. */
export const brightness = (plan: EggPlan, t: number): number => {
  const fade = findStage(plan, "fade")!;
  const up = plan.index === 0 ? 1 : smooth(t / 3);
  const down = 1 - smooth((t - fade.start) / (fade.end - fade.start));
  return 0.06 + 0.94 * Math.min(up, down);
};

/** How much of the candling look shows: all through the days, gone once the light is up. */
export const candleMix = (plan: EggPlan, t: number): number => {
  const candle = findStage(plan, "candle");
  if (!candle) return 0;
  return 1 - smooth((t - candle.end) / 3.5);
};

/** The incubation day, from 1 at the start of candling; days run on through the hatch. */
export const dayOf = (plan: EggPlan, t: number): number => {
  const candle = findStage(plan, "candle");
  if (!candle) return 21;
  return 1 + Math.min(t, candle.end) / plan.secondsPerDay;
};
