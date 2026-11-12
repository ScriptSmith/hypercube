/**
 * The ball as an hourglass, painted for every direction from its centre: glass all round, a
 * turned brass collar round the middle, sand against the glass above the collar up to its level
 * and below it from the bottom pole up to its level, sand coming down the glass between them in
 * one of a few ways, and three rings of lettering. It is one picture, the same from every side.
 */
import { DEG } from "../../core/sphere";
import { type FallId, LAST_S, SPIRAL_TWIST, TIME_WRAP_S } from "./fall";
import { COLLAR, COLLAR_LAT } from "./levels";
import { INLAY_HALF } from "./rings";
import { STREAMS } from "./streams";

const f = (n: number): string => {
  const s = String(n);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};

/** Width of a full stream, arc on a ball of radius 1. */
export const STREAM_WIDTH = 0.009;
/** Height of a full mound where a stream lands, as a change in level. */
export const MOUND_HEIGHT = 0.03;
/** Lettering gives way within this of a sand's edge, so the edge always shows. */
const YIELD = 0.024;
/** How fast the veil slides down the glass, arc a second. */
export const VEIL_SPEED = 0.32;

/**
 * The length a pattern sliding `perSecond` cells a second must repeat after, in cells, to come
 * round exactly when the shader's clock wraps.
 */
const loopOf = (perSecond: number): string => f(Math.round(perSecond * TIME_WRAP_S));

/**
 * The five streams. `twist` winds them round the ball as they run down; at 0 this is the plain
 * streams' code, untouched.
 */
const streamsFall = (twist: number): string => {
  const side =
    twist === 0
      ? "hgWrap(lon - s.x - sway * smoothstep(0.0, 0.3, arc)) * cosLat"
      : `hgWrap(lon - s.x - ${f(twist)} * arc - sway * smoothstep(0.0, 0.3, arc)) * cosLat`;
  // Measured across a slanting stream, not round the ball, so it keeps its width.
  const across =
    twist === 0 ? "abs(side)" : `abs(side) / sqrt(1.0 + ${f(twist * twist)} * cosLat * cosLat)`;
  return /* glsl */ `
      float body = 0.0;
      float which = 0.0;
      float across = 0.0;
      for (int i = 0; i < ${STREAMS}; i++) {
        vec4 s = uStream[i];
        if (s.z <= s.w) continue;
        float fi = float(i);
        float sway = 0.03 * sin(arc * 5.0 + fi * 2.4) + 0.01 * sin(arc * 13.0 - fi * 1.7);
        float side = ${side};
        float d = ${across};
        float w = ${f(STREAM_WIDTH)} * (0.3 + 0.7 * s.y);
        w *= 0.8 + 0.4 * hgNoise(vec3(arc * 30.0 - uTime * 2.5, fi * 7.0, 0.5));
        float b = smoothstep(w, w * 0.4, d);
        b *= smoothstep(s.w - 0.02, s.w + 0.02, arc) * smoothstep(s.z + 0.01, s.z - 0.03, arc);
        if (b > body) {
          body = b;
          which = fi;
          across = side;
        }
      }
      if (body > 0.0) {
        float streak = hgNoise(vec3(across * 420.0, arc * 46.0 - uTime * 7.0, which));
        float spark = step(0.9, hgNoise(vec3(across * 700.0, arc * 90.0 - uTime * 10.0, 9.0 + which)));
        vec3 falling = uSand * (0.85 + 0.55 * streak) * lit + vec3(1.0, 0.95, 0.82) * spark * 0.35;
        glass = mix(glass, falling, body);
      }
`;
};

/** Grains sliding down all round, in two sets of lanes that keep different time. */
const TRAILS_FALL = /* glsl */ `
      vec2 near = hgTrails(arc, lon, cosLat, 46.0, 1.2, 0.36, 1);
      vec2 far = hgTrails(arc, lon, cosLat, 67.0, 1.8, 0.28, 2);
      float body = max(near.x, 0.85 * far.x);
      if (body > 0.0) {
        float head = max(near.y, far.y);
        vec3 falling = uSand * (0.8 + 0.5 * head) * lit + vec3(1.0, 0.95, 0.82) * head * 0.25;
        glass = mix(glass, falling, body);
      }
`;

