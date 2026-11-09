/**
 * How the ball is made, in its own frame: y runs from cap to cap, and longitude 0 faces +z.
 * Six gores, each a lune from cap to cap, meet under two round end caps. The shader draws the
 * same construction from these numbers; `regionOf` is its plain TypeScript twin for tests.
 */
import { DEG, type Vec3 } from "../../core/sphere";

export const GORES = 6;
export const GORE_WIDTH = (2 * Math.PI) / GORES;

/**
 * Angle from the ball's pole to the edge of each end cap. Real balls have caps about a fifth
 * of the ball's width across, which is 12° from the pole.
 */
export const CAP_RADIUS = 12 * DEG;

/** Half the width of a welded seam, as an angle on the ball. */
export const SEAM_HALF = 0.0075;

/** The valve sits on the cap at the ball's -y pole, the sand near the +y one. */
export const VALVE_POLE = -1;

/** Centre of the patch of sand, in the ball's frame, and how far it spreads (radians). */
export const SAND_POLAR = CAP_RADIUS + 0.075;
export const SAND_LON = 0.9;
export const SAND_SPREAD = 0.045;

export const sandCentre = (): Vec3 => {
  const lat = Math.PI / 2 - SAND_POLAR;
  const c = Math.cos(lat);
  return [c * Math.sin(SAND_LON), Math.sin(lat), c * Math.cos(SAND_LON)];
};

export type Region = { kind: "cap"; pole: 1 | -1 } | { kind: "gore"; index: number };

/** Which piece of vinyl a direction in the ball's frame lands on. */
export const regionOf = (d: Vec3): Region => {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const y = Math.max(-1, Math.min(1, d[1] / len));
  const polar = Math.PI / 2 - Math.abs(Math.asin(y));
  if (polar < CAP_RADIUS) return { kind: "cap", pole: y >= 0 ? 1 : -1 };
  const lon = Math.atan2(d[0], d[2]);
  const g = Math.floor((lon + Math.PI) / GORE_WIDTH);
  return { kind: "gore", index: ((g % GORES) + GORES) % GORES };
};
