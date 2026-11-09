/**
 * Shaders for everything in the bowl. Positions are in bowl space (radius 1, centre at the
 * origin); each mesh's model matrix scales that to venue metres.
 *
 * The underside of the water's surface is a mirror for anyone looking up through it at a slant
 * (total internal reflection), so things near the surface show again upside down above it.
 * Every mesh draws a second copy reflected in the surface plane, and that copy shows only
 * where the line of sight really passes up through the surface inside the bowl.
 *
 * Water: everything fades towards the water's colour with the length of water between the
 * glass and it, and the colour lightens towards the surface. Light comes from above, through
 * the ripples, as a moving pattern of caustics, dimmer with depth.
 */

/**
 * Seconds before shader time starts again. Every shader rate is a whole number of cycles in
 * this loop (`cyc`, `drift`), so the wrap is seamless and time keeps its precision for days.
 */
export const LOOP_SECONDS = 2400;

const TIME = /* glsl */ `
uniform float uTime;
const float LOOP = ${LOOP_SECONDS.toFixed(1)};
/** An angle that turns k times a loop. */
float cyc(float k) {
  return uTime * (6.283185307 / LOOP) * k;
}
/** A distance that grows by k a loop. */
float drift(float k) {
  return uTime * (k / LOOP);
}
`;

/** For every vertex shader. */
export const VERT_COMMON = /* glsl */ `
${TIME}
uniform float uWater;
vec3 mirrored(vec3 p, float m) {
  return vec3(p.x, mix(p.y, 2.0 * uWater - p.y, m), p.z);
}
`;

/** For every fragment shader. */
export const FRAG_COMMON = /* glsl */ `
${TIME}
uniform float uWater;
uniform vec3 uCentre;
uniform float uRadius;
uniform highp sampler3D uCaustic;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFogK;
uniform vec3 uLight;
uniform vec3 uSun;
uniform vec3 uSky;
uniform vec3 uGround;

vec3 eyeInBowl() {
  return (cameraPosition - uCentre) / uRadius;
}

/** Water between where the line of sight enters the ball and p. */
float waterPath(vec3 eye, vec3 p) {
  vec3 d = p - eye;
  float l = length(d);
  d /= l;
  float b = dot(eye, d);
  float h = b * b - (dot(eye, eye) - 1.0);
  float tin = h > 0.0 ? -b - sqrt(h) : 0.0;
  return max(0.0, l - max(tin, 0.0));
}

vec3 waterTint(float y) {
  float k = smoothstep(-1.0, uWater, y);
  return mix(uDeep, uShallow, k * k);
}

vec3 underwater(vec3 col, vec3 eye, vec3 seen, float y) {
  float f = 1.0 - exp(-uFogK * waterPath(eye, seen));
  return mix(col, waterTint(y), f);
}

/** How much of a thing at p still shows through the water, for things that add light. */
float clarity(vec3 eye, vec3 seen) {
  return exp(-uFogK * waterPath(eye, seen));
}

/** A reflected copy shows only where the line of sight rises through the surface in the bowl. */
bool inMirror(vec3 eye, vec3 seen) {
  vec3 d = seen - eye;
  if (d.y <= 1e-5 || eye.y >= uWater) return false;
  float s = (uWater - eye.y) / d.y;
  if (s <= 0.0 || s >= 1.0) return false;
  vec2 c = eye.xz + d.xz * s;
  return dot(c, c) < (1.0 - uWater * uWater) * 0.995;
}

/** The eye as the reflected copy is lit from: mirrored in the surface. */
vec3 eyeFor(vec3 eye, float m) {
  return vec3(eye.x, mix(eye.y, 2.0 * uWater - eye.y, m), eye.z);
}

float causticAt(vec3 p) {
  vec2 at = p.xz + uLight.xz / max(uLight.y, 0.3) * (uWater - p.y);
  float a = texture(uCaustic, vec3(at * 1.1 + vec2(drift(31.0), drift(17.0)), drift(200.0))).r;
  float b = texture(uCaustic, vec3(at.yx * 1.55 + vec2(-drift(26.0), drift(41.0)) + 0.37, drift(150.0))).r;
  return (a * 0.55 + b * 0.45) * 4.0;
}

/** Sunlight left at height y after coming down through the water. */
float sunAt(float y) {
  return exp(-0.6 * max(0.0, uWater - y));
}

vec3 lit(vec3 albedo, vec3 n, vec3 p, vec3 v, float gloss, float shine, float caust) {
  float sun = sunAt(p.y);
  float c = mix(1.0, causticAt(p), caust);
  float diff = max(dot(n, uLight), 0.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 col = albedo * (amb + uSun * sun * diff * c);
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), gloss) * shine;
  return col + uSun * sun * spec * (0.6 + 0.4 * c);
}

/** A value from 0 to 1 for a lattice point: the spatial-hash primes, then a few rounds of mixing. */
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
`;

