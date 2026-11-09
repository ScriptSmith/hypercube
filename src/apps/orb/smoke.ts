/**
 * The smoke pass: for each point of the feed, a ray from someone looking at that point is traced
 * through the orb and the glowing smoke along it summed up. It draws into a smaller target than
 * the feed, since smoke is soft. Alpha carries how much of a vision shows through: the
 * transmittance down to the middle of the ray, where the vision's window lies, times how open
 * the window is there.
 *
 * The smoke is two copies of one noise field, each carried back along a slow swirl for its own
 * age and blended so that one fades out as it restarts while the other is at its fullest. The
 * swirl winds the noise into spirals without the winding growing for ever.
 */
import { SPHERE_GLSL } from "../../core/sphere3d";
import { HASH_GLSL } from "./hash";
import { MIN_WEIGHT, SHARPNESS, VIEWERS, WINDOW_BIAS } from "./views";

/** Most steps any ray takes; the actual count is a uniform. */
export const MAX_STEPS = 32;

export const SMOKE_GLSL = /* glsl */ `
${SPHERE_GLSL}
${HASH_GLSL}
uniform sampler3D uNoise;
uniform mat3 uSpin;
uniform vec3 uAxis;
uniform vec2 uFlow;
uniform vec4 uPhaseA;
uniform vec4 uPhaseB;
uniform vec2 uAge;
uniform vec3 uLightPos[3];
uniform vec3 uLightCol[3];
uniform vec3 uAmbient;
uniform vec2 uThick;
uniform float uSigma;
uniform float uPart;
uniform float uReveal;
uniform vec3 uEye[${VIEWERS}];
uniform vec3 uWinN[${VIEWERS}];
uniform vec3 uWinR[${VIEWERS}];
uniform vec3 uWinU[${VIEWERS}];
uniform int uWindows;
uniform float uWindowR;
uniform int uSteps;
/** Where the window edges sample their wobble, wrapped since the noise repeats. */
uniform vec3 uWobble;
uniform float uFall;
varying vec2 vFeed;

#define MAX_STEPS ${MAX_STEPS}
#define VIEWERS ${VIEWERS}
#define WINDOW_BIAS ${WINDOW_BIAS.toFixed(2)}
#define SHARP ${SHARPNESS.toFixed(1)}
#define MIN_WEIGHT ${MIN_WEIGHT}

vec3 backTrace(vec3 p, float age) {
  float h = dot(p, uAxis);
  vec3 r = p - h * uAxis;
  float rho2 = dot(r, r);
  // Faster round the middle than near the glass, so the field winds into spirals.
  float ang = -age * uFlow.x * (1.35 - 0.85 * rho2);
  vec3 b = cross(uAxis, r);
  r = r * cos(ang) + b * sin(ang);
  // Rising up the middle and sinking down the sides.
  h -= age * uFlow.y * (1.0 - 2.4 * rho2);
  return r + h * uAxis;
}

vec2 field(vec3 q, vec3 off, float age) {
  vec3 s = backTrace(q, age);
  vec3 w = textureLod(uNoise, s * 0.37 + off * 0.61, 0.0).gba - 0.5;
  s += w * 0.85;
  return vec2(textureLod(uNoise, s * 0.52 + off, 0.0).r, textureLod(uNoise, s * 1.31 + off.zxy, 0.0).r);
}

float smoke(vec3 p) {
  vec3 q = uSpin * p;
  vec2 a = field(q, uPhaseA.xyz, uAge.x);
  vec2 b = field(q, uPhaseB.xyz, uAge.y);
  float wa = uPhaseA.w;
  float wb = uPhaseB.w;
  // Two blended fields are flatter than one; scale back up to the same contrast.
  vec2 n = 0.5 + (wa * (a - 0.5) + wb * (b - 0.5)) * inversesqrt(max(1e-4, wa * wa + wb * wb));
  // Patches of smoke, and within them thin sheets where the finer field crosses its middle.
  float body = smoothstep(uThick.y, uThick.y + 0.25, n.x);
  float sheet = 1.0 - abs(2.0 * n.y - 1.0);
  return body * (0.3 + 0.7 * sheet * sheet);
}

vec3 glowAt(vec3 p) {
  vec3 c = uAmbient;
  for (int k = 0; k < 3; k++) {
    vec3 d = p - uLightPos[k];
    c += uLightCol[k] / (1.0 + uFall * dot(d, d));
  }
  return c;
}

float facingFrom(vec3 n, vec3 eye) {
  return dot(n, normalize(eye - n));
}

/** How open viewer i's window is where the line from its eye through n crosses it. */
float windowMask(int i, vec3 n) {
  vec3 dv = normalize(n - uEye[i]);
  float across = dot(uWinN[i], dv);
  if (across > -1e-4) return 0.0;
  float s = -dot(uWinN[i], n) / across;
  if (s < 0.0) return 0.0;
  vec3 hit = n + dv * s;
  vec2 uv = vec2(dot(hit, uWinR[i]), dot(hit, uWinU[i])) / uWindowR;
  float wob = textureLod(uNoise, hit * 0.8 + uWobble + vec3(0.0, 0.37 * float(i), 0.0), 0.0).g - 0.5;
  // The window opens out from a small hole as the smoke parts.
  float open = 0.22 + 0.78 * uPart;
  return 1.0 - smoothstep(0.45, 1.0, length(uv) / open + wob * 0.45);
}

/** The smoke seen through surface point n from eye: colour, and how much of a vision shows. */
vec4 march(vec3 n, vec3 eye, float mask, int steps, float jitter) {
  vec3 d = normalize(n - eye);
  float chord = max(0.0, -2.0 * dot(n, d));
  float ds = chord / float(steps);
  float halfway = 0.5 * chord;
  float thin = mask * uPart;
  vec3 col = vec3(0.0);
  float T = 1.0;
  float seen = -1.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps) break;
    float s = (float(i) + jitter) * ds;
    if (seen < 0.0 && s >= halfway) {
      seen = T * mask * uReveal;
      T *= 1.0 - mask * uReveal;
    }
    vec3 p = n + d * s;
    float den = smoke(p) * (1.0 - smoothstep(0.82, 1.0, length(p))) * uThick.x * (1.0 - 0.35 * uPart);
    // In front of an open window the mist thins with depth, leaving a veil near the glass.
    if (seen < 0.0) den *= 1.0 - 0.97 * thin * smoothstep(0.0, 0.3, s / max(halfway, 1e-3));
    if (den > 0.002) {
      col += T * den * glowAt(p) * ds;
      T *= exp(-uSigma * den * ds);
    }
  }
  if (seen < 0.0) seen = T * mask * uReveal;
  return vec4(col, seen);
}

void main() {
  vec3 n = sphereDir(vFeed);
  float f[VIEWERS];
  float best = -2.0;
  for (int i = 0; i < VIEWERS; i++) {
    f[i] = facingFrom(n, uEye[i]) + (i < uWindows ? WINDOW_BIAS * uPart : 0.0);
    best = max(best, f[i]);
  }
  // A different start along the ray for neighbouring pixels hides the steps as fine grain.
  float jitter = hashCell(gl_FragCoord.xy);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < VIEWERS; i++) {
    float w = exp(SHARP * (f[i] - best));
    if (w < MIN_WEIGHT) continue;
    float mask = i < uWindows && uPart > 0.001 ? windowMask(i, n) : 0.0;
    sum += w * march(n, uEye[i], mask, uSteps, jitter);
    total += w;
  }
  gl_FragColor = sum / max(total, 1e-6);
}
`;
