/**
 * The cake's skin, baked once at mount into two full-sphere textures in the cake's own frame, so
 * the per-frame shader only looks them up:
 *
 * - colour (square root of linear colour, so the near-black keeps its steps in eight bits, with
 *   cavities already darkened) and gloss;
 * - the surface's slope as a 3D vector along the surface (no tangent frame, so the poles are
 *   clean) and its height.
 *
 * Each cake's bake is its own shader, so it compiles only what it draws. The pudding is a moist,
 * reddish mahogany crumb, short creases, the faint print of the cloth's weave and its pleats
 * gathered at the top, studded with fruit and nuts; the rocky road is set milk chocolate packed
 * with pieces that push through it (`pieces.ts`); the sponges are a crust with fine pores; the
 * galaxy dome a set coat of marbled glaze.
 */
import { EQ_GLSL, f, NOISE_GLSL, v3 } from "./glsl";
import { BODY, CRUMB, MILK_CHOCOLATE } from "./looks";
import { PUDDING_PIECES, piecesGlsl, ROCKY_PIECES } from "./pieces";

/** Largest slope stored, and the height range, in radians of the ball. */
export const SLOPE_MAX = 2;
export const HEIGHT_MAX = 0.05;

const COMMON_GLSL = /* glsl */ `
${NOISE_GLSL}
${EQ_GLSL}
uniform vec3 uSeed;

struct Skin {
  vec3 col;
  float gloss;
  float h;
  float ao;
};

// Round holes in a surface: cells of a 3D grid of 'freq' may hold one; returns how deep in one
// the point is, 0 to 1.
float holes(vec3 p, float density, float size, int salt) {
  vec3 ip = floor(p);
  float best = 0.0;
  for (int k = 0; k < 8; k++) {
    ivec3 c = ivec3(ip) + ivec3(step(0.5, p - ip)) - 1 + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec4 r = hash43(c + ivec3(salt, 3 * salt, 11));
    if (r.x > density) continue;
    float rad = size * (0.55 + 0.45 * r.y);
    float dist = length(p - (vec3(c) + 0.5 + (r.yzw - 0.5) * 0.4));
    best = max(best, smoothstep(rad, rad * 0.35, dist));
  }
  return best;
}

`;

const PIECE_SKIN_GLSL = /* glsl */ `
// Where a piece meets the cake: the cake's surface lifted round its foot, the piece where it
// stands higher, the cake's own coat over its lower part, and a shade along the line they meet.
Skin withPieces(vec3 d, Skin k, float meet, float shade) {
  Hit p = noHit();
  pieces(d, p);
  float hc = k.h + p.fil;
  float over = p.h - hc;
  float on = smoothstep(-meet, meet, over);
  vec3 pc = mix(p.col, k.col * 0.85, smoothstep(0.0, 0.7, p.coat));
  float pg = mix(p.gloss, k.gloss, p.coat);
  float ao = k.ao * (1.0 - shade * exp(-abs(over) / (6.0 * meet)) * step(-0.5, p.h));
  return Skin(mix(k.col, pc, on), mix(k.gloss, pg, on), max(hc, p.h), ao);
}
`;

const PUDDING_GLSL = /* glsl */ `
// A moist, reddish mahogany crumb, glossy with syrup, with the marks the cloth left. (The paler
// floury patches of the first build are gone: on the ball they read as mould.)
Skin puddingSkin(vec3 d) {
  vec3 s = d + uSeed;
  float m = fbm(s * 2.2, 4);
  float m2 = fbm(s * 8.5 + 4.0, 4);
  vec3 col = mix(${v3(CRUMB.dark)}, ${v3(CRUMB.light)}, smoothstep(0.25, 0.8, m));
  col *= 0.86 + 0.28 * m2;
  float gloss = 0.95 + 0.25 * (m2 - 0.5);
  float h = 0.004 * (m2 - 0.5);
  // A moist crumb: little rounded crumbs swollen with syrup, darker in the gaps between them.
  float clump = fbm(s * 30.0 + 13.0, 2);
  float crumbs = fbm(s * 70.0 + 3.0, 3);
  crumbs = smoothstep(0.35, 0.75, crumbs + 0.25 * (vnoise(s * 190.0) - 0.5));
  h += 0.0014 * (clump - 0.5) + 0.0009 * crumbs;
  col *= (0.9 + 0.16 * clump) * (0.84 + 0.24 * crumbs);
  // A few small pits, shining with syrup.
  float pit = holes(s * 28.0, 0.1, 0.24, 401);
  h -= 0.004 * pit;
  col *= 1.0 - 0.35 * pit;
  gloss += 0.3 * pit;
  // Short creases.
  vec3 w = s * 14.0 + 2.0 * vec3(vnoise(s * 5.0), vnoise(s * 5.0 + 9.0), vnoise(s * 5.0 + 17.0));
  float ridge = 1.0 - abs(2.0 * vnoise(w) - 1.0);
  float crease = smoothstep(0.93, 0.99, ridge) * smoothstep(0.6, 0.8, fbm(s * 4.0 + 50.0, 3));
  h -= 0.0008 * crease;
  col *= 1.0 - 0.3 * crease;
  // The cloth's weave, faintly, and its pleats gathered at the top pole.
  vec3 t = d * 520.0;
  float weave = sin(t.x) * sin(t.z) + sin(t.y) * sin(t.x + t.z) * 0.6;
  h += 0.00004 * weave;
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(d.x, d.z);
  float pleatOn = smoothstep(0.55, 1.2, lat);
  float wob = 0.35 * sin(lon * 3.0 + 1.0) + 0.2 * sin(lon * 7.0 + 4.0) + 0.6 * (lat - 1.0);
  float pleat = pow(abs(sin(lon * 6.5 + wob)), 0.35);
  h += 0.012 * pleatOn * (pleat - 0.75);
  col *= 1.0 - 0.25 * pleatOn * (1.0 - pleat);
  return withPieces(d, Skin(col, gloss, h, 1.0), 0.0003, 0.45);
}
Skin skinAt(vec3 d) {
  return puddingSkin(d);
}
`;

