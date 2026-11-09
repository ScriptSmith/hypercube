import { AUX_FLOWER, AUX_LEAF, AUX_MOVED, AUX_RIGHT, AUX_SPEED, AUX_STYLE } from "../blocks";
import { glslElementTable } from "../elements";

/** Uniform array sizes, shared with the code that fills them. */
export const MAX_EMITTERS = 32;
export const MAX_STAMPS = 4;
export const MAX_CLOUDS = 6;
export const MAX_CURSORS = 24;
export const MAX_GHOSTS = 4;
export const MAX_ZONES = 8;
export const MAX_HEATS = 4;

/** One triangle that covers the viewport; `v_uv` runs 0 to 1, y up. */
export const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Precision, the element table, cell packing, hashing and noise. */
export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

${glslElementTable()}

#define AUX_SPEED ${AUX_SPEED}u
#define AUX_RIGHT ${AUX_RIGHT}u
#define AUX_MOVED ${AUX_MOVED}u
#define AUX_LEAF ${AUX_LEAF}u
#define AUX_FLOWER ${AUX_FLOWER}u
#define AUX_STYLE ${AUX_STYLE}u

#define MAX_EMITTERS ${MAX_EMITTERS}
#define MAX_STAMPS ${MAX_STAMPS}
#define MAX_CLOUDS ${MAX_CLOUDS}
#define MAX_CURSORS ${MAX_CURSORS}
#define MAX_GHOSTS ${MAX_GHOSTS}
#define MAX_ZONES ${MAX_ZONES}
#define MAX_HEATS ${MAX_HEATS}

struct Cell {
  uint id;
  uint shade;
  uint life;
  uint aux;
};

Cell cellOf(uvec4 v) { return Cell(v.r, v.g, v.b, v.a); }
uvec4 packCell(Cell c) { return uvec4(c.id, c.shade & 255u, min(c.life, 255u), c.aux & 255u); }
Cell makeCell(uint id, uint shade, uint life) { return Cell(id, shade & 255u, min(life, 255u), 0u); }

// WebGL forbids ?: on structs.
Cell either(bool first, Cell a, Cell b) {
  if (first) return a;
  return b;
}

// PCG-style integer hash (Jarzynski and Olano, "Hash Functions for GPU Rendering", 2020).
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uint hash2(ivec2 p, uint seed) {
  return pcg(uint(p.x + 4096) ^ pcg(uint(p.y + 4096) ^ pcg(seed)));
}

// Uniform in [0, 1), advancing the stream.
float rand(inout uint s) {
  s = pcg(s);
  return float(s >> 8u) * (1.0 / 16777216.0);
}

float hashf(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 65536);
  return float(pcg(q.x ^ pcg(q.y)) >> 8u) * (1.0 / 16777216.0);
}

// Smooth value noise in [0, 1].
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashf(i);
  float b = hashf(i + vec2(1.0, 0.0));
  float c = hashf(i + vec2(0.0, 1.0));
  float d = hashf(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return sum;
}

uint kindOf(Cell c) { return KIND(c.id); }
bool isFluid(Cell c) { return KIND(c.id) <= K_LIQUID; }
bool isMover(Cell c) { return KIND(c.id) == K_POWDER || KIND(c.id) == K_LIQUID; }
bool flows(Cell c) { return KIND(c.id) == K_LIQUID || KIND(c.id) == K_GAS; }
`;

/**
 * Rounded box distance and the piece shapes, shared by the stamp pass and the ghost preview.
 * Coordinates are in cells relative to the piece centre, y up; `h` is the half size.
 */
export const PIECE_SDF = `
float sdBox(vec2 q, vec2 h, float r) {
  vec2 d = abs(q) - h + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// Signed distance to a piece outline (negative inside). Shapes: 0 block, 1 ramp, 2 bowl, 3 platform.
float pieceSdf(int shape, vec2 q, vec2 h, bool mirror) {
  if (mirror) q.x = -q.x;
  float m = min(h.x, h.y);
  if (shape == 0) return sdBox(q, h, m * 0.14);
  if (shape == 1) {
    // Right angle at the bottom left, slope falling to the right.
    vec2 n = normalize(vec2(2.0 * h.y, 2.0 * h.x));
    float slope = dot(q - vec2(-h.x, h.y), n);
    return max(sdBox(q, h, m * 0.06), slope);
  }
  if (shape == 2) {
    float t = h.y * 0.34;
    float outer = sdBox(q, h, m * 0.9);
    float hc = (2.0 * h.y + m - t) * 0.5;
    float inner = sdBox(q - vec2(0.0, -h.y + t + hc), vec2(h.x - t, hc), max(m * 0.9 - t, 0.5));
    return max(outer, -inner);
  }
  return sdBox(q, h, m * 0.3);
}
`;

/**
 * Which cells the outlet takes: moving matter (grains, liquids) in an outlet column. Shared by
 * the input pass, which clears them, and the capture pass, which copies them out, so the two
 * agree exactly. Needs u_outletCols and u_outlet declared.
 */
export const OUTLET_GLSL = `
bool outletTakes(Cell c, float x) {
  uint k = KIND(c.id);
  if (k != K_POWDER && k != K_LIQUID) return false;
  for (int i = 0; i < MAX_ZONES; i++) {
    if (float(i) >= u_outlet.y) break;
    vec4 col = u_outletCols[i];
    if (x >= col.x && x < col.y) return true;
  }
  return false;
}
`;
