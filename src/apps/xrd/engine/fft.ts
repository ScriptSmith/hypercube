/**
 * A radix-2 complex FFT, in place, and the 2D transform built from it. Pure; the engine's worker
 * and the tests share it. Sizes are powers of two.
 */

export interface FftPlan {
  readonly n: number;
  /** Bit-reversed index of each position. */
  readonly rev: Uint32Array;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
}

const plans = new Map<number, FftPlan>();

export const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

export const planFor = (n: number): FftPlan => {
  const cached = plans.get(n);
  if (cached) return cached;
  if (!isPow2(n)) throw new Error(`FFT size ${n} is not a power of two`);
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const plan = { n, rev, cos, sin };
  plans.set(n, plan);
  return plan;
};

/**
 * Transform `n` values of (re, im) starting at `offset` with step `stride`, in place. `inverse`
 * uses the positive exponent and divides by n.
 */
export const fft1 = (
  re: Float64Array,
  im: Float64Array,
  plan: FftPlan,
  offset = 0,
  stride = 1,
  inverse = false,
): void => {
  const { n, rev, cos, sin } = plan;
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      const tr = re[a]!;
      re[a] = re[b]!;
      re[b] = tr;
      const ti = im[a]!;
      im[a] = im[b]!;
      im[b] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = sign * sin[k * step]!;
        const a = offset + (start + k) * stride;
        const b = offset + (start + k + half) * stride;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      const a = offset + i * stride;
      re[a] = re[a]! / n;
      im[a] = im[a]! / n;
    }
  }
};

/** 2D transform of an n x n grid stored row by row, in place. */
export const fft2 = (re: Float64Array, im: Float64Array, n: number, inverse = false): void => {
  const plan = planFor(n);
  for (let y = 0; y < n; y++) fft1(re, im, plan, y * n, 1, inverse);
  for (let x = 0; x < n; x++) fft1(re, im, plan, x, n, inverse);
};

/** Swap quadrants so frequency zero sits at (n/2, n/2). Works on any n x n array. */
export const shift2 = <T extends Float64Array | Float32Array>(a: T, n: number): T => {
  const h = n >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const j = (y + h) * n + ((x + h) % n);
      const t = a[i]!;
      a[i] = a[j]!;
      a[j] = t;
    }
  }
  return a;
};
