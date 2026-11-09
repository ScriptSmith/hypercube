/**
 * GLSL shared by the bakes, the glaze field and the surface: our own integer hash, value noise
 * and sums of it, and the mapping between directions and a full-sphere equirectangular texture
 * (row 0 at the bottom pole, column 0 at longitude -π).
 */

/** A number as a GLSL float literal. */
export const f = (n: number): string => {
  const s = String(n);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};

/** A colour or other triple as a GLSL vec3 literal. */
export const v3 = (c: readonly number[]): string => `vec3(${c.map(f).join(", ")})`;

export const NOISE_GLSL = /* glsl */ `
uint puddingHash(uvec3 v) {
  uint h = v.x * 0x9e3779b1u ^ (v.y + 0x7f4a7c15u) * 0x85ebca77u ^ (v.z + 0x165667b1u) * 0xc2b2ae3du;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}
float hash13(ivec3 c) {
  return float(puddingHash(uvec3(c + 32768))) * (1.0 / 4294967296.0);
}
vec4 hash43(ivec3 c) {
  uint a = puddingHash(uvec3(c + 32768));
  uint b = puddingHash(uvec3(a, uint(c.x) + 911u, 77u));
  uint d = puddingHash(uvec3(b, a, 2903u));
  uint e = puddingHash(uvec3(d, b, 15731u));
  return vec4(float(a), float(b), float(d), float(e)) * (1.0 / 4294967296.0);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float a = hash13(c);
  float b = hash13(c + ivec3(1, 0, 0));
  float d = hash13(c + ivec3(0, 1, 0));
  float e = hash13(c + ivec3(1, 1, 0));
  float g = hash13(c + ivec3(0, 0, 1));
  float h = hash13(c + ivec3(1, 0, 1));
  float k = hash13(c + ivec3(0, 1, 1));
  float l = hash13(c + ivec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(d, e, u.x), u.y), mix(mix(g, h, u.x), mix(k, l, u.x), u.y), u.z);
}
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float norm = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise(p);
    norm += amp;
    p = p * 2.07 + vec3(3.1, 7.7, 1.3);
    amp *= 0.5;
  }
  return sum / norm;
}
`;

export const EQ_GLSL = /* glsl */ `
const float EQ_PI = 3.141592653589793;
vec2 eqUv(vec3 d) {
  vec3 n = normalize(d);
  return vec2(atan(n.x, n.z) / (2.0 * EQ_PI) + 0.5, asin(clamp(n.y, -1.0, 1.0)) / EQ_PI + 0.5);
}
vec3 eqDir(vec2 uv) {
  float lon = uv.x * 2.0 * EQ_PI - EQ_PI;
  float lat = uv.y * EQ_PI - 0.5 * EQ_PI;
  float c = cos(lat);
  return vec3(c * sin(lon), sin(lat), c * cos(lon));
}
vec3 latLonDir(float lat, float lon) {
  float c = cos(lat);
  return vec3(c * sin(lon), sin(lat), c * cos(lon));
}
`;

export const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
