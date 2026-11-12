/**
 * The face, for a `SurfacePass`: every feature is a flat shape on the face plane (see
 * `face.ts`), found from its signed distance and blended over the skin by how much of a pixel
 * it covers. The hand is the same kind of shape, placed by its pose, with a soft shadow on the
 * skin behind it. Colours are linear.
 */
import { BROW, CHEEK, EYE, HAND, MOUTH, PUPIL } from "./face";

const f = (n: number): string => {
  const s = String(n);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};

const v2 = (v: readonly [number, number]): string => `vec2(${f(v[0])}, ${f(v[1])})`;

export const FACE_GLSL = /* glsl */ `
uniform mat3 uFace;
uniform float uAA;
uniform float uHidden;
uniform float uExposure;
uniform vec3 uSkin;
uniform vec3 uDeep;
uniform vec3 uGlow;
uniform vec3 uInk;
uniform vec3 uCheek;
uniform vec3 uHandSkin;
// The hand: its middle on the face plane, then the cosine and sine of its angle; and its size.
uniform vec4 uHand;
uniform float uHandScale;
// Brow lift, smile, and how far shut the eyes at negative and positive x are.
uniform vec4 uLook;
// Where the pupils look (x, y) and how much the eyes glisten.
uniform vec3 uEyes;

const vec3 EYE_WHITE = vec3(0.8, 0.8, 0.76);
const vec3 GLINT = vec3(0.86, 0.86, 0.84);
const vec3 CUFF = vec3(0.74, 0.76, 0.8);

float cover(float d, float aa) {
  return 1.0 - smoothstep(-aa, aa, d);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Distance to an ellipse to first order: its level function over the length of its gradient.
float ellipseDist(vec2 p, vec2 r) {
  float k = length(p / r);
  float g = length(p / (r * r));
  return k < 1e-4 ? -min(r.x, r.y) : k * (k - 1.0) / g;
}

// The hand in its own coordinates: a rounded slab ending in a shallow arc, and the thumb.
float handDist(vec2 h) {
  vec2 b = abs(h) - vec2(${f(HAND.halfLength - HAND.corner)}, ${f(HAND.halfWidth - HAND.corner)});
  float slab = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - ${f(HAND.corner)};
  float arc = length(vec2(max(h.x - ${f(HAND.halfLength - HAND.tip)}, 0.0), h.y)) - ${f(HAND.tip)};
  float thumb = segDist(h, ${v2(HAND.thumbFrom)}, ${v2(HAND.thumbTo)}) - ${f(HAND.thumbR)};
  return min(max(slab, arc), thumb);
}

vec4 surface(vec3 dir) {
  vec3 p = uFace * dir;
  float k = 2.0 / max(1.0 + p.z, 0.02);
  // Round the back of the head the plane runs off to infinity; keep it clear of every feature.
  vec2 q = p.z > -0.6 ? p.xy * k : vec2(40.0);
  float aa = uAA * k * 0.75;

  // Skin: lit from in front and a little above, deeper round the back and under the chin.
  float lit = 0.5 + 0.5 * dot(p, normalize(vec3(0.18, 0.5, 0.85)));
  vec3 col = mix(uDeep, uSkin, smoothstep(0.05, 0.95, lit));
  float sheen = exp(-(1.0 - dot(p, normalize(vec3(0.34, 0.62, 0.7)))) / 0.045);
  col = mix(col, uGlow, 0.3 * sheen);

  // The two sides of the face mirror each other; side is -1 on the face's right.
  float side = q.x < 0.0 ? -1.0 : 1.0;
  vec2 m = vec2(abs(q.x), q.y);

  vec2 ck = m - ${v2([CHEEK.x, CHEEK.y])};
  col = mix(col, uCheek, 0.32 * exp(-dot(ck, ck) / ${f(CHEEK.r * CHEEK.r)}));

  // Mouth: a stroke along a parabola, straight when firm and dipping in the middle for a smile.
  float smile = uLook.y;
  float mouthHalf = mix(${f(MOUTH.firm)}, ${f(MOUTH.wide)}, smile);
  float dip = ${f(MOUTH.depth)} * smile;
  float mx = clamp(q.x, -mouthHalf, mouthHalf);
  float t = mx / mouthHalf;
  float my = ${f(MOUTH.y)} + dip * (0.4 - (1.0 - t * t));
  float slope = 2.0 * dip * t / mouthHalf;
  float mouth = length(vec2(q.x - mx, (q.y - my) / sqrt(1.0 + slope * slope))) - ${f(MOUTH.half)};
  col = mix(col, uInk, cover(mouth, aa));

  // Brows: a rounded stroke each, bowed upwards, lifted together.
  vec2 bi = ${v2(BROW.inner)};
  vec2 bo = ${v2(BROW.outer)};
  float bt = clamp((m.x - 0.5 * (bi.x + bo.x)) / (0.5 * (bo.x - bi.x)), -1.0, 1.0);
  vec2 bq = vec2(m.x, m.y - uLook.x * ${f(BROW.lift)} - ${f(BROW.arch)} * (1.0 - bt * bt));
  col = mix(col, uInk, cover(segDist(bq, bi, bo) - ${f(BROW.half)}, aa));

  // Eyes: a white with an ink rim, a dark pupil that can glance about, and a glint. The lids
  // close from above and below onto a line that bows upwards like a closed, smiling eye.
  float shut = side < 0.0 ? uLook.z : uLook.w;
  vec2 e = m - ${v2([EYE.x, EYE.y])};
  float ex = clamp(e.x / ${f(EYE.rx)}, -1.0, 1.0);
  float lid = ${f(EYE.ry)} * shut * (0.3 * (1.0 - ex * ex) - 0.25);
  float eye = max(
    ellipseDist(e, vec2(${f(EYE.rx)}, ${f(EYE.ry)})),
    abs(e.y - lid) - ${f(EYE.ry)} * 1.25 * (1.0 - shut)
  );
  float white = cover(eye, aa) * smoothstep(0.98, 0.8, shut);
  col = mix(col, uInk, cover(eye - 0.014, aa) * smoothstep(1.0, 0.8, shut));
  col = mix(col, EYE_WHITE, white);
  // The glance is in the plane's own x, so it is mirrored back for the mirrored eye.
  vec2 pc = vec2(side * uEyes.x, uEyes.y) * ${f(PUPIL.travel)};
  float pupil = ellipseDist(e - pc, vec2(${f(PUPIL.rx)}, ${f(PUPIL.ry)}));
  col = mix(col, uInk * 0.55, cover(pupil, aa) * white);
  vec2 gp = e - pc - vec2(side * 0.022, 0.03);
  float glint = length(gp) - (0.02 + 0.006 * uEyes.z);
  col = mix(col, GLINT, cover(glint, aa) * white);
  vec2 sp = e - pc - vec2(side * -0.024, -0.034);
  col = mix(col, GLINT, cover(length(sp) - 0.012, aa) * white * uEyes.z);
  // The line the lids meet on goes over everything in the eye.
  float lash = length(vec2(e.x - ex * ${f(EYE.rx)}, e.y - lid)) - 0.017;
  col = mix(col, uInk, cover(lash, aa) * smoothstep(0.55, 0.9, shut));

  // The hand, just in front of the face: its shadow on whatever is behind it, then the hand.
  if (uHandScale > 0.02) {
    vec2 d = (q - uHand.xy) / uHandScale;
    vec2 h = vec2(d.x * uHand.z + d.y * uHand.w, d.y * uHand.z - d.x * uHand.w);
    float ha = aa / uHandScale;
    vec2 off = vec2(0.03, -0.045);
    vec2 hs = h - vec2(off.x * uHand.z + off.y * uHand.w, off.y * uHand.z - off.x * uHand.w);
    float shadow = 1.0 - smoothstep(-0.03, 0.06, handDist(hs));
    col *= 1.0 - 0.3 * shadow * uHandScale;
    float hd = handDist(h);
    col = mix(col, uInk, cover(hd, ha));
    // Pillowed: a little deeper towards its edge. Thin lines part the fingers and the thumb.
    vec3 fill = mix(uHandSkin, uDeep, 0.5 * smoothstep(-0.07, 0.0, hd));
    float fw = ${f(HAND.halfWidth * 0.5)};
    float groove = min(abs(h.y), min(abs(h.y - fw), abs(h.y + fw))) - 0.0055;
    float grooves = cover(groove, ha) * smoothstep(-0.03, 0.05, h.x);
    float crease = abs(segDist(h, ${v2(HAND.thumbFrom)}, ${v2(HAND.thumbTo)}) - ${f(HAND.thumbR)}) - 0.006;
    float creased = cover(crease, ha) * smoothstep(-0.2, -0.1, h.x) * step(-${f(HAND.halfWidth)}, h.y);
    fill = mix(fill, uInk, 0.55 * max(grooves, creased));
    // A pale cuff at the wrist, with an ink line where the hand comes out of it.
    float cuff = h.x + ${f(HAND.halfLength - HAND.cuff)};
    fill = mix(fill, CUFF, cover(cuff, ha));
    fill = mix(fill, uInk, cover(abs(cuff) - 0.009, ha));
    col = mix(col, fill, cover(hd + ${f(HAND.outline)}, ha));
  }

  // Nobody sees the top of the ball well, so it needn't be as bright.
  col *= uExposure * mix(1.0, 0.8, smoothstep(uHidden, uHidden + 0.25, dir.y));
  return vec4(col, 1.0);
}
`;
