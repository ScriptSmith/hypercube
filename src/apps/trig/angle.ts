/**
 * One circle's angle and what moves it. Pure, driven by explicit times in ms.
 *
 * - tour: nobody is turning it; it follows the slow turn (`tour`).
 * - held: a finger turns it, absolutely (dragging the point, scrubbing the graph) or by
 *   relative turns (the ring, the wheel). With `snap`, a slowly moving angle sticks at a
 *   nearby special angle like a detent.
 * - coast: the wheel was flicked; it slows gently and, with `snap`, settles onto a special
 *   angle ahead of it.
 * - goto: a tap on a tick mark, or the settling, eases it to an angle.
 * - hold: left alone after a touch, it stays put for `holdMs`.
 * - ease: then it blends back onto the slow turn over `easeMs`.
 *
 * Internally the angle is unwrapped, so turning past a full turn is continuous; `theta` is
 * wrapped into [0, 2π], keeping exactly 2π (360°) only when it was put there.
 */
import { DEG, TAU } from "./config";
import { nearestSpecial, nextSpecial, shortest, smoothstep, wrap } from "./maths";

export type AngleMode = "tour" | "held" | "coast" | "goto" | "hold" | "ease";

/** Below this speed (rad/s) a finger's angle sticks at special angles. */
export const DETENT_SPEED = 1.1;
/** How close (radians) a slowly moving angle must come to a special angle to stick. */
export const DETENT = 3 * DEG;
/** Let go this close to a special angle, slowly, and it settles there. */
export const RELEASE_SNAP = 5 * DEG;
/** A flick faster than this (rad/s) coasts. */
export const COAST_MIN = 1.5;
/** Coasting: speed decays with this time constant (s) plus a little constant friction. */
export const COAST_TAU = 1.1;
export const COAST_FRICTION = 0.35;
/** A coasting angle slower than this (rad/s) settles onto the next special angle, or stops. */
export const CAPTURE_SPEED = 0.9;
const STOP_SPEED = 0.06;
/** Seconds over which the finger speed is smoothed. */
const SPEED_TAU = 0.08;

export interface AngleOptions {
  snap: boolean;
  /** The slow turn, unwrapped and never decreasing, at time t (ms). */
  tour(t: number): number;
  holdMs: number;
  easeMs: number;
  gotoMs: number;
}

export interface Angle {
  /** In [0, 2π]. */
  readonly theta: number;
  readonly mode: AngleMode;
  /** Smoothed speed of the last finger or the coast, rad/s. */
  readonly speed: number;
  /** When a finger last moved it (ms), or -Infinity. */
  readonly lastTouch: number;
  /** True while it moves by itself or under a finger (not on the tour, not held still). */
  readonly moving: boolean;
  grab(t: number): void;
  /** A finger sets it absolutely. `continuous` keeps the turn count (the ring); a scrub doesn't. */
  setTo(raw: number, t: number, continuous: boolean): void;
  turnBy(d: number, t: number): void;
  /** The finger lifts; `omega` (rad/s) is a wheel's flick. */
  release(t: number, omega?: number): void;
  goTo(target: number, t: number): void;
  /** Join the slow turn: at once, or easing onto it. */
  follow(t: number, immediate?: boolean): void;
  step(t: number): void;
}

