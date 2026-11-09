import type { OptionValues } from "../../core/types";
import { EARTH_TILT } from "./astro";

export type Variant = "seasons" | "moon";
export type CompareId = "london" | "singapore" | "tromso" | "none";

export interface Place {
  /** Shown beside the ground view when the place is at this latitude. */
  name: string;
  /** Degrees, north positive. */
  lat: number;
  /** Degrees, east positive. */
  lon: number;
}

export const BRISBANE: Place = { name: "Brisbane", lat: -27.5, lon: 153.0 };

export const COMPARE: Record<Exclude<CompareId, "none">, Place> = {
  london: { name: "London", lat: 51.5, lon: -0.1 },
  singapore: { name: "Singapore", lat: 1.3, lon: 103.8 },
  tromso: { name: "Tromsø", lat: 69.6, lon: 19.0 },
};

export interface Config {
  variant: Variant;
  compare: CompareId;
  /** The tilt everything starts from and resets to, degrees. */
  tilt: number;
  labels: boolean;
}

/** The option's 23.4 stands for the Earth's 23.44. */
const tiltOf = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return EARTH_TILT;
  const t = Math.max(0, Math.min(90, v));
  return Math.abs(t - 23.4) < 0.05 ? EARTH_TILT : t;
};

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "moon" ? "moon" : "seasons",
  compare:
    o.compare === "singapore" || o.compare === "tromso" || o.compare === "none"
      ? o.compare
      : "london",
  tilt: tiltOf(o.tilt),
  labels: o.labels !== false,
});

/** Simulation rate. */
export const HZ = 60;

export const INK = "#f2f5fa";
export const MUTED = "#8a94a8";
export const SUN = "#ffd36b";
export const SUMMER = "#ffb259";
export const WINTER = "#7ec8ff";
export const MOON_INK = "#d8dce6";
export const BACKGROUND =
  "radial-gradient(ellipse 90% 80% at 50% 35%, #0e1428 0%, #070b18 60%, #04060c 100%)";

/**
 * Bank frames' colours, which mark their latitude on the screen's Earth: warm in the north to
 * cool in the south, the same order as the row.
 */
export const FRAME_COLOURS = [
  "#ff8a5c",
  "#ffc94a",
  "#d7ec5a",
  "#8fe36f",
  "#4fe0a0",
  "#4fd6e0",
  "#4fb0ff",
  "#7e8cff",
  "#b884ff",
  "#ff7ad0",
] as const;

export const frameColour = (pos: number, count: number): string => {
  const n = FRAME_COLOURS.length;
  // Spread a short bank across the whole range so its ends stay warm and cool.
  const i = count <= 1 ? 6 : Math.round((Math.max(0, pos) * (n - 1)) / Math.max(1, count - 1));
  return FRAME_COLOURS[Math.max(0, Math.min(n - 1, i))]!;
};

/** The compare place's colour on the wall, and Brisbane's. */
export const COMPARE_COLOUR = "#ff9de2";
export const BRISBANE_COLOUR = "#7dffb0";

export const rgba = (hex: string, a: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};

/** Timing, in ms unless named otherwise. */
export const TIMING = {
  /** Untouched this long, the state eases back onto the tour. */
  hold: 30_000,
  /** Easing back onto the tour. */
  ease: 3_000,
  /** The spin button turns the Earth through a day over this long. */
  spin: 8_000,
  /** The tilt's Reset eases back over this long. */
  resetTilt: 1_200,
  /** The flat orbit toggle eases the Moon's orbit over this long. */
  flatten: 1_000,
};

/** Moon variant: how fast time passes untouched, in days per second, by speed setting. */
export const MOON_SPEEDS = [0, 0.5, 2] as const;
export const DEFAULT_MOON_SPEED = 1;
