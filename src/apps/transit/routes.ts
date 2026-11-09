/**
 * Modes, their colours (our own palette, not the operator's), and the featured lines that get
 * buttons. Lines are given by route ids and codes only; their names exist only at runtime.
 */
import { ROUTE_TYPE } from "./gtfs";

export type Mode = "bus" | "train" | "ferry";
export const MODES: readonly Mode[] = ["train", "bus", "ferry"];

export const MODE_COLOR: Record<Mode, string> = {
  bus: "#6fa4fc",
  train: "#f0e82a",
  ferry: "#fb5c99",
};

/** Mode colours mixed most of the way to the land colour, for the always-on base lines. */
export const MODE_DIM: Record<Mode, string> = {
  bus: dim(MODE_COLOR.bus),
  train: dim(MODE_COLOR.train),
  ferry: dim(MODE_COLOR.ferry),
};

function dim(hex: string): string {
  const land = [10, 15, 26];
  const c = rgb(hex).map((v, i) => Math.round(v * 255 * 0.32 + land[i]! * 0.68));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The same colours as 0..1 floats for the GPU. */
export const MODE_RGB: Record<Mode, [number, number, number]> = {
  bus: rgb(MODE_COLOR.bus),
  train: rgb(MODE_COLOR.train),
  ferry: rgb(MODE_COLOR.ferry),
};

export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const modeOfType = (type: number): Mode =>
  type === ROUTE_TYPE.rail ? "train" : type === ROUTE_TYPE.ferry ? "ferry" : "bus";

/** A guess from the id alone, for routes the static data doesn't list. */
export const guessMode = (base: string): Mode =>
  /^F\d+$/.test(base) ? "ferry" : /^[A-Z]{4}$/.test(base) ? "train" : "bus";

/** Rail route codes are two-letter origin and destination codes, such as "SHCL". */
const railEnds = (base: string): [string, string] | null =>
  /^[A-Z]{4}$/.test(base) ? [base.slice(0, 2), base.slice(2)] : null;

export interface Line {
  id: string;
  mode: Mode;
  /** Shown on the button: a route number. Empty for rail, whose codes mean nothing to visitors. */
  label: string;
  /** Does this route base belong to the line? */
  has(base: string): boolean;
}

const routeLine = (id: string, mode: Mode, bases: string[]): Line => ({
  id,
  mode,
  label: bases[0]!,
  has: (base) => bases.includes(base),
});

/** A rail line through the city: every service with either end at one of its termini. */
const railLine = (id: string, ends: string[]): Line => ({
  id,
  mode: "train",
  label: "",
  has(base) {
    const e = railEnds(base);
    return !!e && (ends.includes(e[0]) || ends.includes(e[1]));
  },
});

/**
 * Frequent services that cross the preset views: two busway routes, two inner bus routes, the
 * river ferry that runs the length of the river, and two cross-city rail lines.
 */
export const FEATURED: readonly Line[] = [
  routeLine("m1", "bus", ["M1"]),
  routeLine("m2", "bus", ["M2"]),
  routeLine("60", "bus", ["60"]),
  routeLine("199", "bus", ["199"]),
  routeLine("f1", "ferry", ["F1"]),
  railLine("rail-ne", ["SH", "CL"]),
  railLine("rail-nw", ["FG", "BN"]),
];

export const lineById = (id: string): Line | undefined => FEATURED.find((l) => l.id === id);
