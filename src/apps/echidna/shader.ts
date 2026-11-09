/**
 * The echidna's surface shader, for a `SurfacePass`: for every pixel's direction from the
 * centre it turns into the body's frame, looks up the few spines that can lie there, picks the
 * highest two and shades them as glossy tapered cylinders, banded dark at the root, cream along
 * the shaft and dark at the tip, darker the nearer the skin they are. Coarse dark fur shows
 * between them, and bare skin on the forehead and at the whorls' centres. Round the belly pole,
 * where the curl opens, it paints the belly under the spines and the tucked face and feet over
 * them, as height fields lit like the rest.
 *
 * Light: a key light from up the ball and out from it, wherever someone stands, so every side
 * and the underside read alike, and gloss sits where the room's light from above would catch it.
 * Colours are linear.
 */
import { CROWN, HEAD, normalize, OPENING, TAIL, WHORL_BARE, WHORLS } from "./body";
import {
  FACE,
  HALF,
  LIFT_STEPS,
  SLOTS,
  SPINE_TEXELS,
  SPINES_PER_ROW,
  TAPER_POWER,
  TAPER_START,
  WIDTH_SPAN,
} from "./lookup";
import { PERIOD } from "./noise";

const MID = [(HEAD[0] + TAIL[0]) / 2, (HEAD[1] + TAIL[1]) / 2, (HEAD[2] + TAIL[2]) / 2];
const AXIS = normalize([TAIL[0] - HEAD[0], TAIL[1] - HEAD[1], TAIL[2] - HEAD[2]]);
// Head and tail lie in the body's y, z plane, so x is square to the line between them.
const ACROSS2 = [0, -AXIS[2], AXIS[1]];

const v2s = (vs: readonly (readonly [number, number])[]) =>
  `vec2[${vs.length}](${vs.map(([x, y]) => `vec2(${f(x)}, ${f(y)})`).join(", ")})`;
const fs = (vs: readonly number[]) => `float[${vs.length}](${vs.map(f).join(", ")})`;
const turned = (v: readonly [number, number], a: number): [number, number] => [
  Math.cos(a) * v[0] - Math.sin(a) * v[1],
  Math.sin(a) * v[0] + Math.cos(a) * v[1],
];

// The front foot's five digits, i from -2 to 2 across it: where each starts and ends, its
// thickness, and its claw's root, direction, bend and length.
const DIGITS = [-2, -1, 0, 1, 2].map((i) => {
  const dir: [number, number] = [Math.sin(i * 0.13), Math.cos(i * 0.13)];
  const root: [number, number] = [i * 0.034, 0.03 - i * i * 0.004];
  const reach = 0.055 - Math.abs(i) * 0.007;
  const knuckle: [number, number] = [root[0] + dir[0] * reach, root[1] + dir[1] * reach];
  const clawDir = turned(dir, -i * 0.05);
  return {
    root,
    knuckle,
    r: 0.026 - Math.abs(i) * 0.002,
    clawRoot: [knuckle[0] - dir[0] * 0.014, knuckle[1] - dir[1] * 0.014] as [number, number],
    clawDir,
    clawTip: turned(clawDir, -i * 0.1 - 0.25),
    clawLen: 0.088 - Math.abs(i) * 0.012,
  };
});
// The hind foot's claws: the second is the long grooming claw.
const HIND_CLAW_LEN = [0.075, 0.15, 0.1, 0.075];
const HIND_BEND = [-0.3, -0.7, -0.3, -0.3];

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const v3 = (v: readonly number[]) => `vec3(${v.map(f).join(", ")})`;

