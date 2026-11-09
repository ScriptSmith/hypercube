import type { OptionValues } from "../../core/types";

export type Variant = "build" | "flick";

export interface Config {
  variant: Variant;
  /** "colour": pads offer only the colour; shape and size come from the shell's seed. */
  recipe: "full" | "colour";
  aim: boolean;
  volley: boolean;
  pictograms: boolean;
  /** Quiet time before a sky starts its own show. */
  showAfterMs: number;
  /** Launch pads along a wall. */
  pads: 6 | 8;
}

export const readConfig = (variant: string, o: OptionValues): Config => {
  const show = typeof o.show === "number" && Number.isFinite(o.show) ? o.show : 30;
  return {
    variant: variant === "flick" ? "flick" : "build",
    recipe: o.recipe === "colour" ? "colour" : "full",
    aim: o.aim !== false,
    volley: o.volley !== false,
    pictograms: o.pictograms !== false,
    showAfterMs: Math.min(120, Math.max(10, show)) * 1000,
    pads: o.pads === "6" ? 6 : 8,
  };
};

/** Fewest milliseconds between launches from one pad. */
export const PAD_COOLDOWN_MS = 1200;
/** Launches within this window count towards one volley. */
export const VOLLEY_WINDOW_MS = 1000;
/** A panel with no screen on its side for this long switches to its own small sky. */
export const SCREEN_GRACE_MS = 2500;
/** Bursts last at most this long, trails included. */
export const MAX_BURST_S = 4;
