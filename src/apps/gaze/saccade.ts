/**
 * One saccade: how long it takes, how fast it goes and its time course, from the main sequence
 * (`MAIN_SEQUENCE` in `physiology.ts`).
 *
 * Duration is linear in amplitude and peak speed is twice the mean speed, as for a raised-cosine
 * profile, until it reaches the measured ceiling, after which the duration stretches instead. The
 * profile is two half raised-cosines: speed rises for a fraction s of the duration and falls for
 * the rest, so it starts and ends at rest with no jolt. Big saccades peak early (s falls from 0.45
 * to 0.2) and spend longer slowing down.
 */
import { MAIN_SEQUENCE, type MainSequence } from "./physiology";

/** Duration in seconds of a saccade of `amp` degrees; `speed` below 1 is a tired eye. */
export const saccadeDuration = (
  amp: number,
  speed = 1,
  ms: MainSequence = MAIN_SEQUENCE,
): number => {
  const a = Math.max(0, amp);
  const linear = (ms.intercept + ms.slope * a) / 1000;
  // Peak speed is 2A/D; once that would pass the ceiling, the ceiling sets the duration.
  return Math.max(linear, (2 * a) / ms.vmax) / speed;
};

/** Peak angular speed in degrees a second of a saccade of `amp` degrees. */
export const peakVelocity = (amp: number, speed = 1, ms: MainSequence = MAIN_SEQUENCE): number => {
  const a = Math.max(0, amp);
  const d = saccadeDuration(a, speed, ms);
  return d > 0 ? (2 * a) / d : 0;
};

/** The fraction of its duration a saccade of `amp` degrees spends speeding up. */
export const peakTime = (amp: number, ms: MainSequence = MAIN_SEQUENCE): number => {
  const s = ms.skewSmall - ms.skewSlope * (Math.max(0, amp) - ms.skewFrom);
  return Math.max(ms.skewLarge, Math.min(ms.skewSmall, s));
};

export interface Profile {
  /** Degrees. */
  readonly amp: number;
  /** Seconds. */
  readonly duration: number;
  /** Degrees a second. */
  readonly peak: number;
  /** Fraction of its duration spent speeding up. */
  readonly rise: number;
  /** Fraction of the amplitude covered at `t` seconds after the start, 0 to 1. */
  at(t: number): number;
  /** Speed in degrees a second at `t` seconds after the start. */
  speed(t: number): number;
}

/** A saccade's time course. */
export const saccadeProfile = (
  amp: number,
  speed = 1,
  ms: MainSequence = MAIN_SEQUENCE,
): Profile => {
  const duration = saccadeDuration(amp, speed, ms);
  const peak = peakVelocity(amp, speed, ms);
  const rise = peakTime(amp, ms);
  const up = rise * duration;
  const down = duration - up;
  const position = (t: number) => {
    if (t <= 0) return 0;
    if (t >= duration) return amp;
    if (t < up) return (peak / 2) * (t - (up / Math.PI) * Math.sin((Math.PI * t) / up));
    const u = t - up;
    return (peak / 2) * (up + u + (down / Math.PI) * Math.sin((Math.PI * u) / down));
  };
  return {
    amp,
    duration,
    peak,
    rise,
    at: (t) => (amp > 0 ? position(t) / amp : 1),
    speed(t) {
      if (t <= 0 || t >= duration) return 0;
      if (t < up) return (peak / 2) * (1 - Math.cos((Math.PI * t) / up));
      return (peak / 2) * (1 + Math.cos((Math.PI * (t - up)) / down));
    },
  };
};
