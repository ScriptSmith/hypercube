/**
 * One ball per button at a time. After a button takes a ball it refuses every touch for
 * `LIMIT.buttonMs`, wherever on it the touch lands, so a whole hand of fingers (or a slap) gives
 * one ball. A refused touch shows how long to wait. Each half of a pair, and each question in
 * `two`, has its own buttons.
 */
import { LIMIT } from "./config";

export type Offer = { ok: true } | { ok: false; wait: number };

export interface Limiter {
  /** A new touch on `button` at time `t` ms. */
  offer(button: number, t: number): Offer;
  reset(): void;
}

/** Buttons a limiter tracks; any more share the last slot. */
const MAX_BUTTONS = 32;

export const createLimiter = (buttonMs: number = LIMIT.buttonMs): Limiter => {
  const last = new Float64Array(MAX_BUTTONS).fill(-Infinity);
  return {
    offer(button, t) {
      const i = Math.min(MAX_BUTTONS - 1, Math.max(0, Math.floor(button)));
      const wait = buttonMs - (t - last[i]!);
      if (wait > 0) return { ok: false, wait };
      last[i] = t;
      return { ok: true };
    },
    reset() {
      last.fill(-Infinity);
    },
  };
};
