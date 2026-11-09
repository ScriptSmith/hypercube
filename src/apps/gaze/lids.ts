/**
 * Eyelids for the eye on a wall: where the upper and lower lids' margins sit and how they blink.
 * The lids belong to the socket, not the eye, so they stay put as it turns sideways, but follow
 * it up and down (the upper lid most). Blinks come now and then, more often in a nervous mood and
 * slower when drowsy, often with a big gaze shift, and at once, harder and with a squint after,
 * when something touches the eye. A drowsy eye's upper lid droops. A content eye (being stroked)
 * has heavy lids, the lower raised as in a smile, and blinks slowly, holding them shut a moment,
 * as a cat does when it is happy. Deterministic from its random stream and the steps it is given.
 *
 * Each margin is a plane through a line a little behind the eye's front, given by the elevation
 * where it crosses straight out in front, so the opening is almond shaped, widest in the middle,
 * with its corners round the sides of the ball. Both planes rise a little towards the outer
 * corner, so it sits higher than the inner one.
 */
import { DEG } from "../../core/sphere";
import type { Rng } from "../../core/types";
import type { MoodName } from "./motion";

export const LIDS = {
  /** The lids' outer surface, ball radii from the centre. */
  shell: 1.04,
  /**
   * The line the margins' planes turn about lies this far behind the centre, ball radii: in front
   * of it, so the opening's corners are inside the ball's outline.
   */
  back: -0.45,
  /**
   * Margins in front with the eye looking level, radians: the upper lid covers 1.5 to 2 mm of the
   * iris, 4 mm above the pupil's centre, and the lower sits 5.5 mm below it, on a 12 mm eye.
   */
  upper: 20 * DEG,
  lower: -27 * DEG,
  /**
   * The opening's tilt, outer corner up (5 to 10 degrees measured in two samples), radians. The
   * margins are sheared rather than turned, so the upper lid's highest point moves towards the
   * outer corner, as measured. The eye is a right one seen from the front: its nose side is +x.
   */
  tilt: 5 * DEG,
  /** How far each margin follows the gaze's elevation, looking down and looking up. */
  upperDown: 1,
  upperUp: 0.75,
  lowerDown: 0.6,
  lowerUp: 0.5,
  /** The narrowest the lids leave open, radians, unless blinking. */
  gap: 10 * DEG,
  /**
   * Where the margins meet when shut, a share of the way up from the lower lid: the lower lid
   * barely rises (it mostly slides towards the nose) and the upper comes down to meet it.
   */
  shutAt: 0.12,
  /** Seconds: closing, held shut and opening, for a spontaneous blink (about 320 ms in all). */
  close: 0.1,
  hold: 0.03,
  open: 0.22,
  /** A blink with a gaze shift starts this long after the saccade does, seconds. */
  gazeLead: 0.02,
  /**
   * The chance a gaze shift brings a blink: a cumulative Gaussian of its size, centred on
   * `gazeMid` degrees with spread `gazeSpread`, up to `gazeMax`.
   */
  gazeMid: 40,
  gazeSpread: 12,
  gazeMax: 0.6,
  /** Never two blinks closer than this, seconds. */
  minGap: 0.5,
  /** Spread of the log of the time between blinks; the median is `median / rate` seconds. */
  sigma: 0.89,
  median: 40,
  /** How far the eye dips while the lids are shut, radians. */
  dip: 2 * DEG,
  /** A reflex blink: faster to close, held longer, then a squint that eases off. */
  reflexClose: 0.05,
  reflexHold: 0.12,
  reflexOpen: 0.26,
  squint: 7 * DEG,
  squintFor: 1.6,
  squintEase: 1,
  /** A share of spontaneous blinks don't close all the way, and how far those do close. */
  partial: 0.15,
  partialDepth: [0.55, 0.85] as [number, number],
  /**
   * Content: how far the upper lid droops and the lower rises, radians; blinks a minute; how
   * much slower they are and how many times longer they are held; and a slow blink this long
   * after it settles, seconds.
   */
  relaxDroop: 19 * DEG,
  relaxLift: 13 * DEG,
  relaxRate: 9,
  relaxSlow: 2.4,
  relaxHold: 8,
  relaxBlink: 0.4,
};

