/**
 * What bodies are made of. Masses are in solar masses and keep their real order (a star far
 * heavier than a gas giant, a gas giant far heavier than a rocky planet); the ratios are squeezed
 * where the view needs it. Sizes are exaggerated so everything shows, but every solid body has a
 * volume, so merged bodies grow by volume. Tidal (Roche) limits use each kind's real density, so
 * they come out at the right number of the primary's radii. Stars sit on the main sequence: their
 * radius, temperature and brightness follow their mass.
 */

export type Kind = "rock" | "planet" | "giant" | "star" | "hole";

/** What a slingshot can throw, smallest first. */
export const PICKS = ["rock", "planet", "giant", "star"] as const;
export type Pick = (typeof PICKS)[number];

/** Typical masses, in solar masses. */
export const MASS: Record<Pick, number> = {
  rock: 1e-5,
  planet: 1.5e-4,
  giant: 3e-3,
  star: 0.5,
};

/** Class limits by mass. A gas giant past GIANT_MAX ignites; a star past STAR_MAX collapses. */
export const ROCK_MAX = 5e-5;
export const PLANET_MAX = 1e-3;
export const GIANT_MAX = 0.08;
export const STAR_MAX = 4;
/** Share of a collapsing star's mass left in the black hole; the rest blows off as a shell. */
export const REMNANT = 0.45;

/** Radii at the typical masses, as shares of the scene's length unit. */
const SIZE: Record<Exclude<Pick, "star">, number> = { rock: 0.012, planet: 0.022, giant: 0.034 };
/** The sun's radius as a share of the length unit. */
export const SUN_R = 0.085;
const HOLE_R = 0.02;

/** Real densities (g/cm3), for tidal limits only. */
const RHO = { rock: 3, planet: 5.5, giant: 1.3 } as const;

export const isSolid = (k: Kind) => k === "rock" || k === "planet" || k === "giant";

/** The class a solid body of this mass belongs to. */
export const solidKind = (m: number): "rock" | "planet" | "giant" =>
  m < ROCK_MAX ? "rock" : m < PLANET_MAX ? "planet" : "giant";

/** Volume (radius cubed, in length units) of a fresh solid body of mass m. */
export const solidVolume = (kind: "rock" | "planet" | "giant", m: number): number =>
  SIZE[kind] ** 3 * (m / MASS[kind]);

/** Main-sequence radius in length units: about m^0.8 above a solar mass, flatter below. */
export const starRadius = (m: number): number => SUN_R * (m >= 1 ? m ** 0.8 : m ** 0.45);

/** A black hole's horizon as drawn, in length units: grows with mass, gently. */
export const holeRadius = (m: number): number => HOLE_R * Math.cbrt(m);

// ---- True sizes ----------------------------------------------------------------------------

const SUN_KG = 1.989e30;
const SUN_KM = 696_000;

/** The real radius in km of a solid of m suns and density rho (g/cm3): a sphere of that mass. */
export const solidRadiusKm = (m: number, rho: number): number =>
  Math.cbrt((3 * m * SUN_KG) / (4 * Math.PI * rho * 1000)) / 1000;

/** A main-sequence star's real radius in km: about the sun's times M^0.8. */
export const starRadiusKm = (m: number): number => SUN_KM * m ** 0.8;

/** A black hole's real horizon, 2GM/c^2: about 2.95 km per solar mass. */
export const holeRadiusKm = (m: number): number => 2.953 * m;

/** Surface temperature on the main sequence, kelvin. */
export const starTemp = (m: number): number => Math.max(2400, Math.min(40_000, 5772 * m ** 0.55));

/**
 * The temperature a star is drawn at. A little cooler than its own, so the sun reads as the warm
 * yellow-white people expect rather than paper white; the order of colours is unchanged.
 */
export const shownTemp = (m: number): number => starTemp(m) * 0.82;

/** Luminosity in suns. */
export const starLum = (m: number): number => Math.min(1e5, m ** 3.5);

/** Density for tidal limits: real for solids, falling with mass for stars. */
export const densityOf = (kind: Kind, m: number): number => {
  if (kind === "star") return Math.max(0.05, Math.min(80, 1.41 * m ** -1.4));
  if (kind === "hole") return 1e6;
  return RHO[kind];
};

/** The density of a solid made from two, by volume: mass over the sum of their real volumes. */
export const mixDensity = (m1: number, rho1: number, m2: number, rho2: number) =>
  (m1 + m2) / (m1 / rho1 + m2 / rho2);

