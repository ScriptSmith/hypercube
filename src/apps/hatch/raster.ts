/**
 * Turns an egg's cracks, veins and pieces into texture data over the whole sphere in the egg's
 * frame: column i is longitude -π + (i + 0.5) / w of a turn, row j latitude -π/2 + (j + 0.5) / h
 * of a half turn (row 0 at the bottom pole, as WebGL reads data). The work comes in small steps
 * so a page can spread it over several frames.
 *
 * `data` is RGBA: crack distance and crack time, vein distance and vein day. A distance is the
 * signed angle to the nearest line's edge, negative inside it; `pieces` holds piece ids.
 */
import { latLonOf, wrapLon } from "../../core/sphere";
import { type CrackNet, pieceOf, type Segment } from "./cracks";

const TAU = Math.PI * 2;

/** Signed distances kept, radians either side of a line's edge. */
export const CRACK_RANGE = 0.03;
export const VEIN_RANGE = 0.02;
/** Vein days are stored as a share of this. */
export const DAY_SCALE = 24;

export interface EggData {
  w: number;
  h: number;
  data: Uint8Array;
  pieces: Uint8Array;
}

export const createEggData = (w: number, h: number): EggData => ({
  w,
  h,
  data: new Uint8Array(w * h * 4),
  pieces: new Uint8Array(w * h),
});

export const encodeDistance = (d: number, range: number): number =>
  Math.round(Math.max(0, Math.min(1, (d + range) / (2 * range))) * 255);
export const decodeDistance = (v: number, range: number): number => (v / 255) * 2 * range - range;

/** A job done a few pieces at a time: `step` returns true once everything is done. */
export interface Job {
  step(budgetMs: number): boolean;
}

interface Pass {
  segments: readonly Segment[];
  /** Channel for distance; time goes in the next one. */
  channel: 0 | 2;
  range: number;
  /** Multiplies each segment's time before it is stored as a share of 255. */
  timeScale: number;
}

const rasterPass = (out: EggData, pass: Pass, best: Float32Array) => {
  const { w, h, data } = out;
  const lat = new Float32Array(h);
  const cosLat = new Float32Array(h);
  const sinLat = new Float32Array(h);
  for (let j = 0; j < h; j++) {
    lat[j] = -Math.PI / 2 + ((j + 0.5) / h) * Math.PI;
    cosLat[j] = Math.cos(lat[j]!);
    sinLat[j] = Math.sin(lat[j]!);
  }
  const cosLon = new Float32Array(w);
  const sinLon = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    const lon = -Math.PI + ((i + 0.5) / w) * TAU;
    cosLon[i] = Math.cos(lon);
    sinLon[i] = Math.sin(lon);
  }
  best.fill(Infinity);
  for (let k = 0; k < w * h; k++) {
    data[k * 4 + pass.channel] = 255;
    data[k * 4 + pass.channel + 1] = 255;
  }
  let next = 0;
  const one = (s: Segment) => {
    const pad = s.r + pass.range;
    const la = latLonOf(s.a);
    const lb = latLonOf(s.b);
    const loLat = Math.min(la.lat, lb.lat) - pad;
    const hiLat = Math.max(la.lat, lb.lat) + pad;
    const j0 = Math.max(0, Math.floor(((loLat + Math.PI / 2) / Math.PI) * h - 0.5));
    const j1 = Math.min(h - 1, Math.ceil(((hiLat + Math.PI / 2) / Math.PI) * h - 0.5));
    const edge = Math.max(Math.abs(loLat), Math.abs(hiLat));
    let i0 = 0;
    let count = w;
    if (edge < 1.35) {
      const dl = wrapLon(lb.lon - la.lon);
      const mid = la.lon + dl / 2;
      const half = Math.abs(dl) / 2 + pad / Math.cos(edge);
      i0 = Math.floor(((mid - half + Math.PI) / TAU) * w - 0.5);
      count = Math.min(w, Math.ceil((2 * half * w) / TAU) + 2);
    }
    const ax = s.a[0];
    const ay = s.a[1];
    const az = s.a[2];
    const ex = s.b[0] - ax;
    const ey = s.b[1] - ay;
    const ez = s.b[2] - az;
    const len2 = ex * ex + ey * ey + ez * ez;
    for (let j = j0; j <= j1; j++) {
      const cl = cosLat[j]!;
      const py = sinLat[j]!;
      for (let c = 0; c < count; c++) {
        const i = (((i0 + c) % w) + w) % w;
        const px = cl * sinLon[i]!;
        const pz = cl * cosLon[i]!;
        let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - ax - t * ex;
        const dy = py - ay - t * ey;
        const dz = pz - az - t * ez;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.r;
        const k = j * w + i;
        if (d < best[k]! && d < pass.range) {
          best[k] = d;
          data[k * 4 + pass.channel] = encodeDistance(d, pass.range);
          const time = (s.ta + t * (s.tb - s.ta)) * pass.timeScale;
          data[k * 4 + pass.channel + 1] = Math.max(0, Math.min(254, Math.round(time * 255)));
        }
      }
    }
  };
  return (deadline: number): boolean => {
    while (next < pass.segments.length) {
      one(pass.segments[next++]!);
      if ((next & 7) === 0 && performance.now() > deadline) return false;
    }
    return true;
  };
};

const piecePass = (out: EggData, net: CrackNet) => {
  const { w, h, pieces } = out;
  const lons = new Float32Array(w);
  for (let i = 0; i < w; i++) lons[i] = -Math.PI + ((i + 0.5) / w) * TAU;
  let row = 0;
  return (deadline: number): boolean => {
    while (row < h) {
      const lat = -Math.PI / 2 + ((row + 0.5) / h) * Math.PI;
      for (let i = 0; i < w; i++) pieces[row * w + i] = pieceOf(net, lat, lons[i]!);
      row++;
      if ((row & 7) === 0 && performance.now() > deadline) return false;
    }
    return true;
  };
};

/**
 * Fill `out` for an egg: its cracks (times are crack clock values), its veins (times are days,
 * stored over `DAY_SCALE`) and its pieces.
 */
export const eggDataJob = (out: EggData, net: CrackNet, veins: readonly Segment[]): Job => {
  const best = new Float32Array(out.w * out.h);
  const stages: (() => (deadline: number) => boolean)[] = [
    () =>
      rasterPass(
        out,
        { segments: net.segments, channel: 0, range: CRACK_RANGE, timeScale: 1 },
        best,
      ),
    () =>
      rasterPass(
        out,
        { segments: veins, channel: 2, range: VEIN_RANGE, timeScale: 1 / DAY_SCALE },
        best,
      ),
    () => piecePass(out, net),
  ];
  let current: ((deadline: number) => boolean) | null = null;
  let index = 0;
  return {
    step(budgetMs) {
      const deadline = performance.now() + budgetMs;
      while (index < stages.length) {
        current ??= stages[index]!();
        if (!current(deadline)) return false;
        current = null;
        index++;
        if (performance.now() > deadline) return index >= stages.length;
      }
      return true;
    },
  };
};
