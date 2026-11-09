/**
 * Where things are. Every frame in a setup shares one coordinate system, "sky units": venue px
 * of the touch frames (a panel is 1080 wide), with y up and y = 0 along the top edge of the touch
 * frames, which is also the bottom edge of the screen above them. The screen spans the row of
 * touch frames exactly, so a point at fraction `u` across touch frame `pos` is at
 * x = xo + (pos + u) * fw on both, and a shell keeps its physical size and speed as it crosses.
 *
 * In a corner, x = 0 is the corner itself: side a (the left bank) runs from -W to 0 and side b
 * from 0 to W, so the two screens join at x = 0 without either knowing the other's size.
 *
 * A frame with no screen above it (a solo panel, a pair, the wall) uses the same coordinates for
 * itself and keeps a small sky in its own upper part.
 */
import { activeVenue } from "../../core/venue";
import { apexPhysics, climbPhysics } from "./path";

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where shells launched into this sky burst, and how they fly. */
export interface Sky {
  /** Burst area: x range, its floor and height. */
  x0: number;
  x1: number;
  floor: number;
  height: number;
  /** Burst height for size 0 and size 1, as fractions of `height` above `floor`. */
  lo: number;
  hi: number;
  /** Burst radius for size 0 and 1, sky units. */
  rLo: number;
  rHi: number;
  /** Shell launch speed and gravity. */
  v: number;
  g: number;
  /** Star sprite size, sky units. */
  star: number;
  /** True for a screen's sky above a bank: shells cross from touch frames into it. */
  bank: boolean;
}

/** The venue's screen's height over its width. */
export const screenAspect = (): number => {
  const screen = activeVenue().screen;
  return screen.height / screen.width;
};
/** The bank a screen of its own (no touch frames) pretends to sit above. */
export const defaultBankWidth = (): number => {
  const venue = activeVenue();
  return venue.panel.width * venue.bankCount;
};
/** Nominal depth of a tube's mouth below the touch frame's top, for the bank's shell physics. */
export const NOMINAL_DEPTH = 1500;
/** Seconds a shell takes to climb off the top of a touch frame (the latency it hides). */
export const EXIT_S = 0.47;

export const burstHeight = (sky: Sky, z: number): number =>
  sky.floor + sky.height * (sky.lo + (sky.hi - sky.lo) * clamp01(z));

export const burstRadius = (sky: Sky, z: number): number =>
  sky.rLo + (sky.rHi - sky.rLo) * clamp01(z);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The sky of a screen above a bank `width` sky units wide, starting at `xo`. `aspect` is the
 * screen's height over width. Panels compute the same sky with the default aspect; their
 * launch messages carry speed and gravity so the screen flies them exactly as they started.
 */
export const bankSky = (width: number, xo: number, aspect = screenAspect()): Sky => {
  const height = width * aspect;
  const hi = 0.75;
  const top = NOMINAL_DEPTH + height * hi;
  const { v, g } = climbPhysics(NOMINAL_DEPTH, EXIT_S, top * 1.6);
  return {
    x0: xo,
    x1: xo + width,
    floor: 0,
    height,
    lo: 0.45,
    hi,
    rLo: height * 0.11,
    rHi: height * 0.2,
    v,
    g,
    star: height * 0.0052,
    bank: true,
  };
};

/** The region a screen draws. */
export const screenRegion = (width: number, xo: number, aspect: number): Region => ({
  x0: xo,
  y0: 0,
  x1: xo + width,
  y1: width * aspect,
});

/** The region a touch frame draws: its own rectangle below the screen line. */
export const frameRegion = (xo: number, pos: number, fw: number, fh: number): Region => ({
  x0: xo + pos * fw,
  y0: -fh,
  x1: xo + (pos + 1) * fw,
  y1: 0,
});

/**
 * A touch frame's own sky above its pads: the part above `skyBottom` (venue px from the frame's
 * top). Bursts stay inside it; shells climb from the tubes in about 1.5 s.
 */
export const localSky = (
  region: Region,
  skyBottom: number,
  mouthDepth: number,
  opts: { wall: boolean },
): Sky => {
  const height = skyBottom;
  const floor = -skyBottom;
  const width = region.x1 - region.x0;
  const lo = opts.wall ? 0.4 : 0.36;
  const hi = opts.wall ? 0.6 : 0.6;
  const rise = mouthDepth - skyBottom + height * hi;
  const { v, g } = apexPhysics(rise * 1.12, opts.wall ? 1.75 : 1.5);
  const rHi = Math.min(height * (opts.wall ? 0.38 : 0.36), width * 0.42);
  return {
    x0: region.x0,
    x1: region.x1,
    floor,
    height,
    lo,
    hi,
    rLo: rHi * 0.6,
    rHi,
    v,
    g,
    star: opts.wall ? 13 : 11,
    bank: false,
  };
};
