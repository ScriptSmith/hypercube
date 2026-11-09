/**
 * GLSL for the flow. The step shader follows `step()` in `lattice.ts` operation for operation,
 * so the CPU reference checks it (see e2e/airflow.spec.ts). Populations live in three RGBA32F
 * textures: (g0, g1, g2, g3), (g4, g5, g6, g7) and (g8, force x, force y, shape id).
 */
import {
  SOLID,
  LIMIT_FROM,
  LIMIT_SPAN,
  LIMIT_TAU,
  MAX_SHAPES,
  MAX_SPEED,
  MAX_WALL_SPEED,
  RHO_MAX,
  RHO_MIN,
} from "../lattice";

const f = (v: number) => {
  const s = String(v);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Fullscreen triangle for every pass but the mask. */
export const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
}`;

const LATTICE = `
const int CXS[9] = int[9](0, 1, 0, -1, 0, 1, -1, -1, 1);
const int CYS[9] = int[9](0, 0, 1, 0, -1, 1, 1, -1, -1);
const float WS[9] = float[9](4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
const int OPPS[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);
const int MIRS[9] = int[9](0, 1, 4, 3, 2, 8, 7, 6, 5);

float feq(int i, float rho, vec2 u) {
  float cu = float(CXS[i]) * u.x + float(CYS[i]) * u.y;
  return WS[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}
`;

/** Mask texels: r is the solid id / 255, g and b the wall velocity around 128. */
const MASK = `
uniform sampler2D u_mask;
int solidId(ivec2 p) { return int(texelFetch(u_mask, p, 0).r * 255.0 + 0.5); }
vec2 wallVel(ivec2 p) {
  vec2 b = floor(texelFetch(u_mask, p, 0).gb * 255.0 + 0.5);
  return (b - 128.0) / 127.0 * ${f(MAX_WALL_SPEED)};
}
`;

export const STEP_FS = `${HEADER}
uniform sampler2D u_f0;
uniform sampler2D u_f1;
uniform sampler2D u_f2;
/** Per row: (inlet u, inlet v, base tau, -) in row 0 and the inlet's smoke in row 1. */
uniform sampler2D u_inlet;
uniform ivec2 u_size;
uniform float u_c2;
uniform float u_spongeFrom;
uniform float u_spongeTau;
uniform float u_ema;
uniform float u_bulk;
uniform bool u_soft;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
${LATTICE}
${MASK}
float popAt(ivec2 p, int i) {
  if (i < 4) return texelFetch(u_f0, p, 0)[i];
  if (i < 8) return texelFetch(u_f1, p, 0)[i - 4];
  return texelFetch(u_f2, p, 0).x;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float g[9];
  if (solidId(p) != 0) {
    // A solid cell holds the air it would release if uncovered: at its wall's velocity and
    // its fluid neighbours' density.
    vec2 uw = wallVel(p);
    float sum = 0.0;
    float count = 0.0;
    for (int i = 1; i <= 4; i++) {
      ivec2 q = p + ivec2(CXS[i], CYS[i]);
      if (q.x < 0 || q.y < 0 || q.x >= u_size.x || q.y >= u_size.y) continue;
      if (solidId(q) != 0) continue;
      vec4 a = texelFetch(u_f0, q, 0);
      vec4 b = texelFetch(u_f1, q, 0);
      float c = texelFetch(u_f2, q, 0).x;
      sum += 1.0 + a.x + a.y + a.z + a.w + b.x + b.y + b.z + b.w + c;
      count += 1.0;
    }
    float rw = count > 0.0 ? clamp(sum / count, ${f(RHO_MIN)}, ${f(RHO_MAX)}) : 1.0;
    for (int i = 0; i < 9; i++) g[i] = feq(i, rw, uw) - WS[i];
    o0 = vec4(g[0], g[1], g[2], g[3]);
    o1 = vec4(g[4], g[5], g[6], g[7]);
    o2 = vec4(g[8], 0.0, 0.0, 0.0);
    return;
  }
  vec4 s0 = texelFetch(u_f0, p, 0);
  vec4 s1 = texelFetch(u_f1, p, 0);
  vec4 s2 = texelFetch(u_f2, p, 0);
  float own[9] = float[9](s0.x, s0.y, s0.z, s0.w, s1.x, s1.y, s1.z, s1.w, s2.x);
  float fs[9];
  vec2 force = vec2(0.0);
  int touched = 0;
  for (int i = 0; i < 9; i++) {
    ivec2 s = p - ivec2(CXS[i], CYS[i]);
    int j = i;
    // Side walls and wall cells (which run along the stream) are free-slip: the population
    // comes from beside this cell, reflected.
    if (s.y < 0 || s.y >= u_size.y ||
        solidId(ivec2(clamp(s.x, 0, u_size.x - 1), s.y)) == ${SOLID.wall}) {
      s.y = p.y;
      j = MIRS[i];
    }
    if (s.x < 0 || s.x >= u_size.x) {
      fs[i] = 0.0;
      continue;
    }
    int sid = solidId(s);
    if (sid != 0) {
      int o = OPPS[i];
      float back = own[o] + WS[o];
      vec2 c = vec2(float(CXS[i]), float(CYS[i]));
      float fi = back + 6.0 * WS[i] * dot(c, wallVel(s));
      fs[i] = fi;
      force -= c * (back + fi);
      if (sid <= ${MAX_SHAPES}) touched = sid;
    } else {
      fs[i] = popAt(s, j) + WS[j];
    }
  }
  vec4 row = texelFetch(u_inlet, ivec2(p.y, 0), 0);
  if (p.x == 0) {
    // Zou and He: the three populations entering from the inlet, from the velocity there
    // (softened so sound arriving from downstream leaves; see inletState in lattice.ts).
    float known = fs[0] + fs[2] + fs[4] + 2.0 * (fs[3] + fs[6] + fs[7]);
    float ux = row.x;
    float rho = known / (1.0 - ux);
    if (u_soft) {
      float cs = sqrt(1.0 / 3.0);
      float b = 1.0 - row.x - cs;
      rho = (-b + sqrt(b * b + 4.0 * cs * known)) / (2.0 * cs);
      ux = row.x - cs * (rho - 1.0);
    }
    float half_ = 0.5 * (fs[2] - fs[4]);
    fs[1] = fs[3] + (2.0 / 3.0) * rho * ux;
    fs[5] = fs[7] - half_ + (1.0 / 6.0) * rho * ux + 0.5 * rho * row.y;
    fs[8] = fs[6] + half_ + (1.0 / 6.0) * rho * ux - 0.5 * rho * row.y;
  } else if (p.x == u_size.x - 1) {
    // Zou and He at the outlet, holding the density at 1 and the air leaving straight out.
    float ux = -1.0 + fs[0] + fs[2] + fs[4] + 2.0 * (fs[1] + fs[5] + fs[8]);
    float half_ = 0.5 * (fs[2] - fs[4]);
    fs[3] = fs[1] - (2.0 / 3.0) * ux;
    fs[6] = fs[8] - half_ - (1.0 / 6.0) * ux;
    fs[7] = fs[5] + half_ - (1.0 / 6.0) * ux;
  }
  float rho = 0.0;
  vec2 m = vec2(0.0);
  for (int i = 0; i < 9; i++) {
    rho += fs[i];
    m += vec2(float(CXS[i]), float(CYS[i])) * fs[i];
  }
  // NaN fails both comparisons, so a broken cell restarts at rest.
  if (!(rho > ${f(RHO_MIN)} && rho < ${f(RHO_MAX)})) {
    o0 = vec4(0.0);
    o1 = vec4(0.0);
    o2 = vec4(0.0);
    return;
  }
  vec2 u = m / rho;
  float speed = sqrt(dot(u, u));
  if (speed > ${f(MAX_SPEED)}) u *= ${f(MAX_SPEED)} / speed;
  float eq[9];
  float pxx = 0.0;
  float pyy = 0.0;
  float pxy = 0.0;
  for (int i = 0; i < 9; i++) {
    eq[i] = feq(i, rho, u);
    float d = fs[i] - eq[i];
    float cx = float(CXS[i]);
    float cy = float(CYS[i]);
    pxx += cx * cx * d;
    pyy += cy * cy * d;
    pxy += cx * cy * d;
  }
  float tau0 = row.z;
  float x = float(p.x);
  if (x >= u_spongeFrom && u_spongeFrom < float(u_size.x - 1)) {
    float sp = min(1.0, (x - u_spongeFrom) / (float(u_size.x - 1) - u_spongeFrom));
    tau0 = tau0 + (u_spongeTau - tau0) * sp * sp;
  }
  float lim = clamp((speed - ${f(LIMIT_FROM)}) / ${f(LIMIT_SPAN)}, 0.0, 1.0);
  tau0 += ${f(LIMIT_TAU)} * lim * lim;
  // The stress splits into its trace (compression: sound) and the rest (shear).
  float tr = 0.5 * (pxx + pyy);
  float dxx = pxx - tr;
  float tau = tau0;
  if (u_c2 > 0.0) {
    float pi = sqrt(2.0 * dxx * dxx + 2.0 * pxy * pxy);
    tau = 0.5 * (tau0 + sqrt(tau0 * tau0 + 18.0 * sqrt(2.0) * u_c2 * pi / rho));
  }
  float ks = 1.0 - 1.0 / tau;
  float kb = u_bulk > 0.0 ? 1.0 - 1.0 / u_bulk : ks;
  float qxx = ks * dxx + kb * tr;
  float qyy = -ks * dxx + kb * tr;
  float qxy = ks * pxy;
  for (int i = 0; i < 9; i++) {
    float cx = float(CXS[i]);
    float cy = float(CYS[i]);
    float q = (cx * cx - 1.0 / 3.0) * qxx + (cy * cy - 1.0 / 3.0) * qyy + 2.0 * cx * cy * qxy;
    g[i] = eq[i] + 4.5 * WS[i] * q - WS[i];
  }
  o0 = vec4(g[0], g[1], g[2], g[3]);
  o1 = vec4(g[4], g[5], g[6], g[7]);
  o2 = vec4(g[8], s2.y * (1.0 - u_ema) + force.x * u_ema, s2.z * (1.0 - u_ema) + force.y * u_ema,
    float(touched));
}`;

/** Equilibrium everywhere: fluid moving with its row's inlet velocity, solids with their wall. */
export const INIT_FS = `${HEADER}
uniform sampler2D u_inlet;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
${LATTICE}
${MASK}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 u = solidId(p) != 0 ? wallVel(p) : texelFetch(u_inlet, ivec2(p.y, 0), 0).xy;
  float g[9];
  for (int i = 0; i < 9; i++) g[i] = feq(i, 1.0, u) - WS[i];
  o0 = vec4(g[0], g[1], g[2], g[3]);
  o1 = vec4(g[4], g[5], g[6], g[7]);
  o2 = vec4(g[8], 0.0, 0.0, 0.0);
}`;

/** Velocity, density - 1 and a solid flag per cell, for smoke, drawing and plumes. */
export const MACRO_FS = `${HEADER}
uniform sampler2D u_f0;
uniform sampler2D u_f1;
uniform sampler2D u_f2;
out vec4 o;
${MASK}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(u_f0, p, 0);
  vec4 b = texelFetch(u_f1, p, 0);
  float c = texelFetch(u_f2, p, 0).x;
  float rho = 1.0 + a.x + a.y + a.z + a.w + b.x + b.y + b.z + b.w + c;
  vec2 m = vec2(a.y - a.w + b.y - b.z - b.w + c, a.z - b.x + b.y + b.z - b.w - c);
  o = vec4(m / rho, rho - 1.0, solidId(p) != 0 ? 1.0 : 0.0);
}`;

/** Solid cells drawn as triangles: position in grid cells, wall velocity, id. */
export const MASK_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_vel;
in float a_id;
uniform vec2 u_size;
out vec2 v_vel;
flat out float v_id;
void main() {
  v_vel = a_vel;
  v_id = a_id;
  gl_Position = vec4(a_pos / u_size * 2.0 - 1.0, 0.0, 1.0);
}`;

