/**
 * Where everything goes. The arcade is a Mercator strip round the ball (`createStrip`), with the
 * cabinets standing on its bottom edge and the floor below it, round the bottom pole, where won
 * prizes pile up. Sizes here are fractions of the strip's width, so a resize only rescales them;
 * the play area inside each cabinet is in physics units (u) and never changes with the feed.
 */
import { DEG } from "../../core/sphere";
import type { SphereInfo } from "../../core/types";

/** The cabinet's parts, as fractions of its height from the top of the marquee. */
export const PART = {
  marquee: { top: 0, bottom: 0.15, overhang: 0.035 },
  canopy: { top: 0.15, bottom: 0.19 },
  glass: { top: 0.19, bottom: 0.62 },
  ledge: { top: 0.62, bottom: 0.7, overhang: 0.025 },
  base: { top: 0.7, bottom: 0.965 },
  plinth: { top: 0.965, bottom: 1 },
  /** Side pillars either side of the glass. */
  pillar: 0.055,
} as const;

/** The visible play area's height, u; its width follows the room the cabinets have. */
export const PLAY_HEIGHT = 2.4;
export const PLAY_CANOPY = 0.85;
const PLAY_MIN = 2.6;
const PLAY_MAX = 5;
/** How much of its slot a cabinet's body may fill. */
const SLOT_FILL = 0.66;
/** Room left above the marquees, as a fraction of the strip's height. */
const HEADROOM = 0.03;

const STRIP_TOP = 25 * DEG;
const STRIP_BOTTOM = -50 * DEG;
const STRIP_MIN = 30 * DEG;
const LIMIT = 80 * DEG;

const mercator = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + lat / 2));
const unMercator = (m: number): number => 2 * Math.atan(Math.exp(m)) - Math.PI / 2;

export interface CabinetPlace {
  index: number;
  /** Longitude of the cabinet's middle, radians. */
  lon: number;
  /** Its middle across the strip, 0 to 1. */
  centre: number;
  /** The chute's side: -1 left, 1 right. */
  chute: -1 | 1;
}

export interface ArcadeLayout {
  /** The strip's latitudes, radians. */
  top: number;
  bottom: number;
  /** Strip height over its width. */
  aspect: number;
  /** Cabinet height and body width (pillars included), as fractions of the strip's width. */
  cabinetH: number;
  bodyW: number;
  /** Fraction of the strip's width per physics unit. */
  perU: number;
  play: { width: number; height: number; canopy: number };
  cabinets: CabinetPlace[];
  /** Latitude of the middle of the glass, radians. */
  glassLat: number;
  /** Metres on the ball per physics unit, at the glass. */
  metresPerU: number;
}

/** The strip's latitudes for a sphere: about 25° up to 50° down, inside the band people see. */
export const stripBand = (s: SphereInfo): { top: number; bottom: number } => {
  const viewTop = Math.min(s.view.top - 2 * DEG, LIMIT);
  const viewBottom = Math.max(s.view.bottom + 2 * DEG, -LIMIT);
  let top = Math.min(STRIP_TOP, viewTop);
  let bottom = Math.max(STRIP_BOTTOM, viewBottom);
  if (top - bottom < STRIP_MIN) {
    // Too short: grow it upwards and then downwards within the band people see, and only then
    // past it, as far as the feed allows.
    top = Math.min(viewTop, bottom + STRIP_MIN);
    bottom = Math.max(viewBottom, top - STRIP_MIN);
    if (top - bottom < STRIP_MIN) {
      top = Math.min(s.cover.top, LIMIT, bottom + STRIP_MIN);
      bottom = Math.max(s.cover.bottom, -LIMIT, top - STRIP_MIN);
    }
  }
  return { top, bottom };
};

/** Latitude at a fraction `f` of the way down a strip from `top` to `bottom`. */
export const latAt = (top: number, bottom: number, f: number): number => {
  const mt = mercator(top);
  return unMercator(mt - f * (mt - mercator(bottom)));
};