/**
 * Blinks a minute (17 at rest, 26 in conversation; 18 looked friendliest on an avatar), how long
 * they take (times the usual), and how far the upper lid droops, by mood.
 */
const MOOD_BLINKS: Record<MoodName, { rate: number; slow: number; droop: number }> = {
  watchful: { rate: 17, slow: 1, droop: 0 },
  nervous: { rate: 26, slow: 0.9, droop: 0 },
  curious: { rate: 15, slow: 1, droop: -2 * DEG },
  drowsy: { rate: 10, slow: 1.5, droop: 8 * DEG },
};

/** The standard normal's cumulative distribution (Abramowitz and Stegun 26.2.17). */
const normalCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

/** The chance a gaze shift of `amplitude` degrees brings a blink. */
export const gazeBlinkChance = (amplitude: number): number =>
  LIDS.gazeMax * normalCdf((amplitude - LIDS.gazeMid) / LIDS.gazeSpread);

export interface Lids {
  /** Margin elevations in front, radians. */
  readonly upper: number;
  readonly lower: number;
  /** How shut, 0 open to 1 shut. */
  readonly shut: number;
  readonly blinks: number;
  readonly reflexes: number;
  /** `gazeElevation` radians; `moods` blend weights; `relax` how content, 0 to 1. */
  step(
    dt: number,
    gazeElevation: number,
    moods: Readonly<Record<MoodName, number>>,
    relax?: number,
  ): void;
  /** A gaze shift of `amplitude` degrees has started. */
  saccade(amplitude: number): void;
  /** Something touched the eye: blink now, hard, and squint after. */
  reflex(): void;
  /** Blink now (tests and the opening). */
  blink(): void;
}

/**
 * A margin's plane in venue space, as a normal and offset (n, w): above it dot(p, n) + w > 0.
 * It contains the point straight out from the eye's centre that the margins turn about (`back`)
 * and the point at elevation `alpha` straight out in front, and rises towards the outer corner
 * (-x) by `tilt` (0 for an opening with both corners alike).
 */
export const marginPlane = (
  centre: readonly [number, number, number],
  radius: number,
  alpha: number,
  tilt = LIDS.tilt,
): [number, number, number, number] => {
  const ny = Math.cos(alpha) + LIDS.back;
  const nz = -Math.sin(alpha);
  const nx = Math.tan(tilt) * ny;
  const l = Math.hypot(nx, ny, nz) || 1;
  const n: [number, number, number] = [nx / l, ny / l, nz / l];
  const p0 = [centre[0], centre[1], centre[2] - LIDS.back * radius];
  return [n[0], n[1], n[2], -(p0[0]! * n[0] + p0[1]! * n[1] + p0[2]! * n[2])];
};

