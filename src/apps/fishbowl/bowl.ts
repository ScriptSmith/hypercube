/**
 * The bowl in its own units: the ball's centre at the origin, radius 1, y up, longitude 0
 * towards +z (as in `src/core/sphere.ts`). The scene group scales this to venue metres.
 */
import { DEG, wrapLon } from "../../core/sphere";
import type { SphereInfo } from "../../core/types";
import { clamp, TAU } from "./vec";

/** Height of the gravel's edge, where it meets the glass. */
export const GRAVEL_TOP = -0.88;
/** Radius of the gravel's top where it meets the glass. */
export const GRAVEL_EDGE = Math.sqrt(1 - GRAVEL_TOP * GRAVEL_TOP);
/** How far the middle of the gravel heap rises above its edge. */
export const GRAVEL_MOUND = 0.035;

/** Height of the gravel's top surface at a distance `r` from the axis. */
export const gravelHeight = (r: number): number => {
  const t = clamp(r / GRAVEL_EDGE, 0, 1);
  return GRAVEL_TOP + GRAVEL_MOUND * (1 - t * t);
};

/**
 * The water's surface: a little above the band people see well, so the meniscus and the air
 * above it sit in the cap nobody sees, and the silver underside of the surface fills the top
 * of what they do see.
 */
export const waterLevel = (sphere: Pick<SphereInfo, "view">): number =>
  Math.sin(clamp(sphere.view.top + 5 * DEG, 25 * DEG, 70 * DEG));

/** The radius of the water's surface where it meets the glass. */
export const surfaceRadius = (water: number): number => Math.sqrt(Math.max(0, 1 - water * water));

/** The glass, as far as anything inside reaches. */
export const GLASS = 0.995;

/** Three sides a third of a turn apart, one facing each of the viewers `SectorViews` uses. */
export const SIDES = 3;
export const sideCentre = (side: number): number => wrapLon((side * TAU) / SIDES);
export const sideOf = (lon: number): number => {
  const k = Math.round(wrapLon(lon) / (TAU / SIDES));
  return ((k % SIDES) + SIDES) % SIDES;
};