export const MASK_FS = `#version 300 es
precision highp float;
in vec2 v_vel;
flat in float v_id;
out vec4 o;
void main() {
  vec2 v = v_vel / ${f(MAX_WALL_SPEED)};
  float len = length(v);
  if (len > 1.0) v /= len;
  o = vec4(v_id / 255.0, (128.0 + v * 127.0) / 255.0, 1.0);
}`;

/**
 * Semi-Lagrangian smoke advection: the value at each texel is read from where the flow brought
 * it from, `u_shift` lattice steps back (negative for MacCormack's backward pass).
 */
export const ADVECT_FS = `${HEADER}
uniform sampler2D u_src;
uniform sampler2D u_vel;
uniform vec2 u_size;
uniform float u_shift;
out vec4 o;
void main() {
  vec2 x = gl_FragCoord.xy;
  vec2 vel = texture(u_vel, x / u_size).xy;
  o = texture(u_src, (x - vel * u_shift) / u_size);
}`;

/**
 * MacCormack's correction (after Selle et al. 2008), clamped to the values the forward step
 * read so it can't overshoot, then the inlet's smoke, a slow fade, and nothing inside solids.
 */
export const CORRECT_FS = `${HEADER}
uniform sampler2D u_phi;
uniform sampler2D u_fwd;
uniform sampler2D u_bwd;
uniform sampler2D u_vel;
uniform sampler2D u_inlet;
uniform vec2 u_size;
uniform float u_shift;
uniform float u_fade;
uniform float u_inject;
out vec4 o;
void main() {
  vec2 x = gl_FragCoord.xy;
  ivec2 p = ivec2(x);
  vec4 vel = texture(u_vel, x / u_size);
  if (vel.w > 0.5) {
    o = vec4(0.0);
    return;
  }
  if (x.x < u_inject) {
    o = vec4(texelFetch(u_inlet, ivec2(p.y, 1), 0).rgb, 0.0);
    return;
  }
  vec2 back = x - vel.xy * u_shift - 0.5;
  ivec2 i0 = clamp(ivec2(floor(back)), ivec2(0), ivec2(u_size) - 2);
  vec4 a = texelFetch(u_phi, i0, 0);
  vec4 b = texelFetch(u_phi, i0 + ivec2(1, 0), 0);
  vec4 c = texelFetch(u_phi, i0 + ivec2(0, 1), 0);
  vec4 d = texelFetch(u_phi, i0 + ivec2(1, 1), 0);
  vec4 lo = min(min(a, b), min(c, d));
  vec4 hi = max(max(a, b), max(c, d));
  vec4 fwd = texelFetch(u_fwd, p, 0);
  vec4 r = fwd + 0.5 * (texelFetch(u_phi, p, 0) - texelFetch(u_bwd, p, 0));
  o = clamp(r, lo, hi) * u_fade;
}`;

