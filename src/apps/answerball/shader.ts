/**
 * The ball's surface for a `SurfacePass`: glossy dark moulded plastic with a window, and behind
 * the window dark liquid with the die in it.
 *
 * The plastic mirrors a room fixed in the venue (a ring of downlights, four lit openings in the
 * walls, a dim floor), so its highlights stay put while the ball turns under them; only the
 * plastic's faint orange-peel ripple and its mould seam turn with it. With people all round there
 * is no one viewer, so each part is drawn as seen by someone standing in front of it: out along
 * its normal at eye level, or as far off as people stand, and for the bottom cap someone under
 * the ball.
 *
 * Inside the window everything is drawn for one viewer straight in front of it: a ray from them
 * through the glass meets the die (twenty planes, so a handful of dot products), specks drifting
 * at two depths, and the prompt's words deep in the liquid. The liquid swallows light, so the
 * face against the glass is clear, the faces sloping away from it fade, and a die deep in the
 * dark is dim and soft.
 *
 * Defined ANSWERBALL_WALL, it is a ball on a wall seen by one eye in front (`wallview.ts`): every
 * part is drawn for that eye, inside the window too, and the room it mirrors is a dark studio
 * with the backdrop behind and below, a softbox to one side, a strip light on the other and a
 * lamp overhead.
 */
import { FACE_RADIUS, FACES, INRADIUS } from "./die";
import { CONTACT_Z, DIE_SCALE, FACE_SIZE } from "./motion";
import { COLUMNS, ROWS } from "./atlas";
import { BUBBLES } from "./bubbles";
import { WINDOW_RADIUS } from "./show";

const f = (n: number): string => {
  const s = Number(n.toFixed(7)).toString();
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};
const v3 = (v: readonly number[]) => `vec3(${v.map(f).join(", ")})`;
const v2 = (v: readonly number[]) => `vec2(${v.map(f).join(", ")})`;

const CENTRES = FACES.map((_, i) => [
  ((i % COLUMNS) + 0.5) / COLUMNS,
  (Math.floor(i / COLUMNS) + 0.57) / ROWS,
]);

export const MAX_WINDOWS = 7;

