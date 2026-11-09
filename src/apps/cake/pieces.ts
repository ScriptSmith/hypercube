/**
 * Pieces in a cake's surface: fruit and nuts in the pudding, marshmallows, peanuts, cherries,
 * coconut and jelly in the rocky road.
 *
 * Each piece is a small solid (an egg shape, half of one, a rounded box or a drum) at a random
 * angle, sitting partly in the cake. Pieces live in the cells of 3D grids, one grid per layer of
 * sizes, and only cells whose middle lies close to the surface hold one. The bake finds the top of
 * each piece above a point by casting a ray straight out through it, so pieces have true outlines
 * and faces, and the cake's own surface coats each piece's lower part and climbs round its foot.
 *
 * Kinds and layers are data here, so their bounds can be tested; `piecesGlsl` writes the GLSL for
 * one cake's set, so a bake compiles only its own cake.
 */
import { f, v3 } from "./glsl";
import type { Rgb } from "./looks";

export const SHAPE = { egg: 0, half: 1, box: 2, drum: 3 } as const;
/** How the bake paints a piece (each has its own GLSL). */
export const LOOK = {
  wrinkled: 0,
  glace: 1,
  peel: 2,
  almond: 3,
  marshmallow: 4,
  peanut: 5,
  coconut: 6,
  jelly: 7,
} as const;

export interface PieceKind {
  name: string;
  shape: number;
  /** Half-sizes along the piece's own axes, in cells of its layer; z is the thinnest. */
  size: readonly [number, number, number];
  /** Each piece is scaled by between 1 and 1 less this. */
  shrink: number;
  /** How far its own z turns to face out of the cake, 0 (any way) to 1 (lying flat). */
  flat: number;
  look: number;
  /** One of these colours (linear) is picked per piece; repeat one to make it commoner. */
  colours: readonly Rgb[];
  /** A second colour: a skin, a thin edge, a dusting. */
  second: Rgb;
  /** Strength of its look's surface detail (wrinkles, dust, sugar), about 1. */
  detail: number;
  gloss: number;
  /** The cake coats each piece from its foot up to a share of its height in this range. */
  coat: readonly [number, number];
}

export interface PieceLayer {
  /** Cells of the layer's grid to the ball's radius. */
  freq: number;
  /** Share of the cells near the surface that hold a piece. */
  density: number;
  /** Centres lie between these depths, in cells: below the surface negative, above positive. */
  depth: readonly [number, number];
  /** Kinds and their weights. */
  kinds: readonly (readonly [PieceKind, number])[];
}

export interface PieceSet {
  layers: readonly PieceLayer[];
  /** Scale of the pieces' heights: 1 for pieces standing proud, less for pieces pressed flush. */
  relief: number;
  /** The cake's surface climbing round each piece's foot: how high and how far out, cells. */
  fillet: readonly [number, number];
  /** Thickness of the coat over a piece's lower part, cells. */
  coatThickness: number;
}

/** A piece's centre moves at most this far from its cell's middle along each axis. */
export const JITTER = 0.12;
/** The ray through a point starts this many cells below the surface. */
export const RAY_START = 1.2;

/** Furthest any part of a piece of this kind lies from its centre, in cells. */
export const reachOf = (k: PieceKind): number => {
  const [x, y, z] = k.size;
  if (k.shape === SHAPE.box) return Math.hypot(x, y, z);
  if (k.shape === SHAPE.drum) return Math.hypot(Math.max(x, y), z);
  return Math.max(x, y, z);
};

/**
 * The most a piece (with the cake climbing round it) may reach from its centre in a layer, so
 * the eight cells nearest a point always include every piece that can touch it: any other cell's
 * middle is at least a cell away along some axis, and a centre sits within the depth range of the
 * surface, so its sideways distance from the point is at least this.
 */
export const reachLimit = (layer: PieceLayer): number => {
  const deep = Math.max(Math.abs(layer.depth[0]), Math.abs(layer.depth[1]));
  return Math.sqrt((1 - JITTER * Math.sqrt(3)) ** 2 - deep * deep);
};

/** Expected pieces over the whole ball in a layer. */
export const piecesOnBall = (layer: PieceLayer): number =>
  4 * Math.PI * layer.freq ** 2 * (layer.depth[1] - layer.depth[0]) * layer.density;

