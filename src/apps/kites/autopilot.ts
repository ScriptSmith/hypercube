/**
 * The autopilot flies kites in attract and drives the bots, so bots move the controls exactly as
 * it would. It returns control positions, never forces: whether the spool is held, or how far
 * each stunt handle is pulled. Both keep a little state per kite (`SpoolPilot`, `StuntPilot`).
 *
 * The stunt pilot must be smooth, because visitors watch its handles: its pattern changes gently,
 * its guards against the ground and the window's edge fade in and out with distance rather than
 * switching on and off (which shook the handles up and down several times a second), and its
 * hands follow what it wants with a short lag.
 */
import {
  angleDiff,
  type SpoolKite,
  STUNT,
  type StuntKite,
  type StuntWindow,
  windowCentre,
  windowRadius,
} from "./kite";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number) => {
  const f = clamp((x - e0) / (e1 - e0), 0, 1);
  return f * f * (3 - 2 * f);
};

export interface SpoolPilot {
  holding: boolean;
  /** Seconds since it last pressed or let go. */
  since: number;
}

export const spoolPilot = (phase = 0): SpoolPilot => ({
  holding: false,
  since: (phase / TAU) * 2,
});

/** Heights, as fractions of the sky's top, between which the autopilot climbs and sinks. */
export const SPOOL_LOW = 0.26;
export const SPOOL_HIGH = 0.6;
/** Shortest and longest hold and rest, seconds, so the ghost finger never flickers. */
const MIN_HOLD = 0.8;
const MAX_HOLD = 4;
const MIN_REST = 1.6;
const MAX_REST = 9;

/**
 * Whether the autopilot holds the spool now: it holds while the kite climbs from low to high,
 * then lets go while it drifts back down, so passers-by see a held button send a kite up.
 */
export const spoolAutopilot = (
  k: SpoolKite,
  t: number,
  phase: number,
  top: number,
  s: SpoolPilot,
  dt: number,
): boolean => {
  s.since += dt;
  const low = SPOOL_LOW + 0.05 * Math.sin((TAU * t) / 37 + phase);
  const high = SPOOL_HIGH + 0.1 * Math.sin((TAU * t) / 23 + phase * 1.7);
  if (s.holding) {
    if ((k.y >= high * top && s.since >= MIN_HOLD) || s.since >= MAX_HOLD) {
      s.holding = false;
      s.since = 0;
    }
  } else if ((k.y <= low * top && s.since >= MIN_REST) || s.since >= MAX_REST) {
    s.holding = true;
    s.since = 0;
  }
  return s.holding;
};

export interface Handles {
  left: number;
  right: number;
}

export interface StuntPilot extends Handles {
  /** The pattern's turn rate, eased, rad/s. */
  pattern: number;
  /** The way the last turn up from straight down went, so it never flip-flops. */
  way: number;
}

export const stuntPilot = (): StuntPilot => ({ left: 0, right: 0, pattern: 0, way: 1 });

/** Handle pull with nobody turning: a little, for speed. */
const BASE = 0.18;
/** Seconds the hands take to follow what the pilot wants, and the pattern to change. */
const HAND_S = 0.14;
const PATTERN_S = 0.35;
/** Turn rate per radian off course while a guard steers, per second. */
const GAIN = 3.2;

const toHandles = (turnRate: number, out: Handles): Handles => {
  const turn = clamp(turnRate / STUNT.turn, -1, 1);
  out.left = Math.min(1, BASE + Math.max(0, turn));
  out.right = Math.min(1, BASE + Math.max(0, -turn));
  return out;
};

/** The pattern's turn rate at time `t`: slow figure eights, a loop or two, and some wandering. */
export const patternRate = (t: number, phase: number): number => {
  const cycle = (((t + phase * 5) % 18) + 18) % 18;
  if (cycle < 7) return 0.85 * STUNT.turn * Math.sin((TAU * cycle) / 3.6);
  if (cycle < 11) return (phase > Math.PI ? 1 : -1) * 0.65 * STUNT.turn;
  return 0.35 * STUNT.turn * Math.sin((TAU * cycle) / 6.5 + phase);
};

const want: Handles = { left: 0, right: 0 };

/**
 * Stunt handles the autopilot wants at time `t` (s), eased from where they were over `dt`
 * seconds: the pattern, steered up when the kite is low and heading down, and back inside when
 * it is near the window's edge and heading out.
 */
export const stuntAutopilot = (
  k: StuntKite,
  win: StuntWindow,
  t: number,
  phase: number,
  s: StuntPilot,
  dt: number,
): StuntPilot => {
  const ease = Math.min(1, dt / HAND_S);
  if (k.phase === "down") {
    s.left += (0 - s.left) * ease;
    s.right += (0 - s.right) * ease;
    return s;
  }
  s.pattern += (patternRate(t, phase) - s.pattern) * Math.min(1, dt / PATTERN_S);
  let rate = s.pattern;

  // Back inside: near the edge and heading out.
  const cx = windowCentre(k, win);
  const inward = Math.atan2(win.b * 0.45 - k.y, cx - k.x);
  const toIn = angleDiff(inward, k.heading);
  const edge = smooth(0.8, 0.95, windowRadius(k, win)) * smooth(0.5, 1.3, Math.abs(toIn));
  rate += (clamp(GAIN * toIn, -0.9 * STUNT.turn, 0.9 * STUNT.turn) - rate) * edge;

  // Up: low (or about to be) and not climbing. From nearly straight down, keep turning the way
  // it already chose.
  const up = Math.sin(k.heading);
  const ahead = Math.min(k.y, k.y + k.speed * up * 0.8);
  const ground = (1 - smooth(0.24 * win.b, 0.42 * win.b, ahead)) * (1 - smooth(0.15, 0.55, up));
  const toUp = angleDiff(Math.PI / 2, k.heading);
  if (Math.abs(toUp) < 2.6) s.way = toUp >= 0 ? 1 : -1;
  const upRate = Math.abs(toUp) >= 2.6 ? s.way * STUNT.turn : GAIN * toUp;
  rate += (clamp(upRate, -STUNT.turn, STUNT.turn) - rate) * ground;

  toHandles(rate, want);
  s.left += (want.left - s.left) * ease;
  s.right += (want.right - s.right) * ease;
  return s;
};
