/**
 * The lone visitor's helper (duo only). When one pad has been held for a few seconds and nobody
 * has touched the other, a faint helper flies the other engine just to keep the craft upright.
 * It never steers, reacts late and wobbles a little, so it can't land well on its own; a
 * landing it helped with scores at most two stars. Pure.
 */
import { HELPER_AFTER_MS, HELPER_LEAVE_MS, HELPER_UNTOUCHED_MS } from "./config";
import { type Craft, wrap } from "./craft";

/** 0 is the left pad, 1 the right. */
export type Side = 0 | 1;

export interface Helper {
  /** The pad the helper flies, or null when it is off. */
  side: Side | null;
  firing: boolean;
  /** When each pad's current hold began, or -1 while it isn't held. */
  holdFrom: [number, number];
  /** When each pad was last held. */
  heldAt: [number, number];
  /** Run time of the next decision; it only looks every so often. */
  nextLook: number;
  /** Run time it last flew, for capping a landing's stars. */
  flewAt: number;
}

/** Seconds between the helper's decisions. */
const LOOK_S = 0.1;
/** A landing within this long of the helper flying counts as helped. */
export const HELPED_S = 8;

export const createHelper = (): Helper => ({
  side: null,
  firing: false,
  holdFrom: [-1, -1],
  heldAt: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  nextLook: 0,
  flewAt: Number.NEGATIVE_INFINITY,
});

/** A new run: forget the hold timers' starts but remember who has been touching what. */
export const resetHelper = (h: Helper): void => {
  h.side = null;
  h.firing = false;
  h.nextLook = 0;
  h.flewAt = Number.NEGATIVE_INFINITY;
};

/**
 * Update from the pads' held state at `now` (ms) and decide whether the helper's engine fires.
 * `t` is run time in seconds.
 */
export const updateHelper = (
  h: Helper,
  held: readonly [boolean, boolean],
  now: number,
  c: Craft,
  t: number,
): void => {
  for (const i of [0, 1] as const) {
    if (held[i]) {
      h.heldAt[i] = now;
      if (h.holdFrom[i] < 0) h.holdFrom[i] = now;
    } else h.holdFrom[i] = -1;
  }
  if (h.side !== null) {
    const human = h.side === 0 ? 1 : 0;
    // Someone took the helper's pad, or the visitor has gone.
    if (held[h.side] || now - h.heldAt[human] > HELPER_LEAVE_MS) {
      h.side = null;
      h.firing = false;
    }
  } else {
    for (const i of [0, 1] as const) {
      const other = i === 0 ? 1 : 0;
      const holding = h.holdFrom[i] >= 0 && now - h.holdFrom[i] >= HELPER_AFTER_MS;
      if (holding && !held[other] && now - h.heldAt[other] >= HELPER_UNTOUCHED_MS) {
        h.side = other;
        h.nextLook = t;
        break;
      }
    }
  }
  if (h.side === null) return;
  h.flewAt = t;
  if (t < h.nextLook) return;
  h.nextLook = t + LOOK_S;
  // The visitor's engine turns the craft towards `dir`; the helper fires to turn it back.
  const dir = h.side === 1 ? 1 : -1;
  const wobble = 0.05 * Math.sin(0.9 * t);
  const s = dir * (wrap(c.a) - wobble) + 0.5 * dir * c.w;
  h.firing = s > (h.firing ? 0 : 0.04);
};