// Ray casts and distances for the four solids, in the piece's own frame and cells.
const ENGINE_GLSL = /* glsl */ `
const float RAY_START = ${f(RAY_START)};
const float JITTER = ${f(JITTER)};
// How round a box's edges and a drum's rims are, against its smallest half-size.
const float ROUND = 0.5;

struct Hit {
  // Height of the highest piece and its coat, radians above the surface.
  float h;
  // That piece's own top, radians.
  float top;
  // How much the cake coats the piece there, 0 to 1.
  float coat;
  // The highest the cake's surface climbs here round any piece's foot, radians.
  float fil;
  int kind;
  vec3 col;
  float gloss;
};

Hit noHit() {
  return Hit(-1.0, -1.0, 0.0, 0.0, -1, vec3(0.0), 0.0);
}

float psmin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float psmax(float a, float b, float k) {
  return -psmin(-a, -b, k);
}

// Where a ray from o along dir enters and leaves a solid; enter > exit when it misses.
vec2 castShape(int shape, vec3 o, vec3 dir, vec3 s, float k) {
  if (shape <= 1) {
    vec3 a = o / s;
    vec3 b = dir / s;
    float A = dot(b, b);
    float B = dot(a, b);
    float disc = B * B - A * (dot(a, a) - 1.0);
    if (disc < 0.0) return vec2(1.0, -1.0);
    float sq = sqrt(disc);
    vec2 t = vec2(-B - sq, -B + sq) / A;
    if (shape == 1) {
      // Cut flat across its own z: only the part below z = 0 is left.
      if (abs(dir.z) < 1e-5) {
        if (o.z > 0.0) return vec2(1.0, -1.0);
      } else {
        float tz = -o.z / dir.z;
        if (dir.z > 0.0) t.y = min(t.y, tz);
        else t.x = max(t.x, tz);
      }
    }
    return t;
  }
  vec3 sg = vec3(dir.x >= 0.0 ? 1.0 : -1.0, dir.y >= 0.0 ? 1.0 : -1.0, dir.z >= 0.0 ? 1.0 : -1.0);
  vec3 inv = sg / max(abs(dir), vec3(1e-5));
  if (shape == 2) {
    vec3 t1 = (-s - o) * inv;
    vec3 t2 = (s - o) * inv;
    vec3 tn = min(t1, t2);
    vec3 tf = max(t1, t2);
    // Soft limits round the box's edges and corners.
    return vec2(psmax(psmax(tn.x, tn.y, k), tn.z, k), psmin(psmin(tf.x, tf.y, k), tf.z, k));
  }
  // A drum: an elliptic cylinder along its own z.
  vec2 a = o.xy / s.xy;
  vec2 b = dir.xy / s.xy;
  float A = dot(b, b);
  float B = dot(a, b);
  float C = dot(a, a) - 1.0;
  vec2 ts = vec2(-1e3, 1e3);
  if (A > 1e-8) {
    float disc = B * B - A * C;
    if (disc < 0.0) return vec2(1.0, -1.0);
    float sq = sqrt(disc);
    ts = vec2(-B - sq, -B + sq) / A;
  } else if (C > 0.0) {
    return vec2(1.0, -1.0);
  }
  float z1 = (-s.z - o.z) * inv.z;
  float z2 = (s.z - o.z) * inv.z;
  return vec2(psmax(ts.x, min(z1, z2), k), psmin(ts.y, max(z1, z2), k));
}

// Distance from a point to a solid, roughly, for the cake climbing round its foot.
float shapeDist(int shape, vec3 o, vec3 s, float k) {
  if (shape <= 1) {
    float e = (length(o / s) - 1.0) * min(s.x, min(s.y, s.z));
    return shape == 1 ? max(e, o.z) : e;
  }
  if (shape == 2) {
    vec3 q = abs(o) - (s - k);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - k;
  }
  vec2 w = vec2((length(o.xy / s.xy) - 1.0) * min(s.x, s.y), abs(o.z) - s.z);
  return length(max(w, 0.0)) + min(max(w.x, w.y), 0.0);
}

// How far a solid reaches from its centre along dir.
float support(int shape, vec3 dir, vec3 s) {
  float e = length(dir * s);
  if (shape == 0) return e;
  if (shape == 1) return dir.z * s.z * s.z <= 0.0 ? e : length(dir.xy * s.xy);
  if (shape == 2) return dot(abs(dir), s);
  return length(dir.xy * s.xy) + abs(dir.z) * s.z;
}

// Paint a piece at q (its top, in its own frame over its size): colour, gloss and a little
// relief, cells.
void pieceLook(int look, int shape, vec3 q, vec4 r, vec3 A, vec3 B, float g, float detail, out vec3 col, out float gloss, out float dh) {
  col = A;
  gloss = g;
  dh = 0.0;
  vec3 w = q * 2.6 + r.xyz * 37.0;
  float n1 = vnoise(w);
  float n2 = vnoise(w * 2.3 + 7.0);
  bool cut = shape == 1 && q.z > -0.06;
  if (look == 0) {
    // Dried fruit: wrinkles, darker in the creases, the thin edge lighter where light comes through.
    vec3 ww = q * vec3(1.8, 2.4, 1.6) + r.yzx * 23.0;
    float ridge = 1.0 - abs(2.0 * vnoise(ww + 1.4 * vec3(n1, n2, n1)) - 1.0);
    float crease = smoothstep(0.6, 0.95, ridge) * detail;
    float rim = smoothstep(0.35, 1.0, length(q.xy));
    dh = -0.12 * crease + 0.08 * detail * (n2 - 0.5);
    col = mix(A * (0.8 + 0.45 * n2), B, 0.55 * rim) * (1.0 - 0.35 * crease);
    gloss = g * (1.0 - 0.3 * crease);
  } else if (look == 1) {
    // A glace cherry: glossy and a little uneven; a halved one shows its paler cut face and the
    // hollow where the stone was.
    float pit = exp(-dot(q.xy, q.xy) / 0.04);
    dh = 0.02 * (n1 - 0.5);
    col = A * (0.85 + 0.3 * n2);
    if (cut) {
      dh -= 0.08 * pit;
      col = mix(A * 1.15 + vec3(0.01, 0.004, 0.004), A * 0.45, pit) * (0.85 + 0.3 * n1);
      gloss = g * 0.6;
    }
  } else if (look == 2) {
    // Candied peel: translucent, lighter at its edges, sugar glinting, the pores of the rind.
    vec3 a = abs(q);
    float m = max(a.x, max(a.y, a.z));
    float edge = smoothstep(0.55, 0.95, a.x + a.y + a.z - m - min(a.x, min(a.y, a.z)));
    float sugar = detail * smoothstep(0.8, 0.95, vnoise(q * 11.0 + r.xyz * 19.0));
    float pore = smoothstep(0.78, 0.92, vnoise(q * 8.0 + r.zxy * 13.0));
    col = A * (0.65 + 0.55 * edge) * (1.0 - 0.25 * pore);
    col = mix(col, B, 0.45 * sugar);
    dh = 0.015 * (n1 - 0.5) - 0.02 * pore;
  } else if (look == 3) {
    // An almond: cream inside, its brown skin on the back of a half and along a sliver's edge.
    float grain = vnoise(q * vec3(3.0, 12.0, 6.0) + r.xyz * 11.0);
    float skin = shape == 1 ? smoothstep(-0.25, -0.4, q.z) : smoothstep(0.62, 0.8, q.y);
    float groove = smoothstep(0.6, 0.9, abs(sin(q.y * 9.0 + 2.0 * n1)));
    col = mix(A * (0.88 + 0.2 * grain), B * (0.8 + 0.4 * groove), skin);
    gloss = mix(g, g * 1.4, skin);
    dh = 0.01 * (grain - 0.5) - 0.015 * skin * groove;
  } else if (look == 4) {
    // A marshmallow: soft and matte under a fine dusting, a little paler on its cut faces.
    float dust = detail * (0.5 * smoothstep(0.3, 0.9, vnoise(q * 6.0 + r.xyz * 9.0)) + 0.5 * vnoise(q * 18.0 + r.zxy * 5.0));
    float pores = smoothstep(0.7, 0.9, vnoise(q * 9.0 + r.zyx * 17.0));
    col = mix(A * (0.93 + 0.1 * n1) * (1.0 - 0.08 * pores), B, 0.25 * dust);
    dh = 0.02 * (n1 - 0.5) - 0.01 * pores;
  } else if (look == 5) {
    // A roasted peanut: tan and mottled, some still in patches of papery red-brown skin with fine
    // veins along it; a half shows its flat inner face and the notch at one end.
    float roast = vnoise(q * 3.5 + r.zxy * 21.0);
    col = A * (0.82 + 0.36 * roast);
    if (cut) {
      float notch = exp(-pow((q.x + 0.82) / 0.12, 2.0) - pow(q.y / 0.2, 2.0));
      col = mix(A * 1.25 + vec3(0.03, 0.025, 0.015), A * 0.55, notch);
      dh = -0.05 * notch + 0.01 * (n1 - 0.5);
      gloss = g * 0.7;
    } else if (r.w < 0.42) {
      float patchy = smoothstep(0.24, 0.32, vnoise(q * 1.8 + r.yzw * 29.0));
      float vein = smoothstep(0.9, 0.99, abs(sin(q.x * 9.0 + q.y * 4.0 + 2.0 * n2)));
      col = mix(col, B * (1.0 - 0.2 * vein) * (0.85 + 0.3 * n1), patchy);
      gloss = mix(g, g * 1.5, patchy);
      dh = 0.012 * patchy - 0.006 * vein * patchy;
    } else {
      dh = 0.012 * (roast - 0.5);
    }
  } else if (look == 6) {
    // A flake of coconut: off-white with fibres along it, toasted golden at the edges of some.
    float fibre = 0.5 + 0.5 * sin(q.x * 24.0 + 3.0 * n1);
    float toast = r.w < 0.35 ? smoothstep(0.5, 1.0, length(q.xy)) : 0.0;
    col = mix(A * (0.9 + 0.12 * fibre), B, toast);
    dh = 0.01 * fibre;
  } else {
    // A cube of jelly: deep and translucent, paler at its edges, crusted with sugar.
    vec3 a = abs(q);
    float m = max(a.x, max(a.y, a.z));
    float edge = smoothstep(0.5, 0.95, a.x + a.y + a.z - m - min(a.x, min(a.y, a.z)));
    float sugar = detail * smoothstep(0.55, 0.85, vnoise(q * 13.0 + r.xyz * 7.0));
    col = mix(A * (0.55 + 0.6 * edge), B, 0.55 * sugar);
    gloss = g * (1.0 - 0.6 * sugar);
    dh = 0.015 * sugar;
  }
}

// One layer of pieces: the eight cells of a grid of 'freq' cells to the radius nearest the point.
void layer(inout Hit best, vec3 d, float freq, float density, vec2 depth, int salt, float relief, vec2 fillet, float coatT) {
  vec3 P = d * freq;
  vec3 shift = uSeed * float(salt + 1) + vec3(17.31, 5.77, 11.13) * float(salt);
  vec3 g = P + shift;
  vec3 ig = floor(g);
  ivec3 base = ivec3(ig) + ivec3(step(0.5, g - ig)) - 1;
  for (int k = 0; k < 8; k++) {
    ivec3 c = base + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec4 h = hash43(c + ivec3(salt * 1013, salt * 71, salt * 409));
    if (h.x > density) continue;
    vec4 j = hash43(c + ivec3(5, 11, 17 + salt));
    vec3 C = vec3(c) + 0.5 + (j.xyz - 0.5) * (2.0 * JITTER) - shift;
    float lc = length(C);
    float off = lc - freq;
    if (off < depth.x || off > depth.y) continue;
    int kind = pickKind(salt, h.y);
    int shape;
    vec3 s;
    float shrink;
    float flatK;
    vec2 coatRange;
    int look;
    vec3 A;
    vec3 B;
    float g0;
    float detail;
    kindSpec(kind, h.w, shape, s, shrink, flatK, coatRange, look, A, B, g0, detail);
    s *= 1.0 - shrink * h.z;
    vec4 r = hash43(c + ivec3(23, 3, 41 + salt));
    vec4 r2 = hash43(c + ivec3(7, 61, 5 + salt));
    // Its frame, its own z turned some way to face out of the cake (and a half sometimes face in).
    vec3 az = normalize(mix(normalize(r.xyz - 0.5 + vec3(1e-3, 0.0, 0.0)), C / lc, flatK));
    if (shape == 1 && r2.x < 0.4) az = -az;
    vec3 ref = abs(az.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(ref, az));
    vec3 t2 = cross(az, t1);
    float a = r.w * 6.2831853;
    vec3 ax = cos(a) * t1 + sin(a) * t2;
    mat3 F = mat3(ax, cross(az, ax), az);
    float kr = ROUND * min(s.x, min(s.y, s.z));
    vec3 dL = d * F;
    // A piece never floats: its centre sits at most half its height out of the cake.
    float sup = support(shape, dL, s);
    float sink = max(off - 0.5 * sup, 0.0);
    C -= (C / lc) * sink;
    off -= sink;
    vec3 pL = (P - C) * F;
    // The cake's surface climbs round the piece's foot.
    float sd = shapeDist(shape, pL, s, kr);
    best.fil = max(best.fil, fillet.x * (1.0 - smoothstep(0.0, fillet.y, sd)) * relief / freq);
    vec2 t = castShape(shape, pL - dL * RAY_START, dL, s, kr);
    if (t.x >= t.y) continue;
    float top = t.y - RAY_START;
    vec3 q = (pL + dL * top) / s;
    float rise = clamp(top / max(off + sup, 0.05), 0.0, 1.0);
    // The coat reaches up the piece to a wavy line.
    float line = mix(coatRange.x, coatRange.y, r2.y);
    float coat = 1.0 - smoothstep(line - 0.07, line + 0.07, rise + 0.25 * (vnoise(q * 2.2 + r2.yzw * 31.0) - 0.5));
    vec3 col;
    float gloss;
    float dh;
    pieceLook(look, shape, q, r2, A, B, g0, detail, col, gloss, dh);
    float hv = (top + dh * min(s.x, min(s.y, s.z)) * (1.0 - coat) + coatT * (coat + 0.6 * coat * (1.0 - coat))) * relief / freq;
    if (hv > best.h) {
      best.h = hv;
      best.top = top * relief / freq;
      best.coat = coat;
      best.kind = kind;
      best.col = col;
      best.gloss = gloss;
    }
  }
}
`;

