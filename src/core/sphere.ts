/**
 * Geometry for a `sphere` frame: one display wrapped round a ball and fed an equirectangular
 * picture. Apps place things by latitude and longitude, and this module turns those into stage
 * pixels, directions and metres.
 *
 * Venue space is in metres with y up and the floor at y = 0. The sphere's centre is at
 * (0, centreY, 0) and longitude 0 faces +z. A direction from the centre is
 * (cos lat sin lon, sin lat, cos lat cos lon), so longitude grows to the right of someone
 * looking at the sphere, the way the stage's columns do.
 *
 * Distortion: a shape drawn round in stage pixels at latitude `lat` looks 1 / cos(lat) times
 * too narrow on the ball, and the rows near the poles cover almost nothing. `SphereMap.stretch`
 * gives the correction for small things. A flat 2D scene can instead be drawn on a `Strip`, a
 * band of the sphere in the Mercator projection, which keeps shapes undistorted and only makes
 * them smaller away from the equator.
 */
import type { FrameInfo, SphereInfo } from "./types";
import { activeVenue, DEFAULT_VENUE, type SphereSpec } from "./venue";

export type Vec3 = readonly [number, number, number];
/** A 3 x 3 matrix, row by row. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Where people stand and look from, for working out the band they see well. */
export interface Viewers {
  /** Eye heights above the floor, metres. */
  eyes: readonly number[];
  /** The farthest anyone stands from the spot under the centre, metres. */
  far: number;
  /** The smallest angle between a line of sight and the surface that still reads well, radians. */
  grazing: number;
}

/** Adults and children, from right underneath to two and a half diameters away. */
export const defaultViewers = (radius: number): Viewers => ({
  eyes: [1.6, 1.1],
  far: Math.max(6, 5 * radius),
  grazing: 25 * DEG,
});

/** Can someone at `d` metres from the axis, eyes `eye` high, see latitude `lat` well? */
const seesWell = (
  lat: number,
  radius: number,
  centreY: number,
  d: number,
  eye: number,
  minSin: number,
): boolean => {
  // In the vertical plane through the axis and the viewer, the best case for this latitude.
  const nx = Math.cos(lat);
  const ny = Math.sin(lat);
  const vx = d - radius * nx;
  const vy = eye - (centreY + radius * ny);
  const len = Math.hypot(vx, vy);
  return len > 0 && (nx * vx + ny * vy) / len >= minSin;
};

/**
 * The latitudes people on the floor see well, within `cover`. A sphere hung above people's
 * heads is usually seen from underneath up to a little above its equator.
 */
export const viewBand = (
  radius: number,
  centreY: number,
  cover: { top: number; bottom: number },
  viewers: Viewers = defaultViewers(radius),
): { top: number; bottom: number } => {
  const minSin = Math.sin(viewers.grazing);
  const steps = Math.max(8, Math.ceil(viewers.far / 0.25));
  const seen = (lat: number) => {
    for (const eye of viewers.eyes) {
      for (let i = 0; i <= steps; i++) {
        if (seesWell(lat, radius, centreY, (viewers.far * i) / steps, eye, minSin)) return true;
      }
    }
    return false;
  };
  const step = 0.5 * DEG;
  let top = cover.bottom;
  for (let lat = cover.top; lat >= cover.bottom; lat -= step) {
    if (seen(lat)) {
      top = lat;
      break;
    }
  }
  let bottom = top;
  for (let lat = cover.bottom; lat <= top; lat += step) {
    if (seen(lat)) {
      bottom = lat;
      break;
    }
  }
  return { top, bottom };
};

export interface SphereOverrides {
  /** Metres. */
  diameter?: number;
  /** Height of the lowest point above the floor, metres. */
  bottom?: number;
  /** Degrees. */
  cover?: { top: number; bottom: number };
  /** Degrees. */
  view?: { top: number; bottom: number };
}

