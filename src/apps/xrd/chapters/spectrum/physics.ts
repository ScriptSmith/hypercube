/**
 * Chapter 1's numbers: the bands of the spectrum, things for scale, the tubes' lines and the
 * energy of one X-ray. Pure.
 *
 * A wavelength is held as its position on a log scale, p = log₁₀(λ / 1 m), from LONG (radio, a
 * little longer than a house) to SHORT (gamma rays, 1 pm). Band edges are NASA's "approximate
 * limits" (Imagine the Universe, "Wavelength, frequency, and energy"); E = hc / λ with
 * hc = 12.398 keV·Å (NIST CODATA).
 */
import { TUBES, TUBE_IDS, type TubeId } from "../../config";

export const LONG = Math.log10(30);
export const SHORT = -12;
export const SPAN = LONG - SHORT;

/** hc in keV·Å (exact since 2019, to five figures). */
export const HC = 12.398;

export type BandId =
  | "radio"
  | "microwave"
  | "infrared"
  | "visible"
  | "ultraviolet"
  | "xray"
  | "gamma";

export interface Band {
  id: BandId;
  /** The band runs from `from` (longer) down to `to` (shorter), as positions p. */
  from: number;
  to: number;
}

const EDGES: readonly [BandId, number][] = [
  ["radio", LONG],
  ["microwave", -1],
  ["infrared", -3],
  ["visible", Math.log10(700e-9)],
  ["ultraviolet", Math.log10(400e-9)],
  ["xray", -8],
  ["gamma", -11],
];

export const BANDS: readonly Band[] = EDGES.map(([id, from], i) => ({
  id,
  from,
  to: EDGES[i + 1]?.[1] ?? SHORT,
}));

export const bandAt = (p: number): Band =>
  BANDS.find((b) => p <= b.from && p >= b.to) ?? (p > LONG ? BANDS[0]! : BANDS[BANDS.length - 1]!);

export type ThingId = "house" | "person" | "bee" | "cell" | "virus" | "atom";

export interface Thing {
  id: ThingId;
  /** Its size, m: a house's height, a person's, a bee's length, a cell's or a virus's width, an atom's. */
  size: number;
}

/**
 * Things for scale, longest first. A two-storey house about 8 m, a person 1.7 m, a honeybee 1.5 cm,
 * a cell 10 µm, a flu virus about 100 nm, and an aluminium atom 2.86 Å (the gap between
 * touching atoms in the metal).
 */
export const THINGS: readonly Thing[] = [
  { id: "house", size: 8 },
  { id: "person", size: 1.7 },
  { id: "bee", size: 0.015 },
  { id: "cell", size: 10e-6 },
  { id: "virus", size: 100e-9 },
  { id: "atom", size: 2.86e-10 },
];

export const posOf = (meters: number): number => Math.log10(meters);
export const metersAt = (p: number): number => 10 ** p;
export const angstromsAt = (p: number): number => 10 ** (p + 10);

/** Energy of one photon, keV, at wavelength λ (Å). */
export const energyKeV = (lambdaA: number): number => HC / lambdaA;

/** The X-ray band, 0.01 to 10 nm on NASA's chart. */
export const isXray = (p: number): boolean => p <= -8 && p >= -11;

/** A tube's line as a position. */
export const tubePos = (id: TubeId): number => Math.log10(TUBES[id].lambda * 1e-10);

/** The tube whose line this is, within a hair, or null. */
export const tubeAt = (p: number): TubeId | null =>
  TUBE_IDS.find((id) => Math.abs(tubePos(id) - p) < 2e-4) ?? null;

/** Where the slider starts: green light, 530 nm. */
export const START = Math.log10(530e-9);

/**
 * How tall the watch view is, as log₁₀ of metres, for a wavelength at `p`: it rests on each thing
 * for scale (the thing filling about 60 % of the height) and moves quickly between them, so the
 * wave visibly stretches and shrinks over one thing before the view moves on to the next.
 */
export const VIEW_FILL = 0.62;
export const viewHeightAt = (p: number): number => {
  const stops = THINGS.map((t) => ({ p: posOf(t.size), h: posOf(t.size / VIEW_FILL) }));
  if (p >= stops[0]!.p) return stops[0]!.h;
  const last = stops[stops.length - 1]!;
  if (p <= last.p) return last.h;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (p <= a.p && p >= b.p) {
      const t = (a.p - p) / (a.p - b.p);
      // Flat at both stops: the view holds still on a thing while the wave changes over it.
      const e = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
      return a.h + (b.h - a.h) * e;
    }
  }
  return last.h;
};

