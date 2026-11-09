/**
 * Shaders that run once per egg (the shell's colour) or once per page (the chick's down) into
 * textures over the whole sphere, so the per-frame shader only looks them up.
 */
import { EQ_GLSL, NOISE_GLSL } from "./glsl";

/** Round spots on the sphere: some cells of a 3D grid hold a ball, cut by the surface. */
const SPOTS_GLSL = /* glsl */ `
float spots(vec3 p, float density, float size, float soft) {
  vec3 i = floor(p);
  vec3 f = p - i;
  float best = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec3 c = ivec3(i) + ivec3(x, y, z);
        vec3 h = hash33(c);
        if (h.x > density) continue;
        vec3 o = vec3(float(x), float(y), float(z)) + hash33(c + ivec3(17, 3, 5)) - f;
        float r = size * (0.35 + 0.65 * h.y * h.y);
        float s = 1.0 - smoothstep(r * (1.0 - soft), r, length(o));
        best = max(best, s * (0.65 + 0.35 * h.z));
      }
    }
  }
  return best;
}
`;

/**
 * A shell's colour, stored as the square root of linear colour so dark shells keep their
 * steps in eight bits.
 */
export const SHELL_BAKE = /* glsl */ `
${NOISE_GLSL}
${EQ_GLSL}
${SPOTS_GLSL}
uniform vec3 uBase;
uniform vec3 uMottle;
uniform vec3 uSpeck;
uniform vec3 uFleck;
uniform float uMottleAmt;
uniform float uSpeckAmt;
uniform float uSpeckScale;
uniform float uSpeckSize;
uniform float uFleckAmt;
uniform float uCapBias;
uniform float uGrain;
uniform vec3 uSeed;
varying vec2 vUv;
void main() {
  vec3 d = eqDir(vUv);
  vec3 p = d + uSeed;
  float m = fbm(p * 2.2, 5);
  float m2 = fbm(p * 8.0 + 4.0, 4);
  float mott = clamp(smoothstep(0.32, 0.72, m) * uMottleAmt + (m2 - 0.5) * 0.5 * uMottleAmt, 0.0, 1.0);
  vec3 col = mix(uBase, uMottle, mott);
  // The pores and the fine unevenness of the surface; pores crowd towards the blunt end.
  float pores = mix(0.75, 1.25, smoothstep(-0.8, 0.8, d.y));
  col *= 1.0 + pores * uGrain * (vnoise(d * 300.0 + uSeed * 7.0) - 0.5) + 0.6 * uGrain * (vnoise(d * 80.0 - uSeed) - 0.5);
  // Speckles, often thicker towards the blunt end.
  float bias = mix(1.0, 0.35 + 1.3 * smoothstep(-0.5, 0.95, d.y), uCapBias);
  vec3 q = d * uSpeckScale + uSeed * 3.0;
  q += 0.22 * vec3(vnoise(q * 2.7), vnoise(q * 2.7 + 11.0), vnoise(q * 2.7 + 23.0));
  float sp = spots(q, uSpeckAmt * bias, uSpeckSize, 0.4);
  float sp2 = spots(q * 2.7 + 7.0, uSpeckAmt * bias, uSpeckSize, 0.55) * 0.85;
  col = mix(col, uSpeck, max(sp, sp2));
  float fl = spots(d * 75.0 + uSeed * 5.0, uFleckAmt, 0.3, 0.6);
  col = mix(col, uFleck, fl * 0.55);
  gl_FragColor = vec4(sqrt(max(col, 0.0)), 1.0);
}
`;

/**
 * The chick's down, in the chick's frame, flowing from the crown down and back: fine fibres,
 * the clumps it falls into when wet, tufts, and a broad unevenness. Each is noise averaged
 * along the flow, which leaves streaks.
 */
export const DOWN_BAKE = /* glsl */ `
${NOISE_GLSL}
${EQ_GLSL}
uniform vec3 uCrown;
varying vec2 vUv;
vec3 rotAbout(vec3 v, vec3 a, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
}
float streaks(vec3 p, vec3 axis, float freq, float len, vec3 off) {
  float s = 0.0;
  for (int k = -6; k <= 6; k++) {
    float w = 1.0 - abs(float(k)) / 7.0;
    s += w * vnoise(rotAbout(p, axis, float(k) / 6.0 * len) * freq + off);
  }
  return s / 7.0;
}
void main() {
  vec3 p = eqDir(vUv);
  vec3 a = cross(uCrown, p);
  float la = length(a);
  vec3 axis = la > 1e-5 ? a / la : vec3(1.0, 0.0, 0.0);
  float fine = streaks(p, axis, 150.0, 0.03, vec3(0.0));
  float clump = streaks(p, axis, 26.0, 0.15, vec3(29.0));
  // Dry down is soft tufts more than strands: noise that is only a little drawn out.
  float tuft = 0.6 * streaks(p, axis, 36.0, 0.035, vec3(13.0)) + 0.4 * vnoise(p * 90.0 + 5.0);
  float broad = fbm(p * 3.0 + 41.0, 4);
  fine = clamp(0.5 + (fine - 0.5) * 3.0, 0.0, 1.0);
  tuft = clamp(0.5 + (tuft - 0.5) * 2.2, 0.0, 1.0);
  clump = clamp(0.5 + (clump - 0.5) * 2.7, 0.0, 1.0);
  gl_FragColor = vec4(fine, clump, tuft, broad);
}
`;
