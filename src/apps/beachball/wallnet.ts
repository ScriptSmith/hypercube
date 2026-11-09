/**
 * A beach volleyball net across the middle of the wall. Its front post stands on the balls'
 * line of sand at the middle of the wall, where the balls meet it, and the net runs back from
 * there into the beach at an angle to a second post short of the wash. The beach shader paints
 * it in the same perspective as the sand (an eye at the horizon's height, `EYE_DISTANCE` from
 * the wall), with its shadow on the sand from the sun.
 *
 * Coordinates here are the beach's: x along the wall, y up, z into the beach behind the wall.
 */
import { EYE_DISTANCE, type NetLayout } from "./walllayout";
import { WAVE_RUN } from "./wallsea";

/** The net runs back at this angle from straight into the beach, towards the right. */
export const NET_ANGLE = (55 * Math.PI) / 180;
export const NET_LENGTH = 4.5;

export interface NetScene {
  /** The front post's foot on the sand. */
  fx: number;
  fz: number;
  /** Along the net, on the sand. */
  ux: number;
  uz: number;
  length: number;
  /** Heights of the tape's top and the mesh's bottom, and the posts' radius, metres. */
  top: number;
  bottom: number;
  post: number;
  /** Where on the wall the net and posts are drawn: left, bottom, right, top, metres. */
  box: readonly [number, number, number, number];
  /** Where on the sand its shadow can fall: least and most x and depth. */
  shade: readonly [number, number, number, number];
}

/** The posts stand this far above the tape, as in the shader. */
const CAP = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const netScene = (
  net: NetLayout,
  floor: number,
  horizon: number,
  shore: number,
  width: number,
  sun: readonly [number, number, number],
): NetScene => {
  const d = EYE_DISTANCE;
  const e = horizon;
  /** How far into the beach the sand drawn at wall height `y` lies. */
  const depth = (y: number) => (y * d) / Math.max(1e-3, e - y);
  const z0 = depth(floor);
  // Things standing on the balls' line are drawn this much smaller than they are.
  const grow = (d + z0) / d;
  const real = (y: number) => e + (y - e) * grow;
  const cx = width / 2;
  // The far post stands on dry sand, short of where ordinary waves run up to.
  const wash = depth(Math.max(floor + 0.05, shore - WAVE_RUN[1]));
  const room = Math.max(0.8, wash - z0 - 0.6);
  const length = clamp(room / Math.cos(NET_ANGLE), 1.5, NET_LENGTH);
  const fx = cx + (net.x - cx) * grow;
  const ux = Math.sin(NET_ANGLE);
  const uz = Math.cos(NET_ANGLE);
  const top = real(net.top);
  const post = net.radius * grow;
  const feet = [
    [fx, z0],
    [fx + ux * length, z0 + uz * length],
  ] as const;
  // The posts on the wall: each a strip from its foot to its top.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, z] of feet) {
    const k = d / (d + z);
    xs.push(cx + (x - cx) * k);
    ys.push(e * (1 - k), e + (top + CAP - e) * k);
  }
  const pad = 2 * post + 0.03;
  // The shadow: the net's foot line and the same line moved away from the sun by its height.
  const ax = (-sun[0] / sun[1]) * (top + CAP);
  const az = (sun[2] / sun[1]) * (top + CAP);
  const sx = [feet[0][0], feet[1][0], feet[0][0] + ax, feet[1][0] + ax];
  const sz = [feet[0][1], feet[1][1], feet[0][1] + az, feet[1][1] + az];
  const blur = 0.15;
  return {
    fx,
    fz: z0,
    ux,
    uz,
    length,
    top,
    bottom: real(net.bottom),
    post,
    box: [
      Math.min(...xs) - pad,
      Math.min(...ys) - pad,
      Math.max(...xs) + pad,
      Math.max(...ys) + pad,
    ],
    shade: [
      Math.min(...sx) - blur,
      Math.min(...sz) - blur,
      Math.max(...sx) + blur,
      Math.max(...sz) + blur,
    ],
  };
};

/**
 * GLSL for the beach: `netShade(G)` darkens the sand point G under the net's shadow, and
 * `netPaint(col, p, s)` paints the posts, mesh and tapes over wall point (p.x, s). Needs
 * `uSize`, `uSun` (wall frame, towards the sun), the light uniforms (`LIGHT_GLSL`) and the
 * uniforms below. Each works only inside
 * its box, so the rest of the wall costs a comparison; for that they take no derivatives, and
 * measure a pixel's footprint by stepping one pixel along.
 */
