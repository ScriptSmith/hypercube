import type { OptionValues } from "../../core/types";

export type Variant = "hockey" | "paddles" | "defence";
export type Side = 0 | 1;

export interface GameConfig {
  variant: Variant;
  /** Pucks (or balls) per adult lane, 1 to 3. Child lanes always have one. */
  pucks: number;
  /** Multiplier on every lane's speeds. */
  speed: number;
  /** Goals that win a match. */
  target: number;
  /** Wall only: a slow lane in the lowest strip for children. */
  childLane: boolean;
  /** Solo wall: several tables side by side, or one long table from end to end. */
  wall: "tables" | "long";
  /** Players on each side of a long table, or on each frame in versus (1 to 4). */
  players: number;
  /** A match also ends when this runs out. */
  matchMs: number;
}

export const MATCH_MS = 3 * 60_000;
/** The winner's celebration before the table returns to the lobby. */
export const OVER_MS = 6000;
export const COUNTDOWN_MS = 3000;
/** Bot-only matches (testing, `bots=`) skip most of the countdown. */
export const BOT_COUNTDOWN_MS = 1500;
/** A scored puck reappears on the conceding side after this long. */
export const RESPAWN_MS = 1100;

const SPEEDS: Record<string, number> = { slow: 0.75, normal: 1, fast: 1.3 };

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, options: OptionValues): GameConfig => ({
  variant: variant === "paddles" || variant === "defence" ? variant : "hockey",
  pucks: Math.min(3, Math.max(1, Math.round(num(options.pucks, 2)))),
  speed: SPEEDS[String(options.speed)] ?? 1,
  target: [3, 5, 7].includes(Number(options.target)) ? Number(options.target) : 7,
  childLane: options.childLane === true,
  wall: options.layout === "long" ? "long" : "tables",
  players: Math.min(4, Math.max(1, Math.round(num(options.players, 3)))),
  matchMs: MATCH_MS,
});
