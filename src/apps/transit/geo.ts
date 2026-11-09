/**
 * The region the app shows and the local frame it measures positions in.
 *
 * Positions travel and are stored as metres east (x) and north (y) of the region's south-west
 * corner, on a flat local projection. That keeps messages and the bundled data small integers,
 * and makes distances (snapping, hit tests) plain arithmetic. Drawing converts to Web Mercator.
 */

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Inner Brisbane with room around the preset views for wide frames. */
export const REGION: Bounds = { west: 152.78, south: -27.68, east: 153.32, north: -27.26 };

const LAT0 = ((REGION.south + REGION.north) / 2) * (Math.PI / 180);
export const M_PER_DEG_LAT = 110_800;
export const M_PER_DEG_LON = 111_320 * Math.cos(LAT0);

export const REGION_W = (REGION.east - REGION.west) * M_PER_DEG_LON;
export const REGION_H = (REGION.north - REGION.south) * M_PER_DEG_LAT;

export const toLocalX = (lon: number): number => (lon - REGION.west) * M_PER_DEG_LON;
export const toLocalY = (lat: number): number => (lat - REGION.south) * M_PER_DEG_LAT;
export const toLon = (x: number): number => REGION.west + x / M_PER_DEG_LON;
export const toLat = (y: number): number => REGION.south + y / M_PER_DEG_LAT;

/** Inside the region, with `margin` metres of slack. */
export const inRegion = (x: number, y: number, margin = 0): boolean =>
  x >= -margin && y >= -margin && x <= REGION_W + margin && y <= REGION_H + margin;

export const inRegionLonLat = (lon: number, lat: number): boolean =>
  lon >= REGION.west && lon <= REGION.east && lat >= REGION.south && lat <= REGION.north;

/** Web Mercator, 0..1 across the world, y down. */
export const mercX = (lon: number): number => (lon + 180) / 360;
export const mercY = (lat: number): number => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** Mercator of the region's centre: drawing is relative to it, so float32 keeps metre precision. */
export const ORIGIN_MX = mercX((REGION.west + REGION.east) / 2);
export const ORIGIN_MY = mercY((REGION.south + REGION.north) / 2);

/** Local metres to mercator relative to the origin. */
export const localToMerc = (x: number, y: number, out: Float32Array | number[], at = 0): void => {
  out[at] = mercX(toLon(x)) - ORIGIN_MX;
  out[at + 1] = mercY(toLat(y)) - ORIGIN_MY;
};

/** Compass bearing in radians (0 north, clockwise) of the step from (x0, y0) to (x1, y1). */
export const bearingOf = (x0: number, y0: number, x1: number, y1: number): number =>
  Math.atan2(x1 - x0, y1 - y0);

export const dist = (x0: number, y0: number, x1: number, y1: number): number =>
  Math.hypot(x1 - x0, y1 - y0);
