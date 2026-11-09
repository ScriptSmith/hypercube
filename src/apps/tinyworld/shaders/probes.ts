import { HEADER, OUTLET_GLSL } from "./common";

/**
 * Small passes whose results the CPU reads back asynchronously, a few times a second at most.
 */

/**
 * A tiny summary for the CPU, read back every few seconds: per region, the share of cells that
 * hold something (r) and that are scenery (g), from an 8 x 8 sample grid.
 */
export const STATS_FS = `${HEADER}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform ivec2 u_out;
out vec4 o_stats;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec2 cellSize = vec2(u_size) / vec2(u_out);
  float filled = 0.0;
  float scenery = 0.0;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      ivec2 p = ivec2((vec2(t) + (vec2(i, j) + 0.5) / 8.0) * cellSize);
      Cell c = cellOf(texelFetch(u_state, min(p, u_size - 1), 0));
      if (SCENERY(c.id)) scenery += 1.0;
      else if (KIND(c.id) >= K_LIQUID) filled += 1.0;
    }
  }
  o_stats = vec4(filled / 64.0, scenery / 64.0, 0.0, 1.0);
}
`;

/**
 * Ground under each pair of columns, for the beetles: scanning down from u_scanTop, the first
 * settled grain or solid. Out: ground row (r low byte, g high byte), the depth of liquid lying on
 * it (b, cells) and what that liquid is (a: 0 none, 1 water or oil, 2 lava, 3 acid).
 */
export const HEIGHT_FS = `${HEADER}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform int u_scanTop;
out vec4 o_ground;

bool isGround(Cell c) {
  uint k = KIND(c.id);
  return k == K_STATIC ? c.id != E_CABINET : (k == K_POWDER && (c.aux & AUX_MOVED) == 0u);
}

void main() {
  int x = min(int(gl_FragCoord.x) * 2, u_size.x - 1);
  int ground = 0;
  for (int y = u_scanTop; y >= 0; y--) {
    if (isGround(cellOf(texelFetch(u_state, ivec2(x, y), 0)))) {
      ground = y + 1;
      break;
    }
  }
  int depth = 0;
  float kind = 0.0;
  for (int k = 0; k < 64; k++) {
    int y = ground + k;
    if (y >= u_size.y) break;
    Cell c = cellOf(texelFetch(u_state, ivec2(x, y), 0));
    if (KIND(c.id) != K_LIQUID) break;
    depth++;
    kind = c.id == E_LAVA ? 2.0 : c.id == E_ACID ? 3.0 : 1.0;
  }
  o_ground = vec4(float(ground & 255), float(ground >> 8), float(depth), kind) / 255.0;
}
`;

/** Copies out the cells the outlet takes this tick (see OUTLET_GLSL), from the top rows. */
export const OUTLET_FS = `${HEADER}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform vec4 u_outlet;
uniform vec4 u_outletCols[MAX_ZONES];
out uvec4 o_cell;
${OUTLET_GLSL}
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), u_size.y - 1 - int(gl_FragCoord.y));
  Cell c = cellOf(texelFetch(u_state, p, 0));
  o_cell = outletTakes(c, float(p.x) + 0.5) ? uvec4(c.id, 0u, 0u, 0u) : uvec4(0u);
}
`;