/**
 * The picture. `u_view`: 0 smoke, 1 speed, 2 swirl. Grid coordinates come from the canvas
 * pixel through an affine map; outside the visible grid the canvas stays clear.
 */
export const RENDER_FS = `${HEADER}
uniform sampler2D u_dye;
uniform sampler2D u_vel;
uniform vec3 u_row0;
uniform vec3 u_row1;
uniform vec2 u_canvas;
uniform vec2 u_tex;
uniform vec2 u_visible;
uniform int u_view;
uniform float u_uref;
uniform float u_wref;
uniform vec3 u_tint0;
uniform vec3 u_tint1;
uniform vec3 u_tint2;
uniform vec3 u_back;
out vec4 o;

vec3 speedColor(float s) {
  s = clamp(s, 0.0, 1.0);
  vec3 a = vec3(0.03, 0.06, 0.16);
  vec3 b = vec3(0.10, 0.33, 0.62);
  vec3 c = vec3(0.12, 0.70, 0.66);
  vec3 d = vec3(0.62, 0.90, 0.42);
  vec3 e = vec3(0.98, 0.97, 0.80);
  if (s < 0.25) return mix(a, b, s * 4.0);
  if (s < 0.5) return mix(b, c, (s - 0.25) * 4.0);
  if (s < 0.75) return mix(c, d, (s - 0.5) * 4.0);
  return mix(d, e, (s - 0.75) * 4.0);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);
  vec2 g = vec2(dot(u_row0, vec3(px, 1.0)), dot(u_row1, vec3(px, 1.0)));
  if (g.x < 0.0 || g.y < 0.0 || g.x > u_visible.x || g.y > u_visible.y) {
    o = vec4(0.0);
    return;
  }
  vec2 uv = g / u_tex;
  vec4 d = texture(u_dye, uv);
  vec4 m = texture(u_vel, uv);
  vec3 smoke = d.r * u_tint0 + d.g * u_tint1 + d.b * u_tint2;
  float amount = clamp(d.r + d.g + d.b, 0.0, 1.0);
  vec3 col;
  if (u_view == 1) {
    col = speedColor(length(m.xy) / (u_uref * 1.6));
    col = mix(col, vec3(1.0), 0.25 * amount);
  } else if (u_view == 2) {
    vec2 e = 1.0 / u_tex;
    float w = (texture(u_vel, uv + vec2(e.x, 0.0)).y - texture(u_vel, uv - vec2(e.x, 0.0)).y
      - texture(u_vel, uv + vec2(0.0, e.y)).x + texture(u_vel, uv - vec2(0.0, e.y)).x) * 0.5;
    float k = clamp(w / u_wref, -1.0, 1.0);
    float s = sqrt(abs(k));
    vec3 anti = vec3(0.20, 0.85, 0.95);
    vec3 clock = vec3(0.98, 0.36, 0.70);
    col = u_back + (k > 0.0 ? anti : clock) * s;
    col = mix(col, vec3(0.85), 0.18 * amount);
  } else if (u_view == 3) {
    // Debugging only: density, red above 1 and blue below, saturating at 1 percent.
    float k = clamp(m.z * 100.0, -1.0, 1.0);
    col = k > 0.0 ? vec3(k, 0.1, 0.1) : vec3(0.1, 0.1, -k);
  } else {
    col = u_back + smoke * (1.0 - 0.35 * amount);
  }
  if (m.w > 0.5) col = u_back * 0.6;
  o = vec4(col, 1.0);
}`;

