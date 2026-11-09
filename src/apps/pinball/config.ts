/**
 * Rules, options and the numbers shared by the table, the deck and the network. Table distances
 * are table px: venue px on a 1080 x 1920 panel, one table per panel. Deck distances are the
 * screen's venue px.
 */
import type { OptionValues } from "../../core/types";

/** Themed tables, drawn in 3D, each with toys of its own in the middle of the playfield. */
export const THEMES = ["space", "reef", "volcano", "fair"] as const;
export type ThemeId = (typeof THEMES)[number];
export const VARIANTS = ["classic", ...THEMES] as const;
export type Variant = (typeof VARIANTS)[number];

export interface Config {
  variant: Variant;
  /** The theme of a themed variant, null for classic (2D, the classic middle). */
  theme: ThemeId | null;
  /** Balls per game (classic). */
  balls: number;
  /** Use the screen's upper deck when there is one. */
  deck: boolean;
  /** Deck balls land on whichever playing table they fall towards. */
  rain: boolean;
  /** Down the table, table px per second squared. */
  gravity: number;
  /** A person can pick a ball up by touching it, drag it and throw it. */
  grab: boolean;
  /** Tables side by side on a wall. */
  tables: number;
}

/** Tables a wall can hold, and how many by default. */
export const WALL_TABLES = ["4", "5", "6"] as const;
export const WALL_DEFAULT = "5";

export const TABLE_W = 1080;
export const TABLE_H = 1920;
export const BALL_R = 26;
/** Fastest a ball may go on a table, table px per second. */
export const VMAX = 5200;
/** Fixed update rate; physics runs SUBSTEPS times per update. */
export const HZ = 120;
export const SUBSTEPS = 5;

/** Most balls a table has in play at once, served, bonus and returning ones together. */
export const MAX_IN_PLAY = 6;
/** Ball save after each launch. */
export const SAVE_MS = 8000;
/** A finished game's score stays up this long before the table goes back to attract. */
export const OVER_MS = 8000;
/** A player who stops touching for this long lets the balls drain and leaves. */
export const LEAVE_MS = 30_000;
/** Longest wait for the balls to drain after a player leaves. */
export const LEAVE_DRAIN_MS = 12_000;

/** A deck shot climbs off the top of the table for this long before it reaches the screen. */
export const CLIMB_MS = 420;
/** A ball falling into a deck hole takes this long to leave the bottom of the screen. */
export const FALL_MS = 380;
/** A returning ball takes this long down the table's return tube. */
export const RETURN_MS = 420;
/** Speed of a ball crossing between a table and the screen, table px per second. */
export const CROSS_V = 900;

/** The child band is the bottom 45 % of a table, the adult band the top 45 %. */
export const CHILD_BAND = 0.45;
export const ADULT_BAND = 0.45;
/** Pads keep this far from a seam, venue px. */
export const SEAM_MARGIN = 120;

/** A touch this far beyond a ball's edge still picks it up, table px. */
export const GRAB_REACH = 70;
/** The fastest throw, as a share of the plunger's top speed. */
export const THROW_SHARE = 0.75;

/** Deck rules. Held and riding balls count towards DECK_MAX. */
export const DECK_MAX = 24;
export const DECK_GUIDE_MS = 20_000;
/** A ball on the deck this long in all, devices included, goes down at its next free moment. */
export const DECK_LIFE_MS = 60_000;
/** Every this many deck points, every playing table gets a bonus ball. */
export const RAIN_STEP = 40_000;

export const POINTS = {
  bumper: 100,
  sling: 10,
  lane: 500,
  lanes: 5000,
  inlane: 250,
  outlane: 500,
  target: 1000,
  spinner: 100,
  deck: 5000,
  orbit: 2500,
} as const;

export const DECK_POINTS = {
  bumper: 100,
  cluster: 100,
  shuttle: 150,
  big: 150,
  bigLevel: 500,
  bigBurst: 3000,
  mushroom: 10,
  star: 25,
  sling: 20,
  target: 500,
  targets: 5000,
  spinner: 50,
  magnet: 250,
  saucer: 500,
  vuk: 750,
  lock: 1000,
  multiball: 2000,
  orbit: 1500,
  loop: 1000,
  captive: 1000,
  nest: 5000,
  bubble: 500,
} as const;

/** Gifts from the deck's bubbles: shield, posts, double scoring, extra ball. */
export const GIFTS = ["shield", "posts", "double", "extra"] as const;
export type Gift = (typeof GIFTS)[number];
/** How long each lasts on the table, seconds (an extra ball just arrives). */
export const GIFT_S: Record<Gift, number> = { shield: 15, posts: 20, double: 20, extra: 0 };

export const MAX_MULTIPLIER = 5;

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

export const readConfig = (variant: string, options: OptionValues): Config => {
  const v: Variant = pick(variant, VARIANTS, "classic");
  const balls = Number(pick(String(options.balls ?? "3"), ["3", "5"], "3"));
  return {
    variant: v,
    theme: v === "classic" ? null : v,
    balls,
    deck: options.deck !== false,
    rain: options.rain !== false,
    gravity: 2300,
    grab: options.grab === true,
    tables: Number(pick(String(options.tables ?? WALL_DEFAULT), WALL_TABLES, WALL_DEFAULT)),
  };
};
