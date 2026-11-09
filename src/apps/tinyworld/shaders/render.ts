import { HEADER, PIECE_SDF } from "./common";

/**
 * Colours each cell once at grid resolution (two targets: premultiplied colour, and the light
 * it gives off for the glow passes). Shading uses only the cell and the column above it: a lit
 * top surface, darker depths, and a little motion in water, fire and lava.
 */
export const SHADE_FS = `${HEADER}
uniform usampler2D u_state;
uniform ivec2 u_size;
uniform float u_time;

layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_glow;

Cell look(ivec2 p) {
  if (p.y >= u_size.y || p.x < 0 || p.x >= u_size.x) return Cell(E_EMPTY, 0u, 0u, 0u);
  if (p.y < 0) return Cell(E_BEDROCK, 0u, 0u, 0u);
  return cellOf(texelFetch(u_state, p, 0));
}

// Most cells sit near the base colour, a few towards the dark or light end.
vec3 tone(uint id, float s) {
  float t = s * 2.0 - 1.0;
  t = sign(t) * t * t;
  return t < 0.0 ? mix(COLOR_BASE(id), COLOR_DARK(id), -t) : mix(COLOR_BASE(id), COLOR_LIGHT(id), t);
}

vec3 ramp3(vec3 a, vec3 b, vec3 c, float t) {
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
}

const vec3 FLOWERS[4] = vec3[4](
  vec3(0.85, 0.55, 0.63),
  vec3(0.89, 0.77, 0.40),
  vec3(0.65, 0.56, 0.82),
  vec3(0.91, 0.65, 0.50)
);

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  Cell c = look(p);
  if (c.id == E_EMPTY || c.id == E_CABINET) {
    o_color = vec4(0.0);
    o_glow = vec4(0.0);
    return;
  }
  uint id = c.id;
  float s = float(c.shade) / 255.0;
  float life = float(c.life) / 255.0;
  vec3 col = tone(id, s);
  float alpha = ALPHA(id);
  float glow = GLOW(id);
  Cell up = look(p + ivec2(0, 1));
  bool open = KIND(up.id) <= K_GAS;
  vec2 fp = vec2(p);

  if (id == E_WATER || id == E_SILT || id == E_ACID || id == E_OIL) {
    col = tone(id, 0.5 + (s - 0.5) * 0.45);
    float deep = 0.0;
    for (int k = 1; k <= 5; k++) {
      Cell a = look(p + ivec2(0, 1 << k));
      if (KIND(a.id) == K_LIQUID) deep += 1.0;
    }
    col = mix(col, COLOR_DARK(id) * 0.75, deep * 0.1);
    col *= 0.96 + 0.06 * sin(u_time * 1.7 + fp.x * 0.17 + fp.y * 0.11 + s * 3.0);
    if (open) col = mix(col, COLOR_LIGHT(id), id == E_OIL ? 0.25 : 0.45);
    if (id == E_ACID) col *= 0.95 + 0.1 * sin(u_time * 3.0 + fp.x * 0.4 + s * 9.0);
  } else if (id == E_LAVA) {
    float n = vnoise(fp * 0.09 + vec2(0.0, u_time * 0.6));
    float heat = clamp(life * (0.6 + 0.6 * n), 0.0, 1.0);
    col = mix(vec3(0.16, 0.06, 0.04), COLOR_DARK(id), smoothstep(0.0, 0.3, heat));
    col = mix(col, COLOR_BASE(id), smoothstep(0.25, 0.6, heat));
    col = mix(col, COLOR_LIGHT(id), smoothstep(0.6, 0.95, heat));
    glow *= 0.25 + heat;
  } else if (id == E_FIRE) {
    float flick = hashf(fp + floor(u_time * 24.0) * 7.0) - 0.5;
    float t = clamp(life * 1.15 + flick * 0.18, 0.0, 1.0);
    col = ramp3(COLOR_DARK(id), COLOR_BASE(id), COLOR_LIGHT(id), t);
    alpha = clamp(t * 1.8, 0.25, 0.95);
    glow *= 0.3 + t;
  } else if (id == E_EMBER) {
    float flick = 0.6 + 0.4 * sin(u_time * 5.0 + s * 20.0);
    col = mix(COLOR_DARK(id), COLOR_LIGHT(id), flick * (0.35 + 0.65 * life));
    glow *= flick;
  } else if (id == E_SMOKE || id == E_STEAM) {
    alpha *= clamp(life * (id == E_SMOKE ? 2.6 : 2.2), 0.0, 1.0);
  } else if (id == E_PLANT) {
    if ((c.aux & AUX_FLOWER) != 0u) {
      col = FLOWERS[(c.shade >> 1u) & 3u] * (c.life > 0u ? 0.85 : 1.0);
    } else if ((c.aux & AUX_LEAF) != 0u) {
      col = mix(col, vec3(0.47, 0.64, 0.34), 0.55);
    } else if (c.life > 0u) {
      col = mix(col, vec3(0.55, 0.70, 0.38), 0.4);
    }
  } else if (id == E_GLASS) {
    float edge = 1.0 - smoothstep(0.0, 0.3, s);
    float sheen = smoothstep(0.92, 1.0, sin((fp.x + fp.y) * 0.08));
    col = mix(COLOR_BASE(id), COLOR_LIGHT(id), max(edge, sheen * 0.6));
    alpha = 0.26 + 0.6 * max(edge, sheen * 0.4);
  } else if (id == E_METAL) {
    if (open) col = mix(col, COLOR_LIGHT(id) * 1.08, 0.6);
  } else if (id == E_BEDROCK) {
    if ((c.aux & AUX_STYLE) != 0u) col = mix(col, vec3(0.22, 0.13, 0.11), 0.6);
    if (open) col = mix(col, col * 1.6 + 0.04, 0.6);
  } else if (id == E_DEBRIS) {
    uint m = E_STONE + (c.shade >> 6u);
    col = mix(COLOR_DARK(m), COLOR_BASE(m), float(c.shade & 63u) / 63.0) * 0.85;
  } else if (id == E_SNOW || id == E_SALT) {
    if (hashf(fp + floor(u_time * 1.5) * 13.0) > 0.994) col += 0.12;
  } else if (id == E_ICE) {
    if (open) col = mix(col, COLOR_LIGHT(id), 0.3);
    if (hashf(fp + floor(u_time * 0.8) * 5.0) > 0.992) col += 0.15;
  } else if (id == E_KERNEL) {
    // A heated kernel glows just before it pops.
    if (c.life > 0u) {
      col = mix(col, vec3(1.0, 0.62, 0.28), 0.55);
      glow = 0.6;
    }
  } else if (id == E_SPARK) {
    col = mix(COLOR_BASE(id), COLOR_LIGHT(id), life);
    glow *= 0.4 + life;
  }

  // Piles read as solid shapes: a lit top surface and darker depths.
  if (KIND(id) == K_POWDER) {
    float buried = 0.0;
    for (int k = 1; k <= 5; k++) {
      Cell a = look(p + ivec2(0, 1 << k));
      if (KIND(a.id) >= K_LIQUID) buried += 1.0;
    }
    col *= 1.0 - buried * 0.055;
    if (open) col *= 1.12;
  } else if (KIND(id) == K_STATIC && open && id != E_BEDROCK && id != E_METAL) {
    col *= 1.1;
  }

  o_color = vec4(col * alpha, alpha);
  o_glow = vec4(col * glow, 1.0);
}
`;

