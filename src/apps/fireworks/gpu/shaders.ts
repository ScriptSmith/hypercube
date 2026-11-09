/**
 * GLSL for the sky. Stars are computed in closed form in the vertex shader from one burst's
 * uniforms and the star's index (`gl_VertexID`), so the CPU never touches a particle:
 *
 *   p(t) = origin + (drift + dir * speed) * F(t) - (0, g) * (t - F(t)) / k,  F(t) = (1 - e^-kt) / k
 *
 * Shapes only change how `dir`, speed and life come from the index and a hash of the seed.
 */
import { SHAPE } from "../recipe";

const HASH = /* glsl */ `
uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float rnd(uint i, uint salt) {
  return float(hashU(i * 0x9e3779b1u ^ hashU(salt * 0x85ebca77u + u_seed))) / 4294967296.0;
}
vec2 toClip(vec2 p) {
  return (p - u_view.xy) / (u_view.zw - u_view.xy) * 2.0 - 1.0;
}
float reachK(float k, float t) {
  return k * t < 1e-3 ? t - 0.5 * k * t * t : (1.0 - exp(-k * t)) / k;
}
float fallK(float k, float t) {
  return k * t < 1e-2 ? 0.5 * t * t - k * t * t * t / 6.0 : (t - reachK(k, t)) / k;
}
`;

const S = SHAPE;

export const BURST_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec4 u_view;
uniform float u_pxPerUnit;
uniform vec2 u_origin;
uniform vec2 u_drift;
uniform float u_age;
uniform float u_speed;
uniform float u_grav;
uniform float u_drag;
uniform float u_life;
uniform int u_shape;
uniform uint u_seed;
uniform int u_count;
uniform int u_tail;
uniform float u_tilt;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform int u_mixed;
uniform float u_star;
uniform float u_fade;
uniform vec3 u_palette[6];

out vec3 v_color;
out float v_alpha;

${HASH}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

vec2 sphereDir(float a, float b) {
  float z = 2.0 * a - 1.0;
  float phi = 6.2831853 * b;
  return sqrt(max(0.0, 1.0 - z * z)) * vec2(cos(phi), sin(phi));
}

// A point on a pictogram outline, about unit size, y up. s in [0, 1) runs along it.
vec2 heart(float s) {
  float t = 6.2831853 * s;
  float st = sin(t);
  return vec2(16.0 * st * st * st, 13.0 * cos(t) - 5.0 * cos(2.0 * t) - 2.0 * cos(3.0 * t) - cos(4.0 * t)) / 16.5 + vec2(0.0, 0.12);
}
vec2 starShape(float s) {
  float e = s * 10.0;
  float i = floor(e);
  float f = e - i;
  float a0 = 1.5707963 + i * 0.6283185;
  float a1 = a0 + 0.6283185;
  float r0 = mod(i, 2.0) < 0.5 ? 1.0 : 0.42;
  float r1 = mod(i, 2.0) < 0.5 ? 0.42 : 1.0;
  return mix(r0 * vec2(cos(a0), sin(a0)), r1 * vec2(cos(a1), sin(a1)), f);
}
vec2 smiley(float s, float r) {
  if (s < 0.56) {
    float t = 6.2831853 * s / 0.56;
    return vec2(cos(t), sin(t));
  }
  if (s < 0.68) {
    float t = 6.2831853 * (s - 0.56) / 0.12;
    return vec2(-0.36, 0.3) + 0.11 * sqrt(r) * vec2(cos(t), sin(t));
  }
  if (s < 0.8) {
    float t = 6.2831853 * (s - 0.68) / 0.12;
    return vec2(0.36, 0.3) + 0.11 * sqrt(r) * vec2(cos(t), sin(t));
  }
  float t = 3.6651914 + 2.0943951 * (s - 0.8) / 0.2;
  return vec2(0.0, 0.05) + 0.58 * vec2(cos(t), sin(t));
}
vec2 flower(float s, float r) {
  if (s < 0.84) {
    float t = 3.1415927 * s / 0.84;
    float rr = cos(5.0 * t);
    return rr * vec2(cos(t + 1.5707963), sin(t + 1.5707963));
  }
  float t = 6.2831853 * (s - 0.84) / 0.16;
  return 0.16 * vec2(cos(t), sin(t)) * (0.7 + 0.3 * r);
}

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  v_alpha = 0.0;
  v_color = vec3(0.0);
}

