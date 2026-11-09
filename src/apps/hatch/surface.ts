/**
 * The per-frame shader: the colour of the ball in each direction from its centre. The ball is
 * the shell (lit from above, cracked, with the pip's hole and the beak in it), the pieces
 * coming away, the membrane, the chick, or the egg glowing over a candling lamp with the
 * shadows inside it. Most of the detail comes from textures made earlier (see `bakes.ts` and
 * `raster.ts`), so each pixel does a few lookups and a little arithmetic.
 *
 * Frames: "room" is the direction from the runtime, y up. `uEgg` turns it into the egg's own
 * frame (blunt end up) and `uChick` into the chick's (face towards +z, crown up). Colours are
 * linear.
 */
import { EQ_GLSL } from "./glsl";
import { CRACK_RANGE, DAY_SCALE, VEIN_RANGE } from "./raster";

export const MAX_PIECES = 8;

export const SURFACE = /* glsl */ `
${EQ_GLSL}
#define MAX_PIECES ${MAX_PIECES}
const float CRACK_RANGE = ${CRACK_RANGE.toFixed(4)};
const float VEIN_RANGE = ${VEIN_RANGE.toFixed(4)};
const float DAY_SCALE = ${DAY_SCALE.toFixed(1)};

uniform mat3 uEgg;
uniform mat3 uChick;
uniform sampler2D uShell;
uniform sampler2D uData;
uniform sampler2D uPieces;
uniform sampler2D uDown;
uniform sampler2D uText;
uniform float uPx;
uniform float uBright;
uniform float uCrack;
uniform int uMode;

uniform vec3 uPip;
uniform vec3 uPipE;
uniform vec3 uPipN;
uniform float uHole;
uniform float uHoleR;
uniform vec2 uBeakOff;

uniform mat3 uCapInv;
uniform float uCapScale;
uniform float uCapAlpha;
uniform float uCapLoose;
uniform mat3 uPieceInv[MAX_PIECES];
uniform vec3 uPieceC[MAX_PIECES];
uniform float uPieceScale[MAX_PIECES];
uniform float uPieceAlpha[MAX_PIECES];
uniform float uPieceLoose[MAX_PIECES];
uniform int uPieceN;
uniform float uTear;

uniform float uDry;
uniform float uLids;
uniform float uBeak;
uniform float uWings;
uniform vec3 uDownDry;
uniform vec3 uDownWet;
uniform vec3 uUpChick;
uniform vec3 uEyeC[2];
uniform vec3 uEyeE[2];
uniform vec3 uEyeN[2];
uniform float uEyeR;
uniform vec3 uBeakC;
uniform vec3 uBeakE;
uniform vec3 uBeakN;
uniform vec2 uBeakSize;
uniform vec3 uWingC[2];
uniform vec3 uWingE[2];
uniform vec3 uWingN[2];

uniform float uCandle;
uniform float uDay;
uniform vec3 uGlow;
uniform vec3 uGlowAir;
uniform float uShellLum;
uniform vec3 uAirN;
uniform float uAirH;
uniform vec4 uYolk;
uniform float uYolkK;
uniform vec3 uEmb;
uniform vec3 uEmbE;
uniform vec3 uEmbN;
uniform float uEmbSize;
uniform float uEmbK;
uniform float uEmbAng;
uniform float uEmbEye;
uniform float uHeart;
uniform float uDark;
uniform float uDarkR;
uniform float uSmallEnd;
uniform float uDetail;
uniform vec3 uLip;
uniform float uVein;
uniform float uPipIn;
uniform vec3 uPipInC;

uniform vec2 uTextBand;
uniform float uTextOn;

float hemi(vec3 w) {
  return mix(0.62, 1.0, smoothstep(-0.75, 0.9, w.y));
}

/** Tangent-plane coordinates of d round a centre with east and north directions. */
vec2 local(vec3 d, vec3 c, vec3 e, vec3 n) {
  vec3 v = d - c * dot(d, c);
  return vec2(dot(v, e), dot(v, n));
}

/** Like local, but measured along the surface, so it holds far from the centre too. */
vec2 around(vec3 d, vec3 c, vec3 e, vec3 n) {
  vec3 v = d - c * dot(d, c);
  float l = length(v);
  float ang = acos(clamp(dot(d, c), -1.0, 1.0));
  return l > 1e-6 ? vec2(dot(v, e), dot(v, n)) * (ang / l) : vec2(0.0);
}

int pieceId(vec3 d) {
  return int(texture2D(uPieces, eqUv(d)).r * 255.0 + 0.5);
}

/** Roughly signed distance to a triangle with its base at y = top (half width w), tip at y = tip. */
float beakShape(vec2 p, float w, float top, float tip) {
  float t = clamp((p.y - tip) / (top - tip), 0.0, 1.0);
  float hw = w * sqrt(t);
  return max(abs(p.x) - hw, max(p.y - top, tip - p.y));
}

/** The shell at s (egg frame) seen in room direction w; loose pieces show white broken edges. */
vec3 shellAt(vec3 s, vec3 w, float loose) {
  vec2 uv = eqUv(s);
  vec3 alb = texture2D(uShell, uv).rgb;
  alb *= alb;
  vec4 dat = texture2D(uData, uv);
  float L = hemi(w);
  // A soft sheen from the cuticle under the room light.
  // Kept below full white: a pale egg fills the ball for minutes, over people's heads.
  vec3 col = alb * L * 0.9 + vec3(0.06) * pow(max(w.y, 0.0), 8.0);
  float aa = uPx * 1.2;
  // Chipped edges are never smooth: a little noise moves them in and out.
  float rough = texture2D(uDown, uv).r - 0.5;
  float sdf = dat.r * 2.0 * CRACK_RANGE - CRACK_RANGE + 0.0016 * rough;
  float on = step(dat.g, uCrack + 0.002) * step(dat.g, 0.99);
  float line = (1.0 - smoothstep(-aa, aa, sdf)) * on;
  // Here and there a pale flake of broken shell beside the crack.
  float flake = smoothstep(0.1, 0.3, rough);
  float rim = smoothstep(-aa, aa, sdf) * (1.0 - smoothstep(0.0, 0.005, sdf)) * on * flake;
  vec3 lip = uLip * 0.8 * L;
  col = mix(col, lip, rim * 0.35);
  // The gap: the shell's own colour deep in shadow; a broken edge once a piece comes away.
  vec3 gap = mix(alb * 0.25, vec3(0.035, 0.03, 0.025), 0.5) * L;
  col = mix(col, mix(gap, lip, loose), line * 0.92);
  // Inside a peck: the white membrane, and a dark hole through it.
  float rough2 = texture2D(uDown, uv).b - 0.5;
  float memb = (1.0 - smoothstep(-0.0045 - aa, -0.0045 + aa, sdf + 0.003 * rough2)) * on;
  float deep = (1.0 - smoothstep(-0.0065 - aa, -0.0065 + aa, sdf + 0.005 * rough2)) * on;
  col = mix(col, vec3(0.5, 0.48, 0.44) * L, memb * 0.7 * (1.0 - loose));
  col = mix(col, vec3(0.025, 0.02, 0.016), deep * (1.0 - loose));

  // The pip: a ragged hole with the membrane's torn edge and the tip of the beak in it.
  if (uHole > 0.0) {
    float c = dot(s, uPip);
    if (c > 0.97) {
      vec2 q = local(s, uPip, uPipE, uPipN);
      float a = atan(q.y, q.x);
      float jag = 0.14 * sin(3.0 * a + 1.3) + 0.07 * sin(7.0 * a + 0.4) + 0.045 * sin(13.0 * a + 2.0) + 0.025 * sin(23.0 * a + 0.7);
      float R = uHole * uHoleR * (1.0 + jag + 0.12 * rough);
      float r = length(q);
      float inside = 1.0 - smoothstep(R - aa, R + aa, r);
      float chips = (1.0 - smoothstep(R, R * 1.3, r)) * (1.0 - inside) * flake;
      col = mix(col, lip, chips * 0.5 * (1.0 - loose));
      if (inside > 0.0) {
        vec3 hole = vec3(0.025, 0.02, 0.016);
        hole = mix(hole, vec3(0.7, 0.68, 0.62) * L, smoothstep(R * 0.8, R * 0.95, r));
        vec2 b = (q - uBeakOff * uHoleR) / uHoleR;
        float show = smoothstep(0.3, 0.55, uHole);
        float tip = 1.0 - smoothstep(-aa / uHoleR, aa / uHoleR, beakShape(b, 0.36, 0.3, -0.42));
        vec3 horn = vec3(0.84, 0.64, 0.44) * (0.75 + 0.35 * smoothstep(-0.4, 0.3, b.y)) * L;
        hole = mix(hole, horn, tip * show);
        float tooth = 1.0 - smoothstep(0.035, 0.06, length(b - vec2(0.0, -0.3)));
        hole = mix(hole, vec3(0.93, 0.92, 0.88) * L, tooth * tip * show);
        col = mix(col, hole, inside * (1.0 - loose));
      }
    }
  }
  return col;
}

/** The chick at room direction w. */
vec3 chickAt(vec3 w) {
  vec3 c = uChick * w;
  vec4 dn = texture2D(uDown, eqUv(c));
  float L = hemi(w);
  float fine = dn.r;
  float clump = dn.g;
  float tuft = dn.b;
  float broad = dn.a;
  vec3 dryCol = uDownDry * (0.9 + 0.16 * (tuft - 0.5) + 0.06 * (fine - 0.5) + 0.1 * (broad - 0.5));
  float crev = smoothstep(0.25, 0.65, clump);
  // Wet down lies in flat darker strands; keep it soft, not stringy.
  vec3 wetCol = uDownWet * (0.8 + 0.22 * crev + 0.1 * (tuft - 0.5)) * (0.95 + 0.1 * (fine - 0.5));
  vec3 col = mix(wetCol, dryCol, uDry) * L;
  float sheen = pow(clamp(clump, 0.0, 1.0), 4.0) * (1.0 - uDry) * smoothstep(-0.2, 0.8, w.y);
  col += sheen * 0.06 * vec3(1.0, 0.96, 0.88);
  float aa = uPx * 1.3;

  // Wings: a stubby wing held at each side, its tip back and down, a fluffy scalloped edge.
  for (int i = 0; i < 2; i++) {
    if (dot(c, uWingC[i]) < 0.8) continue;
    vec2 q = local(c, uWingC[i], uWingE[i], uWingN[i]);
    float side = i == 0 ? -1.0 : 1.0;
    // x runs backwards along the body, y up; the wing lifts a little in a shake.
    vec2 r = vec2(q.x * side, q.y);
    float ang = -0.5 - uWings * 0.3;
    r = vec2(cos(ang) * r.x - sin(ang) * r.y, sin(ang) * r.x + cos(ang) * r.y);
    float taper = mix(1.0, 0.5, smoothstep(-0.05, 0.3, r.x));
    float scallop = 0.08 * abs(sin(r.x * 28.0)) * smoothstep(0.0, -0.06, r.y);
    float e = length(vec2(r.x / 0.27, r.y / (0.13 * taper))) + scallop + 0.12 * (tuft - 0.5);
    float inWing = 1.0 - smoothstep(0.9, 1.02, e);
    float below = smoothstep(-0.02, 0.05, -r.y);
    float shadow = (1.0 - smoothstep(1.0, 1.25, e)) * smoothstep(0.95, 1.02, e) * below;
    col *= 1.0 - 0.14 * shadow;
    col = mix(col, col * vec3(1.03, 0.97, 0.86), inWing * 0.7);
    col *= 1.0 + 0.1 * smoothstep(0.4, 0.9, e) * inWing * (1.0 - below);
  }

  // Feet tucked underneath, toes forward, the heels lost in the down.
  if (c.y < -0.88) {
    vec2 q = vec2(c.x, c.z);
    float feet = 0.0;
    float scale = 0.0;
    for (int f = 0; f < 2; f++) {
      vec2 heel = vec2(f == 0 ? -0.13 : 0.13, -0.06);
      for (int t = 0; t < 4; t++) {
        float ang = t == 3 ? -1.5708 : 1.5708 + (float(t) - 1.0) * 0.5;
        float len = t == 3 ? 0.05 : (t == 1 ? 0.17 : 0.14);
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 v = q - heel;
        float h = clamp(dot(v, dir), 0.0, len);
        float d = length(v - dir * h) - 0.024 * (1.0 - 0.3 * h / len);
        float toe = 1.0 - smoothstep(-aa, aa, d);
        if (toe > feet) {
          feet = toe;
          scale = sin(h * 140.0);
        }
      }
    }
    float tucked = smoothstep(0.02, 0.1, q.y + 0.06 + 0.04 * (tuft - 0.5));
    feet *= mix(tucked, 1.0, 0.45);
    vec3 skin = vec3(0.93, 0.55, 0.22) * (0.92 + 0.08 * scale) * L;
    col = mix(col * (1.0 - 0.25 * smoothstep(0.0, 1.0, feet)), skin, feet);
  }

  // The face: two dark eyes with a catchlight from the room light, a small beak with its egg tooth.
  if (c.z > 0.4) {
    for (int i = 0; i < 2; i++) {
      vec2 q = local(c, uEyeC[i], uEyeE[i], uEyeN[i]);
      float r = length(q);
      float R = uEyeR;
      if (r > R * 1.6) continue;
      float inEye = 1.0 - smoothstep(R - aa, R + aa, r);
      float ring = (1.0 - smoothstep(R, R * 1.18, r)) * (1.0 - inEye);
      col *= 1.0 - 0.35 * ring;
      vec3 iris = mix(vec3(0.05, 0.03, 0.018), vec3(0.012, 0.01, 0.008), 1.0 - smoothstep(R * 0.45, R * 0.8, r));
      vec2 lightDir = vec2(dot(uUpChick, uEyeE[i]), dot(uUpChick, uEyeN[i]));
      vec2 hl = lightDir * R * 0.5;
      float glint = 1.0 - smoothstep(R * 0.1, R * 0.2, length(q - hl));
      float glint2 = 1.0 - smoothstep(R * 0.04, R * 0.08, length(q + hl * 0.6));
      vec3 eyeCol = iris + vec3(0.85) * glint + vec3(0.35) * glint2;
      float lidEdge = R * (1.0 - 2.15 * uLids) - 0.25 * q.x * q.x / R;
      float lid = smoothstep(lidEdge - aa, lidEdge + aa, q.y);
      float lash = (1.0 - smoothstep(0.0, aa * 2.5, abs(q.y - lidEdge))) * step(0.02, uLids);
      vec3 lidCol = mix(uDownWet * 0.6, uDownDry * 0.85, uDry) * L;
      eyeCol = mix(eyeCol, lidCol, lid);
      eyeCol = mix(eyeCol, vec3(0.04, 0.03, 0.02), lash * 0.8);
      col = mix(col, eyeCol, inEye);
    }
    vec2 q = local(c, uBeakC, uBeakE, uBeakN);
    vec2 sz = uBeakSize;
    if (abs(q.x) < sz.x * 1.5 && abs(q.y) < sz.y * 2.5) {
      // Seen from the front: the upper beak a rounded triangle, tip down; the lower one drops
      // to cheep and shows the mouth.
      float open = uBeak * sz.y * 0.5;
      float upper = 1.0 - smoothstep(-aa, aa, beakShape(q, sz.x, 0.35 * sz.y, -sz.y));
      float lower = 1.0 - smoothstep(-aa, aa, beakShape(q + vec2(0.0, open), 0.8 * sz.x, 0.0, -0.75 * sz.y));
      float mouth = (1.0 - smoothstep(-aa, aa, beakShape(q + vec2(0.0, open * 0.45), 0.72 * sz.x, 0.0, -0.8 * sz.y))) * smoothstep(0.0, 0.2, uBeak);
      vec3 horn = vec3(0.92, 0.56, 0.24) * L;
      col = mix(col, horn * 0.78, lower);
      col = mix(col, vec3(0.42, 0.12, 0.1) * L, mouth);
      col = mix(col, horn * (0.82 + 0.28 * smoothstep(-sz.y, 0.35 * sz.y, q.y)), upper);
      float tooth = 1.0 - smoothstep(sz.x * 0.1, sz.x * 0.17, length(q - vec2(0.0, -0.72 * sz.y)));
      col = mix(col, vec3(0.92, 0.9, 0.84) * L, tooth * upper);
    }
  }
  return col;
}

/** The membrane over the chick, torn away bit by bit as it comes out. */
vec3 insideAt(vec3 e, vec3 w) {
  vec3 chick = chickAt(w);
  if (uTear >= 1.0) return chick;
  vec4 dn = texture2D(uDown, eqUv(e));
  float n = dn.a;
  float memb = smoothstep(uTear - 0.08, uTear + 0.08, n);
  // A thin damp film over the chick: mostly see-through, a little pale.
  vec3 film = vec3(0.8, 0.77, 0.69) * hemi(w) * (0.95 + 0.1 * (n - 0.5));
  return mix(chick, mix(chick, film, 0.32), memb);
}

/** The egg over a candling lamp: the shell glowing, the shadows of what grows inside. */
vec3 candleAt(vec3 e, vec3 w) {
  vec2 uv = eqUv(e);
  vec3 alb = texture2D(uShell, uv).rgb;
  alb *= alb;
  float lum = dot(alb, vec3(0.3, 0.55, 0.15));
  float base = 0.6 + 0.4 * smoothstep(-0.4, 1.0, e.y);
  vec3 glow = uGlow * base * clamp(0.75 + 0.5 * (lum / max(uShellLum, 1e-3) - 1.0), 0.4, 1.4);
  float aa = uPx * 1.3;

  float yolk = uYolkK * (1.0 - smoothstep(uYolk.w * 0.65, uYolk.w * 1.1, acos(clamp(dot(e, uYolk.xyz), -1.0, 1.0))));
  float shade = yolk;

  float ang = acos(clamp(dot(e, uEmb), -1.0, 1.0));
  float mass = uDark * (1.0 - smoothstep(uDarkR - 0.5, uDarkR + 0.25, ang));
  shade = max(shade, mass * (1.0 - uSmallEnd * smoothstep(-0.35, -0.95, e.y)));

  if (uEmbK > 0.0 && ang < uEmbSize * 0.75 + 0.2) {
    vec2 q = around(e, uEmb, uEmbE, uEmbN) / max(uEmbSize, 1e-3);
    float ca = cos(uEmbAng);
    float sa = sin(uEmbAng);
    q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    // A curled body round an arc, thick at the head end, a round head and its dark eye; all soft.
    float a = atan(q.y, q.x);
    float ac = clamp(a, -2.4, 1.2);
    float f = (ac + 2.4) / 3.6;
    vec2 onArc = 0.26 * vec2(cos(ac), sin(ac));
    float body = length(q - onArc) - mix(0.08, 0.17, f);
    vec2 head = 0.26 * vec2(cos(1.2), sin(1.2)) + vec2(-0.1, 0.08);
    float hd = length(q - head) - 0.17;
    float d = min(body, hd);
    float emb = 1.0 - smoothstep(-0.16, 0.2, d);
    float eye = 1.0 - smoothstep(0.03, 0.1, length(q - head - vec2(-0.03, 0.03)));
    shade = max(shade, uEmbK * emb);
    shade = max(shade, uEmbEye * eye);
  }
  if (uHeart > 0.0) {
    vec2 q = local(e, uEmb, uEmbE, uEmbN);
    shade = max(shade, uHeart * (1.0 - smoothstep(0.012, 0.03, length(q - vec2(0.0, -0.02)))));
  }

  vec4 dat = texture2D(uData, uv);
  float vsdf = dat.b * 2.0 * VEIN_RANGE - VEIN_RANGE;
  float vday = dat.a * DAY_SCALE;
  float vgrow = smoothstep(vday, vday + 0.6, uDay) * step(dat.a, 0.99);
  float vein = (1.0 - smoothstep(-aa, aa, vsdf)) * vgrow * uVein;

  float airD = dot(e, uAirN) - uAirH;
  float air = smoothstep(-aa, aa, airD);
  if (uPipIn > 0.0) {
    // The beak's shadow, a soft point pushed up into the air cell from below.
    vec3 up = normalize(uAirN - uPipInC * dot(uAirN, uPipInC));
    vec3 side = cross(uPipInC, up);
    vec2 q = vec2(dot(e - uPipInC, side), dot(e - uPipInC, up));
    float beak = max(abs(q.x) - 0.05 * clamp(1.0 - q.y / 0.13, 0.0, 1.0), max(-q.y - 0.05, q.y - 0.13 * uPipIn));
    float p = 1.0 - smoothstep(-0.015, 0.025, beak);
    air *= 1.0 - p;
    shade = max(shade, p * 0.92);
  }
  shade *= uDetail;
  vec3 col = glow * (1.0 - clamp(shade, 0.0, 0.97));
  col *= 1.0 - uDetail * vein * (1.0 - 0.6 * shade) * vec3(0.5, 0.72, 0.78);
  col = mix(col, uGlowAir * base * clamp(0.85 + 0.3 * (lum / max(uShellLum, 1e-3) - 1.0), 0.6, 1.2), air);
  float edge = 1.0 - smoothstep(0.0, aa * 3.0 + 0.004, abs(airD));
  col *= 1.0 - 0.45 * edge;
  return col;
}

vec4 surface(vec3 w) {
  vec3 e = uEgg * w;
  vec3 col;
  if (uCandle >= 0.999) {
    col = candleAt(e, w);
  } else {
    if (uMode == 0) {
      col = shellAt(e, w, 0.0);
    } else if (uMode == 1) {
      // Which piece shows here: first the one this point belongs to, then any other loose
      // piece that has moved over it (a piece that hasn't moved covers only its own place).
      vec3 src = e;
      float loose = 0.0;
      float alpha = 0.0;
      int own = pieceId(e);
      bool found = false;
      for (int pass = 0; pass < 2 && !found; pass++) {
        if (uCapAlpha > 0.004 && (pass == 0 ? own == 1 : (own != 1 && uCapLoose > 0.0))) {
          vec3 s = uCapInv * e;
          s = normalize(vec3(0.0, 1.0, 0.0) + (s - vec3(0.0, 1.0, 0.0)) / max(uCapScale, 1e-3));
          if (pieceId(s) == 1) {
            src = s;
            loose = uCapLoose;
            alpha = uCapAlpha;
            found = true;
            break;
          }
        }
        for (int k = 0; k < MAX_PIECES; k++) {
          if (k >= uPieceN) break;
          bool mine = own == k + 2;
          if ((pass == 0) != mine || uPieceAlpha[k] < 0.004) continue;
          if (pass == 1 && uPieceLoose[k] <= 0.0) continue;
          vec3 pc = uPieceC[k];
          vec3 t = uPieceInv[k] * e;
          t = normalize(pc + (t - pc) / max(uPieceScale[k], 1e-3));
          if (pieceId(t) == k + 2) {
            src = t;
            loose = uPieceLoose[k];
            alpha = uPieceAlpha[k];
            found = true;
            break;
          }
        }
      }
      vec3 under = alpha < 1.0 ? insideAt(e, w) : vec3(0.0);
      col = alpha > 0.0 ? mix(under, shellAt(src, w, loose) * (1.0 - 0.18 * loose), alpha) : under;
    } else {
      col = chickAt(w);
    }
    if (uCandle > 0.001) col = mix(col, candleAt(e, w), uCandle);
  }
  if (uTextOn > 0.0) {
    float lat = asin(clamp(w.y, -1.0, 1.0));
    if (lat < uTextBand.x && lat > uTextBand.y) {
      vec2 tuv = vec2(atan(w.x, w.z) / (2.0 * EQ_PI) + 0.5, (lat - uTextBand.y) / (uTextBand.x - uTextBand.y));
      vec4 tx = texture2D(uText, tuv);
      col = mix(col, tx.rgb * 0.8, tx.a * uTextOn);
    }
  }
  return vec4(col * uBright, 1.0);
}
`;
