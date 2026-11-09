import type { OptionValues } from "../../core/types";
import { VIEW_IDS, type ViewId } from "./views";

export interface Config {
  variant: "live" | "replay";
  /** Seconds per tour view. */
  tour: number;
  /** A fixed view, or null to tour. */
  view: ViewId | null;
  trails: boolean;
  /** Screens follow a random vehicle now and then. */
  follow: boolean;
}

export const STATIC_BASE = "https://brisbus.com/data/";
export const STATIC_TIMEOUT_MS = 90_000;
/** After a failed static load, try again after these waits, then give up until the next reload. */
export const STATIC_RETRY_MS = [5 * 60_000, 20 * 60_000, 60 * 60_000] as const;
/** Wait this long for live data before the replay plays. */
export const BOOT_WAIT_MS = 8000;

export const readConfig = (variant: string, options: OptionValues): Config => {
  const tour = Number(options.tour);
  const view = String(options.view ?? "tour");
  return {
    variant: variant === "replay" ? "replay" : "live",
    tour: Number.isFinite(tour) ? Math.max(20, Math.min(300, tour)) : 60,
    view: (VIEW_IDS as string[]).includes(view) ? (view as ViewId) : null,
    trails: options.trails !== false,
    follow: options.follow !== false,
  };
};
