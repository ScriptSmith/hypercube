import type { OptionValues } from "../../core/types";
import { PALETTE } from "../../core/ui/palette";

export type Variant = "explore" | "steps";
export type Units = "both" | "deg" | "rad";
export type Fn = "sin" | "cos" | "tan";
export const FNS: readonly Fn[] = ["sin", "cos", "tan"];

export interface Config {
  variant: Variant;
  units: Units;
  /** tan is offered at all (the `tan` option). */
  tan: boolean;
  snap: boolean;
}

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "steps" ? "steps" : "explore",
  units: o.units === "deg" ? "deg" : o.units === "rad" ? "rad" : "both",
  tan: o.tan !== false,
  snap: o.snap !== false,
});

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Simulation rate. */
export const HZ = 60;

/**
 * Each quantity has one colour wherever it appears: its side of the triangle, its label, its
 * value, its curve and its toggle. The radius is white, the angle and arc green.
 */
export const COLOUR: Record<Fn | "theta" | "radius", string> = {
  sin: PALETTE.players[2]!,
  cos: PALETTE.players[3]!,
  tan: PALETTE.players[1]!,
  theta: PALETTE.players[5]!,
  radius: PALETTE.foreground,
};

export const INK = PALETTE.foreground;
export const MUTED = PALETTE.muted;
export const BACKGROUND =
  "radial-gradient(ellipse 85% 75% at 35% 45%, #111833 0%, #0a0f22 55%, #05070d 100%)";

/**
 * Bank frames' own colours, which mark their point on the screen and their bead: a wheel from
 * warm to cool. Frame colours mark who, never what; quantities keep the colours above.
 */
export const FRAME_COLOURS = [
  "#ff8a5c",
  "#ffc94a",
  "#b8e65c",
  "#4fe0a0",
  "#4fc8ff",
  "#7e8cff",
  "#c084ff",
  "#ff7ad0",
  "#d9b77e",
  "#ff5c5c",
] as const;

export const frameColour = (pos: number): string =>
  FRAME_COLOURS[
    ((Math.round(pos) % FRAME_COLOURS.length) + FRAME_COLOURS.length) % FRAME_COLOURS.length
  ]!;

export const rgba = (hex: string, a: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};

/** Mix a colour towards black (k < 0) or white (k > 0). */
export const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

/** Timing, in ms. */
export const TIMING = {
  /** A solo frame keeps a visitor's angle this long before it starts turning by itself again. */
  soloHold: 15_000,
  /** A bank frame rejoins the bank's wave this soon after its last touch. */
  bankHold: 5_000,
  /** How long the return to the slow turn takes. */
  ease: 2_500,
  /** A tap on a tick mark eases there over this long. */
  goto: 350,
};
