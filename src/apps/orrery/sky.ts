/**
 * The shared state and what follows from it. Pure.
 *
 * The state is a date, a time of day, a tilt and, in the Moon variant, the flat-orbit switch and
 * how fast time passes. The date `day` is days since 2000-01-01 (it moves smoothly as wheels
 * turn); the clock `hour` is Brisbane's mean solar time. Together they make the moment
 * t = day + hour / 24 that the Sun and Moon are worked out for, so turning the time of day past
 * midnight moves the date on (see `addHours`) and the year wheel can move the date while the
 * clock stays at noon.
 */
import {
  CLOCK_LON,
  DEG,
  dateOf,
  dayLength,
  MONTHS,
  declination,
  eclipseNear,
  type EclipseKind,
  eclipticToEquatorial,
  elongation,
  enu,
  horizontal,
  type Horizontal,
  hourAngle,
  limbAngle,
  litFraction,
  meridianAngle,
  MOON_INCL,
  moonLatitude,
  moonLongitude,
  noonAltitude,
  nodeLongitude,
  type Phase,
  phaseOf,
  rightAscension,
  riseAzimuth,
  type Season,
  seasonAt,
  sunDistanceKm,
  sunLongitude,
} from "./astro";
import type { Place } from "./config";

export interface Sky {
  day: number;
  /** 0 to 24. */
  hour: number;
  /** Degrees, 0 to 90. */
  tilt: number;
  flat: boolean;
  /** Moon variant: index into MOON_SPEEDS. */
  speed: number;
}

export const momentOf = (s: Pick<Sky, "day" | "hour">): number => s.day + s.hour / 24;

/** Move the clock on by `h` hours (negative goes back), carrying whole days into the date. */
export const addHours = (
  s: Pick<Sky, "day" | "hour">,
  h: number,
): { day: number; hour: number } => {
  const total = s.hour + h;
  const days = Math.floor(total / 24);
  return { day: s.day + days, hour: total - days * 24 };
};

/** Set the clock to `hour`, the short way round from where it is, carrying the date. */
export const setHour = (
  s: Pick<Sky, "day" | "hour">,
  hour: number,
): { day: number; hour: number } => {
  let d = (((hour - s.hour) % 24) + 24) % 24;
  if (d > 12) d -= 24;
  return addHours(s, d);
};

export const copySky = (s: Sky): Sky => ({ ...s });

/** Everything about the Sun and the Earth that doesn't depend on where you stand. */
export interface Global {
  t: number;
  /** The Sun's ecliptic longitude. */
  lambda: number;
  dec: number;
  ra: number;
  distanceKm: number;
  /** Brisbane's meridian on the sky (local sidereal time). */
  meridian: number;
  /** Moon variant. */
  moon: {
    elong: number;
    lambda: number;
    beta: number;
    ra: number;
    dec: number;
    node: number;
    lit: number;
    phase: Phase;
    eclipse: EclipseKind | null;
  };
}

/** `incl` is the Moon's orbit tilt now, which eases to 0 when the orbit is flattened. */
export const globalOf = (s: Sky, incl: number = s.flat ? 0 : MOON_INCL): Global => {
  const t = momentOf(s);
  const lambda = sunLongitude(t);
  const elong = elongation(t);
  const mLambda = moonLongitude(t);
  const beta = moonLatitude(t, incl);
  const eq = eclipticToEquatorial(mLambda, beta, s.tilt);
  return {
    t,
    lambda,
    dec: declination(lambda, s.tilt),
    ra: rightAscension(lambda, s.tilt),
    distanceKm: sunDistanceKm(t),
    meridian: meridianAngle(t, s.hour),
    moon: {
      elong,
      lambda: mLambda,
      beta,
      ra: eq.ra,
      dec: eq.dec,
      node: nodeLongitude(t),
      lit: litFraction(elong),
      phase: phaseOf(elong),
      eclipse: eclipseNear(t, incl),
    },
  };
};

/** What someone standing at a place sees. */
export interface Local {
  lat: number;
  /** Hours of daylight today. */
  dayLength: number;
  /** The Sun's height at noon (negative: it stays down). */
  noonAlt: number;
  /** Where it rises, or null with no sunrise or sunset today. */
  riseAz: number | null;
  sun: Horizontal;
  /** The place's own mean solar time. */
  localHour: number;
  season: Season | null;
  moon: Horizontal & {
    /** The lit side's direction in the view, degrees: 0 right, 90 up. */
    limb: number;
  };
}

export const localOf = (s: Sky, g: Global, place: Place): Local => {
  const lat = place.lat;
  const ha = hourAngle(g.meridian, place.lon, g.ra);
  const mha = hourAngle(g.meridian, place.lon, g.moon.ra);
  const sunV = enu(lat, g.dec, ha);
  const moonV = enu(lat, g.moon.dec, mha);
  const localHour = (((s.hour + (place.lon - CLOCK_LON) / 15) % 24) + 24) % 24;
  return {
    lat,
    dayLength: dayLength(lat, g.dec),
    noonAlt: noonAltitude(lat, g.dec),
    riseAz: riseAzimuth(lat, g.dec),
    sun: horizontal(lat, g.dec, ha),
    localHour,
    season: seasonAt(lat, g.lambda, s.tilt),
    moon: { ...horizontal(lat, g.moon.dec, mha), limb: limbAngle(sunV, moonV) },
  };
};

/** Today's path of the Sun across the sky, `n` + 1 points through a whole turn of the Earth. */
export const sunPath = (lat: number, dec: number, n: number): Horizontal[] => {
  const out: Horizontal[] = [];
  for (let i = 0; i <= n; i++) out.push(horizontal(lat, dec, -180 + (360 * i) / n));
  return out;
};

/** Short text for a day length: "14 h", or "24 h" and "0 h" at the poles. */
export const dayText = (hours: number): string => `${Math.round(hours)} h`;

/** The Sun's noon height in words. */
export const noonText = (alt: number): string =>
  alt <= 0 ? "Sun stays down" : `Sun ${Math.round(alt)}° high`;

/** "27° S", "Equator", "North Pole". */
export const latText = (lat: number): string => {
  const a = Math.round(Math.abs(lat));
  if (a === 0) return "Equator";
  if (a >= 90) return lat > 0 ? "North Pole" : "South Pole";
  return `${a}° ${lat > 0 ? "N" : "S"}`;
};

export const radians = (deg: number): number => deg * DEG;

/** "21 December". */
export const dateText = (t: number): string => {
  const d = dateOf(t);
  return `${d.day} ${MONTHS[d.month]}`;
};
