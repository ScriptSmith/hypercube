/**
 * GLSL shared by the vision pictures. Each scene defines `vec3 scene(vec2 p)`: the colour (sRGB,
 * 0 to 1) at `p`, from -1 to 1 across the window with y up. The window is round and its edge
 * fades into smoke from about half way out, so what matters sits within 0.5 of the middle.
 */
import { HASH_GLSL } from "../hash";

export const VISION_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const VISION_COMMON = /* glsl */ `
${HASH_GLSL}
/** Seconds since the vision began, seconds it took to open, seconds it holds clear. */
uniform vec3 uStage;
uniform float uSeed;
/** One pixel of the picture, in picture units. */
uniform float uPx;
varying vec2 vP;

#define TAU 6.283185307
#define PI 3.141592654

float seedCell() { return floor(uSeed * 977.0); }
float rnd(float n) { return hashCell(vec2(n, 913.0 + seedCell())); }
float rnd2(vec2 c) { return hashCell(c + vec2(seedCell(), 0.0)); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = rnd2(i);
  float b = rnd2(i + vec2(1.0, 0.0));
  float c = rnd2(i + vec2(0.0, 1.0));
  float d = rnd2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    a *= 0.5;
  }
  return s / 0.97;
}

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec2(3.1, 17.9);
    a *= 0.5;
  }
  return s / 0.875;
}

/** Inside a signed distance, smoothed over a pixel. */
float fill(float d) { return 1.0 - smoothstep(-uPx, uPx, d); }
/** Inside a signed distance, smoothed over w. */
float soft(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

/** Negative to the left of the line from a to b. */
float side(vec2 p, vec2 a, vec2 b) {
  vec2 e = normalize(b - a);
  return (p.x - a.x) * e.y - (p.y - a.y) * e.x;
}

/** Inside (negative) a triangle or quadrilateral whose corners go anticlockwise. */
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  return max(max(side(p, a, b), side(p, b, c)), side(p, c, a));
}
float sdQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
  return max(max(side(p, a, b), side(p, b, c)), max(side(p, c, d), side(p, d, a)));
}

/** Roughly the distance outside an ellipse with radii r. */
float sdEllipse(vec2 p, vec2 r) {
  return (length(p / r) - 1.0) * min(r.x, r.y);
}

/** A field of small twinkling stars, about amount of the cells (scale across) holding one. */
vec3 stars(vec2 p, float scale, float amount, float t) {
  vec2 g = p * scale;
  vec2 cell = floor(g);
  if (rnd2(cell + 401.0) > amount) return vec3(0.0);
  vec2 pos = cell + 0.15 + 0.7 * vec2(rnd2(cell + 17.0), rnd2(cell + 29.0));
  float d = length(g - pos) / scale;
  // Most stars faint, a few bright.
  float mag = rnd2(cell + 53.0);
  mag = mag * mag * mag;
  float size = max(uPx * 0.7, 0.0011) * (0.8 + 1.1 * mag);
  float tw = 0.8 + 0.2 * sin(t * (0.9 + 1.8 * rnd2(cell + 71.0)) + TAU * rnd2(cell + 83.0));
  float b = exp(-d * d / (size * size)) * tw * (0.1 + 0.9 * mag);
  return mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.88, 0.72), rnd2(cell + 97.0)) * b;
}

/**
 * How far through the clear part of the vision it is: 0 as it starts to show, 1 as it starts to
 * close. Scenes time their events with it.
 */
float progress() {
  return clamp((uStage.x - uStage.y * 0.6) / max(1.0, uStage.z + uStage.y * 0.4), 0.0, 1.0);
}
`;

/** The fragment shader for one scene: its colour, as linear light, mirrored for some showings. */
export const visionFragment = (scene: string): string => /* glsl */ `
${VISION_COMMON}
${scene}
void main() {
  vec2 p = vP;
  if (uSeed > 0.5) p.x = -p.x;
  vec3 c = clamp(scene(p), 0.0, 1.0);
  gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
}
`;