interface Blink {
  t: number;
  close: number;
  hold: number;
  open: number;
  depth: number;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** How shut a blink is `t` seconds in: closing speeds up, opening slows down. */
export const blinkShape = (b: Blink, t: number): number => {
  if (t < 0) return 0;
  if (t < b.close) {
    const x = t / b.close;
    return b.depth * x * x * (2 - x * x);
  }
  if (t < b.close + b.hold) return b.depth;
  const x = (t - b.close - b.hold) / b.open;
  if (x >= 1) return 0;
  return b.depth * (1 - ease(x));
};

export const createLids = (rng: Rng): Lids => {
  let upper = LIDS.upper;
  let lower = LIDS.lower;
  let shut = 0;
  let blink: Blink | null = null;
  let sinceBlink = 10;
  let squint = 0;
  let squintT = 0;
  let droop = 0;
  let follow = 0;
  let blinks = 0;
  let reflexes = 0;
  // Seconds to the next spontaneous blink: an exponential wait past the shortest gap.
  let wait = rng.range(1, 4);
  let pending: { at: number; depth: number } | null = null;
  let slow = 1;
  let relaxed = 0;

  const start = (depth: number, reflex = false) => {
    if (blink && !reflex) return;
    blinks++;
    sinceBlink = 0;
    blink = reflex
      ? {
          t: 0,
          close: LIDS.reflexClose,
          hold: LIDS.reflexHold * rng.range(0.8, 1.3),
          open: LIDS.reflexOpen * rng.range(0.9, 1.2),
          depth: 1,
        }
      : {
          t: 0,
          close: LIDS.close * slow * rng.range(0.85, 1.15),
          hold: LIDS.hold * slow * (1 + relaxed * LIDS.relaxHold) * rng.range(0.5, 1.5),
          open: LIDS.open * slow * rng.range(0.85, 1.25),
          depth,
        };
    // Start the closing from wherever the lid is now.
    if (reflex && shut > 0) blink.t = blink.close * Math.sqrt(shut);
  };

  const nextWait = (rate: number) => {
    const u = Math.max(1e-9, rng.next());
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
    return Math.max(LIDS.minGap, (LIDS.median / Math.max(1, rate)) * Math.exp(LIDS.sigma * g));
  };

  const depthOf = () => (rng.next() < LIDS.partial ? rng.range(...LIDS.partialDepth) : 1);

  return {
    get upper() {
      return upper;
    },
    get lower() {
      return lower;
    },
    get shut() {
      return shut;
    },
    get blinks() {
      return blinks;
    },
    get reflexes() {
      return reflexes;
    },
    step(dt, e, moods, relax = 0) {
      let rate = 0;
      let dr = 0;
      slow = 0;
      for (const m of Object.keys(MOOD_BLINKS) as MoodName[]) {
        const w = moods[m] ?? 0;
        rate += w * MOOD_BLINKS[m].rate;
        slow += w * MOOD_BLINKS[m].slow;
        dr += w * MOOD_BLINKS[m].droop;
      }
      slow = slow || 1;
      const r = Math.max(0, Math.min(1, relax));
      rate += (LIDS.relaxRate - rate) * r;
      slow += (LIDS.relaxSlow - slow) * r;
      // A slow, contented blink as it settles.
      if (r >= 0.8 && relaxed < 0.8 && !pending) pending = { at: LIDS.relaxBlink, depth: 1 };
      relaxed = r;
      droop += (dr - droop) * Math.min(1, dt / 3);
      sinceBlink += dt;
      if (pending) {
        pending.at -= dt;
        if (pending.at <= 0) {
          if (sinceBlink > LIDS.minGap) start(pending.depth);
          pending = null;
        }
      }
      wait -= dt;
      if (wait <= 0) {
        if (sinceBlink > LIDS.minGap) start(depthOf());
        wait = nextWait(rate);
      }
      if (squintT > 0) {
        squintT -= dt;
        squint = LIDS.squint * ease(Math.max(0, Math.min(1, squintT / LIDS.squintEase)));
      } else squint = 0;
      if (blink) {
        blink.t += dt;
        shut = blinkShape(blink, blink.t);
        if (blink.t >= blink.close + blink.hold + blink.open) {
          blink = null;
          shut = 0;
        }
      }
      // The lids follow the gaze up and down, quickly, as they do in a saccade.
      follow += (e - follow) * Math.min(1, dt / 0.05);
      const up =
        LIDS.upper +
        follow * (follow < 0 ? LIDS.upperDown : LIDS.upperUp) -
        droop -
        squint -
        r * LIDS.relaxDroop;
      const low =
        LIDS.lower +
        follow * (follow < 0 ? LIDS.lowerDown : LIDS.lowerUp) +
        0.6 * squint +
        r * LIDS.relaxLift;
      const openUp = Math.max(up, low + LIDS.gap);
      const meet = low + LIDS.shutAt * (openUp - low);
      upper = openUp + (meet - openUp) * shut;
      lower = low + (meet - low) * shut;
      lower = Math.min(lower, upper);
    },
    saccade(amplitude) {
      if (blink || sinceBlink < LIDS.minGap) return;
      if (rng.next() < gazeBlinkChance(amplitude)) {
        pending = { at: LIDS.gazeLead, depth: depthOf() };
      }
    },
    reflex() {
      reflexes++;
      start(1, true);
      squintT = LIDS.squintFor;
    },
    blink() {
      start(1);
    },
  };
};
