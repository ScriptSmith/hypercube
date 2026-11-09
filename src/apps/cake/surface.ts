/**
 * The ball's surface, for a `SurfacePass`. Each direction turns into the pudding's own frame,
 * looks up the baked skin and the glaze field, and works out:
 *
 * - the glaze: covered where its thickness passes a small threshold (crisp edges from a soft
 *   field), opaque and ivory where thick and fresh, greyer and translucent where thin or old with
 *   the pudding showing through, its own smooth surface tilted by the field's slope, so every
 *   edge has a raised rim and every bead a dome;
 * - the drop hanging at the bottom pole and the drops letting go, drawn exactly here because
 *   they change quickly;
 * - what sits in the glaze on top: sprinkles as pieces lying in it, each lit as a little rod,
 *   and the sprig of holly on the pudding's hidden top.
 *
 * Each cake sets the glaze's colour (or a marbling bake for the galaxy), how opaque it is, how
 * glossy, and its topping.
 * Light belongs to the room: a soft overhead light and a ring of small ceiling lamps, a dim
 * ceiling and walls, a dark floor. With people all round there is no one viewer, so each point is
 * lit as seen by someone standing on its side of the ball (or right below it, underneath), and
 * the glaze's highlights stay put in the room while the pudding turns under them.
 */
import { HEIGHT_MAX, SLOPE_MAX } from "./bake";
import { MAX_DROPS } from "./glaze";
import { EQ_GLSL, f, NOISE_GLSL } from "./glsl";

/** Most sprinkle colours a cake has. */
export const SPRINKLE_COLOURS = 8;

/** Radians of the ball per unit of glaze thickness, for its surface's slope. */
export const GLAZE_UNIT = 0.018;
/** Thickness at which glaze counts as there. */
const EDGE = 0.06;

