import type { Station } from "../types";
import { type Band, MIN_BAND_VENUE_PX } from "./machine";

/** Minimum band height per station, in stage px at the current scale. Set by createStations. */
const minBands = new WeakMap<Station, () => number>();

export const trackMinBand = (station: Station, minBand: () => number): void => {
  minBands.set(station, minBand);
};

/**
 * The band every given player can reach: the intersection of their bands, for apps that lay
 * out one shared play area across several stations. Stations without a band (not yet
 * confirmed) are skipped, and the result is null when none has one.
 *
 * When the overlap is shorter than the minimum band height (or there is none), the result is
 * the top `minBand` of the band that reaches least high, usually a child's. A child cannot
 * stretch up but a taller player can reach down, and the top of the low band is the part
 * nearest everyone else.
 *
 * `minBand` is in stage px. It defaults to the stations' own minimum (400 venue px at the
 * current scale), or 400 for stations not made by `createStations`.
 */
export const commonBand = (stations: readonly Station[], minBand?: number): Band | null => {
  const bands: Band[] = [];
  let min = minBand ?? 0;
  for (const s of stations) {
    if (!s.band) continue;
    bands.push(s.band);
    if (minBand === undefined) min = Math.max(min, minBands.get(s)?.() ?? MIN_BAND_VENUE_PX);
  }
  const first = bands[0];
  if (!first) return null;
  let top = -Infinity;
  let bottom = Infinity;
  let low = first;
  for (const b of bands) {
    top = Math.max(top, b.top);
    bottom = Math.min(bottom, b.bottom);
    if (b.top > low.top) low = b;
  }
  if (bottom - top >= min) return { top, bottom };
  return { top: low.top, bottom: Math.min(low.bottom, low.top + min) };
};