export const ECHIDNA_GLSL = /* glsl */ `
precision highp float;
precision highp int;

uniform mat3 uSpin;
uniform vec3 uUp;
uniform highp usampler2D uCand;
uniform highp sampler2D uSpines;
uniform highp sampler3D uNoise;
uniform vec2 uBreath;
uniform vec4 uRip[3];
uniform vec2 uRipShape[3];
uniform float uBristle;
uniform vec4 uSnout;
uniform vec4 uFeet;
uniform vec2 uToesLid;
uniform float uCapY;
uniform float uExposure;

const int FACE = ${FACE};
const int SLOTS = ${SLOTS};
const int HALF = ${HALF};
const uint ROW = ${SPINES_PER_ROW}u;
const uint SPINE_TEXELS = ${SPINE_TEXELS}u;
const float LIFT_STEPS = ${f(LIFT_STEPS)};
const float WIDTH_SPAN = ${f(WIDTH_SPAN)};
const uint EMPTY = 65535u;
const float TAPER_START = ${f(TAPER_START)};
const float TAPER_POWER = ${f(TAPER_POWER)};
const vec3 HEAD = ${v3(HEAD)};
const vec3 TAIL = ${v3(TAIL)};
const vec3 WHORL0 = ${v3(WHORLS[0]!)};
const vec3 WHORL1 = ${v3(WHORLS[1]!)};
// Cosines of the angles where the bare skin of the forehead and the whorls fades out.
const vec2 COS_CROWN = vec2(${f(Math.cos(CROWN * 0.3))}, ${f(Math.cos(CROWN * 1.2))});
const vec2 COS_WHORL = vec2(${f(Math.cos(WHORL_BARE * 0.2))}, ${f(Math.cos(WHORL_BARE * 1.1))});
const vec3 MID = ${v3(MID)};
const vec3 AXIS = ${v3(AXIS)};
const vec3 ACROSS1 = vec3(1.0, 0.0, 0.0);
const vec3 ACROSS2 = ${v3(ACROSS2)};
const vec3 OPEN = vec3(${f(OPENING.cz)}, ${f(OPENING.rx)}, ${f(OPENING.rz)});
const float QUARTER = 0.7853981633974483;
const float TAU = 6.283185307179586;
const vec2 FRONT_ROOT[5] = ${v2s(DIGITS.map((g) => g.root))};
const vec2 FRONT_KNUCKLE[5] = ${v2s(DIGITS.map((g) => g.knuckle))};
const float FRONT_R[5] = ${fs(DIGITS.map((g) => g.r))};
const vec2 FRONT_CLAW_ROOT[5] = ${v2s(DIGITS.map((g) => g.clawRoot))};
const vec2 FRONT_CLAW_DIR[5] = ${v2s(DIGITS.map((g) => g.clawDir))};
const vec2 FRONT_CLAW_TIP[5] = ${v2s(DIGITS.map((g) => g.clawTip))};
const float FRONT_CLAW_LEN[5] = ${fs(DIGITS.map((g) => g.clawLen))};
const float HIND_CLAW_LEN[4] = ${fs(HIND_CLAW_LEN)};
const vec2 HIND_BEND[4] = ${v2s(HIND_BEND.map((a) => [Math.cos(a), Math.sin(a)] as [number, number]))};
// Where the feet sit under the belly, in the plane across and towards the head.
const vec2 FRONT_FOOT = vec2(0.15, 0.11);
const vec2 HIND_FOOT = vec2(0.175, -0.21);
const float FOOT_SCALE = 1.15;
const float SNOUT_BASE = 0.38;
// Raised spines show more of the dark coat between them than flat ones did, so the whole ball
// is lit a little brighter to keep it as bright in the room.
const float EXPOSURE = 1.3;
// About the tallest a spine stands off the skin, for shading by height.
const float H_MAX = 0.13;

// Linear colours.
const vec3 CREAM = vec3(0.72, 0.54, 0.25);
const vec3 STRAW = vec3(0.82, 0.60, 0.24);
const vec3 PALE = vec3(0.84, 0.74, 0.47);
const vec3 ROOT_BROWN = vec3(0.05, 0.028, 0.014);
const vec3 TIP_BROWN = vec3(0.11, 0.055, 0.022);
const vec3 TIP = vec3(0.013, 0.009, 0.006);
const vec3 FUR_DARK = vec3(0.007, 0.0045, 0.003);
const vec3 FUR_LIGHT = vec3(0.07, 0.038, 0.018);
const vec3 SKIN = vec3(0.18, 0.13, 0.085);
const vec3 HIDE = vec3(0.034, 0.026, 0.02);
const vec3 DUST = vec3(0.17, 0.135, 0.1);
const vec3 BELLY = vec3(0.060, 0.042, 0.034);
const vec3 CLAW = vec3(0.04, 0.032, 0.025);
const vec3 CLAW_TIP = vec3(0.011, 0.009, 0.007);
const vec3 GLOSS = vec3(1.0, 0.94, 0.82);

uint hashU(uint x) {
  x ^= x >> 17;
  x *= 0xed5ad4bbu;
  x ^= x >> 11;
  x *= 0xac4c1b51u;
  x ^= x >> 15;
  x *= 0x31848babu;
  x ^= x >> 14;
  return x;
}

// Smooth noise from the baked tiling texture, one lattice cell per unit.
float noise3(vec3 p) {
  return texture(uNoise, p * (1.0 / ${f(PERIOD)})).r;
}

// Mirrors texelOf in lookup.ts: the texel of the atlas.
ivec2 cubeTexel(vec3 d) {
  vec3 a = abs(d);
  int face;
  vec2 pq;
  float m;
  if (a.x >= a.y && a.x >= a.z) {
    face = d.x >= 0.0 ? 0 : 1;
    pq = d.yz;
    m = a.x;
  } else if (a.y >= a.z) {
    face = d.y >= 0.0 ? 2 : 3;
    pq = d.zx;
    m = a.y;
  } else {
    face = d.z >= 0.0 ? 4 : 5;
    pq = d.xy;
    m = a.z;
  }
  vec2 uv = atan(pq / m) / QUARTER;
  ivec2 ij = clamp(ivec2(floor((uv * 0.5 + 0.5) * float(FACE))), ivec2(0), ivec2(FACE - 1));
  return ivec2((face % 3) * FACE, (face / 3) * FACE) + ij;
}

float angleTo(vec3 a, vec3 b) {
  return acos(clamp(dot(a, b), -1.0, 1.0));
}

float taper(float t) {
  return t <= TAPER_START ? 1.0 : pow(max(0.0, (1.0 - t) / (1.0 - TAPER_START)), TAPER_POWER);
}

// Where p is among the body's flow lines: how far along from the head towards the tail, and
// which of the circles through them it lies on (radians round the line between them).
vec2 streamOf(vec3 p) {
  float u = log(length(p - HEAD) / max(length(p - TAIL), 1e-4));
  vec3 r = p - MID;
  r -= AXIS * dot(r, AXIS);
  return vec2(clamp(u, -6.0, 6.0), atan(dot(r, ACROSS2), dot(r, ACROSS1)));
}

// Hair lying along (x) and across (y) some coordinates: streaks of stretched noise.
float strands(vec2 q, float aa, float scale) {
  float detail = clamp(1.6 - aa * scale * 2.0, 0.0, 1.0);
  float n = noise3(vec3(q, 1.3)) * 0.6 + noise3(vec3(q * 2.2, 8.7)) * 0.4;
  return mix(0.4, smoothstep(0.42, 0.78, n), detail);
}

// Coarse dark fur lying along the body's flow lines.
vec3 furColour(vec3 d, float aa) {
  vec2 st = streamOf(d);
  float n = strands(vec2(st.x * 14.0, st.y * 130.0), aa, 260.0);
  float broad = noise3(d * 4.0 + 3.7);
  return mix(FUR_DARK, FUR_LIGHT, n * (0.5 + 0.6 * broad));
}

// Bare, dusty skin with short sparse hairs: the forehead and the whorls' centres.
vec3 skinColour(vec3 d, float aa) {
  vec3 q = d * 120.0;
  float detail = clamp(1.6 - aa * 240.0 * 1.8, 0.0, 1.0);
  float dust = noise3(q * 0.7 + 4.1) * 0.55 + noise3(q * 2.3) * 0.45 * detail;
  vec3 c = mix(SKIN * 0.6, SKIN, smoothstep(0.25, 0.8, dust));
  vec2 st = streamOf(d);
  float hair = smoothstep(0.55, 0.85, strands(vec2(st.x * 30.0, st.y * 180.0), aa, 300.0));
  return mix(c, FUR_DARK * 2.0, hair * 0.7);
}

// How bare the skin is here: the forehead round the head and each whorl's centre.
float bareness(vec3 d) {
  float forehead = smoothstep(COS_CROWN.y, COS_CROWN.x, dot(d, HEAD)) * 0.9;
  float whorl = smoothstep(COS_WHORL.y, COS_WHORL.x, max(dot(d, WHORL0), dot(d, WHORL1)));
  return max(forehead, whorl * 0.45);
}

struct Layer {
  float cov;
  float h;
  float t;
  float xr;
  float theta;
  uint id;
  vec3 b;
  vec3 f;
};

// Like shingles: of two spines that overlap, the one whose base lies further back along the
// other's direction lies underneath, the same all along where they overlap.
bool over(Layer c, Layer t) {
  return dot(t.b - c.b, c.f) > dot(c.b - t.b, t.f);
}

// How far a spine is lifted off the skin now, radians.
float liftOf(uint id, vec3 b, float rest) {
  uint h = hashU(id * 3u + 1u);
  float r1 = float(h & 0xffffu) / 65535.0;
  float r2 = float(h >> 16) / 65535.0;
  float theta = rest;
  float delay = 0.35 * r2 + 0.3 * (b.y * 0.5 + 0.5);
  float breath = max(0.0, uBreath.x - uBreath.y * delay);
  theta += breath * (0.09 + 0.05 * (b.y * 0.5 + 0.5));
  for (int k = 0; k < 3; k++) {
    if (uRipShape[k].x <= 0.0) continue;
    float dist = length(b - uRip[k].xyz);
    float size = uRipShape[k].y;
    float u = uRip[k].w - dist * 1.6 - r1 * 0.12;
    float pulse = u > 0.0 && u < 1.0 ? sin(3.14159265 * u) : 0.0;
    theta += uRipShape[k].x * exp(-dist * dist / (size * size)) * pulse * pulse;
  }
  theta += uBristle * (0.22 + 0.1 * r2);
  return min(theta, 1.15);
}

struct Hit {
  vec3 b;
  vec3 f;
  float db;
  float a;
  float x;
  float t;
  float lp;
  float hw;
  float theta;
};

uint spineId(uvec4 words, int k) {
  uint w = words[k >> 1];
  return (k & 1) == 0 ? (w & 0xffffu) : (w >> 16);
}

// Where direction d falls on spine id as it lies now.
Hit hitOf(uint id, vec3 d, float spread) {
  ivec2 at = ivec2(int((id % ROW) * SPINE_TEXELS), int(id / ROW));
  vec4 t0 = texelFetch(uSpines, at, 0);
  vec4 t1 = texelFetch(uSpines, at + ivec2(1, 0), 0);
  float lifts = floor(t1.w);
  float rest = lifts / LIFT_STEPS;
  Hit h;
  h.b = t0.xyz;
  h.f = t1.xyz;
  h.db = dot(d, h.b);
  h.a = dot(d, h.f) / h.db;
  h.x = dot(d, cross(h.b, h.f)) / h.db;
  h.theta = liftOf(id, h.b, rest);
  h.lp = t0.w * cos(h.theta);
  h.t = h.a / h.lp;
  h.hw = (t1.w - lifts) * WIDTH_SPAN * 0.5 * spread;
  return h;
}

vec3 shadeSpine(Layer s, vec3 L, vec3 V, vec3 fur) {
  vec3 side = cross(s.b, s.f);
  float ct = cos(s.theta);
  float st = sin(s.theta);
  vec3 up = s.b * ct - s.f * st;
  float xr = clamp(s.xr, -1.0, 1.0);
  vec3 n = normalize(side * xr + up * sqrt(max(0.0, 1.0 - xr * xr)) + s.f * 0.12 * smoothstep(0.5, 1.0, s.t));
  uint h = hashU(s.id * 7u + 3u);
  float r1 = float(h & 0xffu) / 255.0;
  float r2 = float((h >> 8) & 0xffu) / 255.0;
  float r3 = float((h >> 16) & 0xffu) / 255.0;
  float r4 = float((h >> 24) & 0xffu) / 255.0;
  vec3 shaft = mix(CREAM, STRAW, r1);
  // Some spines are paler, a few browner all along.
  shaft = mix(shaft, PALE, step(0.8, r4) * 0.7);
  shaft = mix(shaft, shaft * vec3(0.5, 0.4, 0.3), step(r4, 0.06));
  // Dark where it leaves the skin, cream along the shaft, then brown into a black tip; a few
  // have no dark tip at all.
  float root = 1.0 - smoothstep(0.05, 0.2 + 0.12 * r2, s.t);
  float tipStart = r3 > 0.9 ? 2.0 : 1.0 - mix(0.26, 0.48, r2);
  float brown = smoothstep(tipStart - 0.1, tipStart + 0.04, s.t);
  float black = smoothstep(tipStart, tipStart + 0.14, s.t);
  vec3 c = mix(shaft, TIP_BROWN, brown);
  c = mix(c, TIP, black);
  c = mix(c, ROOT_BROWN, root);
  // Keratin is thinner at the edges, and a faint grain runs along it.
  c *= 0.95 + 0.05 * sin(xr * 5.0 + r3 * 6.2831) - 0.18 * xr * xr;
  float diff = max(0.0, dot(n, L)) * 0.9 + 0.1;
  vec3 hv = normalize(L + V);
  float nh = max(0.0, dot(n, hv));
  float spec = pow(nh, 60.0) * (0.7 - 0.35 * black) + pow(nh, 9.0) * 0.05;
  // The nearer the skin, the less light gets in between the other spines.
  float depth = mix(0.25, 1.0, smoothstep(0.0, H_MAX, s.h));
  c = (c * diff + GLOSS * spec) * depth;
  // The root disappears into the fur.
  return mix(fur, c, smoothstep(0.02, 0.17, s.t));
}

// --- Round the belly pole, in the plane x across, y towards the head (the body's z). Parts are
// height fields above the belly, lit from their slopes.

float sdCapsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

float alongOf(vec2 p, vec2 a, vec2 b) {
  vec2 ba = b - a;
  return clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0);
}

vec2 rot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Heights above the belly carry their slope with them, (height, d/dx, d/dy), so each part is
// lit from one evaluation.

// A tapering rod's round top at p.
vec3 rodHG(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 ba = b - a;
  float bb = dot(ba, ba);
  float t = clamp(dot(p - a, ba) / bb, 0.0, 1.0);
  vec2 off = p - a - ba * t;
  float r = mix(ra, rb, t);
  float h2 = r * r - dot(off, off);
  if (h2 <= 0.0) return vec3(0.0);
  float h = sqrt(h2);
  vec2 dr = t > 0.0 && t < 1.0 ? r * (rb - ra) * ba / bb : vec2(0.0);
  return vec3(h, (dr - off) / max(h, 1e-4));
}

// A low dome of radii r and height top, centred on 0.
vec3 domeHG(vec2 p, vec2 r, float top) {
  vec2 e = p / r;
  float k = 1.0 - dot(e, e);
  if (k <= 0.0) return vec3(0.0);
  float h = top * sqrt(k);
  return vec3(h, -top * top * p / (r * r) / max(h, 1e-4));
}

// A smooth maximum of two heights that stays zero where both are, and blends only where both
// stand up.
vec3 smaxHG(vec3 a, vec3 b, float k) {
  k *= smoothstep(0.0, k, min(a.x, b.x));
  if (k <= 0.0) return a.x >= b.x ? a : b;
  float m = clamp(0.5 + 0.5 * (a.x - b.x) / k, 0.0, 1.0);
  vec2 dm = m > 0.0 && m < 1.0 ? 0.5 * (a.yz - b.yz) / k : vec2(0.0);
  return vec3(mix(b.x, a.x, m) + k * m * (1.0 - m), mix(b.yz, a.yz, m) + (a.x - b.x + k * (1.0 - 2.0 * m)) * dm);
}

// Rotate v by the angle whose cosine and sine are cs.
vec2 turnBy(vec2 v, vec2 cs) {
  return vec2(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y);
}

struct Part {
  vec3 hg;
  float claw;
  // Along the claw, from its root (0) to its tip (1).
  float u;
};

// A claw from its root along dir, then on along tipDir: broad and flattened at the root,
// narrowing to a blunt point, its back falling away towards the tip as it curves down.
vec3 clawHG(vec2 q, vec2 root, vec2 dir, vec2 tipDir, float len, float ra, out float u) {
  vec2 mid = root + dir * len * 0.5;
  vec2 tip = mid + tipDir * len * 0.5;
  vec2 ba1 = mid - root;
  vec2 ba2 = tip - mid;
  float t1 = clamp(dot(q - root, ba1) / dot(ba1, ba1), 0.0, 1.0);
  float t2 = clamp(dot(q - mid, ba2) / dot(ba2, ba2), 0.0, 1.0);
  vec2 off1 = q - root - ba1 * t1;
  vec2 off2 = q - mid - ba2 * t2;
  float r1 = ra * mix(1.0, 0.72, t1);
  float r2 = ra * mix(0.72, 0.12, t2);
  float c1 = 1.0 - dot(off1, off1) / (r1 * r1);
  float c2 = 1.0 - dot(off2, off2) / (r2 * r2);
  bool first = c1 >= c2;
  float c2v = first ? c1 : c2;
  if (c2v <= 0.0) return vec3(0.0);
  float c = sqrt(c2v);
  vec2 off = first ? off1 : off2;
  float r = first ? r1 : r2;
  vec2 ba = first ? ba1 : ba2;
  float t = first ? t1 : t2;
  u = first ? t1 * 0.5 : 0.5 + t2 * 0.5;
  vec2 du = t > 0.0 && t < 1.0 ? 0.5 * ba / dot(ba, ba) : vec2(0.0);
  vec2 dc = -off / (r * r) / max(c, 0.05);
  float k = ra * 0.6 * (1.0 - 0.7 * u * u);
  float cp = pow(max(c, 0.02), 0.45);
  return vec3(cp * k, 0.45 * cp / max(c, 0.02) * dc * k + cp * ra * 0.6 * (-1.4 * u) * du);
}

// A front foot in its own frame (digits along +y), seen from the back: a broad padded hand of
// five thick digits side by side, each with a stout spade claw. curl draws the claws in under it.
Part frontFootH(vec2 q, float curl, vec2 curlTurn) {
  vec3 skin = domeHG(q - vec2(0.0, -0.01), vec2(0.095, 0.075), 0.048);
  vec3 claw = vec3(0.0);
  float along = 0.0;
  for (int k = 0; k < 5; k++) {
    vec3 digit = rodHG(q, FRONT_ROOT[k], FRONT_KNUCKLE[k], FRONT_R[k], FRONT_R[k] * 0.88);
    if (digit.x > 0.0) skin = smaxHG(skin, digit + vec3(0.016, 0.0, 0.0), 0.014);
    float cu;
    vec3 ch = clawHG(q, FRONT_CLAW_ROOT[k], FRONT_CLAW_DIR[k], turnBy(FRONT_CLAW_TIP[k], curlTurn), FRONT_CLAW_LEN[k] * (1.0 - 0.35 * curl), FRONT_R[k] * 0.92, cu);
    if (ch.x > 0.0 && ch.x + 0.02 > claw.x) {
      claw = ch + vec3(0.02, 0.0, 0.0);
      along = cu;
    }
  }
  bool horn = claw.x > skin.x;
  return Part(horn ? claw : skin, horn ? 1.0 : 0.0, along);
}

// A hind foot, turned backwards: a narrow sole and thin claws, the second the long curved
// grooming claw. spread fans the toes.
Part hindFootH(vec2 q, float spread) {
  vec3 skin = domeHG(q, vec2(0.066, 0.092), 0.04);
  vec3 claw = vec3(0.0);
  float along = 0.0;
  // Toes fan at half steps of one angle either side of straight on.
  float fan = 0.5 * (0.17 + 0.16 * spread);
  vec2 e1 = vec2(cos(fan), sin(fan));
  vec2 e3 = turnBy(turnBy(e1, e1), e1);
  for (int k = 0; k < 4; k++) {
    vec2 cs = k == 0 ? vec2(e3.x, -e3.y) : (k == 1 ? vec2(e1.x, -e1.y) : (k == 2 ? e1 : e3));
    vec2 dir = turnBy(vec2(0.0, 1.0), cs);
    vec2 root = dir * vec2(0.044, 0.078);
    vec3 toe = rodHG(q, root - dir * 0.026, root + dir * 0.016, 0.019, 0.015);
    if (toe.x > 0.0) skin = smaxHG(skin, toe + vec3(0.012, 0.0, 0.0), 0.01);
    float cu;
    vec3 ch = clawHG(q, root + dir * 0.006, dir, turnBy(dir, HIND_BEND[k]), HIND_CLAW_LEN[k], 0.014, cu);
    if (ch.x > 0.0 && ch.x + 0.014 > claw.x) {
      claw = ch + vec3(0.014, 0.0, 0.0);
      along = cu;
    }
  }
  bool horn = claw.x > skin.x;
  return Part(horn ? claw : skin, horn ? 1.0 : 0.0, along);
}

struct Shape {
  float cover;
  vec3 col;
  float h;
};

// Light a height-field part: hide for skin, horn for claws, dust on what faces out, and the
// skin's fine pebbling and creases in its colour.
vec3 shadePart(Part p, vec2 q, float facing, vec3 d, vec3 L, vec3 V, float aa) {
  vec3 nl = normalize(vec3(-p.hg.yz, 1.0));
  vec2 nxy = rot(nl.xy, facing);
  vec3 n = normalize(vec3(nxy.x, 0.0, nxy.y) + d * nl.z);
  float diff = max(0.0, dot(n, L)) * 0.85 + 0.15;
  vec3 hv = normalize(L + V);
  float nh = max(0.0, dot(n, hv));
  float detail = clamp(1.6 - aa * 160.0 * 1.8, 0.0, 1.0);
  float fine = noise3(vec3(q * 220.0, 8.3));
  float dust = smoothstep(0.3, 0.85, noise3(vec3(q * 70.0, 1.7)) * 0.55 + fine * 0.45 * detail);
  vec3 skin = mix(HIDE, DUST, (0.2 + 0.5 * dust) * (0.35 + 0.65 * nl.z * nl.z));
  skin *= 1.0 - 0.3 * smoothstep(0.55, 0.85, fine) * detail;
  vec3 horn = mix(CLAW, CLAW_TIP, smoothstep(0.25, 0.9, p.u));
  horn = mix(horn, DUST * 0.8, dust * 0.3 * (1.0 - p.u));
  vec3 c = mix(skin, horn, p.claw);
  // Creases and the gaps between digits are shadowed.
  float cavity = mix(0.45, 1.0, smoothstep(0.0, 0.028, p.hg.x));
  float spec = mix(pow(nh, 18.0) * 0.04, pow(nh, 30.0) * 0.12, p.claw);
  return (c * diff + GLOSS * spec) * cavity;
}

Shape frontFoot(vec2 p, vec2 at, float facing, float curl, vec3 d, vec3 L, vec3 V, float aa) {
  vec2 q = rot(p - at, -facing) / FOOT_SCALE;
  // Everything of it lies between its wrist and its longest claw's tip.
  if (length(q - vec2(0.0, 0.04)) > 0.15) return Shape(0.0, vec3(0.0), 0.0);
  float a = -0.25 * curl;
  Part part = frontFootH(q, curl, vec2(cos(a), sin(a)));
  if (part.hg.x <= 0.0) return Shape(0.0, vec3(0.0), 0.0);
  float cover = smoothstep(0.0, sqrt(0.04 * aa / FOOT_SCALE), part.hg.x);
  // The wrist goes back into the fur, under a ragged edge of hair.
  float hair = noise3(vec3(q.x * 260.0, q.y * 40.0, 2.9));
  cover *= smoothstep(-0.075, -0.035, q.y + (hair - 0.5) * 0.04);
  return Shape(cover, shadePart(part, q, facing, d, L, V, aa), part.hg.x * FOOT_SCALE);
}

Shape hindFoot(vec2 p, vec2 at, float facing, float spread, vec3 d, vec3 L, vec3 V, float aa) {
  vec2 q = rot(p - at, -facing) / FOOT_SCALE;
  if (length(q - vec2(0.0, 0.07)) > 0.18) return Shape(0.0, vec3(0.0), 0.0);
  Part part = hindFootH(q, spread);
  if (part.hg.x <= 0.0) return Shape(0.0, vec3(0.0), 0.0);
  float cover = smoothstep(0.0, sqrt(0.03 * aa / FOOT_SCALE), part.hg.x);
  float hair = noise3(vec3(q.x * 260.0, q.y * 40.0, 6.1));
  cover *= smoothstep(-0.09, -0.045, q.y + (hair - 0.5) * 0.04);
  return Shape(cover, shadePart(part, q, facing, d, L, V, aa), part.hg.x * FOOT_SCALE);
}

// Head: the bare, dusty forehead at the snout's base, with small closed eyes either side.
Shape head(vec2 p, vec3 d, vec3 L, float aa) {
  vec2 c = p - vec2(0.0, 0.46);
  float sd = (length(c / vec2(0.115, 0.1)) - 1.0) * 0.1;
  if (sd > 0.04) return Shape(0.0, vec3(0.0), 0.0);
  vec3 col = skinColour(d, aa) * 0.8;
  for (int k = 0; k < 2; k++) {
    float sx = k == 0 ? 1.0 : -1.0;
    vec2 r = rot(p - vec2(0.088 * sx, 0.425), sx * 0.55);
    // The lids closed over a small round eye: a low swelling with a dark crease along it.
    float lid = length(r / vec2(0.028, 0.014));
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.6, 1.1, lid));
    float crease = abs(r.y + uToesLid.y * 0.002) - 0.0014;
    col *= 1.0 - 0.75 * smoothstep(aa, -aa, crease) * smoothstep(0.026, 0.016, abs(r.x));
  }
  // Hair thickens towards its edge, into the fur round it.
  float hair = noise3(vec3(p * vec2(300.0, 300.0), 7.3));
  return Shape(smoothstep(0.03, -0.02, sd + (hair - 0.5) * 0.03), col, 0.0);
}

// Snout: a long, tapering, leathery tube, a little curved, ringed with fine creases, dusty on
// top and dark and wet at the tip, where the nostrils are.
Shape snout(vec2 p, vec3 d, vec3 L, vec3 V, float aa) {
  if (abs(p.x) > 0.16 || p.y > 0.5 || p.y < -0.36) return Shape(0.0, vec3(0.0), 0.0);
  vec2 base = vec2(0.0, SNOUT_BASE);
  vec2 tip = vec2(uSnout.x * 0.03, -0.21 - uSnout.y * 0.03 + uSnout.w * 0.1 - uBreath.x * 0.006);
  float h0 = alongOf(p, base, tip);
  vec2 q = p - vec2(0.02 * h0 * h0, 0.0);
  vec2 ba = tip - base;
  float blen = length(ba);
  vec2 axis = ba / blen;
  float u = clamp(dot(q - base, axis) / blen, 0.0, 1.0);
  float r = mix(0.098, 0.04, pow(u, 0.85));
  vec2 rel = q - (base + ba * u);
  float dist = length(rel);
  float sd = dist - r;
  if (sd > aa * 2.0) return Shape(0.0, vec3(0.0), 0.0);
  vec2 n2 = rel / r;
  float k2 = min(1.0, dot(n2, n2));
  float top = sqrt(1.0 - k2);
  // Rings of creases, closer together towards the base, wandering a little.
  float wob = noise3(vec3(q * 22.0, 4.0)) * 1.4 + noise3(vec3(q * 70.0, 9.0)) * 0.3;
  float phase = pow(1.0 - u, 1.2) * 54.0 + wob * 1.6;
  float ring = 0.5 + 0.5 * cos(phase * TAU);
  float creaseAmp = (1.0 - smoothstep(0.75, 0.95, u)) * clamp(1.6 - aa * 900.0, 0.0, 1.0);
  vec3 axis3 = vec3(axis.x, 0.0, axis.y);
  vec3 n = normalize(vec3(n2.x, 0.0, n2.y) + d * top + axis3 * sin(phase * TAU) * 0.18 * creaseAmp);
  float diff = max(0.0, dot(n, L)) * 0.85 + 0.15;
  vec3 hv = normalize(L + V);
  float nh = max(0.0, dot(n, hv));
  float wet = smoothstep(0.82, 0.97, u);
  float dust = smoothstep(0.3, 0.85, noise3(vec3(q * 60.0, 2.2)) * 0.55 + noise3(vec3(q * 200.0, 5.5)) * 0.45);
  vec3 col = mix(HIDE, DUST, (0.15 + 0.6 * dust) * top * (0.8 - 0.75 * wet));
  col *= 1.0 - 0.5 * pow(ring, 8.0) * creaseAmp;
  col *= 1.0 - 0.35 * wet;
  float spec = pow(nh, 16.0) * 0.04 + pow(nh, 60.0) * (0.06 + 0.22 * wet);
  col = col * diff + GLOSS * spec;
  // Nostrils on top at the tip, opening as it sniffs.
  vec2 across = vec2(axis.y, -axis.x);
  for (int k = 0; k < 2; k++) {
    vec2 c0 = tip - axis * 0.012 + across * (k == 0 ? 0.0075 : -0.0075);
    vec2 l = rot(vec2(dot(q - c0, across), dot(q - c0, axis)), k == 0 ? 0.3 : -0.3);
    float o = (length(l / vec2(0.0016 + 0.0016 * uSnout.z, 0.006)) - 1.0) * 0.0016;
    col = mix(col, vec3(0.0015), smoothstep(aa, -aa, o));
  }
  // It grows out of the skin of the forehead.
  col = mix(skinColour(d, aa) * 0.8, col, smoothstep(0.0, 0.1, h0));
  return Shape(smoothstep(aa, -aa, sd), col, r * top);
}

Shape overS(Shape under, Shape top) {
  return Shape(max(under.cover, top.cover), mix(under.col, top.col, top.cover), max(under.h, top.h * top.cover));
}

vec4 surface(vec3 dir) {
  float aa = max(length(dFdx(dir)), length(dFdy(dir)));
  aa = clamp(aa, 1e-4, 0.05);
  vec3 d = normalize(uSpin * dir);
  bool cap = dir.y > uCapY;
  vec3 L = normalize(d + 0.65 * uUp);
  vec3 V = normalize(d - 0.35 * uUp);

  // Spines: the two on top here.
  ivec2 cell = cubeTexel(d);
  ivec2 at = ivec2(cell.x * 2, cell.y);
  uvec4 words = texelFetch(uCand, at, 0);
  Layer top = Layer(0.0, -1.0, 0.0, 0.0, 0.0, 0u, vec3(0.0), vec3(0.0));
  Layer next = top;
  int limit = cap ? 3 : SLOTS;
  float spread = 1.0 - 0.08 * uBreath.x;
  for (int k = 0; k < SLOTS; k++) {
    if (k >= limit) break;
    if (k == HALF) words = texelFetch(uCand, at + ivec2(1, 0), 0);
    uint id = spineId(words, k & (HALF - 1));
    if (id == EMPTY) break;
    Hit h = hitOf(id, d, spread);
    if (h.db < 0.7) continue;
    // Narrower where it leaves the skin, widest a little way up, then to a fine point.
    float hwt = h.hw * taper(h.t) * mix(0.62, 1.0, smoothstep(0.0, 0.2, h.t));
    float cov = smoothstep(hwt + aa, hwt - aa, abs(h.x)) * smoothstep(-aa, aa, h.a) * step(h.t, 1.0);
    if (cov <= 0.0) continue;
    Layer here = Layer(cov, h.a * tan(h.theta) + 0.004, h.t, h.x / max(hwt, 1e-5), h.theta, id, h.b, h.f);
    if (top.cov <= 0.0) {
      top = here;
    } else if (over(here, top)) {
      next = top;
      top = here;
    } else if (next.cov <= 0.0 || over(here, next)) {
      next = here;
    }
  }
  // Where the top spine covers the pixel and its root isn't here, nothing below it shows.
  bool solid = top.cov >= 0.999 && top.t > 0.1;
  bool showNext = !solid && next.cov > 0.0;

  // Under the belly: the face and feet lie over the spines, and shadow the belly fur.
  bool low = d.y < -0.5;
  vec2 p = vec2(d.x, d.z);
  // Underneath the key light is straight on, so add some from one side of the room.
  vec3 Lf = normalize(L + 0.55 * (uSpin * vec3(0.8, 0.0, 0.6)));
  float rim = 0.0;
  float e = 2.0;
  Shape face = Shape(0.0, vec3(0.0), 0.0);
  Shape feet = face;
  Shape hind[2];
  hind[0] = face;
  hind[1] = face;
  float hindShow[2];
  hindShow[0] = 0.0;
  hindShow[1] = 0.0;
  float near = 1.0;
  if (low) {
    vec2 e2 = vec2(p.x / OPEN.y, (p.y - OPEN.x) / OPEN.z);
    e = dot(e2, e2);
    rim = smoothstep(1.02, 0.86, e);
    if (e < 1.25) {
      face = frontFoot(p, FRONT_FOOT, 2.85, uFeet.x, d, Lf, V, aa);
      face = overS(face, frontFoot(p, FRONT_FOOT * vec2(-1.0, 1.0), -2.85, uFeet.y, d, Lf, V, aa));
      feet = face;
      face = overS(head(p, d, Lf, aa), snout(p, d, Lf, V, aa));
      near = min(near, min(sdCapsule(p, vec2(0.0, SNOUT_BASE), vec2(0.0, -0.22), 0.1, 0.05), length(vec2(abs(p.x), p.y) - FRONT_FOOT) - 0.12));
    }
    for (int k = 0; k < 2; k++) {
      float sx = k == 0 ? 1.0 : -1.0;
      float s = k == 0 ? uFeet.z : uFeet.w;
      // Tucked, a foot shows only inside the curl.
      hindShow[k] = max(rim, smoothstep(0.05, 0.4, s));
      if (hindShow[k] <= 0.0) continue;
      vec2 c = vec2(HIND_FOOT.x * sx, HIND_FOOT.y) + vec2(0.25 * sx, -0.08) * s;
      hind[k] = hindFoot(p, c, sx * (2.75 + 0.55 * s), uToesLid.x * s, d, Lf, V, aa);
      near = min(near, length(p - c) - 0.09);
    }
  }

  vec3 fur = vec3(0.0);
  if (!solid || (low && rim > 0.0)) {
    // Deep in the coat, under the spines, little light reaches the fur.
    fur = furColour(d, aa) * 0.5;
    if (rim > 0.0) {
      // Sparse, browner hair lying out from the middle of the curl.
      vec2 c = p - vec2(0.0, OPEN.x);
      float n = strands(vec2(length(c) * 30.0, atan(c.y, c.x) * 70.0), aa, 260.0);
      vec3 belly = mix(FUR_DARK, FUR_LIGHT, n) * vec3(1.15, 1.0, 0.9);
      // Shadowed in the curl, most of all against the face and feet and under the rim.
      belly *= (0.45 + 0.55 * smoothstep(0.0, 0.07, near)) * (0.6 + 0.4 * smoothstep(1.0, 0.55, e));
      fur = mix(fur, belly, rim);
    }
    float bare = bareness(d);
    if (bare > 0.0) fur = mix(fur, skinColour(d, aa) * 0.8, bare);
  }

  vec3 col = fur;
  if (showNext) col = mix(col, shadeSpine(next, L, V, fur) * 0.8, next.cov);
  if (top.cov > 0.0) col = mix(col, shadeSpine(top, L, V, fur), top.cov);

  if (low) {
    col = mix(col, feet.col, feet.cover * rim);
    // The head reaches a little past the opening, into the bare skin round it.
    col = mix(col, face.col, face.cover * smoothstep(1.25, 1.0, e));
    for (int k = 0; k < 2; k++) {
      col = mix(col, hind[k].col, hind[k].cover * hindShow[k]);
    }
  }

  col *= EXPOSURE * uExposure * mix(1.0, 0.7, smoothstep(uCapY, uCapY + 0.15, dir.y));
  return vec4(col, 1.0);
}
`;
