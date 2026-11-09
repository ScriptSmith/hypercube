import { DEFAULT_VENUE, type VenueProfile } from "../../core/venue";

/**
 * The sim's adjustable venue: how banks are built, and the sizes of the displays. Defaults
 * come from the venue profile (`DEFAULT_VENUE` with the sim's `venue` param or the operator's
 * remembered profile); each value has a short URL param of the same name.
 */
export interface VenueValues {
  /** Touch frames per bank. */
  count: number;
  /** Panels merged into each touch frame of a bank. */
  span: number;
  /** Screen pixel size. */
  sw: number;
  sh: number;
  /** Panel pixel size, physical size (m) and bottom edge above the floor (m). */
  pw: number;
  ph: number;
  pwm: number;
  phm: number;
  pb: number;
  /** Wall pixel size and physical size (m). */
  ww: number;
  wh: number;
  wwm: number;
  whm: number;
  /** Sphere feed pixel size, diameter (m) and lowest point above the floor (m). */
  spw: number;
  sph: number;
  spd: number;
  spb: number;
}

export type VenueKey = keyof VenueValues;

export interface VenueField {
  key: VenueKey;
  title: string;
  min: number;
  max: number;
  step: number;
}

/** The sim lets a frame merge more panels than the venue's machines can, for trying layouts. */
export const MAX_SPAN = 4;

export const VENUE_FIELDS: readonly VenueField[] = [
  { key: "count", title: "Frames per bank", min: 1, max: 20, step: 1 },
  { key: "span", title: "Panels per frame", min: 1, max: MAX_SPAN, step: 1 },
  { key: "sw", title: "Screen width px", min: 100, max: 16384, step: 1 },
  { key: "sh", title: "Screen height px", min: 100, max: 16384, step: 1 },
  { key: "pw", title: "Panel width px", min: 100, max: 8192, step: 1 },
  { key: "ph", title: "Panel height px", min: 100, max: 8192, step: 1 },
  { key: "pwm", title: "Panel width m", min: 0.1, max: 5, step: 0.01 },
  { key: "phm", title: "Panel height m", min: 0.1, max: 5, step: 0.01 },
  { key: "pb", title: "Panel bottom m", min: 0, max: 5, step: 0.01 },
  { key: "ww", title: "Wall width px", min: 100, max: 16384, step: 1 },
  { key: "wh", title: "Wall height px", min: 100, max: 16384, step: 1 },
  { key: "wwm", title: "Wall width m", min: 0.5, max: 40, step: 0.1 },
  { key: "whm", title: "Wall height m", min: 0.5, max: 20, step: 0.1 },
  { key: "spw", title: "Sphere feed width px", min: 100, max: 16384, step: 1 },
  { key: "sph", title: "Sphere feed height px", min: 100, max: 16384, step: 1 },
  { key: "spd", title: "Sphere diameter m", min: 0.2, max: 30, step: 0.1 },
  { key: "spb", title: "Sphere bottom m", min: 0, max: 30, step: 0.1 },
];

/** Display sizes, as opposed to the bank layout (`count`, `span`). These are remembered. */
export const DISPLAY_KEYS: readonly VenueKey[] = VENUE_FIELDS.map((f) => f.key).filter(
  (k) => k !== "count" && k !== "span",
);

export const defaultVenue = (v: VenueProfile = DEFAULT_VENUE): VenueValues => ({
  count: v.bankCount,
  span: 1,
  sw: v.screen.width,
  sh: v.screen.height,
  pw: v.panel.width,
  ph: v.panel.height,
  pwm: v.panel.widthM,
  phm: v.panel.heightM,
  pb: v.panel.bottomM,
  ww: v.wall.width,
  wh: v.wall.height,
  wwm: v.wall.widthM,
  whm: v.wall.heightM,
  spw: v.sphere.width,
  sph: v.sphere.height,
  spd: v.sphere.diameterM,
  spb: v.sphere.bottomM,
});

/** A value for `key` if `raw` parses and is in range, else null. */
export const parseVenueValue = (key: VenueKey, raw: string | null | undefined): number | null => {
  const field = VENUE_FIELDS.find((f) => f.key === key);
  if (!field || raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < field.min || n > field.max) return null;
  return field.step >= 1 ? Math.round(n) : n;
};

/**
 * Gap between a bank's top and the bottom of the screen above it, kept from the base profile
 * so the screen still sits just above the panels when their size changes.
 */
const screenGap = (base: VenueProfile): number =>
  Math.max(0, base.screen.bottomM - base.panel.bottomM - base.panel.heightM);

/** The venue profile these values describe, for `displayFor`, `reachFor` and the frames. */
export const profileOf = (v: VenueValues, base: VenueProfile = DEFAULT_VENUE): VenueProfile => ({
  ...base,
  bankCount: v.count * v.span,
  maxMerge: Math.max(base.maxMerge, v.span),
  panel: {
    ...base.panel,
    width: v.pw,
    height: v.ph,
    widthM: v.pwm,
    heightM: v.phm,
    bottomM: v.pb,
  },
  screen: {
    ...base.screen,
    width: v.sw,
    height: v.sh,
    bottomM: v.pb + v.phm + screenGap(base),
  },
  wall: { ...base.wall, width: v.ww, height: v.wh, widthM: v.wwm, heightM: v.whm },
  sphere: { ...base.sphere, width: v.spw, height: v.sph, diameterM: v.spd, bottomM: v.spb },
});
