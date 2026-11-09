/**
 * Which spines can cover each part of the ball, worked out once at mount so the shader looks
 * at a handful of spines per pixel instead of searching.
 *
 * The ball (in the body's frame) is unrolled onto the six faces of a cube with equal angles per
 * texel (texels vary in size by well under 2 times, so lists stay short everywhere). Each texel
 * lists up to `SLOTS` spines whose footprint, lying flat, comes within the texel's own radius of
 * its centre, in two halves of eight (the shader reads the second only when the first is full),
 * the highest first (the spine whose base is furthest upstream lies on top, like
 * shingles). Lifting a spine only shortens and narrows its footprint, so the lists stay complete
 * while the animal breathes.
 *
 * Each spine floods out from the texel at its base to every texel that passes that test. The
 * test is done in the spine's gnomonic plane, where distances are never shorter than on the
 * ball, so it never leaves a texel out.
 */
import type { Vec3 } from "../../core/sphere";
import type { Spine } from "./body";

/** Texels along a face's side. */
export const FACE = 256;
export const SLOTS = 16;
/** Spine ids in one texel of the candidate texture. */
export const HALF = 8;
export const EMPTY = 0xffff;
/** Spines per row of the data texture; each takes `SPINE_TEXELS` texels. */
export const SPINES_PER_ROW = 128;
export const SPINE_TEXELS = 2;
/**
 * The second texel's last value carries both the rest lift and the width: whole thousandths of
 * a radian of lift, plus the width as a fraction of `WIDTH_SPAN`, so the shader reads each spine
 * in two fetches.
 */
export const LIFT_STEPS = 1000;
export const WIDTH_SPAN = 0.05;

export const packLiftWidth = (lift: number, width: number): number =>
  Math.round(lift * LIFT_STEPS) + Math.min(0.999, width / WIDTH_SPAN);

export const unpackLiftWidth = (v: number): { lift: number; width: number } => ({
  lift: Math.floor(v) / LIFT_STEPS,
  width: (v - Math.floor(v)) * WIDTH_SPAN,
});

/** Where a spine starts to narrow towards its tip, as a fraction of its length. */
export const TAPER_START = 0.3;
export const TAPER_POWER = 0.9;

/** Half-width of a spine along its length, `t` from 0 at the base to 1 at the tip, at most 1. */
export const taper = (t: number): number =>
  t <= TAPER_START ? 1 : Math.pow(Math.max(0, (1 - t) / (1 - TAPER_START)), TAPER_POWER);

const QUARTER = Math.PI / 4;

/** An integer hash, the same as `hashU` in the shader. */
export const hashU = (v: number): number => {
  let x = v >>> 0;
  x ^= x >>> 17;
  x = Math.imul(x, 0xed5ad4bb);
  x ^= x >>> 11;
  x = Math.imul(x, 0xac4c1b51);
  x ^= x >>> 15;
  x = Math.imul(x, 0x31848bab);
  x ^= x >>> 14;
  return x >>> 0;
};

/** Atlas size of a cube of `face` texels a side: three faces across, two down. */
export const atlasSize = (face = FACE) => ({ width: face * 3, height: face * 2 });

/**
 * The texel of the atlas a unit direction falls in. Mirrors `cubeTexel` in the shader: the
 * major axis picks the face (x before y before z on ties) and the other two, in a fixed order,
 * give the place on it, evened out by an arctangent.
 */
export const texelOf = (x: number, y: number, z: number, face = FACE): number => {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let f: number;
  let p: number;
  let q: number;
  let m: number;
  if (ax >= ay && ax >= az) {
    f = x >= 0 ? 0 : 1;
    p = y;
    q = z;
    m = ax;
  } else if (ay >= az) {
    f = y >= 0 ? 2 : 3;
    p = z;
    q = x;
    m = ay;
  } else {
    f = z >= 0 ? 4 : 5;
    p = x;
    q = y;
    m = az;
  }
  const u = Math.atan(p / m) / QUARTER;
  const v = Math.atan(q / m) / QUARTER;
  const i = Math.min(face - 1, Math.max(0, Math.floor((u * 0.5 + 0.5) * face)));
  const j = Math.min(face - 1, Math.max(0, Math.floor((v * 0.5 + 0.5) * face)));
  return ((f / 3) | 0) * face * face * 3 + j * face * 3 + (f % 3) * face + i;
};

/** The direction at a place on face `f`; `i` and `j` in texels, and may run a little off it. */
export const faceDir = (f: number, i: number, j: number, face = FACE): Vec3 => {
  const u = Math.tan(((i / face) * 2 - 1) * QUARTER);
  const v = Math.tan(((j / face) * 2 - 1) * QUARTER);
  const s = f % 2 === 0 ? 1 : -1;
  let d: Vec3;
  if (f < 2) d = [s, u, v];
  else if (f < 4) d = [v, s, u];
  else d = [u, v, s];
  const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
};

