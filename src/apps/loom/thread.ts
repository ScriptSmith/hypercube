/**
 * The threads. Each harmonic's thread is a wave travelling up its column: at height h above the
 * top edge of the bank (in column widths, negative on the frames below it) and turn angle
 * theta its sideways offset is D (amp / k) sin(k (theta - 2 pi h / LAMBDA) + phase).
 *
 * Everything is in column widths, so a thread leaving the top of a frame carries straight on
 * up the screen: same place, same phase, same physical wavelength, because the screen spans the
 * bank exactly. Every frame works out theta from the room's shared clock. At the top edge
 * (h = 0) the offset is D times the harmonic's term of the sum, so each thread brings its
 * share of the wave up to the picture.
 */
import { TAU } from "./config";

/** Offset of the fundamental at full amplitude, in column widths. */
export const THREAD_D = 0.32;
/** Wavelength of the fundamental's thread, in column widths. Harmonic k's is LAMBDA / k. */
export const THREAD_LAMBDA = 1.6;
/** Thread width, in column widths. */
export const THREAD_W = 0.02;

/** Turn angle of the fundamental at a shared clock time (ms). */
export const turnAngle = (clockMs: number, periodS: number): number => {
  const p = Math.max(0.1, periodS);
  const s = (((clockMs / 1000) % p) + p) % p;
  return (TAU * s) / p;
};

/** Sideways offset of harmonic k's thread, in column widths. */
export const threadOffset = (
  k: number,
  amp: number,
  phase: number,
  theta: number,
  h: number,
): number => THREAD_D * (amp / k) * Math.sin(k * (theta - (TAU * h) / THREAD_LAMBDA) + phase);

/** Smooth step from 0 at `a` to 1 at `b`. */
export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