const ROCKY_GLSL = /* glsl */ `
// Set milk chocolate, satin smooth and gently rippled where it set, with crumbs of nut and coconut
// caught in it, packed with pieces that push through it.
Skin rockySkin(vec3 d) {
  vec3 s = d + uSeed;
  float m = fbm(s * 2.5, 4);
  float m2 = fbm(s * 9.0 + 4.0, 3);
  vec3 col = mix(${v3(MILK_CHOCOLATE.dark)}, ${v3(MILK_CHOCOLATE.light)}, smoothstep(0.3, 0.75, m));
  col *= 0.94 + 0.12 * m2;
  float gloss = 0.85 + 0.1 * (m2 - 0.5);
  float h = 0.006 * (fbm(s * 4.0 + 9.0, 3) - 0.5) + 0.0015 * (m2 - 0.5);
  float crumbs = holes(s * 120.0, 0.08, 0.35, 5);
  col = mix(col, vec3(0.42, 0.3, 0.17), 0.6 * crumbs);
  gloss = mix(gloss, 0.3, crumbs);
  h += 0.0006 * crumbs;
  return withPieces(d, Skin(col, gloss, h, 1.0), 0.0005, 0.3);
}
Skin skinAt(vec3 d) {
  return rockySkin(d);
}
`;

const SPONGE_GLSL = /* glsl */ `
// The outside of a baked sponge: an even crust, browner in places, full of small pores.
Skin spongeSkin(vec3 d, bool chocolate) {
  vec3 s = d + uSeed;
  float m = fbm(s * 3.0, 4);
  float m2 = fbm(s * 13.0 + 4.0, 3);
  vec3 dark = chocolate ? vec3(0.03, 0.013, 0.0065) : vec3(0.42, 0.22, 0.05);
  vec3 light = chocolate ? vec3(0.055, 0.025, 0.012) : vec3(0.62, 0.4, 0.11);
  vec3 col = mix(dark, light, 0.25 + 0.5 * smoothstep(0.3, 0.7, m)) * (0.9 + 0.2 * m2);
  // Fine pores and crumb rather than a pattern of dots.
  float pore = max(0.7 * holes(s * 90.0, 0.55, 0.38, 1), 0.5 * holes(s * 200.0 + 3.0, 0.6, 0.4, 2));
  float grain = 0.6 * vnoise(s * 260.0) + 0.4 * vnoise(s * 520.0);
  // The gentle lumps of a risen crust.
  float lumps = fbm(s * 5.0 + 11.0, 3);
  float h = 0.005 * (lumps - 0.5) + 0.0015 * (m2 - 0.5) + 0.0012 * (grain - 0.5) - 0.0025 * pore;
  col *= (1.0 - 0.35 * pore) * (0.85 + 0.3 * grain);
  return Skin(col, chocolate ? 0.3 : 0.18, h, 1.0 - 0.3 * pore);
}

`;

