/**
 * The water every material in the wall's tank is seen through, as GLSL shared by their shaders.
 * Positions are venue metres; the front glass is the plane z = 0 and the eye stands in the room
 * at +z, so the line of sight runs through air to the glass and through water after it.
 *
 * The surface seen from below the waterline through the front glass is a mirror for every line
 * of sight that reaches it (the angle is always past total internal reflection's 49 degrees), so
 * everything near the surface shows again upside down above it: each mesh draws a second copy
 * reflected in the surface plane, rippled as the surface ripples, kept only where the line of
 * sight really meets the surface inside the tank.
 *
 * Light comes from a lamp over the tank, through the rippling surface: caustics play over
 * everything, it dims with depth, and where the water holds fine particles it shows as shafts.
 * Water between the glass and a thing veils it in the water's own lit colour.
 */
import { LOOP_SECONDS } from "./shaders";

const TIME = /* glsl */ `
uniform float uTime;
const float LOOP = ${LOOP_SECONDS.toFixed(1)};
float cyc(float k) {
  return uTime * (6.283185307 / LOOP) * k;
}
float drift(float k) {
  return uTime * (k / LOOP);
}
`;

/** Slopes of the water's surface at (x, z): a few travelling waves and the bubbles' rings. */
const RIPPLE = /* glsl */ `
uniform vec3 uBubbler;
vec2 surfaceSlope(vec2 p) {
  vec2 g = vec2(0.0);
  g += vec2(0.9, 0.4) * 0.018 * cos(dot(vec2(0.9, 0.4), p) * 2.1 - cyc(377.0));
  g += vec2(-0.5, 0.85) * 0.015 * cos(dot(vec2(-0.5, 0.85), p) * 2.9 - cyc(491.0) + 1.3);
  g += vec2(0.7, -0.7) * 0.011 * cos(dot(vec2(0.7, -0.7), p) * 4.3 - cyc(673.0) + 2.9);
  g += vec2(-0.95, -0.3) * 0.008 * cos(dot(vec2(-0.95, -0.3), p) * 6.1 - cyc(911.0) + 0.4);
  vec2 d = p - uBubbler.xz;
  float r = length(d) + 1e-3;
  g += d / r * 0.05 * cos(r * 9.0 - cyc(4021.0)) * exp(-r * 0.7);
  return g;
}
`;

/** For every vertex shader in the tank. */
export const TANK_VERT = /* glsl */ `
${TIME}
uniform float uWater;
${RIPPLE}
/**
 * A point, or its reflection in the surface for the mirrored copy (m = 1). The reflection
 * wobbles with the surface where the line of sight meets it.
 */
vec3 mirrored(vec3 p, float m) {
  if (m < 0.5) return p;
#ifdef DEPTH_PASS
  // Reflections cast no shadows: fold them away to nothing.
  return vec3(0.0, -1000.0, 0.0);
#endif
  vec3 q = vec3(p.x, 2.0 * uWater - p.y, p.z);
  vec3 d = q - cameraPosition;
  float s = d.y > 1e-4 ? (uWater - cameraPosition.y) / d.y : 0.0;
  vec2 c = cameraPosition.xz + d.xz * clamp(s, 0.0, 1.0);
  vec2 g = surfaceSlope(c);
  float h = q.y - uWater;
  q.xz += g * h * 2.0;
  q.y += dot(g, g) * h;
  return q;
}
`;