/**
 * Forces on each shape: row r of shape s sums the averaged force of the cells in that shape's
 * box whose last touch was that shape, over rows r, r + u_rows, ...
 */
export const FORCES_FS = `${HEADER}
uniform sampler2D u_f2;
uniform ivec4 u_box[${MAX_SHAPES}];
uniform int u_rows;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec4 b = u_box[p.y];
  vec2 sum = vec2(0.0);
  float n = 0.0;
  for (int y = b.y + p.x; y < b.w; y += u_rows) {
    for (int x = b.x; x < b.z; x++) {
      vec4 c = texelFetch(u_f2, ivec2(x, y), 0);
      if (int(c.w + 0.5) == p.y + 1) {
        sum += c.yz;
        n += 1.0;
      }
    }
  }
  o = vec4(sum, n, 0.0);
}`;

/** Plume samples across a frame's top edge: row 0 velocity (up, right), row 1 smoke. */
export const PLUME_FS = `${HEADER}
uniform sampler2D u_vel;
uniform sampler2D u_dye;
uniform vec3 u_row0;
uniform vec3 u_row1;
uniform vec2 u_tex;
uniform vec2 u_visible;
uniform float u_line;
uniform float u_width;
uniform float u_n;
uniform vec4 u_dir;
uniform float u_uref;
uniform float u_range;
out vec4 o;
float enc(float v) { return (128.0 + clamp(v / u_range, -1.0, 1.0) * 127.0) / 255.0; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 vel = vec2(0.0);
  vec3 dye = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float vx = (float(p.x) + (float(k) + 0.5) / 4.0) / u_n * u_width;
    vec2 g = vec2(dot(u_row0, vec3(vx, u_line, 1.0)), dot(u_row1, vec3(vx, u_line, 1.0)));
    if (g.x < 0.0 || g.y < 0.0 || g.x > u_visible.x || g.y > u_visible.y) continue;
    vec4 m = texture(u_vel, g / u_tex);
    if (m.w > 0.5) continue;
    vel += m.xy;
    // Thin streaks would average away across a sample; keep the strongest.
    dye = max(dye, texture(u_dye, g / u_tex).rgb);
  }
  vel *= 0.25;
  // Grid velocity to the frame's (up, right).
  vec2 v = vec2(dot(u_dir.xy, vel), dot(u_dir.zw, vel)) / u_uref;
  o = p.y == 0 ? vec4(enc(v.x), enc(v.y), 0.5, 1.0) : vec4(clamp(dye, 0.0, 1.0), 1.0);
}`;

/** Health over blocks of 8 x 8 cells: the top speed, and whether any cell is broken. */
export const PROBE_FS = `${HEADER}
uniform sampler2D u_vel;
uniform ivec2 u_size;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 8;
  float top = 0.0;
  float bad = 0.0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      ivec2 q = p + ivec2(x, y);
      if (q.x >= u_size.x || q.y >= u_size.y) continue;
      vec4 m = texelFetch(u_vel, q, 0);
      float s = length(m.xy);
      if (!(s < 0.6) || !(abs(m.z) < 2.0)) bad = 1.0;
      else top = max(top, s);
    }
  }
  o = vec4(min(1.0, top / 0.5), bad, 0.0, 1.0);
}`;
