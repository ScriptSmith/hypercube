/**
 * How high the sand stands. The ball is taken as a unit sphere cut by the collar into a chamber
 * above and a chamber below, and a level is a height in it: the sine of the latitude where the
 * sand's edge meets the glass. Volumes are those of the sphere's slices, so the share of sand
 * above the collar is the share of the run that is left, and what has gone from above is below.
 */
import { DEG } from "../../core/sphere";
import type { SphereInfo } from "../../core/types";

/** The collar covers the latitudes within this of the middle, radians. */
export const COLLAR_LAT = 7.5 * DEG;
/** Height of the collar's edges, where each chamber begins. */
export const COLLAR = Math.sin(COLLAR_LAT);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Volume of the unit ball below height `h`. */
const below = (h: number): number => Math.PI * (h + 1 - (h * h * h + 1) / 3);

/** Sand in the chamber above the collar when its level is `h`. */
export const upperVolume = (h: number): number => below(clamp(h, COLLAR, 1)) - below(COLLAR);

/** Sand in the chamber below the collar when its level is `h`. */
export const lowerVolume = (h: number): number => below(clamp(h, -1, -COLLAR));

/** All a chamber holds. */
export const CHAMBER = upperVolume(1);

const solve = (volume: (h: number) => number, target: number, lo: number, hi: number): number => {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 48; i++) {
    const mid = (a + b) / 2;
    if (volume(mid) < target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
};

export const upperLevel = (volume: number): number => solve(upperVolume, volume, COLLAR, 1);
export const lowerLevel = (volume: number): number => solve(lowerVolume, volume, -1, -COLLAR);

/**
 * The latitude the sand reaches at the start of a run: a little above what people see well, so
 * its edge comes into view early in the run. Kept to a range where the chamber looks full without
 * the last grains taking most of the day to leave a thin band.
 */
export const startLatitude = (sphere: SphereInfo): number =>
  clamp(sphere.view.top + 6 * DEG, 30 * DEG, 60 * DEG);

/** The sand a glass holds when it starts a run filled to `lat`. */
export const sandVolume = (lat: number): number => upperVolume(Math.sin(lat));

const SLICES = 400;

/**
 * The sand's level while the glass rolls over. The chamber that holds the sand starts underneath
 * (`angle` 0) and ends on top (`angle` π); the sand stays in it and stays level in the room.
 */
export const rollLevel = (volume: number, angle: number): number => {
  const ax = Math.sin(angle);
  // Upright either way, the chamber's own formula is exact.
  if (ax < 1e-4) return Math.cos(angle) > 0 ? lowerLevel(volume) : upperLevel(volume);
  // The chamber is the part of the ball on the far side of the collar's plane, which tilts with
  // the roll. Each level slice of it is a disc cut by a straight edge.
  const ay = -Math.cos(angle);
  const dy = 2 / SLICES;
  let sum = 0;
  for (let i = 0; i < SLICES; i++) {
    const y = -1 + (i + 0.5) * dy;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const edge = (COLLAR - ay * y) / ax;
    let area = 0;
    if (edge <= -r) area = Math.PI * r * r;
    else if (edge < r) area = r * r * Math.acos(edge / r) - edge * Math.sqrt(r * r - edge * edge);
    const slice = area * dy;
    if (sum + slice >= volume) return y - dy / 2 + (slice > 0 ? ((volume - sum) / slice) * dy : 0);
    sum += slice;
  }
  return 1;
};

export interface Levels {
  /** Sand level in the chamber above the collar and the one below; -2 when a chamber is empty. */
  upper: number;
  lower: number;
  /** How far the glass has rolled over, radians: 0 except while it turns. */
  roll: number;
}

export const EMPTY = -2;

const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * The levels for `left` (the share of sand still above) and `turn` (how far through turning over,
 * 1 when not turning). While the glass turns, the picture rolls from upside down to upright with
 * all the sand in the chamber that ends on top.
 */
export const levelsAt = (volume: number, left: number, turn: number, running: boolean): Levels => {
  if (!running) return { upper: EMPTY, lower: lowerLevel(volume), roll: 0 };
  if (turn < 1) {
    const done = smoother(clamp(turn, 0, 1));
    // The picture is drawn rolled back from upright by what is still to turn.
    return { upper: rollLevel(volume, Math.PI * done), lower: EMPTY, roll: Math.PI * (1 - done) };
  }
  const above = volume * clamp(left, 0, 1);
  return {
    upper: above > 0 ? upperLevel(above) : EMPTY,
    lower: above < volume ? lowerLevel(volume - above) : EMPTY,
    roll: 0,
  };
};
