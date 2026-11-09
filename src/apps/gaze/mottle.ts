/**
 * Faint, broad unevenness in the white of the eye, so it never looks like flat paint: a little
 * brightness variation, a pink flush and a yellowish tint, as low-frequency noise in the same
 * coordinates as the vessels (columns once round the line of sight, rows from the limbus back).
 */
import type { Rng } from "../../core/types";

export const MOTTLE = { width: 256, height: 128 };

/** RGBA bytes: brightness, pink, yellow, 255. Wraps round in columns. */
export const makeMottle = (rng: Rng): Uint8Array => {
  const { width: W, height: H } = MOTTLE;
  const out = new Uint8Array(W * H * 4);
  const layers = [
    { cx: 6, cy: 3 },
    { cx: 14, cy: 7 },
    { cx: 30, cy: 15 },
  ];
  const grids = [0, 1, 2].map(() =>
    layers.map((l) => {
      const g = new Float32Array(l.cx * (l.cy + 1));
      for (let i = 0; i < g.length; i++) g[i] = rng.next();
      return g;
    }),
  );
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (g: Float32Array, cx: number, cy: number, x: number, y: number) => {
    const fx = (x / W) * cx;
    const fy = (y / H) * cy;
    const ix = Math.floor(fx);
    const iy = Math.min(cy - 1, Math.floor(fy));
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const at = (i: number, j: number) => g[j * cx + (((i % cx) + cx) % cx)]!;
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        let w = 0;
        layers.forEach((l, k) => {
          const amp = 1 / (k + 1);
          v += sample(grids[c]![k]!, l.cx, l.cy, x, y) * amp;
          w += amp;
        });
        out[o + c] = Math.round((v / w) * 255);
      }
      out[o + 3] = 255;
    }
  }
  return out;
};
