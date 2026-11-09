/**
 * A tileable 3D noise texture for the smoke, made once at mount: smooth value noise summed over
 * a few octaves on lattices that wrap, so the shader can sample it at any scale and offset with
 * repeat wrapping and never see a join. Red is the smoke itself (three octaves); green, blue and
 * alpha are three more fields (two octaves each) that bend it.
 */

export const NOISE_SIZE = 64;

/** Octaves per channel as lattice periods across the tile, largest first, with their weights. */
const CHANNELS: readonly (readonly [period: number, weight: number][])[] = [
  [
    [4, 1],
    [8, 0.5],
    [16, 0.25],
  ],
  [
    [4, 1],
    [8, 0.45],
  ],
  [
    [4, 1],
    [8, 0.45],
  ],
  [
    [4, 1],
    [8, 0.45],
  ],
];

/** A small seeded stream (mulberry32), so the texture is the same on every run. */
const stream = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** RGBA bytes, x fastest, then y, then z; each channel stretched to fill 0 to 255. */
export const buildNoise = (seed: number, size = NOISE_SIZE): Uint8Array => {
  const out = new Uint8Array(size * size * size * 4);
  const field = new Float32Array(size * size * size);
  const next = stream(seed);
  CHANNELS.forEach((octaves, channel) => {
    field.fill(0);
    for (const [period, weight] of octaves) {
      const lattice = new Float32Array(period * period * period);
      for (let i = 0; i < lattice.length; i++) lattice[i] = next();
      // Where each voxel falls on this lattice along one axis, the same for x, y and z.
      const lo = new Int32Array(size);
      const hi = new Int32Array(size);
      const w = new Float32Array(size);
      for (let v = 0; v < size; v++) {
        const x = (v * period) / size;
        const i = Math.floor(x);
        const f = x - i;
        lo[v] = i % period;
        hi[v] = (i + 1) % period;
        w[v] = f * f * f * (f * (f * 6 - 15) + 10);
      }
      const pp = period * period;
      let o = 0;
      for (let z = 0; z < size; z++) {
        const z0 = lo[z]! * pp;
        const z1 = hi[z]! * pp;
        const wz = w[z]!;
        for (let y = 0; y < size; y++) {
          const y0 = lo[y]! * period;
          const y1 = hi[y]! * period;
          const wy = w[y]!;
          const a00 = z0 + y0;
          const a01 = z0 + y1;
          const a10 = z1 + y0;
          const a11 = z1 + y1;
          for (let x = 0; x < size; x++, o++) {
            const x0 = lo[x]!;
            const x1 = hi[x]!;
            const wx = w[x]!;
            const c00 = lattice[a00 + x0]! + (lattice[a00 + x1]! - lattice[a00 + x0]!) * wx;
            const c01 = lattice[a01 + x0]! + (lattice[a01 + x1]! - lattice[a01 + x0]!) * wx;
            const c10 = lattice[a10 + x0]! + (lattice[a10 + x1]! - lattice[a10 + x0]!) * wx;
            const c11 = lattice[a11 + x0]! + (lattice[a11 + x1]! - lattice[a11 + x0]!) * wx;
            const c0 = c00 + (c01 - c00) * wy;
            const c1 = c10 + (c11 - c10) * wy;
            field[o] = field[o]! + (c0 + (c1 - c0) * wz) * weight;
          }
        }
      }
    }
    let min = Infinity;
    let max = -Infinity;
    for (const v of field) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const k = 255 / Math.max(1e-6, max - min);
    for (let i = 0; i < field.length; i++) out[i * 4 + channel] = Math.round((field[i]! - min) * k);
  });
  return out;
};
