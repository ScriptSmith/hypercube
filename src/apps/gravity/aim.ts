/**
 * Pulling a slingshot: how far and which way a finger is from the rest point, and the launch it
 * gives. The body goes away from the finger, faster the longer the pull, within the pad's spread
 * of straight up; a pull shorter than the pad's least just cancels.
 */
import type { PadSpot } from "./layout";

export interface Shot {
  /** Share of the pad's longest pull, 0 to 1. */
  pull: number;
  /** Launch direction from straight up, radians, positive to the right. */
  angle: number;
}

/** Launch speed for a pull of `len` venue px, or 0 for a pull too short to launch. */
export const speedFor = (pad: PadSpot, len: number): number => {
  if (len < pad.minPull) return 0;
  const f = Math.min(1, (len - pad.minPull) / Math.max(1, pad.pull - pad.minPull));
  return pad.vmin + (pad.vmax - pad.vmin) * f;
};

/** The pull that gives a shot: the finger's offset from the pad's rest point. */
export const pullFor = (pad: PadSpot, s: Shot): { dx: number; dy: number } => {
  const len = pad.minPull + (pad.pull - pad.minPull) * Math.min(1, Math.max(0, s.pull));
  return { dx: -Math.sin(s.angle) * len, dy: Math.cos(s.angle) * len };
};

/** The launch for a finger at (dx, dy) from the rest point, or null if it would just cancel. */
export const launchFromPull = (
  pad: PadSpot,
  dx: number,
  dy: number,
): { vx: number; vy: number; len: number; angle: number } | null => {
  const raw = Math.hypot(dx, dy);
  const len = Math.min(raw, pad.pull);
  const v = speedFor(pad, len);
  if (v === 0) return null;
  // Away from the finger: the finger below and left sends it up and right.
  let angle = Math.atan2(-dx, dy);
  angle = Math.max(-pad.spread, Math.min(pad.spread, angle));
  return { vx: Math.sin(angle) * v, vy: -Math.cos(angle) * v, len, angle };
};

/** Where the body sits while drawn: pulled towards the finger, on the allowed arc. */
export const heldAt = (pad: PadSpot, dx: number, dy: number): { x: number; y: number } => {
  const raw = Math.hypot(dx, dy);
  if (raw < 1e-6) return { x: pad.x, y: pad.y };
  const len = Math.min(raw, pad.pull);
  let angle = Math.atan2(-dx, dy);
  angle = Math.max(-pad.spread, Math.min(pad.spread, angle));
  return { x: pad.x - Math.sin(angle) * len, y: pad.y + Math.cos(angle) * len };
};

/** The launch velocity of a shot. */
export const shotVelocity = (pad: PadSpot, s: Shot) => {
  const { dx, dy } = pullFor(pad, s);
  return launchFromPull(pad, dx, dy);
};