export const BALL_GLSL = /* glsl */ `
uniform mat3 uToBall;
uniform int uWindows;
uniform mat3 uToWin[${MAX_WINDOWS}];
uniform mat3 uDieRot[${MAX_WINDOWS}];
uniform vec3 uDiePos[${MAX_WINDOWS}];
// x: viewer's distance from the centre along the window's axis, y and z: the prompt's cos and
// sin of its angle, w: the prompt's strength.
uniform vec4 uLook[${MAX_WINDOWS}];
uniform vec3 uLight[${MAX_WINDOWS}];
uniform vec2 uSlosh[${MAX_WINDOWS}];
uniform vec4 uBubble[${MAX_WINDOWS * BUBBLES}];
uniform sampler2D uAtlas;
uniform sampler2D uPrompt;
uniform vec3 uBody;
uniform vec3 uLiquid;
uniform vec3 uDie;
uniform vec3 uInk;
uniform float uCentreY;
uniform float uRadius;
// How far below the centre people's eyes are, and how far off the furthest stand, ball radii.
uniform vec2 uViewer;
uniform float uHidden;
// How far the specks have drifted, at each of their two depths.
uniform vec4 uDrift;
uniform float uExposure;
// Where the mould seam runs: 0 round the ball a quarter turn from the window, 1 round the
// equator, 2 in a wave between six windows (its middle latitude and its height in uSeamWave).
uniform float uSeamAxis;
uniform vec2 uSeamWave;
#ifdef ANSWERBALL_WALL
// The key light's direction, and the backdrop's floor and back wall as the plastic mirrors them.
uniform vec3 uKeyDir;
uniform vec3 uFloorSeen;
uniform vec3 uBackSeen;
#endif

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float WIN_R = ${f(WINDOW_RADIUS)};
const float SIN_WIN = ${f(Math.sin(WINDOW_RADIUS))};
const float RIM_W = ${f(0.05)};
const float GAP_W = ${f(0.006)};
const float SEAM_W = ${f(0.004)};
const float DIE_S = ${f(DIE_SCALE)};
const float CONTACT = ${f(CONTACT_Z)};
const float R_IN = ${f(INRADIUS)};
const float FACE_R = ${f(FACE_RADIUS)};
const float FACE_SIZE = ${f(FACE_SIZE)};
// Light lost per ball radius of liquid, and how much softer the die looks for each radius deep.
const float FOG = 24.0;
const float FOG_FAR = 2.5;
const float BLUR = 9.0;
const float F0 = 0.045;

const vec3 FN[20] = vec3[20](${FACES.map((x) => v3(x.normal)).join(", ")});
const vec3 FU[20] = vec3[20](${FACES.map((x) => v3(x.up)).join(", ")});
const vec3 FR[20] = vec3[20](${FACES.map((x) => v3(x.right)).join(", ")});
const vec2 CELL[20] = vec2[20](${CENTRES.map(v2).join(", ")});
const vec2 CELL_R = vec2(${f(0.55 / COLUMNS)}, ${f(0.55 / ROWS)});

const vec3 FLOOR = vec3(0.016, 0.015, 0.014);
const vec3 WALL = vec3(0.045, 0.045, 0.05);
const vec3 CEILING = vec3(0.08, 0.08, 0.085);
const vec3 OPENING = vec3(0.3, 0.32, 0.36);
const vec3 LAMP = vec3(13.0, 12.2, 11.0);

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float wrapAngle(float a) {
  return atan(sin(a), cos(a));
}

// A disc of light 'size' radians round seen 'dist' radians from its centre, its edge softened.
float disc(float dist, float size, float soft) {
  return 1.0 - smoothstep(size - soft, size + soft, dist);
}

// Reflectance of a smooth surface at angle cosine c, Schlick's approximation; clamped, since
// float error can take c a hair past 1 where the viewer stands right along the normal.
float schlick(float f0, float c) {
  float m = clamp(1.0 - c, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

#ifdef ANSWERBALL_WALL
const vec3 SOFTBOX = vec3(12.0, 11.6, 11.0);
const vec3 STRIP = vec3(2.6, 2.8, 3.2);
const vec3 SPOT = vec3(7.0, 6.7, 6.2);
const vec3 DARK = vec3(0.004, 0.0045, 0.006);
const vec3 STRIP_DIR = vec3(0.97, 0.12, -0.21);
const vec3 SPOT_DIR = vec3(0.0, 0.993, 0.12);

// The studio as a mirror sees it: the backdrop's floor below and its sweep behind, and in front
// the dark room where people stand, with the lights.
vec3 studio(vec3 r, float soft) {
  float e = asin(clamp(r.y, -1.0, 1.0));
  vec3 floor_ = uFloorSeen * mix(0.2, 1.0, smoothstep(-1.3, -0.3, e));
  vec3 back = uBackSeen * (1.0 - 0.75 * smoothstep(0.2, 1.0, e));
  vec3 c = mix(back, DARK, smoothstep(-0.25, 0.35, r.z) * smoothstep(-0.3, 0.05, e));
  c = mix(c, floor_, 1.0 - smoothstep(-0.12 - soft, 0.02 + soft, e));
  // The softbox: a rounded oblong, brightest in its middle, its edge a little soft.
  vec3 kx = normalize(cross(vec3(0.0, 1.0, 0.0), uKeyDir));
  vec3 ky = cross(uKeyDir, kx);
  vec2 kp = vec2(dot(r, kx), dot(r, ky));
  vec2 kq = abs(kp) - vec2(0.2, 0.15);
  float kd = length(max(kq, 0.0)) + min(max(kq.x, kq.y), 0.0) - 0.08;
  float box = (1.0 - smoothstep(-0.03 - soft, 0.03 + soft, kd)) * step(0.0, dot(r, uKeyDir));
  c += SOFTBOX * box * (1.0 - 0.4 * smoothstep(-0.2, 0.0, kd));
  // A tall strip light on the other side.
  vec3 sx = normalize(cross(vec3(0.0, 1.0, 0.0), STRIP_DIR));
  vec2 sp = vec2(dot(r, sx), dot(r, vec3(0.0, 1.0, 0.0)) - STRIP_DIR.y);
  float strip = disc(abs(sp.x), 0.035, 0.012 + soft) * disc(abs(sp.y), 0.42, 0.08 + soft);
  c += STRIP * strip * step(0.0, dot(r, STRIP_DIR));
  // The lamp above that lights the floor round the ball.
  float l = acos(clamp(dot(r, SPOT_DIR), -1.0, 1.0));
  c += SPOT * disc(l, 0.05, 0.012 + soft);
  return c;
}

vec3 studioSoft(vec3 r) {
  float e = asin(clamp(r.y, -1.0, 1.0));
  vec3 c = mix(uFloorSeen * 0.6, uBackSeen * 0.7, smoothstep(-0.6, 0.1, e));
  c = mix(c, DARK * 2.0, smoothstep(-0.2, 0.6, r.z) * smoothstep(-0.4, 0.2, e));
  return c + SOFTBOX * 0.02 * pow(max(0.0, dot(r, uKeyDir)), 4.0);
}
#endif

// The room as a mirror sees it, in venue direction r. 'soft' blurs edges by about that many
// radians, so small highlights don't shimmer.
vec3 room(vec3 r, float soft) {
#ifdef ANSWERBALL_WALL
  return studio(r, soft);
#else
  float e = asin(clamp(r.y, -1.0, 1.0));
  float bz = atan(r.x, r.z);
  vec3 c = mix(FLOOR, WALL, smoothstep(-0.3 - soft, -0.12 + soft, e));
  c = mix(c, CEILING, smoothstep(0.42 - soft, 0.55 + soft, e));
  // Four wide openings in the walls, lit beyond.
  float ob = bz * 4.0 / TAU + 0.5;
  float od = (ob - floor(ob + 0.5)) * TAU / 4.0;
  float open_ = disc(abs(od), 0.2, 0.02 + soft) * smoothstep(-0.12 - soft, -0.1 + soft, e)
    * (1.0 - smoothstep(0.2 - soft, 0.23 + soft, e));
  c = mix(c, OPENING, open_);
  // A ring of eight downlights round the ceiling.
  float lb = bz * 8.0 / TAU;
  float ld = (lb - floor(lb + 0.5)) * TAU / 8.0;
  float lamp = disc(length(vec2(ld * cos(e), e - 0.7)), 0.03, 0.006 + soft);
  c += LAMP * lamp;
  return c;
#endif
}

// The same room, blurred, for the plastic's broad haze.
vec3 roomSoft(vec3 r) {
#ifdef ANSWERBALL_WALL
  return studioSoft(r);
#else
  float e = asin(clamp(r.y, -1.0, 1.0));
  vec3 c = mix(FLOOR, WALL * 1.3, smoothstep(-0.6, 0.1, e));
  return mix(c, CEILING * 2.5, smoothstep(0.2, 1.0, e));
#endif
}

// Where the person who sees venue direction n most squarely stands, ball radii from the centre:
// out along n until it meets eye level, or as far off as people stand if that is further. The
// bottom cap is seen by the people standing under the ball, so there it is someone underneath.
vec3 viewerFor(vec3 n) {
  float eye = -uViewer.x;
  vec2 h = n.xz;
  float hl = length(h);
  vec3 along;
  if (n.y < -1e-4 && (eye / n.y) * hl <= uViewer.y) {
    along = n * max(eye / n.y, 1.05);
  } else {
    vec2 u = hl > 1e-5 ? h / hl : vec2(0.0, 1.0);
    along = vec3(u.x * uViewer.y, eye, u.y * uViewer.y);
  }
  return mix(vec3(0.0, eye, 0.0), along, smoothstep(-0.97, -0.8, n.y));
}

// The moulded plastic's slight orange peel: a gentle ripple of its normal, fixed to the ball.
vec3 peel(vec3 b) {
  vec3 p = b * 90.0;
  vec3 w = vec3(sin(p.y + 1.7 * sin(p.z * 0.8)), sin(p.z * 1.1 + 1.3 * sin(p.x * 0.7)),
    sin(p.x * 0.9 + 1.9 * sin(p.y * 1.2)));
  vec3 q = b * 230.0;
  w += 0.5 * vec3(sin(q.z + 1.6 * sin(q.y * 0.6)), sin(q.x + 1.4 * sin(q.z * 0.9)),
    sin(q.y + 1.8 * sin(q.x * 0.5)));
  return w - b * dot(w, b);
}

// Ray against the die, in its own frame (circumradius 1). Returns the entry distance, the face
// entered, and how far inside the ray passes ('margin' < 0 misses by that much).
float castDie(vec3 o, vec3 d, out int face, out float margin) {
  float tIn = -1e9;
  float tOut = 1e9;
  face = 0;
  for (int i = 0; i < 20; i++) {
    float dn = dot(FN[i], d);
    float gap = R_IN - dot(FN[i], o);
    if (abs(dn) < 1e-7) {
      if (gap < 0.0) tIn = 1e9;
      continue;
    }
    float t = gap / dn;
    if (dn < 0.0) {
      if (t > tIn) {
        tIn = t;
        face = i;
      }
    } else {
      tOut = min(tOut, t);
    }
  }
  margin = tOut - tIn;
  return tIn;
}

// The window's inside at window-frame point w on the glass, for window k.
vec3 inside(int k, vec3 w, float aa) {
#ifdef ANSWERBALL_WALL
  vec3 E = uToWin[k] * (uToBall * uWallEye);
#else
  vec3 E = vec3(0.0, 0.0, uLook[k].x);
#endif
  vec3 rd = normalize(w - E);
  float tGlass = length(w - E);
  float rho = length(w.xy - uSlosh[k]) / SIN_WIN;
  // The liquid, darker towards the edge where the eye looks through more of it.
  vec3 liquid = uLiquid * (0.5 + 0.5 * (1.0 - rho * rho)) * (1.0 - 0.45 * smoothstep(0.6, 1.0, rho));
  vec3 col = liquid;

  // The die.
  mat3 toDie = uDieRot[k];
  vec3 o = toDie * ((E - uDiePos[k]) / DIE_S);
  vec3 d = toDie * rd;
  int face;
  float margin;
  float tDie = castDie(o, d, face, margin);
  float tHit = 1e9;
  if (margin > -0.05 && tDie > 0.0 && tDie < 1e8) {
    vec3 pd = o + d * tDie;
    tHit = tDie * DIE_S;
    vec3 pw = E + rd * tHit;
    float deep = max(0.0, CONTACT - pw.z);
    // Light comes in through the window and goes back out along the ray: through this much
    // liquid. Most of it is lost quickly, a little carries a long way.
    float path = deep + max(0.0, tHit - (CONTACT - E.z) / rd.z);
    float fog = 0.92 * exp(-FOG * path) + 0.08 * exp(-FOG_FAR * path);
    vec3 fn = FN[face] * toDie;
    vec3 fu = FU[face] * toDie;
    vec3 fr = FR[face] * toDie;
    vec2 fc = vec2(dot(pd, FR[face]), dot(pd, FU[face])) / FACE_R;
    // How big a feed pixel is on the face, in face units, and so how sharp the printing is.
    float slant = max(0.2, -dot(fn, rd));
    float foot = aa * (tHit / tGlass) / (FACE_SIZE * slant);
    float texels = foot * CELL_R.x * float(textureSize(uAtlas, 0).x);
    float lod = log2(max(texels, 1e-3)) + BLUR * deep;
    vec2 uv = CELL[face] + vec2(fc.x, -fc.y) * CELL_R;
    vec4 tex = textureLod(uAtlas, uv, lod);
    float du = CELL_R.x * 0.03;
    float dv = CELL_R.y * 0.03;
    float hx = textureLod(uAtlas, uv + vec2(du, 0.0), lod).g - textureLod(uAtlas, uv - vec2(du, 0.0), lod).g;
    float hy = textureLod(uAtlas, uv - vec2(0.0, dv), lod).g - textureLod(uAtlas, uv + vec2(0.0, dv), lod).g;
    // Distance to the triangle's nearest edge, face units (0.5 at the centre), and which way
    // that edge lies.
    float e0 = 0.5 + fc.y;
    float e1 = 0.5 - dot(fc, vec2(0.8660254, 0.5));
    float e2 = 0.5 - dot(fc, vec2(-0.8660254, 0.5));
    float edge = min(e0, min(e1, e2));
    vec2 outward = e0 <= min(e1, e2) ? vec2(0.0, -1.0) : (e1 <= e2 ? vec2(0.8660254, 0.5) : vec2(-0.8660254, 0.5));
    float soft = max(1.5 * foot, 0.2 * deep);
    // The die's edges are rounded: the normal leans out across the last few hundredths.
    float round_ = 1.0 - smoothstep(0.0, 0.05, edge);
    vec3 n = normalize(fn + (fr * outward.x + fu * outward.y) * round_ * round_ * 0.9
      - (fr * hx + fu * hy) * 2.2);
    float lit = max(0.0, dot(n, uLight[k]));
    vec3 face_ = uDie * (1.0 - 0.5 * tex.b * (1.0 - tex.r));
    vec3 albedo = mix(face_, uInk, smoothstep(0.25, 0.75, tex.r));
    vec3 dieCol = albedo * (0.18 + 1.0 * lit);
    // A satin glint where an edge turns towards the light.
    dieCol += vec3(0.5, 0.55, 0.7) * round_ * round_ * pow(max(0.0, dot(reflect(rd, n), uLight[k])), 12.0) * 0.25;
    float cover = smoothstep(-soft * FACE_SIZE, soft * FACE_SIZE, margin * DIE_S);
    col = mix(col, dieCol, fog * cover);
  }

  // Specks drifting in the liquid at two depths.
  for (int j = 0; j < 2; j++) {
    float dj = j == 0 ? 0.09 : 0.24;
    float zp = CONTACT - dj;
    float t = (zp - E.z) / rd.z;
    if (t <= 0.0 || t >= tHit) continue;
    vec2 p = (E + rd * t).xy;
    vec2 drift = (j == 0 ? uDrift.xy : uDrift.zw) + uSlosh[k] * (1.5 + float(j));
    float cell = j == 0 ? 0.016 : 0.022;
    vec2 g = (p + drift) / cell;
    vec2 ci = floor(g);
    float hsh = hash12(ci + float(j) * 17.0);
    if (hsh < 0.13) {
      vec2 at = ci + 0.25 + 0.5 * vec2(hash12(ci + 3.1), hash12(ci + 7.7));
      float r = length(g - at) * cell;
      float size = max(0.0018 + 0.0016 * hash12(ci + 1.3), 0.6 * aa);
      float s = exp(-r * r / (2.0 * size * size)) * (0.0018 / size);
      col += vec3(0.5, 0.6, 0.75) * s * 0.035 * exp(-FOG_FAR * 2.0 * dj);
    }
  }

  // The prompt, deep in the liquid.
  if (uLook[k].w > 0.001) {
    float dp = 0.2;
    float t = (CONTACT - dp - E.z) / rd.z;
    if (t > 0.0 && t < tHit) {
      vec2 p = (E + rd * t).xy;
      vec2 cs = uLook[k].yz;
      vec2 qr = vec2(cs.x * p.x + cs.y * p.y, -cs.y * p.x + cs.x * p.y);
      float half_ = 0.85 * SIN_WIN;
      vec2 uv = vec2(qr.x / (2.0 * half_) + 0.5, 0.5 - qr.y / half_);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        float lodP = log2(max(1e-3, aa / (2.0 * half_) * float(textureSize(uPrompt, 0).x))) + 1.4;
        float txt = textureLod(uPrompt, uv, lodP).r;
        col += vec3(0.12, 0.18, 0.38) * txt * uLook[k].w;
      }
    }
  }

  // Air bubbles against the glass.
  vec2 qb = w.xy / SIN_WIN;
  vec2 lw = normalize(uLight[k].xy + vec2(0.0, 1e-4));
  for (int j = 0; j < ${BUBBLES}; j++) {
    vec4 bb = uBubble[k * ${BUBBLES} + j];
    if (bb.w < 0.01) continue;
    float dist = length(qb - bb.xy) / bb.z;
    if (dist > 1.25) continue;
    float px = aa / (SIN_WIN * bb.z);
    float disc_ = 1.0 - smoothstep(1.0 - px, 1.0 + px, dist);
    float ring = smoothstep(0.62, 0.97, dist) * disc_;
    vec2 off = (qb - bb.xy) / bb.z - lw * 0.45;
    float glint = exp(-dot(off, off) / 0.02);
    vec3 bub = col * 0.9 + vec3(0.35, 0.42, 0.55) * ring * 0.18 + vec3(0.9, 0.95, 1.0) * glint * 0.3;
    col = mix(col, bub, disc_ * bb.w);
  }
  return col;
}

vec4 surface(vec3 dir) {
  vec3 b = uToBall * dir;
  float aa = max(length(dFdx(dir)), length(dFdy(dir))) + 1e-5;

  // The nearest window, in its own frame.
  int k = 0;
  vec3 w = uToWin[0] * b;
  for (int i = 1; i < ${MAX_WINDOWS}; i++) {
    if (i >= uWindows) break;
    vec3 wi = uToWin[i] * b;
    if (wi.z > w.z) {
      w = wi;
      k = i;
    }
  }
  float rho = length(w.xy);
  float th = atan(rho, w.z);

  // The plastic: orange peel, the mould seam, the raised rim round the window.
#ifdef ANSWERBALL_WALL
  // Large on a wall, the ripple needs less depth to show.
  vec3 nb = normalize(b + 0.0018 * peel(b));
#else
  vec3 nb = normalize(b + 0.0035 * peel(b));
#endif
  float sd = b.z;
  vec3 seamN = vec3(0.0, 0.0, 1.0);
  if (uSeamAxis > 1.5) {
    // Distance from the wave: its latitude offset over the offset's gradient on the ball.
    float hz = max(b.x * b.x + b.z * b.z, 1e-6);
    float lon = atan(b.x, b.z);
    float f = asin(clamp(b.y, -1.0, 1.0)) - uSeamWave.x + uSeamWave.y * cos(3.0 * lon);
    vec3 g = (vec3(0.0, 1.0, 0.0) - b * b.y) / sqrt(hz)
      - 3.0 * uSeamWave.y * sin(3.0 * lon) * vec3(b.z, 0.0, -b.x) / hz;
    float gl = max(length(g), 1e-6);
    sd = f / gl;
    seamN = g / gl;
  } else if (uSeamAxis > 0.5) {
    sd = b.y;
    seamN = vec3(0.0, 1.0, 0.0);
  }
  float seam = 1.0 - smoothstep(SEAM_W, SEAM_W + aa, abs(sd));
  nb = normalize(nb - seamN * sign(sd) * seam * 0.35);
  vec3 body = uBody * (1.0 - 0.35 * seam);
  float x = (th - WIN_R) / RIM_W;
  float gloss = 1.0;
  if (x > -0.5 && x < 1.5) {
    vec3 tr = rho > 1e-6 ? vec3(w.xy / rho * w.z, -rho) : vec3(1.0, 0.0, 0.0);
    float on = smoothstep(-aa / RIM_W, aa / RIM_W, x) * (1.0 - smoothstep(1.0 - aa / RIM_W, 1.0 + aa / RIM_W, x));
    vec3 nw = normalize(w + (-cos(PI * clamp(x, 0.0, 1.0)) * 0.9 * on) * tr);
    nb = mix(nb, nw * uToWin[k], on);
    gloss = mix(1.0, 1.6, on);
    body *= mix(1.0, 1.15, on);
  }

  // Light it in the venue.
  vec3 n = normalize(nb * uToBall);
  vec3 centre = vec3(0.0, uCentreY, 0.0);
  vec3 p = centre + uRadius * dir;
#ifdef ANSWERBALL_WALL
  vec3 eye = centre + uRadius * uWallEye;
#else
  vec3 eye = centre + uRadius * viewerFor(dir);
#endif
  vec3 v = normalize(eye - p);
  float nv = max(dot(n, v), 0.02);
  vec3 r = reflect(-v, n);
  float fres = schlick(F0, nv);
  float soft = clamp(aa * 3.0, 0.002, 0.03);
#ifdef ANSWERBALL_WALL
  float key = 0.25 + 1.3 * max(0.0, dot(n, uKeyDir)) + 0.3 * max(0.0, n.y);
  float seen = 1.0;
#else
  float key = 0.42 + 0.58 * pow(clamp(0.5 + 0.5 * n.y, 0.0, 1.0), 1.5);
  // Where even that viewer only glances at the surface (the cap above people), the mirror fades.
  float seen = smoothstep(0.18, 0.38, dot(normalize(dir), v));
#endif
  vec3 col = body * key + seen * fres * gloss * (room(r, soft) + 0.6 * roomSoft(r));

  // The window: a thin dark gap inside the rim, then the glass.
  float inWin = 1.0 - smoothstep(WIN_R - aa, WIN_R + aa, th);
  if (inWin > 0.0) {
    vec3 inner = inside(k, w, aa);
    vec3 ng = normalize(dir);
    vec3 vg = normalize(eye - p);
    vec3 rg = reflect(-vg, ng);
    float fg = schlick(0.05, dot(ng, vg));
    vec3 glass = inner * (1.0 - fg) + seen * fg * (room(rg, soft * 0.5) + 0.3 * roomSoft(rg));
    float gap = smoothstep(WIN_R - GAP_W - aa, WIN_R - GAP_W + aa, th);
    glass = mix(glass, vec3(0.002), gap);
    col = mix(col, glass, inWin);
  }

  // Nobody sees the top of the ball well, so it needn't be as bright.
  col *= uExposure * mix(1.0, 0.8, smoothstep(uHidden, uHidden + 0.25, dir.y));
  return vec4(col, 1.0);
}
`;
