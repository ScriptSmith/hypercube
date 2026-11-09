/**
 * What lies on the glass itself, drawn over the views of the inside at the feed's own
 * resolution, so it is the same for everyone: the mound's base resting on the bottom, the loose
 * snow piled against the glass round it, a faint sheen from the room's lights, and a soft glow
 * over the cap nobody sees well.
 */
import {
  AddEquation,
  Color,
  CustomBlending,
  Matrix3,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector2,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { createSurfacePass, type SurfacePass } from "../../core/sphere3d";
import type { FrameInfo } from "../../core/types";
import { DEN_ANGLE } from "./den";
import { FOOT_LAT, R } from "./mound";
import { PILE_BINS } from "./snow";

const GLASS = /* glsl */ `
uniform mat3 uPose;
uniform float uPile[${PILE_BINS}];
uniform float uFoot;
uniform float uDen;
uniform vec3 uPileLit;
uniform vec3 uPileDeep;
uniform vec3 uBase;
uniform float uCap;
uniform vec3 uCapGlow;
uniform float uCell;
uniform vec2 uPx;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float h31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float pileEdge(float lon) {
  float u = (lon + SPHERE_PI) / (2.0 * SPHERE_PI) * ${PILE_BINS}.0 - 0.5;
  float i0 = floor(u);
  int a = int(mod(i0, ${PILE_BINS}.0));
  int b = int(mod(i0 + 1.0, ${PILE_BINS}.0));
  return mix(uPile[a], uPile[b], u - i0);
}

// A soft reflection of one of the room's lights, fixed to the room.
float sheen(float lat, float lon, float atLon) {
  float dl = mod(lon - atLon + SPHERE_PI, 2.0 * SPHERE_PI) - SPHERE_PI;
  float x = dl * cos(lat) / 0.13;
  float y = (lat - 0.7) / 0.08;
  return exp(-(x * x + y * y));
}

vec4 surface(vec3 dir) {
  vec2 ll = sphereLatLon(dir);
  float lat = ll.x;
  float lon = ll.y;
  float aa = uPx.y * 1.2;
  vec3 ld = uPose * dir;
  float llat = asin(clamp(ld.y, -1.0, 1.0));

  // The base: earth and pebbles pressed against the glass, round the den's mouth.
  if (llat < uFoot + aa) {
    float fromPole = acos(clamp(-ld.y, -1.0, 1.0));
    vec2 plane = normalize(ld.xz + 1e-6) * fromPole;
    vec2 g = plane / 0.05;
    vec2 cell = floor(g);
    float best = 9.0;
    float tone = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h = h21(c);
        vec2 at = c + 0.5 + (vec2(h, h21(c + 9.0)) - 0.5) * 0.7;
        float d = length(g - at) / (0.25 + 0.3 * h21(c + 4.0));
        if (d < best) {
          best = d;
          tone = h;
        }
      }
    }
    float soil = vnoise(ld * 60.0);
    vec3 earth = uBase * vec3(0.95, 0.8, 0.7) * (0.6 + 0.5 * soil);
    vec3 pebble = uBase * (0.95 + 0.6 * tone) * mix(vec3(1.0), vec3(1.05, 0.98, 0.9), tone);
    float stoneEdge = smoothstep(1.0, 0.8, best);
    vec3 c = mix(earth, pebble * (1.0 - 0.25 * best), stoneEdge);
    float rim = smoothstep(uFoot - 0.06, uFoot, llat);
    c = mix(c, uPileDeep, rim * 0.5);
    // The den's mouth, where people underneath look in.
    float a = smoothstep(uFoot + aa, uFoot - aa, llat) * smoothstep(uDen - aa, uDen + aa, fromPole);
    return vec4(c * a, a);
  }

  // The pile: chips of snow pressed on the glass, with a ragged top a chip at a time.
  float edge = pileEdge(lon);
  if (lat < edge + uCell * 1.5) {
    // Rows of chips, each a whole number of chips round, so no chip is cut at the seam.
    float row = floor(lat / uCell);
    float around = max(3.0, floor(2.0 * SPHERE_PI * cos((row + 0.5) * uCell) / uCell));
    vec2 g = vec2((lon + SPHERE_PI) / (2.0 * SPHERE_PI) * around, lat / uCell);
    vec2 cell = vec2(mod(floor(g.x), around), row);
    vec2 f = fract(g) - 0.5;
    float r1 = h21(cell);
    float r2 = h21(cell + 17.0);
    float d = length(f - (vec2(r1, r2) - 0.5) * 0.45);
    float chip = smoothstep(0.46, 0.3, d);
    float top = edge + (r2 - 0.35) * uCell * 1.3 * chip;
    float a = smoothstep(top + aa, top - aa, lat);
    if (a > 0.0) {
      float depth = clamp((lat - uFoot) / max(edge - uFoot, 0.01), 0.0, 1.0);
      vec3 c = mix(uPileDeep, uPileLit, 0.3 + 0.7 * depth);
      c *= 0.9 + 0.22 * chip * r1;
      return vec4(c * a, a);
    }
  }

  // The glass: faint reflections of the room's lights, and a glow over the cap.
  float s = 0.0;
  s += sheen(lat, lon, 0.6);
  s += sheen(lat, lon, 0.6 + 2.0944);
  s += sheen(lat, lon, 0.6 + 4.1888);
  vec3 add = vec3(0.035, 0.04, 0.05) * s + vec3(0.01, 0.012, 0.016) * smoothstep(0.2, 1.2, lat);
  float cap = smoothstep(uCap, uCap + 0.3, lat) * 0.75;
  return vec4(uCapGlow * cap + add, cap);
}
`;

export interface Glass {
  readonly pass: SurfacePass;
  /** The scene's turn, world from local, row by row. */
  setPose(m: ArrayLike<number>): void;
  /** Pile heights per bin (design metres from the centre). */
  setPile(level: ArrayLike<number>): void;
  setColors(pileLit: Color, pileDeep: Color, base: Color, capGlow: Color): void;
  resize(frame: FrameInfo): void;
  render(): void;
}

export const createGlass = (r3d: Renderer3D, frame: FrameInfo): Glass => {
  const uniforms = {
    uPose: { value: new Matrix3() },
    uPile: { value: Array.from({ length: PILE_BINS }, () => FOOT_LAT) },
    uFoot: { value: FOOT_LAT },
    uDen: { value: DEN_ANGLE },
    uPileLit: { value: new Color() },
    uPileDeep: { value: new Color() },
    uBase: { value: new Color() },
    uCap: { value: 1 },
    uCapGlow: { value: new Color() },
    // Chips of 3.5 cm in design metres.
    uCell: { value: 0.035 / R },
    uPx: { value: new Vector2(1e-3, 1e-3) },
  };
  const pass = createSurfacePass(r3d, frame, { fragment: GLASS, uniforms });
  const m = pass.material;
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;

  const resize = (f: FrameInfo) => {
    const s = f.sphere;
    if (s) {
      pass.setSphere(s);
      uniforms.uCap.value = Math.min(Math.PI / 2, s.view.top + 0.15);
    }
    const rows = Math.max(1, f.height * f.pixelRatio);
    const span = s ? s.cover.top - s.cover.bottom : Math.PI;
    uniforms.uPx.value.set((2 * Math.PI) / Math.max(1, f.width * f.pixelRatio), span / rows);
  };
  resize(frame);

  return {
    pass,
    setPose(p) {
      // The shader wants local from world: the transpose.
      uniforms.uPose.value.set(p[0]!, p[3]!, p[6]!, p[1]!, p[4]!, p[7]!, p[2]!, p[5]!, p[8]!);
    },
    setPile(level) {
      const out = uniforms.uPile.value;
      for (let i = 0; i < PILE_BINS; i++)
        out[i] = Math.asin(Math.max(-1, Math.min(1, level[i]! / R)));
    },
    setColors(pileLit, pileDeep, base, capGlow) {
      uniforms.uPileLit.value.copy(pileLit);
      uniforms.uPileDeep.value.copy(pileDeep);
      uniforms.uBase.value.copy(base);
      uniforms.uCapGlow.value.copy(capGlow);
    },
    resize,
    render() {
      const r = r3d.renderer;
      const clear = r.autoClear;
      r.autoClear = false;
      pass.render();
      r.autoClear = clear;
    },
  };
};
