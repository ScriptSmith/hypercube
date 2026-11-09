/**
 * Our own 2D ray tracer. Pieces are made of line segments and circular arcs, each with a
 * material: mirror (one reflective face, dark back), glass (refraction by Snell's law with
 * total internal reflection, dispersion in flint), filter, splitter, absorber, or the bench's
 * edge. Crystals don't bend light; they add up what passes through them.
 *
 * The tracer is deterministic: rays are taken from a stack in a fixed order, so the same scene
 * and sources always give the same segments, crystal light and exits. Banks rely on that.
 */
import {
  type Band,
  BITS,
  crystalShare,
  disperses,
  type Glass,
  indexOf,
  popcount,
} from "./spectrum";

export const MAT_MIRROR = 0;
export const MAT_ABSORB = 1;
export const MAT_GLASS = 2;
export const MAT_FILTER = 3;
export const MAT_SPLIT = 4;
export const MAT_EDGE = 5;

export const EDGE_LEFT = 0;
export const EDGE_RIGHT = 1;
export const EDGE_TOP = 2;
export const EDGE_BOTTOM = 3;

/** At most this many interactions along any one ray's history. */
export const MAX_DEPTH = 64;
/** Rays dimmer than this are dropped. */
export const MIN_LEVEL = 0.05;
/** At most this many segments per trace. */
export const MAX_SEGS = 2048;
const MAX_EXITS = 64;
const EPS = 1e-3;

export interface Surface {
  arc: boolean;
  /** Segment from (ax, ay) to (bx, by); for an arc, its centre is (ax, ay). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Segment normal: the reflective face of a mirror, the outside of glass. */
  nx: number;
  ny: number;
  /** Arc radius, start angle and counter-clockwise span (radians, y down). */
  r: number;
  a0: number;
  span: number;
  /** +1 when the outside of the body is away from the arc's centre, -1 when towards it. */
  sign: number;
  mat: number;
  glass: Glass;
  /** Filter band. */
  bits: number;
  /** Which bench edge, for MAT_EDGE. */
  edge: number;
  /** Owner, for hit counts; -1 for none. */
  body: number;
}

export interface Source {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bits: number;
  level: number;
  /** Guide light: a hint, drawn faint, and never sent to a neighbour. */
  guide: boolean;
  /** Frames this light has crossed. */
  hops: number;
}

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bits: number;
  level: number;
  guide: boolean;
  /** The body whose interaction sent this light (-1 for a source), and the body it ends on. */
  from: number;
  to: number;
}

export interface Exit {
  edge: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  bits: number;
  level: number;
  guide: boolean;
  hops: number;
}

export interface CrystalSpec {
  x: number;
  y: number;
  r: number;
  band: Band;
  /** Light needed to glow. */
  need: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Scene {
  surfaces: readonly Surface[];
  crystals: readonly CrystalSpec[];
  /** The light stays inside this box; its sides are edges. */
  box: Box;
  /** Bodies are numbered 0 to bodies - 1. */
  bodies: number;
}

export interface TraceResult {
  segs: Seg[];
  /** Light through each crystal: real, and guide. */
  real: number[];
  guide: number[];
  /** Real-light interactions with each body. */
  hits: number[];
  exits: Exit[];
  truncated: boolean;
}

export interface Limits {
  depth: number;
  minLevel: number;
  segs: number;
}

export const LIMITS: Limits = { depth: MAX_DEPTH, minLevel: MIN_LEVEL, segs: MAX_SEGS };

const blank = (): Surface => ({
  arc: false,
  ax: 0,
  ay: 0,
  bx: 0,
  by: 0,
  nx: 0,
  ny: 0,
  r: 0,
  a0: 0,
  span: 0,
  sign: 1,
  mat: MAT_ABSORB,
  glass: "crown",
  bits: 0,
  edge: -1,
  body: -1,
});

/** A segment whose normal is the left-hand normal of a -> b (y down: rotate (b - a) by -90). */
export const segment = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mat: number,
  extra: Partial<Surface> = {},
): Surface => {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return {
    ...blank(),
    ax,
    ay,
    bx,
    by,
    nx: (by - ay) / len,
    ny: -(bx - ax) / len,
    mat,
    ...extra,
  };
};

