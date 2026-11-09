import type { OptionValues } from "../../core/types";

export type Variant = "sort" | "simple";
export type Speed = "normal" | "slow";

export interface Config {
  variant: Variant;
  hints: boolean;
  speed: Speed;
}

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "simple" ? "simple" : "sort",
  hints: o.hints !== false,
  speed: o.speed === "slow" ? "slow" : "normal",
});

/** Simulation rate. */
export const HZ = 60;

/**
 * Motion is set in item sizes (`d`, venue px), so a wall's bigger items move as a panel's do.
 * Gravity and the drag on falling items give a terminal speed of about 7 items a second.
 */
export const GRAVITY_D = 16;
export const FALL_TAU = 0.45;
/** Thrown items feel only a breath of air, so a throw goes where it looks like it will. */
export const FLY_TAU = 8;
/** Fastest throw, in item sizes a second. */
export const MAX_THROW_D = 28;

/** Belt speeds, item sizes a second. The children's belt never speeds up. */
export const BELT_SPEED = {
  slow: 0.32,
  mid: 0.5,
  fast: 0.62,
} as const;
/** The fast and mid belts run up to this much faster at full pace. */
export const PACE_BELT = 0.65;
/** Belts and the plant run at this share of their speed in attract. */
export const ATTRACT_SCALE = 0.7;
/** Belts and spawning for `speed: slow`, and for the two-bin variant. */
export const SLOW_SCALE = 0.72;
export const SIMPLE_SCALE = 0.8;

/** Items in a tube or on a belt keep at least this many item sizes apart. */
export const GAP_D = 1.12;
/** Tubes and lifts carry items at these speeds, item sizes a second. */
export const TUBE_D = 5.5;
export const LIFT_D = 3.2;

/** Bins hold this many items before they are lifted away. */
export const BIN_CAP = { sort: 10, simple: 8, wall: 12 } as const;

/** A wrong item sits in the bin this long before the lid flicks it back out. */
export const WRONG_HOLD_S = 0.38;
/** The right bin's lid glows this long after a wrong one. */
export const HINT_S = 1.8;
/** An item takes this long to sink into its bin. */
export const SINK_S = 0.32;

/** Hard bounds, whatever happens. */
export const MAX_PARTICLES = 260;
export const MAX_QUEUE = 6;
export const MAX_PENDING_DROPS = 32;

/** Aim assist: the share of the miss a throw is bent towards its bin. */
export const ASSIST = { adult: 0.35, child: 0.6 } as const;

/** Bots leave a line alone for this long after a person grabs from it. */
export const BOT_YIELD_MS = 12_000;
