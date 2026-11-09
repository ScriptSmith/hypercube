/**
 * One answer ball on a wall, shaken by hand rather than run by a plan. A finger on the ball holds
 * the plastic under it: drag and the ball turns with the finger, let go and it rocks back on its
 * weight. A press jolts it, and a flick upwards makes it hop. Any touch shakes the liquid: the die
 * is knocked off the glass, or stirred up out of the dark, and tumbles. Once the ball has nearly
 * stopped, the die rises with an answer, holds it, sinks, and "Ask a question" shows in the liquid
 * until the next touch.
 *
 * Stepped at a fixed rate. Every quantity is bounded and the die's rotation renormalised as it
 * goes, so it runs for days. Positions on the picture (x right, y up) and lengths are in ball
 * radii; the ball's frame and the window's are those of `motion.ts`, with one window.
 */
import { DEG, IDENTITY3, type Mat3, multiply3, rotationAbout, type Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";
import { type Bubbles, createBubbles } from "./bubbles";
import { facePose } from "./die";
import { DEEP, type DiePose, MID, poke, REST_Z } from "./motion";
import {
  dotQ,
  mat3FromQuat,
  mulQ,
  negQ,
  normQ,
  type Quat,
  quatAbout,
  quatFromMat3,
  slerpFixed,
} from "./rotation";
import type { Pace } from "./show";

export type WallStage = "wait" | "shake" | "rise" | "hold" | "sink";
export const WALL_STAGES: readonly WallStage[] = ["wait", "shake", "rise", "hold", "sink"];

interface WallTiming {
  rise: [number, number];
  longRise: [number, number];
  hold: [number, number];
  sink: [number, number];
}

/** On a wall the answer holds longer than on the sphere. */
export const WALL_TIMING: Record<Pace, WallTiming> = {
  calm: { rise: [2, 2.8], longRise: [3, 3.6], hold: [9, 12], sink: [1.4, 1.7] },
  lively: { rise: [1.4, 1.9], longRise: [2.2, 2.6], hold: [5, 7], sink: [0.9, 1.1] },
};

/** The ball's rocking on its weight, and how stiffly a finger holds it. */
const REST_HZ = 1.35;
const REST_DAMP = 0.16;
const HELD_HZ = 2.6;
const HELD_DAMP = 0.6;
/** The most a finger turns the ball, and the hardest it can be turned at all, radians. */
export const MAX_TILT = 0.38;
const HARD_TILT = 0.55;
const MAX_SPIN = 6;
/** The most a finger rolls the ball along the floor, ball radii. */
export const MAX_ROLL = 0.12;
const ROLL_GAIN = 0.28;
/** Gravity in ball radii a second squared, the biggest hop's speed, and the bounce kept. */
const GRAVITY = 6;
const MAX_HOP = 1;
const BOUNCE = 0.3;
/** How far a press turns the ball, radians per ball radius off centre, and in the middle. */
const PUSH = 0.25;
const PUSH_MIDDLE = 0.08;
/** Spinning faster than this knocks the die off the glass; below this the ball is settling. */
const KNOCK_SPIN = 1.4;
const CALM_SPIN = 0.9;
/** A shake lasts at least this long, and the ball is calm for this long before the die rises, s. */
const MIN_SHAKE = 0.7;
const CALM_FOR = 0.3;
/** Spinning faster than this during a shake makes the die arrive on an edge and roll flat. */
const LONG_SPIN = 3.5;
const MAX_DIE_SPIN = 11;
const MAX_SLOSH = 0.05;
const MAX_FINGERS = 10;
const MAX_KICKS = 8;

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const smootherstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** `max` times tanh(x / max): about x when small, never past max. */
const soft = (x: number, max: number) => max * Math.tanh(x / max);

const unitVector = (rng: Rng): Vec3 => {
  const z = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
};

/** The answer's resting pose against the glass, text upright. */
const restQuat = (answer: number): Quat => quatFromMat3(facePose(answer, 0));

interface Finger {
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** The turn its push alone gives: the side pressed goes back, a press in the middle tips it up. */
  pushX: number;
  pushY: number;
  person: boolean;
}

interface Kick {
  at: number;
  axis: Vec3;
  speed: number;
}

export interface WallBallOptions {
  rng: Rng;
  pace: Pace;
  prompt: boolean;
  /** The ball at rest, its window facing the eye (ball frame to venue). */
  rest: Mat3;
  /** Draws this ball's next answer from the deck the balls share. */
  deal(): number;
  /** Start already holding this answer, rather than waiting. */
  holding?: number;
}

export interface WallBallModel {
  readonly stage: WallStage;
  /** Seconds since the stage began. */
  readonly age: number;
  /** The answer shown or on its way, or the last one. */
  readonly answer: number;
  /** A hard shake: the die arrives on an edge and rolls flat. */
  readonly long: boolean;
  readonly fingers: number;
  /** Seconds since a person (not a bot) last touched it. */
  readonly sincePerson: number;
  /** Seconds since it last finished an answer and began to wait, or 0 while busy. */
  readonly waiting: number;
  /** A finger at (x, y) on the picture, ball radii from the ball's centre at rest. */
  press(id: number, x: number, y: number, person: boolean, vy?: number): void;
  move(id: number, x: number, y: number, vy?: number): void;
  release(id: number): void;
  /** A shake as a hand would give it, by itself or for admin. */
  jiggle(strength: number, long?: boolean): void;
  /** Let go of everything and come back to rest; an answer showing sinks. */
  reset(): void;
  step(dt: number): void;
  /** Ball frame to venue. */
  rotation(): Mat3;
  /** How far the centre has moved from rest along the wall and up, ball radii. */
  offset(): [number, number];
  /** How far the ball is turned from rest, radians. */
  tilt(): number;
  die(): DiePose;
  prompt(): number;
  slosh(): [number, number];
  /** The answer against the glass, or null. */
  showing(): number | null;
  readonly bubbles: Bubbles;
}

export const createWallBallModel = (opts: WallBallOptions): WallBallModel => {
  const { rng, rest } = opts;
  const timing = WALL_TIMING[opts.pace];
  const wRest = 2 * Math.PI * REST_HZ;
  const wHeld = 2 * Math.PI * HELD_HZ;
  const bubbles = createBubbles(rng.fork("bubbles"));
  const phase = rng.range(0, Math.PI * 2);

  let now = 0;
  let stage: WallStage = "wait";
  let age = 0;
  let length = 0;
  let answer = 0;
  let long = false;
  let sincePerson = Infinity;
  let waiting = 0;

  // The ball: a turn (rotation vector, venue frame), a roll along the floor and a hop.
  const th = [0, 0];
  const om = [0, 0];
  let roll = 0;
  let rollV = 0;
  let hop = 0;
  let hopV = 0;
  const fingers = new Map<number, Finger>();
  const kicks: Kick[] = [];

  // The die: its orientation in the window, its spin, depth and drift across the window.
  let q: Quat = quatFromMat3(facePose(0, 0));
  let spin: Vec3 = [0, 0, 0];
  let depth = DEEP;
  let xy: [number, number] = [0, 0];
  let calm = 0;
  let peak = 0;
  let from = { q, depth };
  let flip = false;
  let wobble = 0;
  let wobbleAngle = 0;
  /** When the rising die last touched the glass. */
  let touched = -Infinity;
  let shown: Mat3 = IDENTITY3;
  let drift: Vec3 = unitVector(rng);
  let driftRate = 0.12;
  let lastSwirl = -1;

  // The liquid's lag behind the window, and the prompt.
  const sl = [0, 0];
  const slV = [0, 0];
  let promptLevel = 0;

  const begin = (s: WallStage) => {
    stage = s;
    age = 0;
    if (s === "rise") {
      length = rng.range(...(long ? timing.longRise : timing.rise));
      answer = opts.deal();
      from = { q, depth };
      flip = dotQ(q, restQuat(answer)) < 0;
      wobble = (long ? rng.range(5, 7) : rng.range(2, 3.5)) * DEG;
      wobbleAngle = rng.range(0, Math.PI * 2);
    } else if (s === "hold") length = rng.range(...timing.hold);
    else if (s === "sink") {
      length = rng.range(...timing.sink);
      q = quatFromMat3(shown);
      from = { q, depth };
      drift = unitVector(rng);
      driftRate = rng.range(0.08, 0.2);
      spin = [drift[0] * driftRate, drift[1] * driftRate, drift[2] * driftRate];
    } else length = Infinity;
    if (s === "wait") waiting = 0;
  };

  const swirl = (strength: number) => {
    if (now - lastSwirl < 0.3) return;
    lastSwirl = now;
    bubbles.swirl(strength);
  };

  /** The die gets a push and the ball starts shaking, whatever it was doing. */
  const knock = (strength: number) => {
    const u = unitVector(rng);
    const k = 3 + 3 * Math.min(1.5, strength);
    spin = [spin[0] + u[0] * k, spin[1] + u[1] * k, spin[2] + u[2] * k];
    swirl(0.6 + 0.5 * Math.min(1, strength));
    if (stage === "shake") return;
    if (stage === "rise" || stage === "hold") q = quatFromMat3(shown);
    long = false;
    peak = 0;
    calm = 0;
    begin("shake");
  };

  if (opts.holding !== undefined) {
    answer = opts.holding;
    q = restQuat(answer);
    shown = mat3FromQuat(q);
    depth = 0;
    begin("hold");
    age = 3;
  }

  const turnStep = (dt: number) => {
    const held = fingers.size > 0;
    let tx = 0;
    let ty = 0;
    let rx = 0;
    if (held) {
      for (const f of fingers.values()) {
        tx += f.pushX - (f.y - f.y0);
        ty += f.pushY + (f.x - f.x0);
        rx += f.x - f.x0;
      }
      tx = soft(tx / fingers.size, MAX_TILT);
      ty = soft(ty / fingers.size, MAX_TILT);
      rx = soft((ROLL_GAIN * rx) / fingers.size, MAX_ROLL);
    }
    const w = held ? wHeld : wRest;
    const k = w * w;
    const c = 2 * (held ? HELD_DAMP : REST_DAMP) * w;
    const target = [tx, ty];
    for (let i = 0; i < 2; i++) {
      om[i]! += (k * (target[i]! - th[i]!) - c * om[i]!) * dt;
      om[i] = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, om[i]!));
      th[i]! += om[i]! * dt;
    }
    const tl = Math.hypot(th[0]!, th[1]!);
    if (tl > HARD_TILT) {
      th[0] = (th[0]! * HARD_TILT) / tl;
      th[1] = (th[1]! * HARD_TILT) / tl;
      const out = (om[0]! * th[0]! + om[1]! * th[1]!) / HARD_TILT;
      if (out > 0) {
        om[0]! -= (out * th[0]!) / HARD_TILT;
        om[1]! -= (out * th[1]!) / HARD_TILT;
      }
    }
    rollV += (k * (rx - roll) - c * rollV) * dt;
    roll = Math.max(-2 * MAX_ROLL, Math.min(2 * MAX_ROLL, roll + rollV * dt));
    if (hop > 0 || hopV > 0) {
      hopV -= GRAVITY * dt;
      hop += hopV * dt;
      if (hop <= 0) {
        hop = 0;
        hopV = hopV < -0.25 ? -hopV * BOUNCE : 0;
        if (hopV > 0) knock(0.4);
      }
    }
  };

  const kickStep = () => {
    for (let i = kicks.length - 1; i >= 0; i--) {
      const kick = kicks[i]!;
      if (kick.at > now) continue;
      om[0]! += kick.axis[0] * kick.speed;
      om[1]! += kick.axis[1] * kick.speed;
      knock(Math.abs(kick.speed));
      kicks.splice(i, 1);
    }
  };

  const spinDie = (dt: number) => {
    const s = Math.hypot(spin[0], spin[1], spin[2]);
    if (s > 1e-6) q = normQ(mulQ(quatAbout(spin, s * dt), q));
  };

  const dieStep = (dt: number, dOmega: [number, number]) => {
    const fall = (tau: number) => Math.exp(-dt / tau);
    switch (stage) {
      case "wait":
      case "sink": {
        if (stage === "wait") depth += (DEEP - depth) * (1 - fall(1.5));
        spinDie(dt);
        break;
      }
      case "shake": {
        // The die lags as the ball's turn speeds up or slows: inertia in the liquid.
        spin = [spin[0] - dOmega[0] * 0.8, spin[1] - dOmega[1] * 0.8, spin[2]];
        const f = fall(0.9);
        spin = [spin[0] * f, spin[1] * f, spin[2] * f];
        depth += (MID - depth) * (1 - fall(0.35));
        spinDie(dt);
        break;
      }
      case "rise": {
        const f = fall(0.45);
        spin = [spin[0] * f, spin[1] * f, spin[2] * f];
        spinDie(dt);
        break;
      }
      default:
        break;
    }
    const s = Math.hypot(spin[0], spin[1], spin[2]);
    if (s > MAX_DIE_SPIN) spin = spin.map((v) => (v * MAX_DIE_SPIN) / s) as unknown as Vec3;
    // Drifting about the depths, still against the glass.
    const free = stage === "wait" || stage === "shake" || stage === "sink";
    const wx = free ? 0.035 * Math.sin(0.31 * now + phase) + sl[0]! * 1.5 : 0;
    const wy = free ? 0.03 * Math.sin(0.23 * now + 1.3 * phase) + sl[1]! * 1.5 : 0;
    const a = 1 - fall(stage === "rise" ? 0.35 : 0.6);
    xy = [xy[0] + (wx - xy[0]) * a, xy[1] + (wy - xy[1]) * a];
  };

  const contactAt = () => (long ? 0.62 : 0.82);

  /** The die's orientation shown now, and its depth, for the stages that follow the plan. */
  const pose = () => {
    const u = length > 0 && Number.isFinite(length) ? Math.min(1, age / length) : 0;
    const wob = (since: number) => {
      if (!(since > 0 && since < 8)) return IDENTITY3;
      const decay = long ? 0.9 : 0.5;
      const a = wobble * Math.exp(-since / decay) * Math.sin(2 * Math.PI * 1.6 * since);
      return rotationAbout([Math.cos(wobbleAngle), Math.sin(wobbleAngle), 0], a);
    };
    if (stage === "rise") {
      const r = restQuat(answer);
      const e = smootherstep(u / (long ? 0.97 : 0.86));
      const cu = contactAt();
      if (u >= cu && touched < now - age) touched = now;
      shown = multiply3(wob(now - touched), mat3FromQuat(slerpFixed(q, flip ? negQ(r) : r, e)));
      if (u < cu) depth = from.depth * Math.pow(1 - u / cu, 2.2);
      else {
        const v = (u - cu) / (1 - cu);
        depth = (long ? 0.03 : 0.012) * Math.sin(Math.PI * v) * (1 - v);
      }
    } else if (stage === "hold") {
      const bob = rotationAbout(
        [Math.cos(wobbleAngle + 1.7), Math.sin(wobbleAngle + 1.7), 0],
        0.6 * DEG * Math.sin(2 * Math.PI * 0.13 * age),
      );
      shown = multiply3(bob, multiply3(wob(now - touched), facePose(answer, 0)));
      depth = 0.004 * 0.5 * (1 - Math.cos((2 * Math.PI * age) / 3.4));
    } else if (stage === "sink") {
      shown = mat3FromQuat(q);
      depth = from.depth + (DEEP - from.depth) * smoothstep(u);
    } else shown = mat3FromQuat(q);
  };

  const sloshStep = (dt: number) => {
    // The window's centre moves with the turn and the roll; the liquid lags behind it.
    const vx = om[1]! + rollV;
    const vy = -om[0]! + hopV;
    const target = [-0.014 * vx, -0.014 * vy];
    const w = 2 * Math.PI * 2;
    for (let i = 0; i < 2; i++) {
      slV[i]! += (w * w * (target[i]! - sl[i]!) - 2 * 0.3 * w * slV[i]!) * dt;
      sl[i]! += slV[i]! * dt;
    }
    const l = Math.hypot(sl[0]!, sl[1]!);
    if (l > MAX_SLOSH) {
      sl[0] = (sl[0]! * MAX_SLOSH) / l;
      sl[1] = (sl[1]! * MAX_SLOSH) / l;
    }
  };

  const rotation = (): Mat3 => {
    const turn = Math.hypot(th[0]!, th[1]!, roll);
    if (turn < 1e-9) return rest;
    return multiply3(rotationAbout([th[0]!, th[1]!, -roll], turn), rest);
  };

  return {
    get stage() {
      return stage;
    },
    get age() {
      return age;
    },
    get answer() {
      return answer;
    },
    get long() {
      return long;
    },
    get fingers() {
      return fingers.size;
    },
    get sincePerson() {
      return sincePerson;
    },
    get waiting() {
      return stage === "wait" ? waiting : 0;
    },
    press(id, x, y, person, vy = 0) {
      if (fingers.size >= MAX_FINGERS && !fingers.has(id)) return;
      // Pushing one side of the ball back turns its front that way.
      const px = x - roll;
      const py = y - hop;
      const off = Math.min(1, Math.hypot(px, py));
      const pushX = -py * PUSH - PUSH_MIDDLE * (1 - off);
      const pushY = px * PUSH;
      fingers.set(id, { x0: x, y0: y, x, y, pushX, pushY, person });
      if (person) sincePerson = 0;
      om[0]! += pushX * 6;
      om[1]! += pushY * 6;
      if (hop === 0) hopV = Math.max(hopV, 0.55 + Math.min(MAX_HOP - 0.55, Math.max(0, vy) * 0.2));
      knock(0.8);
    },
    move(id, x, y, vy = 0) {
      const f = fingers.get(id);
      if (!f) return;
      f.x = x;
      f.y = y;
      if (f.person) sincePerson = 0;
      // A flick upwards lifts the ball off the floor.
      if (vy > 2.5 && hop === 0) hopV = Math.min(MAX_HOP, 0.25 * vy);
    },
    release(id) {
      fingers.delete(id);
    },
    jiggle(strength, isLong = false) {
      const m = rng.range(-0.9, 0.9);
      const axis: Vec3 = [Math.cos(m), Math.sin(m), 0];
      const n = isLong ? 5 : 2 + rng.int(3);
      const gap = 1 / (2 * REST_HZ);
      kicks.length = 0;
      for (let i = 0; i < n && i < MAX_KICKS; i++) {
        const sign = i % 2 === 0 ? 1 : -1;
        const fade = i === 0 ? 1 : 1.6;
        kicks.push({ at: now + i * gap, axis, speed: sign * fade * 0.5 * strength });
      }
      if (isLong) {
        knock(strength);
        long = true;
      }
    },
    reset() {
      fingers.clear();
      kicks.length = 0;
      if (stage === "rise" || stage === "hold") {
        q = quatFromMat3(shown);
        begin("sink");
      } else if (stage === "shake") begin("sink");
    },
    step(dt) {
      now += dt;
      age += dt;
      if (Number.isFinite(sincePerson)) sincePerson += dt;
      if (stage === "wait") waiting += dt;
      const before: [number, number] = [om[0]!, om[1]!];
      kickStep();
      turnStep(dt);
      const dOmega: [number, number] = [om[0]! - before[0], om[1]! - before[1]];
      const speed = Math.hypot(om[0]!, om[1]!) + Math.abs(rollV) + Math.abs(hopV);
      if (stage !== "shake" && speed > KNOCK_SPIN && fingers.size > 0) knock(speed / 3);
      if (stage === "shake") {
        peak = Math.max(peak, speed);
        if (peak > LONG_SPIN) long = true;
        const still = speed < CALM_SPIN && hop === 0 && kicks.length === 0;
        calm = still ? calm + dt : 0;
        if (age >= MIN_SHAKE && calm >= CALM_FOR) begin("rise");
      } else if (stage === "rise" && age >= length) begin("hold");
      else if (stage === "hold" && age >= length) begin("sink");
      else if (stage === "sink" && age >= length) begin("wait");
      dieStep(dt, dOmega);
      sloshStep(dt);
      pose();
      const up = (() => {
        const r = rotation();
        // The room's up in the window's frame: the rotation's second row.
        return [r[3], r[4], r[5]] as const;
      })();
      bubbles.step(dt, up);
      const want =
        opts.prompt && stage === "wait" && age > 0.9 ? 0.8 + 0.2 * Math.sin(now * 1.6) : 0;
      promptLevel += (want - promptLevel) * (1 - Math.exp(-dt / (want > promptLevel ? 0.5 : 0.18)));
    },
    rotation,
    offset: () => [roll, hop],
    tilt: () => Math.hypot(th[0]!, th[1]!, roll),
    die() {
      const total = depth + poke(shown);
      return { rot: shown, pos: [xy[0], xy[1], REST_Z - total], depth: total, angle: 0 };
    },
    prompt: () => promptLevel,
    slosh: () => [sl[0]!, sl[1]!],
    showing: () => (stage === "hold" || (stage === "rise" && age > length * 0.8) ? answer : null),
    bubbles,
  };
};

/**
 * The deck the balls share: answers dealt in shuffled rounds, none that another ball shows or
 * that was dealt lately, so balls side by side never agree.
 */
export const createWallDeck = (
  rng: Rng,
  balls: number,
  deck: (rng: Rng, last: number) => number[],
  showing: () => readonly (number | null)[],
) => {
  let queue: number[] = [];
  const recent: number[] = [];
  const apart = Math.max(1, 2 * balls - 1);
  return {
    deal(): number {
      if (queue.length < 2 * balls)
        queue = queue.concat(deck(rng, recent[recent.length - 1] ?? -1));
      const avoid = new Set<number>([
        ...recent,
        ...showing().filter((a): a is number => a !== null),
      ]);
      const i = Math.max(
        0,
        queue.findIndex((a) => !avoid.has(a)),
      );
      const a = queue.splice(i, 1)[0]!;
      recent.push(a);
      if (recent.length > apart) recent.shift();
      return a;
    },
  };
};