/** Box filter to a quarter of the size: four bilinear taps cover a 4 x 4 block. */
export const DOWN_FS = `${HEADER}
uniform sampler2D u_src;
uniform vec2 u_texel;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec2 d = u_texel;
  o_color = 0.25 * (texture(u_src, v_uv + vec2(-d.x, -d.y)) + texture(u_src, v_uv + vec2(d.x, -d.y)) +
    texture(u_src, v_uv + vec2(-d.x, d.y)) + texture(u_src, v_uv + vec2(d.x, d.y)));
}
`;

/** Nine-tap Gaussian in one direction, using five bilinear taps. */
export const BLUR_FS = `${HEADER}
uniform sampler2D u_src;
uniform vec2 u_step;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec4 sum = texture(u_src, v_uv) * 0.2270270270;
  sum += (texture(u_src, v_uv + u_step * 1.3846153846) + texture(u_src, v_uv - u_step * 1.3846153846)) * 0.3162162162;
  sum += (texture(u_src, v_uv + u_step * 3.2307692308) + texture(u_src, v_uv - u_step * 3.2307692308)) * 0.0702702703;
  o_color = sum;
}
`;

/** Soft clouds at low resolution, premultiplied. Darker underneath, darker still when raining. */
export const SKY_FS = `${HEADER}
uniform vec2 u_worldCells;
uniform float u_time;
uniform int u_cloudCount;
// (cx, cy, rx, ry) in cells, and (darkness, opacity, seed, -).
uniform vec4 u_cloud[MAX_CLOUDS];
uniform vec4 u_cloudLook[MAX_CLOUDS];
in vec2 v_uv;
out vec4 o_sky;

void main() {
  vec2 p = v_uv * u_worldCells;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < MAX_CLOUDS; i++) {
    if (i >= u_cloudCount) break;
    vec4 k = u_cloud[i];
    vec4 look = u_cloudLook[i];
    vec2 q = (p - k.xy) / k.zw;
    if (abs(q.x) > 1.5 || abs(q.y) > 1.7) continue;
    float n = fbm(p / (k.w * 0.6) + vec2(look.z, u_time * 0.012));
    float body = 1.0 - smoothstep(0.3, 1.0, length(q * vec2(1.0, 1.35)) + (n - 0.5) * 0.95);
    body *= smoothstep(-0.95, -0.5, q.y + (n - 0.5) * 0.35);
    float d = clamp(body, 0.0, 1.0) * look.y;
    float light = smoothstep(-0.7, 0.9, q.y + (n - 0.5) * 0.7);
    vec3 col = mix(vec3(0.19, 0.22, 0.29), vec3(0.47, 0.52, 0.61), light);
    col = mix(col, col * 0.6, look.x);
    acc.rgb += col * d * (1.0 - acc.a);
    acc.a += d * (1.0 - acc.a);
  }
  o_sky = acc;
}
`;

