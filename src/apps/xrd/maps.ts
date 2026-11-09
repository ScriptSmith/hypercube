/**
 * The simulated maps: reciprocal space maps that `scripts/xrd-maps.mjs` works out from each
 * crystal's atoms for a diffractometer of its own, as 8-bit PNGs of square-root-scaled counts (0
 * where the scan never reached) with their axes in Å⁻¹, |S| = 1/d. Nothing in them was measured,
 * and visitors always see them tagged "Simulated data" (captions.ts).
 *
 * Sx runs along the sample's surface, increasing to the right; Sz along its normal, increasing up
 * from 0 at the bottom row. Each map loads on first use and is coloured once, orange like every
 * other reciprocal-space picture; pixels the scan never reached stay a dull grey-blue so a gap
 * never reads as darkness.
 */
import { lutFor } from "./engine/client";
import corundumMeta from "./data/corundum-rings.json";
import corundumUrl from "./data/corundum-rings.png";
import foilMeta from "./data/foil-arcs.json";
import foilUrl from "./data/foil-arcs.png";
import zirconMeta from "./data/zircon-spots.json";
import zirconUrl from "./data/zircon-spots.png";
import type { Rect } from "./layout";

export type MapId = "zircon" | "corundum" | "foil";
export const MAP_IDS: readonly MapId[] = ["zircon", "corundum", "foil"];

export interface MapMeta {
  width: number;
  height: number;
  material: string;
  pattern: string;
  wavelengthA: number;
  pixelStep: number;
  axes: {
    x: { min: number; max: number };
    y: { min: number; max: number };
  };
  profile: {
    sMin: number;
    sMax: number;
    bins: number;
    binWidth: number;
    peakAt: number;
    values: (number | null)[];
  };
}

const SOURCES: Record<MapId, { url: string; meta: MapMeta }> = {
  zircon: { url: zirconUrl, meta: zirconMeta as MapMeta },
  corundum: { url: corundumUrl, meta: corundumMeta as MapMeta },
  foil: { url: foilUrl, meta: foilMeta as MapMeta },
};

export const mapMeta = (id: MapId): MapMeta => SOURCES[id].meta;

/** Where S = (0, 0) lands and how many px one Å⁻¹ spans, for drawing over a map. */
export interface MapPlacement {
  rect: Rect;
  originX: number;
  originY: number;
  pxPerS: number;
}

/** The map fitted into `box` keeping its aspect, centred, and the S-to-px mapping it gives. */
export const placeMap = (id: MapId, box: Rect): MapPlacement => {
  const m = mapMeta(id);
  const sw = m.axes.x.max - m.axes.x.min;
  const sh = m.axes.y.max - m.axes.y.min;
  const k = Math.min(box.width / sw, box.height / sh);
  const w = sw * k;
  const h = sh * k;
  const rect = {
    x: box.x + (box.width - w) / 2,
    y: box.y + (box.height - h) / 2,
    width: w,
    height: h,
  };
  return {
    rect,
    originX: rect.x - m.axes.x.min * k,
    originY: rect.y + m.axes.y.max * k,
    pxPerS: k,
  };
};

export interface MapStore {
  /** The coloured map, or null until it has loaded (asking starts the load). */
  canvas(id: MapId): HTMLCanvasElement | null;
  ready(id: MapId): boolean;
  /** Draw the map fitted into `box`; returns where it went, or null before it loads. */
  draw(g: CanvasRenderingContext2D, id: MapId, box: Rect, alpha?: number): MapPlacement | null;
  dispose(): void;
}

const NO_DATA: [number, number, number] = [26, 32, 46];

export const createMapStore = (): MapStore => {
  const loaded = new Map<MapId, HTMLCanvasElement>();
  const loading = new Set<MapId>();
  let disposed = false;

  const load = (id: MapId) => {
    if (loaded.has(id) || loading.has(id) || disposed) return;
    loading.add(id);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      loading.delete(id);
      if (disposed) return;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height);
      const lut = lutFor("recip");
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i]!;
        if (v === 0) {
          px[i] = NO_DATA[0];
          px[i + 1] = NO_DATA[1];
          px[i + 2] = NO_DATA[2];
        } else {
          const k = Math.round(((v - 1) / 254) * 255) * 4;
          px[i] = lut[k]!;
          px[i + 1] = lut[k + 1]!;
          px[i + 2] = lut[k + 2]!;
        }
        px[i + 3] = 255;
      }
      g.putImageData(data, 0, 0);
      loaded.set(id, c);
    };
    img.onerror = () => {
      loading.delete(id);
    };
    img.src = SOURCES[id].url;
  };

  return {
    canvas(id) {
      const c = loaded.get(id);
      if (!c) load(id);
      return c ?? null;
    },
    ready(id) {
      return loaded.has(id);
    },
    draw(g, id, box, alpha = 1) {
      const c = this.canvas(id);
      if (!c) return null;
      const p = placeMap(id, box);
      g.save();
      g.globalAlpha = alpha;
      g.imageSmoothingEnabled = true;
      g.drawImage(c, p.rect.x, p.rect.y, p.rect.width, p.rect.height);
      g.restore();
      return p;
    },
    dispose() {
      disposed = true;
      loaded.clear();
      loading.clear();
    },
  };
};