export const createAngle = (o: AngleOptions, t0 = 0): Angle => {
  let mode: AngleMode = "tour";
  let value = o.tour(t0);
  let raw = value;
  let speed = 0;
  let inputAt = Number.NEGATIVE_INFINITY;
  let lastTouch = Number.NEGATIVE_INFINITY;
  let omega = 0;
  let stepAt = t0;
  let since = t0;
  // goto
  let from = 0;
  let to = 0;
  let dur = 0;
  let easeOut = false;
  // ease
  let easeA = 0;
  let easePhi0 = 0;
  let easeTour0 = 0;
  /** Which way it last moved, so a full turn reads 360° when it got there going anticlockwise. */
  let dir = 0;
  const put = (v: number) => {
    if (Math.abs(v - value) > 1e-12) dir = v > value ? 1 : -1;
    value = v;
  };

  const detent = (r: number): number => {
    if (!o.snap || Math.abs(speed) >= DETENT_SPEED) return r;
    const s = nearestSpecial(r, DETENT);
    return s === null ? r : r + shortest(r, s);
  };

  const track = (next: number, t: number) => {
    const dt = (t - inputAt) / 1000;
    if (dt > 0 && dt < 0.5) {
      const v = (next - raw) / dt;
      speed += (v - speed) * (1 - Math.exp(-dt / SPEED_TAU));
    } else speed = 0;
    inputAt = t;
    lastTouch = t;
    raw = next;
    put(detent(raw));
  };

  const startGoto = (target: number, t: number, ms: number, out: boolean) => {
    mode = "goto";
    from = value;
    to = value + shortest(value, target);
    dur = Math.max(1, ms);
    easeOut = out;
    since = t;
  };

  const startHold = (t: number) => {
    mode = "hold";
    since = t;
    speed = 0;
    raw = value;
  };

  const startEase = (t: number) => {
    mode = "ease";
    since = t;
    easeA = value;
    easeTour0 = o.tour(t);
    easePhi0 = easeA + shortest(easeA, easeTour0);
  };

  const angle: Angle = {
    get theta() {
      const w = wrap(value);
      if (w < 1e-9 || TAU - w < 1e-9) return dir > 0 ? TAU : 0;
      return w;
    },
    get mode() {
      return mode;
    },
    get speed() {
      return mode === "coast" ? omega : speed;
    },
    get lastTouch() {
      return lastTouch;
    },
    get moving() {
      return mode === "held" || mode === "coast" || mode === "goto" || mode === "ease";
    },
    grab(t) {
      mode = "held";
      raw = value;
      speed = 0;
      omega = 0;
      inputAt = Number.NEGATIVE_INFINITY;
      lastTouch = t;
      since = t;
    },
    setTo(r, t, continuous) {
      if (mode !== "held") angle.grab(t);
      track(continuous ? raw + shortest(raw, r) : r, t);
    },
    turnBy(d, t) {
      if (mode !== "held") angle.grab(t);
      track(raw + d, t);
    },
    release(t, w) {
      if (mode !== "held") return;
      lastTouch = t;
      if (w !== undefined && Math.abs(w) >= COAST_MIN) {
        mode = "coast";
        omega = w;
        raw = value;
        since = t;
        return;
      }
      if (o.snap && Math.abs(speed) < DETENT_SPEED) {
        const s = nearestSpecial(value, RELEASE_SNAP);
        if (s !== null && Math.abs(shortest(value, s)) > 1e-9) {
          startGoto(s, t, o.gotoMs * 0.6, false);
          return;
        }
      }
      startHold(t);
    },
    goTo(target, t) {
      lastTouch = t;
      startGoto(target, t, o.gotoMs, false);
    },
    follow(t, immediate = false) {
      if (immediate) {
        mode = "tour";
        put(o.tour(t));
        raw = value;
        return;
      }
      if (mode === "tour" || mode === "ease") return;
      startEase(t);
    },
    step(t) {
      const dt = Math.max(0, Math.min(0.1, (t - stepAt) / 1000));
      stepAt = t;
      switch (mode) {
        case "tour":
          // Kept continuous with what was shown: only the change matters, not the turn count.
          put(value + shortest(value, o.tour(t)));
          raw = value;
          break;
        case "held":
          // A finger that has stopped moving is slow, so the detent can catch it.
          if (t - inputAt > 60) {
            speed *= Math.exp(-dt / SPEED_TAU);
            put(detent(raw));
          }
          break;
        case "coast": {
          raw += omega * dt;
          put(raw);
          const sign = Math.sign(omega);
          omega = omega * Math.exp(-dt / COAST_TAU) - sign * COAST_FRICTION * dt;
          if (Math.sign(omega) !== sign) omega = 0;
          if (o.snap && Math.abs(omega) < CAPTURE_SPEED) {
            const next = nextSpecial(value, sign || 1);
            const dist = Math.abs(next - value);
            const ms = Math.max(
              150,
              Math.min(1200, (3 * dist * 1000) / Math.max(0.2, Math.abs(omega))),
            );
            startGoto(next, t, ms, true);
          } else if (Math.abs(omega) < STOP_SPEED) {
            startHold(t);
          }
          break;
        }
        case "goto": {
          const u = Math.min(1, (t - since) / dur);
          const e = easeOut ? 1 - (1 - u) ** 3 : smoothstep(u);
          put(from + (to - from) * e);
          raw = value;
          if (u >= 1) startHold(t);
          break;
        }
        case "hold":
          if (t - since >= o.holdMs) startEase(t);
          break;
        case "ease": {
          const u = (t - since) / Math.max(1, o.easeMs);
          const phi = easePhi0 + (o.tour(t) - easeTour0);
          put(easeA + (phi - easeA) * smoothstep(u));
          raw = value;
          if (u >= 1) mode = "tour";
          break;
        }
      }
    },
  };
  return angle;
};