export const SURFACE_GLSL = /* glsl */ `
${EQ_GLSL}
${NOISE_GLSL}
uniform mat3 uSpin;
uniform sampler2D uColour;
uniform sampler2D uSlope;
uniform sampler2D uField;
uniform vec2 uFieldSize;
uniform vec3 uGlaze;
uniform vec3 uThin;
uniform vec2 uOpacity;
uniform float uShine;
uniform float uPoke;
uniform float uRelief;
uniform float uDrape;
uniform float uMarble;
uniform sampler2D uTint;
uniform int uTopping;
uniform vec3 uSprinkle[${SPRINKLE_COLOURS}];
uniform int uSprinkles;
uniform float uHolly;
uniform vec4 uDrop[${MAX_DROPS}];
uniform vec3 uBottom;
uniform float uCentreY;
uniform float uRadius;
uniform float uHidden;
uniform float uExposure;

const float PI = 3.141592653589793;
const float EYE = 1.6;

// The room as a glossy surface mirrors it, in venue direction r; 'sharp' near 1 for the cake's
// broken sheen, higher for the glaze. 'lampK' scales the ring of lamps, which a rough skin would
// mirror for everyone round the ball as one smeared ring.
float room(vec3 r, float sharp, float lampK) {
  float soft = 1.0 / sharp;
  float box = smoothstep(0.975 - 0.3 * soft, 0.975, r.y);
  float ceiling = 0.07 * smoothstep(-0.1, 0.7, r.y);
  float walls = 0.06 * exp(-r.y * r.y * 4.0);
  float floor_ = 0.03 * smoothstep(0.1, -0.6, r.y);
  // A ring of small lamps in the ceiling, each lighting a little of the ceiling round it.
  float b = atan(r.x, r.z);
  float e = asin(clamp(r.y, -1.0, 1.0));
  float lb = b * 8.0 / (2.0 * PI);
  float near = (lb - floor(lb + 0.5)) * 2.0 * PI / 8.0;
  float dist = length(vec2(near * cos(e), e - 0.9));
  float size = 0.03 + 0.12 * soft;
  float lamps = lampK * 5.0 * (1.0 - smoothstep(size * 0.6, size, dist)) / (1.0 + 6.0 * soft);
  return 1.8 * box + lamps + ceiling + walls + floor_ + 0.01;
}

vec3 eastOf(vec3 p) {
  float hl = length(p.xz);
  return hl > 1e-4 ? vec3(p.z, 0.0, -p.x) / hl : vec3(1.0, 0.0, 0.0);
}

// A bead seen face on: a dome of radius 'r' (radians) round 'c', in the pudding's frame. Returns
// coverage and sets the normal.
float bead(vec3 p, vec3 c, float r, out vec3 n) {
  n = p;
  float a = dot(p, c);
  if (r <= 0.0 || a < 0.9) return 0.0;
  vec3 t = p - c * a;
  float q = length(t) / r;
  if (q >= 1.0) return 0.0;
  vec3 outward = length(t) > 1e-6 ? t / length(t) : vec3(0.0);
  // Kept short of grazing at the rim, which would mirror the walls as a hard bright ring.
  float z = max(sqrt(1.0 - q * q), 0.35);
  n = normalize(p * z + outward * q);
  return 1.0;
}

// The holly on the top: three spined leaves and three berries, in flat coordinates round the top
// pole (about radians from it, divided by HOLLY_SCALE). Returns coverage, colour, gloss and a
// tilt of the normal. Larger than life on a pudding, so its tips reach towards where the upper
// level can see.
const float HOLLY_SCALE = 1.8;
float holly(vec2 q, out vec3 col, out float gloss, out vec2 tilt) {
  col = vec3(0.0);
  gloss = 1.0;
  tilt = vec2(0.0);
  float cover = 0.0;
  for (int k = 0; k < 3; k++) {
    float a = float(k) * 2.0944 + 0.35 + 0.15 * float(k * k);
    vec2 ax = vec2(cos(a), sin(a));
    vec2 ay = vec2(-ax.y, ax.x);
    float s = dot(q, ax) - 0.035;
    float x = dot(q, ay) + 0.02 * sin(s * 9.0 + float(k));
    float len = 0.4 - 0.04 * float(k);
    float t = s / len;
    if (t <= 0.0 || t >= 1.0) continue;
    float w = 0.11 * pow(sin(PI * pow(t, 0.8)), 0.7);
    // Spines along the edge: the outline dips between them.
    float spine = fract(t * 4.5 + 0.25 * float(k));
    w *= 0.72 + 0.28 * pow(abs(2.0 * spine - 1.0), 2.5);
    float ex = abs(x) / max(w, 1e-4);
    if (ex >= 1.0) continue;
    float c = 1.0 - smoothstep(0.93, 1.0, ex);
    if (c <= cover) continue;
    cover = c;
    float rib = exp(-pow(x / 0.006, 2.0));
    col = mix(vec3(0.005, 0.034, 0.008), vec3(0.03, 0.07, 0.02), rib);
    // Folded up along the midrib, and waved along the edge.
    float side = sign(x);
    tilt = ay * side * (0.35 * ex) + ax * 0.25 * sin(t * 28.0) * ex;
  }
  for (int k = 0; k < 3; k++) {
    float a = float(k) * 2.0944 + 1.4;
    // Off-centre, so the pole sits inside one berry rather than where three rims meet, which
    // would pinch round the feed's top row.
    vec2 c = vec2(cos(a), sin(a)) * 0.04 + vec2(0.03, 0.0);
    vec2 d = q - c;
    float r = 0.042;
    float l = length(d) / r;
    if (l >= 1.0) continue;
    cover = 1.0;
    col = vec3(0.42, 0.012, 0.01) * (1.0 - 0.7 * exp(-dot(d - vec2(0.006), d - vec2(0.006)) / 0.00004));
    gloss = 1.3;
    tilt = d / r * (1.6 / max(sqrt(1.0 - l * l), 0.25));
  }
  return cover;
}

// Sprinkles lying in the glaze on top: rods along the surface in random directions, one in
// some cells of a 3D grid whose middle lies close to the surface (so only the eight nearest
// cells can reach a point). Returns coverage and sets colour and normal.
const float SPR_F = 11.0;
float sprinkle(vec3 p, out vec3 col, out vec3 n) {
  col = vec3(0.0);
  n = p;
  vec3 q = p * SPR_F;
  vec3 iq = floor(q);
  float best = 0.0;
  float chocolate = uTopping == 1 ? 1.0 : 0.0;
  for (int k = 0; k < 8; k++) {
    ivec3 c = ivec3(iq) + ivec3(step(0.5, q - iq)) - 1 + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec4 h = hash43(c + ivec3(77, 5, 301));
    if (h.x > 0.95) continue;
    vec3 centre = vec3(c) + 0.5 + (h.yzw - 0.5) * 0.4;
    float r = length(centre);
    if (abs(r - SPR_F) > 0.3) continue;
    vec3 cs = centre / r;
    vec4 g = hash43(c + ivec3(13, 901, 7));
    vec3 ref = abs(cs.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(ref, cs));
    vec3 t2 = cross(cs, t1);
    float a = g.x * 6.2831853;
    vec3 ax = cos(a) * t1 + sin(a) * t2;
    vec3 side = cross(cs, ax);
    vec3 dp = p - cs;
    float along = dot(dp, ax);
    float across = dot(dp, side);
    float halfLen = mix(0.03, 0.022, chocolate) * (0.75 + 0.25 * g.y);
    float rad = mix(0.0075, 0.0085, chocolate);
    vec2 rr = vec2(max(abs(along) - halfLen, 0.0), across) / rad;
    float dist = length(rr);
    if (dist >= 1.0) continue;
    float cover = smoothstep(1.0, 0.8, dist);
    if (cover <= best) continue;
    best = cover;
    float z = sqrt(max(0.0, 1.0 - dist * dist));
    n = normalize(cs * z + ax * sign(along) * rr.x + side * rr.y);
    int idx = int(g.z * float(uSprinkles)) % max(uSprinkles, 1);
    col = uSprinkle[idx];
  }
  return best;
}

vec4 surface(vec3 dir) {
  vec3 p = uSpin * dir;
  vec2 uv = eqUv(p);
  vec4 C = texture2D(uColour, uv);
  vec4 S = texture2D(uSlope, uv);
  vec3 albedo = C.rgb * C.rgb;
  float gloss = C.a * 1.2;
  vec3 gP = (S.rgb * 2.0 - 1.0) * ${f(SLOPE_MAX)};
  float hP = (S.a - 0.5) * ${f(2 * HEIGHT_MAX)};

  // The glaze field and its slope.
  vec2 px = 1.0 / uFieldSize;
  vec4 F = texture2D(uField, uv);
  float hE = texture2D(uField, uv + vec2(px.x, 0.0)).r;
  float hW = texture2D(uField, uv - vec2(px.x, 0.0)).r;
  float hN = texture2D(uField, uv + vec2(0.0, px.y)).r;
  float hS = texture2D(uField, uv - vec2(0.0, px.y)).r;
  float lat = (uv.y - 0.5) * PI;
  float cl = max(cos(lat), 0.02);
  vec3 east = eastOf(p);
  vec3 north = cross(p, east);
  vec3 gG = east * (hE - hW) / (2.0 * 2.0 * PI * px.x * cl) + north * (hN - hS) / (2.0 * PI * px.y);
  gG *= ${f(GLAZE_UNIT)};
  float gl = length(gG);
  gG *= min(1.0, 2.5 / max(gl, 1e-6));

  // Pieces standing out of the cake push through glaze that is thin over them.
  float h = F.r - uPoke * max(hP, 0.0) / ${f(GLAZE_UNIT)};
  float aa = max(fwidth(h) * 0.75, 0.004);
  float cover = smoothstep(${f(EDGE)} - aa, ${f(EDGE)} + aa, h);
  float fresh = clamp(F.g / max(F.r, 1e-3), 0.0, 1.0);
  float sheen = F.b * (1.0 - cover);
  // The glaze lies level over the pudding's lumps, so it is thinner over them.
  float hO = max(0.7 * h, h - 0.04 * hP / ${f(GLAZE_UNIT)});
  float alpha = (1.0 - exp(-mix(uOpacity.x, uOpacity.y, fresh) * hO)) * cover;

  vec3 nP = normalize(p - gP);
  vec3 nG = normalize(p - gG - uDrape * gP);
  // Thin glaze over the cake takes on a tint (icing goes grey); thick glaze scatters more light.
  vec3 base = uGlaze;
  float speck = 0.0;
  if (uMarble > 0.0) {
    vec4 T = texture2D(uTint, uv);
    base = T.rgb * T.rgb;
    speck = T.a * cover;
  }
  vec3 glazeCol = mix(base * uThin * 0.7, base, smoothstep(0.15, 0.95, alpha));
  glazeCol *= 0.8 + 0.25 * smoothstep(0.3, 1.6, h);
  float glazeGloss = mix(1.0, 1.35, fresh) * uShine;
  float wet = cover;

  // Old glaze leaves the skin glossy and a little darker and warmer for a while.
  gloss = mix(gloss, 1.2, sheen);
  albedo = mix(albedo, albedo * vec3(0.85, 0.8, 0.75), sheen * 0.6);
  albedo *= 1.0 - 0.25 * F.a * (1.0 - cover);

  // The hanging drop at the bottom pole, and the drops letting go.
  float extra = 0.0;
  vec3 nX = p;
  if (p.y < -0.9 && uBottom.x > 0.0) {
    vec3 nb;
    float c = bead(p, vec3(0.0, -1.0, 0.0), uBottom.x * (1.0 - 0.12 * uBottom.y), nb);
    if (c > 0.0) {
      extra = c;
      nX = nb;
    }
  }
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec4 D = uDrop[i];
    if (D.w <= 0.0) continue;
    vec3 nb;
    float c = bead(p, D.xyz, D.w, nb);
    if (c > extra) {
      extra = c;
      nX = nb;
    }
  }
  if (extra > 0.0) {
    alpha = max(alpha, extra);
    nG = nX;
    wet = max(wet, extra);
    glazeCol = base;
    glazeGloss = 1.4 * uShine;
  }

  // Holly on the top, nearly all of it above where people see.
  vec3 hollyCol;
  float hollyGloss;
  vec2 tilt;
  float leaf = 0.0;
  if (uHolly > 0.0 && p.y > 0.65) {
    vec2 q = p.xz * (2.0 / (1.0 + p.y)) / HOLLY_SCALE;
    leaf = holly(q, hollyCol, hollyGloss, tilt);
  }

  // Light it in the room's frame.
  vec3 pw = vec3(0.0, uCentreY, 0.0) + uRadius * dir;
  vec2 hz = dir.xz;
  float hl = length(hz);
  hz = hl > 1e-5 ? hz / hl : vec2(0.0, 1.0);
  float far = 4.0 * uRadius * smoothstep(-0.92, -0.35, dir.y);
  vec3 v = normalize(vec3(hz.x * far, EYE, hz.y * far) - pw);

  // A light a little above whoever looks, so rounded glaze and fruit catch a highlight from
  // every side, as in a photograph.
  vec3 lamp = normalize(v + vec3(0.0, 0.6, 0.0));
  if (dot(lamp, dir) < 0.1) lamp = v;
  vec3 hv = normalize(lamp + v);

  // Smooth skin would catch the light above each viewer at the same angle all round, as one
  // ring, so only lumps take it.
  float bumpy = smoothstep(0.01, 0.08, 1.0 - dot(nP, p));
  vec3 n1 = normalize(nP * uSpin);
  float key1 = 0.4 + 0.6 * pow(0.5 + 0.5 * n1.y, 1.3);
  float fill1 = 0.2 * max(0.0, -n1.y) + 0.05;
  // Lumps are also shaded by the light above whoever looks, against the smooth surface there, so
  // their sides fall away into shade from every side and underneath, where the room's light is flat.
  float rel = clamp(dot(n1, lamp) / max(dot(dir, lamp), 0.2), 0.0, 1.3);
  key1 *= mix(1.0, rel, uRelief);
  float nv1 = max(dot(n1, v), 0.05);
  float fres1 = 0.04 + 0.96 * pow(1.0 - nv1, 5.0);
  vec3 skin = albedo * (key1 + fill1) + vec3(1.0, 0.95, 0.88) * (fres1 * room(reflect(-v, n1), 1.0 + 1.5 * gloss, 0.2) * 0.42 + 0.1 * pow(max(dot(n1, hv), 0.0), 40.0) * bumpy) * gloss;

  vec3 n2 = normalize(nG * uSpin);
  // Icing scatters light inside itself, so it shades more softly than the skin.
  float key2 = 0.32 + 0.68 * pow(0.5 + 0.5 * n2.y, 1.5);
  float fill2 = 0.28 * max(0.0, -n2.y) + 0.06;
  float nv2 = max(dot(n2, v), 0.05);
  // Kept short of a full mirror at grazing angles, so dark glazes stay dark seen from below.
  float fres2 = 0.035 + 0.5 * pow(1.0 - nv2, 5.0);
  // Sides turned away from whoever looks are darker, which shows the glaze's round section.
  vec3 glaze = glazeCol * (key2 * (0.6 + 0.4 * nv2) + fill2);
  vec3 glint = vec3(1.0, 0.98, 0.95) * (fres2 * room(reflect(-v, n2), 6.0, 1.0) + 0.5 * pow(max(dot(n2, hv), 0.0), 160.0)) * glazeGloss;

  vec3 col = mix(skin, glaze, alpha) + glint * wet;

  // Star specks in the galaxy glaze catch the light.
  if (speck > 0.0) {
    vec3 sc = vec3(0.7, 0.63, 0.45) * (0.45 + 0.55 * key2) + vec3(1.0, 0.95, 0.85) * 0.5 * pow(max(dot(n2, hv), 0.0), 12.0);
    col = mix(col, sc, speck);
  }
  // Sprinkles lying in the glaze on top.
  if (uTopping > 0 && p.y > 0.42 && cover > 0.5) {
    vec3 sCol;
    vec3 sN;
    float sp = sprinkle(p, sCol, sN) * smoothstep(0.42, 0.52, p.y) * cover;
    if (sp > 0.0) {
      vec3 n4 = normalize(sN * uSpin);
      float key4 = 0.4 + 0.6 * pow(0.5 + 0.5 * n4.y, 1.3);
      float nv4 = max(dot(n4, v), 0.05);
      float fres4 = 0.04 + 0.96 * pow(1.0 - nv4, 5.0);
      vec3 sc = sCol * (key4 + 0.06) + vec3(1.0, 0.97, 0.92) * (fres4 * room(reflect(-v, n4), 3.0, 1.0) * 0.7 + 0.25 * pow(max(dot(n4, hv), 0.0), 60.0));
      col = mix(col, sc, sp);
    }
  }

  if (leaf > 0.0) {
    vec3 nl = normalize(p + vec3(tilt.x, 0.0, tilt.y));
    vec3 n3 = normalize(nl * uSpin);
    float key3 = 0.4 + 0.6 * pow(0.5 + 0.5 * n3.y, 1.3);
    float nv3 = max(dot(n3, v), 0.05);
    float fres3 = 0.04 + 0.96 * pow(1.0 - nv3, 5.0);
    vec3 lc = hollyCol * key3 + vec3(1.0) * fres3 * room(reflect(-v, n3), 3.0, 1.0) * hollyGloss;
    col = mix(col, lc, leaf);
  }

  // Nobody sees the top well, so it needn't be as bright.
  col *= uExposure * mix(1.0, 0.75, smoothstep(uHidden, uHidden + 0.2, dir.y));
  return vec4(col, 1.0);
}
`;