export const arc = (
  cx: number,
  cy: number,
  r: number,
  a0: number,
  span: number,
  sign: number,
  mat: number,
  extra: Partial<Surface> = {},
): Surface => ({ ...blank(), arc: true, ax: cx, ay: cy, r, a0, span, sign, mat, ...extra });

const TAU = Math.PI * 2;

/** Distance along the ray to the surface, or Infinity. */
export const hitDistance = (s: Surface, px: number, py: number, dx: number, dy: number): number => {
  if (!s.arc) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) return Infinity;
    const wx = s.ax - px;
    const wy = s.ay - py;
    const t = (wx * ey - wy * ex) / den;
    if (t <= EPS) return Infinity;
    const u = (wx * dy - wy * dx) / den;
    if (u < 0 || u > 1) return Infinity;
    return t;
  }
  const fx = px - s.ax;
  const fy = py - s.ay;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - s.r * s.r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  for (const t of [-b - sq, -b + sq]) {
    if (t <= EPS) continue;
    const qx = px + dx * t - s.ax;
    const qy = py + dy * t - s.ay;
    let a = Math.atan2(qy, qx) - s.a0;
    a -= Math.floor(a / TAU) * TAU;
    if (a <= s.span) return t;
  }
  return Infinity;
};

/** Outward (or front) normal of the surface at a point on it. */
const normalAt = (s: Surface, qx: number, qy: number): [number, number] => {
  if (!s.arc) return [s.nx, s.ny];
  return [(s.sign * (qx - s.ax)) / s.r, (s.sign * (qy - s.ay)) / s.r];
};

export const reflect = (dx: number, dy: number, nx: number, ny: number): [number, number] => {
  const k = 2 * (dx * nx + dy * ny);
  return [dx - k * nx, dy - k * ny];
};

/**
 * Direction after crossing from index n1 into n2 at a surface with normal (nx, ny) facing the
 * incoming ray, or null for total internal reflection.
 */
export const refract = (
  dx: number,
  dy: number,
  nx: number,
  ny: number,
  n1: number,
  n2: number,
): [number, number] | null => {
  const eta = n1 / n2;
  const cosi = -(dx * nx + dy * ny);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const m = eta * cosi - Math.sqrt(k);
  const ox = eta * dx + m * nx;
  const oy = eta * dy + m * ny;
  const len = Math.hypot(ox, oy) || 1;
  return [ox / len, oy / len];
};

interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bits: number;
  level: number;
  guide: boolean;
  hops: number;
  depth: number;
  from: number;
}

const edgesOf = (box: Box): Surface[] => {
  const { x, y, width: w, height: h } = box;
  return [
    segment(x, y + h, x, y, MAT_EDGE, { edge: EDGE_LEFT }),
    segment(x + w, y, x + w, y + h, MAT_EDGE, { edge: EDGE_RIGHT }),
    segment(x, y, x + w, y, MAT_EDGE, { edge: EDGE_TOP }),
    segment(x + w, y + h, x, y + h, MAT_EDGE, { edge: EDGE_BOTTOM }),
  ];
};

/** Squared distance from (cx, cy) to the segment. */
export const segDist2 = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
): number => {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((cx - x0) * ex + (cy - y0) * ey) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x0 + ex * t - cx;
  const qy = y0 + ey * t - cy;
  return qx * qx + qy * qy;
};

