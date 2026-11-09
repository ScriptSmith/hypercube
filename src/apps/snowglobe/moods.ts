/**
 * Day, dusk and night: the painted sky behind the scene, the tint of the water, the light, and
 * how bright the windows and lamps are. A change of time of day eases across while the blizzard
 * hides it. Colours are given as sRGB and held linear, as three.js wants them.
 */
import { Color } from "three";
import type { Mood } from "./show";

export interface MoodLook {
  zenith: Color;
  horizon: Color;
  /** The sky low down behind the mound. */
  low: Color;
  /** The water's tint with distance. */
  water: Color;
  /** The water thick with snow. */
  murk: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemi: number;
  key: Color;
  keyPower: number;
  /** Key light's height above the horizon, radians. */
  keyUp: number;
  /** Lit windows and bulbs, times their colour. */
  glow: number;
  /** The warm lights by windows and lamps. */
  lamps: number;
  /** Snow pressed against the glass in the pile, lit and deep. */
  pileLit: Color;
  pileDeep: Color;
  /** The mound's base against the bottom of the glass. */
  base: Color;
  /** Faint stars in the water behind the scene, 0 to 1. */
  stars: number;
  /** The snow's own light, so white chips stay white against a bright sky. */
  flakeGlow: number;
}

const c = (hex: string) => new Color(hex);

export const MOOD_LOOKS: Record<Mood, MoodLook> = {
  day: {
    zenith: c("#4c74b2"),
    horizon: c("#a9c3e0"),
    low: c("#c4d4e6"),
    water: c("#9fb7d4"),
    murk: c("#aab8cc"),
    hemiSky: c("#e8effc"),
    hemiGround: c("#7f8ca0"),
    hemi: 1.5,
    key: c("#fff1dc"),
    keyPower: 2.4,
    keyUp: 0.75,
    glow: 0.45,
    lamps: 0.25,
    pileLit: c("#c9d4e3"),
    pileDeep: c("#76849b"),
    base: c("#5b5752"),
    stars: 0,
    flakeGlow: 0.45,
  },
  dusk: {
    zenith: c("#232656"),
    horizon: c("#c98b84"),
    low: c("#86709a"),
    water: c("#5e5680"),
    murk: c("#7d7898"),
    hemiSky: c("#a39ccc"),
    hemiGround: c("#40384f"),
    hemi: 1.15,
    key: c("#ffb784"),
    keyPower: 1.6,
    keyUp: 0.28,
    glow: 1,
    lamps: 1,
    pileLit: c("#9d97b8"),
    pileDeep: c("#4c4766"),
    base: c("#45404a"),
    stars: 0.3,
    flakeGlow: 0.24,
  },
  night: {
    zenith: c("#060a1c"),
    horizon: c("#1c2b52"),
    low: c("#22355f"),
    water: c("#17223f"),
    murk: c("#384669"),
    hemiSky: c("#5c70a6"),
    hemiGround: c("#141b2d"),
    hemi: 0.75,
    key: c("#bccaff"),
    keyPower: 0.95,
    keyUp: 0.9,
    glow: 1.1,
    lamps: 1.25,
    pileLit: c("#5d6c90"),
    pileDeep: c("#28324b"),
    base: c("#2c2e38"),
    stars: 1,
    flakeGlow: 0.15,
  },
};

/** A mood being eased towards another. */
export const cloneLook = (m: MoodLook): MoodLook => ({
  ...m,
  zenith: m.zenith.clone(),
  horizon: m.horizon.clone(),
  low: m.low.clone(),
  water: m.water.clone(),
  murk: m.murk.clone(),
  hemiSky: m.hemiSky.clone(),
  hemiGround: m.hemiGround.clone(),
  key: m.key.clone(),
  pileLit: m.pileLit.clone(),
  pileDeep: m.pileDeep.clone(),
  base: m.base.clone(),
});

/** Move `cur` a fraction `k` of the way to `to`. */
export const easeLook = (cur: MoodLook, to: MoodLook, k: number): void => {
  for (const key of [
    "zenith",
    "horizon",
    "low",
    "water",
    "murk",
    "hemiSky",
    "hemiGround",
    "key",
    "pileLit",
    "pileDeep",
    "base",
  ] as const) {
    cur[key].lerp(to[key], k);
  }
  for (const key of ["hemi", "keyPower", "keyUp", "glow", "lamps", "stars", "flakeGlow"] as const) {
    cur[key] += (to[key] - cur[key]) * k;
  }
};
