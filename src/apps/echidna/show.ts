/**
 * What the sleeping echidna does, second by second: breathing in runs with pauses (as resting
 * and torpid echidnas do, sped up so people notice), the curl turning slowly, and now and then
 * a twitch of one patch of spines, a snuffle, a front claw flexing, a hind foot stretching out,
 * a flicker under the eyelids, or a stir that shifts the whole curl and settles. It never wakes.
 *
 * Pure and deterministic for a given random stream, so it can be tested and skipped forward.
 * Everything it keeps is bounded: at most `MAX_RIPPLES` twitches at once, and counters.
 */
import { type Mat3, multiply3, rotationAbout, transpose3, type Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";

export type Pace = "sleepy" | "restless";

export interface ShowOptions {
  /** Twitches, snuffles, stretches and stirs; breathing and the slow turn always run. */
  stirs: boolean;
  pace: Pace;
}

export const MAX_RIPPLES = 3;
/** No stir starts within this many seconds of the last one ending. */
export const STIR_GAP = 60;
export const STIR_LENGTH = 6;
export const RIPPLE_LENGTH = 2.2;
export const SNIFF_LENGTH = 1.6;
/** Sniffs a second during a snuffle, under three so nothing flickers. */
export const SNIFF_RATE = 2.4;

export interface Ripple {
  /** Centre on the body, unit. */
  at: Vec3;
  /** Seconds since it started. */
  age: number;
  /** Most the spines lift, radians. */
  lift: number;
  /** Radius of the patch, radians of the ball. */
  size: number;
}

interface Range {
  min: number;
  max: number;
}

/** Seconds between things, by pace. */
export interface Pacing {
  breath: Range;
  run: Range;
  pause: Range;
  sigh: Range;
  ripple: Range;
  sniff: Range;
  claw: Range;
  stretch: Range;
  lid: Range;
  stir: Range;
  /** Seconds for one slow turn of the curl. */
  turn: number;
}

export const PACING: Record<Pace, Pacing> = {
  sleepy: {
    breath: { min: 5, max: 6.8 },
    run: { min: 5, max: 11 },
    pause: { min: 4, max: 10 },
    sigh: { min: 150, max: 300 },
    ripple: { min: 7, max: 22 },
    sniff: { min: 10, max: 30 },
    claw: { min: 18, max: 45 },
    stretch: { min: 45, max: 120 },
    lid: { min: 20, max: 60 },
    stir: { min: 150, max: 330 },
    turn: 840,
  },
  restless: {
    breath: { min: 3.8, max: 5 },
    run: { min: 6, max: 14 },
    pause: { min: 2, max: 6 },
    sigh: { min: 90, max: 180 },
    ripple: { min: 3, max: 10 },
    sniff: { min: 5, max: 15 },
    claw: { min: 10, max: 25 },
    stretch: { min: 25, max: 70 },
    lid: { min: 10, max: 30 },
    stir: { min: 70, max: 160 },
    turn: 540,
  },
};

export interface Counts {
  breaths: number;
  ripples: number;
  sniffs: number;
  claws: number;
  stretches: number;
  lids: number;
  stirs: number;
}

export type Event = "ripple" | "sniff" | "claw" | "stretch" | "lid" | "stir";

export interface Show {
  readonly time: number;
  /** How far the spines are lifted by breath, 0 at rest, about 1 in a breath, more in a sigh. */
  readonly breath: number;
  /** Its rate of change, per second. */
  readonly breathRate: number;
  readonly ripples: readonly Ripple[];
  /** Spines bristling in a stir, 0 to 1. */
  readonly bristle: number;
  /** Turn of the curl about the vertical, radians in [0, 2π). */
  readonly yaw: number;
  /** Lean of the curl, radians about the x and z axes. */
  readonly tilt: readonly [number, number];
  /** Snuffle: side wag of the snout tip, how far it pushes out, how open the nostrils are. */
  readonly snout: readonly [number, number, number];
  /** Front claws curling, left and right, 0 to 1. */
  readonly claws: readonly [number, number];
  /** Hind feet stretched out, left and right, 0 to 1; and their toes spread, 0 to 1. */
  readonly hind: readonly [number, number, number];
  /** Eyelid flicker, -1 to 1. */
  readonly lid: number;
  /** The snout tucked in during a stir, 0 to 1. */
  readonly tuck: number;
  readonly counts: Readonly<Counts>;
  readonly options: ShowOptions;
  /** Seconds until each kind of event is next due. */
  due(): Record<Event | "breath", number>;
  step(dt: number): void;
  /** Start an event now, if it can start (a stir never within `STIR_GAP` of the last). */
  trigger(kind: Event): boolean;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
/** Rises over the first `rise` of 0..1 and falls over the last `fall`. */
const envelope = (t: number, rise: number, fall: number) =>
  t <= 0 || t >= 1 ? 0 : Math.min(smooth(t / rise), smooth((1 - t) / fall));

/** One breath: in over 40 %, out over the rest. */
export const breathCurve = (u: number): number =>
  u < 0.4
    ? (1 - Math.cos((Math.PI * u) / 0.4)) / 2
    : (1 + Math.cos((Math.PI * (u - 0.4)) / 0.6)) / 2;

/** World to body: the curl turned about the vertical and leaning a little. */
export const spinOf = (yaw: number, tilt: readonly [number, number]): Mat3 =>
  transpose3(
    multiply3(
      rotationAbout([0, 1, 0], yaw),
      multiply3(rotationAbout([1, 0, 0], tilt[0]), rotationAbout([0, 0, 1], tilt[1])),
    ),
  );

export const createShow = (rng: Rng, options: ShowOptions): Show => {
  const pace = PACING[options.pace];
  const pick = (r: Range) => rng.range(r.min, r.max);
  const counts: Counts = {
    breaths: 0,
    ripples: 0,
    sniffs: 0,
    claws: 0,
    stretches: 0,
    lids: 0,
    stirs: 0,
  };
  let time = 0;

  // Breathing.
  let inRun = true;
  let runLeft = Math.round(pick(pace.run));
  let phase = rng.next() * 0.3;
  let period = pick(pace.breath);
  let depth = rng.range(0.85, 1.1);
  let pauseLeft = 0;
  let nextSigh = pick(pace.sigh);
  let breath = 0;
  let breathRate = 0;

  // The slow turn and the lean it wanders through.
  let yaw = rng.next() * TAU;
  const wobble = [rng.next() * TAU, rng.next() * TAU, rng.next() * TAU, rng.next() * TAU];
  let stirYaw = 0;
  let stirTilt: [number, number] = [0, 0];
  let fromYaw = 0;
  let fromTilt: [number, number] = [0, 0];
  let toYaw = 0;
  let toTilt: [number, number] = [0, 0];

  const ripples: Ripple[] = [];
  const at = (r: Range) => time + pick(r);
  const next: Record<Event, number> = {
    ripple: at(pace.ripple),
    sniff: at(pace.sniff),
    claw: at(pace.claw),
    stretch: at(pace.stretch),
    lid: at(pace.lid),
    stir: Math.max(STIR_GAP, at(pace.stir)),
  };

  let sniffAge = -1;
  let clawAge = -1;
  let clawSide = 0;
  let stretchAge = -1;
  let stretchSide = 0;
  let stretchHold = 2;
  let lidAge = -1;
  let stirAge = -1;
  let lastStirEnd = -Infinity;

  const outputs = {
    snout: [0, 0, 0] as [number, number, number],
    claws: [0, 0] as [number, number],
    hind: [0, 0, 0] as [number, number, number],
    tilt: [0, 0] as [number, number],
    lid: 0,
    tuck: 0,
    bristle: 0,
  };

  /** A point for a twitch, on the lower two thirds of the body where people see it. */
  const twitchSpot = (): Vec3 => {
    const y = rng.range(-0.75, 0.5);
    const r = Math.sqrt(1 - y * y);
    const a = rng.next() * TAU;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };

  const start = (kind: Event): boolean => {
    switch (kind) {
      case "ripple":
        if (ripples.length >= MAX_RIPPLES) return false;
        ripples.push({
          at: twitchSpot(),
          age: 0,
          lift: rng.range(0.16, 0.32),
          size: rng.range(0.22, 0.4),
        });
        counts.ripples++;
        return true;
      case "sniff":
        if (sniffAge >= 0) return false;
        sniffAge = 0;
        counts.sniffs++;
        return true;
      case "claw":
        if (clawAge >= 0) return false;
        clawAge = 0;
        clawSide = rng.int(2);
        counts.claws++;
        return true;
      case "stretch":
        if (stretchAge >= 0) return false;
        stretchAge = 0;
        stretchSide = rng.int(2);
        stretchHold = rng.range(1.2, 3);
        counts.stretches++;
        return true;
      case "lid":
        if (lidAge >= 0) return false;
        lidAge = 0;
        counts.lids++;
        return true;
      case "stir":
        if (stirAge >= 0 || time < lastStirEnd + STIR_GAP) return false;
        stirAge = 0;
        fromYaw = stirYaw;
        fromTilt = [...stirTilt];
        toYaw = stirYaw + rng.range(0.25, 0.6) * (rng.next() < 0.5 ? -1 : 1);
        toTilt = [rng.range(-0.09, 0.09), rng.range(-0.09, 0.09)];
        counts.stirs++;
        // A stir comes with a deep breath.
        inRun = true;
        phase = 0;
        period = pick(pace.breath) * 1.3;
        depth = 1.5;
        return true;
    }
  };

  const stepBreath = (dt: number) => {
    const before = breath;
    if (inRun) {
      phase += dt / period;
      if (phase >= 1) {
        counts.breaths++;
        phase -= 1;
        runLeft--;
        if (runLeft <= 0) {
          inRun = false;
          pauseLeft = pick(pace.pause);
          phase = 0;
        } else {
          period = pick(pace.breath);
          depth = rng.range(0.85, 1.1);
          if (time >= nextSigh) {
            nextSigh = time + pick(pace.sigh);
            depth = 1.6;
            period *= 1.4;
          }
        }
      }
      breath = inRun ? depth * breathCurve(phase) : 0;
    } else {
      breath = 0;
      pauseLeft -= dt;
      if (pauseLeft <= 0) {
        inRun = true;
        runLeft = Math.round(pick(pace.run));
        phase = 0;
        period = pick(pace.breath);
        depth = rng.range(0.85, 1.1);
      }
    }
    breathRate = dt > 0 ? (breath - before) / dt : 0;
  };

  const step = (dt: number) => {
    if (!(dt > 0)) return;
    time += dt;
    stepBreath(dt);

    yaw = (yaw + (dt * TAU) / pace.turn) % TAU;

    if (options.stirs) {
      for (const kind of Object.keys(next) as Event[]) {
        if (time < next[kind]) continue;
        start(kind);
        next[kind] = at(pace[kind]);
        if (kind === "stir") next.stir = Math.max(next.stir, time + STIR_LENGTH + STIR_GAP);
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]!;
      r.age += dt;
      if (r.age > RIPPLE_LENGTH) ripples.splice(i, 1);
    }

    // Snuffle: a few quick sniffs, the tip wagging and pushing out, nostrils opening.
    outputs.snout[0] = 0;
    outputs.snout[1] = 0;
    outputs.snout[2] = 0;
    if (sniffAge >= 0) {
      sniffAge += dt;
      const e = envelope(sniffAge / SNIFF_LENGTH, 0.2, 0.35);
      const beat = Math.sin(TAU * SNIFF_RATE * sniffAge);
      outputs.snout[0] = e * beat * 0.6;
      outputs.snout[1] = e * (0.6 + 0.4 * beat);
      outputs.snout[2] = e * (0.5 + 0.5 * beat);
      if (sniffAge > SNIFF_LENGTH) sniffAge = -1;
    }

    outputs.claws[0] = 0;
    outputs.claws[1] = 0;
    if (clawAge >= 0) {
      clawAge += dt;
      outputs.claws[clawSide] = envelope(clawAge / 1.4, 0.35, 0.5);
      if (clawAge > 1.4) clawAge = -1;
    }

    outputs.hind[0] = 0;
    outputs.hind[1] = 0;
    outputs.hind[2] = 0;
    if (stretchAge >= 0) {
      stretchAge += dt;
      const total = 1.8 + stretchHold + 2;
      const out = smooth(stretchAge / 1.8) * (1 - smooth((stretchAge - 1.8 - stretchHold) / 2));
      outputs.hind[stretchSide] = out;
      outputs.hind[2] = out * (0.5 + 0.5 * Math.sin(Math.max(0, stretchAge - 1.4) * 2.2));
      if (stretchAge > total) stretchAge = -1;
    }

    outputs.lid = 0;
    if (lidAge >= 0) {
      lidAge += dt;
      outputs.lid = envelope(lidAge / 0.9, 0.2, 0.3) * Math.sin(TAU * 2.6 * lidAge);
      if (lidAge > 0.9) lidAge = -1;
    }

    outputs.bristle = 0;
    outputs.tuck = 0;
    if (stirAge >= 0) {
      stirAge += dt;
      const k = smooth((stirAge - 0.6) / 4.2);
      stirYaw = fromYaw + (toYaw - fromYaw) * k;
      stirTilt = [
        fromTilt[0] + (toTilt[0] - fromTilt[0]) * k,
        fromTilt[1] + (toTilt[1] - fromTilt[1]) * k,
      ];
      outputs.bristle = envelope(stirAge / STIR_LENGTH, 0.12, 0.6);
      outputs.tuck = envelope(stirAge / STIR_LENGTH, 0.1, 0.5);
      if (stirAge > STIR_LENGTH) {
        stirAge = -1;
        lastStirEnd = time;
        stirYaw %= TAU;
      }
    }

    // A slow lean that never repeats exactly, a few degrees at most.
    const w = time / pace.turn;
    outputs.tilt[0] =
      stirTilt[0] +
      0.035 * Math.sin(TAU * w * 1.7 + wobble[0]!) +
      0.02 * Math.sin(TAU * w * 4.3 + wobble[1]!);
    outputs.tilt[1] =
      stirTilt[1] +
      0.035 * Math.sin(TAU * w * 2.3 + wobble[2]!) +
      0.02 * Math.sin(TAU * w * 3.1 + wobble[3]!);
  };

  return {
    get time() {
      return time;
    },
    get breath() {
      return breath;
    },
    get breathRate() {
      return breathRate;
    },
    ripples,
    get bristle() {
      return outputs.bristle;
    },
    get yaw() {
      return (((yaw + stirYaw) % TAU) + TAU) % TAU;
    },
    tilt: outputs.tilt,
    snout: outputs.snout,
    claws: outputs.claws,
    hind: outputs.hind,
    get lid() {
      return outputs.lid;
    },
    get tuck() {
      return outputs.tuck;
    },
    counts,
    options,
    due() {
      const out = { breath: inRun ? (1 - phase) * period : pauseLeft } as Record<
        Event | "breath",
        number
      >;
      for (const kind of Object.keys(next) as Event[]) out[kind] = next[kind] - time;
      return out;
    },
    step,
    trigger: start,
  };
};
