/**
 * Chapter 10's physics (Cochran, Crick and Vand 1952): a helix of pitch P and radius r, seen
 * side on, scatters into layer lines 1/P apart, its strongest spots on each line moving out from
 * the middle so that, far out, they lie on an X whose arms lean at the helix's steepness α from
 * the upright, tan α = P / 2πr. Two strands, the second shifted along the axis by 3/8 of a turn
 * as in DNA, multiply layer line l by 2|cos(3πl/8)|, which is zero on the fourth (and twelfth).
 * Pure.
 *
 * The pattern itself comes from the diffraction engine, as the squared size of the 2D Fourier
 * transform of the helix's flat projection; a helix's fibre pattern is exactly that (the
 * projection-slice theorem).
 */
import { helixAtoms } from "../../engine/model";
import type { PatternJob } from "../../engine/pattern";

const DEG = Math.PI / 180;

/** DNA: 34 Å a turn, phosphates about 10 Å out, ten steps a turn, strands 3/8 of a turn apart. */
export const DNA = { pitch: 34, radius: 10, perTurn: 10, offset: 3 / 8 } as const;

export const RANGE = { pitch: [20, 60] as const, radius: [5, 15] as const };

/** The helix's length in the model, Å: long enough for sharp layer lines, short enough to fit. */
export const LENGTH = 200;
/**
 * Real-space Å per engine pixel, at any grid size, so the frame's and the screen's agree. Two Å
 * leaves room round the helix, which makes the pattern's pixels finer (1/span Å⁻¹ apart).
 */
export const A_PER_PX = 2;
/** The picture reaches |S| = 1/(2 × A_PER_PX) either way; it is shown out to this, Å⁻¹. */
export const S_VIEW = 0.17;
export const STOP = 0.012;
/** Each atom's soft width, Å: wide enough that the X's inner spots outshine the outer ripples. */
export const SIGMA = 1.6;

export interface HelixState {
  pitch: number;
  radius: number;
  strands: 1 | 2;
}

export const START: HelixState = { pitch: DNA.pitch, radius: DNA.radius, strands: 1 };

/** The angle of the X's arms from the upright, far from the middle, degrees: tan α = P / 2πr. */
export const armAngle = (pitch: number, radius: number): number =>
  Math.atan(pitch / (2 * Math.PI * radius)) / DEG;

/** Where |J_n(x)| first peaks, n = 1 to 12: the first zeros of J_n′ (DLMF §10.21). */
const FIRST_MAX = [
  1.8412, 3.0542, 4.2012, 5.3176, 6.4156, 7.5013, 8.5778, 9.6474, 10.7114, 11.7709, 12.8265,
  13.8788,
] as const;

/**
 * Row l's brightest inner spots, Å⁻¹ out from the upright line through the middle: the first
 * peak of J_l(2πrR) (Cochran, Crick and Vand 1952).
 */
export const innerSpot = (l: number, radius: number): number =>
  (FIRST_MAX[Math.max(1, Math.min(FIRST_MAX.length, Math.round(l))) - 1] ?? 0) /
  (2 * Math.PI * radius);

/**
 * The X as it looks: the angle from upright of a line through the middle fitted to the bright
 * inner spots of the rows in view (up to the fifth, out to `view` Å⁻¹ either way), degrees. Near
 * the middle these spots sit wider than α, so this is wider than `armAngle`, by 5 to 9° over the
 * chapter's range. Two strands leave out the rows they cancel or nearly so.
 */
export const visibleArm = (s: HelixState, view = S_VIEW): number => {
  let zz = 0;
  let rz = 0;
  for (let l = 1; l <= 5; l++) {
    const z = layerLine(l, s.pitch);
    const r = innerSpot(l, s.radius);
    if (z > view * 0.95 || r > view * 0.95) break;
    if (s.strands === 2 && strandFactor(l) < 0.2) continue;
    zz += z * z;
    rz += r * z;
  }
  return zz > 0 ? Math.atan(rz / zz) / DEG : armAngle(s.pitch, s.radius);
};

/** Layer line l's height in the pattern, Å⁻¹. */
export const layerLine = (l: number, pitch: number): number => l / pitch;

/** How strongly two strands shifted by `offset` of a turn keep layer line l, 0 to 1 (amplitude). */
export const strandFactor = (l: number, offset = DNA.offset): number =>
  Math.abs(Math.cos(Math.PI * l * offset));

/** Layer lines up to `max` that two DNA-like strands cancel. */
export const missingLines = (max: number, offset = DNA.offset): number[] =>
  Array.from({ length: max }, (_, i) => i + 1).filter((l) => strandFactor(l, offset) < 1e-9);

/** The model: the helix's atoms seen side on, its axis upright. */
export const helixModel = (s: HelixState) =>
  helixAtoms({
    pitch: s.pitch,
    radius: s.radius,
    strands: s.strands,
    offset: DNA.offset,
    perTurn: DNA.perTurn,
    turns: LENGTH / s.pitch,
    sigma: SIGMA,
  });

/** The engine job for a state at grid size n. */
export const patternJob = (s: HelixState, n: number): PatternJob => ({
  op: "pattern",
  n,
  span: n * A_PER_PX,
  source: { atoms: helixModel(s) },
  scale: "linear",
  stop: STOP,
  gain: 8,
});

export const keyOf = (s: HelixState, n: number): string =>
  `${n}:${s.pitch.toFixed(1)}:${s.radius.toFixed(1)}:${s.strands}`;

/** The screen's state: P and r in tenths of an Å, and the strands. */
export const STATE_RANGES = [
  [RANGE.pitch[0] * 10, RANGE.pitch[1] * 10],
  [RANGE.radius[0] * 10, RANGE.radius[1] * 10],
  [1, 2],
] as const;

export const encode = (s: HelixState): number[] => [
  Math.round(s.pitch * 10),
  Math.round(s.radius * 10),
  s.strands,
];

export const decode = (v: readonly number[]): HelixState => ({
  pitch: (v[0] ?? START.pitch * 10) / 10,
  radius: (v[1] ?? START.radius * 10) / 10,
  strands: v[2] === 2 ? 2 : 1,
});

/** The key move: the X has visibly changed angle, or there are two strands. */
export const ANGLE_CHANGE = 4;
export const keyMove = (s: HelixState): boolean =>
  s.strands === 2 ||
  Math.abs(armAngle(s.pitch, s.radius) - armAngle(START.pitch, START.radius)) >= ANGLE_CHANGE;