interface Texels {
  /** Centre directions, three per texel. */
  centre: Float32Array;
  /** Angle from the centre to the farthest corner. */
  radius: Float32Array;
}

const texelCache = new Map<number, Texels>();

/** Every texel's centre and outer radius, worked out once per size. */
export const texelGeometry = (face = FACE): Texels => {
  const known = texelCache.get(face);
  if (known) return known;
  const { width, height } = atlasSize(face);
  const centre = new Float32Array(width * height * 3);
  const radius = new Float32Array(width * height);
  // Tangents at every half texel: even entries are texel edges, odd ones centres.
  const tans = new Float64Array(face * 2 + 1);
  for (let k = 0; k <= face * 2; k++) tans[k] = Math.tan((k / face - 1) * QUARTER);
  const put = (out: Float64Array, f: number, u: number, v: number) => {
    const s = f % 2 === 0 ? 1 : -1;
    const l = 1 / Math.sqrt(1 + u * u + v * v);
    if (f < 2) out.set([s * l, u * l, v * l]);
    else if (f < 4) out.set([v * l, s * l, u * l]);
    else out.set([u * l, v * l, s * l]);
  };
  const c = new Float64Array(3);
  const k = new Float64Array(3);
  for (let f = 0; f < 6; f++) {
    const x0 = (f % 3) * face;
    const y0 = Math.floor(f / 3) * face;
    for (let j = 0; j < face; j++) {
      for (let i = 0; i < face; i++) {
        const texel = (y0 + j) * width + x0 + i;
        put(c, f, tans[i * 2 + 1]!, tans[j * 2 + 1]!);
        centre[texel * 3] = c[0]!;
        centre[texel * 3 + 1] = c[1]!;
        centre[texel * 3 + 2] = c[2]!;
        let chord = 0;
        for (let corner = 0; corner < 4; corner++) {
          put(k, f, tans[(i + (corner & 1)) * 2]!, tans[(j + (corner >> 1)) * 2]!);
          chord = Math.max(chord, Math.hypot(c[0]! - k[0]!, c[1]! - k[1]!, c[2]! - k[2]!));
        }
        radius[texel] = 2 * Math.asin(Math.min(1, chord / 2));
      }
    }
  }
  const out = { centre, radius };
  texelCache.set(face, out);
  return out;
};

export interface Hit {
  /** Along the spine from its base, tangent units. */
  a: number;
  /** Across it. */
  x: number;
  /** Along it from 0 at the base to 1 at the tip. */
  t: number;
  /** Half-width there. */
  hw: number;
  covered: boolean;
}

/** The spine's sideways direction, `b` × `f`. */
export const sideOf = (s: Spine): Vec3 => [
  s.b[1] * s.f[2] - s.b[2] * s.f[1],
  s.b[2] * s.f[0] - s.b[0] * s.f[2],
  s.b[0] * s.f[1] - s.b[1] * s.f[0],
];

/**
 * Where `p` (unit) falls on a spine lifted `theta` radians off the skin and narrowed by
 * `spread`, as the shader works it out.
 */
export const spineHit = (s: Spine, p: Vec3, theta = 0, spread = 1): Hit => {
  const { b, f } = s;
  const side = sideOf(s);
  const db = p[0] * b[0] + p[1] * b[1] + p[2] * b[2];
  if (db < 0.7) return { a: 0, x: 0, t: -1, hw: 0, covered: false };
  const a = (p[0] * f[0] + p[1] * f[1] + p[2] * f[2]) / db;
  const x = (p[0] * side[0] + p[1] * side[1] + p[2] * side[2]) / db;
  const t = a / (s.len * Math.cos(theta));
  const hw = s.width * 0.5 * taper(t) * spread;
  return { a, x, t, hw, covered: t >= 0 && t <= 1 && Math.abs(x) <= hw };
};

export interface Lookup {
  face: number;
  /** Size of the candidate texture: two of its texels for each texel of the atlas. */
  width: number;
  height: number;
  /** Two spine ids per word, eight words per atlas texel, `EMPTY` where unused. */
  words: Uint32Array;
  /** Average and largest number of spines listed in a texel that lists any. */
  mean: number;
  max: number;
  /** Spines left out of full texels (the lowest there). */
  dropped: number;
}

