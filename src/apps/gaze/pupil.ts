/**
 * The pupil's diameter in millimetres over time. Light sets where it
 * heads, after the light reflex's latency; it narrows fast and widens slowly. Interest widens it
 * a few tenths of a millimetre, peaking a second or two later; something sudden (someone new,
 * catching someone's eye) adds a brief widening that peaks about a second later; a near look
 * narrows it after its own latency. The reflex sums light over half a second, so a short glance at
 * something bright narrows it only partly, and after a step up it narrows past its new size and
 * eases back. It never sits quite still: hippus wobbles it near 0.3 Hz, most at middling sizes,
 * and a drowsy eye adds slow swings of seconds to a minute.
 */
import type { Rng } from "../../core/types";
import { EYE_MM, lightPupil, PUPIL } from "./physiology";

export interface PupilInput {
  /** What the eye sees, cd/m². */
  luminance: number;
  /** Widening from interest or effort, mm. */
  effort: number;
  /** Narrowing for a near look, mm. */
  near: number;
  /** How drowsy, 0 to 1. */
  drowsy: number;
}

export interface Pupil {
  /** Diameter, mm. */
  readonly size: number;
  /** Where it is heading before unrest, mm. */
  readonly target: number;
  step(dt: number, input: PupilInput): void;
  /**
   * A brief widening that peaks `peak` mm above where it would be about a second later and is
   * gone in about two, as the pupil answers something sudden.
   */
  pulse(peak: number): void;
}

/**
 * The response to a sudden event is the Erlang kernel t^n exp(-n t / tmax): a
 * chain of n + 1 equal lags, each with time constant tmax / n, gives that shape exactly.
 */
const PULSE_STAGES = Math.round(PUPIL.pulseShape) + 1;
const PULSE_TAU = PUPIL.pulsePeak / Math.round(PUPIL.pulseShape);
/** The chain's peak for a unit step into its first stage. */
const PULSE_GAIN = (() => {
  const n = PULSE_STAGES - 1;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return (n ** n * Math.exp(-n)) / f;
})();

/** Steps of the latency line at 60 Hz; inputs older than this are dropped. */
const HISTORY = 64;

export const createPupil = (rng: Rng, start: PupilInput): Pupil => {
  // Ring buffers of past inputs, so each response answers what happened a moment ago.
  const light = new Float64Array(HISTORY);
  const efforts = new Float64Array(HISTORY);
  const nears = new Float64Array(HISTORY);
  const times = new Float64Array(HISTORY);
  let head = 0;
  let now = 0;
  light.fill(lightPupil(start.luminance));
  efforts.fill(start.effort);
  nears.fill(start.near);
  times.fill(-1e9);
  // Interest passes through two lags, so it rises smoothly and peaks late.
  let effortA = start.effort;
  let effortB = start.effort;
  let near = start.near;
  // The light reflex and the near response move `slow`, narrowing fast and widening slowly;
  // interest, sudden events and unrest are measured on the pupil itself and add on top.
  let slow = lightPupil(start.luminance) - start.near;
  let size = slow + start.effort;
  let target = size;
  // The light the reflex sums over half a second, and the size it has adapted to, which a step
  // up overshoots and then eases back towards.
  let seen = start.luminance;
  let adapted = lightPupil(start.luminance);
  let wobble = 0;
  let wobbleSpeed = 0;
  let fatigue = 0;
  const pulses = new Float64Array(PULSE_STAGES);

  /** The newest entry of `buf` at least `age` seconds old. */
  const delayed = (buf: Float64Array, age: number): number => {
    for (let k = 0; k < HISTORY; k++) {
      const i = (head - 1 - k + HISTORY) % HISTORY;
      if (now - times[i]! >= age) return buf[i]!;
    }
    return buf[head]!;
  };

  const gauss = () => {
    const u = Math.max(1e-12, rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
  };
  const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

  // Hippus: a damped oscillator near 0.3 Hz driven by noise, scaled to its spread.
  const w = 2 * Math.PI * PUPIL.hippusHz;
  const damping = 0.35;
  const drive = Math.sqrt(4 * damping * w ** 3);

  return {
    get size() {
      return size;
    },
    get target() {
      return target;
    },
    step(dt, input) {
      now += dt;
      seen += (input.luminance - seen) * ease(dt, PUPIL.integrate);
      light[head] = lightPupil(seen);
      efforts[head] = input.effort;
      nears[head] = input.near;
      times[head] = now;
      head = (head + 1) % HISTORY;
      const base = delayed(light, PUPIL.latency);
      const k = ease(dt, PUPIL.effortTau);
      effortA += (delayed(efforts, PUPIL.effortLatency) - effortA) * k;
      effortB += (effortA - effortB) * k;
      near += (delayed(nears, PUPIL.nearLatency) - near) * ease(dt, 0.5);
      // Each stage of the pulse chain eases towards the one before it.
      const kp = ease(dt, PULSE_TAU);
      for (let i = PULSE_STAGES - 1; i > 0; i--) pulses[i]! += (pulses[i - 1]! - pulses[i]!) * kp;
      pulses[0]! -= pulses[0]! * kp;
      // Unrest is largest at middling sizes and smaller when the pupil is very small or wide.
      const off = (slow - PUPIL.hippusMid) / PUPIL.hippusWidth;
      const spread = PUPIL.hippus * 2 ** -(off * off) * (1 + 2 * input.drowsy);
      wobbleSpeed += (-w * w * wobble - 2 * damping * w * wobbleSpeed) * dt;
      wobbleSpeed += drive * Math.sqrt(dt) * gauss();
      wobble += wobbleSpeed * dt;
      const a = Math.exp(-dt / PUPIL.fatigueTau);
      fatigue = fatigue * a + PUPIL.fatigue * input.drowsy * Math.sqrt(1 - a * a) * gauss();
      const pulse = pulses[PULSE_STAGES - 1]!;
      target = base + effortB - near + pulse;
      adapted += (base - adapted) * ease(dt, PUPIL.escape);
      const overshoot = PUPIL.overshoot * Math.min(0, base - adapted);
      const goal = Math.max(EYE_MM.pupilMin, Math.min(EYE_MM.pupilMax, base - near + overshoot));
      const narrowing = goal < slow;
      const tau = narrowing ? PUPIL.constrict : PUPIL.dilate;
      const cap = (narrowing ? PUPIL.constrictSpeed : PUPIL.dilateSpeed) * dt;
      const change = (goal - slow) * ease(dt, tau);
      slow += Math.max(-cap, Math.min(cap, change));
      const extra = effortB + pulse + wobble * spread + fatigue;
      size = Math.max(EYE_MM.pupilMin, Math.min(EYE_MM.pupilMax, slow + extra));
    },
    pulse(peak) {
      // A jump into the first stage that the chain carries to its last, peaking at `peak`.
      pulses[0]! += peak / PULSE_GAIN;
    },
  };
};
