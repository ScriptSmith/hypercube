/**
 * A small tiling 3D noise texture, so the shader's fur and hair cost one filtered fetch an
 * octave instead of dozens of integer hashes. Smooth value noise on a lattice of `PERIOD` cells
 * a side, sampled `PER_CELL` times a cell; it repeats seamlessly, so the shader can scale it.
 */
import type { Rng } from "../../core/types";

export const PERIOD = 16;
export const PER_CELL = 4;
export const NOISE_SIZE = PERIOD * PER_CELL;

export const makeNoise = (rng: Rng): Uint8Array => {
  const lattice = new Float32Array(PERIOD * PERIOD * PERIOD);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const at = (x: number, y: number, z: number) =>
    lattice[(((z % PERIOD) * PERIOD + (y % PERIOD)) * PERIOD + (x % PERIOD)) | 0]!;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const out = new Uint8Array(NOISE_SIZE * NOISE_SIZE * NOISE_SIZE);
  let k = 0;
  for (let z = 0; z < NOISE_SIZE; z++) {
    const cz = Math.floor(z / PER_CELL);
    const tz = ease((z % PER_CELL) / PER_CELL);
    for (let y = 0; y < NOISE_SIZE; y++) {
      const cy = Math.floor(y / PER_CELL);
      const ty = ease((y % PER_CELL) / PER_CELL);
      for (let x = 0; x < NOISE_SIZE; x++) {
        const cx = Math.floor(x / PER_CELL);
        const tx = ease((x % PER_CELL) / PER_CELL);
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const v = lerp(
          lerp(
            lerp(at(cx, cy, cz), at(cx + 1, cy, cz), tx),
            lerp(at(cx, cy + 1, cz), at(cx + 1, cy + 1, cz), tx),
            ty,
          ),
          lerp(
            lerp(at(cx, cy, cz + 1), at(cx + 1, cy, cz + 1), tx),
            lerp(at(cx, cy + 1, cz + 1), at(cx + 1, cy + 1, cz + 1), tx),
            ty,
          ),
          tz,
        );
        out[k++] = Math.round(v * 255);
      }
    }
  }
  return out;
};
