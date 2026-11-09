import type { OptionValues } from "../../core/types";

export type Variant = "match" | "free";
export type Speed = "normal" | "slow";

export interface Config {
  variant: Variant;
  hints: boolean;
  speed: Speed;
  /** Harmonics on a solo wall: 6, 8 or 10. */
  harmonics: number;
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => {
  const h = Math.round(num(o.harmonics, 10));
  return {
    variant: variant === "free" ? "free" : "match",
    hints: o.hints !== false,
    speed: o.speed === "slow" ? "slow" : "normal",
    harmonics: h <= 6 ? 6 : h <= 8 ? 8 : 10,
  };
};

export const TAU = Math.PI * 2;

/** Simulation rate. */
export const HZ = 60;

/** Seconds for one turn of the fundamental. */
export const PERIOD_S: Record<Speed, number> = { normal: 6, slow: 10 };

/** Most harmonics any setup carries (a bank of ten pairs would be twenty). */
export const MAX_H = 20;

/** In `match`, a harmonic untouched for this long eases to the target by itself. */
export const AUTO_MS = 8000;
/** In `free`, a harmonic untouched for this long fades slowly to nothing. */
export const FREE_LIVE_MS = 60_000;
