/**
 * The woven cloth: one band per match, at most MAX_BANDS (the oldest goes). A band keeps only
 * the matched shape, sampled over one period, and each harmonic's share of it. Its pattern is
 * generated from those: warp stripes in the harmonics' colours, as wide as their shares, with
 * the shape's silhouette (the area between the curve and its middle line) woven bright and
 * the rest dark, in a twill. It is a graph of a smooth periodic function, so it can't hold
 * letters or symbols.
 */
import { sample, type Term } from "./series";

export const MAX_BANDS = 8;
export const BAND_SAMPLES = 64;

export interface Band {
  id: number;
  /** One period of the shape, scaled so its largest value is 1 (or all zeros). */
  shape: number[];
  /** Each harmonic's share of the colours, summing to 1. */
  weights: number[];
  /** Someone took part (attract bands are muted). */
  people: boolean;
  title: string | null;
}

export interface Cloth {
  /** Oldest first. */
  readonly bands: readonly Band[];
  /** Bands woven since the start, including those gone. */
  readonly woven: number;
  add(o: { values: readonly Term[]; title: string | null; people: boolean }): Band;
  clear(): void;
}

export const bandFrom = (
  id: number,
  values: readonly Term[],
  title: string | null,
  people: boolean,
): Band => {
  const raw = sample(values, BAND_SAMPLES);
  const peak = Math.max(0, ...raw.map(Math.abs));
  const shape = raw.map((v) => (peak > 1e-6 ? v / peak : 0));
  const total = values.reduce((s, v) => s + v.amp, 0);
  const weights = values.map((v) =>
    total > 1e-6 ? v.amp / total : 1 / Math.max(1, values.length),
  );
  return { id, shape, weights, people, title };
};

export const createCloth = (): Cloth => {
  const bands: Band[] = [];
  let woven = 0;
  return {
    get bands() {
      return bands;
    },
    get woven() {
      return woven;
    },
    add(o) {
      woven++;
      const b = bandFrom(woven, o.values, o.title, o.people);
      bands.push(b);
      while (bands.length > MAX_BANDS) bands.shift();
      return b;
    },
    clear() {
      bands.length = 0;
    },
  };
};

/** Warp ends per period, split between the harmonics by share (largest remainder), in order. */
export const warpColours = (weights: readonly number[], ends: number): number[] => {
  const n = weights.length;
  if (n === 0) return Array.from({ length: ends }, () => 0);
  const raw = weights.map((w) => w * ends);
  const counts = raw.map(Math.floor);
  let left = ends - counts.reduce((s, c) => s + c, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const o of order) {
    if (left <= 0) break;
    counts[o.i]!++;
    left--;
  }
  const out: number[] = [];
  counts.forEach((c, i) => {
    for (let j = 0; j < c; j++) out.push(i);
  });
  return out;
};

/** The shape at fraction `f` of a period, interpolated. */
export const shapeAt = (shape: readonly number[], f: number): number => {
  const m = shape.length;
  if (m === 0) return 0;
  const x = (((f % 1) + 1) % 1) * m;
  const i = Math.floor(x);
  const a = shape[i % m]!;
  const b = shape[(i + 1) % m]!;
  return a + (b - a) * (x - i);
};

/** Whether the cell at end `i`, pick `j` of a band is inside the shape's silhouette. */
export const inside = (
  band: Band,
  i: number,
  j: number,
  ends: number,
  picks: number,
  repeats: number,
) => {
  const v = shapeAt(band.shape, ((i + 0.5) / ends) * repeats);
  const level = 1 - (2 * (j + 0.5)) / picks;
  return v >= 0 ? level >= 0 && level <= v : level <= 0 && level >= v;
};

const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Draw a band at cell resolution: `ends` x `picks` pixels into `g` at (0, 0). Callers scale it
 * up with smoothing, which softens it into a weave.
 */
export const paintBand = (
  g: CanvasRenderingContext2D,
  band: Band,
  colours: readonly string[],
  ends: number,
  picks: number,
  repeats: number,
): void => {
  const img = g.createImageData(ends, picks);
  const perRepeat = Math.max(1, Math.round(ends / repeats));
  const warp = warpColours(band.weights, perRepeat);
  const rgb = colours.map(rgbOf);
  const mute = band.people ? 0 : 0.55;
  for (let i = 0; i < ends; i++) {
    const h = warp[i % perRepeat] ?? 0;
    const [r0, g0, b0] = rgb[h % rgb.length] ?? [200, 200, 200];
    // Attract bands are greyer and darker.
    const grey = (r0 + g0 + b0) / 3;
    const r1 = r0 + (grey - r0) * mute;
    const g1 = g0 + (grey - g0) * mute;
    const b1 = b0 + (grey - b0) * mute;
    for (let j = 0; j < picks; j++) {
      const on = inside(band, i, j, ends, picks, repeats);
      const twill = (i + j) % 4 < 2 ? 1.08 : 0.9;
      const k = (on ? (band.people ? 1 : 0.62) : 0.2) * twill;
      const base = on ? 0 : 10;
      const o = (j * ends + i) * 4;
      img.data[o] = Math.min(255, base + r1 * k);
      img.data[o + 1] = Math.min(255, base + g1 * k);
      img.data[o + 2] = Math.min(255, base + 6 + b1 * k);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
};