/** Real density for a fresh solid body. */
export const solidDensity = (kind: "rock" | "planet" | "giant") => RHO[kind];

// ---- Colour --------------------------------------------------------------------------------

/**
 * Black-body colours. Planck's law weighted by the CIE 1931 matching functions (the piecewise
 * Gaussian fit of Wyman, Sloan and Shirley, 2013), converted to sRGB and scaled so the
 * brightest channel is full. A little extra saturation so a red dwarf, the sun and a blue giant
 * read apart from across a room.
 */
const gauss = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

const cie = (nm: number): [number, number, number] => [
  1.056 * gauss(nm, 599.8, 37.9, 31) +
    0.362 * gauss(nm, 442, 16, 26.7) -
    0.065 * gauss(nm, 501.1, 20.4, 26.2),
  0.821 * gauss(nm, 568.8, 46.9, 40.5) + 0.286 * gauss(nm, 530.9, 16.3, 31.1),
  1.217 * gauss(nm, 437, 11.8, 36) + 0.681 * gauss(nm, 459, 26, 13.8),
];

const planck = (nm: number, t: number) => {
  const l = nm * 1e-9;
  // 2hc^2 / l^5 / (exp(hc / (l k T)) - 1); constants folded, only ratios matter.
  return 1 / (l ** 5 * (Math.exp(0.014388 / (l * t)) - 1));
};

const encode = (c: number) => {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};

const SATURATE = 1.55;

const blackbody = (t: number): number => {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const p = planck(nm, t);
    const [x, y, z] = cie(nm);
    X += p * x;
    Y += p * y;
    Z += p * z;
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);
  const grey = (r + g + b) / 3;
  r = grey + (r - grey) * SATURATE;
  g = grey + (g - grey) * SATURATE;
  b = grey + (b - grey) * SATURATE;
  const top = Math.max(r, g, b, 1e-30);
  const ch = (v: number) => Math.round(encode(Math.max(0, v) / top) * 255);
  return (ch(r) << 16) | (ch(g) << 8) | ch(b);
};

const T_LO = 800;
const T_HI = 40_000;
const STEPS = 96;
const TABLE: number[] = Array.from({ length: STEPS }, (_, i) =>
  blackbody(T_LO * (T_HI / T_LO) ** (i / (STEPS - 1))),
);

/** Index into the colour table for a temperature, for sprite caching. */
export const tempIndex = (t: number): number =>
  Math.max(
    0,
    Math.min(STEPS - 1, Math.round((Math.log(t / T_LO) / Math.log(T_HI / T_LO)) * (STEPS - 1))),
  );

export const tempRgb = (t: number): number => TABLE[tempIndex(t)]!;
export const tableRgb = (i: number): number => TABLE[Math.max(0, Math.min(STEPS - 1, i))]!;

// ---- Looks ---------------------------------------------------------------------------------

/** Gas giants: base, then bands lighter and darker. Ours, loosely after the solar system's. */
export const GIANT_LOOKS: readonly (readonly number[])[] = [
  [0xc9a47a, 0xeedcb8, 0x9a6c48, 0xe2c69a, 0x7e5236],
  [0xd6bf8a, 0xece0b6, 0xb49860, 0xe4d2a0, 0xa08850],
  [0x86c4d2, 0xb2e2ea, 0x68a8bc, 0x9ed2de, 0x5a96aa],
  [0x5a7cd0, 0x86a4e4, 0x4664b4, 0x7898dc, 0x3a54a0],
];

/** Rocky planets: ground, a second ground, and clouds or ice. */
export const PLANET_LOOKS: readonly (readonly number[])[] = [
  [0x3f74b0, 0x5c8a52, 0xe8eef6],
  [0xb0623a, 0x8c4a2e, 0xe0b090],
  [0xb89c64, 0x8e7444, 0xe6dcc0],
  [0x8a8a86, 0x6a6864, 0xc8c6c0],
  [0x5e8a7a, 0x3e6a5a, 0xdcece6],
];

export const ROCK_LOOKS: readonly (readonly number[])[] = [
  [0x8a8079, 0x6a625c],
  [0x9a8670, 0x76624e],
  [0x7a7a80, 0x5a5a62],
];

/** The main colour of a solid body, for its debris and its trail. */
export const solidRgb = (kind: "rock" | "planet" | "giant", look: number): number => {
  const set = kind === "giant" ? GIANT_LOOKS : kind === "planet" ? PLANET_LOOKS : ROCK_LOOKS;
  return set[look % set.length]![kind === "planet" ? 1 : 0]!;
};