/** For every fragment shader in the tank. */
export const TANK_FRAG = /* glsl */ `
${TIME}
uniform float uWater;
uniform vec4 uBox;
uniform highp sampler3D uCaustic;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFogK;
uniform vec3 uLight;
uniform vec3 uSun;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uShafts;
uniform vec4 uRafts[2];
uniform sampler2D uGroundMap;
uniform vec4 uMaps;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec2 uShadowTexel;
uniform float uShadowOn;
${RIPPLE}

/** Set by a shader before lighting, to darken the lamp's light further. */
float gShadow = 1.0;

const vec2 POISSON[8] = vec2[8](
  vec2(-0.613, 0.617), vec2(0.17, -0.04), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.087), vec2(0.421, -0.645), vec2(-0.105, 0.272), vec2(0.887, -0.123)
);

/**
 * How much of the lamp's light reaches p past everything in the tank, from the shadow map,
 * softened over a few taps. Light under water is partly diffuse, so shadows are never black.
 */
float lampShadow(vec3 p, float soft) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s = uShadowMatrix * vec4(p, 1.0);
  vec3 q = s.xyz / s.w;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 1.0;
  float lit = 0.0;
  float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  mat2 r = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  for (int i = 0; i < 8; i++) {
    float d = texture(uShadowMap, q.xy + r * POISSON[i] * uShadowTexel * soft).r;
    lit += q.z - 0.0015 > d ? 0.0 : 1.0;
  }
  return mix(0.3, 1.0, lit / 8.0);
}

/** One tap of the shadow map, for light shafts. */
float lampShadow1(vec3 p) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s = uShadowMatrix * vec4(p, 1.0);
  vec3 q = s.xyz / s.w;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 1.0;
  return q.z - 0.002 > texture(uShadowMap, q.xy).r ? 0.0 : 1.0;
}

vec2 mapUV(vec3 p) {
  return vec2((p.x - uMaps.x) * uMaps.z, (p.z - uMaps.y) * uMaps.w);
}

/** The baked ground map under p: shade from things round it (r), litter (g), noise (b). */
vec4 groundAt(vec3 p) {
  return texture(uGroundMap, mapUV(p));
}

/** Water between the front glass and p along the line of sight. */
float waterPath(vec3 eye, vec3 p) {
  if (p.z >= 0.0) return 0.0;
  float s = eye.z / max(eye.z - p.z, 1e-4);
  return (1.0 - s) * length(p - eye);
}

/** A mirrored copy shows only where the line of sight meets the surface inside the tank. */
bool inMirror(vec3 eye, vec3 seen) {
  vec3 d = seen - eye;
  if (d.y <= 1e-5 || seen.y <= uWater) return false;
  float s = (uWater - eye.y) / d.y;
  vec3 c = eye + d * s;
  return c.z < -0.002 && c.z > uBox.z && c.x > uBox.x && c.x < uBox.y;
}

/**
 * Whether something above the water can be seen from the eye: only through the glass above the
 * waterline, since from below the surface is a mirror.
 */
bool aboveSeen(vec3 eye, vec3 p) {
  if (p.y <= uWater || p.z >= 0.0) return true;
  float s = eye.z / max(eye.z - p.z, 1e-4);
  return eye.y + (p.y - eye.y) * s > uWater;
}

vec3 eyeFor(vec3 eye, float m) {
  return vec3(eye.x, mix(eye.y, 2.0 * uWater - eye.y, m), eye.z);
}

/** Shade under the floating plants, 0 open to 1 under a raft. */
float raftShade(vec2 p) {
  float k = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 r = uRafts[i];
    float d = length((p - r.xy) * vec2(1.0, 1.3)) / max(r.z, 1e-3);
    k = max(k, smoothstep(1.0, 0.55, d) * r.w);
  }
  return k;
}

/** The light that comes through the surface, followed back up to it along the light. */
vec2 toSurface(vec3 p) {
  return p.xz + uLight.xz / max(uLight.y, 0.3) * (uWater - p.y);
}

float causticAt(vec3 p) {
  vec2 at = toSurface(p);
  float a = texture(uCaustic, vec3(at * 0.62 + vec2(drift(23.0), drift(13.0)), drift(160.0))).r;
  float b = texture(uCaustic, vec3(at.yx * 0.91 + vec2(-drift(19.0), drift(29.0)) + 0.37, drift(120.0))).r;
  float c = (a * 0.55 + b * 0.45) * 4.0;
  // Sharp near the surface, softer further down as the lines spread.
  float depth = clamp((uWater - p.y) / 4.0, 0.0, 1.0);
  return mix(c, 1.0 + (c - 1.0) * 0.5, depth);
}

/** Lamp light left at p after the water above it and the floating plants. */
float sunAt(vec3 p) {
  return exp(-0.16 * max(0.0, uWater - p.y)) * gShadow;
}

vec3 lit(vec3 albedo, vec3 n, vec3 p, vec3 v, float gloss, float shine, float caust) {
  float sun = sunAt(p) * lampShadow(p + n * 0.04, 2.5);
  float c = mix(1.0, causticAt(p), caust);
  // Light under water comes mostly from above but is scattered: a soft, wide terminator.
  float wrap = max((dot(n, uLight) + 0.55) / 1.55, 0.0);
  wrap *= wrap;
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 col = albedo * (amb + uSun * sun * wrap * c);
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), gloss) * shine;
  return col + uSun * sun * spec * (0.5 + 0.5 * c);
}

float hash13(vec3 p) {
  uvec3 q = uvec3(ivec3(p) + 65536);
  uint h = (q.x * 73856093u) ^ (q.y * 19349663u) ^ (q.z * 83492791u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

/**
 * Fine relief on a surface from a height h worked out per pixel (bump mapping without a
 * texture: the height's change across the screen tilts the normal). k scales the relief.
 */
vec3 bumped(vec3 n, vec3 p, float h, float k) {
  vec3 dpx = dFdx(p);
  vec3 dpy = dFdy(p);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 b = abs(det) * n - k * grad;
  return dot(b, b) > 1e-20 ? normalize(b) : n;
}

/** A normal from a varying that may have come out zero where a mesh folds. */
vec3 unit(vec3 n) {
  return dot(n, n) > 1e-12 ? normalize(n) : vec3(0.0, 1.0, 0.0);
}

/** A two-sided mesh's normal towards the eye, whether drawn as itself or reflected. */
vec3 facing(vec3 n, float mirror) {
  bool front = gl_FrontFacing;
  if (mirror > 0.5) front = !front;
  return front ? n : -n;
}

/** Layered value noise. */
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise3(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return s;
}

/** The water's own colour where light scatters in it: brighter up near the lamp. */
vec3 waterTint(float y) {
  float k = clamp((y - uBox.w) / max(uWater - uBox.w, 1e-3), 0.0, 1.0);
  return mix(uDeep, uShallow, k * k);
}

/** Light shafts: lamp light scattered towards the eye along the line of sight through water. */
float shaftsAlong(vec3 eye, vec3 seen) {
  if (seen.z >= 0.0) return 0.0;
  float s0 = eye.z / max(eye.z - seen.z, 1e-4);
  vec3 a = eye + (seen - eye) * s0;
  // Interleaved gradient noise spreads the samples evenly between neighbouring pixels.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sum = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 q = mix(a, seen, (float(i) + jitter) / 6.0);
    if (q.y > uWater) continue;
    vec2 at = toSurface(q);
    float b = texture(uCaustic, vec3(at * 0.11 + vec2(drift(7.0), drift(-5.0)), drift(40.0))).r * 4.0;
    b = pow(clamp(b * 0.8, 0.0, 3.0), 1.6);
    float fade = exp(-0.3 * (uWater - q.y));
    sum += b * fade * (1.0 - 0.85 * raftShade(at)) * lampShadow1(q);
  }
  return sum / 6.0;
}

/** Veil col at seen (its real height y) in the water between it and the eye. */
vec3 underwater(vec3 col, vec3 eye, vec3 seen, float y) {
  float path = waterPath(eye, seen);
  float f = 1.0 - exp(-uFogK * path);
  vec3 tint = waterTint(min(y, uWater));
  col = mix(col, tint, f);
  if (uShafts > 0.0) col += uSun * uShafts * shaftsAlong(eye, seen) * min(path, 4.0) * 0.022;
  return col;
}

/** How much of a thing at p still shows through the water, for things that add light. */
float clarity(vec3 eye, vec3 seen) {
  return exp(-uFogK * waterPath(eye, seen));
}
`;

/**
 * The last lines of every tank fragment shader. The scene is drawn in linear light into a
 * floating-point target, and `post.ts` tone maps it.
 */
export const TANK_OUT = /* glsl */ `
  #include <colorspace_fragment>
`;
