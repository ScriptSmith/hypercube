/** GLSL shared by every pass: integer hashes for grain, jitter and per-cell randomness, and a square. */
export const HASH_GLSL = /* glsl */ `
/** pow(x, 2.0) is undefined for negative x, and some drivers return NaN for it. */
float sq(float x) { return x * x; }
uint orbMix(uint h) {
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  return h;
}
/** In [0, 1) for a pixel or an integer cell. */
float hashCell(vec2 c) {
  ivec2 i = ivec2(floor(c)) + 65536;
  return float(orbMix(uint(i.x) * 0x9e3779b1u ^ orbMix(uint(i.y) + 0x632be5abu))) / 4294967296.0;
}
`;