export const trace = (
  scene: Scene,
  sources: readonly Source[],
  limits: Limits = LIMITS,
): TraceResult => {
  const surfaces = [...scene.surfaces, ...edgesOf(scene.box)];
  const crystals = scene.crystals;
  const segs: Seg[] = [];
  const exits: Exit[] = [];
  const real = Array.from({ length: crystals.length }, () => 0);
  const guide = Array.from({ length: crystals.length }, () => 0);
  const hits = Array.from({ length: Math.max(0, scene.bodies) }, () => 0);
  let truncated = false;

  const stack: Ray[] = [];
  const push = (r: Ray) => {
    if (r.level < limits.minLevel || !r.bits) return;
    if (r.depth >= limits.depth) {
      truncated = true;
      return;
    }
    stack.push(r);
  };
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = sources[i]!;
    const len = Math.hypot(s.dx, s.dy) || 1;
    push({ ...s, dx: s.dx / len, dy: s.dy / len, depth: 0, from: -1 });
  }

  while (stack.length > 0) {
    if (segs.length >= limits.segs) {
      truncated = true;
      break;
    }
    const ray = stack.pop()!;
    let best = Infinity;
    let hit: Surface | null = null;
    for (const s of surfaces) {
      const t = hitDistance(s, ray.x, ray.y, ray.dx, ray.dy);
      if (t < best) {
        best = t;
        hit = s;
      }
    }
    if (!hit || !Number.isFinite(best)) continue;
    const qx = ray.x + ray.dx * best;
    const qy = ray.y + ray.dy * best;
    const seg: Seg = {
      x0: ray.x,
      y0: ray.y,
      x1: qx,
      y1: qy,
      bits: ray.bits,
      level: ray.level,
      guide: ray.guide,
      from: ray.from,
      to: hit.body,
    };
    segs.push(seg);
    for (let c = 0; c < crystals.length; c++) {
      const k = crystals[c]!;
      if (segDist2(ray.x, ray.y, qx, qy, k.x, k.y) > k.r * k.r) continue;
      const share = crystalShare(k.band, ray.bits, ray.level);
      if (ray.guide) guide[c] = guide[c]! + share;
      else real[c] = real[c]! + share;
    }
    if (hit.body >= 0 && hit.body < hits.length && !ray.guide) hits[hit.body] = hits[hit.body]! + 1;

    const next = (dx: number, dy: number, bits: number, level: number): Ray => ({
      x: qx,
      y: qy,
      dx,
      dy,
      bits,
      level,
      guide: ray.guide,
      hops: ray.hops,
      depth: ray.depth + 1,
      from: hit.body,
    });

    switch (hit.mat) {
      case MAT_EDGE:
        if (exits.length < MAX_EXITS) {
          exits.push({
            edge: hit.edge,
            x: qx,
            y: qy,
            dx: ray.dx,
            dy: ray.dy,
            bits: ray.bits,
            level: ray.level,
            guide: ray.guide,
            hops: ray.hops,
          });
        }
        break;
      case MAT_MIRROR: {
        const [nx, ny] = normalAt(hit, qx, qy);
        if (ray.dx * nx + ray.dy * ny < 0) {
          const [rx, ry] = reflect(ray.dx, ray.dy, nx, ny);
          push(next(rx, ry, ray.bits, ray.level));
        }
        break;
      }
      case MAT_FILTER: {
        const bits = ray.bits & hit.bits;
        if (bits) push(next(ray.dx, ray.dy, bits, ray.level));
        break;
      }
      case MAT_SPLIT: {
        const [nx, ny] = normalAt(hit, qx, qy);
        const [rx, ry] = reflect(ray.dx, ray.dy, nx, ny);
        const half = ray.level / 2;
        // Pushed in reverse so the transmitted half is traced first.
        push(next(rx, ry, ray.bits, half));
        push(next(ray.dx, ray.dy, ray.bits, half));
        break;
      }
      case MAT_GLASS: {
        const [ox, oy] = normalAt(hit, qx, qy);
        const entering = ray.dx * ox + ray.dy * oy < 0;
        const nx = entering ? ox : -ox;
        const ny = entering ? oy : -oy;
        const split = disperses(hit.glass) && popcount(ray.bits) > 1;
        const parts: number[] = [];
        if (split) {
          for (let b = 0; b < BITS; b++) if (ray.bits & (1 << b)) parts.push(1 << b);
        } else {
          parts.push(ray.bits);
        }
        for (let p = parts.length - 1; p >= 0; p--) {
          const bits = parts[p]!;
          const bit = Math.round(Math.log2(bits & -bits));
          const ng = indexOf(hit.glass, bit);
          const out = refract(ray.dx, ray.dy, nx, ny, entering ? 1 : ng, entering ? ng : 1);
          if (out) push(next(out[0], out[1], bits, ray.level));
          else {
            const [rx, ry] = reflect(ray.dx, ray.dy, nx, ny);
            push(next(rx, ry, bits, ray.level));
          }
        }
        break;
      }
      default:
        break;
    }
  }
  if (stack.length > 0) truncated = true;
  return { segs, real, guide, hits, exits, truncated };
};

/** A crystal glows bright from real light, dim from guide light, or not at all. */
export type Glow = 0 | 1 | 2;

export const glowOf = (k: CrystalSpec, real: number, guide: number): Glow =>
  real >= k.need ? 2 : real + guide >= k.need ? 1 : 0;
