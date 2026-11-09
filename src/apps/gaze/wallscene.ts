/**
 * The eye's place on the wall: a wall lit by one lamp above and in front, with the eye set into
 * it, the wall swelling into lids over the ball (or, without lids, curving back into a round
 * socket round it). The lamp shades the ball and the wall, and the lids cast a soft shadow below
 * them; the room in front fills the shadows a little. Linear colour.
 *
 * The wall is dark slate paint or skin (`uSkin`), in the colour `uPaint`. Skin has an uneven
 * tone (melanin and blood in broad patches), pores that break up its sheen, a soft oily sheen,
 * and light scattering under it: red light travels furthest, so shadows' edges and the lids'
 * curves glow warm.
 *
 * The lids and the wall are one surface, shaded by one function, and the bump of the lids meets
 * the flat wall with no step in its slope or its curvature, so nothing marks where it begins.
 *
 * Defines `wallLight(n)`, the light falling on the ball at venue direction `n` from its centre,
 * which the surface shader uses on the wall in place of the sphere's gentle room light, and
 * `wallBackdrop` and `wallFront`, for `wallview.ts`.
 */
/**
 * How far across the eye, in shell radii, the lids' opening reaches: at both corners alike
 * (`plain`), or at the inner corner by the nose (+x), rounder round the caruncle (option `tears`),
 * and at the sharper outer one (option `shape`).
 */
export const LID_CORNER = { plain: 0.86, inner: 0.8, outer: 0.88 };

/** The opening's reach at the inner and outer corners with the options as given. */
export const lidCorners = (shape: boolean, tears: boolean) => ({
  inner: tears ? LID_CORNER.inner : LID_CORNER.plain,
  outer: shape ? LID_CORNER.outer : LID_CORNER.plain,
});

/** Where the tear ducts' openings sit on each margin, shell radii across towards the nose. */
export const PUNCTUM = 0.715;

/** The caruncle: its middle across the eye, and its half width and half height, shell radii. */
const CARUNCLE = { x: 0.78, w: 0.065, h: 0.11 };

