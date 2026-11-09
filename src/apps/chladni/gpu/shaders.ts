import { BESSEL_STEPS } from "../modes";
import { TUNE } from "../grains";

/**
 * GLSL for the sand. Grain state is an RGBA16UI texture, one texel per grain: x and y on the
 * plate (0 to 65535 across, whatever the plate's stretch), where it was sprinkled (8 bits each,
 * for the rainbow tint), and the local motion last step. The step shader evaluates the same mode
 * shapes as `modes.ts` and moves grains as `stepGrain` in `grains.ts` does.
 */
export const MAX_MODES = 8;

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));

const COMMON = `
const float PI = 3.14159265358979;

uint mix32(uint x) {
  x ^= x >> 16u;
  x *= 0x6a09e667u;
  x ^= x >> 15u;
  x *= 0xbb67ae85u;
  x ^= x >> 16u;
  return x;
}
float rand01(uint a, uint b) {
  return float(mix32(a * 0x9e3779b1u + mix32(b)) >> 8u) * (1.0 / 16777216.0);
}
`;

export const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
}`;

export const STEP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform int u_round;
uniform int u_count;
uniform vec4 u_mode[${MAX_MODES}];
/** Each mode's in-step and quarter-cycle amplitude. */
uniform vec2 u_amp[${MAX_MODES}];
/** The plate's half sides in true lengths. */
uniform vec2 u_half;
uniform float u_level;
uniform float u_wave2;
uniform float u_lift;
uniform float u_dt;
uniform uint u_tick;
uniform uint u_seed;
uniform vec2 u_span;

out uvec4 o_state;
${COMMON}
// p = (n, m, A, B), weights already scaled: A cos(n pi x) cos(m pi y) + B cos(m pi x) cos(n pi y).
void squareMode(vec4 p, vec2 q, out float w, out vec2 g) {
  vec2 a = (q + 1.0) * 0.5 * PI;
  float n = p.x;
  float m = p.y;
  float cnx = cos(n * a.x), snx = sin(n * a.x);
  float cmx = cos(m * a.x), smx = sin(m * a.x);
  float cny = cos(n * a.y), sny = sin(n * a.y);
  float cmy = cos(m * a.y), smy = sin(m * a.y);
  w = p.z * cnx * cmy + p.w * cmx * cny;
  g = 0.5 * PI * vec2(-p.z * n * snx * cmy - p.w * m * smx * cny, -p.z * m * cnx * smy - p.w * n * cmx * sny);
}

// Bessel's integral by the trapezoid rule, as bessel() in modes.ts.
void bessel(float n, float x, out float j, out float dj) {
  j = 0.0;
  dj = 0.0;
  for (int i = 0; i <= ${BESSEL_STEPS}; i++) {
    float t = PI * float(i) / ${f(BESSEL_STEPS)};
    float wt = (i == 0 || i == ${BESSEL_STEPS}) ? 0.5 : 1.0;
    float st = sin(t);
    float a = n * t - x * st;
    j += wt * cos(a);
    dj += wt * sin(a) * st;
  }
  j /= ${f(BESSEL_STEPS)};
  dj /= ${f(BESSEL_STEPS)};
}

// p = (n, k, scale, turn): J_n(k r) cos(n (theta - turn)), theta from straight up.
void roundMode(vec4 p, vec2 q, out float w, out vec2 g) {
  float n = p.x;
  float k = p.y;
  float r = max(1e-4, length(q));
  float th = atan(q.x, -q.y) - p.w;
  float j, dj;
  bessel(n, k * r, j, dj);
  float c = cos(n * th);
  float s = sin(n * th);
  float dr = k * dj * c;
  float dt = -n * j * s / r;
  vec2 ur = q / r;
  w = j * c * p.z;
  g = p.z * vec2(dr * ur.x - dt * ur.y, dr * ur.y + dt * ur.x);
}

uvec2 packPos(vec2 q) {
  return uvec2(clamp((q + 1.0) * 0.5, 0.0, 1.0) * 65535.0 + 0.5);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uvec4 s = texelFetch(u_state, c, 0);
  uint id = uint(c.y) * uint(textureSize(u_state, 0).x) + uint(c.x);

  float h = rand01(id, u_seed);
  if (h >= u_span.x && h < u_span.y) {
    vec2 q;
    if (u_round == 1) {
      float r = sqrt(rand01(id, u_seed + 11u)) * 0.995;
      float a = rand01(id, u_seed + 23u) * 2.0 * PI;
      q = vec2(r * sin(a), -r * cos(a));
    } else {
      q = vec2(rand01(id, u_seed + 11u), rand01(id, u_seed + 23u)) * 2.0 - 1.0;
    }
    uvec2 o = uvec2(clamp((q + 1.0) * 0.5, 0.0, 1.0) * 255.0 + 0.5);
    o_state = uvec4(packPos(q), o.x | (o.y << 8u), 0u);
    return;
  }

  vec2 q = vec2(s.xy) / 65535.0 * 2.0 - 1.0;
  // The motion's in-step and quarter-cycle parts, and their gradients.
  vec2 w = vec2(0.0);
  vec2 gr = vec2(0.0);
  vec2 gi = vec2(0.0);
  for (int i = 0; i < ${MAX_MODES}; i++) {
    if (i >= u_count) break;
    float wm;
    vec2 gm;
    if (u_round == 1) roundMode(u_mode[i], q, wm, gm);
    else squareMode(u_mode[i], q, wm, gm);
    w += u_amp[i] * wm;
    gr += u_amp[i].x * gm;
    gi += u_amp[i].y * gm;
  }
  float motion = length(w);

  if (u_lift > 0.0 && u_wave2 > 0.0 && u_level > 0.0) {
    float band = ${f(TUNE.band)} * u_level;
    float bounce = clamp((motion - band) / max(1e-4, band), 0.0, 1.0);
    float pull = -${f(TUNE.drift)} * u_lift * (bounce + ${f(TUNE.creep)}) * (u_level * u_level / u_wave2) * u_dt;
    float kick = ${f(TUNE.kick)} * u_lift * max(0.0, motion - band) * u_level * sqrt(u_dt) / sqrt(u_wave2);
    float r1 = max(1e-7, rand01(id, u_tick * 2u + 1u));
    float r2 = rand01(id, u_tick * 2u + 2u);
    vec2 noise = sqrt(-2.0 * log(r1)) * vec2(cos(2.0 * PI * r2), sin(2.0 * PI * r2));
    vec2 slope = (w.x * gr + w.y * gi) / u_half;
    vec2 d = pull * slope + kick * noise;
    float len = length(d);
    if (len > ${f(TUNE.maxStep)}) d *= ${f(TUNE.maxStep)} / len;
    q += d / u_half;
    if (u_round == 1) {
      float r = length(q);
      if (r > 0.999) q *= clamp(2.0 - r, 0.0, 0.999) / r;
    } else {
      q = mix(q, 2.0 * sign(q) - q, step(1.0, abs(q)));
      q = clamp(q, -1.0, 1.0);
    }
  }
  o_state = uvec4(packPos(q), s.z, uint(clamp(motion, 0.0, 2.0) * 32767.0));
}`;