void main() {
  int tail = max(1, u_tail);
  int star = gl_VertexID / tail;
  int tailIdx = gl_VertexID - star * tail;
  uint si = uint(star);
  float r1 = rnd(si, 1u);
  float r2 = rnd(si, 2u);
  float r3 = rnd(si, 3u);
  float r4 = rnd(si, 4u);

  float k = u_drag;
  float lifeMul = 0.82 + 0.3 * r4;
  float sizeMul = 1.0;
  float sp = 1.0;
  float glitter = 0.0;
  vec2 dir = vec2(0.0);
  float splitAt = -1.0;
  vec2 subDir = vec2(0.0);
  float emitAt = 0.0;
  bool emitter = false;
  vec3 base = u_colA;
  float tailStep = 0.035;

  if (u_shape == ${S.peony} || u_shape == ${S.willow}) {
    dir = sphereDir(r1, r2);
    sp = 0.93 + 0.07 * r3;
    if (u_shape == ${S.willow}) {
      sp = 0.75 + 0.25 * r3;
      glitter = 1.0;
      sizeMul = 0.85;
      tailStep = 0.07;
      base = mix(u_colA, vec3(1.0, 0.72, 0.32), 0.62);
    }
  } else if (u_shape == ${S.ring}) {
    float th = 6.2831853 * (float(star) + 0.35 * r1) / float(u_count);
    float inc = 0.25 + 0.75 * rnd(0u, 9u);
    dir = rot(u_tilt) * vec2(cos(th), sin(th) * inc);
    sp = 0.97 + 0.05 * r3;
    sizeMul = 1.25;
    if (r4 < 0.3) { sp *= 0.55; sizeMul = 0.8; base = u_colB; }
  } else if (u_shape == ${S.palm}) {
    int arms = 6 + int(rnd(0u, 11u) * 4.0);
    int arm = star % arms;
    float th = 6.2831853 * (float(arm) + 0.06 * (r1 - 0.5)) / float(arms) + u_tilt;
    dir = normalize(vec2(cos(th), sin(th) + 0.35));
    sp = 0.22 + 0.78 * sqrt(r2);
    sizeMul = 1.35 + 0.6 * sp;
    lifeMul = 0.9 + 0.2 * r4;
    tailStep = 0.05;
    base = mix(u_colA, vec3(1.0, 0.8, 0.45), 0.35);
  } else if (u_shape == ${S.crossette}) {
    int sub = star % 4;
    int parent = star / 4;
    uint pi = uint(parent);
    dir = sphereDir(rnd(pi, 21u), rnd(pi, 22u));
    dir = normalize(dir + 0.0001) * (0.75 + 0.25 * length(dir));
    sp = 0.9 + 0.1 * rnd(pi, 23u);
    splitAt = 0.4 * u_life;
    float a = 0.7853982 + 1.5707963 * float(sub) + 0.3 * rnd(pi, 24u);
    subDir = vec2(cos(a), sin(a));
    glitter = 0.6;
    lifeMul = 0.95 + 0.1 * r4;
  } else if (u_shape == ${S.heart} || u_shape == ${S.star} || u_shape == ${S.smiley} || u_shape == ${S.flower}) {
    float s = (float(star) + 0.6 * r1) / float(u_count);
    vec2 p = u_shape == ${S.heart} ? heart(s) : u_shape == ${S.star} ? starShape(s) : u_shape == ${S.smiley} ? smiley(s, r2) : flower(s, r2);
    dir = rot(u_tilt) * p;
    sp = 1.0;
    lifeMul = 0.92 + 0.12 * r4;
    sizeMul = 1.15;
  } else if (u_shape == ${S.cascade}) {
    emitter = true;
    emitAt = (float(star) + r1) / float(u_count) * (u_life * 0.45);
    dir = vec2((r2 - 0.5) * 0.6, -0.3 - 0.3 * r3);
    sp = 1.0;
    lifeMul = 0.42 + 0.1 * r4;
    glitter = 1.0;
    sizeMul = 0.8;
    base = mix(u_colA, vec3(1.0, 0.78, 0.4), 0.55);
  } else {
    float th = 6.2831853 * (float(star) + 0.5 * r1) / float(u_count);
    dir = vec2(cos(th), sin(th));
    sp = 0.9 + 0.12 * r3;
    glitter = 1.0;
    sizeMul = 0.8;
    base = vec3(1.0, 0.86, 0.6);
  }

  if (u_mixed == 1 && u_shape != ${S.cascade}) {
    int pick = int(rnd(u_shape == ${S.crossette} ? uint(star / 4) : (u_shape == ${S.palm} ? uint(star % 9) : si), 5u) * 6.0);
    base = u_palette[min(pick, 5)];
  } else if (u_shape == ${S.peony} && r4 < 0.22) {
    base = u_colB;
  }

  float life = u_life * lifeMul;
  float t = u_age - float(tailIdx) * tailStep;
  if (emitter) t -= emitAt;
  if (t <= 0.0 || t > life) { cull(); return; }

  vec2 pos;
  if (emitter) {
    float f = reachK(k, t);
    pos = u_origin + vec2((r1 - 0.5) * u_speed * 0.6, 0.0) + dir * u_speed * 0.3 * f - vec2(0.0, u_grav * fallK(k, t));
  } else {
    float f = reachK(k, t);
    pos = u_origin + u_drift * f - vec2(0.0, u_grav * fallK(k, t));
    if (splitAt > 0.0 && t > splitAt) {
      pos += dir * u_speed * sp * reachK(k, splitAt);
      pos += subDir * u_speed * 0.42 * reachK(k * 1.3, t - splitAt);
    } else {
      pos += dir * u_speed * sp * f;
      if (splitAt > 0.0 && (star - (star / 4) * 4) != 0) { cull(); return; }
    }
  }

  float x = t / life;
  // The opening is held back a little: every star starts in one spot, and added together they
  // would make a white flash. It stays a small bright core instead.
  float onset = smoothstep(0.0, 0.1, t) * mix(0.35, 1.0, smoothstep(0.04, 0.4, t));
  float alpha = onset * pow(1.0 - x, 1.1) * 1.25;
  vec3 hot = vec3(1.0, 0.9, 0.78);
  vec3 c = mix(hot, base, smoothstep(0.0, 0.12, x));
  vec3 ember = vec3(1.0, 0.42, 0.16) * (0.45 + 0.4 * dot(base, vec3(0.33)));
  c = mix(c, mix(base, ember, 0.65), smoothstep(0.62, 1.0, x));
  if (splitAt > 0.0 && t > splitAt) c = mix(c, vec3(1.0, 0.9, 0.7), 0.35 * exp(-(t - splitAt) * 6.0));

  // Twinkle: slow (under 3 Hz per star) and per star, so it shimmers rather than flashes.
  if (glitter > 0.0) {
    float hz = 1.4 + 1.3 * r3;
    float on = step(0.45, fract(t * hz + r2));
    alpha *= mix(1.0, 0.25 + 0.75 * on, glitter);
  }
  float tailFade = 1.0 - float(tailIdx) / float(tail);
  alpha *= tailFade * u_fade;

  float size = u_star * sizeMul * (1.0 - 0.45 * x) * (0.6 + 0.4 * tailFade) * u_pxPerUnit;
  if (size < 1.6) { alpha *= (size / 1.6) * (size / 1.6); size = 1.6; }
  size = min(size, 64.0);

  gl_Position = vec4(toClip(pos), 0.0, 1.0);
  gl_PointSize = size;
  v_color = c;
  v_alpha = alpha;
}
`;

export const SHELL_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec4 u_view;
uniform float u_pxPerUnit;
uniform vec2 u_origin;
uniform vec2 u_vel;
uniform float u_grav;
uniform float u_age;
uniform float u_end;
uniform float u_rate;
uniform int u_first;
uniform float u_sparkLife;
uniform float u_star;
uniform vec3 u_col;
uniform uint u_seed;

out vec3 v_color;
out float v_alpha;

${HASH}

vec2 shellAt(float t) {
  return u_origin + u_vel * t - vec2(0.0, 0.5 * u_grav * t * t);
}

void main() {
  float size;
  vec2 pos;
  vec3 c;
  float alpha;
  if (gl_VertexID == 0) {
    if (u_age >= u_end || u_age < 0.0) { gl_Position = vec4(2.0); gl_PointSize = 0.0; v_alpha = 0.0; v_color = vec3(0.0); return; }
    pos = shellAt(u_age);
    size = u_star * 2.4;
    c = mix(vec3(1.0, 0.9, 0.75), u_col, 0.25);
    alpha = 1.0;
  } else {
    uint i = uint(u_first + gl_VertexID - 1);
    float te = float(i) / u_rate;
    float a = u_age - te;
    if (te > min(u_age, u_end) || a > u_sparkLife || a < 0.0) { gl_Position = vec4(2.0); gl_PointSize = 0.0; v_alpha = 0.0; v_color = vec3(0.0); return; }
    float r1 = rnd(i, 1u), r2 = rnd(i, 2u), r3 = rnd(i, 3u);
    float speed = length(u_vel);
    vec2 kick = vec2(r1 - 0.5, r2 - 0.6) * speed * 0.09;
    float f = reachK(3.0, a);
    pos = shellAt(te) + kick * f - vec2(0.0, speed * 0.06 * a * a);
    float x = a / u_sparkLife;
    size = u_star * (1.1 - 0.7 * x) * (0.7 + 0.5 * r3);
    c = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.38, 0.12), smoothstep(0.1, 0.8, x));
    alpha = pow(1.0 - x, 1.6) * (0.55 + 0.45 * r3);
    float on = step(0.35, fract(a * (1.5 + r2) + r1));
    alpha *= 0.4 + 0.6 * on;
  }
  size *= u_pxPerUnit;
  if (size < 1.6) { alpha *= (size / 1.6) * (size / 1.6); size = 1.6; }
  gl_Position = vec4(toClip(pos), 0.0, 1.0);
  gl_PointSize = min(size, 48.0);
  v_color = c;
  v_alpha = alpha;
}
`;

