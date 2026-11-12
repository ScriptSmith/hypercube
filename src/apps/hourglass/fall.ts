/**
 * The ways the sand can come down the lower glass. The levels are the same in every one; only
 * the look of the fall changes.
 *
 * - `streams`  a few fine streams at uneven places round the ball, a mound under each
 * - `spiral`   the same streams winding round the ball on their way down, drifting slowly
 * - `trails`   single grains sliding down all round, each with a trail fading behind it
 * - `grains`   a rain of scattered grains, thicker near the collar
 * - `veil`     a thin sheet of sand all round, streaked and thinning as it falls
 */
import { type Phase, TURN_MS } from "./time";

export const FALLS = ["streams", "trails", "grains", "veil", "spiral"] as const;
export type FallId = (typeof FALLS)[number];

export const fallOf = (value: unknown): FallId => FALLS.find((f) => f === value) ?? "streams";

/** Styles drawn as the five streams, with a mound where each lands. */
export const isStreams = (fall: FallId): boolean => fall === "streams" || fall === "spiral";

/**
 * The shader's clock wraps this often, seconds, to keep its arithmetic exact. Whatever slides or
 * repeats in a fall does so a whole number of times in it, so the wrap never shows.
 */
export const TIME_WRAP_S = 3600;

/** The fall thins to nothing over this long before the sand runs out, seconds. */
export const LAST_S = 60;
/** What is already on the glass is followed down for this long after the run, seconds. */
export const TAIL_S = 8;
/** Longest time since the sand began to fall that the picture needs to know, seconds. */
const SETTLED_S = 600;

/** How far round the ball a spiral stream winds for each radian it runs down the glass. */
export const SPIRAL_TWIST = 1.7;
/** The spiral's streams go once round the ball in this long, seconds. */
export const SPIRAL_TURN_S = 400;

/** Radians a stream winds round the ball per radian of arc down the glass. */
export const twistOf = (fall: FallId): number => (fall === "spiral" ? SPIRAL_TWIST : 0);

/** How far round the ball a style's streams have drifted at `now`, radians. */
export const driftOf = (fall: FallId, now: number): number => {
  if (fall !== "spiral") return 0;
  const turn = SPIRAL_TURN_S * 1000;
  return ((((now % turn) + turn) % turn) / turn) * 2 * Math.PI;
};

export interface Fall {
  /** Sand is on the lower glass, or could be: during a run once the glass is upright, and just after. */
  on: boolean;
  /** Seconds until the sand runs out; below zero once it has. */
  remaining: number;
  /** Seconds since the sand began to fall. */
  since: number;
  /** How much leaves the collar now: 1 through the run, thinning to 0 over the last minute. */
  feed: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * How strongly sand that left the collar `ago` seconds before was being fed, as the shader
 * works it out for every point of the glass: none from before the sand began to fall, and less
 * and less through the last minute.
 */
export const feedOf = (fall: Fall, ago = 0): number =>
  !fall.on || ago > fall.since ? 0 : clamp((fall.remaining + ago) / LAST_S, 0, 1);

export const fallAt = (now: number, phase: Phase): Fall => {
  const remaining = clamp((phase.endMs - now) / 1000, -TAIL_S, 86_400);
  const since = clamp((now - phase.startMs - TURN_MS) / 1000, 0, SETTLED_S);
  const on = phase.running ? phase.turn >= 1 : now - phase.endMs < TAIL_S * 1000;
  const fall = { on, remaining, since, feed: 0 };
  return { ...fall, feed: feedOf(fall) };
};
