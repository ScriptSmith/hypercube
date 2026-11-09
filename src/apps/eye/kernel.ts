/**
 * The blur kernel for one layer of the scene: a geometric spot diagram. Rays through a fixed
 * pattern of points spread evenly over the pupil land where the wavefront's slope sends them,
 * and the scene is averaged over those landing points.
 *
 * - Defocus alone, W = ΔD r²/2, sends a ray from pupil radius r to angle ΔD·r, so the spots fill
 *   a uniform disc of diameter p·ΔD radians (0.057 p_mm ΔD degrees, Strasburger 2018): a
 *   pillbox, never a Gaussian. Each meridian's defocus first goes through `effectiveDefocus`,
 *   which blends small defocus to the best-focus kernel.
 * - Different defocus in the two meridians gives an ellipse with axes p|ΔD1| and p|ΔD2|, a line
 *   at each focal line and a circle midway.
 * - Keratoconus adds vertical coma, Z(3,-1) = √8 (3ρ³ - 2ρ) sin θ, whose spots form a
 *   comet. Its sign is chosen so the tail trails downward (Swartz 2025: "inferiorly-oriented,
 *   elongated tails"), and a rigid lens reverses it.
 *
 * Offsets are degrees in the picture (x right, y down) about the kernel's centroid, so a kernel
 * never shifts the picture.
 */
import { effectiveDefocus } from "./optics";

export interface Kernel {
  /** x0, y0, x1, y1, ... degrees. */
  taps: Float32Array;
  count: number;
  /** Half-extents, degrees. */
  rx: number;
  ry: number;
  /** Typical gap between neighbouring taps, degrees, for choosing a texture level. */
  spacing: number;
}

export const TAP_COUNTS = [1, 16, 64] as const;
export const MAX_TAPS = 64;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** n points spread evenly over the unit disc (a Vogel spiral). */
export const pupilPattern = (n: number): Float32Array => {
  const out = new Float32Array(n * 2);
  if (n === 1) return out;
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * GOLDEN;
    out[i * 2] = r * Math.cos(a);
    out[i * 2 + 1] = r * Math.sin(a);
  }
  return out;
};

const PATTERNS = new Map<number, Float32Array>(TAP_COUNTS.map((n) => [n, pupilPattern(n)]));

const RAD = 180 / Math.PI;

/**
 * The kernel for defocus `h` and `v` (dioptres, horizontal and vertical meridians), a pupil of
 * `pupilMm` and vertical coma `comaUm` (µm over this pupil, positive trails downward), with `n`
 * taps (1, 16 or 64).
 */
export const kernelFor = (
  h: number,
  v: number,
  pupilMm: number,
  comaUm = 0,
  n: (typeof TAP_COUNTS)[number] = 64,
): Kernel => {
  const pattern = PATTERNS.get(n) ?? pupilPattern(n);
  const R = Math.max(0.05, pupilMm) / 2000;
  const dh = effectiveDefocus(h, pupilMm);
  const dv = effectiveDefocus(v, pupilMm);
  const c = (comaUm * 1e-6) / R;
  const k = Math.SQRT2 * 2;
  const taps = new Float32Array(n * 2);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    const X = pattern[i * 2]!;
    const Y = pattern[i * 2 + 1]!;
    const x = dh * X * R + c * k * 6 * X * Y;
    const y = dv * Y * R + c * k * (3 * X * X + 9 * Y * Y - 2);
    taps[i * 2] = x * RAD;
    taps[i * 2 + 1] = y * RAD;
    mx += x * RAD;
    my += y * RAD;
  }
  mx /= n;
  my /= n;
  let rx = 0;
  let ry = 0;
  for (let i = 0; i < n; i++) {
    taps[i * 2] = taps[i * 2]! - mx;
    taps[i * 2 + 1] = taps[i * 2 + 1]! - my;
    rx = Math.max(rx, Math.abs(taps[i * 2]!));
    ry = Math.max(ry, Math.abs(taps[i * 2 + 1]!));
  }
  // A disc of n spots: each covers about area/n; a line of them is spaced along its length.
  const area = Math.PI * rx * ry;
  const spacing = Math.max(Math.sqrt(area / n), (2 * Math.max(rx, ry)) / n);
  return { taps, count: n, rx, ry, spacing };
};

/** Taps needed for a kernel this wide in pixels: one when it is under a pixel. */
export const tapsFor = (extentPx: number): (typeof TAP_COUNTS)[number] =>
  extentPx < 0.75 ? 1 : extentPx < 3 ? 16 : 64;
