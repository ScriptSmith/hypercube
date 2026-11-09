/**
 * A small texture laid over the tank's floor, seen from above, baked once: how much the stones,
 * wood and plants round a point shade it from the water's scattered light (red), where leaf
 * litter and mulm have gathered (green), and a little noise (blue).
 */
import type { TankLayout } from "./tank";

export const GROUND_MAP = { width: 512, height: 128 };

export interface MapFrame {
  x0: number;
  z0: number;
  /** World size covered. */
  sx: number;
  sz: number;
}

export const mapFrame = (layout: TankLayout): MapFrame => ({
  x0: layout.box.left,
  z0: layout.box.back,
  sx: layout.box.right - layout.box.left,
  sz: -layout.box.back,
});

const hash = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

const smoothNoise = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

export const bakeGroundMap = (layout: TankLayout): Uint8Array => {
  const { width, height } = GROUND_MAP;
  const f = mapFrame(layout);
  const out = new Uint8Array(width * height * 4);
  const blots: { x: number; z: number; r: number; k: number }[] = [];
  for (const r of layout.rocks) {
    blots.push({
      x: r.x,
      z: r.z,
      r: Math.max(r.size[0], r.size[2]) * 1.5,
      k: r.kind === "pebble" ? 0.35 : 0.7,
    });
  }
  for (const l of layout.lumps) {
    const g = layout.ground(l.centre[0], l.centre[2]);
    const lift = l.centre[1] - l.radius - g;
    if (lift < 0.6)
      blots.push({ x: l.centre[0], z: l.centre[2], r: l.radius * 1.8, k: 0.5 * (1 - lift / 0.6) });
  }
  for (const p of layout.plants) {
    if (p.kind === "frogbit" || p.kind === "moss" || p.kind === "fern") continue;
    const r = p.kind === "sword" ? 0.9 : p.kind === "crypt" || p.kind === "anubias" ? 0.5 : 0.45;
    blots.push({ x: p.x, z: p.z, r: r * p.scale, k: 0.45 });
  }
  for (let j = 0; j < height; j++) {
    const z = f.z0 + ((j + 0.5) / height) * f.sz;
    for (let i = 0; i < width; i++) {
      const x = f.x0 + ((i + 0.5) / width) * f.sx;
      let occ = 1;
      let litter = 0;
      for (const b of blots) {
        const d2 = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
        if (d2 > 4) continue;
        occ *= 1 - b.k * Math.exp(-d2 * 1.6);
        litter += 0.35 * Math.exp(-d2 * 0.8);
      }
      // The back, under the tall plants, is darker and holds more litter.
      const back = Math.max(0, Math.min(1, (z - f.z0) / 1.4));
      occ *= 0.55 + 0.45 * back;
      litter += (1 - back) * 0.5;
      litter += Math.max(0, smoothNoise(x * 0.9, z * 1.3) - 0.55) * 1.6;
      const k = (j * width + i) * 4;
      out[k] = Math.round(Math.max(0, Math.min(1, occ)) * 255);
      out[k + 1] = Math.round(Math.max(0, Math.min(1, litter)) * 255);
      out[k + 2] = Math.round(smoothNoise(x * 4.1, z * 4.1) * 255);
      out[k + 3] = 255;
    }
  }
  return out;
};