/** A frame's sphere: the venue's spec, with any of it replaced by the frame's URL. */
export const sphereInfo = (
  spec: SphereSpec = activeVenue().sphere,
  o: SphereOverrides = {},
): SphereInfo => {
  const radius = (o.diameter ?? spec.diameterM) / 2;
  const centreY = (o.bottom ?? spec.bottomM) + radius;
  const coverDeg = o.cover ?? { top: spec.coverTop, bottom: spec.coverBottom };
  const ct = clamp(coverDeg.top, -90, 90) * DEG;
  const cb = clamp(coverDeg.bottom, -90, 90) * DEG;
  const cover = ct > cb ? { top: ct, bottom: cb } : { top: HALF_PI, bottom: -HALF_PI };
  const viewDeg = o.view ?? spec.view;
  const view = viewDeg
    ? {
        top: clamp(Math.max(viewDeg.top, viewDeg.bottom) * DEG, cover.bottom, cover.top),
        bottom: clamp(Math.min(viewDeg.top, viewDeg.bottom) * DEG, cover.bottom, cover.top),
      }
    : viewBand(radius, centreY, cover);
  return { radius, centreY, cover, view, ...(spec.gallery ? { gallery: true } : {}) };
};

/** The whole sphere, as a frame that isn't a sphere is treated. */
export const WHOLE_SPHERE: SphereInfo = sphereInfo(DEFAULT_VENUE.sphere);

/** Unit vector from the centre towards a latitude and longitude. */
export const direction = (lat: number, lon: number): Vec3 => {
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
};

/** Latitude and longitude of a direction from the centre (any length). */
export const latLonOf = (d: Vec3): { lat: number; lon: number } => {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return { lat: Math.asin(clamp(d[1] / len, -1, 1)), lon: Math.atan2(d[0], d[2]) };
};

/** A point on the surface, in venue metres. */
export const surfacePoint = (s: SphereInfo, lat: number, lon: number): Vec3 => {
  const d = direction(lat, lon);
  return [d[0] * s.radius, s.centreY + d[1] * s.radius, d[2] * s.radius];
};

/** Longitude brought into [-π, π). */
export const wrapLon = (lon: number): number => {
  const t = (lon + Math.PI) % TAU;
  return (t < 0 ? t + TAU : t) - Math.PI;
};

