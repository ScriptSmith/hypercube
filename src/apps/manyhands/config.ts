import type { OptionValues } from "../../core/types";

export type Variant = "mixed" | "simple";
export type SlotsMode = "both" | "low";
export const THEME_IDS = ["rocket", "treehouse", "lighthouse", "robot", "sandcastle"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeChoice = ThemeId | "rotate";

export interface Config {
  variant: Variant;
  /** Seconds per build. */
  round: number;
  theme: ThemeChoice;
  slots: SlotsMode;
  /** Workstations on a wall. */
  stations: number;
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "simple" ? "simple" : "mixed",
  round: Math.min(300, Math.max(60, Math.round(num(o.round, 150) / 30) * 30)),
  theme: (THEME_IDS as readonly string[]).includes(String(o.theme))
    ? (o.theme as ThemeId)
    : "rotate",
  slots: o.slots === "low" ? "low" : "both",
  stations: Math.min(8, Math.max(4, Math.round(num(o.stations, 6)))),
});

/** The helpers fill whatever is left in this last stretch of a build. */
export const FINISH_MS = 5000;
/** A finished build comes alive for this long before the next one starts. */
export const ALIVE_MS = 10_000;
/** Build sizes, and parts per task slot active in the last minute. */
export const MIN_PARTS = 12;
export const MAX_PARTS = 48;
export const PARTS_PER_SLOT = 4;
/** A slot counts as active this long after its last touch or finished task by a person or bot. */
export const ACTIVE_MS = 60_000;
/** A column counts as worked (so helpers leave it alone) this long after its last part. */
export const WORKING_MS = 30_000;
/** Share of a build the slow helpers make before the last stretch when nobody plays at all. */
export const HELPER_SHARE = 0.6;
/** A helper's flight onto the build. */
export const HELPER_FLY_MS = 1600;
/** Trophies kept in the row along the top. */
export const MAX_TROPHIES = 12;
/** Parts that arrive while a build is alive wait for the next one, up to this many. */
export const MAX_CARRY = MAX_PARTS;

/** After a task is done its part sits in the slot this long, then leaves. */
export const MADE_MS = 520;
/** The next task slides in this long after the part leaves, taking SLIDE_MS. */
export const NEXT_GAP_MS = 200;
export const SLIDE_MS = 380;
/** A part rising off the top of a touch frame leaves at this speed (venue px per second). */
export const EXIT_SPEED = 2800;
/** A part's flight on the screen, from the bottom edge to its slot. */
export const FLY_MS = 1100;
/** A part's flight on a frame with its own build, from its slot to the build. */
export const LOCAL_FLY_MS = 950;

/** Bots and the ghost leave a slot alone this long after a person touches it. */
export const PERSON_HOLD_MS = 20_000;

/** Panels say they are there this often; the screen sends the build this often. */
export const HEARTBEAT_MS = 1000;
export const BUILD_EVERY_MS = 700;
/** A panel with no build from its screen for this long makes its own. */
export const SCREEN_GRACE_MS = 2300;
/** The screen counts a column as gone this long after its last part or heartbeat. */
export const COLUMN_GONE_MS = 5000;