/** Part ids in the fish geometry's `aCoord.z`. */
export const PART = {
  body: 0,
  fin: 1,
  tail: 2,
  pectoral: 3,
  eye: 4,
  barbel: 5,
  thread: 6,
} as const;

export const SNAIL_VERT = /* glsl */ `
${VERT_COMMON}
attribute vec4 aPart;
attribute vec4 aSnail;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying vec4 vPart;
varying vec4 vSnail;
void main() {
  vec3 p = position;
  // Tentacles sway; the head rocks as the mouth rasps.
  if (aPart.x > 2.5) {
    p.z += sin(cyc(497.0) + aPart.y * 6.0) * aPart.y * 0.04;
    p.y += sin(cyc(344.0) + aPart.w) * aPart.y * 0.02;
  }
  vec4 local = instanceMatrix * vec4(p, 1.0);
  vReal = local.xyz;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vSeen = mirrored(vReal, aSnail.z);
  vRest = position;
  vPart = aPart;
  vSnail = aSnail;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const SNAIL_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying vec4 vPart;
varying vec4 vSnail;
void main() {
  vec3 eye = eyeInBowl();
  if (vSnail.z > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vSnail.z) - vReal);
  vec3 n = normalize(vNormal);
  vec3 albedo;
  float gloss = 30.0;
  float shine = 0.3;
  float speck = noise3(vRest * 60.0);
  if (vPart.x < 0.5) {
    // The sole pressed on the glass: pale, with waves running forward along it.
    float waves = 0.5 + 0.5 * sin((vRest.x * 9.0 - vSnail.x * 6.2832) * 3.0);
    albedo = mix(vec3(0.42, 0.38, 0.33), vec3(0.3, 0.27, 0.23), waves * smoothstep(0.42, 0.2, abs(vRest.z)));
    float rim = smoothstep(0.17, 0.22, abs(vRest.z) / max(0.3, 1.0 - abs(vRest.x) * 1.2));
    albedo = mix(albedo, vec3(0.2, 0.18, 0.15), rim * 0.6);
    // The mouth at the front, rasping on the glass.
    float m = length((vRest.xz - vec2(0.42, 0.0)) * vec2(1.0, 1.4));
    albedo = mix(albedo, vec3(0.12, 0.05, 0.04), smoothstep(0.035 + vSnail.y * 0.03, 0.02, m));
    gloss = 80.0;
    shine = 0.6;
  } else if (vPart.x < 1.5) {
    albedo = mix(vec3(0.32, 0.29, 0.25), vec3(0.18, 0.15, 0.12), speck);
  } else if (vPart.x < 2.5) {
    // The shell: golden brown with dark spiral bands.
    float turn = atan(vRest.z, vRest.y - 0.36) + vPart.y * 9.0;
    float band = smoothstep(0.7, 0.85, sin(turn * 3.0 + vPart.y * 20.0));
    albedo = mix(vec3(0.5, 0.32, 0.12), vec3(0.26, 0.13, 0.05), band * 0.7);
    albedo *= 0.85 + 0.3 * speck;
    gloss = 50.0;
    shine = 0.5;
  } else {
    albedo = mix(vec3(0.3, 0.27, 0.23), vec3(0.02), step(0.9, vPart.y));
  }
  vec3 col = lit(albedo, n, vReal, v, gloss, shine, 0.5);
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const PEBBLE_VERT = /* glsl */ `
${VERT_COMMON}
attribute vec4 aShape;
attribute vec4 aTone;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying vec4 vTone;
varying float vMirror;
varying float vRound;
void main() {
  // A lumpy round pebble: a sphere with two gentle bumps, stretched to its shape.
  vec3 p0 = position;
  float bump = 1.0 + 0.1 * sin(dot(p0, vec3(3.1, 1.7, 2.3)) + aTone.w * 40.0)
             + 0.06 * sin(dot(p0, vec3(-2.2, 3.4, 1.1)) + aTone.w * 17.0);
  vec3 p = p0 * bump * aShape.xyz;
  vec3 n = normalize(normal / aShape.xyz);
  vec4 local = instanceMatrix * vec4(p, 1.0);
  vReal = local.xyz;
  vNormal = normalize(mat3(instanceMatrix) * n);
  vMirror = aShape.w;
  vSeen = mirrored(vReal, vMirror);
  vRest = p0 + aTone.w * 13.0;
  vTone = aTone;
  vRound = abs(normal.y);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const PEBBLE_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying vec4 vTone;
varying float vMirror;
varying float vRound;
void main() {
  vec3 eye = eyeInBowl();
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  float grain = noise3(vRest * 9.0) * 0.6 + noise3(vRest * 31.0) * 0.4;
  // Darker towards the rim, where pebbles touch and shade each other.
  vec3 albedo = vTone.rgb * (0.75 + 0.5 * grain) * mix(0.35, 1.0, smoothstep(0.05, 0.75, vRound));
  vec3 col = lit(albedo, n, vReal, v, 24.0, 0.18, 0.85);
  // Seen from below through the glass, light filters down between the stones and dapples them.
  float under = smoothstep(0.0, -0.8, n.y);
  float dapple = causticAt(vReal * 1.7 + vec3(0.0, 0.0, 0.3));
  col += vTone.rgb * uSun * under * (0.05 + 0.16 * dapple * dapple);
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const BED_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
void main() {
  vec3 eye = eyeInBowl();
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 n = normalize(vNormal);
  float grain = noise3(vReal * 90.0);
  vec3 albedo = mix(vec3(0.07, 0.055, 0.04), vec3(0.16, 0.13, 0.1), grain);
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 col = lit(albedo, n, vReal, v, 8.0, 0.0, 0.9);
  // Light that finds its way down through the gaps, seen from underneath.
  float c = causticAt(vReal * 1.7);
  col += vec3(0.35, 0.42, 0.32) * uSun * 0.12 * c * c * smoothstep(0.0, -0.6, n.y);
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** For meshes drawn as a real copy and a reflected copy by instance. */
export const PLAIN_VERT = /* glsl */ `
${VERT_COMMON}
attribute float aMirror;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
void main() {
  vReal = position;
  vNormal = normal;
  vMirror = aMirror;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const DECOR_VERT = /* glsl */ `
${VERT_COMMON}
attribute float aMirror;
attribute vec4 aMat;
attribute vec3 aColour;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying vec4 vMat;
varying vec3 vColour;
void main() {
  vReal = position;
  vNormal = normal;
  vMirror = aMirror;
  vMat = aMat;
  vColour = aColour;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const DECOR_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying vec4 vMat;
varying vec3 vColour;
void main() {
  vec3 eye = eyeInBowl();
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  float grain = noise3(vReal * 40.0 + vMat.y * 10.0) * 0.6 + noise3(vReal * 140.0) * 0.4;
  vec3 albedo = vColour * (0.8 + 0.4 * grain);
  // The pot's inside is in shadow.
  albedo *= mix(1.0, 0.35, vMat.z);
  vec3 col = lit(albedo, n, vReal, v, vMat.x > 0.5 ? 70.0 : 20.0, vMat.x > 0.5 ? 0.5 : 0.12, 0.85);
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const PLANT_VERT = /* glsl */ `
${VERT_COMMON}
attribute vec4 aLeaf;
attribute float aMirror;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vLeaf;
varying float vMirror;
void main() {
  float t = aLeaf.x;
  float amp = aLeaf.w > 0.5 ? 0.03 : 0.075;
  float k = pow(t, 1.5) * amp;
  vec3 sway = vec3(
    sin(cyc(210.0) + aLeaf.z + t * 1.6) + 0.4 * sin(cyc(500.0) + aLeaf.z * 2.0),
    0.0,
    cos(cyc(164.0) + aLeaf.z * 1.3 + t * 1.2)
  ) * k;
  vReal = position + sway;
  vNormal = normal;
  vMirror = aMirror;
  vLeaf = aLeaf;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const PLANT_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vLeaf;
varying float vMirror;
void main() {
  vec3 eye = eyeInBowl();
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  float back = dot(n, v) < 0.0 ? 1.0 : 0.0;
  if (back > 0.5) n = -n;
  float t = vLeaf.x;
  float across = abs(vLeaf.y);
  vec3 base = vLeaf.w > 0.5 ? vec3(0.07, 0.25, 0.05) : vec3(0.1, 0.3, 0.06);
  vec3 tip = vLeaf.w > 0.5 ? vec3(0.16, 0.42, 0.09) : vec3(0.22, 0.45, 0.1);
  vec3 albedo = mix(base, tip, t);
  albedo *= 0.85 + 0.25 * noise3(vec3(vLeaf.z * 7.0, t * 14.0, across * 3.0));
  // The midrib and a paler edge.
  albedo = mix(albedo, albedo * 1.6, smoothstep(0.18, 0.0, across) * 0.5);
  albedo = mix(albedo, albedo * 0.7, smoothstep(0.7, 1.0, across));
  vec3 col = lit(albedo, n, vReal, v, 24.0, 0.15, 0.6);
  // Leaves glow green with the light coming through them from above.
  col += albedo * uSun * sunAt(vReal.y) * max(dot(-n, uLight), 0.0) * 0.6;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const BUBBLE_VERT = /* glsl */ `
${VERT_COMMON}
attribute vec4 aBubble;
uniform vec3 uColumn;
uniform float uRise;
uniform float uPeriod;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying float vLife;
void main() {
  float age = fract(drift(LOOP / uPeriod) + aBubble.x) * uPeriod;
  float size = aBubble.y * (1.0 + age * 0.04);
  float y = uColumn.y + age * uRise;
  // A rising bubble wobbles and drifts outward with the current.
  vec3 c = vec3(uColumn.x, y, uColumn.z);
  c.xz *= 1.0 + age * 0.05;
  c.x += sin(age * 5.0 + aBubble.z * 6.0) * 0.012 * min(age, 1.0);
  c.z += cos(age * 4.3 + aBubble.z * 9.0) * 0.012 * min(age, 1.0);
  float gone = step(uWater - size * 0.5, y);
  vec3 squash = vec3(1.0 + 0.15 * sin(age * 11.0 + aBubble.z * 3.0), 0.85, 1.0);
  vReal = c + position * size * squash * (1.0 - gone);
  vNormal = normal;
  vMirror = aBubble.w;
  vLife = 1.0 - gone;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const BUBBLE_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying float vLife;
void main() {
  if (vLife < 0.5) discard;
  vec3 eye = eyeInBowl();
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  float facing = abs(dot(n, v));
  float rim = pow(1.0 - facing, 2.5);
  vec3 h = normalize(uLight + v);
  float spark = pow(max(dot(n, h), 0.0), 120.0);
  vec3 col = (uShallow * 2.0 + vec3(0.08)) * rim * 0.9 + uSun * spark * 1.5;
  gl_FragColor = vec4(col * clarity(eye, vSeen), 1.0);
}
`;

export const FLAKE_VERT = /* glsl */ `
${VERT_COMMON}
attribute vec2 aFlake;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying float vTone;
varying float vMirror;
void main() {
  vec4 local = instanceMatrix * vec4(position, 1.0);
  vReal = local.xyz;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vMirror = aFlake.y;
  vSeen = mirrored(vReal, vMirror);
  vRest = position;
  vTone = aFlake.x;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

export const FLAKE_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying float vTone;
varying float vMirror;
void main() {
  vec3 eye = eyeInBowl();
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  // A ragged flake.
  float edge = noise3(vec3(vRest.xz * 6.0, vTone * 20.0));
  if (length(vRest.xz) > 0.35 + 0.25 * edge) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 albedo = vTone < 0.4 ? vec3(0.7, 0.28, 0.06) : vTone < 0.7 ? vec3(0.55, 0.42, 0.18) : vec3(0.25, 0.4, 0.1);
  vec3 col = lit(albedo, n, vReal, v, 10.0, 0.05, 0.5) + albedo * 0.15;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SPECK_VERT = /* glsl */ `
${VERT_COMMON}
attribute vec4 aSpeck;
uniform float uPointScale;
uniform float uGravel;
varying float vFade;
varying vec3 vSeen;
void main() {
  // Each speck drifts on slow currents and sinks; it fades out low and back in high.
  vec3 p = position + 0.04 * vec3(sin(cyc(aSpeck.w) + aSpeck.x), 0.0, cos(cyc(aSpeck.w * 0.75) + aSpeck.y));
  float span = uWater - 0.05 - uGravel;
  float drop = fract(position.y - drift(aSpeck.z)) * span;
  p.y = uGravel + drop;
  float r = length(p);
  if (r > 0.98) p *= 0.98 / r;
  vFade = smoothstep(0.0, 0.1, drop / span) * smoothstep(1.0, 0.85, drop / span);
  vSeen = p;
  vec4 view = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uPointScale * (0.6 + fract(aSpeck.x)) / -view.z, 1.0, 6.0);
  gl_Position = projectionMatrix * view;
}
`;

export const SPECK_FRAG = /* glsl */ `
${FRAG_COMMON}
varying float vFade;
varying vec3 vSeen;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(q)) * vFade;
  vec3 eye = eyeInBowl();
  vec3 col = (uShallow * 1.4 + vec3(0.05, 0.05, 0.04)) * a * clarity(eye, vSeen) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SURFACE_VERT = /* glsl */ `
${VERT_COMMON}
uniform float uDisc;
varying vec3 vReal;
void main() {
  vReal = vec3(position.x * uDisc, uWater, position.z * uDisc);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vReal, 1.0);
}
`;

/**
 * The water's surface seen from below. Through a window overhead the room's light comes
 * straight in; at a slant the surface is a mirror (what lies behind it in the frame is the
 * reflected copy of the bowl), with a silver sheen from the ripples.
 */
export const SURFACE_FRAG = /* glsl */ `
${FRAG_COMMON}
uniform vec3 uColumn;
varying vec3 vReal;

vec2 slope(vec2 p) {
  vec2 g = vec2(0.0);
  vec3 w[5];
  w[0] = vec3(9.0, 4.0, 420.0);
  w[1] = vec3(-6.0, 11.0, 535.0);
  w[2] = vec3(14.0, -9.0, 726.0);
  w[3] = vec3(-17.0, -5.0, 878.0);
  w[4] = vec3(5.0, 21.0, 1070.0);
  for (int i = 0; i < 5; i++) {
    float a = 0.0045 / (1.0 + float(i) * 0.6);
    float ph = dot(w[i].xy, p) - cyc(w[i].z) + float(i) * 1.7;
    g += w[i].xy * a * cos(ph);
  }
  // Rings spreading from where the bubbles burst.
  vec2 d = p - uColumn.xz * 1.12;
  float r = length(d) + 1e-4;
  float ring = 0.003 * cos(r * 70.0 - cyc(3438.0)) * exp(-r * 9.0) * 70.0;
  g += d / r * ring;
  return g;
}

void main() {
  vec3 eye = eyeInBowl();
  vec3 d = normalize(vReal - eye);
  vec2 g = slope(vReal.xz);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float cosI = max(dot(d, n), 0.0);
  float sinI2 = 1.0 - cosI * cosI;
  float k = 1.0 - 1.777 * sinI2;
  float R = 1.0;
  if (k > 0.0) {
    float cosT = sqrt(k);
    R = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  }
  vec3 sky = vec3(0.55, 0.6, 0.58) * (0.6 + 0.4 * cosI);
  float glint = 0.5 + 0.5 * dot(n.xz, vec2(0.8, 0.6)) * 30.0;
  vec3 silver = vec3(0.05, 0.07, 0.075) * clamp(glint, 0.2, 1.6);
  float keep = 0.9;
  vec3 own = sky * (1.0 - R) + silver * R;
  float a = 1.0 - R * keep;
  float f = 1.0 - exp(-uFogK * waterPath(eye, vReal));
  own = mix(own, waterTint(uWater) * a, f);
  gl_FragColor = vec4(own, a);
}
`;

/** The inside of the far glass, behind everything: water, or air above the waterline. */
export const SHELL_FRAG = /* glsl */ `
${FRAG_COMMON}
varying vec3 vReal;
void main() {
  vec3 eye = eyeInBowl();
  vec3 d = normalize(vReal - eye);
  float b = dot(eye, d);
  float h = max(b * b - (dot(eye, eye) - 1.0), 0.0);
  float tin = -b - sqrt(h);
  float tout = -b + sqrt(h);
  vec3 entry = eye + d * tin;
  vec3 col;
  if (entry.y < uWater) {
    float s = d.y > 1e-5 ? (uWater - eye.y) / d.y : 1e9;
    float path = s < tout ? (s - tin) + 1.4 : tout - tin;
    // The far glass is barely there behind so much water, so it differs little from the water.
    vec3 far = s < tout ? waterTint(uWater * 0.3) : waterTint(vReal.y) * 0.8;
    col = mix(far, waterTint(min(vReal.y, uWater)), 1.0 - exp(-uFogK * path));
  } else {
    // Air above the water: the far glass and the rim, dimly lit by the room.
    float rim = smoothstep(0.9, 0.93, vReal.y) * (1.0 - smoothstep(0.95, 0.98, vReal.y));
    col = vec3(0.025, 0.035, 0.04) + vec3(0.04, 0.05, 0.05) * rim;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SHELL_VERT = /* glsl */ `
varying vec3 vReal;
void main() {
  vReal = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