export const DRAW_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
/** The plate's rectangle in clip space: left, top, right, bottom. */
uniform vec4 u_rect;
uniform float u_size;
/** How far (plate units) a grain shivers per unit of local motion. */
uniform float u_shiver;
uniform uint u_tick;
/** 0 sand, 1 white, 2 rainbow. */
uniform int u_tint;
uniform float u_alpha;

out vec4 v_color;
${COMMON}
vec3 hue(float h) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), k, 0.62);
}

void main() {
  int w = textureSize(u_state, 0).x;
  ivec2 c = ivec2(gl_VertexID % w, gl_VertexID / w);
  uvec4 s = texelFetch(u_state, c, 0);
  vec2 q = vec2(s.xy) / 65535.0;
  float motion = float(s.w) / 32767.0;
  uint id = uint(gl_VertexID);
  vec2 j = vec2(rand01(id, u_tick), rand01(id, u_tick + 7919u)) - 0.5;
  q += j * u_shiver * min(motion, 1.5);
  gl_Position = vec4(mix(u_rect.xy, u_rect.zw, q), 0.0, 1.0);
  gl_PointSize = u_size;

  float shade = 0.82 + 0.18 * rand01(id, 3u);
  vec3 col;
  if (u_tint == 2) {
    vec2 o = vec2(float(s.z & 255u), float(s.z >> 8u)) / 255.0;
    col = hue(0.85 * o.x + 0.08 * o.y);
  } else if (u_tint == 1) {
    col = vec3(0.93, 0.95, 1.0);
  } else {
    col = mix(vec3(0.95, 0.78, 0.52), vec3(1.0, 0.9, 0.7), rand01(id, 5u));
  }
  // A grain in the air looks fainter, like a blur.
  float a = u_alpha * (1.0 - 0.4 * clamp(motion, 0.0, 1.0));
  v_color = vec4(col * shade * a, a);
}`;

export const DRAW_FS = `#version 300 es
precision mediump float;
uniform float u_soft;
in vec4 v_color;
out vec4 o_color;
void main() {
  float k = 1.0;
  if (u_soft > 0.5) {
    vec2 d = gl_PointCoord - 0.5;
    k = smoothstep(0.5, 0.25, length(d));
  }
  o_color = v_color * k;
}`;
