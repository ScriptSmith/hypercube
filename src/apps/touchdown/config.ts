import type { OptionValues } from "../../core/types";

export type Variant = "duo" | "crew";
export type Assist = "off" | "gentle" | "strong";
export type WindKind = "calm" | "breezy" | "gusty";

export interface Config {
  variant: Variant;
  assist: Assist;
  fuel: boolean;
  wind: WindKind;
  /** Crews on a wall, 1 to 3. Other frames always have one. */
  crews: number;
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "crew" ? "crew" : "duo",
  assist: o.assist === "off" || o.assist === "strong" ? o.assist : "gentle",
  fuel: o.fuel !== false,
  wind: o.wind === "breezy" || o.wind === "gusty" ? o.wind : "calm",
  crews: Math.min(3, Math.max(1, Math.round(num(o.crews, 2)))),
});

/**
 * The label every random stream of a frame grows from. A screen rebuilds a touch frame's terrain
 * from the same label, so the two must agree.
 */
export const seedLabel = (seed: number): string => `touchdown:${seed}`;

/** Pause after a landing or a bump before the next run starts. */
export const NEXT_RUN_MS = 4000;
/** A lone visitor holding one pad this long gets the helper on the other. */
export const HELPER_AFTER_MS = 3000;
/** The other pad counts as untouched if nobody has touched it for this long. */
export const HELPER_UNTOUCHED_MS = 15_000;
/** The helper lets go when its partner pad has been left alone this long. */
export const HELPER_LEAVE_MS = 8000;
/** Ghosts fade once nobody has played for this long. */
export const GHOST_FADE_MS = 60_000;
/** A crew nobody has touched for this long goes back to the autopilot at its next run. */
export const CREW_IDLE_MS = 40_000;
/** Bots leave a crew alone for this long after a person touches one of its pads. */
export const BOT_YIELD_MS = 20_000;
/** Engines cut out this long into a run even with fuel to spare, so every run ends. */
export const ENGINE_CAP_S = 60;
/** Engine-seconds in a full tank (both engines together use two a second). */
export const TANK_S = 42;
/** Ghost samples per second and the longest run a ghost keeps. */
export const GHOST_HZ = 15;
export const GHOST_MAX_S = 90;
/** Landing limits. Speeds are at the reference drop and scale with it. */
export const LAND_TILT = (12 * Math.PI) / 180;
export const LAND_VY = 32;
export const LAND_VX = 28;
