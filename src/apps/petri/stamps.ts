import { DIEHARD, GLIDER, LWSS, type Pattern, R_PENTOMINO } from "./life";

/**
 * Everything a visitor can put into a culture, per rule family. Rule 4: nothing here is drawn.
 * Life stamps are patterns that move or evolve (never still lifes or oscillators), slime food and
 * salt are the only pieces that stay put (few, far apart, eaten or dissolved), and reagent drops
 * grow into pattern because the presets avoid the stable-spot regime.
 */
export type Family = "life" | "slime" | "turing";
export const FAMILIES: readonly Family[] = ["life", "slime", "turing"];

export type StampKind = "pattern" | "soup" | "spore" | "food" | "salt" | "reagent" | "wash";

/** Children's stamps sit low; adults get the larger ones (or the dial) higher up. */
export type Band = "child" | "adult";

export interface StampDef {
  id: string;
  family: Family;
  kind: StampKind;
  band: Band;
  /** One or two plain words shown under its icon. */
  label: string;
  /** Venue px: the area it covers, for spacing, landing clamps and the splash. */
  radius: number;
  pattern?: Pattern;
  /** Soup: radius in cells and the share of cells alive. */
  soup?: { cells: number; density: number };
}

export const STAMPS: Record<Family, readonly StampDef[]> = {
  life: [
    {
      id: "soup",
      family: "life",
      kind: "soup",
      band: "child",
      label: "Soup",
      radius: 60,
      soup: { cells: 7, density: 0.45 },
    },
    {
      id: "glider",
      family: "life",
      kind: "pattern",
      band: "child",
      label: "Glider",
      radius: 24,
      pattern: GLIDER,
    },
    {
      id: "ship",
      family: "life",
      kind: "pattern",
      band: "adult",
      label: "Spaceship",
      radius: 36,
      pattern: LWSS,
    },
    {
      id: "bloom",
      family: "life",
      kind: "pattern",
      band: "adult",
      label: "Bloom",
      radius: 30,
      pattern: R_PENTOMINO,
    },
    {
      id: "spark",
      family: "life",
      kind: "pattern",
      band: "adult",
      label: "Firework",
      radius: 50,
      pattern: DIEHARD,
    },
  ],
  slime: [
    { id: "spore", family: "slime", kind: "spore", band: "child", label: "Spores", radius: 80 },
    { id: "food", family: "slime", kind: "food", band: "child", label: "Food", radius: 70 },
    { id: "salt", family: "slime", kind: "salt", band: "child", label: "Salt", radius: 80 },
  ],
  turing: [
    { id: "drop-m", family: "turing", kind: "reagent", band: "child", label: "Drop", radius: 42 },
    { id: "drop-s", family: "turing", kind: "reagent", band: "child", label: "Small", radius: 22 },
    { id: "drop-l", family: "turing", kind: "reagent", band: "child", label: "Big", radius: 80 },
    { id: "wash", family: "turing", kind: "wash", band: "child", label: "Wash", radius: 150 },
  ],
};

/** What a first touch drops: the first stamp of each family. */
export const defaultStamp = (family: Family): StampDef => STAMPS[family][0]!;

export const stampIndex = (family: Family, id: string): number =>
  STAMPS[family].findIndex((s) => s.id === id);

export const stampAt = (family: Family, index: number): StampDef | null =>
  Number.isInteger(index) ? (STAMPS[family][index] ?? null) : null;

export const stampsIn = (family: Family, band: Band): StampDef[] =>
  STAMPS[family].filter((s) => s.band === band);

export const isFamily = (v: unknown): v is Family =>
  typeof v === "string" && (FAMILIES as readonly string[]).includes(v);

/** Slime sensor settings, after Jones 2010. Angles in radians, lengths in trail texels. */
export interface SlimeParams {
  sensorAngle: number;
  turnAngle: number;
  sensorDist: number;
  step: number;
  deposit: number;
  decay: number;
}

/** Gray-Scott feed and kill rates (Pearson 1993), and the hue the dish shows them in. */
export interface TuringParams {
  feed: number;
  kill: number;
  hue: number;
}

export interface Preset<P> {
  id: string;
  /** One or two plain words shown with its icon on a dial. */
  label: string;
  params: P;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** From loose exploring to tight networks. */
export const SLIME_PRESETS: readonly Preset<SlimeParams>[] = [
  {
    id: "roam",
    label: "Wander",
    params: {
      sensorAngle: deg(60),
      turnAngle: deg(18),
      sensorDist: 10,
      step: 1.3,
      deposit: 0.9,
      decay: 0.86,
    },
  },
  {
    id: "web",
    label: "Web",
    params: {
      sensorAngle: deg(22.5),
      turnAngle: deg(45),
      sensorDist: 9,
      step: 1,
      deposit: 1,
      decay: 0.9,
    },
  },
  {
    id: "mesh",
    label: "Net",
    params: {
      sensorAngle: deg(40),
      turnAngle: deg(30),
      sensorDist: 16,
      step: 1.2,
      deposit: 1,
      decay: 0.92,
    },
  },
  {
    id: "tight",
    label: "Paths",
    params: {
      sensorAngle: deg(45),
      turnAngle: deg(12),
      sensorDist: 24,
      step: 1,
      deposit: 1.1,
      decay: 0.95,
    },
  },
];

/**
 * Regimes where a drop grows and fills space. The stable-spot regime (a drop settling into one
 * round spot that stays where it was put) is left out on purpose.
 */
export const TURING_PRESETS: readonly Preset<TuringParams>[] = [
  { id: "mitosis", label: "Spots", params: { feed: 0.026, kill: 0.061, hue: 0.52 } },
  { id: "coral", label: "Coral", params: { feed: 0.0545, kill: 0.062, hue: 0.08 } },
  { id: "worms", label: "Worms", params: { feed: 0.038, kill: 0.061, hue: 0.86 } },
  { id: "maze", label: "Maze", params: { feed: 0.029, kill: 0.057, hue: 0.33 } },
];

export const presetsOf = (family: Family): readonly Preset<SlimeParams | TuringParams>[] =>
  family === "slime" ? SLIME_PRESETS : family === "turing" ? TURING_PRESETS : [];

/** The word a dial shows for a condition. */
export const presetLabel = (family: Family, index: number): string =>
  presetsOf(family)[index]?.label ?? "";

export const presetCount = (family: Family): number =>
  family === "slime" ? SLIME_PRESETS.length : family === "turing" ? TURING_PRESETS.length : 0;

/** The condition each dial starts at and returns to. */
export const defaultPreset = (family: Family): number => (family === "slime" ? 1 : 0);

export const validPreset = (family: Family, v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < presetCount(family);