export const NET_GLSL = /* glsl */ `
// The front post's foot (x, depth) and the net's direction along the sand (x, depth).
uniform vec4 uNetA;
// Length, the tape's top, the mesh's bottom and the posts' radius; a length of 0 is no net.
uniform vec4 uNetB;
// Where the net is drawn on the wall, and where its shadow falls on the sand (x, depth).
uniform vec4 uNetBox;
uniform vec4 uNetShadeBox;
// Metres of wall a pixel spans.
uniform float uNetPx;
const float NET_CELL = 0.1;
const float NET_CORD = 0.007;
const float NET_TAPE_H = 0.075;
const float NET_HEM = 0.035;
const float NET_SIDE = 0.05;
const float NET_CAP = 0.05;

float netBox(float v, float lo, float hi, float fw) {
  return smoothstep(lo - fw, lo + fw, v) * (1.0 - smoothstep(hi - fw, hi + fw, v));
}

// The beach's light, as on the balls: the sun, the sky, the sand and the beach behind the people.
vec3 netLight(vec3 n) {
  return uLightSun * max(dot(n, uSun), 0.0)
    + uLightSky * (0.5 + 0.5 * n.y)
    + uLightSand * (0.5 - 0.5 * n.y)
    + uLightBehind * (0.5 + 0.5 * n.z);
}

float postShade(vec2 g, vec2 foot, vec2 away, float height, float r) {
  vec2 ab = away * height;
  float k = clamp(dot(g - foot, ab) / dot(ab, ab), 0.0, 1.0);
  float d = length(g - foot - ab * k);
  float blur = 0.008 + 0.01 * k * height;
  return 0.42 * (1.0 - smoothstep(r - blur, r + blur, d));
}

float netShade(vec3 G) {
  if (uNetB.x <= 0.0 || G.x < uNetShadeBox.x || G.x > uNetShadeBox.z || G.z < uNetShadeBox.y
    || G.z > uNetShadeBox.w) return 1.0;
  vec3 S = vec3(uSun.x, uSun.y, -uSun.z);
  vec3 F = vec3(uNetA.x, 0.0, uNetA.y);
  vec3 U = vec3(uNetA.z, 0.0, uNetA.w);
  vec3 N = vec3(U.z, 0.0, -U.x);
  float L = uNetB.x;
  float top = uNetB.y;
  float bottom = uNetB.z;
  float dark = 0.0;
  float den = dot(N, S);
  float t = dot(N, F - G) / (abs(den) < 1e-6 ? 1e-6 : den);
  if (t > 0.0) {
    vec3 H = G + t * S;
    float u = dot(H - F, U);
    float blur = 0.012 + 0.012 * t;
    float along = netBox(u, 0.0, L, blur);
    dark += along * (0.13 * netBox(H.y, bottom - NET_HEM, top - NET_TAPE_H, blur)
      + 0.42 * netBox(H.y, top - NET_TAPE_H, top, blur));
  }
  vec2 away = -S.xz / S.y;
  dark += postShade(G.xz, F.xz, away, top + NET_CAP, uNetB.w);
  dark += postShade(G.xz, (F + L * U).xz, away, top + NET_CAP, uNetB.w);
  return 1.0 - min(dark, 0.55);
}

// A post: an aluminium pole with a padded sleeve low down, its top a disc seen from above.
vec3 netPost(vec3 col, vec2 p, float s, vec2 foot, float horizon, float dist, float fx) {
  float k = dist / (dist + foot.y);
  float cx = 0.5 * uSize.x;
  float x = cx + (foot.x - cx) * k;
  // The pad reaches up to just under the mesh.
  float pad = s < horizon + (uNetB.z - NET_HEM - 0.04 - horizon) * k ? 1.0 : 0.0;
  float w = uNetB.w * k * (1.0 + 0.3 * pad);
  float y0 = horizon * (1.0 - k);
  float y1 = horizon + (uNetB.y + NET_CAP - horizon) * k;
  float dx = (p.x - x) / w;
  float tip = y1 + 0.45 * w * sqrt(max(0.0, 1.0 - dx * dx));
  float c = (1.0 - smoothstep(w - fx, w + fx, abs(p.x - x)))
    * smoothstep(y0 - fx, y0 + fx, s) * (1.0 - smoothstep(tip - fx, tip + fx, s));
  float nx = clamp(dx, -1.0, 1.0);
  vec3 n = vec3(nx, 0.0, sqrt(max(0.0, 1.0 - nx * nx)));
  if (s > y1) n = normalize(vec3(nx * 0.4, 1.0, 0.35));
  vec3 lit;
  if (pad > 0.5) {
    lit = vec3(0.020, 0.055, 0.20) * netLight(n);
    lit += skyEnv(vec3(0.0, 0.3, 1.0)) * 0.08 * pow(1.0 - n.z, 2.0);
  } else {
    lit = vec3(0.70, 0.72, 0.74) * netLight(n);
    lit += skyEnv(vec3(n.x, 0.2, n.z)) * 0.45 * pow(1.0 - n.z, 3.0);
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    lit += uGlint * 0.25 * (uLightSun.r / 0.55) * pow(max(dot(r, uSun), 0.0), 20.0);
  }
  return mix(col, lit, c);
}

// Where the eye's ray through wall point (x, s) meets the net's plane: (t, along, height).
vec3 netHit(float x, float s, float horizon, float dist) {
  vec3 E = vec3(0.5 * uSize.x, horizon, -dist);
  vec3 D = vec3(x - E.x, s - E.y, dist);
  vec3 F = vec3(uNetA.x, 0.0, uNetA.y);
  vec3 U = vec3(uNetA.z, 0.0, uNetA.w);
  vec3 N = vec3(U.z, 0.0, -U.x);
  float den = dot(N, D);
  float t = dot(N, F - E) / (abs(den) < 1e-6 ? 1e-6 : den);
  vec3 P = E + t * D;
  return vec3(t, dot(P - F, U), P.y);
}

vec3 netPaint(vec3 col, vec2 p, float s, float horizon, float dist) {
  if (uNetB.x <= 0.0 || p.x < uNetBox.x || p.x > uNetBox.z || s < uNetBox.y || s > uNetBox.w) {
    return col;
  }
  vec3 E = vec3(0.5 * uSize.x, horizon, -dist);
  vec3 F = vec3(uNetA.x, 0.0, uNetA.y);
  vec3 U = vec3(uNetA.z, 0.0, uNetA.w);
  vec3 N = vec3(U.z, 0.0, -U.x);
  vec3 hit = netHit(p.x, s, horizon, dist);
  vec3 hx = netHit(p.x + uNetPx, s, horizon, dist);
  vec3 hy = netHit(p.x, s + uNetPx, horizon, dist);
  float t = hit.x;
  float u = hit.y;
  float h = hit.z;
  vec3 P = E + t * vec3(p.x - E.x, s - E.y, dist);
  float fu = abs(hx.y - u) + abs(hy.y - u);
  float fh = abs(hx.z - h) + abs(hy.z - h);
  float fx = uNetPx;
  float L = uNetB.x;
  float top = uNetB.y;
  float bottom = uNetB.z;
  col = netPost(col, p, s, (F + L * U).xz, horizon, dist, fx);
  float inside = step(0.0, t) * netBox(u, 0.0, L, fu) * netBox(h, bottom - NET_HEM, top, fh);
  if (inside > 0.0) {
    float tape = smoothstep(top - NET_TAPE_H - fh, top - NET_TAPE_H + fh, h);
    float hem = 1.0 - smoothstep(bottom - fh, bottom + fh, h);
    float side = 1.0 - netBox(u, NET_SIDE, L - NET_SIDE, fu);
    float band = max(max(tape, hem), side);
    vec2 q = vec2(u, h - bottom) / NET_CELL;
    vec2 fw = max(vec2(fu, fh) / NET_CELL, vec2(1e-4));
    vec2 d = fract(q + 0.5) - 0.5;
    float hw = 0.5 * NET_CORD / NET_CELL;
    vec2 cov = max(vec2(0.0), min(d + 0.5 * fw, vec2(hw)) - max(d - 0.5 * fw, vec2(-hw))) / fw;
    cov = mix(cov, vec2(2.0 * hw), smoothstep(0.35, 1.0, fw));
    float cords = 1.0 - (1.0 - cov.x) * (1.0 - cov.y);
    vec3 face = N * sign(dot(N, E - P));
    vec3 light = netLight(vec3(face.x, 0.0, -face.z));
    // A faint crease where the tape folds over the top cord.
    float fold = 1.0 - 0.12 * netBox(h, top - 0.5 * NET_TAPE_H - 0.004, top - 0.5 * NET_TAPE_H + 0.004, fh);
    vec3 net = mix(col, vec3(0.035, 0.04, 0.05) * light + 0.015, cords * 0.95);
    net = mix(net, vec3(0.86, 0.87, 0.86) * light * fold, band);
    col = mix(col, net, inside);
  }
  return netPost(col, p, s, F.xz, horizon, dist, fx);
}
`;