export const WALL_SCENE = /* glsl */ `
// The lamp, venue metres.
uniform vec3 uLamp;
// How much of the lamp is on (the room's lamps dim now and then).
uniform float uLampOn;
// Lids: on or off, the shell they lie on (centre and radius), and the upper and lower margins'
// planes (normal and offset): the upper lid covers where dot(p, n) + w > 0, the lower where < 0.
uniform float uLidsOn;
uniform vec4 uLidShell;
uniform vec4 uLidUpper;
uniform vec4 uLidLower;
// The wall's colour, linear, and 1 where it is skin rather than paint.
uniform vec3 uPaint;
uniform float uSkin;
// Options, 1 on: lashes (their shadows here), the lids' real shape (a sharper outer corner), and
// the inner corner's caruncle, tear ducts and tears.
uniform float uLashes;
uniform float uShape;
uniform float uTears;
// The fillet between the lids and the wall, ball radii. It is a C2 blend, so the bump leaves
// the wall with no edge in its shading.
const float LID_FILLET = 0.75;
// The margin's tint on paint; how deep the creases are.
const vec3 LID_EDGE = vec3(0.55, 0.5, 0.5);
const float LID_CREASE = 0.22;
// How far across the eye, in shell radii, the opening's rounded corners reach, by the nose and
// on the outer side.
const float CORNER_PLAIN = ${LID_CORNER.plain.toFixed(4)};
const float CORNER_IN = ${LID_CORNER.inner.toFixed(4)};
const float CORNER_OUT = ${LID_CORNER.outer.toFixed(4)};
const float PUNCTUM = ${PUNCTUM.toFixed(4)};
// How round the inner corner's end is, shell radii.
const float CORNER_ROUND = 0.09;
// The caruncle's middle across the eye, half width and half height, shell radii; the plica's
// width beside it.
const vec3 CARUNCLE = vec3(${CARUNCLE.x.toFixed(4)}, ${CARUNCLE.w.toFixed(4)}, ${CARUNCLE.h.toFixed(4)});
const float PLICA_W = 0.03;
// How tall the tears' meniscus along the lower lid is, shell radii (about 0.25 mm on an eye).
const float MENISCUS = 0.016;
// How much the lashes darken the eye under them, and the lower lid under the lower ones.
const float LASH_SHADE = 0.3;
const float LOW_LASH_SHADE = 0.14;

// How far the socket's curve reaches out from the ball's edge, and how deep it is, ball radii.
const float SOCKET_W = 0.3;
const float SOCKET_D = 0.2;

// Skin. Its sheen's reflectance head on, and how far red, green and blue light scatter round a
// curve under it (as wrap in the diffuse light).
const float SKIN_F0 = 0.028;
const vec3 SKIN_WRAP = vec3(0.45, 0.22, 0.15);
// How far the broad lamp's light wraps round the lids' curve, on paint or skin.
const float LAMP_WRAP = 0.3;

float lampFalloff(vec3 p) {
  vec3 d = uLamp - p;
  // In ball radii, so the light on the eye is the same at any size.
  float r2 = dot(d, d) / (uBall.w * uBall.w);
  // A broad, soft spot: brightest straight below and in front of it.
  vec3 axis = normalize(uBall.xyz - uLamp);
  float cone = smoothstep(0.3, 1.0, dot(-normalize(d), axis));
  return (0.2 + 0.8 * cone * cone) * 6.3 / (r2 + 0.26);
}

// Light from the lamp reaching p past the lids (or the ball), 0 to 1. The lamp is broad, so the
// shadow is soft even where it leaves the lids, and it fades in as the lids come between, so the
// lids' own turn away from the lamp has no edge.
float lampShadow(vec3 p, vec3 l, vec4 occluder) {
  vec3 oc = occluder.xyz - p;
  float along = dot(oc, l);
  float miss = length(oc - l * along) - occluder.w;
  float pen = (0.3 + 0.35 * max(along, 0.0) / uBall.w) * uBall.w;
  return mix(1.0, smoothstep(-pen, pen, miss), smoothstep(0.0, 0.4 * uBall.w, along));
}

// Diffuse light at cosine nl wrapped round a curve by w (0 on flat wall): a broad lamp lights a
// little past where a point would stop, and fades out there smoothly.
vec3 wrapLight(float nl, vec3 w) {
  return pow(clamp((vec3(nl) + w) / (1.0 + w), 0.0, 1.0), 1.0 + w);
}

uint skinHash(ivec3 p) {
  uvec3 q = uvec3(p) * uvec3(0x8da6b343u, 0xd8163841u, 0xcb1ab31fu);
  uint h = q.x ^ q.y ^ q.z;
  h ^= h >> 15;
  h *= 0x2c1b3c6du;
  h ^= h >> 12;
  h *= 0x297a2d39u;
  h ^= h >> 15;
  return h;
}

// Value noise across the wall, 0 to 1, four values from one lattice for different layers. Flat
// is enough: the lids are a gentle bump, and their stretch on its sides doesn't show.
vec4 skinNoise(vec2 x, int layer) {
  vec2 i = floor(x);
  vec2 f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  vec4 n[4];
  for (int k = 0; k < 4; k++) {
    uint h = skinHash(ivec3(c + ivec2(k & 1, k >> 1), layer));
    n[k] = vec4(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u), float(h >> 24)) / 255.0;
  }
  return mix(mix(n[0], n[1], f.x), mix(n[2], n[3], f.x), f.y);
}

// Pores at x (in pore spacings across the wall): round, of uneven size, one or none to a cell,
// each kept inside its cell so only that cell need be looked at. The lattice is turned a little
// so its rows don't line up with the wall. 1 in a pore.
float skinPores(vec2 x) {
  x = mat2(0.88, 0.47, -0.47, 0.88) * x;
  vec2 i = floor(x);
  uint h = skinHash(ivec3(ivec2(i), 7));
  vec2 at = 0.3 + 0.4 * vec2(float(h & 255u), float((h >> 8) & 255u)) / 255.0;
  float size = 0.1 + 0.18 * float((h >> 16) & 255u) / 255.0;
  float here = step(0.3, float(h >> 24) / 255.0);
  return here * (1.0 - smoothstep(0.45 * size, size, length(at - (x - i))));
}

// Skin's unevenness at p, venue metres: x melanin, y blood, z pores (1 in a pore), w a fine
// grain. Detail finer than a few pixels fades out, so it never sparkles.
vec4 skinDetail(vec3 p) {
  vec4 broad = skinNoise(p.xy * 1.3, 1);
  vec4 mid = skinNoise(p.xy * 4.1, 2);
  float tone = 0.6 * broad.x + 0.4 * mid.x;
  float blood = 0.55 * broad.y + 0.45 * mid.y;
  float px = uPxM;
  // Pores about a centimetre across and a few apart, as a face's are at the eye's scale; a grain
  // a few centimetres across.
  float poreK = 1.0 - smoothstep(0.006, 0.012, px);
  float pore = 0.0;
  if (poreK > 0.0) pore = skinPores(p.xy * 40.0) * poreK;
  float grainK = 1.0 - smoothstep(0.01, 0.02, px);
  float grain = grainK > 0.0 ? (skinNoise(p.xy * 26.0, 3).z - 0.5) * grainK : 0.0;
  return vec4(tone, blood, pore, grain);
}

// The wall's surface at p with normal n, seen along rd, in colour 'paint': lit by the lamp and
// the room, the lamp stopped by the lids (or the ball), and dimmed towards the wall's ends and
// top. 'curve' (0 to 1) is how curved the surface is, where light scattering under skin wraps
// round; 'sheen' adds to the surface's own gloss.
vec3 wallShade(vec3 p, vec3 n, vec3 rd, vec3 paint, float curve, float sheen) {
  vec4 occluder = uLidsOn > 0.5 ? uLidShell : uBall;
  vec3 l = normalize(uLamp - p);
  float nl = dot(n, l);
  float fall = lampFalloff(p) * uLampOn;
  float shadow = lampShadow(p, l, occluder);
  float fillK = 0.2 + 0.06 * n.z + 0.04 * max(0.0, -n.y);
  vec3 hv = normalize(l - rd);
  float nh = max(0.0, dot(n, hv));
  vec3 col;
  if (uSkin > 0.5) {
    vec4 d = skinDetail(p);
    // Melanin darkens and browns in broad patches, blood flushes pink in others.
    vec3 albedo = paint * (0.9 + 0.2 * d.x) * (1.0 + 0.05 * d.w);
    albedo = mix(albedo, albedo * vec3(1.07, 0.9, 0.88), 0.45 * smoothstep(0.35, 0.8, d.y));
    albedo *= 1.0 - 0.12 * d.z;
    vec3 diffuse = wrapLight(nl, (LAMP_WRAP + SKIN_WRAP) * curve);
    // Light under the skin carries into the shadow's edge, red furthest.
    vec3 shade = pow(vec3(shadow), vec3(0.5, 0.85, 1.0));
    // The room's light comes back off more skin, so it is warmed by it.
    vec3 fill = fillK * mix(vec3(1.0), albedo / max(1e-3, dot(albedo, vec3(0.2126, 0.7152, 0.0722))), 0.25);
    col = albedo * (fill + 1.1 * diffuse * shade * fall);
    // A soft oily sheen and a tighter one, both broken up in the pores.
    float fres = SKIN_F0 + (1.0 - SKIN_F0) * pow(1.0 - max(0.0, dot(n, -rd)), 5.0);
    float gloss = 0.5 * pow(nh, 14.0) + 0.9 * pow(nh, 70.0) + sheen * pow(nh, 30.0);
    col += vec3(1.0, 0.97, 0.93) * fres * gloss * max(0.0, nl) * shadow * fall * (1.0 - 0.7 * d.z);
    // A soft shoulder, so pale skin right under the lamp doesn't clip to a flat white.
    vec3 over = max(col - 0.6, 0.0);
    col = min(col, vec3(0.6)) + 0.4 * (1.0 - exp(-over / 0.4));
  } else {
    vec3 lamp = wrapLight(nl, vec3(LAMP_WRAP * curve)) * fall * shadow;
    col = paint * (fillK + 1.1 * lamp);
    col += vec3(pow(nh, 30.0) * (0.03 + sheen)) * fall * 0.3 * shadow;
  }
  vec2 w = (p.xy - (uWallOrigin.xy + 0.5 * uWallSize)) / (0.5 * uWallSize);
  return col * (1.0 - 0.35 * smoothstep(0.35, 1.0, abs(w.x)) - 0.15 * smoothstep(0.2, 1.0, w.y));
}

// How far above the upper lid's margin and below the lower's a point is, in ball radii.
vec2 lidSides(vec3 p) {
  return vec2(dot(p, uLidUpper.xyz) + uLidUpper.w, -(dot(p, uLidLower.xyz) + uLidLower.w)) / uLidShell.w;
}

// How thickly lashes grow at x across the eye (shell radii, + towards the nose), 0 to 1: they
// stop short of the inner corner, at the tear ducts' openings.
float lashesAt(float x, float lower) {
  return smoothstep(-0.92, -0.78, x) * (1.0 - smoothstep(PUNCTUM - 0.2 - 0.05 * lower, PUNCTUM - 0.02, x));
}

// The lashes' soft shadow, 0 to 1 of the light let through: the lamp is high, so the upper
// lashes shade a band of whatever lies under them, broken up clump by clump; 'below' is how far
// under their margin a point is and 'band' how deep the shadow reaches, shell radii.
float lashShadow(float x, float below, float band, float lower, float strength) {
  if (below < 0.0 || below > band) return 1.0;
  float k = smoothstep(0.0, 0.25 * band, below) * (1.0 - smoothstep(0.35 * band, band, below));
  float clumps = skinNoise(vec2(x * 34.0 - below * 6.0, 3.0 + lower), 12).x;
  return 1.0 - strength * k * lashesAt(x, lower) * (0.45 + 0.55 * clumps);
}

float wallLight(vec3 n) {
  vec3 p = uBall.xyz + n * uBall.w;
  vec3 l = normalize(uLamp - p);
  // The white scatters light under its surface, so the lamp's light wraps a little round.
  float diffuse = clamp((dot(n, l) + 0.25) / 1.25, 0.0, 1.0);
  float lamp = diffuse * lampFalloff(p) * uLampOn;
  // The room in front, and a little bounce from the floor below.
  float fill = 0.2 + 0.12 * max(0.0, n.z) + 0.05 * max(0.0, -n.y);
  // Deep in the socket, where the ball meets the wall, little light reaches.
  float socket = 0.35 + 0.65 * smoothstep(-0.05, 0.5, n.z);
  float light = (fill + 0.95 * lamp) * socket;
  if (uLidsOn > 0.5) {
    // The upper lid shades the eye just under it; the lower lid a little; and the upper lashes
    // cast a broken band of shadow across the top of it.
    vec2 s = lidSides(p);
    light *= 1.0 - 0.35 * smoothstep(-0.18, 0.0, s.x) - 0.12 * smoothstep(-0.1, 0.0, s.y);
    light *= lashShadow((p.x - uLidShell.x) / uLidShell.w, 0.02 - s.x, 0.34, 0.0, LASH_SHADE * uLampOn * uLashes);
  }
  return light;
}

// A smooth maximum, so the opening's corners are rounded.
float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

// A maximum rounded by a circle of radius r where both are within r of it, for a round end.
float roundMax(float a, float b, float r) {
  vec2 q = vec2(a, b) + r;
  return min(a, b) > -r ? length(q) - r : max(a, b);
}

// The wall with the eye's lids in it: the wall's plane pushed out by the ball behind it, the lid
// shell blended into the plane by a cubic fillet (continuous in slope and curvature, so it
// leaves the plane with no edge), distance in metres.
float lidField(vec3 p) {
  float sphere = length(p - uLidShell.xyz) - uLidShell.w;
  float plane = p.z - uWallOrigin.z;
  float k = LID_FILLET * uBall.w;
  float h = max(k - abs(sphere - plane), 0.0) / k;
  return min(sphere, plane) - h * h * h * k * (1.0 / 6.0);
}

vec3 lidNormal(vec3 p) {
  float e = 0.002 * uBall.w;
  vec2 o = vec2(1.0, -1.0);
  return normalize(
    o.xyy * lidField(p + o.xyy * e) + o.yyx * lidField(p + o.yyx * e) +
    o.yxy * lidField(p + o.yxy * e) + o.xxx * lidField(p + o.xxx * e));
}

// A highlight on a wet surface whose normal turns across a band 'across' (0 to 1) at 'turn'
// radians across it, kept at least a pixel ('px', in the band's share) wide so it never
// shimmers; its strength is kept as it widens.
float wetGlint(vec3 n, vec3 h, float sharp, float px, float turn) {
  float e = min(sharp, 1.0 / max(1e-6, turn * turn * px * px));
  return pow(max(0.0, dot(n, h)), e) * sqrt(e / sharp);
}

// What lies between the lids in front of the eye, premultiplied: the tears' meniscus along the
// lower margin, and at the inner corner the caruncle, the plica semilunaris beside it and the
// pool of tears round them. The caruncle hides the eye where it is solid.
vec4 opening(vec3 ro, vec3 rd, float ballT, float cover, float upperW) {
  vec3 hit = ro + rd * ballT;
  vec3 nb = normalize(hit - uBall.xyz);
  float px = uPxM / uLidShell.w;
  vec3 l = normalize(uLamp - hit);
  vec3 h = normalize(l - rd);
  float fall = lampFalloff(hit) * uLampOn;
  vec3 glint = vec3(1.0, 0.97, 0.92) * fall;
  vec4 col = vec4(0.0);
  float x = (hit.x - uLidShell.x) / uLidShell.w;

  // The meniscus: a thin strip of tears where the lower lid meets the eye, its surface curving
  // from the lid's edge up onto the eye, so it catches the lamp in a bright line.
  if (uTears < 0.5) return col;
  if (upperW < 0.5 && cover > -MENISCUS) {
    float t = clamp(-cover / MENISCUS, 0.0, 1.0);
    vec3 nm = normalize(mix(uLidLower.xyz, nb, t * t * (3.0 - 2.0 * t)));
    // Along the lower margin only, not round either corner.
    float k = (1.0 - smoothstep(PUNCTUM - 0.1, PUNCTUM, x)) * smoothstep(-0.82, -0.6, x);
    col.rgb += (glint * 1.4 * wetGlint(nm, h, 260.0, px / MENISCUS, 1.4) + 0.015) * k * (1.0 - smoothstep(0.1, 0.5, upperW));
  }

  if (x > CARUNCLE.x - CARUNCLE.y - PLICA_W - 0.06) {
    vec2 sb = lidSides(hit);
    // Across: x; up: from midway between the margins, so it stays nestled between the lids.
    float v = 0.5 * (sb.x - sb.y) + 0.01;
    float light = wallLight(nb);
    // The caruncle: a small, moist pink mound filling the corner, taller than the opening so
    // the lids tuck over its top and bottom, its surface lumpy with glands.
    vec2 e2 = vec2((x - CARUNCLE.x) / CARUNCLE.y, v / CARUNCLE.z);
    float e = length(e2);
    float dC = (e - 1.0) * CARUNCLE.y;
    float onCar = 1.0 - smoothstep(-px - 0.004, px, dC);
    // The plica: a soft, translucent pink fold of the eye's lining beside it, its free edge a
    // crescent facing the eye, wet along the edge and shading the white just past it.
    float xf = CARUNCLE.x - CARUNCLE.y - PLICA_W - 1.6 * v * v;
    float tall = 1.0 - smoothstep(0.08, 0.14, abs(v));
    float onPlica = smoothstep(xf - px, xf + px, x) * tall;
    float shade = exp(-pow((x - xf + 0.008) / max(0.007, px), 2.0)) * tall * (1.0 - onPlica);
    col = vec4(0.0, 0.0, 0.0, 0.18 * shade) + col * (1.0 - 0.18 * shade);
    if (onPlica > 0.0) {
      float into = clamp((x - xf) / PLICA_W, 0.0, 1.0);
      float rim = exp(-pow((x - xf - 0.004) / max(0.003, px), 2.0));
      vec3 c = mix(vec3(0.64, 0.42, 0.42), vec3(0.62, 0.3, 0.3), into) * light;
      float a = onPlica * mix(0.45, 0.85, into);
      col = col * (1.0 - a) + vec4(c, 1.0) * a;
      col.rgb += glint * 0.3 * rim * onPlica * smoothstep(0.2, 0.7, dot(nb, h));
    }
    // The pool of tears round the caruncle's foot shines.
    float pool = exp(-pow((dC - 0.004) / max(0.005, px), 2.0)) * (1.0 - onCar);
    col.rgb += glint * 0.06 * pool * smoothstep(0.3, 0.8, skinNoise(vec2(v * 60.0, 1.0), 15).x);
    if (onCar > 0.0) {
      // Its lobes and glands fade out where a pixel is too big for them, so they never sparkle.
      vec4 lobes = mix(vec4(0.5), skinNoise(vec2(x, v) * 55.0, 11), 1.0 - smoothstep(0.005, 0.012, px));
      vec4 fine = mix(vec4(0.5), skinNoise(vec2(x, v) * 150.0, 14), 1.0 - smoothstep(0.002, 0.005, px));
      float top = sqrt(max(0.0, 1.0 - e * e));
      vec3 albedo = mix(vec3(0.66, 0.24, 0.2), vec3(0.84, 0.46, 0.4), top);
      albedo = mix(albedo, vec3(0.82, 0.62, 0.52), 0.35 * smoothstep(0.75, 0.95, fine.x) * top);
      vec2 out2 = e2 / max(e, 1e-3);
      vec3 nc = normalize(nb + vec3(out2 * 1.3 * (1.0 - top) + (lobes.yz - 0.5) * 0.9 + (fine.yz - 0.5) * 0.3, 0.0));
      // It stands out of the corner into the light, darker at its foot where it dips into the
      // tears and in the creases between its lobes.
      vec3 c = albedo * light * 1.45 * (0.55 + 0.7 * max(0.0, dot(nc, l)));
      c *= (0.55 + 0.45 * smoothstep(0.0, 0.6, top)) * (0.85 + 0.15 * smoothstep(0.25, 0.6, lobes.w));
      c += glint * 0.7 * wetGlint(nc, h, 60.0, px, 1.0 / CARUNCLE.y);
      col = col * (1.0 - onCar) + vec4(c, 1.0) * onCar;
      if (dC < -6.0 * px) wallFrontHides = true;
    }
  }
  return col;
}

vec4 wallFront(vec3 ro, vec3 rd, float ballT) {
  if (uLidsOn < 0.5) return vec4(0.0);
  // March from the front of the bump to the wall.
  float zTop = uLidShell.z + uLidShell.w;
  float t = (zTop - ro.z) / min(rd.z, -1e-4);
  float tEnd = (uWallOrigin.z - ro.z) / min(rd.z, -1e-4);
  vec3 q = ro + rd * tEnd;
  float reach = uLidShell.w + LID_FILLET * uBall.w;
  // Rays that miss the bump see the plain wall (the backdrop draws it).
  if (length(q.xy - uLidShell.xy) > reach + 0.5 && length((ro + rd * t).xy - uLidShell.xy) > reach + 0.5) {
    return vec4(0.0);
  }
  float d = 1.0;
  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * t;
    d = lidField(p);
    if (d < 0.0004 * uBall.w || t > tEnd) break;
    t += d;
  }
  t = min(t, tEnd);
  vec3 p = ro + rd * t;
  // Past the bump the ray is on the wall itself, which the backdrop draws. Short of it, where the
  // march stops just above the flat wall, the front draws the wall the same way.
  if (p.z < uWallOrigin.z + 1e-5 * uBall.w) return vec4(0.0);
  vec2 s = lidSides(p);
  if (ballT > 0.0) s = max(s, lidSides(ro + rd * ballT));
  // The margins' planes meet along a line that runs on past the corners; close the opening a
  // little short of them, rounded, so the margins end there. The inner corner is rounder and
  // ends sooner, round the caruncle; the outer one is sharper.
  vec3 dS = normalize(p - uLidShell.xyz);
  float nasal = smoothstep(-0.5, 0.5, dS.x);
  float between = smax(s.x, s.y, mix(0.1 - 0.03 * uShape, 0.1, nasal));
  float cover = dS.x > 0.0
    ? (uTears > 0.5 ? roundMax(between, dS.x - CORNER_IN, CORNER_ROUND) : smax(between, dS.x - CORNER_PLAIN, 0.1))
    : smax(between, -dS.x - mix(CORNER_PLAIN, CORNER_OUT, uShape), 0.1 - 0.03 * uShape);
  float aa = fwidth(cover) + 1e-4;
  float on = smoothstep(-aa, aa, cover);
  // Which lid, blended through the corners so they stay smooth.
  float upperW = smoothstep(-0.04, 0.04, s.x - s.y);
  vec4 under = vec4(0.0);
  if (on < 1.0 && ballT > 0.0) under = opening(ro, rd, ballT, cover, upperW);
  if (on <= 0.0) return under;
  // Well inside the lids, the eye behind them can't show.
  wallFrontHides = wallFrontHides || cover > 6.0 * aa;
  float sd = cover;
  vec3 toward = normalize(mix(uLidLower.xyz, -uLidUpper.xyz, upperW));
  // How shut the opening is here, from the gap between the margins: shut, the lids meet in a
  // smooth line rather than two rolled edges.
  float shutHere = 1.0 - smoothstep(0.0, 0.12, -(s.x + s.y));
  // The margin rolls in onto the eye: its surface turns to face the opening.
  float roll = (1.0 - smoothstep(0.0, 0.06, sd)) * (1.0 - shutHere);
  vec3 n = normalize(mix(lidNormal(p), normalize(dS + 1.4 * toward), roll));
  // On the lids proper, not the fillet into the wall; and how curved the surface is, for skin's
  // light, falling to nothing where the fillet meets the wall.
  float off = length(p - uLidShell.xyz) - uLidShell.w;
  float lid = 1.0 - smoothstep(0.0, 0.15 * uBall.w, off);
  float curve = 1.0 - smoothstep(0.0, LID_FILLET * uBall.w, off);
  // The creases fade towards the corners, as a real lid's do, rather than running round the
  // bump.
  float mid = 1.0 - smoothstep(0.45, 0.9, abs(dS.x));
  float crease = lid * mid * mix(0.5 * exp(-pow((s.y - 0.22) / 0.06, 2.0)), exp(-pow((s.x - 0.4) / 0.06, 2.0)), upperW);
  float fold = lid * mid * upperW * exp(-pow((s.x - 0.46) / 0.07, 2.0));
  float edge = (1.0 - smoothstep(0.0, 0.04, sd)) * lid;
  vec3 paint = uPaint;
  if (uSkin > 0.5) {
    // Lids' skin is thin, a little darker and rosier. The upper margin is darker where the lashes
    // grow; the lower shows a little of the pink, wet inner margin.
    paint *= mix(vec3(1.0), vec3(0.9, 0.82, 0.84), 0.6 * lid);
    vec3 inner = mix(vec3(0.36, 0.16, 0.15), paint * vec3(1.05, 0.7, 0.68), 0.5);
    paint = mix(paint, mix(inner, paint * 0.45, max(upperW, shutHere)), edge * 0.7);
  } else {
    // Darker along the margin.
    paint = mix(paint, paint * LID_EDGE, edge * 0.85);
  }
  // On the margin's edge, details too small to draw on a small stage: a row of the oil glands'
  // openings, and near the inner corner the tear duct's opening, a small dark hole on a pale
  // mound, where the lashes stop.
  float fine = (1.0 - smoothstep(0.003, 0.007, uPxM / uLidShell.w)) * lid;
  if (fine > 0.0 && sd < 0.03 && uTears > 0.5) {
    float along = asin(clamp(dS.x, -1.0, 1.0)) / 0.042;
    float cell = floor(along);
    uint gh = skinHash(ivec3(int(cell), upperW > 0.5 ? 1 : 2, 13));
    float gx = cell + 0.3 + 0.4 * float(gh & 255u) / 255.0;
    float dg = length(vec2((along - gx) * 0.042, sd - 0.008 - 0.004 * float((gh >> 8) & 255u) / 255.0)) / 0.0038;
    float gland = (1.0 - smoothstep(0.6, 1.0, dg)) * (1.0 - smoothstep(PUNCTUM - 0.05, PUNCTUM - 0.02, dS.x));
    paint *= 1.0 - 0.2 * gland * fine;
    float dp = length(vec2((dS.x - PUNCTUM) / 0.022, (sd - 0.011) / 0.013));
    paint = mix(paint, paint * 1.35 + vec3(0.02, 0.015, 0.015), (1.0 - smoothstep(0.6, 1.0, dp)) * fine);
    paint *= 1.0 - 0.8 * (1.0 - smoothstep(0.22, 0.38, dp)) * fine;
  }
  // The margins' sheen and the lower one's wet edge stop short of the corners, which would
  // otherwise catch the lamp in a ring round them.
  float alongLid = 1.0 - smoothstep(0.5, 0.78, abs(dS.x));
  vec3 col = wallShade(p, n, rd, paint, curve, 0.25 * roll * alongLid) * (1.0 - LID_CREASE * crease) * (1.0 + 0.5 * LID_CREASE * fold);
  // The lower lashes' soft shadow on the lid below them.
  col *= lashShadow(dS.x, sd - 0.06, 0.5, 1.0, LOW_LASH_SHADE * (1.0 - upperW) * lid * uLampOn * uLashes);
  // The wet edge of the lower lid catching the light.
  float wet = (1.0 - upperW) * lid * exp(-pow(sd / 0.008, 2.0)) * (1.0 - shutHere) * alongLid;
  col += vec3(0.05, 0.05, 0.055) * wet * (0.4 + 0.6 * uLampOn);
  return vec4(col * on, on) + under * (1.0 - on);
}

vec3 wallBackdrop(vec3 ro, vec3 rd) {
  // Where the ray meets the wall's plane.
  float t = (uWallOrigin.z - ro.z) / min(rd.z, -1e-4);
  vec3 p = ro + rd * t;
  vec3 c = uBall.xyz;
  float R = uBall.w;
  // Distance from the ball's axis across the wall, in ball radii past its edge.
  vec2 q = (p.xy - c.xy) / R;
  float rho = length(q);
  float s = (rho - 1.0) / SOCKET_W;
  vec3 n = vec3(0.0, 0.0, 1.0);
  float hollow = 0.0;
  // With lids, the wall swells into them instead (drawn in front).
  if (s < 1.0 && uLidsOn < 0.5) {
    // The wall curves back into the socket: its slope tips the surface towards the ball.
    float k = clamp(1.0 - s, 0.0, 1.0);
    float slope = 2.0 * SOCKET_D * k / SOCKET_W;
    vec2 radial = q / max(rho, 1e-4);
    n = normalize(vec3(-radial * slope, 1.0));
    hollow = k * k;
  }
  return wallShade(p, n, rd, uPaint, 0.0, 0.0) * (1.0 - 0.8 * hollow);
}
`;
