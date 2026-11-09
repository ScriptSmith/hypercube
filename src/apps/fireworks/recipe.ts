/**
 * What a shell is made of: a colour, a burst shape and a size. Everything here is preset; visitors
 * only choose among these, and pictograms come from the fixed set of four.
 */

export interface Color {
  id: string;
  hex: string;
  rgb: readonly [number, number, number];
}

const color = (id: string, hex: string): Color => {
  const n = Number.parseInt(hex.slice(1), 16);
  return { id, hex, rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] };
};

/** The six palette colours, then "mixed", which gives each star one of the six. */
export const COLORS: readonly Color[] = [
  color("red", "#ff3d2e"),
  color("gold", "#ffc63a"),
  color("green", "#44ff7c"),
  color("cyan", "#3ce8ff"),
  color("blue", "#5a7cff"),
  color("violet", "#d064ff"),
];
export const MIXED = COLORS.length;
export const COLOR_CHOICES = COLORS.length + 1;

/** Visitor shapes, in button order. Pictograms are the last four. */
export const SHAPE = {
  peony: 0,
  ring: 1,
  willow: 2,
  palm: 3,
  crossette: 4,
  heart: 5,
  star: 6,
  smiley: 7,
  flower: 8,
  /** Show and volley effects only. */
  cascade: 9,
  glitter: 10,
} as const;
export type ShapeId = (typeof SHAPE)[keyof typeof SHAPE];
export const ABSTRACT_SHAPES: readonly ShapeId[] = [
  SHAPE.peony,
  SHAPE.ring,
  SHAPE.willow,
  SHAPE.palm,
  SHAPE.crossette,
];
export const PICTOGRAMS: readonly ShapeId[] = [SHAPE.heart, SHAPE.star, SHAPE.smiley, SHAPE.flower];
export const MAX_SHAPE = SHAPE.glitter;

export const isPictogram = (s: number): boolean => s >= SHAPE.heart && s <= SHAPE.flower;

/** The shapes a pad offers, in cycle order. */
export const padShapes = (pictograms: boolean): readonly ShapeId[] =>
  pictograms ? [...ABSTRACT_SHAPES, ...PICTOGRAMS] : ABSTRACT_SHAPES;

/** Small, medium and large, as the 0..1 size the physics uses. */
export const SIZES = [0, 0.5, 1] as const;

export interface Recipe {
  /** 0..5 a palette colour, 6 mixed. */
  color: number;
  shape: ShapeId;
  /** 0 small .. 1 large. */
  size: number;
}

/** The colour of a pad: pads along a bank or wall run through the palette. */
export const padColor = (globalPad: number): number =>
  ((globalPad % COLORS.length) + COLORS.length) % COLORS.length;

export const defaultRecipe = (globalPad: number): Recipe => ({
  color: padColor(globalPad),
  shape: SHAPE.peony,
  size: SIZES[1],
});

/** Next item in a list after `current`, wrapping. Unknown values start at the first. */
export const cycle = <T>(list: readonly T[], current: T): T => {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length] as T;
};

/** A seeded shape for shells that have no recipe (flick, colour-only, bots, the show). */
export const randomShape = (r: number, r2: number, pictograms: boolean): ShapeId => {
  // Pictograms turn up now and then, not every few shells.
  if (pictograms && r2 < 0.12) return PICTOGRAMS[Math.floor(r * PICTOGRAMS.length)] ?? SHAPE.heart;
  return ABSTRACT_SHAPES[Math.floor(r * ABSTRACT_SHAPES.length)] ?? SHAPE.peony;
};

/** A second colour that goes with the first, for two-tone stars. */
export const partnerColor = (c: number, r: number): number => {
  if (c >= COLORS.length) return MIXED;
  const step = 1 + Math.floor(r * (COLORS.length - 1));
  return (c + step) % COLORS.length;
};
