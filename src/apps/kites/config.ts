import type { OptionValues } from "../../core/types";

export type Variant = "duo" | "single";
export type WindSetting = "gentle" | "breezy" | "gusty" | "live";

export interface Config {
  variant: Variant;
  wind: WindSetting;
  lat: number;
  lon: number;
  rings: boolean;
  tangles: boolean;
  /** Patches along a wall. */
  flyers: number;
}

const WINDS: readonly WindSetting[] = ["gentle", "breezy", "gusty", "live"];

/** The centre of Brisbane, where live wind is read unless the operator sets another place. */
export const DEFAULT_LAT = -27.47;
export const DEFAULT_LON = 153.03;

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => ({
  variant: variant === "single" ? "single" : "duo",
  wind: WINDS.includes(o.wind as WindSetting) ? (o.wind as WindSetting) : "breezy",
  lat: num(o.lat, -90, 90, DEFAULT_LAT),
  lon: num(o.lon, -180, 180, DEFAULT_LON),
  rings: o.rings !== false,
  tangles: o.tangles !== false,
  flyers: Math.round(num(o.flyers, 4, 8, 6)),
});

/** A kite nobody has touched for this long goes back to the autopilot. */
export const KITE_IDLE_MS = 20_000;
/** A bot leaves a kite alone for this long after a person touches it. */
export const BOT_YIELD_MS = 12_000;
/** A panel with no beacon from its screen for this long draws its own sky. */
export const SCREEN_GRACE_MS = 2200;
/** The screen sends its beacon this often. */
export const BEACON_MS = 500;
/** The screen drops a frame's kites this long after its last message (then fades them). */
export const DROP_MS = 3000;
export const FADE_MS = 900;
/** Kite messages a second from each touch frame. */
export const KITE_HZ = 15;