/** GLSL for one cake's pieces: the engine and `void pieces(vec3 d, inout Hit best)`. */
export const piecesGlsl = (set: PieceSet): string => {
  const kinds: PieceKind[] = [];
  for (const l of set.layers) for (const [k] of l.kinds) if (!kinds.includes(k)) kinds.push(k);
  const spec = kinds
    .map((k, i) => {
      const n = k.colours.length;
      const pick = k.colours
        .map((c, ci) =>
          ci < n - 1 ? `if (u < ${f((ci + 1) / n)}) A = ${v3(c)}; else ` : `A = ${v3(c)};`,
        )
        .join("");
      return `  if (kind == ${i}) {
    shape = ${k.shape}; s = ${v3(k.size)}; shrink = ${f(k.shrink)}; flatK = ${f(k.flat)};
    coat = vec2(${f(k.coat[0])}, ${f(k.coat[1])}); look = ${k.look}; B = ${v3(k.second)}; gloss = ${f(k.gloss)}; detail = ${f(k.detail)};
    ${pick}
    return;
  }`;
    })
    .join("\n");
  const pick = set.layers
    .map((l, li) => {
      const total = l.kinds.reduce((s, [, w]) => s + w, 0);
      let acc = 0;
      const lines = l.kinds.map(([k, w], ki) => {
        acc += w / total;
        const id = kinds.indexOf(k);
        return ki < l.kinds.length - 1 ? `if (u < ${f(acc)}) return ${id};` : `return ${id};`;
      });
      return `  if (layer == ${li}) { ${lines.join(" ")} }`;
    })
    .join("\n");
  const n = set.layers.length;
  const arr = (type: string, xs: string[]) => `${type}[${n}](${xs.join(", ")})`;
  const consts = [
    `const int LAYERS = ${n};`,
    `const float LAYER_FREQ[${n}] = ${arr(
      "float",
      set.layers.map((l) => f(l.freq)),
    )};`,
    `const float LAYER_DENSITY[${n}] = ${arr(
      "float",
      set.layers.map((l) => f(l.density)),
    )};`,
    `const vec2 LAYER_DEPTH[${n}] = ${arr(
      "vec2",
      set.layers.map((l) => `vec2(${f(l.depth[0])}, ${f(l.depth[1])})`),
    )};`,
  ].join("\n");
  return /* glsl */ `
void kindSpec(int kind, float u, out int shape, out vec3 s, out float shrink, out float flatK, out vec2 coat, out int look, out vec3 A, out vec3 B, out float gloss, out float detail) {
${spec}
  shape = 0; s = vec3(0.1); shrink = 0.0; flatK = 0.0; coat = vec2(0.0); look = 0; A = vec3(0.0); B = vec3(0.0); gloss = 0.0; detail = 0.0;
}
int pickKind(int layer, float u) {
${pick}
  return 0;
}
${ENGINE_GLSL}
${consts}
void pieces(vec3 d, inout Hit best) {
  for (int i = 0; i < LAYERS; i++) {
    layer(best, d, LAYER_FREQ[i], LAYER_DENSITY[i], LAYER_DEPTH[i], i, ${f(set.relief)}, vec2(${f(set.fillet[0])}, ${f(set.fillet[1])}), ${f(set.coatThickness)});
  }
}
`;
};

