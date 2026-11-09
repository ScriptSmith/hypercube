import type { OptionValues } from "../../core/types";
import { FAMILIES, type Family } from "./shapes";

export const HZ = 60;

export type Variant = "hyper" | "flat";

export interface Config {
  variant: Variant;
  /** Wall only: a square, a cube and a 4D shape side by side. */
  ladder: boolean;
  /** A slow turn of the view while nobody touches it. */
  spin: boolean;
  /** Axis names on the dials and the gauge. */
  axes: boolean;
}

export const readConfig = (variant: string, options: OptionValues): Config => ({
  variant: variant === "flat" ? "flat" : "hyper",
  ladder: options.ladder !== false,
  spin: options.spin !== false,
  axes: options.axes !== false,
});

export const TIMING = {
  /** A stage nobody has touched for this long goes back to the show (on frames with several). */
  peopleIdleMs: 45_000,
  /** Bots leave a stage alone this long after a person touches it. */
  botYieldMs: 20_000,
  /** Easing back into the show after people. */
  rejoinMs: 1200,
  /** A view turned by hand drifts home after this long. */
  viewReturnS: 20,
} as const;

export const BACKGROUND =
  "radial-gradient(ellipse 85% 75% at 50% 35%, #161c38 0%, #0a0d20 55%, #04050b 100%)";

/** Axis colours: x, y, z, w. */
export const AXIS_COLORS = ["#ff7a7a", "#7dea8c", "#6cb4ff", "#ffc65a"] as const;
export const AXIS_NAMES = ["x", "y", "z", "w"] as const;

/** Near along w is warm and bright, far is cool and dim (as in the top bar's mark). */
export const NEAR_COLOR = "#ffd27a";
export const FAR_COLOR = "#5f7dff";
export const SLICE_COLOR = "#4ff0d2";
export const SHEET_COLOR = "#7fb4ff";
export const SHADOW_INK = "#0b0d18";

/** One colour per frame in a bank, left to right. */
export const FRAME_COLORS = [
  "#4ff0d2",
  "#ffb84d",
  "#ff6fae",
  "#8f9bff",
  "#b6f25a",
  "#ff8a5c",
  "#5cd0ff",
  "#e58bff",
  "#ffe14d",
  "#6dffa0",
] as const;

export const frameColor = (pos: number): string =>
  FRAME_COLORS[
    ((Math.floor(pos) % FRAME_COLORS.length) + FRAME_COLORS.length) % FRAME_COLORS.length
  ]!;

export const familyAt = (i: number): Family =>
  FAMILIES[((Math.floor(i) % FAMILIES.length) + FAMILIES.length) % FAMILIES.length]!;

export const familyIndex = (f: Family): number => Math.max(0, FAMILIES.indexOf(f));
