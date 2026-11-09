import { HEADER, OUTLET_GLSL, PIECE_SDF } from "./common";

/**
 * Once per tick, before the block passes: pours and weather (emitters), piece stamps, the
 * floor sink, the sea edge in the delta, steam condensing in clouds, and the drain.
 */
export const INPUT_FS = `${HEADER}
${PIECE_SDF}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform uint u_seed;

// Emitters are capsules in cells: a = (x0, y0, x1, y1), b = (radius, chance, element, lifeLo),
// c = (lifeHi, mode, -, -). Mode 1 also lights flammable cells; mode 2 erases instead.
uniform int u_emitCount;
uniform vec4 u_emitA[MAX_EMITTERS];
uniform vec4 u_emitB[MAX_EMITTERS];
uniform vec4 u_emitC[MAX_EMITTERS];

// Stamps: a = (cx, cy, hx, hy) in cells, b = (shape, material, op, mirror).
// Ops: 0 place, 1 remove, 2 crumble.
uniform int u_stampCount;
uniform vec4 u_stampA[MAX_STAMPS];
uniform vec4 u_stampB[MAX_STAMPS];

uniform float u_sink;
uniform float u_crumble;
uniform float u_fade;
// Delta sea edge: (x0, x1, level, on), in cells.
uniform vec4 u_sea;
uniform int u_cloudCount;
uniform vec4 u_cloud[MAX_CLOUDS];
// Chance per tick that water open to the air turns to steam, and that snow touching water melts.
uniform float u_evaporation;
uniform float u_melt;
// Heaters and coolers: (x, y, radius, sign) in cells; sign 1 heats, -1 cools.
uniform int u_heatCount;
uniform vec4 u_heat[MAX_HEATS];
// The outlet in a bank: cells in the top rows inside these columns leave for the screen above.
// (rows, -, -, -) and up to MAX_ZONES column ranges (x0, x1, -, -) in cells.
uniform vec4 u_outlet;
uniform vec4 u_outletCols[MAX_ZONES];

out uvec4 o_cell;

${OUTLET_GLSL}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

uint debrisShade(uint material, uint rng) {
  uint sub = material == E_WOOD ? 1u : material == E_GLASS ? 2u : material == E_METAL ? 3u : 0u;
  return (sub << 6u) | (rng & 63u);
}

// The shade byte of a freshly stamped piece cell carries its texture: wood grain, glass edge
// light, brushed metal or speckled stone.
uint pieceShade(uint material, vec2 q, float sdf, uint rng) {
  if (material == E_WOOD) {
    float grain = sin(q.y * 1.3 + sin(q.x * 0.11) * 2.2 + vnoise(q * 0.25) * 2.0);
    return uint(clamp(128.0 + 95.0 * grain, 0.0, 255.0));
  }
  if (material == E_GLASS) return uint(clamp(-sdf * 48.0, 0.0, 255.0));
  if (material == E_METAL) {
    float streak = hashf(vec2(floor(q.y), 3.0)) * 0.7 + vnoise(vec2(q.x * 0.05, q.y)) * 0.3;
    return uint(clamp(streak * 255.0, 0.0, 255.0));
  }
  return uint(clamp(vnoise(q * 0.35) * 200.0 + float(rng & 55u), 0.0, 255.0));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pc = vec2(p) + 0.5;
  Cell c = cellOf(texelFetch(u_state, p, 0));
  // Read before anything changes it, exactly as the outlet capture pass reads it.
  Cell before = c;
  uint rng = hash2(p, u_seed);

  for (int i = 0; i < MAX_STAMPS; i++) {
    if (i >= u_stampCount) break;
    vec4 a = u_stampA[i];
    vec4 b = u_stampB[i];
    vec2 q = pc - a.xy;
    if (abs(q.x) > a.z + 1.0 || abs(q.y) > a.w + 1.0) continue;
    float sdf = pieceSdf(int(b.x), q, a.zw, b.w > 0.5);
    if (sdf > 0.0) continue;
    uint material = uint(b.y);
    int op = int(b.z);
    if (op == 0) {
      c = makeCell(material, pieceShade(material, q, sdf, pcg(rng)), 0u);
    } else if (c.id == material || (material == E_WOOD && c.id == E_EMBER)) {
      c = either(op == 1, makeCell(E_EMPTY, 0u, 0u), makeCell(E_DEBRIS, debrisShade(material, pcg(rng)), 0u));
    }
  }

  for (int i = 0; i < MAX_EMITTERS; i++) {
    if (i >= u_emitCount) break;
    vec4 a = u_emitA[i];
    vec4 b = u_emitB[i];
    if (segDist(pc, a.xy, a.zw) > b.x) continue;
    rng = pcg(rng + uint(i));
    if (rand(rng) >= b.y) continue;
    vec4 e = u_emitC[i];
    if (e.y > 1.5) {
      // Remove: loose matter and plants go; pieces (tracked by the app) and scenery stay.
      bool piece = c.id == E_STONE || c.id == E_WOOD || c.id == E_GLASS || c.id == E_METAL;
      if (!SCENERY(c.id) && !piece) c = makeCell(E_EMPTY, 0u, 0u);
      break;
    }
    uint element = uint(b.z);
    bool open = KIND(c.id) <= K_GAS;
    if (open) {
      c = makeCell(element, pcg(rng), uint(mix(b.w, e.x, rand(rng))));
      if (rand(rng) < 0.5) c.aux |= AUX_RIGHT;
    } else if (e.y > 0.5 && FLAMMABLE(c.id) > 0.0) {
      c = makeCell(E_FIRE, pcg(rng), 160u);
    }
    break;
  }

  bool scenery = SCENERY(c.id);
  if (p.y == 0 && u_sink > 0.0 && isMover(c) && rand(rng) < u_sink) {
    c = makeCell(E_EMPTY, 0u, 0u);
  }

  if (u_sea.w > 0.5 && pc.x >= u_sea.x && pc.x < u_sea.y && !scenery) {
    if (pc.y < u_sea.z) {
      if ((c.id == E_EMPTY || c.id == E_SILT) && rand(rng) < 0.5) c = makeCell(E_WATER, pcg(rng), 0u);
    } else if ((c.id == E_WATER || c.id == E_SILT) && rand(rng) < 0.5) {
      c = makeCell(E_EMPTY, 0u, 0u);
    }
  }

  // Rare, slow changes that need a neighbour outside the 2 x 2 block: done here once a tick.
  if (c.id == E_WATER && u_evaporation > 0.0 && rand(rng) < u_evaporation) {
    if (cellOf(texelFetch(u_state, min(p + ivec2(0, 1), u_size - 1), 0)).id == E_EMPTY && p.y < u_size.y - 1) {
      c = makeCell(E_STEAM, pcg(rng), 150u + (pcg(rng + 7u) & 100u));
    }
  } else if (c.id == E_SNOW && rand(rng) < u_melt) {
    uint up = cellOf(texelFetch(u_state, min(p + ivec2(0, 1), u_size - 1), 0)).id;
    uint left = cellOf(texelFetch(u_state, max(p - ivec2(1, 0), ivec2(0)), 0)).id;
    uint right = cellOf(texelFetch(u_state, min(p + ivec2(1, 0), u_size - 1), 0)).id;
    if (up == E_WATER || left == E_WATER || right == E_WATER) c = makeCell(E_WATER, c.shade, 0u);
  }

  for (int i = 0; i < MAX_HEATS; i++) {
    if (i >= u_heatCount) break;
    vec4 h = u_heat[i];
    if (length(pc - h.xy) > h.z) continue;
    if (h.w > 0.0) {
      if (c.id == E_WATER && rand(rng) < 0.004) c = makeCell(E_STEAM, pcg(rng), 200u);
      else if ((c.id == E_SNOW || c.id == E_ICE) && rand(rng) < 0.03) c = makeCell(E_WATER, c.shade, 0u);
      else if (c.id == E_KERNEL && rand(rng) < 0.03) c.life = 1u;
    } else {
      if (c.id == E_WATER && rand(rng) < 0.004) c = makeCell(E_ICE, c.shade, 230u);
      else if (c.id == E_STEAM && rand(rng) < 0.05) c = makeCell(E_WATER, c.shade, 0u);
      else if (c.id == E_LAVA && rand(rng) < 0.03) c = makeCell(E_GRAVEL, c.shade, 0u);
      else if ((c.id == E_FIRE || c.id == E_SPARK) && rand(rng) < 0.2) c = makeCell(E_EMPTY, 0u, 0u);
    }
    break;
  }

  if (u_outlet.x > 0.0 && p.y >= u_size.y - int(u_outlet.x) && outletTakes(before, pc.x)) {
    c = makeCell(E_EMPTY, 0u, 0u);
  }

  if (c.id == E_STEAM) {
    for (int i = 0; i < MAX_CLOUDS; i++) {
      if (i >= u_cloudCount) break;
      vec4 k = u_cloud[i];
      if (length((pc - k.xy) / k.zw) < 1.0 && rand(rng) < 0.03) {
        c = makeCell(E_WATER, pcg(rng), 0u);
        break;
      }
    }
  }

  if (!scenery && c.id != E_EMPTY) {
    if (KIND(c.id) == K_STATIC && rand(rng) < u_crumble) {
      if (c.id == E_PLANT || c.id == E_EMBER) c = makeCell(E_ASH, pcg(rng), 0u);
      else c = makeCell(E_DEBRIS, debrisShade(c.id, pcg(rng)), 0u);
    }
    if (rand(rng) < u_fade) c = makeCell(E_EMPTY, 0u, 0u);
  }

  o_cell = packCell(c);
}
`;
