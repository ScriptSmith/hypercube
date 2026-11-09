/**
 * The ball behind the rings: slow, dim waves of colour, faint twinkling dots, and for people
 * underneath a medallion at the bottom pole (a turning star inside two rings of chaser lamps)
 * with soft rays round it. All of it comes from a shader of direction, so there is no seam and
 * nothing pinches at the poles. The cap nobody sees is dimmer still.
 *
 * Phases are worked out on the CPU in double precision and passed in wrapped, because a float
 * clock in the shader would lose its fractions after a few days and the twinkle would step.
 */
import { Color, Vector2, Vector3, Vector4 } from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass, type SurfacePass } from "../../core/sphere3d";
import type { FrameInfo, SphereInfo } from "../../core/types";
import type { Style } from "./styles";

const TAU = Math.PI * 2;
const WAVE_RATES = [0.05, -0.037, 0.029] as const;
const TWINKLE_RATES = [0.31, 0.47, 0.63, 0.83] as const;
const RAY_RATE = 0.06;
/** Grid cells per unit of direction for the dots: about 3 cm apart on a 4 m ball. */
const CELLS = 25;
const STAR_RATE = 0.12;
/** Lamp spacing and size round the medallion, radians (about 18 cm and 3 cm on a 4 m ball). */
const LAMP_SPACING = 0.09;
const LAMP_RADIUS = 0.014;

const FRAGMENT = /* glsl */ `
uniform vec3 uWave;
uniform vec4 uTwinkle;
uniform float uRays;
uniform float uViewTop;
uniform vec3 uBase;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform float uEmblem;
uniform vec2 uLamps;
uniform vec2 uChase;
uniform float uSpin;
uniform vec3 uDisc;
uniform vec3 uRim;
uniform vec3 uLampOn;
uniform vec3 uLampOff;
uniform vec3 uStar;

const float TICKER_TAU = 6.283185307;

// One ring of n lamps at th0 from the pole; x is the lamp's cover, y how lit it is.
vec2 tickerLamps(float th, float lon, float th0, float n, float shift) {
  float a = lon / TICKER_TAU * n;
  float i = floor(a + 0.5);
  vec2 d = vec2((a - i) * TICKER_TAU / n * sin(th0), th - th0);
  float cover = smoothstep(${LAMP_RADIUS.toFixed(4)}, ${(LAMP_RADIUS * 0.6).toFixed(4)}, length(d));
  float wave = 0.5 + 0.5 * cos(TICKER_TAU * (i + shift) / 3.0);
  return vec2(cover, wave * wave);
}

// Inside (negative) or outside a five-pointed star of outer radius ro round the origin.
float tickerStar(vec2 p, float ro) {
  float sector = TICKER_TAU / 5.0;
  float a = mod(atan(p.y, p.x) + uSpin, sector) - sector * 0.5;
  vec2 q = length(p) * vec2(cos(a), abs(sin(a)));
  float ri = ro * 0.42;
  vec2 v1 = ri * vec2(cos(sector * 0.5), sin(sector * 0.5));
  vec2 n = normalize(vec2(v1.y, ro - v1.x));
  return dot(q - vec2(ro, 0.0), n);
}

float tickerHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec4 surface(vec3 dir) {
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  float w = sin(dot(dir, vec3(0.82, 0.31, 0.48)) * 3.1 + uWave.x)
          + sin(dot(dir, vec3(-0.42, 0.58, 0.70)) * 4.3 + uWave.y)
          + sin(dot(dir, vec3(0.21, -0.88, 0.43)) * 2.4 + uWave.z);
  float k = clamp(0.5 + w / 6.0, 0.0, 1.0);
  vec3 c = uBase + mix(uTintA, uTintB, k) * (0.4 + 0.6 * k * k);

  // One possible dot per cell of a grid in space; it shows where the surface passes near it.
  // Spots stay within their cell's middle, so no dot is cut at a cell's edge.
  vec3 p = dir * ${CELLS.toFixed(1)};
  vec3 cell = floor(p);
  float h = tickerHash(cell);
  vec3 spot = cell + 0.25 + 0.5 * vec3(
    tickerHash(cell + 3.1), tickerHash(cell + 7.7), tickerHash(cell + 11.3));
  float d = length(p - spot);
  int band = int(h * 3.999);
  float phase = band == 0 ? uTwinkle.x : band == 1 ? uTwinkle.y : band == 2 ? uTwinkle.z : uTwinkle.w;
  float twinkle = 0.5 + 0.5 * sin(phase + h * 40.0);
  float dotv = step(0.5, h) * smoothstep(0.22, 0.12, d) * twinkle;
  c += (mix(uTintA, uTintB, h) * 3.0 + 0.012) * dotv;

  // Rays round the bottom pole, turning slowly.
  float fromPole = lat + 1.5707963;
  float lon = atan(dir.x, dir.z);
  float rays = 0.5 + 0.5 * cos(12.0 * lon + uRays);
  float burst = exp(-fromPole * 3.5) * (0.3 + 0.7 * rays * smoothstep(0.02, 0.2, fromPole));
  c += (uTintA + uTintB) * 2.2 * burst;

  if (uEmblem > 0.0 && fromPole < uEmblem * 1.2) {
    float e = uEmblem;
    float edge = 0.0025;
    float disc = smoothstep(e * 1.14 + edge, e * 1.14 - edge, fromPole);
    c = mix(c, uDisc, disc);
    float rim = smoothstep(edge, 0.0, abs(fromPole - e * 1.14 + edge * 2.0) - edge);
    c = mix(c, uRim, rim);
    vec2 outer = tickerLamps(fromPole, lon, e, uLamps.x, uChase.x);
    vec2 inner = tickerLamps(fromPole, lon, e * 0.66, uLamps.y, uChase.y);
    c = mix(c, mix(uLampOff, uLampOn, outer.y), outer.x);
    c = mix(c, mix(uLampOff, uLampOn, inner.y), inner.x);
    vec2 flat2 = sin(fromPole) * vec2(cos(lon), sin(lon));
    float star = smoothstep(edge, -edge, tickerStar(flat2, sin(e * 0.4)));
    c = mix(c, uStar, star);
  }

  c *= mix(1.0, 0.3, smoothstep(uViewTop, uViewTop + 0.25, lat));
  return vec4(c, 1.0);
}
`;

