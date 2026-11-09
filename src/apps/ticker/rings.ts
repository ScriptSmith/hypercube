/**
 * Where the rings go on the ball. Sizes are in metres on the surface and scale with the ball, so
 * a bigger or smaller sphere keeps the same look: on a 4 m ball the main ring's letters are
 * 0.4 m tall and crawl at 0.32 m/s.
 *
 * The main ring sits just below the equator for people across the room, the lower one about 35°
 * to 50° below it for people nearby and underneath, and the small third one round the bottom pole
 * for people right underneath. All of them stay inside the band people see well (`view`), and in
 * the Mercator range a `Strip` can draw. When they don't fit at their natural size they shrink
 * together.
 */
import { DEG } from "../../core/sphere";
import type { SphereInfo } from "../../core/types";

export type RingRole = "main" | "lower" | "pole";

export interface RingSpec {
  role: RingRole;
  /** Band latitudes, radians; `centre` is halfway. */
  top: number;
  bottom: number;
  centre: number;
  /** Capital letter height on the surface, metres. */
  letterM: number;
  /** Crawl speed on the surface at `centre`, metres a second. */
  speedM: number;
  /** Seconds for the point where new words appear to go once round, against the crawl. */
  printerTurnS: number;
  /** Longitude where new words first appear, radians. */
  printerLon: number;
}

interface Preferred {
  role: RingRole;
  centre: number;
  /** Letter height as a fraction of the radius. */
  letter: number;
  speed: number;
  printerTurnS: number;
  printerLon: number;
}

/** Speeds below are for a ball of this radius, metres; others scale with theirs. */
const REFERENCE_RADIUS = 2;
/** Band height over letter height: room for descenders and the chaser lights. */
export const BAND_OVER_LETTER = 1.75;
const GAP = 4 * DEG;
/** A `Strip` stays finite within 85° of the equator; keep a little margin. */
const STRIP_LIMIT = 84 * DEG;

const PREFERRED: Record<RingRole, Preferred> = {
  main: {
    role: "main",
    centre: -8 * DEG,
    letter: 0.2,
    speed: 0.32,
    printerTurnS: 480,
    printerLon: 130 * DEG,
  },
  lower: {
    role: "lower",
    centre: -42 * DEG,
    letter: 0.16,
    speed: 0.24,
    printerTurnS: 660,
    printerLon: -140 * DEG,
  },
  pole: {
    role: "pole",
    centre: -70 * DEG,
    letter: 0.12,
    speed: 0.176,
    printerTurnS: 380,
    printerLon: 60 * DEG,
  },
};

const ROLES: Record<1 | 2 | 3, RingRole[]> = {
  1: ["main"],
  2: ["main", "lower"],
  3: ["main", "lower", "pole"],
};

export const SPEEDS: Record<string, number> = { slow: 0.7, normal: 1, fast: 1.45 };

/**
 * The rings for a ball, top to bottom. `count` is 1 to 3; `speed` multiplies every ring's crawl.
 */
export const layoutRings = (sphere: SphereInfo, count: number, speed = 1): RingSpec[] => {
  const n = (count >= 3 ? 3 : count <= 1 ? 1 : 2) as 1 | 2 | 3;
  const prefs = ROLES[n].map((r) => PREFERRED[r]);
  const r = sphere.radius;
  const hi = Math.min(sphere.view.top, STRIP_LIMIT);
  const lo = Math.max(sphere.view.bottom, -STRIP_LIMIT);
  const room = Math.max(0, hi - lo);
  // A band's height in latitude is its height on the surface over the radius.
  const heights = prefs.map((p) => p.letter * BAND_OVER_LETTER);
  const need = heights.reduce((a, b) => a + b, 0) + GAP * (prefs.length - 1);
  const shrink = need > room ? room / need : 1;
  const gap = GAP * shrink;
  const h = heights.map((x) => x * shrink);

  // Each ring as near its preferred place as it can be, below the one above it.
  const tops: number[] = [];
  let ceiling = hi;
  prefs.forEach((p, i) => {
    const below = h.slice(i + 1).reduce((a, b) => a + b + gap, 0);
    const want = p.centre + h[i]! / 2;
    tops.push(Math.min(ceiling, Math.max(want, lo + h[i]! + below)));
    ceiling = tops[i]! - h[i]! - gap;
  });

  const scale = r / REFERENCE_RADIUS;
  return prefs.map((p, i) => {
    const top = tops[i]!;
    const bottom = top - h[i]!;
    return {
      role: p.role,
      top,
      bottom,
      centre: (top + bottom) / 2,
      letterM: p.letter * shrink * r,
      speedM: p.speed * scale * speed,
      printerTurnS: p.printerTurnS,
      printerLon: p.printerLon,
    };
  });
};
