/**
 * The beach ball on the wall, for `createWallBall`: the sphere build's vinyl, lit by a high sun
 * behind the people's left shoulders, the blue sky and warm light bounced off the sand, and
 * reflecting the sky above and the beach below. A ball fresh from the sea wears beads of water
 * that ride with it and dry one by one.
 */
import { VINYL_GLSL } from "./shader";
import { LIGHT_GLSL } from "./wallsky";

/**
 * Towards the sun, in the wall's frame: a midday beach sun, high and a little to the left and
 * behind the viewers, so each ball's shadow lies on the sand under it.
 */
export const SUN: readonly [number, number, number] = (() => {
  const v = [-0.22, 0.94, 0.26];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
})();

/**
 * Soft shoulder for the brightest light, shared with the beach so they match. It scales the
 * whole colour by its brightest channel, so a lit orange stays orange rather than going yellow.
 */
export const TONE_GLSL = /* glsl */ `
vec3 tone(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m <= 0.72) return c;
  return c * ((0.72 + 0.28 * (1.0 - exp(-(m - 0.72) / 0.28))) / m);
}
`;

export const WALL_BALL_GLSL = /* glsl */ `
const float SPHERE_PI = 3.141592653589793;
${VINYL_GLSL}
${TONE_GLSL}
${LIGHT_GLSL}
uniform vec3 uSun;
// How wet the ball is, 0 to 1, and how high its bottom is off the sand, in radii.
uniform float uWet;
uniform float uLift;

// A bright beach: the sun is only part of the light. The sky above, the sunlit sand below and
// the beach behind the viewers (sand, sky, the next wall) light every side, so the side of a
// ball facing the people is never in deep shade. The time of day sets them, in wallsky.ts.
const float BEAD_CELL = 0.07;

float beadHash(vec3 c, float salt) {
  uvec3 u = uvec3(ivec3(c) + 4096);
  uint h = u.x * 0x8da6b343u ^ u.y * 0xd8163841u ^ u.z * 0xcb1ab31fu ^ uint(salt) * 0x9e3779b9u;
  h ^= h >> 15u;
  h *= 0x2c1b3c6du;
  h ^= h >> 12u;
  return float(h >> 8u) / 16777216.0;
}

vec4 wallSurface(vec3 n0, vec3 v, float aa) {
  Vinyl m = vinyl(n0, aa);
  vec3 n = m.n;
  vec3 albedo = m.albedo;
  float gloss = m.gloss;
  float glint = 0.0;

  // Beads of water, one at most in each small cube of the ball's own frame, kept clear of the
  // cube's faces so none is ever cut off.
  if (uWet > 0.0) {
    vec3 b = uSpin * n0;
    vec3 cell = floor(b / BEAD_CELL);
    float here = beadHash(cell, 1.0);
    if (here < 0.62 && beadHash(cell, 2.0) < uWet) {
      vec3 jitter = vec3(beadHash(cell, 3.0), beadHash(cell, 4.0), beadHash(cell, 5.0)) - 0.5;
      vec3 c = normalize((cell + 0.5 + jitter * 0.3) * BEAD_CELL);
      float size = BEAD_CELL * (0.16 + 0.14 * beadHash(cell, 6.0));
      vec3 off = b - c;
      float rho = length(off) / size;
      float cover = 1.0 - smoothstep(1.0 - aa / size, 1.0, rho);
      if (cover > 0.0) {
        float hgt = sqrt(max(1.0 - rho * rho, 0.0));
        vec3 bent = normalize(b + off / size * (0.9 / max(hgt, 0.25)));
        n = normalize(mix(n, bent * uSpin, cover));
        albedo *= mix(1.0, 1.0 - 0.4 * smoothstep(0.6, 1.0, rho), cover);
        gloss = mix(gloss, 1.6, cover);
        glint = cover;
      }
    }
  }

  float ndl = max(dot(n, uSun), 0.0);
  // The sand round a ball resting on it shades its underside.
  float low = (1.0 + n0.y) + uLift;
  float nearSand = exp(-low * 2.2) * smoothstep(0.2, -0.5, n0.y);
  vec3 light = uLightSun * ndl + uLightSky * (0.5 + 0.5 * n.y)
    + uLightSand * (0.5 - 0.5 * n.y) * (1.0 - 0.7 * nearSand)
    + uLightBehind * (0.5 + 0.5 * n.z);
  vec3 col = albedo * light * m.ao * (1.0 - 0.35 * nearSand);

  float nv = max(dot(n, v), 0.04);
  vec3 r = reflect(-v, n);
  float f0 = mix(0.045, 0.03, glint);
  float fres = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  col += fres * skyEnv(r) * gloss * mix(1.0, m.ao, 0.5) * (1.0 - 0.6 * nearSand);
  float h = max(dot(r, uSun), 0.0);
  float sharp = mix(180.0, 900.0, glint);
  col += uGlint * (pow(h, sharp) * mix(5.0, 9.0, glint) + pow(h, 24.0) * 0.18)
    * (0.05 + fres) * gloss;
  col += vec3(1.0, 0.98, 0.95) * m.shine * 0.03 * (0.4 + 0.6 * ndl);
  return vec4(tone(col), 1.0);
}
`;
