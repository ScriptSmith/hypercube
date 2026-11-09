import { HEADER } from "./common";

/**
 * One Margolus pass. Every fragment loads its 2 x 2 block, runs the same ageing, chemistry and
 * movement as the other three cells of the block (same inputs, same random stream), and writes
 * its own quarter. `moveBlock` mirrors `moveBlock` in `blocks.ts`; change both together.
 */
export const STEP_FS = `${HEADER}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform ivec2 u_offset;
uniform uint u_seed;
// -1 to 1: which way smoke and steam drift.
uniform float u_wind;
// Chance per pass that sand under moving water becomes silt (delta only).
uniform float u_erosion;
// Steam that dies above this row (cells) may condense into a drop.
uniform float u_condenseY;
// Scales plant growth energy to the world height.
uniform float u_plantScale;
// Zones from gadgets: (x0, y0, x1, y1) in cells, and (kind, strength, -, -). Kind 1 lifts
// (a geyser), 2 pushes right and 3 pushes left (a fan).
uniform int u_zoneCount;
uniform vec4 u_zoneA[MAX_ZONES];
uniform vec4 u_zoneB[MAX_ZONES];

out uvec4 o_cell;

Cell load(ivec2 p) {
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, u_size))) {
    return Cell(E_BEDROCK, 0u, 0u, 0u);
  }
  return cellOf(texelFetch(u_state, p, 0));
}

uint byteOf(inout uint rng) {
  rng = pcg(rng);
  return rng & 255u;
}

uint lifeBetween(uint lo, uint hi, inout uint rng) {
  return lo + uint(rand(rng) * float(hi - lo + 1u));
}

// ---- Ageing: lifetimes that run down on their own -------------------------------------------

void age(inout Cell c, inout uint rng, float y) {
  uint id = c.id;
  if (KIND(id) == K_GAS) {
    // Gases wander, leaning with the wind.
    if (rand(rng) < 0.12) {
      bool goRight = rand(rng) < 0.5 + 0.35 * u_wind;
      c.aux = goRight ? (c.aux | AUX_RIGHT) : (c.aux & ~AUX_RIGHT);
    }
  } else if (KIND(id) == K_LIQUID && rand(rng) < 0.01) {
    c.aux ^= AUX_RIGHT;
  }

  if (id == E_FIRE) {
    if (rand(rng) < 0.85) c.life = c.life > 0u ? c.life - 1u : 0u;
    if (c.life == 0u) {
      c = either(rand(rng) < 0.25, makeCell(E_SMOKE, byteOf(rng), lifeBetween(90u, 180u, rng)), makeCell(E_EMPTY, 0u, 0u));
    }
  } else if (id == E_SMOKE) {
    if (rand(rng) < 0.15) c.life = c.life > 0u ? c.life - 1u : 0u;
    if (c.life == 0u) c = makeCell(E_EMPTY, 0u, 0u);
  } else if (id == E_STEAM) {
    if (rand(rng) < 0.12) c.life = c.life > 0u ? c.life - 1u : 0u;
    if (c.life == 0u) {
      c = either(y > u_condenseY && rand(rng) < 0.35, makeCell(E_WATER, byteOf(rng), 0u), makeCell(E_EMPTY, 0u, 0u));
    }
  } else if (id == E_LAVA) {
    if (rand(rng) < 0.04) c.life = c.life > 0u ? c.life - 1u : 0u;
    if (c.life == 0u) c = makeCell(E_GRAVEL, c.shade, 0u);
  } else if (id == E_ICE) {
    // Ice melts by itself in about a minute.
    if (rand(rng) < 0.01) c.life = c.life > 0u ? c.life - 1u : 0u;
    if (c.life == 0u) c = makeCell(E_WATER, c.shade, 0u);
  } else if (id == E_SPARK) {
    c.life = c.life > 2u ? c.life - 2u : 0u;
    if (c.life == 0u) c = makeCell(E_EMPTY, 0u, 0u);
  } else if (id == E_EMBER) {
    if (rand(rng) < 0.05) c.life = c.life > 0u ? c.life - 1u : 0u;
    if (c.life == 0u) c = either(rand(rng) < 0.6, makeCell(E_ASH, byteOf(rng), 0u), makeCell(E_SMOKE, byteOf(rng), 120u));
  }
}

// ---- Chemistry: what one cell does to a neighbour -------------------------------------------

void ignite(inout Cell t, inout uint rng) {
  if (t.id == E_WOOD) {
    t = makeCell(E_EMBER, t.shade, lifeBetween(160u, 255u, rng));
  } else if (t.id == E_PLANT) {
    t = either(rand(rng) < 0.3, makeCell(E_EMBER, t.shade, lifeBetween(40u, 90u, rng)), makeCell(E_FIRE, byteOf(rng), lifeBetween(120u, 200u, rng)));
  } else if (t.id == E_OIL) {
    t = makeCell(E_FIRE, byteOf(rng), lifeBetween(170u, 255u, rng));
  } else {
    t = makeCell(E_FIRE, byteOf(rng), lifeBetween(100u, 170u, rng));
  }
}

// d points from src to dst, y up.
bool isHot(uint id) { return id == E_FIRE || id == E_LAVA || id == E_EMBER || id == E_SPARK; }

void act(inout Cell src, inout Cell dst, ivec2 d, inout uint rng) {
  uint s = src.id;
  uint t = dst.id;
  if (s == E_EMPTY) return;
  // Lighting the target is always the last thing a branch does, so it happens once at the end:
  // one inlined copy of ignite instead of four.
  bool burn = false;

  if (isHot(s)) {
    // Heat pops kernels and melts snow and ice, whatever is doing the heating.
    if (t == E_KERNEL && rand(rng) < 0.4) {
      dst.life = 1u;
      return;
    }
    if ((t == E_SNOW || t == E_ICE) && rand(rng) < 0.3) {
      dst = makeCell(E_WATER, dst.shade, 0u);
      return;
    }
  }

  if (s == E_FIRE) {
    if (FLAMMABLE(t) > 0.0 && rand(rng) < FLAMMABLE(t)) burn = true;
    else if (t == E_WATER && rand(rng) < 0.3) {
      src = makeCell(E_STEAM, byteOf(rng), lifeBetween(60u, 120u, rng));
      if (rand(rng) < 0.15) dst = makeCell(E_STEAM, byteOf(rng), lifeBetween(120u, 200u, rng));
    } else if (t == E_SNOW && rand(rng) < 0.3) dst = makeCell(E_WATER, dst.shade, 0u);
  } else if (s == E_LAVA) {
    if (t == E_WATER && rand(rng) < 0.35) {
      src = makeCell(E_GRAVEL, src.shade, 0u);
      dst = makeCell(E_STEAM, byteOf(rng), lifeBetween(150u, 255u, rng));
    } else if (t == E_SNOW && rand(rng) < 0.5) {
      dst = makeCell(rand(rng) < 0.5 ? E_STEAM : E_WATER, byteOf(rng), 140u);
    } else if (FLAMMABLE(t) > 0.0 && rand(rng) < FLAMMABLE(t) * 0.6) {
      burn = true;
    } else if (t == E_EMPTY && d.y > 0 && rand(rng) < 0.0015) {
      dst = either(rand(rng) < 0.6, makeCell(E_FIRE, byteOf(rng), lifeBetween(40u, 90u, rng)), makeCell(E_SMOKE, byteOf(rng), 100u));
    }
  } else if (s == E_EMBER) {
    if (t == E_EMPTY && d.y >= 0 && rand(rng) < 0.035) {
      dst = makeCell(E_FIRE, byteOf(rng), lifeBetween(60u, 130u, rng));
    } else if (FLAMMABLE(t) > 0.0 && rand(rng) < FLAMMABLE(t) * 0.5) {
      burn = true;
    } else if (t == E_WATER && rand(rng) < 0.2) {
      src = makeCell(E_ASH, src.shade, 0u);
      if (rand(rng) < 0.5) dst = makeCell(E_STEAM, byteOf(rng), lifeBetween(120u, 200u, rng));
    } else if (t == E_SNOW && rand(rng) < 0.3) {
      dst = makeCell(E_WATER, dst.shade, 0u);
    }
  } else if (s == E_ACID) {
    if (DISSOLVES(t) > 0.0 && rand(rng) < DISSOLVES(t)) {
      dst = either(rand(rng) < 0.3, makeCell(E_SMOKE, byteOf(rng), lifeBetween(50u, 110u, rng)), makeCell(E_EMPTY, 0u, 0u));
      src.life = src.life > 50u ? src.life - 50u : 0u;
      if (src.life < 50u) src = makeCell(E_EMPTY, 0u, 0u);
    } else if (t == E_WATER && rand(rng) < 0.002) {
      src = makeCell(E_WATER, src.shade, 0u);
    }
  } else if (s == E_SEED) {
    if (t == E_WATER && rand(rng) < 0.03) {
      float energy = (36.0 + float(src.shade % 48u)) * u_plantScale;
      src = makeCell(E_PLANT, src.shade, uint(clamp(energy, 8.0, 250.0)));
      if (rand(rng) < 0.5) dst = makeCell(E_EMPTY, 0u, 0u);
    }
  } else if (s == E_PLANT) {
    bool open = t == E_EMPTY || t == E_WATER;
    if ((src.aux & AUX_FLOWER) != 0u) {
      // A flower head opens petals into the space around it.
      if (src.life > 0u && t == E_EMPTY && rand(rng) < 0.08) {
        dst = Cell(E_PLANT, src.shade, 0u, AUX_FLOWER);
        src.life -= 1u;
      }
    } else if ((src.aux & AUX_LEAF) != 0u) {
      if (src.life > 0u && t == E_EMPTY && d.x != 0 && d.y >= 0 && rand(rng) < 0.03) {
        dst = Cell(E_PLANT, src.shade, src.life - 1u, AUX_LEAF);
        src.life = 0u;
      }
    } else if (src.life > 0u && open && d.y > 0) {
      // A growing tip: mostly straight up, sometimes leaning, now and then branching.
      if (rand(rng) < (d.x == 0 ? 0.05 : 0.012)) {
        uint e = src.life - 1u;
        bool branch = e > 14u && rand(rng) < 0.05;
        dst = Cell(E_PLANT, src.shade, branch ? e * 2u / 3u : e, 0u);
        if (e == 0u) dst = Cell(E_PLANT, src.shade, 2u + (src.shade & 1u), AUX_FLOWER);
        src.life = branch ? e / 3u : 0u;
        if (!branch && rand(rng) < 0.16) src.aux |= AUX_STYLE;
      }
    } else if ((src.aux & AUX_STYLE) != 0u && t == E_EMPTY && d.y == 0 && rand(rng) < 0.02) {
      // A node puts out a leaf sideways.
      dst = Cell(E_PLANT, src.shade, 1u + (src.shade >> 7u), AUX_LEAF);
      src.aux &= ~AUX_STYLE;
    }
  } else if (s == E_SPARK) {
    if (FLAMMABLE(t) > 0.0 && rand(rng) < FLAMMABLE(t) * 0.3) burn = true;
  } else if (s == E_KERNEL) {
    // A hot kernel pops into the space beside it, sometimes with a spark.
    if (src.life > 0u && t == E_EMPTY && d.y >= 0) {
      dst = makeCell(E_POPCORN, byteOf(rng), 0u);
      src = either(rand(rng) < 0.4, makeCell(E_SPARK, byteOf(rng), lifeBetween(40u, 90u, rng)), makeCell(E_POPCORN, src.shade, 0u));
    }
  } else if (s == E_ICE) {
    if (t == E_WATER && rand(rng) < 0.0008) dst = makeCell(E_ICE, dst.shade, 220u);
  } else if (s == E_SALT) {
    if ((t == E_ICE || t == E_SNOW) && rand(rng) < 0.2) {
      dst = makeCell(E_WATER, dst.shade, 0u);
      if (rand(rng) < 0.25) src = makeCell(E_EMPTY, 0u, 0u);
    } else if (t == E_WATER && rand(rng) < 0.004) {
      src = makeCell(E_EMPTY, 0u, 0u);
    }
  } else if (s == E_SAND) {
    if (u_erosion > 0.0 && t == E_WATER && (dst.aux & AUX_MOVED) != 0u && d.y >= 0 && rand(rng) < u_erosion) {
      src = Cell(E_SILT, src.shade, 0u, src.aux & AUX_RIGHT);
    }
  } else if (s == E_SILT) {
    if (d.y < 0 && !isFluid(dst) && (src.aux & AUX_MOVED) == 0u && rand(rng) < 0.02) {
      src = makeCell(E_SAND, src.shade, 0u);
    }
  }
  if (burn) ignite(dst, rng);
}

// Block cells by a computed index, using only constant indices: indexing the array with a
// variable can move the whole block out of registers into slower memory.
Cell pick(Cell c[4], int i) {
  if (i == 0) return c[0];
  if (i == 1) return c[1];
  if (i == 2) return c[2];
  return c[3];
}

void put(inout Cell c[4], int i, Cell v) {
  if (i == 0) c[0] = v;
  else if (i == 1) c[1] = v;
  else if (i == 2) c[2] = v;
  else c[3] = v;
}

// The six pairs within the block, each in both directions: source, target, and d from source to
// target. Run in a loop because a GLSL compiler inlines every call, and with twelve inlined
// copies of act some drivers took over four seconds to compile this shader.
const ivec4 PAIRS[12] = ivec4[12](
  ivec4(0, 1, 1, 0), ivec4(1, 0, -1, 0),
  ivec4(2, 3, 1, 0), ivec4(3, 2, -1, 0),
  ivec4(0, 2, 0, 1), ivec4(2, 0, 0, -1),
  ivec4(1, 3, 0, 1), ivec4(3, 1, 0, -1),
  ivec4(0, 3, 1, 1), ivec4(3, 0, -1, -1),
  ivec4(1, 2, -1, 1), ivec4(2, 1, 1, -1)
);

// ---- Movement: mirrors blocks.ts ------------------------------------------------------------

bool sinks(Cell a, Cell b) {
  return KIND(a.id) != K_STATIC && isFluid(b) && DENSITY(a.id) > DENSITY(b.id);
}

float speedFactor(Cell c) { return 0.5 + 0.5 * float(c.aux & AUX_SPEED) / 7.0; }

float sinkChance(Cell a, Cell b) {
  float fall = KIND(a.id) == K_EMPTY ? 0.0 : FALL(a.id) * (KIND(b.id) == K_LIQUID ? 0.35 : speedFactor(a));
  float rise = KIND(b.id) == K_GAS ? RISE(b.id) : 0.0;
  return max(fall, rise);
}

bool flowsInto(Cell a, Cell b) {
  return KIND(b.id) == K_EMPTY || (KIND(a.id) == K_LIQUID && KIND(b.id) == K_GAS) ||
    (KIND(b.id) == KIND(a.id) && DENSITY(a.id) > DENSITY(b.id));
}

void setSpeed(inout Cell c, uint s) { c.aux = (c.aux & ~AUX_SPEED) | min(s, 7u); }

bool goesRight(Cell c) { return (c.aux & AUX_RIGHT) != 0u; }

// Block indices: 0 bottom left, 1 bottom right, 2 top left, 3 top right.
void moveBlock(inout Cell c[4], inout bool moved[4], inout uint rng) {

  // 1. Columns.
  for (int col = 0; col < 2; col++) {
    int top = 2 + col;
    int bottom = col;
    if (moved[top] || moved[bottom]) continue;
    Cell t = c[top];
    Cell b = c[bottom];
    if (sinks(t, b)) {
      if (rand(rng) < sinkChance(t, b)) {
        if (isMover(t)) setSpeed(t, (t.aux & AUX_SPEED) + 1u);
        setSpeed(b, 0u);
        c[top] = b;
        c[bottom] = t;
        moved[top] = true;
        moved[bottom] = true;
      }
    } else if (isMover(t)) {
      setSpeed(c[top], 0u);
    }
  }

  // 2. Diagonals.
  bool fromTL = !moved[2] && !moved[1] && isMover(c[2]) && !sinks(c[2], c[0]) && sinks(c[2], c[1]) && isFluid(c[3]);
  bool fromTR = !moved[3] && !moved[0] && isMover(c[3]) && !sinks(c[3], c[1]) && sinks(c[3], c[0]) && isFluid(c[2]);
  if (fromTL || fromTR) {
    bool useTL = fromTL && (!fromTR || rand(rng) < 0.5);
    int top = useTL ? 2 : 3;
    int target = useTL ? 1 : 0;
    Cell a = c[top];
    float chance = SLIDE(a.id) * (KIND(c[target].id) == K_LIQUID ? 0.5 : 1.0);
    if (rand(rng) < chance) {
      c[top] = c[target];
      c[target] = a;
      moved[top] = true;
      moved[target] = true;
    }
  }

  // 3. Rows.
  for (int row = 0; row < 2; row++) {
    int l = row * 2;
    int r = l + 1;
    if (moved[l] || moved[r]) continue;
    Cell a = c[l];
    Cell b = c[r];
    bool aGo = flows(a) && goesRight(a) && flowsInto(a, b);
    bool bGo = flows(b) && !goesRight(b) && flowsInto(b, a);
    if (aGo && (!bGo || rand(rng) < 0.5)) {
      if (rand(rng) < SPREAD(a.id)) {
        c[l] = b;
        c[r] = a;
        moved[l] = true;
        moved[r] = true;
      }
    } else if (bGo) {
      if (rand(rng) < SPREAD(b.id)) {
        c[l] = b;
        c[r] = a;
        moved[l] = true;
        moved[r] = true;
      }
    } else {
      if (flows(a) && goesRight(a)) c[l].aux ^= AUX_RIGHT;
      if (flows(b) && !goesRight(b)) c[r].aux ^= AUX_RIGHT;
    }
  }

  for (int i = 0; i < 4; i++) {
    c[i].aux = moved[i] ? (c[i].aux | AUX_MOVED) : (c[i].aux & ~AUX_MOVED);
  }
}

// Elements that act on their neighbours (see act). Everything else only moves and ages.
bool reactive(Cell c) {
  uint id = c.id;
  return id == E_FIRE || id == E_LAVA || id == E_EMBER || id == E_ACID || id == E_SEED ||
    id == E_PLANT || id == E_SILT || id == E_SPARK || id == E_KERNEL || id == E_ICE ||
    id == E_SALT || (id == E_SAND && u_erosion > 0.0);
}

bool isMovable(Cell c) { return KIND(c.id) == K_POWDER || KIND(c.id) == K_LIQUID || KIND(c.id) == K_GAS; }

// Can a lifted or pushed cell take the place of b? Open space, gas, or (for grains) liquid.
bool yields(Cell a, Cell b) {
  uint kb = KIND(b.id);
  return kb == K_EMPTY || (kb == K_GAS && a.id != b.id) || (kb == K_LIQUID && KIND(a.id) == K_POWDER);
}

// Geyser: everything in the column rises, a cell per pass. Mirrors liftBlock in blocks.ts.
void liftBlock(inout Cell c[4], inout bool moved[4], float strength, inout uint rng) {
  for (int col = 0; col < 2; col++) {
    int top = 2 + col;
    int bottom = col;
    if (isMovable(c[bottom]) && yields(c[bottom], c[top]) && rand(rng) < strength) {
      Cell t = c[top];
      c[top] = c[bottom];
      c[bottom] = t;
      moved[top] = true;
      moved[bottom] = true;
    }
  }
}

// Fan: everything is blown one cell downwind. Mirrors pushBlock in blocks.ts.
void pushBlock(inout Cell c[4], inout bool moved[4], bool right, float strength, inout uint rng) {
  for (int row = 0; row < 2; row++) {
    int from = row * 2 + (right ? 0 : 1);
    int to = row * 2 + (right ? 1 : 0);
    if (moved[from] || moved[to]) continue;
    if (isMovable(c[from]) && yields(c[from], c[to]) && rand(rng) < strength) {
      Cell t = c[to];
      c[to] = c[from];
      c[from] = t;
      moved[from] = true;
      moved[to] = true;
    }
  }
}

// A block that can't change still drops its stale motion flags.
uvec4 settled(Cell c) {
  if (isMover(c)) c.aux &= ~(AUX_MOVED | AUX_SPEED);
  return packCell(c);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 b = ((p - u_offset) >> 1) * 2 + u_offset;
  ivec2 local = p - b;
  int me = local.y * 2 + local.x;

  Cell c[4];
  c[0] = load(b);
  c[1] = load(b + ivec2(1, 0));
  c[2] = load(b + ivec2(0, 1));
  c[3] = load(b + ivec2(1, 1));

  // Most of the world is sky: an empty block stays empty.
  if (c[0].id == E_EMPTY && c[1].id == E_EMPTY && c[2].id == E_EMPTY && c[3].id == E_EMPTY) {
    o_cell = uvec4(0u);
    return;
  }

  // Inside piles, pieces and pools nothing can happen: no open space to move into, nothing that
  // reacts, and (for a block of one liquid) nothing that would look different after a swap.
  bool reacting = reactive(c[0]) || reactive(c[1]) || reactive(c[2]) || reactive(c[3]);
  if (!reacting) {
    uint k0 = KIND(c[0].id);
    uint k1 = KIND(c[1].id);
    uint k2 = KIND(c[2].id);
    uint k3 = KIND(c[3].id);
    bool anyFluid = k0 <= K_LIQUID || k1 <= K_LIQUID || k2 <= K_LIQUID || k3 <= K_LIQUID;
    bool sameLiquid = c[0].id == c[1].id && c[1].id == c[2].id && c[2].id == c[3].id && k0 != K_GAS;
    if (!anyFluid || sameLiquid) {
      o_cell = settled(c[me]);
      return;
    }
  }

  uint rng = hash2(b, u_seed);
  float y0 = float(b.y);
  for (int i = 0; i < 4; i++) {
    Cell a = pick(c, i);
    age(a, rng, y0 + float(i >> 1));
    put(c, i, a);
  }

  if (reacting) {
    for (int k = 0; k < 12; k++) {
      ivec4 q = PAIRS[k];
      Cell s = pick(c, q.x);
      Cell t = pick(c, q.y);
      act(s, t, q.zw, rng);
      put(c, q.x, s);
      put(c, q.y, t);
    }
  }

  bool moved[4] = bool[4](false, false, false, false);
  vec2 centre = vec2(b) + 1.0;
  for (int i = 0; i < MAX_ZONES; i++) {
    if (i >= u_zoneCount) break;
    vec4 z = u_zoneA[i];
    if (centre.x < z.x || centre.x > z.z || centre.y < z.y || centre.y > z.w) continue;
    vec4 k = u_zoneB[i];
    if (k.x < 1.5) liftBlock(c, moved, k.y, rng);
    else pushBlock(c, moved, k.x < 2.5, k.y, rng);
    break;
  }
  moveBlock(c, moved, rng);
  o_cell = packCell(c[me]);
}
`;
