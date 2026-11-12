/**
 * Where the rings of lettering go. Sizes are arcs on a ball of radius 1, so a bigger or smaller
 * ball keeps the same look.
 *
 * The time left runs round the collar, which nothing ever covers, for people across the room.
 * The operator's message runs round the lower chamber, where people nearby look up at it; the
 * heap's edge passes it early in a run and it lies on plain sand from then on. A small ring
 * round the bottom pole repeats the time for people right underneath.
 */
import { DEG } from "../../core/sphere";
import type { SphereInfo } from "../../core/types";
import { COLLAR_LAT } from "./levels";

export type RingRole = "collar" | "message" | "pole";

export interface RingPlace {
  role: RingRole;
  /** Latitude of the middle of the band, radians. */
  lat: number;
  /** Half the band's height as arc, which is also half its span in latitude. */
  half: number;
  /** How fast it crawls when it crawls, arc a second at `lat`. */
  speed: number;
}

/** The dark band let into the collar, which holds its lettering. */
export const INLAY_HALF = 4.25 * DEG;
const MESSAGE = { lat: -50 * DEG, half: 4.9 * DEG, speed: 0.11 };
const POLE = { lat: -72 * DEG, half: 3.6 * DEG, speed: 0.05 };
const GAP = 3 * DEG;
/** A ring round the pole is for people underneath, so the ball must be seen from there. */
const UNDERNEATH = -82 * DEG;

/** Letter size (the font's em) over the band's height. */
export const EM_OVER_BAND = 0.76;

export const layoutRings = (sphere: SphereInfo): RingPlace[] => {
  const out: RingPlace[] = [{ role: "collar", lat: 0, half: INLAY_HALF, speed: 0.09 }];
  const floor = Math.max(sphere.view.bottom, sphere.cover.bottom);
  const pole = floor <= UNDERNEATH;
  // The message keeps clear of the collar above and of the pole's ring or the feed's edge below.
  const top = -COLLAR_LAT - GAP;
  const bottom = pole ? POLE.lat + POLE.half + GAP : floor + GAP;
  const room = top - bottom;
  if (room >= MESSAGE.half) {
    const half = Math.min(MESSAGE.half, room / 2);
    const lat = Math.min(top - half, Math.max(bottom + half, MESSAGE.lat));
    out.push({ role: "message", lat, half, speed: MESSAGE.speed * (half / MESSAGE.half) });
  }
  if (pole) out.push({ role: "pole", ...POLE });
  return out;
};