/** A rain of single grains in three sets of lanes, finer and finer. */
const GRAINS_FALL = /* glsl */ `
      float rain = hgGrains(arc, lon, cosLat, 61.0, 0.0062, 1);
      rain += hgGrains(arc, lon, cosLat, 97.0, 0.0048, 2);
      rain += hgGrains(arc, lon, cosLat, 151.0, 0.0037, 3);
      if (rain > 0.0) {
        vec3 falling = uSand * 1.1 * lit + vec3(1.0, 0.95, 0.82) * 0.3 * max(rain - 0.7, 0.0);
        glass = mix(glass, falling, min(rain, 1.0));
      }
`;

/** A thin streaked sheet all round, sliding down and thinning as it goes. */
const VEIL_FALL = /* glsl */ `
      float fed = hgFed(arc / VEIL_SPEED);
      if (fed > 0.0) {
        float slide = uTime * VEIL_SPEED;
        float broad = hgNoiseLoop(vec3(dir.xz * 64.0, (arc - slide) * 2.5), ${loopOf(2.5 * VEIL_SPEED)});
        float fine = hgNoiseLoop(vec3(dir.xz * 210.0, (arc - slide) * 7.0), ${loopOf(7 * VEIL_SPEED)});
        float thin = mix(1.0, 0.12, smoothstep(0.0, 1.0, arc));
        float cover = fed * thin * (0.3 + 0.7 * broad) * (0.55 + 0.45 * fine);
        float grit = hgNoiseLoop(vec3(dir.xz * 420.0, (arc - slide) * 100.0), ${loopOf(100 * VEIL_SPEED)});
        vec3 falling = uSand * (0.8 + 0.35 * fine) * lit + vec3(1.0, 0.95, 0.82) * step(0.93, grit) * 0.3;
        glass = mix(glass, falling, 0.5 * cover * smoothstep(0.0, 0.03, arc));
      }
`;

const FALL_GLSL: Record<FallId, string> = {
  streams: streamsFall(0),
  spiral: streamsFall(SPIRAL_TWIST),
  trails: TRAILS_FALL,
  grains: GRAINS_FALL,
  veil: VEIL_FALL,
};

/** The heap's edge under the five streams: a mound where each lands. */
const MOUND_EDGE = "line += hgMounds(lon, level);";
/** The heap's edge under sand that falls all round: level, with fine slow ripples. */
const RIPPLE_EDGE = `line += 0.007 * (hgNoiseLoop(vec3(dir.xz * 16.0, uTime * 0.2), ${loopOf(0.2)}) - 0.5);`;

/** The shader for one way of falling. */
export const hourglassGlsl = (fall: FallId): string => {
  const streams = fall === "streams" || fall === "spiral";
  return HOURGLASS_GLSL.replace("FALL_STYLE", FALL_GLSL[fall]).replace(
    "HEAP_EDGE",
    streams ? MOUND_EDGE : RIPPLE_EDGE,
  );
};

