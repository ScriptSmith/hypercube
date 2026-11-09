/**
 * The autopilot: a simple guidance law aiming for one landing pad. It flies the attract mode
 * directly and drives the bots' fingers. It works out throttles; engines are on or off, so
 * `pulse` turns a throttle into presses over a short period, the way a person taps a pad. Pure.
 */
import type { Rng } from "../../core/types";
import { type Craft, FOOT, type Physics, wrap } from "./craft";
import { type LandingPad, peakBetween, type Terrain } from "./terrain";

export interface Plan {
  pad: LandingPad;
  /** Comes in too fast at the end, so attract shows a bump now and then. */
  careless: boolean;
}

export interface Command {
  /** Duo throttles, 0 to 1. */
  left: number;
  right: number;
  /** Crew main engine throttle, 0 to 1. */
  main: number;
  /** Crew turn: negative turns left, positive right, -1 to 1. */
  turn: number;
}

/** Press period for turning throttles into taps, seconds. */
export const PULSE_S = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pick a pad: the better and the nearer pads more often. */
export const choosePlan = (t: Terrain, rng: Rng, S: number, carelessness = 0): Plan | null => {
  if (t.pads.length === 0) return null;
  const weight = (p: LandingPad) => {
    const dx = (p.x0 + p.x1) / 2 - t.spawn.x;
    return (p.stars === 3 ? 0.45 : p.stars === 2 ? 0.3 : 0.25) / (1 + (dx / (3 * S)) ** 2);
  };
  const total = t.pads.reduce((n, p) => n + weight(p), 0);
  let r = rng.next() * total;
  let pad = t.pads[0]!;
  for (const p of t.pads) {
    r -= weight(p);
    if (r <= 0) {
      pad = p;
      break;
    }
  }
  return { pad, careless: rng.next() < carelessness };
};

export const steer = (
  c: Craft,
  t: Terrain,
  p: Physics,
  plan: Plan,
  wind: number,
  fuel = 1,
): Command => {
  const S = p.S;
  const q = p.q;
  const pad = plan.pad;
  const px = (pad.x0 + pad.x1) / 2;
  const half = (pad.x1 - pad.x0) / 2;
  const footY = c.y + FOOT.y * S;
  const h = pad.y - footY;
  const dx = px - c.x;
  // Feet are FOOT.x either side of the centre; keep them well inside the pad.
  const room = Math.max(0.04 * S, half - FOOT.x * S - 0.08 * S);
  const over = Math.abs(dx) < half;
  const aligned = Math.abs(dx) < room * 0.8;
  const vt = p.g / p.drag;

  // Sideways: a speed towards the pad, and the tilt that gets there.
  let vxDes = clamp(dx * 0.3, -48 * q, 48 * q);
  if (over && h < 1.5 * S) vxDes = clamp(dx * 0.6, -12 * q, 12 * q);
  const lateral = (vxDes - c.vx) / 1.2 - p.dragX * (wind - c.vx);
  const lean = over && h < 0.6 * S ? 0.16 : over ? 0.35 : 0.52;
  const aDes = clamp(Math.atan(lateral / p.g), -lean, lean);

  // Down: cruise above the hills until over the pad, then slow down towards it, hovering
  // low until the feet are well inside the pad (hovering also keeps the thrust for steering).
  let vyDes: number;
  if (over) {
    vyDes = clamp(0.2 * h + 10 * q, 12 * q, 0.85 * vt);
    if (!aligned && h < 2.5 * S && fuel > 0.25) {
      vyDes = Math.min(vyDes, h < 0.9 * S ? -6 * q : h < 1.3 * S ? 0 : 6 * q);
    }
    if (plan.careless && h < 2 * S) vyDes = Math.max(vyDes, 1.7 * p.landVy);
  } else {
    const ridge = Math.min(peakBetween(t, c.x - 0.6 * S, px + Math.sign(dx) * 0.6 * S), pad.y);
    const clear = ridge - 1.3 * S - footY;
    vyDes = clamp(0.25 * clear, -22 * q, 0.7 * vt);
  }
  const ayDes = (vyDes - c.vy) / 0.7;
  const a = wrap(c.a);
  const need = (p.g - p.drag * c.vy - ayDes) / Math.max(0.45, Math.cos(a));
  // Against the spin damping and, roughly, the assist's levelling, which acts while both fire.
  const alpha = 5 * (aDes - a) - Math.max(0, 3.2 - p.spin) * c.w + 0.6 * p.level * a;

  if (p.variant === "crew") {
    return {
      left: 0,
      right: 0,
      main: clamp(need / p.main, 0, 1),
      turn: clamp(alpha / p.turn, -1, 1),
    };
  }
  const u = clamp(need / (2 * p.engine), 0, 1);
  const d = clamp(alpha / p.torque, -1, 1);
  let left = u + d / 2;
  let right = u - d / 2;
  if (left > 1) {
    right -= left - 1;
    left = 1;
  }
  if (right > 1) {
    left -= right - 1;
    right = 1;
  }
  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right < 0) {
    left -= right;
    right = 0;
  }
  return { left: clamp(left, 0, 1), right: clamp(right, 0, 1), main: 0, turn: 0 };
};

/** The pad nearest to x, for when the fuel is running low. */
export const nearestPad = (t: Terrain, x: number): LandingPad | null => {
  let best: LandingPad | null = null;
  let d = Number.POSITIVE_INFINITY;
  for (const p of t.pads) {
    const e = Math.max(0, p.x0 - x, x - p.x1);
    if (e < d) {
      d = e;
      best = p;
    }
  }
  return best;
};

/** Whether a throttle's press is on at time `t`. Every engine shares the phase, so overlaps line up. */
export const pulse = (duty: number, t: number, period = PULSE_S): boolean => {
  if (duty >= 0.97) return true;
  if (duty <= 0.03) return false;
  const f = (t % period) / period;
  return f < duty;
};
