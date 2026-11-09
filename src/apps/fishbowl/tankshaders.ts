/**
 * Shaders for the tank's fixed parts: the ground and its face against the front glass, the back
 * and side glass, stones and driftwood, the surface seen from below, and the trim and waterline
 * on the front glass. Venue metres throughout; see `tankenv.ts` for the water they share.
 */
import { TANK_FRAG, TANK_OUT, TANK_VERT } from "./tankenv";

/** A mesh drawn as itself and as its reflection (`aMirror`). */
export const MIRROR_VERT = /* glsl */ `
${TANK_VERT}
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
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

export const PLAIN_VERT = /* glsl */ `
${TANK_VERT}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
void main() {
  vReal = position;
  vSeen = position;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const GROUND_FRAG = /* glsl */ `
${TANK_FRAG}
uniform vec3 uSand;
uniform vec3 uGrit;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;

/** Distance to the nearest of a scatter of grains about size across, and its own random value. */
vec2 grains(vec2 p, float size) {
  vec2 g = p / size;
  vec2 i = floor(g);
  vec2 f = fract(g);
  float best = 9.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = vec2(float(x), float(y));
      float h = hash13(vec3(i + c, 7.0));
      vec2 o = c + vec2(h, hash13(vec3(i + c, 11.0))) * 0.8 + 0.1;
      float d = length(f - o);
      if (d < best) {
        best = d;
        id = h;
      }
    }
  }
  return vec2(best, id);
}

void main() {
  vec3 eye = cameraPosition;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(eye - vReal);
  vec2 p = vReal.xz;
  vec4 map = groundAt(vReal);
  // Fine sand of mixed grains, darker and lighter in drifts.
  float fine = noise3(vec3(p * 190.0, 1.0)) * 0.45 + noise3(vec3(p * 61.0, 3.0)) * 0.35 + map.b * 0.2;
  float drifts = noise3(vec3(p * 1.3, 8.0));
  vec3 albedo = mix(uSand * 0.62, uSand * 1.08, fine) * mix(0.85, 1.1, drifts);
  float speck = step(0.83, noise3(vec3(p * 260.0, 6.0)));
  albedo = mix(albedo, uGrit * 0.6, speck * 0.7);
  // Here and there a small pebble sits in the sand.
  vec2 g = grains(p, 0.06);
  float pebble = smoothstep(0.36, 0.26, g.x) * step(0.78, g.y);
  vec3 tone = mix(uGrit, uSand * 1.15, fract(g.y * 7.0));
  albedo = mix(albedo, tone, pebble);
  albedo *= 1.0 - 0.3 * smoothstep(0.26, 0.4, g.x) * smoothstep(0.5, 0.36, g.x) * step(0.78, g.y);
  // Bits of leaf and mulm gathered under the plants and in the hollows.
  float mulm = smoothstep(0.35, 0.8, map.g * (0.6 + 0.8 * noise3(vec3(p * 9.0, 5.0))));
  albedo = mix(albedo, vec3(0.05, 0.035, 0.02), mulm * 0.65);
  float occ = map.r;
  // Grains and ripples catch the light that slants through the water.
  float relief = fine * 0.6 + drifts * 0.4 + pebble * 0.8 + 0.25 * sin(p.x * 9.0 + sin(p.y * 3.0) * 2.0);
  n = bumped(n, vReal, relief, 0.012);
  vec3 col = lit(albedo, n, vReal, v, 18.0, 0.04 + pebble * 0.2, 1.0) * mix(0.35, 1.0, occ);
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/** The ground's cut face against the front glass: grains pressed flat, darker lower down. */
export const SKIRT_FRAG = /* glsl */ `
${TANK_FRAG}
uniform vec3 uSand;
uniform vec3 uGrit;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
void main() {
  vec3 eye = cameraPosition;
  vec2 p = vReal.xy;
  float depth = clamp((uBox.w + 0.33 - vReal.y) / 0.3, 0.0, 1.0);
  // Grains pressed flat against the glass, in faint layers as the sand settled.
  float a = noise3(vec3(p * 240.0, 2.0));
  float b = noise3(vec3(p.x * 30.0, p.y * 140.0, 9.0));
  vec3 albedo = mix(uSand * 0.5, uSand * 1.0, a * 0.65 + b * 0.35);
  float speck = step(0.8, noise3(vec3(p * 300.0, 4.0)));
  albedo = mix(albedo, uGrit * 0.5, speck * 0.8);
  // Coarser gravel at the bottom, under the sand.
  vec2 gp = p * vec2(18.0, 22.0);
  float grit = smoothstep(0.55, 0.7, noise3(vec3(gp, 4.0))) * smoothstep(0.55, 0.95, depth);
  albedo = mix(albedo, uGrit * (0.55 + 0.6 * a), grit);
  // Little light reaches down through the sand to the glass.
  float light = mix(0.8, 0.22, depth);
  vec3 col = albedo * (uSky * 0.8 + uSun * 0.1) * light;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

export const PANE_VERT = /* glsl */ `
${TANK_VERT}
attribute float aMirror;
attribute float aPane;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying float vPane;
void main() {
  vReal = position;
  vNormal = normal;
  vMirror = aMirror;
  vPane = aPane;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

/**
 * The back glass, with a frosted backdrop behind it lit from above, and the side panes. Above
 * the waterline it is the dim air under the lid.
 */
export const PANE_FRAG = /* glsl */ `
${TANK_FRAG}
uniform vec3 uBackTop;
uniform vec3 uBackLow;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying float vPane;
void main() {
  vec3 eye = cameraPosition;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  if (vMirror < 0.5 && !aboveSeen(eye, vReal)) discard;
  vec3 col;
  if (vReal.y > uWater) {
    float glow = exp(-(vReal.y - uWater) * 6.0);
    col = vec3(0.012, 0.014, 0.016) + uBackTop * 0.18 * glow;
  } else {
    float h = clamp((vReal.y - uBox.w) / max(uWater - uBox.w, 1e-3), 0.0, 1.0);
    col = mix(uBackLow, uBackTop, pow(h, 1.6));
    // The backdrop's light, broken up by the plants in front of it.
    float mottle = noise3(vec3(vReal.x * 0.7, vReal.y * 0.9, 3.0));
    col *= 0.8 + 0.4 * mottle;
    col *= mix(1.0, causticAt(vReal), 0.25);
    if (vPane > 0.5) col *= 0.5;
  }
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/** Stones (aMat.x 0) and driftwood (1). */
export const HARD_VERT = /* glsl */ `
${TANK_VERT}
attribute float aMirror;
attribute vec4 aMat;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying vec4 vMat;
void main() {
  vReal = position;
  vNormal = normal;
  vMirror = aMirror;
  vMat = aMat;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

export const HARD_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying vec4 vMat;
void main() {
  vec3 eye = cameraPosition;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 n = facing(unit(vNormal), vMirror);
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 albedo;
  float gloss = 16.0;
  float shine = 0.08;
  float cavity = 0.0;
  if (vMat.x < 0.5) {
    // Stone: dark grey with a warm or cool cast, banded along its grain, pitted and veined.
    vec3 q = vReal * 1.0 + vMat.z;
    float h = fbm(q * 3.0) * 0.7 + fbm(q * 14.0) * 0.3;
    float strata = noise3(vec3(vReal.x * 0.8, vReal.y * 9.0 + vMat.z, vReal.z * 0.8));
    vec3 base = mix(vec3(0.075, 0.075, 0.075), vec3(0.11, 0.09, 0.07), vMat.y);
    albedo = base * (0.65 + 0.7 * strata) * (0.75 + 0.5 * h);
    // Thin pale veins where the rock split and healed.
    float vn = noise3(q * 2.2) - 0.5;
    float vein = smoothstep(1.2, 0.3, abs(vn) / max(fwidth(vn), 1e-4)) * smoothstep(0.5, 0.65, noise3(q * 0.9 + 4.0));
    albedo = mix(albedo, vec3(0.3, 0.3, 0.28), vein * 0.5);
    cavity = smoothstep(0.45, 0.25, h);
    n = bumped(n, vReal, h, 0.025);
    float film = smoothstep(0.35, 0.85, n.y) * smoothstep(0.4, 0.75, noise3(vReal * 3.0 + vMat.z));
    albedo = mix(albedo, vec3(0.045, 0.075, 0.025), film * 0.6);
    gloss = 30.0;
    shine = 0.12 + 0.2 * vein;
  } else {
    // Wood: dark bark in streaks along the branch, cracked, paler where worn smooth.
    float along = vMat.y * 30.0;
    float round = vMat.w * 6.2832;
    vec3 q = vec3(cos(round) * 2.0, sin(round) * 2.0, along);
    float streak = noise3(vec3(q.x * 1.5, q.y * 1.5, q.z * 0.6 + vMat.z * 9.0));
    float fine = noise3(vec3(q.x * 6.0, q.y * 6.0, q.z * 2.5));
    float h = streak * 0.6 + fine * 0.4;
    albedo = mix(vec3(0.045, 0.026, 0.014), vec3(0.15, 0.09, 0.045), h);
    float worn = smoothstep(0.6, 0.8, noise3(vReal * 2.4 + 5.0));
    albedo = mix(albedo, vec3(0.24, 0.16, 0.1), worn * 0.45);
    float crack = smoothstep(0.06, 0.0, abs(fine - 0.5));
    albedo *= 1.0 - crack * 0.6;
    cavity = crack * 0.5;
    n = bumped(n, vReal, h - crack * 0.4, 0.02);
    float film = smoothstep(0.5, 0.95, n.y) * 0.3;
    albedo = mix(albedo, vec3(0.04, 0.07, 0.025), film);
    gloss = 12.0;
    shine = 0.06;
  }
  // Near the ground, the ground's shade reaches it too.
  float low = 1.0 - smoothstep(0.0, 0.6, vReal.y - uBox.w - 0.3);
  float occ = mix(1.0, groundAt(vReal).r, low * 0.7) * mix(0.7, 1.0, smoothstep(-0.6, 0.4, n.y));
  occ *= 1.0 - 0.5 * cavity;
  vec3 col = lit(albedo, n, vReal, v, gloss, shine, 0.9) * occ;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

export const SURFACE_VERT = /* glsl */ `
${TANK_VERT}
varying vec3 vReal;
void main() {
  vReal = vec3(position.x, uWater, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vReal, 1.0);
}
`;

/**
 * The surface's underside. Every line of sight that reaches it is past the critical angle, so
 * it is a mirror: what shows through it is the reflected copy behind it. It adds only a silver
 * sheen where the ripples tilt it towards the lit water, and lets most of the mirror through.
 */
export const SURFACE_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
void main() {
  vec3 eye = cameraPosition;
  vec2 g = surfaceSlope(vReal.xz);
  float tilt = dot(g, normalize(vec2(0.3, 1.0)));
  float sheen = 0.5 + 0.5 * clamp(tilt * 12.0, -1.0, 1.0);
  vec3 silver = waterTint(uWater) * (0.6 + 1.6 * sheen * sheen) + uSun * 0.04 * sheen;
  // Under the floating plants their leaves and roots darken it.
  float raft = raftShade(vReal.xz);
  silver *= 1.0 - 0.6 * raft;
  float a = 0.16 + 0.1 * raft;
  float f = 1.0 - exp(-uFogK * waterPath(eye, vReal));
  vec3 own = mix(silver, waterTint(uWater), f) * a;
  gl_FragColor = vec4(own, a);
  #include <colorspace_fragment>
}
`;

/**
 * On the front glass: the black trim round its edges and the bright line of the meniscus where
 * the water meets it. `aTrim.x` is 1 for trim and 0 for the meniscus.
 */
export const GLASS_VERT = /* glsl */ `
attribute vec2 aTrim;
varying vec2 vTrim;
varying vec3 vReal;
void main() {
  vTrim = aTrim;
  vReal = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const GLASS_FRAG = /* glsl */ `
uniform float uWater;
uniform vec3 uSun;
varying vec2 vTrim;
varying vec3 vReal;
void main() {
  vec3 col;
  float a = 1.0;
  if (vTrim.x > 0.5) {
    // Satin black, a touch lighter along its inner edge.
    col = vec3(0.006, 0.007, 0.008) + vec3(0.02) * smoothstep(0.75, 1.0, vTrim.y);
  } else {
    float d = (vReal.y - uWater) / 0.018;
    float line = exp(-d * d * 2.0);
    float above = smoothstep(0.0, 1.5, d) * 0.12;
    col = uSun * (0.32 * line + above * 0.2);
    a = clamp(line + above, 0.0, 1.0);
    col = col / max(a, 1e-3);
  }
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** Plants: swayed by the current, more the higher up a flexible plant; mirrored when tall. */
export const plantVert = (mirror: boolean) => /* glsl */ `
${TANK_VERT}
attribute vec4 aLeaf;
attribute vec4 aSway;
${mirror ? "attribute float aMirror;" : ""}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vLeaf;
varying float vMirror;
void main() {
  float h = aSway.x;
  float span = max(aSway.y, 0.2);
  float k = aSway.z * pow(clamp(h / span, 0.0, 1.6), 1.5) * sqrt(span) * 0.16;
  vec3 p = position;
  float ph = aSway.w;
  vec3 current = vec3(
    0.35 + 0.6 * sin(cyc(131.0) + p.x * 0.33 + ph) + 0.3 * sin(cyc(347.0) + p.x * 0.9 + ph * 1.7),
    0.0,
    0.45 * cos(cyc(173.0) + p.x * 0.47 + ph)
  );
  p += current * k;
  // Leaves flutter a little on their own.
  p += normal * sin(cyc(911.0) + aLeaf.z * 40.0 + aLeaf.x * 5.0) * 0.01 * aSway.z * aLeaf.x;
  vReal = p;
  vNormal = normal;
  vLeaf = aLeaf;
  vMirror = ${mirror ? "aMirror" : "0.0"};
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

export const PLANT_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vLeaf;
varying float vMirror;

void main() {
  vec3 eye = cameraPosition;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  float t = vLeaf.x;
  float across = abs(vLeaf.y);
  float seed = vLeaf.z;
  int kind = int(vLeaf.w + 0.5);
  float own = fract(seed * 7.31 + 0.13);
  vec3 base;
  vec3 tip;
  float gloss = 20.0;
  float shine = 0.1;
  float through = 0.5;
  float veins = 0.0;
  if (kind == 0) {
    base = vec3(0.09, 0.26, 0.04);
    tip = vec3(0.19, 0.4, 0.07);
    through = 0.8;
  } else if (kind == 1) {
    base = vec3(0.035, 0.12, 0.022);
    tip = vec3(0.06, 0.19, 0.03);
    veins = 1.0;
    shine = 0.18;
    through = 0.35;
  } else if (kind == 2) {
    // Greener low on the stem, red towards the light.
    float up = smoothstep(0.45, 0.95, seed);
    base = mix(vec3(0.1, 0.17, 0.035), vec3(0.42, 0.06, 0.05), up);
    tip = mix(vec3(0.16, 0.24, 0.05), vec3(0.62, 0.12, 0.08), up);
    if (across < 0.01 && vLeaf.y == 0.0) { base = vec3(0.2, 0.06, 0.04); tip = base; }
    through = 0.6;
  } else if (kind == 3) {
    float up = smoothstep(0.5, 1.0, seed);
    base = mix(vec3(0.07, 0.24, 0.04), vec3(0.18, 0.42, 0.06), up);
    tip = base * 1.2;
    through = 0.6;
  } else if (kind == 4) {
    base = vec3(0.07, 0.1, 0.03);
    tip = mix(vec3(0.12, 0.13, 0.04), vec3(0.18, 0.08, 0.04), own);
    veins = 0.6;
  } else if (kind == 5) {
    base = vec3(0.06, 0.2, 0.03);
    tip = vec3(0.2, 0.42, 0.06);
    through = 0.6;
  } else if (kind == 6) {
    base = vec3(0.025, 0.1, 0.02);
    tip = vec3(0.05, 0.16, 0.03);
    veins = 1.0;
    shine = 0.12;
  } else if (kind == 7) {
    base = vec3(0.015, 0.06, 0.012);
    tip = vec3(0.03, 0.09, 0.02);
    gloss = 60.0;
    shine = 0.5;
    through = 0.15;
    veins = 0.5;
  } else if (kind == 8) {
    base = vec3(0.025, 0.09, 0.015);
    tip = vec3(0.07, 0.17, 0.03);
    through = 0.3;
  } else if (kind == 9) {
    base = vec3(0.14, 0.36, 0.05);
    tip = base;
    through = 1.0;
    shine = 0.25;
  } else {
    base = vec3(0.32, 0.3, 0.24);
    tip = vec3(0.12, 0.1, 0.07);
    through = 0.4;
  }
  vec3 albedo = mix(base, tip, t);
  albedo *= 0.8 + 0.4 * own;
  albedo *= 0.88 + 0.24 * noise3(vec3(seed * 9.0, t * 11.0, across * 4.0));
  // A paler midrib, and side veins arching out to the edge on broad leaves.
  albedo = mix(albedo, albedo * 1.5 + vec3(0.02, 0.03, 0.0), smoothstep(0.12, 0.0, across) * 0.5);
  if (veins > 0.0) {
    float side = abs(fract(t * 9.0 - across * 1.8) - 0.5);
    albedo *= 1.0 - veins * 0.18 * smoothstep(0.08, 0.0, side) * smoothstep(0.1, 0.4, across);
  }
  // Older leaves low down collect a little brown at the edges.
  albedo = mix(albedo, vec3(0.1, 0.08, 0.03), smoothstep(0.8, 1.0, across) * 0.35 * (1.0 - t));
  // Lower down a plant is shaded by its own leaves and those round it.
  float low = 1.0 - smoothstep(0.0, 0.9, vReal.y - uBox.w - 0.3);
  float occ = mix(1.0, groundAt(vReal).r, low * 0.8);
  albedo *= occ;
  vec3 col = lit(albedo, n, vReal, v, gloss, shine, 0.6);
  // Thin leaves glow with the light coming through them from above.
  float behind = sunAt(vReal) * lampShadow(vReal, 2.5);
  col += albedo * uSun * behind * max(dot(-n, uLight), 0.0) * through * 0.45;
  col += albedo * uSun * behind * pow(max(dot(-v, uLight), 0.0), 3.0) * through * 0.2;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/** Food flakes, drawn as themselves and, while near the surface, in its mirror. */
export const FLAKE_VERT = /* glsl */ `
${TANK_VERT}
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
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

export const FLAKE_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec3 vRest;
varying float vTone;
varying float vMirror;
void main() {
  vec3 eye = cameraPosition;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  float edge = noise3(vec3(vRest.xz * 6.0, vTone * 20.0));
  if (length(vRest.xz) > 0.32 + 0.22 * edge) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 albedo = vTone < 0.4 ? vec3(0.62, 0.16, 0.04) : vTone < 0.7 ? vec3(0.45, 0.3, 0.1) : vec3(0.2, 0.32, 0.06);
  albedo *= 0.8 + 0.4 * noise3(vec3(vRest.xz * 30.0, vTone));
  vec3 col = lit(albedo, n, vReal, v, 10.0, 0.05, 0.5) + albedo * uSun * 0.12;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/**
 * Bubbles from the air stone, each rising through a loop of the column and starting again:
 * small ones wobble, bigger ones zigzag, all at about the same speed.
 */
export const BUBBLE_VERT = /* glsl */ `
${TANK_VERT}
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
  float size = aBubble.y;
  float y = uColumn.y + age * uRise;
  vec3 c = vec3(uColumn.x, y, uColumn.z);
  float wob = 0.05 + size * 2.5;
  c.x += sin(age * 9.0 + aBubble.z * 6.0) * wob * min(age * 2.0, 1.0);
  c.z += cos(age * 7.0 + aBubble.z * 9.0) * wob * 0.6 * min(age * 2.0, 1.0);
  c.x += (aBubble.z - 0.5) * 0.12 * age;
  float gone = step(uWater - size, y);
  vec3 squash = vec3(1.15 + 0.15 * sin(age * 21.0 + aBubble.z * 3.0), 0.8, 1.1);
  vReal = c + position * size * squash * (1.0 - gone);
  vNormal = normal;
  vMirror = aBubble.w;
  vLife = 1.0 - gone;
  vSeen = mirrored(vReal, vMirror);
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

export const BUBBLE_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying float vMirror;
varying float vLife;
void main() {
  if (vLife < 0.5) discard;
  vec3 eye = cameraPosition;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  float facing = abs(dot(n, v));
  // An air bubble in water is a mirror at its rim and clear in the middle.
  float rim = pow(1.0 - facing, 3.0);
  vec3 h = normalize(uLight + v);
  float spark = pow(max(dot(n, h), 0.0), 160.0);
  vec3 col = (uShallow * 3.0 + vec3(0.12)) * rim + uSun * spark * 1.2;
  col *= clarity(eye, vSeen);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/** Specks drifting in the water, catching the light. */
export const SPECK_VERT = /* glsl */ `
${TANK_VERT}
attribute vec4 aSpeck;
uniform float uPointScale;
uniform vec4 uSpan;
varying float vFade;
varying vec3 vSeen;
void main() {
  vec3 p = position;
  p.x += 0.12 * sin(cyc(aSpeck.w) + aSpeck.x);
  p.z += 0.08 * cos(cyc(aSpeck.w * 0.75) + aSpeck.y);
  float span = uSpan.y - uSpan.x;
  float drop = fract(position.y - drift(aSpeck.z)) * span;
  p.y = uSpan.x + drop;
  vFade = smoothstep(0.0, 0.08, drop / span) * smoothstep(1.0, 0.9, drop / span);
  vSeen = p;
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uPointScale * (0.5 + fract(aSpeck.x)) / -view.z, 1.0, 8.0);
  gl_Position = projectionMatrix * view;
}
`;

export const SPECK_FRAG = /* glsl */ `
${TANK_FRAG}
varying float vFade;
varying vec3 vSeen;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(q)) * vFade;
  vec3 eye = cameraPosition;
  vec3 col = (uShallow * 1.5 + uSun * 0.05 * sunAt(vSeen)) * a * clarity(eye, vSeen) * 0.6;
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/**
 * Shrimp: legs stepping, the first pairs picking at the ground and bringing food to the mouth,
 * antennae swaying, the tail flicking under it when startled. aShrimp is (legs, claws, flick,
 * mirror).
 */
export const SHRIMP_VERT = /* glsl */ `
${TANK_VERT}
attribute vec4 aPart;
attribute vec4 aShrimp;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vPart;
varying vec3 vRest;
varying float vMirror;
void main() {
  vec3 p = position;
  float part = aPart.x;
  float t = aPart.y;
  if (abs(part - 1.0) < 0.5 || abs(part - 2.0) < 0.5) {
    float leg = aPart.z;
    float step = sin(aShrimp.x + leg * 1.3 + aPart.w * 1.6);
    p.x += step * 0.03 * t;
    p.y += max(0.0, step) * 0.02 * t;
    if (part > 1.5) {
      // Claws pick: down to the ground and up to the mouth.
      float pick = 0.5 + 0.5 * sin(aShrimp.y + aPart.w * 1.9);
      p.y += pick * 0.07 * t;
      p.x += pick * 0.05 * t;
    }
  } else if (abs(part - 3.0) < 0.5) {
    p.z += sin(cyc(1201.0) + t * 3.0 + aPart.w) * 0.04 * t;
    p.y += sin(cyc(977.0) + t * 2.0) * 0.03 * t;
  }
  // A flick curls the tail down and under.
  float behind = clamp(-(position.x - 0.1) / 0.4, 0.0, 1.0);
  float curl = aShrimp.z * behind * behind;
  p.y -= curl * 0.12;
  p.x += curl * 0.08;
  vec4 local = instanceMatrix * vec4(p, 1.0);
  vReal = local.xyz;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vMirror = aShrimp.w;
  vSeen = mirrored(vReal, vMirror);
  vPart = aPart;
  vRest = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeen, 1.0);
}
`;

export const SHRIMP_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vPart;
varying vec3 vRest;
varying float vMirror;
void main() {
  vec3 eye = cameraPosition;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  float part = vPart.x;
  // Glassy grey-green, a broken line of reddish-brown dashes along each side.
  vec3 albedo = vec3(0.12, 0.14, 0.11);
  if (part < 0.5) {
    float side = smoothstep(0.015, 0.03, abs(vRest.z)) * smoothstep(0.02, -0.01, vRest.y - 0.13);
    float dash = step(0.45, fract(vRest.x * 26.0)) * side;
    float row2 = step(0.55, fract(vRest.x * 18.0 + 0.3)) * smoothstep(0.03, 0.04, abs(vRest.z)) * smoothstep(0.1, 0.08, vRest.y);
    albedo = mix(albedo, vec3(0.26, 0.07, 0.04), max(dash, row2) * 0.85);
    // The gut shows through as a darker line.
    albedo *= 1.0 - 0.35 * smoothstep(0.02, 0.0, abs(vRest.z)) * step(-0.25, vRest.x);
  } else if (part > 3.5 && part < 4.5) {
    albedo = vec3(0.01);
  } else {
    albedo *= 0.85;
  }
  vec3 col = lit(albedo, n, vReal, v, 60.0, 0.6, 0.7);
  float rim = pow(1.0 - abs(dot(n, v)), 2.0);
  col += waterTint(vReal.y) * rim * 0.8 + albedo * uSun * sunAt(vReal) * 0.2;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/** Nerite snails on the front glass, their soles towards the room. aSnail: (wave, mouth, tuck, seed). */
export const NERITE_VERT = /* glsl */ `
${TANK_VERT}
attribute vec4 aPart;
attribute vec4 aSnail;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vPart;
varying vec3 vRest;
varying vec4 vSnail;
void main() {
  vec3 p = position;
  float tuck = aSnail.z;
  if (aPart.x > 2.5) {
    p.z += sin(cyc(437.0) + aPart.y * 5.0 + aPart.w) * aPart.y * 0.05;
    p.xz *= 1.0 - tuck * 0.9;
  } else if (aPart.x < 2.5 && aPart.x > 0.5) {
    p.xz *= 1.0 - tuck * 0.35;
  } else {
    p.xz *= 1.0 - tuck * 0.4;
  }
  vec4 local = instanceMatrix * vec4(p, 1.0);
  vReal = local.xyz;
  vSeen = vReal;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vPart = aPart;
  vRest = position;
  vSnail = aSnail;
  gl_Position = projectionMatrix * viewMatrix * vec4(vReal, 1.0);
}
`;

export const NERITE_FRAG = /* glsl */ `
${TANK_FRAG}
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vPart;
varying vec3 vRest;
varying vec4 vSnail;
void main() {
  vec3 eye = cameraPosition;
  vec3 v = normalize(eye - vReal);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 albedo;
  float gloss = 30.0;
  float shine = 0.2;
  float part = vPart.x;
  if (part < 0.5) {
    // The sole on the glass: pale, with waves of muscle running forward along it.
    float waves = 0.5 + 0.5 * sin((vRest.x * 8.0 - vSnail.x * 6.2832) * 3.0);
    albedo = mix(vec3(0.42, 0.4, 0.36), vec3(0.3, 0.28, 0.25), waves * smoothstep(0.32, 0.15, abs(vRest.z)));
    float m = length((vRest.xz - vec2(0.42, 0.0)) * vec2(1.0, 1.4));
    albedo = mix(albedo, vec3(0.1, 0.05, 0.04), smoothstep(0.05 + vSnail.y * 0.03, 0.03, m));
    gloss = 80.0;
    shine = 0.5;
  } else if (part < 1.5) {
    albedo = vec3(0.28, 0.27, 0.25);
  } else if (part < 2.5) {
    // Zebra stripes from the whorl to the lip, breaking into zigzags.
    float a = vPart.z * 6.2832;
    float stripes = sin(a * 9.0 + vPart.y * 7.0 + sin(vPart.y * 16.0 + a * 2.0) * 0.9);
    albedo = mix(vec3(0.5, 0.31, 0.05), vec3(0.012, 0.01, 0.008), smoothstep(-0.1, 0.25, stripes));
    albedo *= 0.85 + 0.3 * noise3(vRest * 40.0);
    gloss = 60.0;
    shine = 0.45;
  } else {
    albedo = mix(vec3(0.3, 0.29, 0.26), vec3(0.02), step(0.85, vPart.y));
  }
  vec3 col = lit(albedo, n, vReal, v, gloss, shine, 0.5);
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;

/**
 * Where fingers touch the glass: a tap sends two soft ripples spreading and fading, a held
 * finger glows gently. Everything fades out well inside the quad, so its edge never shows.
 */
export const RING_VERT = /* glsl */ `
attribute vec4 aRing;
varying vec2 vAt;
varying vec4 vRing;
void main() {
  vAt = position.xy * 0.8;
  vRing = aRing;
  vec3 p = vec3(aRing.x + vAt.x, aRing.y + vAt.y, 0.004);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const RING_FRAG = /* glsl */ `
varying vec2 vAt;
varying vec4 vRing;
float ripple(float d, float r, float w) {
  float x = (d - r) / w;
  return exp(-x * x);
}
void main() {
  float d = length(vAt);
  float age = vRing.z;
  float light = 0.0;
  if (vRing.w > 0.5) {
    float breathe = 0.5 + 0.5 * sin(age * 4.0);
    light = exp(-pow(d / 0.11, 2.0)) * 0.18 + ripple(d, 0.17 + 0.02 * breathe, 0.025) * 0.22;
  } else {
    float k = clamp(age / 0.9, 0.0, 1.0);
    float fade = (1.0 - k) * (1.0 - k);
    float r = 0.06 + 0.42 * (1.0 - (1.0 - k) * (1.0 - k));
    light = (ripple(d, r, 0.03 + 0.03 * k) + 0.5 * ripple(d, r * 0.62, 0.025)) * fade * 0.4;
  }
  light *= smoothstep(0.75, 0.55, d);
  gl_FragColor = vec4(vec3(0.8, 0.95, 1.0) * light, 1.0);
  #include <colorspace_fragment>
}
`;

/** The lid's underside above the water, seen through the strip of glass over the waterline. */
export const LID_FRAG = /* glsl */ `
${TANK_FRAG}
uniform vec2 uLamps;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
void main() {
  if (!aboveSeen(cameraPosition, vReal)) discard;
  // Two lamp strips running along the tank, and the dim plastic between them.
  float a = exp(-pow((vReal.z - uLamps.x) / 0.12, 2.0));
  float b = exp(-pow((vReal.z - uLamps.y) / 0.12, 2.0));
  // Dark plastic, catching a little of the lamps' light and the water's below it.
  vec3 col = vec3(0.012, 0.013, 0.013) + uSun * 0.05 * (a + b * 0.7) + uShallow * 0.25 * smoothstep(-0.8, 0.0, vReal.z);
  col *= 0.8 + 0.2 * noise3(vec3(vReal.xz * 3.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  ${TANK_OUT}
}
`;
