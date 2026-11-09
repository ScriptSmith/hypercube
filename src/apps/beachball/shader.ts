/**
 * The ball's surface. `VINYL_GLSL` turns a direction from the centre into the ball's own frame
 * and works out the vinyl there (gore, cap, seam, valve, creases, sand, drops) as a colour and a
 * tilt of the surface; the sphere and the wall each light it their own way.
 *
 * On the sphere (`BALL_GLSL`, for a `SurfacePass`) the light belongs to the room: a broad soft
 * light overhead and a dim bounce from the floor, the same all round, so the print turns under a
 * fixed sheen. With people all round there is no one viewer, so each point is lit as seen by
 * someone standing on its side of the ball, and points underneath as seen from right below.
 */
import { CAP_RADIUS, GORE_WIDTH, GORES, SAND_SPREAD, SEAM_HALF, VALVE_POLE } from "./geometry";

const f = (n: number): string => {
  const s = String(n);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};

/**
 * Declares the ball's uniforms and `Vinyl vinyl(vec3 dir, float aa)`: the vinyl at the unit
 * direction `dir` from the centre (the room's frame), with `aa` the angle a pixel spans there.
 * Needs `SPHERE_PI` defined before it.
 */
export const VINYL_GLSL = /* glsl */ `
uniform mat3 uSpin;
uniform vec3 uGore[${GORES}];
uniform vec3 uCapColour;
uniform vec3 uValveColour;
uniform vec4 uDrop[3];
uniform vec4 uDropAlong[3];
uniform vec3 uSand;

const float GORE_W = ${f(GORE_WIDTH)};
const float CAP_R = ${f(CAP_RADIUS)};
const float SEAM_HALF = ${f(SEAM_HALF)};
const float VALVE_POLE = ${f(VALVE_POLE)};
const float SAND_SPREAD = ${f(SAND_SPREAD)};
const float SAND_REACH = ${f(Math.cos(SAND_SPREAD * 3))};
const float SAND_CELL = 0.012;
// How far a welded seam and a crease tip the surface (tangent of the angle).
const float SEAM_TILT = 0.32;
const float CREASE_TILT = 0.16;

// A small integer mixer for placing grains of sand, our own constants.
float hash01(uint x) {
  x ^= x >> 16u;
  x *= 0x6c8e9cf5u;
  x ^= x >> 13u;
  x *= 0x7a3d1b27u;
  x ^= x >> 16u;
  return float(x >> 8u) / 16777216.0;
}

float cellHash(ivec2 c, uint salt) {
  return hash01(uint(c.x) * 0x9e3779b9u + uint(c.y) * 0x632be5abu + salt * 0x2f6b5a3du);
}

float noise1(float x, uint salt) {
  float i = floor(x);
  float t = x - i;
  uint k = uint(int(i) + 8192) * 0x9e3779b9u + salt * 0x632be5abu;
  return mix(hash01(k), hash01(k + 0x9e3779b9u), t * t * (3.0 - 2.0 * t));
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// The valve, on flat coordinates of its cap (about radians from the pole): a round welded base,
// the stem folded flat against the cap with the stopper pushed into its end, and the strap that
// keeps the stopper. Returns the height; d is how far outside every part q is.
const vec2 V_BASE = vec2(0.0, 0.05);
const float V_BASE_R = 0.055;
const vec2 V_TIP = vec2(0.03, -0.045);
const float V_STEM_R = 0.024;
const float V_PLUG_R = 0.032;
const vec2 V_STRAP_A = vec2(-0.05, 0.028);
const vec2 V_STRAP_B = vec2(0.004, -0.058);
const float V_STRAP_R = 0.0085;

float valveHeight(vec2 q, out float d, out float part) {
  float db = length(q - V_BASE);
  float hb = 0.006 * smoothstep(V_BASE_R, V_BASE_R - 0.012, db)
    + 0.003 * exp(-pow((db - 0.03) / 0.007, 2.0));
  float ds = segDist(q, V_BASE, V_TIP);
  float hs = ds < V_STEM_R ? 0.006 + 0.013 * sqrt(1.0 - pow(ds / V_STEM_R, 2.0)) : 0.0;
  float dp = length(q - V_TIP);
  float hp = dp < V_PLUG_R
    ? 0.009 + 0.014 * sqrt(1.0 - pow(dp / V_PLUG_R, 2.0)) - 0.006 * smoothstep(0.016, 0.009, dp)
    : 0.0;
  float dt = segDist(q, V_STRAP_A, V_STRAP_B);
  float ht = 0.004 * smoothstep(V_STRAP_R, V_STRAP_R - 0.003, dt);
  d = min(min(db - V_BASE_R, ds - V_STEM_R), min(dp - V_PLUG_R, dt - V_STRAP_R));
  part = hp > max(max(hs, hb), ht) ? 2.0 : (ht > max(hs, hb) ? 3.0 : 1.0);
  return max(max(hb, hs), max(hp, ht));
}

vec3 sandColour(float h) {
  if (h < 0.42) return vec3(0.66, 0.6, 0.46);
  if (h < 0.7) return vec3(0.46, 0.36, 0.2);
  if (h < 0.86) return vec3(0.27, 0.25, 0.22);
  if (h < 0.95) return vec3(0.08, 0.065, 0.05);
  return vec3(0.82, 0.78, 0.7);
}

struct Vinyl {
  vec3 albedo;
  // The surface's normal, in the room's frame.
  vec3 n;
  float ao;
  float shine;
  float gloss;
  float wet;
};

Vinyl vinyl(vec3 dir, float aa) {
  vec3 b = uSpin * dir;
  float lat = asin(clamp(b.y, -1.0, 1.0));
  float lon = atan(b.x, b.z + 1e-9);
  float cl = sqrt(max(1.0 - b.y * b.y, 1e-8));
  vec3 east = vec3(b.z, 0.0, -b.x) / cl;
  vec3 north = cross(b, east);
  float polar = 0.5 * SPHERE_PI - abs(lat);
  float pole = b.y >= 0.0 ? 1.0 : -1.0;
  vec3 away = -pole * north;

  vec3 grad = vec3(0.0);
  float ao = 1.0;
  float shine = 0.0;
  float gloss = 1.0;

  // Gores, and the welded seams between them, which end under the caps.
  float g = (lon + SPHERE_PI) / GORE_W;
  float gi = floor(g);
  float seamIdx = gi + step(0.5, g - gi);
  float s = cl * sin(lon - (seamIdx * GORE_W - SPHERE_PI));
  int eastI = clamp(int(mod(seamIdx, ${f(GORES)}) + 0.5), 0, ${GORES - 1});
  int westI = clamp(int(mod(seamIdx + ${f(GORES - 1)}, ${f(GORES)}) + 0.5), 0, ${GORES - 1});
  float wobble = SEAM_HALF * 0.3 * (noise1(lat * 30.0, uint(seamIdx + 0.5)) * 2.0 - 1.0);
  vec3 albedo = mix(uGore[westI], uGore[eastI], smoothstep(-aa, aa, s - wobble));
  float seamOn = smoothstep(CAP_R - 0.003, CAP_R + 0.006, polar);
  float x = s / SEAM_HALF;
  if (abs(x) < 1.0 && seamOn > 0.0) {
    float k = 1.0 - x * x;
    grad += east * (-SEAM_TILT * 2.6 * x * k * seamOn);
    shine += k * k * seamOn;
    float lap = max(0.15, aa / SEAM_HALF);
    albedo *= 1.0 - 0.1 * seamOn * exp(-pow((abs(x) - 0.88) / lap, 2.0));
  }

  // End caps, welded over the gore tips, with a slightly uneven edge.
  float capWobble = SEAM_HALF * 0.35 * (0.6 * sin(7.0 * lon + 1.3 * pole) + 0.4 * sin(13.0 * lon - 0.7 * pole));
  albedo = mix(albedo, uCapColour, 1.0 - smoothstep(-aa, aa, polar - CAP_R - capWobble));
  float xc = (polar - CAP_R) / SEAM_HALF;
  if (abs(xc) < 1.0) {
    float k = 1.0 - xc * xc;
    grad += away * (-SEAM_TILT * 2.6 * xc * k);
    shine += k * k;
  }

  // Creases where the vinyl gathers round each cap, bunched where the gore tips meet it.
  float band = polar - CAP_R;
  if (band > 0.0 && band < 0.35) {
    float fade = exp(-band / 0.09) * smoothstep(0.0, 0.012, band);
    float ph = pole > 0.0 ? 0.0 : 2.4;
    float a1 = 29.0 * lon + ph;
    float a2 = 47.0 * lon + 1.7 + 1.9 * ph;
    float a3 = 83.0 * lon + 4.1 + 0.6 * ph;
    float hgt = 0.55 * cos(a1) + 0.3 * cos(a2) + 0.15 * cos(a3);
    float slope = -(0.55 * sin(a1) + 0.3 * sin(a2) + 0.15 * sin(a3));
    float bunch = 0.3 + 0.7 * pow(0.5 + 0.5 * cos(6.0 * (lon + SPHERE_PI)), 3.0);
    float amp = fade * bunch;
    grad += east * (CREASE_TILT * amp * slope);
    ao *= 1.0 - 0.22 * amp * max(0.0, -hgt);
  }

  // The valve.
  if (pole == VALVE_POLE && polar < CAP_R) {
    vec2 q = b.xz * (2.0 / (1.0 + abs(b.y)));
    float d;
    float part;
    float hv = valveHeight(q, d, part);
    if (d < 0.04) {
      float cover = 1.0 - smoothstep(-aa, aa, d);
      float e = 0.0012;
      float d1;
      float p1;
      vec2 gq = vec2(
        valveHeight(q + vec2(e, 0.0), d1, p1) - valveHeight(q - vec2(e, 0.0), d1, p1),
        valveHeight(q + vec2(0.0, e), d1, p1) - valveHeight(q - vec2(0.0, e), d1, p1)
      ) / (2.0 * e);
      float gl = length(gq);
      gq *= min(1.0, 2.5 / max(gl, 1e-6));
      grad += vec3(gq.x, 0.0, gq.y) * cover;
      vec3 plastic = uValveColour * (0.82 + 0.18 * clamp(hv / 0.023, 0.0, 1.0));
      if (part > 1.5) plastic *= part > 2.5 ? vec3(0.93, 0.95, 0.97) : vec3(0.96, 0.97, 1.0);
      albedo = mix(albedo, plastic, cover);
      gloss = mix(gloss, 1.4, cover);
      ao *= 1.0 - 0.35 * (1.0 - cover) * exp(-max(d, 0.0) / 0.008);
    }
  }

  // A few grains of sand stuck near one cap.
  float sc = dot(b, uSand);
  if (sc > SAND_REACH) {
    vec3 t1 = normalize(cross(vec3(0.0, 1.0, 0.0), uSand));
    vec3 t2 = cross(uSand, t1);
    vec2 q = vec2(dot(b, t1), dot(b, t2)) / SAND_CELL;
    vec2 cell = floor(q);
    ivec2 ci = ivec2(cell) + 4096;
    vec2 cc = (cell + 0.5) * SAND_CELL;
    float dens = 0.65 * exp(-dot(cc, cc) / (SAND_SPREAD * SAND_SPREAD));
    if (cellHash(ci, 1u) < dens) {
      vec2 fq = q - cell - 0.5 - (vec2(cellHash(ci, 2u), cellHash(ci, 3u)) - 0.5) * 0.36;
      float a = cellHash(ci, 4u) * 6.2831853;
      vec2 fr = mat2(cos(a), sin(a), -sin(a), cos(a)) * fq;
      fr.x *= 1.35;
      float rg = 0.2 + 0.18 * cellHash(ci, 5u);
      float rr = length(fr) / rg;
      float cover = 1.0 - smoothstep(1.0 - aa / (rg * SAND_CELL), 1.0, rr);
      grad += (t1 * fq.x + t2 * fq.y) * (0.9 / rg) * cover;
      albedo = mix(albedo, sandColour(cellHash(ci, 6u)), cover);
      gloss = mix(gloss, 0.25, cover);
      ao *= 1.0 - 0.15 * (1.0 - cover) * smoothstep(1.7, 1.0, rr);
    }
  }

  // Drops of water: lenses with a dark rim, a glint and light focused on their low side.
  float wet = 0.0;
  vec3 downB = uSpin * vec3(0.0, -1.0, 0.0);
  for (int i = 0; i < 3; i++) {
    vec4 D = uDrop[i];
    if (D.w <= 0.0 || dot(b, D.xyz) < 0.0) continue;
    vec3 ax = uDropAlong[i].xyz;
    vec3 ay = cross(D.xyz, ax);
    vec2 q = vec2(dot(b, ax), dot(b, ay)) / D.w;
    if (dot(q, q) > 9.0) continue;
    vec2 qs = vec2(q.x < 0.0 ? q.x / uDropAlong[i].w : q.x, q.y);
    float rho = length(qs);
    float cover = 1.0 - smoothstep(1.0 - aa / D.w, 1.0, rho);
    ao *= 1.0 - 0.15 * (1.0 - cover) * smoothstep(1.3, 1.0, rho);
    if (cover <= 0.0) continue;
    float hgt = sqrt(max(1.0 - rho * rho, 0.0));
    vec2 sl = qs * (-0.55 / max(hgt, 0.3));
    grad = mix(grad, ax * sl.x + ay * sl.y, cover);
    vec2 dn = vec2(dot(downB, ax), dot(downB, ay));
    dn /= max(length(dn), 1e-4);
    vec2 qc = qs - dn * 0.45;
    float caustic = exp(-dot(qc, qc) / 0.05);
    float lens = (1.0 - 0.45 * smoothstep(0.65, 1.0, rho)) * (1.0 + 0.9 * caustic);
    albedo *= mix(1.0, lens, cover);
    wet = max(wet, cover);
  }

  Vinyl m;
  m.albedo = albedo;
  m.n = normalize(b - grad) * uSpin;
  m.ao = ao;
  m.shine = shine;
  m.gloss = gloss;
  m.wet = wet;
  return m;
}
`;

