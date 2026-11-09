/**
 * The mirror ball's tiles, laid out as real ones are: square mirrors glued in rows of latitude,
 * each row holding as many as fit round its narrower (poleward) edge, so rows thin out towards
 * the poles. Everything here is in the ball's own frame (it turns about y) and in radians of
 * arc, so the same layout fits any size of ball: 58 rows put tiles about 11 cm apart on a
 * 4 m ball.
 *
 * Row 0 is one round mirror on the bottom pole, which people underneath look straight up at.
 * The top `CAP_ROWS` rows are the dark plate the ball hangs from.
 */
import type { Rng } from "../../core/types";

export const ROWS = 58;
/** Row height and the narrowest slot, radians of arc. */
export const PITCH = Math.PI / ROWS;
/** A tile's side; the rest of the pitch is grout. */
export const TILE = 0.88 * PITCH;
export const GROUT = PITCH - TILE;
export const CAP_ROWS = 3;
/** Latitude where the hanging plate starts. */
export const CAP_LAT = Math.PI / 2 - CAP_ROWS * PITCH;
/** Radius of the round mirror on the bottom pole, radians of arc. */
export const POLE_RADIUS = PITCH - GROUT;
/** Columns of the per-tile texture: more than the longest row. */
export const TEX_WIDTH = 128;
/** Standard deviation of each tile's tilt about each axis, radians. */
export const TILT = 1.8 * (Math.PI / 180);
const MAX_TILT = 4 * (Math.PI / 180);

export interface Row {
  /** Tiles round the row; 0 for the plate. */
  count: number;
  /** Longitude where the row's first slot starts, radians. */
  offset: number;
  /** Latitude of the row's middle, radians. */
  lat: number;
}

const rowLat = (i: number): number => -Math.PI / 2 + (i + 0.5) * PITCH;

/** Tiles that fit round row `i`, measured along its poleward edge. */
export const rowCount = (i: number): number => {
  if (i < 0 || i >= ROWS - CAP_ROWS) return 0;
  if (i === 0) return 1;
  const lower = -Math.PI / 2 + i * PITCH;
  const upper = lower + PITCH;
  const edge = Math.abs(lower) > Math.abs(upper) ? lower : upper;
  return Math.floor((2 * Math.PI * Math.cos(edge)) / PITCH + 1e-9);
};

/**
 * Half the width of a tile in `row` at latitude `lat`, radians of arc. A tile is as wide as its
 * slot at the row's middle allows, less grout: square in the middle rows, wider near the poles,
 * where it is trimmed along its poleward half so neighbours never touch.
 */
export const halfWidth = (row: Row, lat: number): number => {
  const slot = (2 * Math.PI) / row.count;
  return 0.5 * Math.min(slot * Math.cos(lat), slot * Math.cos(row.lat)) - 0.5 * GROUT;
};

export interface Layout {
  rows: Row[];
  /** Number of tiles. */
  count: number;
  /** Row and index within the row of each tile. */
  row: Uint8Array;
  index: Uint8Array;
  /** Where each tile's colour lives in the per-tile texture (row * TEX_WIDTH + index). */
  texel: Uint16Array;
  /** Centre direction of each tile, x y z. */
  centre: Float64Array;
  /** Normal of each tile's mirror, tilted a little at random, x y z. */
  normal: Float64Array;
  /**
   * Where each tile's mirror looks for someone straight in front of it: the room it shows when
   * nothing bright is caught. x y z.
   */
  mirror: Float64Array;
  /** The same as azimuth in [-π, π) and elevation, radians; turning the ball adds to azimuth. */
  mirrorAz: Float64Array;
  mirrorEl: Float64Array;
  /** How well each tile's silvering reflects, 0 to 1. */
  shine: Float32Array;
}