export const POINT_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec3 v_color;
in float v_alpha;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 7.0);
  float halo = (1.0 - r2) * 0.22;
  o = vec4(v_color * v_alpha * (core * 1.4 + halo), 1.0);
}
`;

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FADE_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform float u_keep;
out vec4 o;
void main() { o = vec4(0.0, 0.0, 0.0, u_keep); }
`;

export const FLOOR_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform float u_floor;
out vec4 o;
void main() { o = vec4(u_floor); }
`;

/** Box downsample of four taps. */
export const DOWN_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_src;
uniform vec2 u_texel;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv + u_texel * vec2(-0.5, -0.5)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(0.5, -0.5)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(-0.5, 0.5)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(0.5, 0.5)).rgb;
  o = vec4(c * 0.25, 1.0);
}
`;

/** Nine-tap Gaussian along one axis, using linear filtering for the in-between taps. */
export const BLUR_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_src;
uniform vec2 u_step;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 0.227027;
  c += texture(u_src, v_uv + u_step * 1.384615).rgb * 0.316216;
  c += texture(u_src, v_uv - u_step * 1.384615).rgb * 0.316216;
  c += texture(u_src, v_uv + u_step * 3.230769).rgb * 0.070270;
  c += texture(u_src, v_uv - u_step * 3.230769).rgb * 0.070270;
  o = vec4(c, 1.0);
}
`;

export const MAX_LIGHTS = 8;
export const MAX_GLOWS = 6;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform sampler2D u_bloom1;
uniform sampler2D u_bloom2;
uniform vec4 u_view;
uniform vec2 u_res;
uniform float u_pxPerUnit;
uniform float u_time;
uniform float u_horizon;
uniform float u_zenith;
uniform float u_ground;
uniform float u_starCell;
uniform vec4 u_lights[${MAX_LIGHTS}];
uniform vec3 u_lightCol[${MAX_LIGHTS}];
uniform int u_lightCount;
uniform vec4 u_glows[${MAX_GLOWS}];
uniform vec3 u_glowCol[${MAX_GLOWS}];
uniform int u_glowCount;
in vec2 v_uv;
out vec4 o;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float a = h21(vec2(i, 3.1));
  float b = h21(vec2(i + 1.0, 3.1));
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}

void main() {
  vec2 p = mix(u_view.xy, u_view.zw, v_uv);
  float span = max(1.0, u_zenith - u_horizon);
  float h = (p.y - u_horizon) / span;

  // Night sky: deep blue at the horizon, near black overhead.
  vec3 zen = vec3(0.004, 0.006, 0.018);
  vec3 low = vec3(0.028, 0.03, 0.075);
  vec3 haze = vec3(0.055, 0.045, 0.09);
  vec3 sky = mix(low, zen, pow(clamp(h, 0.0, 1.0), 0.55));
  sky = mix(sky, haze, exp(-max(h, 0.0) * 9.0) * 0.6);

  // A few faint stars high up, twinkling slowly.
  if (h > 0.18) {
    vec2 cell = floor(p / u_starCell);
    float r = h21(cell);
    if (r < 0.14) {
      vec2 sp = (cell + vec2(h21(cell + 7.0), h21(cell + 13.0))) * u_starCell;
      float d = length(p - sp) * u_pxPerUnit;
      float tw = 0.75 + 0.25 * sin(u_time * (0.5 + r) + r * 40.0);
      sky += vec3(0.75, 0.8, 1.0) * exp(-d * d * 0.9) * (0.2 + 0.8 * h21(cell + 3.0)) * 0.3 * tw * smoothstep(0.18, 0.4, h);
    }
  }

  // Ground under the pads: low hills, darker than the sky.
  if (u_ground > 0.5) {
    float hill = u_horizon + span * 0.012 * (noise1(p.x / (span * 0.05)) * 2.0 + noise1(p.x / (span * 0.013)) * 0.6);
    float g = smoothstep(hill + span * 0.002, hill - span * 0.002, p.y);
    vec3 earth = vec3(0.012, 0.014, 0.024);
    sky = mix(sky, earth, g);
    sky += vec3(0.05, 0.05, 0.1) * exp(-abs(p.y - hill) / (span * 0.004)) * 0.35;
  }

  // Light from bursts on the sky and the smoke around them.
  vec3 lit = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= u_lightCount) break;
    vec4 L = u_lights[i];
    vec2 d = (p - L.xy) / L.z;
    lit += u_lightCol[i] * L.w / (1.0 + dot(d, d) * 2.5);
  }
  sky += lit * 0.05;

  // Echo glows along the top of a touch frame when its shell bursts above.
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    if (i >= u_glowCount) break;
    vec4 G = u_glows[i];
    float dx = (p.x - G.x) / G.z;
    float dy = max(0.0, G.y - p.y) / (G.z * 1.6);
    sky += u_glowCol[i] * G.w * exp(-dx * dx) * exp(-dy * 2.2) * 0.4;
  }

  vec3 c = sky;
  c += texture(u_acc, v_uv).rgb;
  c += texture(u_bloom1, v_uv).rgb * 0.85;
  c += texture(u_bloom2, v_uv).rgb * 0.75;
  // Soft shoulder so dense bursts stay coloured instead of clipping to white.
  c = c / (1.0 + max(max(c.r, c.g), c.b) * 0.38) * 1.3;
  // Interleaved gradient noise against banding in the dark gradient.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  c += (ign - 0.5) / 255.0;
  o = vec4(max(c, 0.0), 1.0);
}
`;