const DEEP: readonly [number, number] = [-0.24, 0.14];

// The pudding's fruit and nuts, darkened a little by the treacle but each its own colour.
const RAISIN: PieceKind = {
  name: "raisin",
  shape: SHAPE.egg,
  size: [0.46, 0.34, 0.2],
  shrink: 0.3,
  flat: 0.7,
  look: LOOK.wrinkled,
  colours: [
    [0.026, 0.006, 0.01],
    [0.034, 0.008, 0.015],
    [0.022, 0.006, 0.007],
  ],
  second: [0.06, 0.014, 0.016],
  detail: 1,
  gloss: 1.15,
  coat: [0.0, 0.35],
};
const SULTANA: PieceKind = {
  name: "sultana",
  shape: SHAPE.egg,
  size: [0.32, 0.22, 0.17],
  shrink: 0.3,
  flat: 0.5,
  look: LOOK.wrinkled,
  colours: [
    [0.17, 0.052, 0.007],
    [0.22, 0.075, 0.011],
    [0.13, 0.038, 0.006],
  ],
  second: [0.4, 0.16, 0.024],
  detail: 0.35,
  gloss: 1.25,
  coat: [0.0, 0.35],
};
const CURRANT: PieceKind = {
  name: "currant",
  shape: SHAPE.egg,
  size: [0.36, 0.3, 0.22],
  shrink: 0.25,
  flat: 0.6,
  look: LOOK.wrinkled,
  colours: [
    [0.012, 0.004, 0.005],
    [0.018, 0.006, 0.008],
  ],
  second: [0.045, 0.012, 0.016],
  detail: 1,
  gloss: 1.1,
  coat: [0.0, 0.3],
};
const DATE: PieceKind = {
  name: "date",
  shape: SHAPE.egg,
  size: [0.5, 0.26, 0.2],
  shrink: 0.3,
  flat: 0.7,
  look: LOOK.wrinkled,
  colours: [
    [0.06, 0.018, 0.006],
    [0.075, 0.025, 0.009],
  ],
  second: [0.14, 0.045, 0.014],
  detail: 0.5,
  gloss: 0.5,
  coat: [0.0, 0.35],
};
const CHERRY: PieceKind = {
  name: "glacé cherry",
  shape: SHAPE.half,
  size: [0.44, 0.44, 0.4],
  shrink: 0.25,
  flat: 0.75,
  look: LOOK.glace,
  colours: [
    [0.42, 0.012, 0.018],
    [0.36, 0.01, 0.016],
    [0.46, 0.016, 0.022],
    [0.4, 0.014, 0.02],
    [0.06, 0.16, 0.018],
  ],
  second: [0, 0, 0],
  detail: 1,
  gloss: 1.2,
  coat: [0.05, 0.35],
};
const PEEL: PieceKind = {
  name: "candied peel",
  shape: SHAPE.box,
  size: [0.27, 0.24, 0.2],
  shrink: 0.35,
  flat: 0.3,
  look: LOOK.peel,
  colours: [
    [0.46, 0.13, 0.012],
    [0.44, 0.18, 0.02],
    [0.5, 0.16, 0.015],
    [0.24, 0.21, 0.028],
    [0.1, 0.13, 0.018],
  ],
  second: [0.5, 0.44, 0.34],
  detail: 1,
  gloss: 1.0,
  coat: [0.0, 0.4],
};
const ALMOND_SLIVER: PieceKind = {
  name: "almond sliver",
  shape: SHAPE.box,
  size: [0.5, 0.17, 0.06],
  shrink: 0.3,
  flat: 0.8,
  look: LOOK.almond,
  colours: [
    [0.4, 0.27, 0.14],
    [0.45, 0.31, 0.17],
  ],
  second: [0.18, 0.07, 0.03],
  detail: 1,
  gloss: 0.35,
  coat: [0.0, 0.3],
};
const ALMOND_HALF: PieceKind = {
  name: "almond half",
  shape: SHAPE.half,
  size: [0.5, 0.32, 0.17],
  shrink: 0.25,
  flat: 0.7,
  look: LOOK.almond,
  colours: [
    [0.4, 0.27, 0.14],
    [0.44, 0.3, 0.17],
  ],
  second: [0.2, 0.08, 0.03],
  detail: 1,
  gloss: 0.4,
  coat: [0.0, 0.3],
};

