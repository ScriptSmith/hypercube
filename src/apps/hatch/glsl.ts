/**
 * Our own noise for the shaders: an integer hash, value noise in 3D and sums of it. Bakes use
 * it freely; the per-frame shader only a little, since it runs on every pixel of the feed.
 */
export const NOISE_GLSL = /* glsl */ `
uint hatchHash(uvec3 v) {
  uint h = v.x * 0x8f3a6b1du + v.y * 0x5c1e93a7u + v.z * 0xd2b74e35u;
  h ^= h >> 15u;
  h *= 0x2c9277b5u;
  h ^= h >> 13u;
  h *= 0x6a5d39e9u;
  h ^= h >> 16u;
  return h;
}
float hash3(ivec3 c) {
  return float(hatchHash(uvec3(c))) * (1.0 / 4294967295.0);
}
vec3 hash33(ivec3 c) {
  uint h = hatchHash(uvec3(c));
  uint g = hatchHash(uvec3(c) + uvec3(h, 101u, 7u));
  uint k = hatchHash(uvec3(g, h, 31u));
  return vec3(float(h), float(g), float(k)) * (1.0 / 4294967295.0);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float a = hash3(c);
  float b = hash3(c + ivec3(1, 0, 0));
  float d = hash3(c + ivec3(0, 1, 0));
  float e = hash3(c + ivec3(1, 1, 0));
  float g = hash3(c + ivec3(0, 0, 1));
  float h = hash3(c + ivec3(1, 0, 1));
  float k = hash3(c + ivec3(0, 1, 1));
  float l = hash3(c + ivec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(d, e, u.x), u.y), mix(mix(g, h, u.x), mix(k, l, u.x), u.y), u.z);
}
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float norm = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise(p);
    norm += amp;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return sum / norm;
}
`;

/** Turns a direction into a full-sphere equirectangular texture position, row 0 at the bottom. */
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
`;

export const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
