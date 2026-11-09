/**
 * Chapter 4's physics: N layers d apart, each reflecting a little of a beam of wavelength λ at
 * glancing angle θ. Neighbouring layers' waves differ in path by 2d sin θ, so the sum of N equal
 * waves, each that much behind the last, is
 *
 *   I = [sin(Nπm) / (N sin πm)]²,  m = 2d sin θ / λ,
 *
 * which is 1 when m is a whole number (nλ = 2d sin θ) and small elsewhere, the more so the more
 * layers. Pure.
 */
import { TUBES, type TubeId, TUBE_IDS } from "../../config";

const DEG = Math.PI / 180;

/** The extra path between neighbouring layers, in wavelengths. */
export const pathInWaves = (thetaDeg: number, d: number, lambda: number): number =>
  (2 * d * Math.sin(thetaDeg * DEG)) / lambda;

/** Brightness of the reflection, 0 to 1. */
export const intensity = (thetaDeg: number, d: number, lambda: number, layers: number): number => {
  const m = pathInWaves(thetaDeg, d, lambda);
  const s = Math.sin(Math.PI * m);
  if (Math.abs(s) < 1e-9) return 1;
  const v = Math.sin(layers * Math.PI * m) / (layers * s);
  return v * v;
};

/** The glancing angle of order n, degrees, or null past 90°. */
export const braggAngle = (n: number, d: number, lambda: number): number | null => {
  const s = (n * lambda) / (2 * d);
  return s > 1 ? null : Math.asin(s) / DEG;
};

/** The wheel settles on a whole number of waves when it comes within this many of one. */
export const SNAP_WAVES = 0.04;

/** θ moved onto the nearest whole number of waves (one or more) when it is within SNAP_WAVES. */
export const snapTheta = (thetaDeg: number, d: number, lambda: number): number => {
  const m = pathInWaves(thetaDeg, d, lambda);
  const n = Math.round(m);
  if (n < 1 || Math.abs(m - n) > SNAP_WAVES) return thetaDeg;
  return braggAngle(n, d, lambda) ?? thetaDeg;
};

/**
 * The whole number of waves the extra path holds (one or more), or null: within half the last
 * shown digit, so the figure never calls "1.01 waves" one wave, nor shows "1.00 waves".
 */
export const wholeWaves = (thetaDeg: number, d: number, lambda: number): number | null => {
  const m = pathInWaves(thetaDeg, d, lambda);
  const n = Math.round(m);
  return n >= 1 && Math.abs(m - n) < 0.005 ? n : null;
};

/** A flash worth calling one: a whole number of waves, at least one. */
export const flashing = (thetaDeg: number, d: number, lambda: number, layers: number): boolean =>
  pathInWaves(thetaDeg, d, lambda) > 0.5 && intensity(thetaDeg, d, lambda, layers) > 0.6;

export const LAYER_CHOICES = [2, 4, 8] as const;

export const RANGE = {
  theta: [2, 80] as const,
  d: [1, 3.5] as const,
};

export interface BraggState {
  theta: number;
  d: number;
  tube: TubeId;
  layers: number;
}

/** State for the screen: θ in tenths of a degree, d in hundredths of an Å, the tube, the layers. */
export const STATE_RANGES = [
  [RANGE.theta[0] * 10, RANGE.theta[1] * 10],
  [RANGE.d[0] * 100, RANGE.d[1] * 100],
  [0, TUBE_IDS.length - 1],
  [0, LAYER_CHOICES.length - 1],
] as const;

export const encode = (s: BraggState): number[] => [
  Math.round(s.theta * 10),
  Math.round(s.d * 100),
  TUBE_IDS.indexOf(s.tube),
  Math.max(0, LAYER_CHOICES.indexOf(s.layers as (typeof LAYER_CHOICES)[number])),
];

export const decode = (v: readonly number[]): BraggState => ({
  theta: (v[0] ?? 80) / 10,
  d: (v[1] ?? 234) / 100,
  tube: TUBE_IDS[v[2] ?? 0] ?? "copper",
  layers: LAYER_CHOICES[v[3] ?? 1] ?? 4,
});

export const lambdaOf = (tube: TubeId): number => TUBES[tube].lambda;

/** Aluminium's (1 1 1) layers, the running example. */
export const START: BraggState = { theta: 8, d: 2.338, tube: "copper", layers: 4 };
