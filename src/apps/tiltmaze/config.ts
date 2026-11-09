import type { OptionValues } from "../../core/types";

export type Variant = "maze" | "holes";
export type Speed = "gentle" | "lively";
export type PairMode = "side" | "together";

export interface Config {
  variant: Variant;
  speed: Speed;
  pair: PairMode;
  /** Boards on a wall, 2 to 4. Other frames have one, or two on a pair side by side. */
  boards: number;
  /** Balls that fill the jar, 10 to 40. */
  jar: number;
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "holes" ? "holes" : "maze",
  speed: o.speed === "lively" ? "lively" : "gentle",
  pair: o.pair === "together" ? "together" : "side",
  boards: Math.min(4, Math.max(2, Math.round(num(o.boards, 3)))),
  jar: Math.min(40, Math.max(10, Math.round(num(o.jar, 20)))),
});

export const DEG = Math.PI / 180;

/** Simulation rate. */
export const HZ = 120;

/** How the board answers the pad, by speed. */
export interface Handling {
  /** Largest tilt, radians. */
  maxTilt: number;
  /** Fastest the board tips, radians per second. */
  rate: number;
  /** Viscous damping, per second; with the tilt it sets the ball's top speed. */
  damping: number;
}

export const HANDLING: Record<Speed, Handling> = {
  gentle: { maxTilt: 8 * DEG, rate: 34 * DEG, damping: 2.2 },
  lively: { maxTilt: 12 * DEG, rate: 55 * DEG, damping: 1.5 },
};

/** Highest level; finishing it gives another maze of the same size. */
export const MAX_LEVEL = 8;
/** The attract play cycles through the first levels only, so it keeps sending balls up. */
export const DEMO_MAX_LEVEL = 2;
/** A board nobody has touched for this long goes back to level 1 and its demonstration. */
export const PEOPLE_IDLE_MS = 30_000;
/** Bots leave a board alone for this long after a person touches its controls. */
export const BOT_YIELD_MS = 20_000;
/** In together mode, a lever untouched this long while the other is in use helps by itself. */
export const HELP_AFTER_MS = 8000;
/** A lever counts as in use while touched this recently. */
export const IN_USE_MS = 3000;
