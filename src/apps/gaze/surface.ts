/**
 * The eye's surface shader for a `SurfacePass`: the colour at each direction from the centre.
 * Directions are turned into the eye's own frame (z along the gaze), and from there it is the
 * iris and pupil inside the limbus, under a clear cornea that mirrors the room, and the white of
 * the eye outside it, with the conjunctiva's vessels and pink flush as far back as it reaches,
 * the sclera's own large vessels showing through behind that, and a wet sheen.
 *
 * The cornea's reflections are worked out for someone the eye looks at (straight down the line
 * of sight), off a cornea of the true curvature, from a room fixed in venue
 * space: two windows on opposite walls, a doorway on each of the other two and a ring of lamps in
 * the ceiling. So the highlights stay put in the room and slide over the cornea as the eye turns,
 * as real ones do. The tear film on the white mirrors the same room, broken up by the
 * conjunctiva's unevenness, each part as seen by an observer fixed in the room in front of it. So
 * the white looks wet from every side, shows each lamp once, and keeps its reflections in place
 * whatever the eye does. The reflections dim and brighten with the room's lamps and daylight,
 * which the pupil answers too.
 *
 * The iris's tissue has depth: crypts sink, strands stand proud and shade their neighbours, and
 * deeper tissue shifts outward, as seen by the person the eye looks at. Every pixel shows one
 * picture to everyone round the ball, so the depth can be right for one viewer only, and that is
 * the person in its line of sight.
 *
 * The room also lights the ball itself, gently and from fixed directions (the lamps overhead,
 * daylight from the windows), so the eye turns under a steady light as a real one does, rather
 * than glowing evenly from inside.
 */
import { WINDOW_SHAPE, WINDOWS } from "./light";

const f = (v: number) => v.toFixed(6);
const list = (xs: readonly number[]) => `float[${xs.length}](${xs.map(f).join(", ")})`;

/** Bearings of the doorways, on the two walls without windows, radians. */
const DOORS = [Math.PI / 2, -Math.PI / 2];