/**
 * The final image at screen resolution: sky gradient and stars, clouds, the world with crisp
 * cell edges at any scale, glow, finger rings and piece previews, then dithering.
 */
export const COMPOSITE_FS = `${HEADER}
${PIECE_SDF}
uniform sampler2D u_color;
uniform sampler2D u_glowA;
uniform sampler2D u_glowB;
uniform sampler2D u_sky;
uniform vec2 u_gridSize;
uniform vec2 u_worldCells;
uniform vec2 u_worldVenue;
uniform float u_cell;
// Screen pixels per cell, for the crisp-edge filter.
uniform float u_ppc;
uniform float u_time;
// The world shows below this height (0 to 1.2): the land rising back after a drain.
uniform float u_reveal;
uniform int u_cursorCount;
// (x, y, radius, strength) in venue px with y down, and an RGB colour.
uniform vec4 u_cursor[MAX_CURSORS];
uniform vec4 u_cursorColor[MAX_CURSORS];
uniform int u_ghostCount;
// (cx, cy, hx, hy) in cells, and (shape, mirror, material, -).
uniform vec4 u_ghostA[MAX_GHOSTS];
uniform vec4 u_ghostB[MAX_GHOSTS];
// Gadget effects in venue px: zones (x, y, width, height) with (kind 1 lift, 2 right, 3 left, -,
// -, -), and heat glows (x, y, radius, sign).
uniform int u_fxCount;
uniform vec4 u_fxA[MAX_ZONES];
uniform vec4 u_fxB[MAX_ZONES];
uniform int u_glowCount;
uniform vec4 u_glowFx[MAX_HEATS];
in vec2 v_uv;
out vec4 o_frag;

// Bilinear filtering squeezed into a one-pixel band, so cells keep sharp edges without
// shimmering when the stage is scaled by a non-integer amount.
vec4 crisp(sampler2D tex, vec2 cell) {
  vec2 t = cell - 0.5;
  vec2 base = floor(t);
  vec2 f = clamp((t - base - 0.5) * max(u_ppc, 1.0) + 0.5, 0.0, 1.0);
  return texture(tex, (base + f + 0.5) / u_gridSize);
}

vec3 background(float y, vec2 venue) {
  vec3 low = vec3(0.07, 0.085, 0.12);
  vec3 haze = vec3(0.105, 0.125, 0.175);
  vec3 mid = vec3(0.07, 0.1, 0.16);
  vec3 top = vec3(0.025, 0.04, 0.08);
  vec3 col = mix(low, haze, smoothstep(0.0, 0.18, y));
  col = mix(col, mid, smoothstep(0.18, 0.5, y));
  col = mix(col, top, smoothstep(0.5, 1.0, y));
  // Faint stars high up: a soft point in some cells of a 24 venue px lattice.
  vec2 lattice = venue / 24.0;
  float h = hashf(floor(lattice));
  if (h > 0.985) {
    vec2 offset = vec2(hashf(floor(lattice) + 3.1), hashf(floor(lattice) + 7.7)) * 0.6 + 0.2;
    float d = length(fract(lattice) - offset) * 24.0;
    float tw = 0.55 + 0.45 * sin(u_time * (0.5 + h * 2.0) + h * 90.0);
    col += vec3(0.5, 0.52, 0.6) * (1.0 - smoothstep(0.6, 2.2, d)) * tw * smoothstep(0.45, 0.9, y);
  }
  return col;
}

void main() {
  vec2 cell = v_uv * u_worldCells;
  vec2 venue = vec2(v_uv.x, 1.0 - v_uv.y) * u_worldVenue;
  vec3 col = background(v_uv.y, venue);

  vec4 sky = texture(u_sky, v_uv);
  col = col * (1.0 - sky.a) + sky.rgb;

  float shown = 1.0 - smoothstep(u_reveal - 0.12, u_reveal, v_uv.y);
  vec4 w = crisp(u_color, cell) * shown;
  col = col * (1.0 - w.a) + w.rgb;

  vec2 g = cell / u_gridSize;
  col += (texture(u_glowA, g).rgb * 0.85 + texture(u_glowB, g).rgb * 1.2) * shown;

  // Faint streaks show where geysers lift and fans blow.
  for (int i = 0; i < MAX_ZONES; i++) {
    if (i >= u_fxCount) break;
    vec4 z = u_fxA[i];
    vec2 q = (venue - z.xy) / z.zw;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
    float kind = u_fxB[i].x;
    float edge = smoothstep(0.0, 0.15, min(q.x, 1.0 - q.x)) * smoothstep(0.0, 0.12, min(q.y, 1.0 - q.y));
    float streak;
    if (kind < 1.5) {
      float lane = floor(venue.x / 16.0);
      float s = fract((venue.y + u_time * 520.0) / 140.0 + hashf(vec2(lane, 3.0)));
      streak = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.08, 0.4, s)) * step(0.45, hashf(vec2(lane, 9.0)));
      col += vec3(0.55, 0.8, 1.0) * 0.07 * streak * edge;
    } else {
      float lane = floor(venue.y / 14.0);
      float dir = kind < 2.5 ? -1.0 : 1.0;
      float s = fract((venue.x + dir * u_time * 420.0) / 160.0 + hashf(vec2(lane, 5.0)));
      streak = smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.1, 0.45, s)) * step(0.5, hashf(vec2(lane, 11.0)));
      col += vec3(0.85, 0.9, 1.0) * 0.06 * streak * edge;
    }
  }
  for (int i = 0; i < MAX_HEATS; i++) {
    if (i >= u_glowCount) break;
    vec4 h = u_glowFx[i];
    float d = length(venue - h.xy) / h.z;
    if (d > 1.0) continue;
    float a = (1.0 - d) * (1.0 - d) * (0.8 + 0.2 * sin(u_time * 3.0 + h.x));
    col += (h.w > 0.0 ? vec3(1.0, 0.5, 0.2) : vec3(0.35, 0.65, 1.0)) * 0.14 * a;
  }

  for (int i = 0; i < MAX_GHOSTS; i++) {
    if (i >= u_ghostCount) break;
    vec4 a = u_ghostA[i];
    vec4 b = u_ghostB[i];
    vec2 q = cell - a.xy;
    if (abs(q.x) > a.z + 4.0 || abs(q.y) > a.w + 4.0) continue;
    float sdf = pieceSdf(int(b.x), q, a.zw, b.y > 0.5);
    vec3 tint = COLOR_LIGHT(uint(b.z));
    float pulse = 0.75 + 0.25 * sin(u_time * 5.0);
    float fill = (1.0 - smoothstep(-0.5, 0.5, sdf)) * 0.3;
    float edge = 1.0 - smoothstep(0.4, 1.6, abs(sdf));
    col = mix(col, tint, clamp(fill + edge * 0.8 * pulse, 0.0, 1.0));
  }

  for (int i = 0; i < MAX_CURSORS; i++) {
    if (i >= u_cursorCount) break;
    vec4 k = u_cursor[i];
    float d = length(venue - k.xy);
    if (d > k.z * 1.6) continue;
    float width = max(4.0, k.z * 0.1);
    float ring = 1.0 - smoothstep(width * 0.4, width, abs(d - k.z));
    float halo = (1.0 - smoothstep(0.0, k.z * 1.5, d)) * 0.18;
    vec3 tint = u_cursorColor[i].rgb;
    col = mix(col, tint, clamp(ring * 0.75, 0.0, 1.0) * k.w);
    col += tint * halo * k.w;
  }

  col += (hashf(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;
  o_frag = vec4(col, 1.0);
}
`;
