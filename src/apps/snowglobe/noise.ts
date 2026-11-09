/** Smooth value noise for shaping models, deterministic and cheap. Values about -1 to 1. */
const hash = (x: number, y: number, z: number): number => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
};

const fade = (t: number) => t * t * (3 - 2 * t);

export const noise3 = (x: number, y: number, z: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
};

/** Two octaves. */
export const fbm3 = (x: number, y: number, z: number): number =>
  0.65 * noise3(x, y, z) + 0.35 * noise3(x * 2.1 + 7.3, y * 2.1 - 3.1, z * 2.1 + 1.7);