export const layoutArcade = (s: SphereInfo, count: number): ArcadeLayout => {
  const n = Math.max(1, Math.round(count));
  const { top, bottom } = stripBand(s);
  const aspect = (mercator(top) - mercator(bottom)) / (2 * Math.PI);
  const slot = 1 / n;
  let cabinetH = aspect * (1 - HEADROOM);
  const glassH = PART.glass.bottom - PART.glass.top;
  const sideW = 2 * PART.pillar;
  // The play area is as wide as the slot allows, within limits; then the cabinet shrinks if even
  // the narrowest play area would crowd its neighbours.
  const widthFor = (h: number) => {
    const perU = (glassH * h) / PLAY_HEIGHT;
    const want = (SLOT_FILL * slot - sideW * h) / perU;
    return { perU, width: Math.max(PLAY_MIN, Math.min(PLAY_MAX, want)) };
  };
  let fit = widthFor(cabinetH);
  const bodyOf = (h: number, w: number, perU: number) => w * perU + sideW * h;
  const most = 0.9 * slot - 2 * PART.marquee.overhang * cabinetH;
  if (bodyOf(cabinetH, fit.width, fit.perU) > most) {
    cabinetH *= most / bodyOf(cabinetH, fit.width, fit.perU);
    fit = widthFor(cabinetH);
  }
  const bodyW = bodyOf(cabinetH, fit.width, fit.perU);
  const cabinets: CabinetPlace[] = [];
  for (let i = 0; i < n; i++) {
    // The first cabinet faces longitude 0; the rest go round from there.
    const centre = (0.5 + i / n) % 1;
    cabinets.push({ index: i, lon: centre * 2 * Math.PI - Math.PI, centre, chute: i % 2 ? -1 : 1 });
  }
  // Fractions down the strip: the cabinets stand on its bottom edge.
  const cabTop = 1 - cabinetH / aspect;
  const glassMid = cabTop + ((PART.glass.top + PART.glass.bottom) / 2) * (cabinetH / aspect);
  const glassLat = latAt(top, bottom, glassMid);
  const metresPerU = fit.perU * 2 * Math.PI * s.radius * Math.cos(glassLat);
  return {
    top,
    bottom,
    aspect,
    cabinetH,
    bodyW,
    perU: fit.perU,
    play: { width: fit.width, height: PLAY_HEIGHT, canopy: PLAY_CANOPY },
    cabinets,
    glassLat,
    metresPerU,
  };
};

/** A cabinet's parts in strip px, with its body's left edge at x = 0 and the marquee top at 0. */
export interface CabinetBox {
  /** Pixels per physics unit. */
  k: number;
  height: number;
  bodyW: number;
  /** Extra room either side of the body for the marquee and ledge. */
  margin: number;
  glass: { x: number; y: number; w: number; h: number };
  /** Where the physics floor (y = 0) is, px from the top. */
  floorY: number;
  /** Rows of each part, px. */
  rows: Record<"marquee" | "canopy" | "glass" | "ledge" | "base" | "plinth", [number, number]>;
  /** What sizes the trim, the sign and its lights, px; the cabinet's height when absent. */
  scale?: number;
}

export const cabinetBox = (l: ArcadeLayout, stripWidth: number): CabinetBox => {
  const height = l.cabinetH * stripWidth;
  const k = l.perU * stripWidth;
  const pillar = PART.pillar * height;
  const glassW = l.play.width * k;
  const rows = {
    marquee: [PART.marquee.top, PART.marquee.bottom],
    canopy: [PART.canopy.top, PART.canopy.bottom],
    glass: [PART.glass.top, PART.glass.bottom],
    ledge: [PART.ledge.top, PART.ledge.bottom],
    base: [PART.base.top, PART.base.bottom],
    plinth: [PART.plinth.top, PART.plinth.bottom],
  } as const;
  const px = {} as CabinetBox["rows"];
  for (const [key, [a, b]] of Object.entries(rows)) {
    px[key as keyof typeof rows] = [a * height, b * height];
  }
  const margin = Math.ceil(Math.max(PART.marquee.overhang, PART.ledge.overhang) * height) + 2;
  return {
    k,
    height,
    bodyW: glassW + 2 * pillar,
    margin,
    glass: { x: pillar, y: px.glass[0], w: glassW, h: px.glass[1] - px.glass[0] },
    floorY: px.glass[1],
    rows: px,
  };
};