/** Angle between two directions on the sphere, radians. */
export const angleBetween = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const h =
    Math.sin((bLat - aLat) / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin((bLon - aLon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Stage (or canvas) pixels for a sphere's latitude and longitude. */
export interface SphereMap {
  readonly sphere: SphereInfo;
  readonly width: number;
  readonly height: number;
  /** Pixels per radian of longitude (along the equator) and of latitude. */
  readonly pxPerLon: number;
  readonly pxPerLat: number;
  x(lon: number): number;
  y(lat: number): number;
  lon(x: number): number;
  lat(y: number): number;
  /**
   * How many times wider than tall to draw something small at `lat` so it looks round on the
   * ball (1 at the equator on a whole-sphere feed, 2 at 60°). Capped at 64 near the poles.
   */
  stretch(lat: number): number;
  /** Pixels per metre of surface at `lat`, across and up. */
  perMetre(lat: number): { x: number; y: number };
}

/**
 * A map for a picture `width` x `height` pixels that covers what the stage covers. Pass the
 * frame's stage size, or a canvas's backing-store size to draw straight into that canvas.
 */
export const sphereMap = (sphere: SphereInfo, width: number, height: number): SphereMap => {
  const { top, bottom } = sphere.cover;
  const pxPerLon = width / TAU;
  const pxPerLat = height / (top - bottom);
  return {
    sphere,
    width,
    height,
    pxPerLon,
    pxPerLat,
    x: (lon) => (wrapLon(lon) + Math.PI) * pxPerLon,
    y: (lat) => (top - lat) * pxPerLat,
    lon: (x) => x / pxPerLon - Math.PI,
    lat: (y) => top - y / pxPerLat,
    stretch: (lat) => Math.min(64, pxPerLon / (pxPerLat * Math.max(1e-9, Math.cos(lat)))),
    perMetre: (lat) => ({
      x: pxPerLon / (sphere.radius * Math.max(1e-9, Math.cos(lat))),
      y: pxPerLat / sphere.radius,
    }),
  };
};

/** The map for a frame's stage, in CSS px. A frame that isn't a sphere gets a whole sphere. */
export const stageMap = (frame: Pick<FrameInfo, "width" | "height" | "sphere">): SphereMap =>
  sphereMap(frame.sphere ?? WHOLE_SPHERE, frame.width, frame.height);

/**
 * Horizontal offsets (0, and one width either side) at which something spanning x0 to x1 on a
 * picture `width` wide shows, since the picture's edges meet round the back of the ball. Draw
 * it once at each.
 */
export const wrapOffsets = (x0: number, x1: number, width: number): number[] => {
  const out: number[] = [];
  for (const dx of [-width, 0, width]) if (x1 + dx > 0 && x0 + dx < width) out.push(dx);
  return out;
};

const mercator = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + lat / 2));
const unMercator = (m: number): number => 2 * Math.atan(Math.exp(m)) - HALF_PI;

/**
 * A band of the sphere unrolled into a flat picture with the Mercator projection: once round
 * across its width, `top` to `bottom` latitude down its height. Shapes keep their proportions
 * on the ball; their size shrinks by cos(latitude) away from the equator.
 */
export interface Strip {
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly bottom: number;
  /** Strip pixels per metre of surface at the equator. Divide by cos(lat) elsewhere. */
  readonly perMetre: number;
  y(lat: number): number;
  lat(y: number): number;
  x(lon: number): number;
  lon(x: number): number;
  /**
   * Copy a canvas drawn as this strip onto the sphere picture behind `g`, which `map` describes.
   * Only the band's rows change.
   */
  draw(g: CanvasRenderingContext2D, source: CanvasImageSource, map: SphereMap): void;
}

/** Most stage rows one slice of `Strip.draw` covers; short enough to keep it within a pixel. */
const SLICE_ROWS = 8;

/**
 * A strip `width` pixels round, from `top` to `bottom` latitude (radians, kept within 85° of
 * the equator, where Mercator stays finite).
 */
export const createStrip = (
  sphere: SphereInfo,
  width: number,
  top: number,
  bottom: number,
): Strip => {
  const limit = 85 * DEG;
  const t = clamp(Math.max(top, bottom), -limit, limit);
  const b = clamp(Math.min(top, bottom), -limit, limit);
  const perRad = width / TAU;
  const mt = mercator(t);
  const height = perRad * (mt - mercator(b));
  const y = (lat: number) => perRad * (mt - mercator(lat));
  return {
    width,
    height,
    top: t,
    bottom: b,
    perMetre: perRad / sphere.radius,
    y,
    lat: (sy) => unMercator(mt - sy / perRad),
    x: (lon) => (wrapLon(lon) + Math.PI) * perRad,
    lon: (sx) => sx / perRad - Math.PI,
    draw(g, source, map) {
      const y0 = Math.max(0, map.y(t));
      const y1 = Math.min(map.height, map.y(b));
      const rows = y1 - y0;
      if (rows <= 0) return;
      const slices = Math.ceil(rows / SLICE_ROWS);
      for (let i = 0; i < slices; i++) {
        const ya = y0 + (rows * i) / slices;
        const yb = y0 + (rows * (i + 1)) / slices;
        const sa = y(map.lat(ya));
        const sb = y(map.lat(yb));
        if (sb - sa <= 0) continue;
        g.drawImage(source, 0, sa, width, sb - sa, 0, ya, map.width, yb - ya);
      }
    },
  };
};

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation by `angle` radians about `axis` (any length), right-handed. */
export const rotationAbout = (axis: Vec3, angle: number): Mat3 => {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
};

export const multiply3 = (a: Mat3, b: Mat3): Mat3 => {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  ];
};

export const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const apply3 = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/**
 * Pull a rotation back towards a proper rotation after many small multiplications, so a ball
 * spun for days never drifts out of shape.
 */
export const orthonormalize3 = (m: Mat3): Mat3 => {
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const a = norm([m[0], m[1], m[2]]);
  const d = a[0] * m[3] + a[1] * m[4] + a[2] * m[5];
  const b = norm([m[3] - d * a[0], m[4] - d * a[1], m[5] - d * a[2]]);
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
};
