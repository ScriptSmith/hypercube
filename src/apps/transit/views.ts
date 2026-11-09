/**
 * Preset views, which the camera tours on its own when nobody is moving the map. Ids are neutral
 * words; none is named after the venue or its surroundings.
 */
import { type Bounds, mercX, mercY } from "./geo";

export type ViewId = "network" | "city" | "river" | "north" | "south";

export const VIEWS: Record<ViewId, Bounds> = {
  /** The whole inner network. */
  network: { west: 152.93, south: -27.58, east: 153.17, north: -27.36 },
  /** The city centre and the river through it. */
  city: { west: 152.995, south: -27.497, east: 153.055, north: -27.443 },
  /** The river from the western suburbs to near its mouth: the ferry's whole run. */
  river: { west: 152.975, south: -27.515, east: 153.115, north: -27.425 },
  /** The rail lines north and north-east of the city. */
  north: { west: 152.98, south: -27.47, east: 153.12, north: -27.35 },
  /** The busway and rail lines south of the city. */
  south: { west: 153.0, south: -27.6, east: 153.11, north: -27.47 },
};

export const VIEW_IDS = Object.keys(VIEWS) as ViewId[];
export const TOUR: readonly ViewId[] = ["network", "city", "river", "north", "city", "south"];

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
}

/** MapLibre's tile size: zoom z shows 512 * 2^z px across the world. */
const TILE = 512;

/**
 * The camera that shows `b` in a viewport of `w` x `h` CSS px (less padding). Zoom sits between
 * fitting the whole box and filling the viewport, so a very wide wall doesn't show mostly empty
 * country either side of a square view.
 */
export const cameraFor = (b: Bounds, w: number, h: number, pad: Padding): Camera => {
  const vw = Math.max(1, w - pad.left - pad.right);
  const vh = Math.max(1, h - pad.top - pad.bottom);
  const mx0 = mercX(b.west);
  const mx1 = mercX(b.east);
  const my0 = mercY(b.north);
  const my1 = mercY(b.south);
  const zx = Math.log2(vw / ((mx1 - mx0) * TILE));
  const zy = Math.log2(vh / ((my1 - my0) * TILE));
  const contain = Math.min(zx, zy);
  const cover = Math.max(zx, zy);
  const zoom = contain + Math.min(0.6, (cover - contain) * 0.4);
  // Centre the box in the padded viewport: shift the centre by half the padding difference.
  const scale = TILE * 2 ** zoom;
  const cx = (mx0 + mx1) / 2 + (pad.right - pad.left) / 2 / scale;
  const cy = (my0 + my1) / 2 + (pad.bottom - pad.top) / 2 / scale;
  return { lon: cx * 360 - 180, lat: latOfMercY(cy), zoom };
};

export const latOfMercY = (y: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** The zoom at which `metres` of ground fill `px` CSS px at latitude `lat`. */
export const zoomForSpan = (metres: number, px: number, lat: number): number => {
  const mPerPxAtZ0 = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / TILE;
  return Math.log2((mPerPxAtZ0 * px) / metres);
};