/**
 * Where each thing sits, metres, with y up: the person stands beside the house, the bee by the
 * person's hand, the cell inside the bee, the virus at the cell's edge and the atom on the virus,
 * so the view can travel from each thing to the next as it shrinks.
 */
export const WORLD: Readonly<Record<ThingId, readonly [number, number]>> = (() => {
  const house = [0, 0] as const;
  const person = [5.2, -4 + 0.85] as const;
  const bee = [person[0] + 0.31, person[1] + 0.26] as const;
  const cell = [bee[0], bee[1]] as const;
  const virus = [cell[0] + 5.3e-6, cell[1]] as const;
  const atom = [virus[0] - 3.6e-8, virus[1]] as const;
  return { house, person, bee, cell, virus, atom };
})();

/** The watch view at `p`: its height (log₁₀ m) and its centre (m), easing from thing to thing. */
export const viewAt = (p: number): { h: number; cx: number; cy: number } => {
  const h = viewHeightAt(p);
  const stops = THINGS.map((t) => ({
    p: posOf(t.size),
    h: posOf(t.size / VIEW_FILL),
    at: WORLD[t.id],
  }));
  if (p >= stops[0]!.p) return { h, cx: stops[0]!.at[0], cy: stops[0]!.at[1] };
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (p <= a.p && p >= b.p) {
      const t = (a.p - p) / (a.p - b.p);
      const e = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
      // The next thing's offset from the centre shrinks smoothly as a share of the view, however
      // fast the view itself shrinks, so it never slips out of sight on the way.
      const k = (1 - e) * 10 ** (h - a.h);
      return { h, cx: b.at[0] + (a.at[0] - b.at[0]) * k, cy: b.at[1] + (a.at[1] - b.at[1]) * k };
    }
  }
  const last = stops[stops.length - 1]!;
  return { h, cx: last.at[0], cy: last.at[1] };
};

/** The thing the view is resting nearest, by the view's height. */
export const thingAt = (p: number): Thing => {
  const h = viewHeightAt(p);
  let best = THINGS[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of THINGS) {
    const d = Math.abs(posOf(t.size / VIEW_FILL) - h);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
};

const SUPER = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sig = (v: number) => v.toFixed(v >= 99.95 ? 0 : v >= 9.995 ? 1 : 2);

/** A wavelength as a person would say it: 8.0 m, 15 cm, 530 nm, 1.54 Å, 1.0 pm. */
export const formatLength = (meters: number): string => {
  const units: readonly [number, number, string][] = [
    [1, 1, "m"],
    [1e-2, 1e-2, "cm"],
    [1e-3, 1e-3, "mm"],
    [1e-6, 1e-6, "µm"],
    [1e-9, 1e-9, "nm"],
    [1e-11, 1e-10, "Å"],
    [0, 1e-12, "pm"],
  ];
  const [, scale, name] = units.find(([at]) => meters >= at * 0.9995) ?? units[units.length - 1]!;
  return `${sig(meters / scale)} ${name}`;
};

/** An energy in eV, keV or MeV, or in powers of ten below 1 eV. */
export const formatEnergy = (keV: number): string => {
  const eV = keV * 1000;
  if (eV >= 1e6) return `${sig(eV / 1e6)} MeV`;
  if (eV >= 1e3) return `${sig(eV / 1e3)} keV`;
  if (eV >= 1) return `${sig(eV)} eV`;
  const e = Math.floor(Math.log10(eV) + 1e-9);
  const m = eV / 10 ** e;
  const exp = String(Math.abs(e))
    .split("")
    .map((d) => SUPER[Number(d)])
    .join("");
  return `${m.toFixed(1)} × 10⁻${exp} eV`;
};

/** The screen's state: p in ten-thousandths of a decade (0.02 % in wavelength). */
export const STATE_STEP = 1e-4;
export const STATE_RANGES = [
  [Math.round(SHORT / STATE_STEP), Math.round(LONG / STATE_STEP)],
] as const;
export const encode = (p: number): number[] => [
  Math.max(STATE_RANGES[0][0], Math.min(STATE_RANGES[0][1], Math.round(p / STATE_STEP))),
];
export const decode = (v: readonly number[]): number =>
  v[0] === undefined ? START : v[0] * STATE_STEP;
