/**
 * A bank's places: every touch frame stands at its own latitude, north at the left to south at
 * the right, evenly from 75° N to 75° S, all on Brisbane's meridian so they share the time of
 * day. The frame nearest Brisbane's latitude is Brisbane. Pure.
 */
import { BRISBANE } from "./config";

export const BANK_NORTH = 75;
export const BANK_SOUTH = -75;

export const bankLatitudes = (count: number): number[] => {
  const n = Math.max(1, Math.min(64, Math.round(count)));
  if (n === 1) return [BRISBANE.lat];
  const lats = Array.from(
    { length: n },
    (_, i) => BANK_NORTH + ((BANK_SOUTH - BANK_NORTH) * i) / (n - 1),
  );
  let best = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(lats[i]! - BRISBANE.lat) < Math.abs(lats[best]! - BRISBANE.lat)) best = i;
  }
  lats[best] = BRISBANE.lat;
  return lats;
};

/** This frame's latitude in a bank of `count`. */
export const bankLatitude = (pos: number, count: number): number => {
  const lats = bankLatitudes(Math.max(count, pos + 1));
  return lats[Math.max(0, Math.min(lats.length - 1, Math.round(pos)))]!;
};

export const isBrisbane = (lat: number): boolean => Math.abs(lat - BRISBANE.lat) < 0.05;
