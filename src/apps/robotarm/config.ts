import type { OptionValues } from "../../core/types";

export type Variant = "tidy" | "stack";
export type Speed = "normal" | "slow";

export interface Config {
  variant: Variant;
  speed: Speed;
  guides: boolean;
  /** Arms on a wall, 1 to 3. Other frames always have one. */
  arms: number;
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "stack" ? "stack" : "tidy",
  speed: o.speed === "slow" ? "slow" : "normal",
  guides: o.guides !== false,
  arms: Math.min(3, Math.max(1, Math.round(num(o.arms, 2)))),
});

export const DEG = Math.PI / 180;

/** Simulation rate. */
export const HZ = 60;

/** On a wall of several arms, one nobody has touched for this long goes back to its demonstration. */
export const PEOPLE_IDLE_MS = 45_000;
/** Bots leave an arm alone for this long after a person touches its controls. */
export const BOT_YIELD_MS = 20_000;
/** The demonstration rests this long at home between cycles. */
export const DEMO_REST_MS = 2500;