const MARBLE_GLSL = /* glsl */ `
// Marbled colour for the galaxy glaze: deep blue swirled with purple and pink, a few pale veins.
vec3 marble(vec3 d, float depth) {
  vec3 q = d * 2.0 + uSeed * 0.7;
  vec3 w = vec3(fbm(q, 4), fbm(q + 5.2, 4), fbm(q + 9.7, 4));
  float t = fbm(q * 1.5 + 3.2 * w, 5);
  float v = fbm(q * 2.6 + 2.2 * w + 7.0, 4);
  vec3 col = mix(vec3(0.008, 0.02, 0.16), vec3(0.03, 0.09, 0.42), smoothstep(0.3, 0.6, v));
  col = mix(col, vec3(0.16, 0.035, 0.34), smoothstep(0.42, 0.6, t));
  col = mix(col, vec3(0.5, 0.06, 0.26), smoothstep(0.6, 0.7, t) * smoothstep(0.4, 0.6, v));
  // Soft paler streaks drawn out along the swirl.
  float streak = exp(-pow((fract(t * 3.0 + 0.4 * v) - 0.5) / 0.05, 2.0));
  col = mix(col, vec3(0.2, 0.28, 0.55), 0.35 * streak * smoothstep(0.45, 0.7, w.x));
  return col * depth;
}

// Tiny star specks in a glaze: returns how much of a speck covers the point.
float specks(vec3 d) {
  return max(holes(d * 150.0 + uSeed, 0.06, 0.3, 7), holes(d * 90.0 + uSeed * 2.0, 0.025, 0.28, 9));
}

`;

const MOUSSE_GLSL = /* glsl */ `
// A mousse dome under a set coat of the same glaze, darker and smoother than the fresh pour.
Skin mousseSkin(vec3 d) {
  vec3 col = marble(d * 0.8 + 3.0, 0.55);
  float sp = specks(d + 1.7);
  col = mix(col, vec3(0.6, 0.55, 0.42), sp * 0.7);
  float h = 0.002 * (fbm(d * 4.0 + uSeed, 3) - 0.5);
  return Skin(col, mix(0.85, 1.1, sp), h, 1.0);
}

Skin skinAt(vec3 d) {
  return mousseSkin(d);
}
`;

/** The GLSL that defines `Skin skinAt(vec3 d)` for a cake's body. */
const skinGlsl = (body: number): string => {
  if (body === BODY.chocolateSponge || body === BODY.vanillaSponge) {
    return `${COMMON_GLSL}${SPONGE_GLSL}Skin skinAt(vec3 d) {
  return spongeSkin(d, ${body === BODY.chocolateSponge ? "true" : "false"});
}
`;
  }
  if (body === BODY.glazedMousse) return `${COMMON_GLSL}${MARBLE_GLSL}${MOUSSE_GLSL}`;
  if (body === BODY.rockyRoad)
    return `${COMMON_GLSL}${piecesGlsl(ROCKY_PIECES)}${PIECE_SKIN_GLSL}${ROCKY_GLSL}`;
  return `${COMMON_GLSL}${piecesGlsl(PUDDING_PIECES)}${PIECE_SKIN_GLSL}${PUDDING_GLSL}`;
};

export const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Colour and gloss. */
export const colourBake = (body: number): string => /* glsl */ `
${skinGlsl(body)}
varying vec2 vUv;
void main() {
  Skin k = skinAt(eqDir(vUv));
  gl_FragColor = vec4(sqrt(max(k.col * k.ao, 0.0)), clamp(k.gloss / 1.2, 0.0, 1.0));
}
`;

/** Slope along the surface as a 3D vector, and height. */
export const slopeBake = (body: number): string => /* glsl */ `
${skinGlsl(body)}
uniform float uStep;
varying vec2 vUv;
void main() {
  vec3 d = eqDir(vUv);
  vec3 ref = abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, d));
  vec3 t2 = cross(d, t1);
  float e = uStep;
  // One loop rather than three calls, so the skin is compiled once.
  vec3 at[3] = vec3[3](d, normalize(d + e * t1), normalize(d + e * t2));
  float hs[3];
  for (int i = 0; i < 3; i++) hs[i] = skinAt(at[i]).h;
  vec3 g = ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / e;
  gl_FragColor = vec4(0.5 + 0.5 * clamp(g / ${f(SLOPE_MAX)}, -1.0, 1.0), clamp(0.5 + hs[0] / ${f(2 * HEIGHT_MAX)}, 0.0, 1.0));
}
`;

/** The galaxy glaze's marbled colour (square root of linear) and its star specks. */
export const TINT_BAKE = /* glsl */ `
${COMMON_GLSL}
${MARBLE_GLSL}
varying vec2 vUv;
void main() {
  vec3 d = eqDir(vUv);
  gl_FragColor = vec4(sqrt(max(marble(d, 1.0), 0.0)), specks(d));
}
`;