const HOURGLASS_GLSL = /* glsl */ `
uniform mat3 uPose;
uniform vec2 uLevel;
uniform vec3 uSand;
uniform vec3 uLight;
uniform vec2 uLamp;
uniform float uTime;
uniform vec4 uStream[${STREAMS}];
uniform vec3 uMound[${STREAMS}];
uniform float uMoundMean;
uniform vec3 uFall;
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform vec4 uRing[3];
uniform vec3 uInk[3];

const float COLLAR = ${f(COLLAR)};
const float COLLAR_LAT = ${f(COLLAR_LAT)};
const float INLAY = ${f(Math.sin(INLAY_HALF + 0.6 * DEG) / COLLAR)};
const float VEIL_SPEED = ${f(VEIL_SPEED)};
const float GRAIN_CELL = 0.05;

uint hgMix(uint h) {
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}
float hgCell(ivec3 c) {
  uvec3 u = uvec3(c + 65536);
  return float(hgMix(u.x * 0x9e3779b1u ^ u.y * 0x85ebca77u ^ u.z * 0xc2b2ae3du)) * (1.0 / 4294967296.0);
}
float hgNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 t = p - i;
  t = t * t * (3.0 - 2.0 * t);
  ivec3 c = ivec3(i);
  float x00 = mix(hgCell(c), hgCell(c + ivec3(1, 0, 0)), t.x);
  float x10 = mix(hgCell(c + ivec3(0, 1, 0)), hgCell(c + ivec3(1, 1, 0)), t.x);
  float x01 = mix(hgCell(c + ivec3(0, 0, 1)), hgCell(c + ivec3(1, 0, 1)), t.x);
  float x11 = mix(hgCell(c + ivec3(0, 1, 1)), hgCell(c + ivec3(1, 1, 1)), t.x);
  return mix(mix(x00, x10, t.y), mix(x01, x11, t.y), t.z);
}
float hgWrap(float a) {
  return mod(a + SPHERE_PI, 2.0 * SPHERE_PI) - SPHERE_PI;
}
float hgMerc(float lat) {
  return log(tan(0.25 * SPHERE_PI + 0.5 * clamp(lat, -1.5, 1.5)));
}

// Sand pressed against the glass: grains, faint layers and the odd glint.
vec3 hgSand(vec3 dir, float lit) {
  float coarse = hgNoise(dir * 9.0);
  float mid = hgNoise(dir * 60.0);
  float fine = hgNoise(dir * 330.0);
  float layers = hgNoise(vec3(dir.y * 55.0 + 1.3 * hgNoise(dir * 4.0), 0.5, 0.5));
  float tone = 0.78 + 0.1 * coarse + 0.1 * mid + 0.16 * (fine - 0.5) + 0.12 * (layers - 0.5);
  float g = hgCell(ivec3(floor(dir * 420.0)));
  float twinkle = step(0.988, g) * pow(0.5 + 0.5 * sin(uTime * (0.8 + 2.4 * fract(g * 61.0)) + g * 900.0), 8.0);
  return (uSand * tone + vec3(1.0, 0.94, 0.8) * twinkle * 0.5) * lit;
}

// How far the heap's edge stands above its level at a longitude: a mound under each stream.
float hgMounds(float lon, float level) {
  float c = sqrt(max(1.0 - level * level, 0.0));
  float sum = 0.0;
  for (int i = 0; i < ${STREAMS}; i++) {
    vec3 m = uMound[i];
    float d = hgWrap(lon - m.x) * c / m.z;
    sum += m.y * exp(-d * d);
  }
  return sum - uMoundMean;
}

// Noise that repeats after loop cells along z, so a pattern can slide past for ever while the
// shader's clock wraps.
float hgNoiseLoop(vec3 p, float loop) {
  vec3 i = floor(p);
  vec3 t = p - i;
  t = t * t * (3.0 - 2.0 * t);
  ivec3 c = ivec3(i.xy, mod(i.z, loop));
  ivec3 d = ivec3(i.xy, mod(i.z + 1.0, loop));
  float x00 = mix(hgCell(c), hgCell(c + ivec3(1, 0, 0)), t.x);
  float x10 = mix(hgCell(c + ivec3(0, 1, 0)), hgCell(c + ivec3(1, 1, 0)), t.x);
  float x01 = mix(hgCell(d), hgCell(d + ivec3(1, 0, 0)), t.x);
  float x11 = mix(hgCell(d + ivec3(0, 1, 0)), hgCell(d + ivec3(1, 1, 0)), t.x);
  return mix(mix(x00, x10, t.y), mix(x01, x11, t.y), t.z);
}

// How strongly sand that left the collar ago seconds before was being fed: nothing from before
// the sand began to fall, all of it through the run, less and less over the last minute.
// uFall is the seconds left, the seconds since it began, and whether any falls at all.
float hgFed(float ago) {
  return uFall.z < 0.5 || ago > uFall.y ? 0.0 : clamp((uFall.x + ago) / ${f(LAST_S)}, 0.0, 1.0);
}

// Grains sliding down lanes round the ball, a trail fading behind each. A lane lets one go
// every period seconds at most, to its own beat. x is how much sand shows, y how much of that
// is a grain's own bright head.
vec2 hgTrails(float arc, float lon, float cosLat, float lanes, float period, float speed, int seed) {
  float x = (lon + SPHERE_PI) / (2.0 * SPHERE_PI) * lanes;
  float lane = floor(x);
  float h0 = hgCell(ivec3(int(lane), seed, 11));
  float h1 = hgCell(ivec3(int(lane), seed, 12));
  float v = speed * (0.8 + 0.4 * h1);
  float ago = arc / v;
  float u = (uTime - ago) / period - h0;
  float k = floor(u);
  float behind = (u - k) * period;
  float g = hgCell(ivec3(int(lane), int(mod(k, ${f(TIME_WRAP_S)} / period)), seed + 20));
  if (g > 0.62 * hgFed(ago + behind)) return vec2(0.0);
  float back = behind * v;
  float mid = lane + 0.5 + 0.5 * (h1 - 0.5) + 0.1 * sin(arc * 9.0 + h0 * 40.0);
  float d = abs(x - mid) * 2.0 * SPHERE_PI * cosLat / lanes;
  float r = 0.009;
  float head = smoothstep(r, 0.45 * r, length(vec2(d, back - r)));
  float trail = smoothstep(0.55 * r, 0.15 * r, d) * exp(-back / 0.12);
  return vec2(max(head, 0.85 * trail), head);
}

// Single grains falling in lanes round the ball, each lane at its own speed: one grain to a
// cell of the lane at most, fewer further down, each glinting as it tumbles. Where the lanes
// crowd together towards the pole they fade out.
float hgGrains(float arc, float lon, float cosLat, float lanes, float size, int seed) {
  float x = (lon + SPHERE_PI) / (2.0 * SPHERE_PI) * lanes;
  float lane = floor(x);
  float steps = 7.0 + floor(5.0 * hgCell(ivec3(int(lane), seed, 31)));
  float y = arc / GRAIN_CELL - steps * uTime;
  float row = floor(y);
  ivec3 id = ivec3(int(lane), int(mod(row, steps * ${f(TIME_WRAP_S)})), seed + 40);
  float g = hgCell(id);
  float thin = mix(0.8, 0.2, smoothstep(0.0, 0.9, arc));
  float live = thin * hgFed(arc / (steps * GRAIN_CELL)) - g;
  if (live <= 0.0) return 0.0;
  vec2 at = vec2(hgCell(id + ivec3(0, 0, 100)), hgCell(id + ivec3(0, 0, 200)));
  float width = 2.0 * SPHERE_PI * cosLat / lanes;
  vec2 p = vec2((x - lane - 0.2 - 0.6 * at.x) * width, (y - row - 0.2 - 0.6 * at.y) * GRAIN_CELL);
  float r = size * (0.7 + 0.6 * at.y);
  float tumble = 0.55 + 0.45 * sin(uTime * (5.0 + 9.0 * at.x) + g * 50.0);
  return smoothstep(r, 0.4 * r, length(p)) * tumble * smoothstep(0.0, 0.05, live) *
    smoothstep(2.0 * size, 4.0 * size, width);
}

// One ring of lettering: x is its latitude, y half its height, z its period and w its crawl.
vec4 hgRing(sampler2D tex, vec4 ring, vec3 ink, float lat, float lon) {
  if (ink.x <= 0.0) return vec4(0.0);
  float c0 = cos(ring.x);
  float y = (hgMerc(lat) - hgMerc(ring.x)) * c0;
  if (abs(y) >= ring.y) return vec4(0.0);
  float x = (lon + SPHERE_PI) * c0 + ring.w;
  // The canvases have no smaller copies, and a lookup without slopes is safe inside a branch.
  vec4 t = textureLod(tex, vec2(x / ring.z, 0.5 + 0.5 * y / ring.y), 0.0);
  // A line longer than its ring appears and leaves at the back of the ball.
  float fade = ink.y > 0.5 ? smoothstep(0.0, 2.5 * ring.y, (SPHERE_PI - abs(lon)) * c0) : 1.0;
  return vec4(t.rgb, t.a * ink.x * fade);
}

// A half-round moulding at c across the collar, w wide either way: x is how far a point leans
// towards the collar's edge, y how much of the moulding is there.
vec2 hgBead(float a, float c, float w) {
  float t = (a - c) / w;
  return abs(t) < 1.0 ? vec2(t, 1.0) : vec2(0.0);
}

vec4 surface(vec3 dir) {
  vec3 local = uPose * dir;
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  float lon = atan(dir.x, dir.z);
  float cosLat = sqrt(max(1.0 - dir.y * dir.y, 1e-6));
  float aa = max(fwidth(dir.y), 1e-4);
  float lit = 0.6 + 0.4 * smoothstep(-0.5, 1.0, dot(dir, uLight));

  // The lamp's reflection in the glass: a tall soft streak, and a fainter one a quarter turn on.
  float dl = hgWrap(lon - uLamp.y) * cosLat;
  float dv = lat - uLamp.x;
  float shine = exp(-dl * dl / 0.006 - dv * dv / 0.09);
  float dl2 = hgWrap(lon - uLamp.y - 1.9) * cosLat;
  shine += 0.35 * exp(-dl2 * dl2 / 0.02 - (dv - 0.1) * (dv - 0.1) / 0.05);

  float edge = abs(local.y) - COLLAR;
  float away = 1.0;
  vec3 col;
  if (edge < 0.0) {
    // The collar: two mouldings at each edge and a dark band between them for the lettering.
    float v = local.y / COLLAR;
    float a = abs(v);
    vec2 bead = hgBead(a, 0.92, 0.08) + hgBead(a, 0.745, 0.085);
    vec3 north = normalize(vec3(0.0, 1.0, 0.0) - local * local.y);
    vec3 n = normalize(local * sqrt(max(1.0 - bead.x * bead.x, 0.0)) + north * bead.x * sign(v));
    vec3 nRoom = n * uPose;
    float diff = max(dot(nRoom, uLight), 0.0);
    float spec = pow(max(dot(nRoom, normalize(uLight + dir)), 0.0), 36.0);
    float brushed = 0.9 + 0.2 * hgNoise(vec3(local.xz * 14.0, local.y * 700.0));
    vec3 brass = vec3(0.56, 0.38, 0.13) * brushed;
    vec3 metal = brass * (0.28 + 0.6 * diff + 0.25 * lit) + vec3(1.0, 0.86, 0.6) * spec * 0.7;
    // Between the mouldings the brass is in shadow; inside them is the band for the lettering.
    vec3 enamel = vec3(0.012, 0.011, 0.012) + vec3(0.02, 0.022, 0.028) * shine;
    col = a < INLAY ? enamel : mix(brass * 0.1, metal, bead.y);
  } else {
    bool above = local.y > 0.0;
    float level = above ? uLevel.x : uLevel.y;
    float line = level + (hgNoise(vec3(dir.xz * 45.0, 3.0)) - 0.5) * 0.008;
    if (!above) {
      HEAP_EDGE
    }
    float depth = line - dir.y;
    float sand = level > -1.5 ? smoothstep(-aa, aa, depth) : 0.0;
    away = level > -1.5 ? smoothstep(0.25 * ${f(YIELD)}, ${f(YIELD)}, abs(depth)) : 1.0;

    // Dark glass, lit a little from inside by the sand just below.
    vec3 glass = vec3(0.006, 0.008, 0.013) * (0.7 + 0.6 * hgNoise(dir * 2.5));
    if (level > -1.5) glass += uSand * 0.09 * exp(min(depth, 0.0) / 0.07) * lit;

    // Sand comes down the glass from the collar to the heap.
    if (!above) {
      float arc = -COLLAR_LAT - asin(clamp(local.y, -1.0, 1.0));
FALL_STYLE
    }

    col = glass;
    if (sand > 0.0) {
      // Deeper sand is packed a little darker; its top catches the light along its edge.
      vec3 grains = hgSand(dir, lit) * (1.0 - 0.14 * smoothstep(0.0, 0.5, depth));
      grains += uSand * 0.3 * exp(-depth * depth / 0.00004) * lit;
      col = mix(glass, grains, sand);
    }
    // The collar shades what lies next to it.
    col *= 1.0 - 0.45 * exp(-edge / 0.02);
    col += vec3(0.75, 0.85, 1.0) * shine * (0.1 - 0.05 * sand);
  }

  vec4 t = hgRing(uTex0, uRing[0], uInk[0], lat, lon);
  col = mix(col, t.rgb, t.a);
  t = hgRing(uTex1, uRing[1], uInk[1], lat, lon);
  col = mix(col, t.rgb, t.a * away);
  t = hgRing(uTex2, uRing[2], uInk[2], lat, lon);
  col = mix(col, t.rgb, t.a * away);
  // A grain of about one step of the display's brightness, so dark glass shades off without bands.
  col += (hgCell(ivec3(gl_FragCoord.xy, 7)) - 0.5) * 0.0007;
  return vec4(max(col, 0.0), 1.0);
}
`;
