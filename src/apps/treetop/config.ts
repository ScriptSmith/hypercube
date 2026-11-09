/**
 * Rules, options and the numbers the course, physics and race cadence share. Distances are in
 * course px: venue px at full lane height (a 1920 px tall lane), so a half-height lane in the
 * `pads` variant draws the same course at half scale.
 */
import type { OptionValues } from "../../core/types";

export type Variant = "race" | "pads";
export type CrashRule = "tumble" | "out";
export type Flyer = "lorikeet" | "glider";

/** Base scroll speed per `speed` option, course px per second. */
export const SPEEDS = { slow: 280, normal: 360, fast: 440 } as const;
/** Gap height per `gap` option, course px. */
export const GAPS = { wide: 680, normal: 520, narrow: 420 } as const;
export type SpeedId = keyof typeof SPEEDS;
export type GapId = keyof typeof GAPS;

export interface FlapConfig {
  variant: Variant;
  crash: CrashRule;
  flyer: Flyer;
  speed: SpeedId;
  gap: GapId;
  /** Base scroll speed, course px per second. */
  base: number;
  /** Gap height, course px. */
  gapH: number;
  /** Longest race, seconds. */
  race: number;
  /** The solo panel replays the best recent run. */
  ghost: boolean;
}

export const COURSE_H = 1920;
/** The soft ceiling: a glider is pushed down from here. */
export const CEIL_Y = 40;
/** Touching the floor is a crash. */
export const FLOOR_Y = 1846;
/** Obstacle width for collisions, course px. */
export const GATE_W = 220;
/** Glider collision radius, course px. */
export const RADIUS = 40;
/** Gliders wait at this height on the start line. */
export const START_Y = 900;
/** Obstacles are at least this tall, so their art always fits. */
export const MIN_PIECE = 210;

export const COUNTDOWN_MS = 5000;
export const RESULTS_MS = 10_000;

/** Seconds a crashed glider tumbles in the `tumble` rule. */
export const TUMBLE_S = 1.2;
/** Seconds after a tumble during which a glider can't crash again. */
export const GRACE_S = 0.5;
/** Each clean gate adds this much speed in the `tumble` rule, up to BOOST_MAX. */
export const BOOST = 0.04;
export const BOOST_MAX = 0.4;
/** In the `out` rule the whole course speeds up by this much over the first two-thirds of the race. */
export const OUT_RAMP = 0.5;
/** Fastest a glider ever goes relative to base: the out ramp times the adult pad's edge. */
export const MAX_SPEED_FACTOR = (1 + OUT_RAMP) * 1.2;

/** Downs this soon after the last flap are ignored, so several fingers don't stack. */
export const FLAP_DEBOUNCE_MS = 80;

/** How a glider flies. The adult pad glider is heavier and faster. */
export interface Body {
  gravity: number;
  /** A flap sets the vertical velocity to minus this. */
  flap: number;
  maxFall: number;
  /** Multiplies the horizontal speed. */
  speed: number;
}

export const STANDARD: Body = { gravity: 3000, flap: 1050, maxFall: 1500, speed: 1 };
export const ADULT: Body = { gravity: 3900, flap: 1180, maxFall: 1700, speed: 1.2 };

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

export const readConfig = (variant: string, options: OptionValues): FlapConfig => {
  const speed = pick<SpeedId>(options.speed, ["slow", "normal", "fast"], "normal");
  const gap = pick<GapId>(options.gap, ["wide", "normal", "narrow"], "normal");
  const raw = Number(options.race);
  const race = Number.isFinite(raw) ? Math.min(90, Math.max(30, Math.round(raw / 15) * 15)) : 45;
  return {
    variant: variant === "pads" ? "pads" : "race",
    crash: pick<CrashRule>(options.crash, ["tumble", "out"], "tumble"),
    flyer: pick<Flyer>(options.flyer, ["lorikeet", "glider"], "lorikeet"),
    speed,
    gap,
    base: SPEEDS[speed],
    gapH: GAPS[gap],
    race,
    ghost: options.ghost !== false,
  };
};

/** One race, start of countdown to start of the next countdown, in ms. */
export const periodMs = (cfg: Pick<FlapConfig, "race">): number =>
  COUNTDOWN_MS + cfg.race * 1000 + RESULTS_MS;

/**
 * Distance from the start line to the finish. A clean `tumble` run, speeding up gate by gate,
 * takes about 0.78 of the race length: about 35 s of a 45 s race.
 */
export const courseLength = (cfg: Pick<FlapConfig, "base" | "race">): number =>
  Math.round(cfg.base * cfg.race);