export const PUDDING_PIECES: PieceSet = {
  layers: [
    {
      freq: 5.5,
      density: 1,
      depth: DEEP,
      kinds: [
        [RAISIN, 0.3],
        [DATE, 0.1],
        [CHERRY, 0.22],
        [ALMOND_HALF, 0.12],
        [SULTANA, 0.14],
        [PEEL, 0.12],
      ],
    },
    {
      freq: 6.5,
      density: 1,
      depth: DEEP,
      kinds: [
        [RAISIN, 0.72],
        [DATE, 0.13],
        [SULTANA, 0.15],
      ],
    },
    {
      freq: 7.5,
      density: 1,
      depth: DEEP,
      kinds: [
        [RAISIN, 0.4],
        [SULTANA, 0.2],
        [PEEL, 0.12],
        [ALMOND_SLIVER, 0.12],
        [CHERRY, 0.08],
        [DATE, 0.08],
      ],
    },
    {
      freq: 10,
      density: 1,
      depth: DEEP,
      kinds: [
        [RAISIN, 0.58],
        [SULTANA, 0.2],
        [PEEL, 0.12],
        [ALMOND_SLIVER, 0.1],
      ],
    },
    {
      freq: 12,
      density: 1,
      depth: DEEP,
      kinds: [
        [RAISIN, 0.5],
        [CURRANT, 0.35],
        [SULTANA, 0.15],
      ],
    },
    {
      freq: 15,
      density: 1,
      depth: DEEP,
      kinds: [
        [CURRANT, 0.65],
        [RAISIN, 0.25],
        [SULTANA, 0.1],
      ],
    },
  ],
  relief: 0.7,
  fillet: [0.03, 0.06],
  coatThickness: 0.015,
};