/** The sphere's surface, for a `SurfacePass`: the vinyl lit by the room round the ball. */
export const BALL_GLSL = /* glsl */ `
${VINYL_GLSL}
uniform float uCentreY;
uniform float uRadius;
uniform float uHidden;
uniform float uAA;
uniform float uExposure;

const float EYE = 1.6;

// The room as the vinyl reflects it: a broad soft light overhead, the ceiling round it, dim
// walls and a dark floor. Sharper for water than for vinyl.
float roomLight(vec3 r, float sharp) {
  float box = smoothstep(0.97 - 0.35 / sharp, 0.97, r.y);
  float ceiling = 0.12 * smoothstep(-0.1, 0.7, r.y);
  float walls = 0.05 * exp(-r.y * r.y * 12.0);
  return 3.0 * box + ceiling + walls + 0.012;
}

vec4 surface(vec3 dir) {
  Vinyl m = vinyl(dir, uAA);
  vec3 albedo = m.albedo;
  vec3 n = m.n;
  float ao = m.ao;
  float shine = m.shine;
  float gloss = m.gloss;
  float wet = m.wet;
  vec3 p = vec3(0.0, uCentreY, 0.0) + uRadius * dir;
  vec2 h = dir.xz;
  float hl = length(h);
  h = hl > 1e-5 ? h / hl : vec2(0.0, 1.0);
  float far = 4.0 * uRadius * smoothstep(-0.92, -0.35, dir.y);
  vec3 v = normalize(vec3(h.x * far, EYE, h.y * far) - p);
  float nv = max(dot(n, v), 0.05);
  vec3 r = reflect(-v, n);
  float f0 = mix(0.045, 0.03, wet);
  float fres = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  float spec = fres * roomLight(r, mix(1.0, 3.5, wet)) * gloss;
  float key = 0.46 + 0.54 * pow(0.5 + 0.5 * n.y, 1.4);
  float fill = 0.14 * max(0.0, -n.y);
  vec3 col = albedo * (key + fill) * ao
    + vec3(1.0, 0.98, 0.95) * (spec * mix(1.0, ao, 0.5) + shine * 0.035 * (0.5 + 0.5 * n.y));
  // Nobody sees the top of the ball well, so it needn't be as bright.
  col *= uExposure * mix(1.0, 0.8, smoothstep(uHidden, uHidden + 0.25, dir.y));
  return vec4(col, 1.0);
}
`;