export const buildLookup = (spines: readonly Spine[], face = FACE): Lookup => {
  const { width, height } = atlasSize(face);
  const texels = width * height;
  const { centre, radius } = texelGeometry(face);
  const ids = new Uint16Array(texels * SLOTS).fill(EMPTY);
  const prio = new Float32Array(texels * SLOTS);
  const count = new Uint8Array(texels);
  const stamp = new Int32Array(texels).fill(-1);
  const stack = new Int32Array(texels);
  let dropped = 0;

  for (let id = 0; id < spines.length; id++) {
    const s = spines[id]!;
    const bx = s.b[0];
    const by = s.b[1];
    const bz = s.b[2];
    const fx = s.f[0];
    const fy = s.f[1];
    const fz = s.f[2];
    const sx = by * fz - bz * fy;
    const sy = bz * fx - bx * fz;
    const sz = bx * fy - by * fx;
    const len = s.len;
    const half = s.width * 0.5;
    const lift = Math.tan(s.lift);
    let top = 0;
    const start = texelOf(bx, by, bz, face);
    stamp[start] = id;
    stack[top++] = start;
    while (top > 0) {
      const texel = stack[--top]!;
      const cx = centre[texel * 3]!;
      const cy = centre[texel * 3 + 1]!;
      const cz = centre[texel * 3 + 2]!;
      const db = cx * bx + cy * by + cz * bz;
      if (db < 0.75) continue;
      // The texel's radius as it stretches in the gnomonic plane this far from the base.
      const r = (radius[texel]! * 1.02) / (db * db);
      const a = (cx * fx + cy * fy + cz * fz) / db;
      if (a < -r || a > len + r) continue;
      const x = (cx * sx + cy * sy + cz * sz) / db;
      const hw = half * taper(Math.max(0, (a - r) / len));
      if (Math.abs(x) > hw + r) continue;
      // When a texel is full, keep the spines that lie over its centre, highest first.
      const covers = a >= 0 && a <= len && Math.abs(x) <= half * taper(a / len);
      const height = a * lift + (covers ? 1 : 0);
      const at = texel * SLOTS;
      const n = count[texel]!;
      if (n < SLOTS) {
        ids[at + n] = id;
        prio[at + n] = height;
        count[texel] = n + 1;
      } else {
        let low = at;
        for (let k = at + 1; k < at + SLOTS; k++) if (prio[k]! < prio[low]!) low = k;
        dropped++;
        if (prio[low]! < height) {
          ids[low] = id;
          prio[low] = height;
        }
      }
      const row = (texel / width) | 0;
      const col = texel - row * width;
      const fc = ((row / face) | 0) * 3 + ((col / face) | 0);
      const i = col % face;
      const j = row % face;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di;
          const nj = j + dj;
          let next: number;
          if (ni >= 0 && ni < face && nj >= 0 && nj < face) {
            next = texel + dj * width + di;
          } else {
            const d = faceDir(fc, ni + 0.5, nj + 0.5, face);
            next = texelOf(d[0], d[1], d[2], face);
          }
          if (stamp[next] === id) continue;
          stamp[next] = id;
          stack[top++] = next;
        }
      }
    }
  }

  const words = new Uint32Array(texels * (SLOTS / 2));
  let listedTexels = 0;
  let total = 0;
  let max = 0;
  for (let texel = 0; texel < texels; texel++) {
    const n = count[texel]!;
    const at = texel * SLOTS;
    // Highest first: an insertion sort, as lists are short.
    for (let k = 1; k < n; k++) {
      const pk = prio[at + k]!;
      const ik = ids[at + k]!;
      let m = k - 1;
      while (m >= 0 && prio[at + m]! < pk) {
        prio[at + m + 1] = prio[at + m]!;
        ids[at + m + 1] = ids[at + m]!;
        m--;
      }
      prio[at + m + 1] = pk;
      ids[at + m + 1] = ik;
    }
    for (let k = 0; k < SLOTS; k += 2) {
      words[texel * (SLOTS / 2) + k / 2] = (ids[at + k]! | (ids[at + k + 1]! << 16)) >>> 0;
    }
    if (n > 0) {
      listedTexels++;
      total += n;
      max = Math.max(max, n);
    }
  }
  return {
    face,
    width: width * (SLOTS / HALF),
    height,
    words,
    mean: listedTexels ? total / listedTexels : 0,
    max,
    dropped,
  };
};

/** The ids a texel lists, highest first. */
export const listed = (lookup: Lookup, texel: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k < SLOTS / 2; k++) {
    const w = lookup.words[texel * (SLOTS / 2) + k]!;
    const lo = w & 0xffff;
    const hi = w >>> 16;
    if (lo !== EMPTY) out.push(lo);
    if (hi !== EMPTY) out.push(hi);
  }
  return out;
};

/**
 * Spine data for the shader, two texels each: base and length, then direction with the rest
 * lift and width packed together.
 */
export const packSpines = (spines: readonly Spine[]) => {
  const width = SPINES_PER_ROW * SPINE_TEXELS;
  const height = Math.max(1, Math.ceil(spines.length / SPINES_PER_ROW));
  const data = new Float32Array(width * height * 4);
  spines.forEach((s, id) => {
    const at = (Math.floor(id / SPINES_PER_ROW) * width + (id % SPINES_PER_ROW) * SPINE_TEXELS) * 4;
    data.set(
      [s.b[0], s.b[1], s.b[2], s.len, s.f[0], s.f[1], s.f[2], packLiftWidth(s.lift, s.width)],
      at,
    );
  });
  return { data, width, height };
};
