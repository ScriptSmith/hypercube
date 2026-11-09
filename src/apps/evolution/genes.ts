/**
 * What a fish inherits and how it looks. A fish shows its genes directly: body lightness, hue
 * (held to a natural range from orange-brown through gold and olive to green), how strongly
 * coloured it is (grey at 0), spots, stripes and the size of its markings. Floors are described
 * with the same six numbers, so a fish whose genes equal its floor's is as hidden as it can be.
 *
 * Colours are worked out in OKLab, a perceptual colour space, so the camouflage measure tracks
 * what eyes see. Everything here is a pure function.
 */
import type { Rng } from "../../core/types";
import { SPORT_SHARE } from "./config";

export const GENE_COUNT = 6;
export const G = { light: 0, hue: 1, tint: 2, spots: 3, stripes: 4, scale: 5 } as const;

/** Six numbers from 0 to 1, in the order of `G`. */
export type Genes = readonly number[];

export type FloorId = "sand" | "weed" | "mud" | "pebbles";
export const FLOORS: readonly FloorId[] = ["sand", "weed", "mud", "pebbles"];
/** Default floors by island, so neighbouring ponds start different. */
export const FLOOR_ROTATION: readonly FloorId[] = ["sand", "weed", "pebbles", "mud"];

/**
 * Floors as genes. Sand: pale gold with fine speckles. Weed: green with stems (stripes). Mud:
 * dark brown and plain. Pebbles: grey with big round stones (spots).
 */
