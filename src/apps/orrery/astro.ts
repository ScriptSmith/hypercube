/**
 * The astronomy, from textbook formulas. Pure; angles in degrees unless named otherwise.
 *
 * Time `t` is days since 2000-01-01 00:00 in Brisbane mean solar time, the model's one clock.
 * The Sun follows the low-precision solar formulas (mean longitude and anomaly, the equation of
 * centre for an orbit of eccentricity 0.0167), so perihelion falls in early January. The axis
 * leans towards ecliptic longitude 90° by `tilt`, the obliquity, and keeps that direction all
 * year; declination is then sin δ = sin ε sin λ. Day length counts the Sun's centre above the
 * horizon, without refraction: cos H₀ = -tan φ tan δ. The Moon moves with its mean motions: a
 * synodic month of 29.53 days, an orbit tilted 5.145° whose nodes turn backwards once in 18.6
 * years.
 */

export const DEG = Math.PI / 180;
export const EARTH_TILT = 23.44;
export const YEAR = 365.2422;
const ANOMALISTIC_YEAR = 365.2596;
export const ECC = 0.0167;
export const AU_KM = 149.598e6;
export const SYNODIC = 29.530589;
export const MOON_INCL = 5.145;
/** Degrees a day the Moon's nodes turn westwards: once round in 18.6 years. */
export const NODE_RATE = 0.0529539;
/** The model's clock is Brisbane's mean solar time. */
export const CLOCK_LON = 153.0;

const DAY_MS = 86_400_000;
const EPOCH_MS = Date.UTC(2000, 0, 1);
/** Brisbane mean solar time runs this many days ahead of universal time. */
const UT_OFFSET = CLOCK_LON / 360;
/** A mean new Moon: 2000-01-06 14:20 universal time. */
const NEW_MOON_UT = 5.59766;

export const norm360 = (a: number): number => ((a % 360) + 360) % 360;
/** In (-180, 180]. */
export const norm180 = (a: number): number => {
  const w = norm360(a);
  return w > 180 ? w - 360 : w;
};
const sin = (a: number) => Math.sin(a * DEG);
const cos = (a: number) => Math.cos(a * DEG);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Days since J2000.0 (2000-01-01 12:00 universal time) at model time t. */
const j2000 = (t: number): number => t - UT_OFFSET - 0.5;

/** Model time for a moment in ms since 1970 (a clock reading). */
export const timeOfMs = (ms: number): number => (ms - EPOCH_MS) / DAY_MS + UT_OFFSET;

// ---- The Sun ---------------------------------------------------------------------------------

/** The mean Sun's longitude, which also sets mean solar time. */
export const meanLongitude = (t: number): number => norm360(280.46 + (360 / YEAR) * j2000(t));

export const meanAnomaly = (t: number): number =>
  norm360(357.528 + (360 / ANOMALISTIC_YEAR) * j2000(t));

/** The Sun's ecliptic longitude: 0 at the March equinox, 90 at the June solstice. */
export const sunLongitude = (t: number): number => {
  const g = meanAnomaly(t);
  return norm360(
    meanLongitude(t) + ((2 * ECC) / DEG) * sin(g) + ((1.25 * ECC * ECC) / DEG) * sin(2 * g),
  );
};

/** Distance from the Sun to the Earth, km. */
export const sunDistanceKm = (t: number): number => {
  const g = meanAnomaly(t);
  const nu = g + ((2 * ECC) / DEG) * sin(g) + ((1.25 * ECC * ECC) / DEG) * sin(2 * g);
  return (AU_KM * (1 - ECC * ECC)) / (1 + ECC * cos(nu));
};

/** The Sun's declination for ecliptic longitude λ and tilt ε. */
export const declination = (lambda: number, tilt: number): number =>
  Math.asin(clamp(sin(tilt) * sin(lambda), -1, 1)) / DEG;

/** The Sun's right ascension for ecliptic longitude λ and tilt ε, 0 to 360. */
export const rightAscension = (lambda: number, tilt: number): number =>
  norm360(Math.atan2(cos(tilt) * sin(lambda), cos(lambda)) / DEG);

// ---- Seen from a place -----------------------------------------------------------------------

/**
 * The angle of Brisbane's meridian on the sky (local sidereal time, degrees) at time t with the
 * clock showing `hour`: at noon the mean Sun is on the meridian.
 */
export const meridianAngle = (t: number, hour: number): number =>
  norm360(meanLongitude(t) + (hour - 12) * 15);

/** Hour angle of something at right ascension α, from a place at longitude `lon`. */
export const hourAngle = (meridian: number, lon: number, alpha: number): number =>
  norm180(meridian + (lon - CLOCK_LON) - alpha);

export interface Horizontal {
  /** Degrees above the horizon. */
  alt: number;
  /** Degrees from north through east. */
  az: number;
}