export interface Background {
  readonly pass: SurfacePass;
  /** Set the phases for `t` seconds into the show and draw. */
  render(t: number): void;
  setSphere(s: SphereInfo): void;
  /** The medallion's radius from the bottom pole, radians; 0 for none. */
  setEmblem(radius: number): void;
}

export interface BackgroundOptions {
  style: Style;
  /** The medallion's radius from the bottom pole, radians; 0 for none. */
  emblem: number;
  /** How fast its lamps chase, lamps a second. */
  chase: number;
}

const linear = (hex: string): Color => new Color(hex);
/** Lamps round a ring at `th` from the pole: a multiple of 6, so the chase closes at the seam. */
const lampCount = (th: number): number =>
  Math.max(6, 6 * Math.round((2 * Math.PI * Math.sin(th)) / LAMP_SPACING / 6));

const wrap = (x: number) => ((x % TAU) + TAU) % TAU;

export const createBackground = (
  r3d: Renderer3D,
  frame: FrameInfo,
  opts: BackgroundOptions,
): Background => {
  const { style } = opts;
  const wave = new Vector3();
  const twinkle = new Vector4();
  const lamps = new Vector2();
  const chase = new Vector2();
  const uniforms = {
    uWave: { value: wave },
    uTwinkle: { value: twinkle },
    uRays: { value: 0 },
    uViewTop: { value: (frame.sphere ?? WHOLE_SPHERE).view.top },
    uBase: { value: new Vector3(...style.base) },
    uTintA: { value: new Vector3(...style.tintA) },
    uTintB: { value: new Vector3(...style.tintB) },
    uEmblem: { value: 0 },
    uLamps: { value: lamps },
    uChase: { value: chase },
    uSpin: { value: 0 },
    uDisc: { value: linear(style.band) },
    uRim: { value: linear(style.rim) },
    uLampOn: { value: linear(style.lampOn) },
    uLampOff: { value: linear(style.lampOff) },
    uStar: { value: linear(style.star) },
  };
  const setEmblem = (radius: number) => {
    uniforms.uEmblem.value = Math.max(0, radius);
    lamps.set(lampCount(radius), lampCount(radius * 0.66));
  };
  setEmblem(opts.emblem);
  const pass = createSurfacePass(r3d, frame, { fragment: FRAGMENT, uniforms });
  return {
    pass,
    render(t) {
      wave.set(wrap(WAVE_RATES[0] * t), wrap(WAVE_RATES[1] * t), wrap(WAVE_RATES[2] * t));
      twinkle.set(
        wrap(TWINKLE_RATES[0] * t),
        wrap(TWINKLE_RATES[1] * t),
        wrap(TWINKLE_RATES[2] * t),
        wrap(TWINKLE_RATES[3] * t),
      );
      uniforms.uRays.value = wrap(RAY_RATE * t);
      // Wrapped to whole cycles of three lamps, so the pattern never jumps.
      chase.set((opts.chase * t) % 3, 3 - ((0.8 * opts.chase * t) % 3));
      uniforms.uSpin.value = (STAR_RATE * t) % ((2 * Math.PI) / 5);
      pass.render();
    },
    setSphere(s) {
      pass.setSphere(s);
      uniforms.uViewTop.value = s.view.top;
    },
    setEmblem,
  };
};