export const SURFACE = /* glsl */ `
uniform mat3 uToEye;
uniform sampler2D uIrisA;
uniform sampler2D uIrisB;
uniform sampler2D uVeins;
uniform sampler2D uMottle;
uniform sampler2D uHeight;
uniform float uDepth;
uniform float uPupil;
uniform vec2 uPupilAt;
uniform float uRest;
uniform float uSinIris;
uniform float uLimbusBand;
uniform float uIrisAngle;
uniform vec3 uBase;
uniform vec3 uFibre;
uniform vec3 uCentre;
uniform vec3 uDeep;
uniform vec3 uRing;
uniform vec4 uLook;
uniform vec2 uCornea;
uniform float uBright;
uniform float uRelief;
uniform float uShine;
uniform float uLamps;
uniform float uDay;
uniform sampler2D uBack;
// How far below the centre people's eyes are, and how far off the furthest stand, in ball radii.
uniform vec2 uViewer;

const float PI = 3.141592653589793;
const float F0 = 0.025;
// Optical depth of the back's vessels at full strength in their texture.
const float BACK_DEPTH = 1.0;
// The person the iris's depth is drawn for stands straight in front, this many ball radii from
// the centre. The tissue is about 1.6 mm deep at eye scale, thicker than life: deeper looked more
// real on the ball.
const float DEPTH_VIEWER = 1.8;
const float DEPTH_SCALE = 0.28;
const vec3 WALL = vec3(0.10, 0.10, 0.11);
const vec3 FLOOR = vec3(0.035, 0.03, 0.028);
const vec3 CEILING = vec3(0.16, 0.16, 0.17);
const vec3 DAYLIGHT = vec3(24.0, 25.0, 27.0);
const vec3 LAMP = vec3(60.0, 54.0, 46.0);
// Freckles on a light iris are a rusty brown.
const vec3 RUST = vec3(0.075, 0.03, 0.012);

const float WIN_HALF = ${f(WINDOW_SHAPE.halfWidth)};
const float WINS[${WINDOWS.length}] = ${list(WINDOWS)};
const float DOORS[${DOORS.length}] = ${list(DOORS)};
const float WIN_BOTTOM = ${f(WINDOW_SHAPE.bottom)};
const float WIN_TOP = ${f(WINDOW_SHAPE.top)};

// The walls, floor and ceiling are lit mostly by the lamps and a little by daylight.
float interior() {
  return 0.75 * uLamps + 0.25 * uDay + 0.05;
}

float wrapAngle(float a) {
  return atan(sin(a), cos(a));
}

// Outside a window, 'db' across it and 'e' up: an overcast sky, brighter overhead, over an
// uneven skyline of trees and roofs.
vec3 outside(float db, float e, float soft, float k) {
  float sky = (1.0 + 2.0 * sin(max(e, 0.0))) / 2.0;
  vec3 c = vec3(0.92, 0.96, 1.04) * sky;
  float top = 0.085 + 0.016 * sin(db * 23.0 + k) + 0.008 * sin(db * 61.0 + 2.0 * k)
    + 0.004 * sin(db * 140.0 + 3.0 * k);
  float land = 1.0 - smoothstep(top - 0.006 - soft, top + 0.006 + soft, e);
  return mix(c, vec3(0.3, 0.33, 0.3) * sky, land);
}

// The room as a mirror sees it: radiance in venue direction r, with edges softened by 'soft'
// radians so small highlights don't shimmer, and the windows scaled by 'winK'.
vec3 room(vec3 r, float soft, float winK) {
  float e = asin(clamp(r.y, -1.0, 1.0));
  float b = atan(r.x, r.z);
  vec3 c = mix(FLOOR, WALL, smoothstep(-0.06 - soft, 0.02 + soft, e));
  // A darker skirting where the walls meet the floor.
  c *= 1.0 - 0.35 * smoothstep(-0.03 - soft, -0.01, e) * (1.0 - smoothstep(0.03, 0.05 + soft, e));
  c = mix(c, CEILING, smoothstep(0.62 - soft, 0.7 + soft, e));
  // The nearest window, which is the only one that can be in view here, and the nearest doorway.
  float db = PI;
  float wi = 0.0;
  for (int i = 0; i < ${WINDOWS.length}; i++) {
    float x = wrapAngle(b - WINS[i]);
    if (abs(x) < abs(db)) {
      db = x;
      wi = float(i);
    }
  }
  float dd = PI;
  for (int i = 0; i < ${DOORS.length}; i++) dd = min(dd, abs(wrapAngle(b - DOORS[i])));
  float door = (1.0 - smoothstep(0.07 - soft, 0.08 + soft, dd)) * (1.0 - smoothstep(0.2 - soft, 0.21 + soft, e));
  c *= 1.0 - 0.55 * door;
  c *= interior();
  float across = 1.0 - smoothstep(WIN_HALF - 0.01 - soft, WIN_HALF + 0.01 + soft, abs(db));
  float up = smoothstep(WIN_BOTTOM - 0.01 - soft, WIN_BOTTOM + 0.01 + soft, e) * (1.0 - smoothstep(WIN_TOP - 0.01 - soft, WIN_TOP + 0.01 + soft, e));
  if (across * up > 0.0) {
    // Glazing bars: one upright, one across.
    float bars = smoothstep(0.012 - soft, 0.02 + soft, abs(db)) * smoothstep(0.01 - soft, 0.018 + soft, abs(e - 0.3));
    vec3 view = DAYLIGHT * uDay * winK * outside(db, e, soft, wi * 1.7 + 0.4);
    c = mix(c, mix(c * 1.6, view, bars), across * up);
  }
  // A ring of round lamps in the ceiling, each a little different, each lighting the ceiling
  // round it.
  float lb = wrapAngle(b) * 8.0 / (2.0 * PI);
  float idx = floor(lb + 0.5);
  float near = (lb - idx) * 2.0 * PI / 8.0;
  float de = e - 1.05;
  float dist = length(vec2(near * cos(e), de));
  float own = 1.0 + 0.12 * sin(idx * 2.4 + 1.0);
  c += LAMP * uLamps * own * (1.0 - smoothstep(0.03 - soft, 0.046 + soft, dist));
  c += LAMP * uLamps * own * 0.012 * exp(-dist * dist / (2.0 * 0.075 * 0.075));
  return c;
}

// The same room, blurred, for the white's broad sheen.
vec3 roomSoft(vec3 r) {
  float e = asin(clamp(r.y, -1.0, 1.0));
  float b = atan(r.x, r.z);
  vec3 c = mix(FLOOR, WALL, smoothstep(-0.4, 0.3, e));
  c = mix(c, CEILING * 1.6, smoothstep(0.4, 1.2, e));
  c *= interior();
  for (int i = 0; i < ${WINDOWS.length}; i++) {
    float db = wrapAngle(b - WINS[i]);
    float de = e - 0.28;
    c += DAYLIGHT * uDay * 0.22 * exp(-(db * db + de * de) / (2.0 * 0.2 * 0.2));
  }
  return c;
}

// How brightly the room lights the ball at venue direction n: lamps overhead, daylight from
// the windows, the floor's bounce below. Gentle, so the bottom stays bright for the people
// standing under it.
float roomLight(vec3 n) {
  float l = 0.9 + 0.12 * (0.5 + 0.5 * n.y) * (0.4 + 0.6 * uLamps);
  float b = atan(n.x, n.z);
  float side = 1.0 - abs(n.y);
  for (int i = 0; i < ${WINDOWS.length}; i++) {
    float c = max(0.0, cos(wrapAngle(b - WINS[i])));
    l += 0.06 * uDay * c * c * c * side;
  }
  return l;
}

// Where the person who sees the ball at venue direction n most squarely stands, in ball radii
// from its centre: out along n at eye level, or as far off as people stand when that line meets
// eye level further away or never does.
vec3 viewerFor(vec3 n) {
  float hl = length(n.xz);
  if (n.y < 0.0 && hl * uViewer.x < -n.y * uViewer.y) return n * (uViewer.x / -n.y);
  vec2 h = hl > 1e-5 ? n.xz / hl : vec2(0.0, 1.0);
  return vec3(h.x * uViewer.y, -uViewer.x, h.y * uViewer.y);
}

// The surface's direction bent a little by the conjunctiva's unevenness under the tear film.
vec3 uneven(vec3 d) {
  vec3 p = d * 34.0;
  vec3 w = vec3(sin(p.y + 1.3 * sin(p.z * 0.7)), sin(p.z * 1.1 + 1.7 * sin(p.x * 0.8)), sin(p.x * 0.9 + 1.1 * sin(p.y * 1.2)));
  vec3 q = d * 97.0;
  w += 0.45 * vec3(sin(q.z + 2.0 * sin(q.y * 0.6)), sin(q.x + 2.0 * sin(q.z * 0.7)), sin(q.y + 2.0 * sin(q.x * 0.5)));
  vec3 g = d * 260.0;
  w += 0.15 * vec3(sin(g.x + 1.5 * sin(g.z * 0.8)), sin(g.y + 1.5 * sin(g.x * 0.9)), sin(g.z + 1.5 * sin(g.y * 0.7)));
  return normalize(d + 0.008 * w);
}

// The tear film's glints on the white for someone looking along 'into' (the eye's frame), off
// the uneven surface 'nb'. Rougher than the cornea, so it gives back less, and the windows' broad
// light least.
vec3 glints(vec3 into, vec3 nb, float soft) {
  vec3 rs = reflect(into, nb) * uToEye;
  float fres = F0 + (1.0 - F0) * pow(1.0 - max(0.0, -dot(nb, into)), 5.0);
  return uShine * 0.3 * fres * room(rs, max(soft, 0.012), 0.15);
}

// Iris texture coordinates (round, outward) for a position p in the iris plane, in iris radii.
vec2 irisUv(vec2 p, float rP, float k0) {
  float s = clamp((length(p) - rP) / (1.0 - rP), 0.0, 1.0);
  return vec2(atan(p.y, p.x) / (2.0 * PI) + 0.5, k0 * s + (1.0 - k0) * s * s);
}

// How far the iris's tissue rises, 0 to 1, with the same footprint as the colour lookups.
float irisHeight(vec2 p, float rP, float k0, vec4 g) {
  return textureGrad(uHeight, irisUv(p, rP, k0), g.xy, g.zw).g;
}

vec4 surface(vec3 dir) {
  vec3 d = uToEye * dir;
  float rho = length(d.xy);
  float th = atan(rho, d.z);
  float phi = atan(d.y, d.x);

  // Texture columns once round; take derivatives from whichever copy has no seam here.
  float u = phi / (2.0 * PI) + 0.5;
  float u2 = fract(u + 0.5);
  vec2 du = vec2(dFdx(u), dFdy(u));
  vec2 du2 = vec2(dFdx(u2), dFdy(u2));
  if (abs(du2.x) + abs(du2.y) < abs(du.x) + abs(du.y)) du = du2;

  // Iris: radius across the line of sight, 1 at the limbus, so it looks true seen head on.
  float rI = d.z > 0.0 ? rho / uSinIris : 9.0;
  // Through the limbal band: 0 at the iris's edge, 1 where it has faded into white.
  float lb = (th - uIrisAngle) / uLimbusBand;
  // The pupil sits a little off the iris's centre; the tissue between is drawn
  // along to follow it, more near the pupil, and the limbus not at all.
  vec2 q = d.z > 0.0 ? d.xy / uSinIris : vec2(9.0, 0.0);
  vec2 qp = q - uPupilAt * max(0.0, 1.0 - dot(q, q));
  float rQ = length(qp);
  float phiI = atan(qp.y, qp.x);
  float uI = phiI / (2.0 * PI) + 0.5;
  float uI2 = fract(uI + 0.5);
  vec2 duI = vec2(dFdx(uI), dFdy(uI));
  vec2 duI2 = vec2(dFdx(uI2), dFdy(uI2));
  if (abs(duI2.x) + abs(duI2.y) < abs(duI.x) + abs(duI.y)) duI = duI2;
  // A pupil is never quite round.
  float rP = uPupil * (1.0 + 0.012 * sin(2.0 * phiI + 0.7) + 0.007 * sin(3.0 * phiI + 2.1) + 0.004 * sin(5.0 * phiI + 4.0));
  float sCur = clamp((rQ - rP) / (1.0 - rP), 0.0, 1.0);
  // The tissue near the pupil bunches up as it widens and stretches as it narrows.
  float dil = (uPupil - uRest) / (1.0 - uRest);
  float k0 = clamp(1.0 + 1.5 * dil, 0.45, 1.8);
  float sRest = k0 * sCur + (1.0 - k0) * sCur * sCur;
  vec2 ds = vec2(dFdx(sRest), dFdy(sRest));

  // Sclera rows: limbus to the back pole.
  float vs = clamp((th - uIrisAngle) / (PI - uIrisAngle), 0.0, 1.0);
  vec2 dv = vec2(dFdx(vs), dFdy(vs));
  // Screen-space widths, taken here because the branches below aren't uniform.
  float aa = fwidth(rQ) + 1e-4;
  float soft = clamp(fwidth(th) * 4.0, 0.002, 0.05);

  vec3 white;
  {
    vec4 veins = textureGrad(uVeins, vec2(u, vs), vec2(du.x, dv.x), vec2(du.y, dv.y));
    vec4 mottle = textureGrad(uMottle, vec2(u, vs), vec2(du.x, dv.x), vec2(du.y, dv.y));
    // A warm white, but not glaring: most of the ball is sclera and people stand underneath.
    white = vec3(0.6, 0.575, 0.535) * (0.94 + 0.12 * mottle.r) * mix(1.0, 0.88, smoothstep(0.0, 0.4, vs));
    white = mix(white, white * vec3(1.0, 0.97, 0.88), mottle.b * 0.5);
    // Pinker in patches away from the limbus, where the conjunctiva carries more vessels, as far
    // back as the conjunctiva reaches.
    float conj = 1.0 - smoothstep(0.3, 0.55, vs);
    white = mix(white, white * vec3(1.0, 0.86, 0.84), mottle.g * 0.45 * smoothstep(0.04, 0.3, vs) * conj);
    // Thin sclera by the limbus lets a translucent blue-grey show.
    white = mix(white, vec3(0.38, 0.42, 0.49), 0.32 * exp(-vs * 16.0));
    // It is thinnest round the equator, where the dark choroid shows through a little, and twice
    // as thick at the back, which is plain white.
    float thin = exp(-pow((th - 1.62) / 0.32, 2.0));
    white = mix(white, white * vec3(0.92, 0.94, 0.975), thin * (0.5 + 0.3 * mottle.r));
    // The large veins and arteries in and under the sclera behind the conjunctiva, as blue-grey
    // shadows.
    vec4 deepV = textureGrad(uBack, vec2(u, vs), vec2(du.x, dv.x), vec2(du.y, dv.y));
    float under = deepV.r + deepV.g;
    white *= exp(-under * BACK_DEPTH * vec3(1.0, 0.95, 0.86));
    // Vessels fade out towards the back, where a real eye's are hidden in the orbit.
    float seen = 1.0 - smoothstep(0.22, 0.5, vs);
    // Blood absorbs green and blue far more than red, so a little shows pink and more shows a
    // deeper red; veins are darker and more purple, and the deep layer is a soft pink flush.
    vec3 depth = (veins.r * vec3(0.32, 1.5, 1.4) + veins.b * vec3(0.6, 1.65, 1.35)) * seen;
    depth += veins.g * vec3(0.18, 0.55, 0.5) * (1.0 - smoothstep(0.3, 0.6, vs));
    white *= exp(-depth);
  }

  vec3 col = white;
  float onCornea = 0.0;
  if (lb < 1.3) {
    vec2 tc = vec2(uI, sRest);
    float hHit = 0.5;
    float shadow = 0.0;
    float crypt = 0.0;
    vec3 up = uToEye * vec3(0.0, 1.0, 0.0);
    vec3 light = normalize(vec3(up.xy * 0.6, 1.0));
    if (uDepth > 0.0 && rQ > rP && rQ < 1.0) {
      // The tissue has depth. March the line of sight down through it, as seen by someone
      // straight in front of the eye (the person it looks at), over a smoothed height: the
      // finest strands and pores are narrower than the steps and would ripple, and are too fine
      // to show depth anyway.
      vec4 g0 = vec4(duI.x, ds.x, duI.y, ds.y);
      vec4 gm = g0 * 4.0;
      // Pinned at the pupil's margin and where the iris's root goes under the white, so it
      // meets the flat ruff and limbus without an edge.
      float w = smoothstep(rP, rP + 0.04, rQ) * (1.0 - smoothstep(0.92, 1.0, rQ));
#ifdef GAZE_WALL
      // On a wall the eye is seen along the real view ray.
      vec3 seenAlong = uToEye * wallRay;
      vec2 shift = seenAlong.xy / max(-seenAlong.z, 0.35);
      shift *= min(1.0, 0.9 / max(length(shift), 1e-4)) * DEPTH_SCALE * w;
#else
      vec2 shift = d.xy / (DEPTH_VIEWER - d.z) * DEPTH_SCALE * w;
#endif
      // Enough steps that each stays within the smoothed height's footprint.
      const int N = 20;
      float layer = 1.0 / float(N);
      float depth = 0.0;
      float surf = 1.0 - irisHeight(qp - 0.5 * shift, rP, k0, gm);
      float prevDepth = 0.0;
      float prevSurf = surf;
      for (int i = 0; i < N; i++) {
        if (depth >= surf) break;
        prevDepth = depth;
        prevSurf = surf;
        depth += layer;
        surf = 1.0 - irisHeight(qp + shift * (depth - 0.5), rP, k0, gm);
      }
      float ga = prevSurf - prevDepth;
      float gb = surf - depth;
      float t = clamp(ga / (ga - gb + 1e-5), 0.0, 1.0);
      vec2 pHit = qp + shift * (mix(prevDepth, depth, t) - 0.5);
      tc = irisUv(pHit, rP, k0);
      hHit = textureGrad(uHeight, tc, g0.xy, g0.zw).g;
      // A ray towards the lamps finds the walls that shade this spot. The lamps are high above
      // an eye looking level, so it climbs steeper than the soft relief light below. It starts
      // from a smoothed height, so only walls broad enough to see cast shadows and narrow
      // furrows don't turn into black lines, and its penumbra widens with distance, so its
      // steps leave no bands across the light.
      vec4 gs = g0 * 3.0;
      float hS = textureGrad(uHeight, tc, gs.xy, gs.zw).g;
      vec2 toward = up.xy * DEPTH_SCALE * (1.0 - hS);
      for (int j = 1; j <= 8; j++) {
        float f = float(j) / 8.0;
        float rayH = hS + (1.0 - hS) * f;
        float hs = irisHeight(pHit + toward * f, rP, k0, gs);
        shadow = max(shadow, (hs - rayH) / (0.03 + 0.4 * f));
      }
      shadow = clamp(shadow, 0.0, 1.0) * w;
      // The neighbourhood's mean height, over the same stretch of iris at any size of texture.
      float blur = textureLod(uHeight, tc, log2(float(textureSize(uHeight, 0).x) / 128.0)).g;
      crypt = clamp((blur - hHit) * 3.6, 0.0, 0.7) * w;
    }
    vec4 A = textureGrad(uIrisA, tc, vec2(duI.x, ds.x), vec2(duI.y, ds.y));
    vec4 B = textureGrad(uIrisB, tc, vec2(duI.x, ds.x), vec2(duI.y, ds.y));
    float fib = clamp((A.r - 0.3) * (0.6 + 1.6 * uLook.x), 0.0, 1.0);
    vec3 iris = mix(uBase, uFibre, fib);
    iris = mix(iris, mix(uCentre * 0.7, uCentre * 1.5, fib), A.a * 0.9);
    iris = mix(iris, uDeep, A.g * uLook.y);
    // Furrows fold deeper as the pupil widens and smooth out as it narrows.
    iris = mix(iris, uDeep, A.b * clamp(0.3 + 1.4 * dil, 0.0, 1.0) * 0.7);
    // Freckles: rusty on a light iris, a darker brown on a brown one.
    float baseLum = dot(uBase, vec3(0.2126, 0.7152, 0.0722));
    iris = mix(iris, mix(uDeep * 0.8, RUST, smoothstep(0.02, 0.05, baseLum)), B.r * min(1.0, 1.6 * uLook.z));
    // Relief, lit from the room's ceiling, so the crypts' shadows fall the same way as the eye
    // turns.
    vec2 slope = (B.gb - 0.5) * uRelief;
    vec3 across = vec3(-sin(phiI), cos(phiI), 0.0);
    vec3 out_ = vec3(cos(phiI), sin(phiI), 0.0);
    vec3 n = normalize(vec3(0.0, 0.0, 1.0) - slope.x * across - slope.y * out_);
    iris *= mix(1.0, max(0.0, dot(n, light)) / light.z, 0.7);
    // Depth: crypts and furrows are darker at the bottom and shaded by their walls.
    iris = mix(iris, uDeep, crypt * 0.35);
    iris *= (1.0 - crypt * 0.6) * (1.0 - 0.65 * shadow * smoothstep(0.0, 0.5, length(up.xy)));
    // Light through the cornea, from the ceiling's lamps: the limbus shades the edge of the iris
    // nearest them and the cornea bends their light onto the far side, where it gathers in a
    // bright crescent. It depends on the lamps, not on who is looking, so it is right from
    // every side; it fades as the eye turns down and the lamps fall behind the iris.
    float rake = length(up.xy);
    vec2 l2 = up.xy / max(rake, 1e-4);
    float facing = dot(qp / max(rQ, 1e-4), l2);
    float front = smoothstep(-0.5, 0.3, up.z) * rake * uLamps;
    float shade = smoothstep(0.62, 0.97, rQ) * smoothstep(0.0, 0.8, facing);
    float caustic = exp(-pow((rQ - 0.8) / 0.13, 2.0)) * smoothstep(0.1, 0.85, -facing);
    iris *= (1.0 - 0.35 * shade * front) * (1.0 + 0.6 * caustic * front);
    // The outer ciliary zone is darker, under the cornea's rim, then the dark limbal ring.
    iris *= 0.66 + 0.34 * (1.0 - smoothstep(0.55, 1.0, rQ));
    iris = mix(iris, uRing, smoothstep(0.8, 0.99, rQ) * 0.88);
    // The pupillary ruff: a thin dark rim at the margin, uneven in width.
    float ruffN = textureGrad(uIrisB, vec2(uI, 0.01), vec2(duI.x, 0.0), vec2(duI.y, 0.0)).a;
    float ruffW = 0.008 + 0.02 * ruffN * ruffN;
    float ruff = 1.0 - smoothstep(rP + ruffW - aa, rP + ruffW + aa, rQ);
    iris = mix(iris, vec3(0.03, 0.015, 0.008), ruff * (0.7 + 0.25 * ruffN));
    // The pupil: black, with the faintest warmth at its edge.
    float hole = 1.0 - smoothstep(rP - aa, rP + aa, rQ);
    vec3 dark = mix(vec3(0.002), vec3(0.005, 0.0032, 0.0028), smoothstep(rP * 0.85, rP, rQ));
    iris = mix(iris, dark, hole);
    // The limbus: the iris's dark edge gives way to white through a soft blue-grey band, about
    // 1 mm wide, where the iris shows blurred through the thin sclera.
    col = mix(iris, white * vec3(0.62, 0.68, 0.78), smoothstep(-0.2, 0.3, lb));
    col = mix(col, white, smoothstep(0.2, 1.1, lb));
    onCornea = 1.0 - smoothstep(0.0, 0.4, lb);
  }

#ifdef GAZE_WALL
  col *= wallLight(dir);
#else
  col *= roomLight(dir);
#endif

  if (uShine > 0.0) {
    if (onCornea > 0.0) {
      // The cornea mirrors the room for someone straight down the line of sight.
      float zc = uCornea.x;
      float rc = uCornea.y;
      float b = d.z * zc;
      float t = b + sqrt(max(0.0, b * b - zc * zc + rc * rc));
      vec3 n2 = normalize(d * t - vec3(0.0, 0.0, zc));
#ifdef GAZE_WALL
      vec3 seen = uToEye * wallRay;
      vec3 r = reflect(seen, n2);
      float fres = F0 + (1.0 - F0) * pow(1.0 - max(0.0, -dot(n2, seen)), 5.0);
#else
      vec3 r = reflect(vec3(0.0, 0.0, -1.0), n2);
      float fres = F0 + (1.0 - F0) * pow(1.0 - max(0.0, n2.z), 5.0);
#endif
      col += uShine * fres * room(r * uToEye, soft, 1.0) * onCornea;
    }
    // The white mirrors the room: a broad faint sheen, and the tear film's sharper glints, broken
    // up by the conjunctiva's unevenness. Each part is drawn for an observer fixed in the room in
    // front of it, so the reflections stay put whatever the eye does and show each lamp once; only
    // the unevenness turns with the eye. Where even that observer sees the white only at a glance,
    // in the cap above people's heads, it fades.
    if (onCornea < 1.0) {
#ifdef GAZE_WALL
      // On a wall, for the one viewer the picture is drawn for, right to the ball's edge.
      vec3 into = uToEye * wallRay;
      float seen = 1.0 - onCornea;
#else
      vec3 into = uToEye * normalize(dir - viewerFor(dir));
      float seen = smoothstep(0.33, 0.43, -dot(d, into)) * (1.0 - onCornea);
#endif
      if (seen > 0.0) {
        col += uShine * F0 * 0.4 * roomSoft(reflect(into, d) * uToEye) * seen;
        col += glints(into, uneven(d), soft) * seen;
      }
    }
  }
  return vec4(col * uBright, 1.0);
}
`;