/** East, north and up parts of the direction to something at declination δ and hour angle H. */
export const enu = (lat: number, dec: number, ha: number): [number, number, number] => [
  -cos(dec) * sin(ha),
  sin(dec) * cos(lat) - cos(dec) * cos(ha) * sin(lat),
  sin(dec) * sin(lat) + cos(dec) * cos(ha) * cos(lat),
];

export const horizontal = (lat: number, dec: number, ha: number): Horizontal => {
  const [e, n, u] = enu(lat, dec, ha);
  return { alt: Math.asin(clamp(u, -1, 1)) / DEG, az: norm360(Math.atan2(e, n) / DEG) };
};

/** Hours the Sun's centre is above the horizon, 0 (polar night) to 24 (polar day). */
export const dayLength = (lat: number, dec: number): number => {
  const num = sin(lat) * sin(dec);
  const den = cos(lat) * cos(dec);
  if (Math.abs(den) < 1e-12) return num > 0 ? 24 : num < 0 ? 0 : 12;
  const c = -num / den;
  if (c <= -1) return 24;
  if (c >= 1) return 0;
  return (2 * Math.acos(c)) / DEG / 15;
};

/** The Sun's height at noon; below zero means it stays down all day. */
export const noonAltitude = (lat: number, dec: number): number => 90 - Math.abs(lat - dec);

/** Where the Sun rises, degrees from north through east, or null on a day with no sunrise or sunset. */
export const riseAzimuth = (lat: number, dec: number): number | null => {
  const c = cos(lat);
  if (Math.abs(c) < 1e-12) return null;
  const v = sin(dec) / c;
  if (v <= -1 || v >= 1) return null;
  return Math.acos(v) / DEG;
};

/** Where the Sun sets: the mirror of where it rises. */
export const setAzimuth = (lat: number, dec: number): number | null => {
  const r = riseAzimuth(lat, dec);
  return r === null ? null : 360 - r;
};

export type Season = "summer" | "autumn" | "winter" | "spring";

/**
 * The season at a place: northern summer while the Sun is between about longitude 70° and 159°
 * (June to August), the reverse in the south. Null near the equator or with almost no tilt.
 */
export const seasonAt = (lat: number, lambda: number, tilt: number): Season | null => {
  if (tilt < 5 || Math.abs(lat) < 12) return null;
  const l = norm360(lambda);
  // Sun's longitude on 1 June, 1 September, 1 December and 1 March.
  const north: Season =
    l >= 70.6 && l < 158.6
      ? "summer"
      : l >= 158.6 && l < 248.9
        ? "autumn"
        : l >= 248.9 && l < 340.5
          ? "winter"
          : "spring";
  if (lat > 0) return north;
  return north === "summer"
    ? "winter"
    : north === "winter"
      ? "summer"
      : north === "autumn"
        ? "spring"
        : "autumn";
};

// ---- Dates -----------------------------------------------------------------------------------

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface CalendarDate {
  year: number;
  /** 0 to 11. */
  month: number;
  /** 1 to 31. */
  day: number;
}

