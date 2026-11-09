/** Options, settings and timings. */
import type { OptionValues } from "../../core/types";
import { LIMITS, SMART_EVERY } from "./model";

export type Density = "few" | "some" | "many";
/** The road drawn as a straight line that wraps, or as a circle (the ring as it really is). */
export type RoadShape = "straight" | "circle";

export interface Config {
  density: Density;
  /** Index into SMART_EVERY. */
  smart: number;
  /** Index into LIMITS. */
  limit: number;
  noise: boolean;
  road: RoadShape;
}

/** Metres of ring per car for each `cars` option. 15.5 jams on its own; 24 flows freely. */
export const SPACING: Record<Density, number> = { few: 24, some: 19, many: 15.5 };

const DENSITIES: readonly Density[] = ["few", "some", "many"];
const SMART_IDS = ["none", "few", "some", "half"] as const;
const LIMIT_IDS = ["slow", "medium", "fast"] as const;

export const readConfig = (options: OptionValues): Config => {
  const density = DENSITIES.find((d) => d === options.cars) ?? "many";
  const smart = Math.max(0, SMART_IDS.indexOf(options.smart as (typeof SMART_IDS)[number]));
  const li = LIMIT_IDS.indexOf(options.limit as (typeof LIMIT_IDS)[number]);
  return {
    density,
    smart,
    limit: li < 0 ? 1 : li,
    noise: options.noise !== false,
    road: options.road === "circle" ? "circle" : "straight",
  };
};

/** What the adults can change; one shared value per road. */
export interface Settings {
  count: number;
  limit: number;
  smart: number;
}

export const clampSettings = (s: Settings, base: number): Settings => {
  const { lo, hi } = countRange(base);
  return {
    count: Math.max(lo, Math.min(hi, Math.round(s.count))),
    limit: Math.max(0, Math.min(LIMITS.length - 1, Math.round(s.limit))),
    smart: Math.max(0, Math.min(SMART_EVERY.length - 1, Math.round(s.smart))),
  };
};

/** The adults' car buttons go from about half to about double the starting count. */
export const countRange = (base: number): { lo: number; hi: number; step: number } => ({
  lo: Math.max(3, Math.round(base / 2)),
  hi: Math.max(4, Math.round(base * 2)),
  step: Math.max(1, Math.round(base / 7)),
});

/** Ring seconds per real second: real traffic is a little slow to watch. */
export const TIME_SCALE = 1.5;

/** Car length on touch frames, venue px (at least 110). */
export const CAR_PX = 120;
export const CAR_W = 60;

/** Touches find the nearest car within this many venue px. */
export const SNAP_PX = 120;
/** A tap brakes for this long; a hold brakes while held. Real ms. */
export const TAP_MS = 1000;

/** Host snapshots per second, and how far behind the shared clock frames draw by default. */
export const SNAP_HZ = 20;
export const BASE_DELAY_MS = 100;
export const MAX_DELAY_MS = 1500;

/** A host not heard from for this long has gone; the next in line takes over. */
export const HOST_LOST_MS = 1000;
/** A frame that should host waits this long for someone else's cars before starting its own. */
export const HOST_WAIT_MS = 1500;
/**
 * A touch frame that hears no host for this long, and isn't next in line, plays a ring of its
 * own. Until then it predicts the bank's cars itself, which covers the room electing a new hub
 * (3 to 6 s when the hub leaves).
 */
export const LOCAL_AFTER_MS = 6000;

/** Attract: a ghost hand brakes a car every so often (real seconds). */
export const GHOST_MIN_S = 30;
export const GHOST_MAX_S = 60;
