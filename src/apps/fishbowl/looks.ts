/**
 * How each kind of fish is coloured, as linear RGB from sRGB colours. `kind` picks the markings
 * in the fish shader.
 */
import type { SpeciesId } from "./species";

type RGB = readonly [number, number, number];

export interface FishLook {
  kind: number;
  back: RGB;
  side: RGB;
  belly: RGB;
  fin: RGB;
  iris: RGB;
  /** How far long tails and fins stream behind the beat. */
  flow: number;
  /** Silvery sheen on the body, 0 to about 1. */
  sheen: number;
}

export const FISH_LOOKS: Record<SpeciesId, FishLook> = {
  goldfish: {
    kind: 0,
    back: [0.55, 0.09, 0.01],
    side: [0.95, 0.3, 0.02],
    belly: [0.95, 0.62, 0.2],
    fin: [0.95, 0.38, 0.06],
    iris: [0.75, 0.55, 0.12],
    flow: 0.4,
    sheen: 0.5,
  },
  fancy: {
    kind: 1,
    back: [0.85, 0.2, 0.02],
    side: [0.95, 0.32, 0.02],
    belly: [0.9, 0.86, 0.78],
    fin: [0.92, 0.7, 0.5],
    iris: [0.6, 0.55, 0.45],
    flow: 1.6,
    sheen: 0.5,
  },
  tetra: {
    kind: 2,
    back: [0.16, 0.2, 0.19],
    side: [0.36, 0.42, 0.42],
    belly: [0.79, 0.84, 0.86],
    fin: [0.55, 0.58, 0.58],
    iris: [0.55, 0.6, 0.62],
    flow: 0.3,
    sheen: 0.4,
  },
  cory: {
    kind: 3,
    back: [0.15, 0.19, 0.23],
    side: [0.16, 0.26, 0.1],
    belly: [0.84, 0.78, 0.68],
    fin: [0.6, 0.55, 0.42],
    iris: [0.45, 0.42, 0.3],
    flow: 0.3,
    sheen: 0.3,
  },
  puffer: {
    kind: 4,
    back: [0.3, 0.35, 0.06],
    side: [0.55, 0.55, 0.12],
    belly: [0.88, 0.85, 0.7],
    fin: [0.6, 0.6, 0.45],
    iris: [0.2, 0.55, 0.3],
    flow: 0.2,
    sheen: 0.2,
  },
  harlequin: {
    kind: 5,
    back: [0.46, 0.15, 0.09],
    side: [0.8, 0.3, 0.2],
    belly: [0.85, 0.62, 0.52],
    fin: [0.63, 0.12, 0.08],
    iris: [0.6, 0.6, 0.58],
    flow: 0.3,
    sheen: 0.45,
  },
  angel: {
    kind: 6,
    back: [0.48, 0.39, 0.19],
    side: [0.63, 0.66, 0.63],
    belly: [0.72, 0.74, 0.72],
    fin: [0.45, 0.46, 0.45],
    iris: [0.48, 0.03, 0.02],
    flow: 0.8,
    sheen: 0.8,
  },
  gourami: {
    kind: 7,
    back: [0.12, 0.09, 0.07],
    side: [0.24, 0.18, 0.13],
    belly: [0.42, 0.34, 0.26],
    fin: [0.42, 0.36, 0.3],
    iris: [0.4, 0.12, 0.05],
    flow: 0.6,
    sheen: 0.5,
  },
  pleco: {
    kind: 8,
    back: [0.04, 0.03, 0.02],
    side: [0.1, 0.065, 0.036],
    belly: [0.22, 0.2, 0.16],
    fin: [0.07, 0.055, 0.035],
    iris: [0.3, 0.25, 0.15],
    flow: 0.2,
    sheen: 0.15,
  },
};
