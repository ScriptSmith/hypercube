/**
 * Sizes and tuning per frame kind, in venue px and seconds.
 *
 * The fluid's grid follows the canvas's backing store (about one velocity cell per six backing
 * pixels, ink at twice that), so `res` and a software rasteriser scale the cost, while the physics
 * stay in venue px and behave the same at any grid size.
 */
import type { FrameKind, OptionValues } from "../../core/types";
import type { Physics } from "./gpu/fluid";
import type { ColourMode } from "./palette";

export type Variant = "strata" | "kaleido";
/** What a frame is doing: on its own, a touch frame under a live screen, or a screen. */
export type Mode = "solo" | "station" | "screen";

export interface Config {
  variant: Variant;
  colours: ColourMode;
  strata: boolean;
  mirrors: number;
}

export const readConfig = (variant: string, options: OptionValues): Config => {
  const m = Number(options.mirrors);
  return {
    variant: variant === "kaleido" ? "kaleido" : "strata",
    colours: options.colours === "rainbow" ? "rainbow" : "time",
    strata: options.strata !== false,
    mirrors: m === 8 || m === 12 ? m : 6,
  };
};

export interface Tuning {
  physics: Physics;
  /** Pour radius, venue px. */
  radius: number;
  /** Temperature of ink poured in the child band and in the adult band. */
  warm: number;
  hot: number;
  /** Upward jet speed for warm and hot pours, venue px/s. */
  jetWarm: number;
  jetHot: number;
  /** How much of a finger's own speed the ink takes. */
  follow: number;
  /** Fraction of the frame's height the day's layers may fill, from the top. */
  layerZone: number;
  inkRate: number;
  inkStrength: number;
  /** How quickly ink turns opaque when drawn: opacity is 1 - exp(-gain * density). */
  gain: number;
}

const BASE: Physics = {
  buoyancy: 3000,
  vorticity: 4,
  swirl: 30,
  swirlScale: 700,
  drag: 4,
  inkLife: 26,
  cool: 8,
  cap: 1.7,
  capRate: 1.2,
  clear: 0.03,
  maxSpeed: 1100,
};

const INK = { inkRate: 5, inkStrength: 0.8, gain: 1.8 };

export const tuningFor = (kind: FrameKind): Tuning => {
  switch (kind) {
    case "wall":
      return {
        physics: { ...BASE, buoyancy: 3600, cool: 10, swirlScale: 900 },
        radius: 64,
        warm: 0.62,
        hot: 1,
        jetWarm: 170,
        jetHot: 300,
        follow: 0.6,
        layerZone: 0.25,
        ...INK,
      };
    case "screen":
      return {
        physics: { ...BASE, buoyancy: 3600, swirlScale: 1100, maxSpeed: 1400 },
        radius: 52,
        warm: 0.65,
        hot: 1,
        jetWarm: 300,
        jetHot: 440,
        follow: 0.5,
        layerZone: 0.25,
        ...INK,
      };
    default:
      return {
        physics: { ...BASE },
        radius: 42,
        warm: 0.6,
        hot: 1,
        jetWarm: 160,
        jetHot: 280,
        follow: 0.6,
        layerZone: 0.17,
        ...INK,
      };
  }
};

export interface GridSpec {
  /** Venue px per velocity cell. */
  cell: number;
  dyeScale: number;
  iterations: number;
}

/**
 * Grid for a frame of `venue` size drawn into `backing` pixels. Software rasterisers get cells
 * half again as coarse, fewer iterations and a cap on the grid's size.
 */
export const gridFor = (
  venue: { width: number; height: number },
  backing: { width: number; height: number },
  software: boolean,
): GridSpec => {
  const pxPerVenue = Math.max(
    1e-3,
    Math.min(backing.width / venue.width, backing.height / venue.height),
  );
  let cell = (software ? 11 : 6) / pxPerVenue;
  const short = Math.min(venue.width, venue.height);
  const long = Math.max(venue.width, venue.height);
  // At least 40 cells across the short side, at most 1100 (software 260) along the long one.
  cell = Math.min(cell, short / 40);
  cell = Math.max(cell, long / (software ? 260 : 1100));
  return { cell, dyeScale: 2, iterations: software ? 10 : 28 };
};

/** Kaleidoscope iterations and supersampling. */
export const kaleidoQuality = (software: boolean) =>
  software
    ? { iterations: 40, supersample: false, scale: 0.5 }
    : { iterations: 72, supersample: true, scale: 1 };

/** Mean ink (r + g + b over the frame) above which ink fades faster. */
export const CROWD_INK = 0.08;

/**
 * How much of its usual life ink keeps when the frame's mean ink is `mean`: all of it up to
 * CROWD_INK, then less and less, so a crowd pouring for hours can't fill the water with ink.
 */
export const crowdFactor = (mean: number): number =>
  !(mean > CROWD_INK) ? 1 : Math.max(0.12, (CROWD_INK / mean) ** 2);

/**
 * How much of the clearing (see `Physics.clear`) applies at mean ink `mean`: none on a quiet
 * frame, whose faint wisps are part of the look, rising to all of it as a crowd fills the frame.
 */
export const crowdClear = (mean: number): number =>
  !(mean > CROWD_INK * 0.4) ? 0 : Math.min(1, (mean - CROWD_INK * 0.4) / (CROWD_INK * 0.6));
