import { HEADER } from "./common";

/**
 * Builds the starting world: floating islands (one with a volcano) in the sky, and the landscape
 * (dunes and a pond in the sandbox, cliff, slope and sea in the delta), plus a few sprouting
 * plants. Mode 0 builds from nothing, mode 1 grows the landscape back into empty cells after a
 * drain, and mode 2 clears everything except scenery.
 */
export const MAX_ISLANDS = 3;

export const GENESIS_FS = `${HEADER}
#define MAX_ISLANDS ${MAX_ISLANDS}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform float u_seed;
// 0 sandbox, 1 delta, 2 sky only (the screen above a bank).
uniform int u_variant;
uniform int u_mode;
// Islands: (cx, cy, half width, half height) and their cones (centre offset, half width, height,
// crater half width), in cells. A cone of height 0 is a plain island.
uniform int u_islandCount;
uniform vec4 u_islandA[MAX_ISLANDS];
uniform vec4 u_islandB[MAX_ISLANDS];
// Sandbox: (base height, dune amplitude, pond x, pond half width).
// Delta: (cliff x, cliff height, slope end x, sea level).
uniform vec4 u_terrain;
uniform float u_plantScale;

out uvec4 o_cell;

float sandboxGround(float x) {
  float n = 0.62 * vnoise(vec2(x * 0.006 + u_seed, 1.0)) + 0.38 * vnoise(vec2(x * 0.021 + u_seed * 1.7, 5.0));
  float h = u_terrain.x + u_terrain.y * (n - 0.3);
  float pond = 1.0 - smoothstep(0.0, 1.0, abs(x - u_terrain.z) / max(u_terrain.w, 1.0));
  return h - pond * pond * u_terrain.y * 1.5;
}

float deltaGround(float x) {
  float t = smoothstep(u_terrain.x, u_terrain.z, x);
  float h = mix(u_terrain.y * 0.55, u_terrain.w * 0.45, t);
  return h + (vnoise(vec2(x * 0.03 + u_seed, 2.0)) - 0.5) * 8.0;
}

Cell sprout(uint shade) {
  float energy = (40.0 + float(shade % 48u)) * u_plantScale;
  return makeCell(E_PLANT, shade, uint(clamp(energy, 8.0, 250.0)));
}

// 0 nothing, 1 island rock, 2 volcanic rock, 3 soil, 4 sprout.
int island(vec2 p, vec4 a, vec4 cone, float seed) {
  vec2 q = p - a.xy;
  float u = q.x / a.z;
  if (abs(u) >= 1.0) return 0;
  float hh = a.w;
  // A gently domed top, and a ragged underside that hangs lowest in the middle.
  float top = hh * 0.18 * (1.0 - u * u) + hh * 0.08 * (vnoise(vec2(q.x * 0.08 + seed, 7.0)) - 0.5);
  float rag = vnoise(vec2(q.x * 0.18 + seed, 3.0));
  float bottom = -hh * pow(1.0 - u * u, 0.7) * (0.7 + 0.5 * rag);
  if (q.y < bottom) return 0;
  if (q.y <= top) return 1;
  float conePeak = top + 1.0;
  if (cone.z > 0.0) {
    float dx = abs(q.x - cone.x);
    float h = cone.z * (1.0 - pow(min(dx / cone.y, 1.0), 1.3)) + (vnoise(vec2(q.x * 0.3, 9.0)) - 0.5) * 2.0;
    bool crater = dx < cone.w && q.y > cone.z * 0.72;
    if (q.y <= h && !crater) return 2;
    conePeak = max(conePeak, h);
  }
  bool level = conePeak <= top + 1.0;
  if (level && q.y <= top + 3.0 && abs(u) < 0.9) return 3;
  if (level && q.y <= top + 4.0 && abs(u) < 0.8 && int(p.x) % 7 == 0 && hashf(vec2(floor(p.x / 7.0), seed)) < 0.35) return 4;
  return 0;
}

Cell build(ivec2 ip) {
  vec2 p = vec2(ip) + 0.5;
  uint shade = hash2(ip, uint(u_seed * 1000.0)) & 255u;
  // Rock shows layered strata rather than flat noise.
  float layers = 0.5 + 0.32 * sin(p.y * 0.45 + vnoise(p * 0.05) * 5.0) + (float(shade) / 255.0 - 0.5) * 0.35;
  uint rock = uint(clamp(layers, 0.0, 1.0) * 255.0);

  for (int i = 0; i < MAX_ISLANDS; i++) {
    if (i >= u_islandCount) break;
    int isl = island(p, u_islandA[i], u_islandB[i], 41.7 + float(i) * 13.1);
    if (isl == 1) return makeCell(E_BEDROCK, rock, 0u);
    if (isl == 2) return Cell(E_BEDROCK, rock, 0u, AUX_STYLE);
    if (isl == 3) return makeCell(E_SAND, shade, 0u);
    if (isl == 4) return sprout(shade);
  }

  if (u_variant == 2) return makeCell(E_EMPTY, 0u, 0u);

  if (u_variant == 1) {
    float cliffEdge = u_terrain.x + (vnoise(vec2(p.y * 0.08, u_seed)) - 0.5) * 10.0;
    bool onCliff = p.x < cliffEdge;
    if (onCliff && p.y < u_terrain.y) return makeCell(E_BEDROCK, rock, 0u);
    if (onCliff && p.y < u_terrain.y + 5.0) return makeCell(E_SAND, shade, 0u);
    if (onCliff && p.x < cliffEdge - 6.0 && p.y < u_terrain.y + 6.0 && ip.x % 13 == 0 && hashf(vec2(float(ip.x), 1.0)) < 0.5) return sprout(shade);
    float g = deltaGround(p.x);
    if (p.y < g) return makeCell(p.y < g * 0.3 ? E_GRAVEL : E_SAND, shade, 0u);
    if (p.x > u_terrain.z * 0.85 && p.y < u_terrain.w) return makeCell(E_WATER, shade, 0u);
    return makeCell(E_EMPTY, 0u, 0u);
  }

  float g = sandboxGround(p.x);
  if (p.y < g) return makeCell(p.y < g * 0.35 ? E_GRAVEL : E_SAND, shade, 0u);
  float pondDist = abs(p.x - u_terrain.z) / max(u_terrain.w, 1.0);
  float level = u_terrain.x + u_terrain.y * 0.1;
  if (pondDist < 1.0 && p.y < level) return makeCell(E_WATER, shade, 0u);
  // Plants along the dunes, more of them near the water.
  bool nearPond = pondDist > 0.75 && pondDist < 1.6;
  if (p.y < g + 1.0 && pondDist > 0.85 && ip.x % 17 == 0 && hashf(vec2(float(ip.x), u_seed)) < (nearPond ? 0.8 : 0.22)) {
    return sprout(shade);
  }
  return makeCell(E_EMPTY, 0u, 0u);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  if (u_mode == 0) {
    o_cell = packCell(build(ip));
    return;
  }
  Cell now = cellOf(texelFetch(u_state, ip, 0));
  if (u_mode == 2) {
    o_cell = SCENERY(now.id) ? packCell(now) : uvec4(0u);
    return;
  }
  o_cell = now.id == E_EMPTY ? packCell(build(ip)) : packCell(now);
}
`;