export const dateOf = (t: number): CalendarDate => {
  const d = new Date(EPOCH_MS + Math.floor(t) * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
};

/** Model time at the start of a calendar day. */
export const timeOf = (year: number, month: number, day: number): number =>
  (Date.UTC(year, month, day) - EPOCH_MS) / DAY_MS;

/** The fraction of the year from 1 January, 0 to 1, for placing month marks. */
export const yearFraction = (t: number): number => {
  const { year } = dateOf(t);
  const start = timeOf(year, 0, 1);
  const end = timeOf(year + 1, 0, 1);
  return Math.max(0, Math.min(1, (t - start) / (end - start)));
};

/** The next time after t0 that the Sun reaches longitude `lambda`. */
export const nextSunAt = (t0: number, lambda: number): number => {
  let t = t0 + (norm360(lambda - sunLongitude(t0)) / 360) * YEAR;
  for (let i = 0; i < 4; i++) t += (norm180(lambda - sunLongitude(t)) / 360) * YEAR;
  return t < t0 ? t + YEAR : t;
};

// ---- The Moon --------------------------------------------------------------------------------

const NEW_MOON = NEW_MOON_UT + UT_OFFSET;

/** The Moon's angle from the Sun, eastwards: 0 new, 90 first quarter, 180 full. */
export const elongation = (t: number): number => norm360((360 * (t - NEW_MOON)) / SYNODIC);

/** The longitude of the Moon's ascending node, turning backwards. */
export const nodeLongitude = (t: number): number => norm360(125.0445 - NODE_RATE * j2000(t));

export const moonLongitude = (t: number): number => norm360(sunLongitude(t) + elongation(t));

/** The Moon's height above the plane of the Earth's orbit, for an orbit tilted `incl`. */
export const moonLatitude = (t: number, incl: number = MOON_INCL): number =>
  Math.asin(clamp(sin(incl) * sin(moonLongitude(t) - nodeLongitude(t)), -1, 1)) / DEG;

/** How much of the Moon's face is lit, 0 to 1. */
export const litFraction = (elong: number): number => (1 - cos(elong)) / 2;

export type Phase =
  | "new"
  | "waxing crescent"
  | "first quarter"
  | "waxing gibbous"
  | "full"
  | "waning gibbous"
  | "last quarter"
  | "waning crescent";

const PHASES: readonly Phase[] = [
  "new",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full",
  "waning gibbous",
  "last quarter",
  "waning crescent",
];

export const phaseOf = (elong: number): Phase =>
  PHASES[Math.floor(norm360(elong + 22.5) / 45) % 8]!;

export const PHASE_NAMES: Record<Phase, string> = {
  new: "New Moon",
  "waxing crescent": "Crescent",
  "first quarter": "First quarter",
  "waxing gibbous": "Gibbous",
  full: "Full Moon",
  "waning gibbous": "Gibbous",
  "last quarter": "Last quarter",
  "waning crescent": "Crescent",
};

export const waxing = (elong: number): boolean => norm360(elong) < 180;

/** The Moon's ecliptic position as a right ascension and declination for tilt ε. */
export const eclipticToEquatorial = (
  lambda: number,
  beta: number,
  tilt: number,
): { ra: number; dec: number } => {
  const x = cos(beta) * cos(lambda);
  const y = cos(beta) * sin(lambda) * cos(tilt) - sin(beta) * sin(tilt);
  const z = cos(beta) * sin(lambda) * sin(tilt) + sin(beta) * cos(tilt);
  return { ra: norm360(Math.atan2(y, x) / DEG), dec: Math.asin(clamp(z, -1, 1)) / DEG };
};

/**
 * Which way the Moon's lit side faces as someone at the place sees it, as an angle in their view
 * with 0 to the right and 90 up: from the Moon towards the Sun across the sky.
 */
export const limbAngle = (
  sun: readonly [number, number, number],
  moon: readonly [number, number, number],
): number => {
  const [mx, my, mz] = moon;
  const sm = sun[0] * mx + sun[1] * my + sun[2] * mz;
  // Towards the Sun, and up, along the sky at the Moon.
  const tx = sun[0] - sm * mx;
  const ty = sun[1] - sm * my;
  const tz = sun[2] - sm * mz;
  const ux = -mz * mx;
  const uy = -mz * my;
  const uz = 1 - mz * mz;
  // Right as you face the Moon: moon x up.
  const rx = my * uz - mz * uy;
  const ry = mz * ux - mx * uz;
  const rz = mx * uy - my * ux;
  const a = Math.atan2(tx * ux + ty * uy + tz * uz, tx * rx + ty * ry + tz * rz) / DEG;
  return Number.isFinite(a) ? norm360(a) : 0;
};

// ---- Eclipses --------------------------------------------------------------------------------

/**
 * Largest distance of the Moon from the plane of the Earth's orbit, at new or full Moon, for an
 * eclipse: the Moon's shadow then touches the Earth somewhere, or the Moon enters the Earth's
 * dark shadow.
 */
export const SOLAR_LIMIT = 1.5;
export const LUNAR_LIMIT = 1.0;

/** The new or full Moon nearest t. */
export const nearestSyzygy = (t: number, kind: "new" | "full"): number => {
  const target = kind === "new" ? 0 : 180;
  return t + (norm180(target - elongation(t)) / 360) * SYNODIC;
};

export type EclipseKind = "solar" | "lunar";

/** Is the new or full Moon nearest t an eclipse, for an orbit tilted `incl`? */
export const isEclipse = (t: number, kind: EclipseKind, incl: number = MOON_INCL): boolean => {
  const s = nearestSyzygy(t, kind === "solar" ? "new" : "full");
  return Math.abs(moonLatitude(s, incl)) < (kind === "solar" ? SOLAR_LIMIT : LUNAR_LIMIT);
};

/**
 * The eclipse under way near t: within `window` days of a new or full Moon that is one.
 */
export const eclipseNear = (t: number, incl: number, window = 0.8): EclipseKind | null => {
  for (const kind of ["solar", "lunar"] as const) {
    const s = nearestSyzygy(t, kind === "solar" ? "new" : "full");
    if (Math.abs(s - t) <= window && isEclipse(s, kind, incl)) return kind;
  }
  return null;
};

/** The middle of the next eclipse season after t0: the Sun lined up with a node. */
export const nextSeason = (t0: number): number => {
  // The Sun gains on the node by 360° in an eclipse year.
  const eclipseYear = 360 / (360 / YEAR + NODE_RATE);
  const gap = norm180(sunLongitude(t0) - nodeLongitude(t0));
  // Time until the Sun-node angle reaches the next multiple of 180.
  const toNext = ((180 - (norm360(gap) % 180)) / 360) * eclipseYear;
  let t = t0 + toNext;
  for (let i = 0; i < 3; i++) {
    const d = norm180(sunLongitude(t) - nodeLongitude(t));
    const off = Math.abs(d) > 90 ? norm180(d - 180) : d;
    t -= (off / 360) * eclipseYear;
  }
  return t;
};
