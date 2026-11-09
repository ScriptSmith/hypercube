/**
 * The final pass over the whole feed: the dark glass, the smoke from its smaller target, the
 * vision through each viewer's window where the smoke lets it show, and the glass's own sheen and
 * rim, which stay put in the room while everything inside moves. It writes sRGB with a little
 * dither, so slow dark gradients don't band on the LEDs.
 */
import { SPHERE_GLSL } from "../../core/sphere3d";
import { HASH_GLSL } from "./hash";
import { MIN_WEIGHT, SHARPNESS, VIEWERS, WINDOW_BIAS } from "./views";

export const GLASS_GLSL = /* glsl */ `
${SPHERE_GLSL}
${HASH_GLSL}
uniform sampler2D uSmoke;
uniform sampler2D uVision;
uniform vec3 uEye[${VIEWERS}];
uniform vec3 uWinN[${VIEWERS}];
uniform vec3 uWinR[${VIEWERS}];
uniform vec3 uWinU[${VIEWERS}];
uniform int uWindows;
uniform float uPart;
uniform float uWindowR;
uniform vec3 uBase;
uniform vec3 uMist;
uniform vec2 uRig;
uniform float uBelow;
uniform vec3 uSheen;
varying vec2 vFeed;

float facingFrom(vec3 n, vec3 eye) {
  return dot(n, normalize(eye - n));
}

vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

#define VIEWERS ${VIEWERS}
#define WINDOW_BIAS ${WINDOW_BIAS.toFixed(2)}
#define SHARP ${SHARPNESS.toFixed(1)}
#define MIN_WEIGHT ${MIN_WEIGHT}

/** The vision as the smoke pass weighed the viewers here, only those with windows. */
vec3 vision(vec3 n) {
  float f[VIEWERS];
  float best = -2.0;
  for (int i = 0; i < VIEWERS; i++) {
    f[i] = facingFrom(n, uEye[i]) + (i < uWindows ? WINDOW_BIAS * uPart : 0.0);
    best = max(best, f[i]);
  }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < VIEWERS; i++) {
    if (i >= uWindows) break;
    float w = exp(SHARP * (f[i] - best));
    if (w < MIN_WEIGHT) continue;
    vec3 dv = normalize(n - uEye[i]);
    float across = dot(uWinN[i], dv);
    float s = -dot(uWinN[i], n) / min(across, -1e-4);
    vec3 hit = n + dv * max(s, 0.0);
    vec2 uv = vec2(dot(hit, uWinR[i]), dot(hit, uWinU[i])) / uWindowR;
    sum += w * textureLod(uVision, clamp(uv * 0.5 + 0.5, 0.0, 1.0), 0.0).rgb;
    total += w;
  }
  vec3 v = sum / max(total, 1e-6);
  // Far off, through mist.
  return mix(v, uMist, 0.14);
}

void main() {
  vec3 n = sphereDir(vFeed);
  vec4 sm = texture2D(uSmoke, vec2(vFeed.x, 1.0 - vFeed.y));
  vec3 col = uBase + sm.rgb;
  if (sm.a > 0.002) col += sm.a * vision(n);

  // The glass catches light along its upper edge as seen from round about.
  float lon = atan(n.x, n.z);
  vec3 eA = vec3(uRig.x * sin(lon), uRig.y, uRig.x * cos(lon));
  float f = facingFrom(n, eA);
  if (uBelow > 0.5) f = max(f, facingFrom(n, vec3(0.0, uRig.y, 0.0)));
  col += uSheen * pow(1.0 - clamp(f, 0.0, 1.0), 3.0) * 0.015;
  // Soft reflections of the room's lights, fixed in the room: a faint ring high on the glass,
  // brighter a third of the way round each time, and a faint glow from the floor below.
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float round3 = 0.5 + 0.5 * cos(3.0 * lon + 0.4);
  col += uSheen * exp(-sq((lat - 0.62) / 0.13)) * (0.0035 + 0.009 * pow(round3, 6.0));
  col += uSheen * exp(-sq((lat - 0.42) / 0.07)) * pow(round3, 24.0) * 0.015;
  col += uSheen * exp(-sq((lat + 1.2) / 0.25)) * 0.002;

  vec3 c = toSrgb(col);
  c += (hashCell(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;
