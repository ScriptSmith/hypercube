/**
 * The diffraction engine's maths: a flat model's far-field pattern is the squared size of its 2D
 * Fourier transform, which is what crystallographers once did by shining light through patterned
 * masks. Pure, so the worker and the tests share it.
 *
 * - `pattern`: the model drawn into an n x n grid, transformed, squared and centred. A powder or a
 *   foil is many grains scattering independently, so their patterns add as intensities: one
 *   grain's pattern turned to each grain's angle and summed.
 * - `synth`: back from the pattern to atoms. Transform, keep some of the spots (by a list, or all
 *   within a resolution), optionally take every phase from a second model, and transform back.
 * - `toBytes`: a pattern for the eye, on a square-root or log scale, with a beam stop over the
 *   centre (the straight-through beam, far brighter than any spot, would swamp the rest).
 *
 * Pattern pixel (column, row) offset (kx, −ky) from the centre is S = (kx, ky) / span, in Å⁻¹.
 */
import { fft2, isPow2, shift2 } from "./fft";
import { type Atoms, rasterise } from "./model";

export type Scale = "sqrt" | "log" | "linear";

export type Source =
  | { atoms: Atoms }
  | { density: Float32Array }
  /** One grain, seen at each of `angles` (radians), adding as intensities. */
  | { atoms: Atoms; angles: Float32Array };

export interface PatternJob {
  op: "pattern";
  n: number;
  /** Å across the real-space grid; the pattern's pixels are 1/span Å⁻¹ apart. */
  span: number;
  source: Source;
  scale: Scale;
  /** Beam stop radius, Å⁻¹. */
  stop: number;
  /** Brightness multiplier after scaling. Default 1. */
  gain?: number;
}

export interface SynthJob {
  op: "synth";
  n: number;
  span: number;
  source: Source;
  /** Take every phase from this model instead (the phase swap). */
  phases?: Source;
  /** Spots to keep, as (kx, ky) pixel offsets from the centre in pairs; their mirror images are
   * kept too. Null keeps every spot within `maxS`. */
  keep?: Int32Array | null;
  /** Keep only spots within this |S|, Å⁻¹. Null for no limit. */
  maxS?: number | null;
}

export type EngineJob = PatternJob | SynthJob;

export interface Result {
  /** One byte per pixel, row by row: brightness for a pattern, density for a synthesis. */
  bytes: Uint8Array;
  /** The largest value before scaling: intensity outside the beam stop, or density. */
  peak: number;
}

export const SIZES = [64, 128, 256, 512] as const;
export const checkSize = (n: number): number => {
  if (!isPow2(n) || n < 16 || n > 512) throw new Error(`grid size ${n} is not allowed`);
  return n;
};

/** Scratch buffers per size, reused job after job. */
interface Scratch {
  re: Float64Array;
  im: Float64Array;
  re2: Float64Array;
  im2: Float64Array;
  acc: Float64Array;
}
const scratch = new Map<number, Scratch>();
const buffers = (n: number): Scratch => {
  let s = scratch.get(n);
  if (!s) {
    const m = n * n;
    s = {
      re: new Float64Array(m),
      im: new Float64Array(m),
      re2: new Float64Array(m),
      im2: new Float64Array(m),
      acc: new Float64Array(m),
    };
    scratch.set(n, s);
  }
  return s;
};

const fill = (src: Source, n: number, span: number, re: Float64Array, im: Float64Array) => {
  re.fill(0);
  im.fill(0);
  if ("density" in src) {
    const d = src.density;
    const m = Math.min(d.length, n * n);
    for (let i = 0; i < m; i++) re[i] = d[i]!;
  } else rasterise(src.atoms, n, span, re);
};

/** |F|² of a source, centred, into `out` (length n²). */
export const intensity = (
  src: Source,
  n: number,
  span: number,
  out: Float64Array,
): Float64Array => {
  checkSize(n);
  const s = buffers(n);
  fill(src, n, span, s.re, s.im);
  fft2(s.re, s.im, n);
  for (let i = 0; i < n * n; i++) out[i] = s.re[i]! * s.re[i]! + s.im[i]! * s.im[i]!;
  shift2(out, n);
  if ("angles" in src && src.angles.length > 0) {
    s.acc.set(out);
    out.fill(0);
    for (const a of src.angles) addTurned(s.acc, out, n, a);
  }
  return out;
};

/** Add `src` turned by `angle` (counterclockwise on screen) about the centre into `out`. */
export const addTurned = (src: Float64Array, out: Float64Array, n: number, angle: number): void => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const h = n / 2;
  for (let row = 0; row < n; row++) {
    const y = h - row;
    for (let col = 0; col < n; col++) {
      const x = col - h;
      // Inverse turn: where this pixel came from.
      const sx = x * c + y * s;
      const sy = -x * s + y * c;
      const fc = sx + h;
      const fr = h - sy;
      const c0 = Math.floor(fc);
      const r0 = Math.floor(fr);
      if (c0 < 0 || r0 < 0 || c0 >= n - 1 || r0 >= n - 1) continue;
      const tx = fc - c0;
      const ty = fr - r0;
      const i = r0 * n + c0;
      const v =
        src[i]! * (1 - tx) * (1 - ty) +
        src[i + 1]! * tx * (1 - ty) +
        src[i + n]! * (1 - tx) * ty +
        src[i + n + 1]! * tx * ty;
      out[row * n + col] = out[row * n + col]! + v;
    }
  }
};