export const FLOOR_GENES: Record<FloorId, Genes> = {
  sand: [0.8, 0.36, 0.45, 0.4, 0, 0.12],
  weed: [0.42, 0.78, 0.62, 0, 0.7, 0.5],
  mud: [0.18, 0.13, 0.32, 0.06, 0, 0.45],
  pebbles: [0.56, 0.4, 0.04, 0.85, 0, 0.85],
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Reflect into [0, 1], so mutation near an edge isn't biased towards it. */
const reflect = (v: number) => {
  let x = v;
  for (let i = 0; i < 4 && (x < 0 || x > 1); i++) x = x < 0 ? -x : 2 - x;
  return clamp01(x);
};

export const gaussian = (rng: Rng): number => {
  const u = Math.max(1e-12, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** A founder: every gene anywhere in its range. */
export const randomGenes = (rng: Rng): number[] =>
  Array.from({ length: GENE_COUNT }, () => rng.next());

/**
 * A hatchling's genes: its parent's, each nudged by a small random change. Now and then a
 * hatchling differs by more, as real mutations sometimes do; those odd ones are what selection
 * works with after the pond changes.
 */
export const mutate = (parent: Genes, sd: number, rng: Rng): number[] => {
  const k = rng.next() < SPORT_SHARE ? sd * 3 : sd;
  return parent.map((g) => reflect(g + gaussian(rng) * k));
};

export const toBytes = (g: Genes): number[] => g.map((v) => Math.round(clamp01(v) * 255));
export const fromBytes = (b: readonly number[]): number[] => b.map((v) => clamp01(v / 255));

/** Six genes as twelve hex digits, for messages. */
export const packGenes = (g: Genes): string =>
  toBytes(g)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const unpackGenes = (s: unknown): number[] | null => {
  if (typeof s !== "string" || !/^[0-9a-f]{12}$/.test(s)) return null;
  const out: number[] = [];
  for (let i = 0; i < GENE_COUNT; i++) out.push(Number.parseInt(s.slice(i * 2, i * 2 + 2), 16));
  return fromBytes(out);
};

// ---- Colour -------------------------------------------------------------------------------

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Hue range in OKLCH degrees: orange-brown to green. */
const HUE_LO = 50;
const HUE_HI = 150;

export const labOf = (g: Genes): Lab => {
  const L = 0.3 + 0.58 * clamp01(g[G.light] ?? 0);
  const h = ((HUE_LO + (HUE_HI - HUE_LO) * clamp01(g[G.hue] ?? 0)) * Math.PI) / 180;
  const C = 0.005 + 0.13 * clamp01(g[G.tint] ?? 0);
  return { L, a: C * Math.cos(h), b: C * Math.sin(h) };
};

const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** OKLab to sRGB bytes. */
export const rgbOf = (lab: Lab): [number, number, number] => {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, gg, b].map((c) => Math.round(clamp01(gamma(clamp01(c))) * 255)) as [
    number,
    number,
    number,
  ];
};

const css = ([r, g, b]: readonly number[]) => `rgb(${r},${g},${b})`;

/** Everything a drawing needs about how a fish (or a floor) looks. */
export interface Look {
  lab: Lab;
  body: string;
  /** Markings: the body colour, darker. */
  mark: string;
  /** A lighter shade for highlights and grains. */
  light: string;
  rgb: readonly [number, number, number];
  spots: number;
  stripes: number;
  /** Marking size, venue px: spot radius and half the stripe spacing. */
  size: number;
}

/** Venue px of the markings for a scale gene. */
export const markSize = (scale: number) => 3 + 15 * clamp01(scale);

export const lookOf = (g: Genes): Look => {
  const lab = labOf(g);
  const rgb = rgbOf(lab);
  const dark = rgbOf({ L: Math.max(0.12, lab.L - 0.2), a: lab.a * 1.15, b: lab.b * 1.15 });
  const light = rgbOf({ L: Math.min(0.97, lab.L + 0.1), a: lab.a * 0.9, b: lab.b * 0.9 });
  return {
    lab,
    body: css(rgb),
    mark: css(dark),
    light: css(light),
    rgb,
    spots: clamp01(g[G.spots] ?? 0),
    stripes: clamp01(g[G.stripes] ?? 0),
    size: markSize(g[G.scale] ?? 0),
  };
};

/** A tree line's colour: the fish's, lifted a little so dark fish still show on a dark wall. */
export const lineColor = (g: Genes): string => {
  const lab = labOf(g);
  return css(rgbOf({ L: 0.22 + lab.L * 0.82, a: lab.a * 1.1, b: lab.b * 1.1 }));
};

// ---- Camouflage ---------------------------------------------------------------------------

/**
 * How much a fish stands out from a floor: 0 when it matches exactly, about 1 for a typical
 * fish on the wrong floor, up to about 2.5. Colour difference counts most (OKLab distance, in
 * units of a clearly visible 0.3, with colourfulness weighted up because a tinted fish on grey
 * pebbles is easy to see), then pattern: spots and stripes against the floor's, and the size of
 * the markings while either has any.
 */
export const standout = (fish: Genes, floor: Genes): number => {
  const a = labOf(fish);
  const b = labOf(floor);
  const dE = Math.hypot(a.L - b.L, (a.a - b.a) * 2.4, (a.b - b.b) * 2.4);
  const spots = Math.abs((fish[G.spots] ?? 0) - (floor[G.spots] ?? 0));
  const stripes = Math.abs((fish[G.stripes] ?? 0) - (floor[G.stripes] ?? 0));
  const marked = Math.max(
    fish[G.spots] ?? 0,
    fish[G.stripes] ?? 0,
    floor[G.spots] ?? 0,
    floor[G.stripes] ?? 0,
  );
  const scale = Math.abs((fish[G.scale] ?? 0) - (floor[G.scale] ?? 0)) * marked;
  return dE / 0.3 + 0.5 * (spots + stripes) + 0.25 * scale;
};

/** The mean of some genes (for a pond's average colour), or null for none. */
export const meanGenes = (all: readonly Genes[]): number[] | null => {
  if (all.length === 0) return null;
  const out: number[] = Array.from({ length: GENE_COUNT }, () => 0);
  for (const g of all) for (let i = 0; i < GENE_COUNT; i++) out[i]! += g[i] ?? 0;
  return out.map((v) => v / all.length);
};