const gauss = (rng: Rng): number => {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Every tile of the ball. `rng` decides the rows' stagger, the tilts and the silvering. */
export const buildLayout = (rng: Rng): Layout => {
  const rows: Row[] = [];
  let count = 0;
  for (let i = 0; i < ROWS; i++) {
    const n = rowCount(i);
    rows.push({ count: n, offset: n > 1 ? rng.next() * ((2 * Math.PI) / n) : 0, lat: rowLat(i) });
    count += n;
  }
  const row = new Uint8Array(count);
  const index = new Uint8Array(count);
  const texel = new Uint16Array(count);
  const centre = new Float64Array(count * 3);
  const normal = new Float64Array(count * 3);
  const mirror = new Float64Array(count * 3);
  const mirrorAz = new Float64Array(count);
  const mirrorEl = new Float64Array(count);
  const shine = new Float32Array(count);
  let t = 0;
  rows.forEach((r, i) => {
    const slot = (2 * Math.PI) / Math.max(1, r.count);
    for (let k = 0; k < r.count; k++, t++) {
      row[t] = i;
      index[t] = k;
      texel[t] = i * TEX_WIDTH + k;
      const lat = i === 0 ? -Math.PI / 2 : r.lat;
      const lon = r.offset + (k + 0.5) * slot;
      const cl = Math.cos(lat);
      const sl = Math.sin(lat);
      const c = [cl * Math.sin(lon), sl, cl * Math.cos(lon)];
      // East and north along the surface; at the pole any pair at right angles will do.
      const east = i === 0 ? [1, 0, 0] : [Math.cos(lon), 0, -Math.sin(lon)];
      const north = i === 0 ? [0, 0, 1] : [-sl * Math.sin(lon), cl, -sl * Math.cos(lon)];
      const tu = Math.max(-MAX_TILT, Math.min(MAX_TILT, gauss(rng) * TILT));
      const tv = Math.max(-MAX_TILT, Math.min(MAX_TILT, gauss(rng) * TILT));
      let nx = c[0]! + tu * east[0]! + tv * north[0]!;
      let ny = c[1]! + tu * east[1]! + tv * north[1]!;
      let nz = c[2]! + tu * east[2]! + tv * north[2]!;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      // Reflect a ray from straight in front of the tile (along its centre) off its mirror.
      const d = 2 * (c[0]! * nx + c[1]! * ny + c[2]! * nz);
      centre.set(c, t * 3);
      normal.set([nx, ny, nz], t * 3);
      const m = [d * nx - c[0]!, d * ny - c[1]!, d * nz - c[2]!] as const;
      mirror.set(m, t * 3);
      mirrorAz[t] = Math.atan2(m[0], m[2]);
      mirrorEl[t] = Math.asin(Math.max(-1, Math.min(1, m[1])));
      shine[t] = 0.5 + 0.5 * rng.next();
    }
  });
  return { rows, count, row, index, texel, centre, normal, mirror, mirrorAz, mirrorEl, shine };
};

/**
 * The tile under a point of the ball (its own frame), as the shader finds it: row, index and
 * offsets from the tile's centre along the surface (east, north), radians. Null on the plate.
 */
export const locate = (
  layout: Layout,
  lat: number,
  lon: number,
): { row: number; index: number; du: number; dv: number } | null => {
  if (lat > CAP_LAT) return null;
  const i = Math.max(0, Math.min(ROWS - 1, Math.floor((lat + Math.PI / 2) / PITCH)));
  const r = layout.rows[i]!;
  if (r.count === 0) return null;
  if (i === 0) return { row: 0, index: 0, du: 0, dv: lat + Math.PI / 2 };
  const slot = (2 * Math.PI) / r.count;
  const tau = 2 * Math.PI;
  const a = (((lon - r.offset) % tau) + tau) % tau;
  const k = Math.min(Math.floor(a / slot), r.count - 1);
  return { row: i, index: k, du: (a - (k + 0.5) * slot) * Math.cos(lat), dv: lat - r.lat };
};

/** Whether a point lies on a tile's mirror rather than in the grout or on the plate. */
export const onMirror = (layout: Layout, lat: number, lon: number): boolean => {
  const at = locate(layout, lat, lon);
  if (!at) return false;
  if (at.row === 0) return at.dv < POLE_RADIUS;
  return Math.abs(at.du) < halfWidth(layout.rows[at.row]!, lat) && Math.abs(at.dv) < TILE / 2;
};
