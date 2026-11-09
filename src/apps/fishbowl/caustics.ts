/**
 * The dancing light on things under a rippling surface, worked out from the optics once at
 * startup and kept as a small texture that loops in space and time.
 *
 * Light comes straight down onto a surface whose height is a sum of travelling waves. Each
 * ray bends by an amount that follows the surface's slope, so after falling some depth it
 * lands a little to one side. Rays are dropped on a fine grid and counted where they land:
 * where the surface focuses them, the count piles up into bright lines, and elsewhere it thins.
 * Wave vectors are whole numbers of cycles across the tile and of cycles per loop, so both
 * the tile's edges and the loop's ends meet.
 */

export const CAUSTIC_SIZE = 96;
export const CAUSTIC_FRAMES = 32;
/** Brightness 1 is stored as this, so up to 4 fits in a byte. */
export const CAUSTIC_UNIT = 64;

interface Wave {
  kx: number;
  ky: number;
  /** Whole cycles per loop; the sign sets which way it travels. */
  m: number;
  amp: number;
  phase: number;
}

// Whole-number waves of a few lengths and directions, so the pattern doesn't line up.
const WAVES: readonly Wave[] = [
  { kx: 2, ky: 1, m: 1, amp: 1, phase: 0.3 },
  { kx: -1, ky: 2, m: -1, amp: 0.9, phase: 1.7 },
  { kx: 3, ky: -2, m: 2, amp: 0.45, phase: 4.1 },
  { kx: -3, ky: -1, m: -2, amp: 0.5, phase: 2.6 },
  { kx: 1, ky: 4, m: 3, amp: 0.25, phase: 5.2 },
  { kx: 4, ky: 3, m: -3, amp: 0.16, phase: 0.9 },
];

/**
 * How far the rays land from where they started, per unit of slope. Large enough that the
 * strongest curves fold the light into sharp lines, as they do a few depths under a surface.
 */
const SPREAD = 0.0145;

/**
 * `frames` slices of `size` x `size` light levels, frame by frame, each the mean brightness
 * scaled to `CAUSTIC_UNIT` per unit.
 */
export const buildCaustics = (size = CAUSTIC_SIZE, frames = CAUSTIC_FRAMES): Uint8Array => {
  const out = new Uint8Array(size * size * frames);
  const sum = new Float32Array(size * size);
  const blur = new Float32Array(size * size);
  const rays = size * 2;
  const tau = Math.PI * 2;
  for (let f = 0; f < frames; f++) {
    sum.fill(0);
    const t = f / frames;
    for (let j = 0; j < rays; j++) {
      const y = (j + 0.5) / rays;
      for (let i = 0; i < rays; i++) {
        const x = (i + 0.5) / rays;
        let gx = 0;
        let gy = 0;
        for (const w of WAVES) {
          const c = Math.cos(tau * (w.kx * x + w.ky * y - w.m * t) + w.phase) * w.amp * tau;
          gx += c * w.kx;
          gy += c * w.ky;
        }
        // Where this ray lands, in texels, wrapped round the tile.
        let lx = (x + SPREAD * gx) * size;
        let ly = (y + SPREAD * gy) * size;
        lx -= Math.floor(lx / size) * size;
        ly -= Math.floor(ly / size) * size;
        const x0 = Math.floor(lx);
        const y0 = Math.floor(ly);
        const fx = lx - x0;
        const fy = ly - y0;
        const x1 = (x0 + 1) % size;
        const y1 = (y0 + 1) % size;
        sum[y0 * size + x0]! += (1 - fx) * (1 - fy);
        sum[y0 * size + x1]! += fx * (1 - fy);
        sum[y1 * size + x0]! += (1 - fx) * fy;
        sum[y1 * size + x1]! += fx * fy;
      }
    }
    // A light blur, as a real light source isn't a point.
    for (let y = 0; y < size; y++) {
      const up = ((y + size - 1) % size) * size;
      const mid = y * size;
      const down = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        const l = (x + size - 1) % size;
        const r = (x + 1) % size;
        blur[mid + x] =
          (4 * sum[mid + x]! +
            2 * (sum[mid + l]! + sum[mid + r]! + sum[up + x]! + sum[down + x]!) +
            sum[up + l]! +
            sum[up + r]! +
            sum[down + l]! +
            sum[down + r]!) /
          16;
      }
    }
    const mean = (rays * rays) / (size * size);
    const base = f * size * size;
    for (let k = 0; k < size * size; k++) {
      out[base + k] = Math.min(255, Math.round((blur[k]! / mean) * CAUSTIC_UNIT));
    }
  }
  return out;
};