// Rocky road: pieces stand well out of the chocolate.
const SHALLOW: readonly [number, number] = [-0.22, 0.2];
const MARSHMALLOWS: readonly Rgb[] = [
  [0.6, 0.58, 0.55],
  [0.64, 0.61, 0.57],
  [0.66, 0.22, 0.3],
  [0.7, 0.3, 0.37],
];
const DUST: Rgb = [0.64, 0.62, 0.6];
const MARSHMALLOW: PieceKind = {
  name: "marshmallow",
  shape: SHAPE.box,
  size: [0.38, 0.34, 0.3],
  shrink: 0.25,
  flat: 0.6,
  look: LOOK.marshmallow,
  colours: MARSHMALLOWS,
  second: DUST,
  detail: 1,
  gloss: 0.1,
  coat: [0.05, 0.6],
};
const ROUND_MARSHMALLOW: PieceKind = {
  name: "round marshmallow",
  shape: SHAPE.drum,
  size: [0.36, 0.36, 0.28],
  shrink: 0.25,
  flat: 0.5,
  look: LOOK.marshmallow,
  colours: MARSHMALLOWS,
  second: DUST,
  detail: 1,
  gloss: 0.1,
  coat: [0.05, 0.6],
};
const MINI_MARSHMALLOW: PieceKind = {
  name: "mini marshmallow",
  shape: SHAPE.drum,
  size: [0.36, 0.36, 0.42],
  shrink: 0.2,
  flat: 0.2,
  look: LOOK.marshmallow,
  colours: MARSHMALLOWS,
  second: DUST,
  detail: 0.7,
  gloss: 0.1,
  coat: [0.1, 0.65],
};
const PEANUT: PieceKind = {
  name: "peanut",
  shape: SHAPE.egg,
  size: [0.46, 0.29, 0.27],
  shrink: 0.25,
  flat: 0.35,
  look: LOOK.peanut,
  colours: [
    [0.4, 0.21, 0.075],
    [0.46, 0.26, 0.1],
    [0.36, 0.18, 0.06],
  ],
  second: [0.17, 0.05, 0.025],
  detail: 1,
  gloss: 0.35,
  coat: [0.1, 0.7],
};
const PEANUT_HALF: PieceKind = { ...PEANUT, name: "peanut half", shape: SHAPE.half, flat: 0.5 };
const RED_CHERRY: PieceKind = {
  name: "glacé cherry",
  shape: SHAPE.half,
  size: [0.4, 0.4, 0.37],
  shrink: 0.2,
  flat: 0.75,
  look: LOOK.glace,
  colours: [
    [0.42, 0.012, 0.018],
    [0.5, 0.02, 0.025],
  ],
  second: [0, 0, 0],
  detail: 1,
  gloss: 1.2,
  coat: [0.1, 0.6],
};
const COCONUT: PieceKind = {
  name: "coconut flake",
  shape: SHAPE.egg,
  size: [0.44, 0.3, 0.06],
  shrink: 0.3,
  flat: 0.8,
  look: LOOK.coconut,
  colours: [
    [0.6, 0.57, 0.5],
    [0.55, 0.5, 0.42],
  ],
  second: [0.42, 0.24, 0.09],
  detail: 1,
  gloss: 0.15,
  coat: [0.0, 0.5],
};
const JELLY: PieceKind = {
  name: "jelly cube",
  shape: SHAPE.box,
  size: [0.27, 0.25, 0.23],
  shrink: 0.25,
  flat: 0.2,
  look: LOOK.jelly,
  colours: [
    [0.6, 0.05, 0.14],
    [0.62, 0.12, 0.22],
  ],
  second: [0.64, 0.6, 0.57],
  detail: 1,
  gloss: 0.45,
  coat: [0.05, 0.5],
};