/** Brightest value outside a disc of `stopPx` pixels round the centre. */
export const peakOutside = (a: Float64Array, n: number, stopPx: number): number => {
  const h = n / 2;
  const r2 = stopPx * stopPx;
  let max = 0;
  for (let row = 0; row < n; row++) {
    const dy = row - h;
    for (let col = 0; col < n; col++) {
      const dx = col - h;
      if (dx * dx + dy * dy <= r2) continue;
      const v = a[row * n + col]!;
      if (v > max) max = v;
    }
  }
  return max;
};

export const toBytes = (
  a: Float64Array,
  n: number,
  opts: { scale: Scale; stopPx: number; gain?: number },
): Result => {
  const peak = peakOutside(a, n, opts.stopPx);
  const bytes = new Uint8Array(n * n);
  if (!(peak > 0)) return { bytes, peak: 0 };
  const gain = opts.gain ?? 1;
  const h = n / 2;
  const r2 = opts.stopPx * opts.stopPx;
  const logK = 999;
  const logN = Math.log1p(logK);
  for (let row = 0; row < n; row++) {
    const dy = row - h;
    for (let col = 0; col < n; col++) {
      const dx = col - h;
      const i = row * n + col;
      if (dx * dx + dy * dy <= r2) continue;
      const t = a[i]! / peak;
      const v =
        opts.scale === "sqrt"
          ? Math.sqrt(t)
          : opts.scale === "log"
            ? Math.log1p(logK * t) / logN
            : t;
      bytes[i] = Math.max(0, Math.min(255, Math.round(v * gain * 255)));
    }
  }
  return { bytes, peak };
};

export const runPattern = (job: PatternJob): Result => {
  const n = checkSize(job.n);
  const out = new Float64Array(n * n);
  intensity(job.source, n, job.span, out);
  return toBytes(out, n, { scale: job.scale, stopPx: job.stop * job.span, gain: job.gain });
};

/** The spots kept by a synthesis, as a mask over the centred grid. */
export const keepMask = (
  n: number,
  span: number,
  keep: Int32Array | null | undefined,
  maxS: number | null | undefined,
): Uint8Array => {
  const mask = new Uint8Array(n * n);
  const h = n / 2;
  const limit = maxS == null ? Number.POSITIVE_INFINITY : maxS * span;
  const ok = (kx: number, ky: number) => Math.hypot(kx, ky) <= limit + 1e-9;
  if (keep) {
    for (let i = 0; i + 1 < keep.length; i += 2) {
      const kx = keep[i]!;
      const ky = keep[i + 1]!;
      if (!ok(kx, ky)) continue;
      for (const [x, y] of [
        [kx, ky],
        [-kx, -ky],
      ] as const) {
        const col = h + x;
        const row = h - y;
        if (col >= 0 && col < n && row >= 0 && row < n) mask[row * n + col] = 1;
      }
    }
  } else {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) if (ok(col - h, h - row)) mask[row * n + col] = 1;
    }
  }
  return mask;
};

/** The density rebuilt from kept spots, as values (not bytes), row by row. */
export const synthesise = (job: SynthJob): Float64Array => {
  const n = checkSize(job.n);
  const s = buffers(n);
  fill(job.source, n, job.span, s.re, s.im);
  fft2(s.re, s.im, n);
  shift2(s.re, n);
  shift2(s.im, n);
  if (job.phases) {
    fill(job.phases, n, job.span, s.re2, s.im2);
    fft2(s.re2, s.im2, n);
    shift2(s.re2, n);
    shift2(s.im2, n);
    for (let i = 0; i < n * n; i++) {
      const amp = Math.hypot(s.re[i]!, s.im[i]!);
      const ph = Math.atan2(s.im2[i]!, s.re2[i]!);
      s.re[i] = amp * Math.cos(ph);
      s.im[i] = amp * Math.sin(ph);
    }
  }
  const mask = keepMask(n, job.span, job.keep, job.maxS);
  for (let i = 0; i < n * n; i++) {
    if (!mask[i]) {
      s.re[i] = 0;
      s.im[i] = 0;
    }
  }
  shift2(s.re, n);
  shift2(s.im, n);
  fft2(s.re, s.im, n, true);
  return s.re.slice(0, n * n);
};

export const runSynth = (job: SynthJob): Result => {
  const n = checkSize(job.n);
  const d = synthesise(job);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < d.length; i++) {
    const v = d[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const bytes = new Uint8Array(n * n);
  const range = hi - lo;
  if (range > 0) {
    for (let i = 0; i < d.length; i++) bytes[i] = Math.round(((d[i]! - lo) / range) * 255);
  }
  return { bytes, peak: hi };
};

export const run = (job: EngineJob): Result =>
  job.op === "pattern" ? runPattern(job) : runSynth(job);