export const ROCKY_PIECES: PieceSet = {
  layers: [
    {
      freq: 2.6,
      density: 1,
      depth: SHALLOW,
      kinds: [
        [MARSHMALLOW, 0.6],
        [ROUND_MARSHMALLOW, 0.4],
      ],
    },
    {
      freq: 3.1,
      density: 1,
      depth: SHALLOW,
      kinds: [
        [MARSHMALLOW, 0.5],
        [ROUND_MARSHMALLOW, 0.3],
        [JELLY, 0.2],
      ],
    },
    {
      freq: 3.8,
      density: 1,
      depth: SHALLOW,
      kinds: [
        [MARSHMALLOW, 0.5],
        [RED_CHERRY, 0.3],
        [JELLY, 0.2],
      ],
    },
    {
      freq: 5,
      density: 1,
      depth: SHALLOW,
      kinds: [
        [PEANUT, 0.3],
        [PEANUT_HALF, 0.2],
        [MINI_MARSHMALLOW, 0.25],
        [RED_CHERRY, 0.1],
        [JELLY, 0.15],
      ],
    },
    {
      freq: 7,
      density: 1,
      depth: SHALLOW,
      kinds: [
        [PEANUT, 0.25],
        [PEANUT_HALF, 0.25],
        [MINI_MARSHMALLOW, 0.3],
        [COCONUT, 0.2],
      ],
    },
    {
      freq: 11,
      density: 0.9,
      depth: SHALLOW,
      kinds: [
        [COCONUT, 0.45],
        [PEANUT_HALF, 0.3],
        [MINI_MARSHMALLOW, 0.25],
      ],
    },
  ],
  relief: 1,
  fillet: [0.1, 0.14],
  coatThickness: 0.035,
};
