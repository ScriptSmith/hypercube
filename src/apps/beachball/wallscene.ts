/**
 * The beach behind the balls, drawn in one pass over the wall: sky with drifting clouds, a low
 * headland, the sea with waves rolling in and breaking, the wash running up the sand and back,
 * and dry sand with wind ripples. It is painted as seen through a window from standing height,
 * so the ground recedes to the horizon at the viewer's eye height and everything on it shrinks
 * with distance.
 *
 * Everything that moves comes in as a phase or an offset computed on the CPU and wrapped, so the
 * picture stays smooth after days. The time of day (`wallsky.ts`) colours it all: the sky and
 * clouds, the sea with a path of light under a rising sun or the moon, stars, and the sand.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import type { Rng } from "../../core/types";
import { EYE_DISTANCE } from "./walllayout";
import { NET_GLSL, type NetScene } from "./wallnet";
import { TONE_GLSL } from "./wallshade";
import { SEA_EDGE_GLSL } from "./wallsea";
import { LIGHT_GLSL, type SkyUniforms } from "./wallsky";

export const NOISE_SIZE = 256;
/** The swell's phase is wrapped to this many turns, so slower drifts tied to it wrap whole. */
export const SWELL_WRAP = 8;

/**
 * Four channels of smooth, tiling value noise (three at different cell sizes and one per texel),
 * so the shader's textures need no arithmetic noise.
 */
export const makeNoise = (rng: Rng, size = NOISE_SIZE): Uint8Array => {
  const out = new Uint8Array(size * size * 4);
  const smoothNoise = (cells: number, channel: number) => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    const at = (x: number, y: number) =>
      lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]!;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        out[(y * size + x) * 4 + channel] = Math.round((a + (b - a) * ty) * 255);
      }
    }
  };
  smoothNoise(32, 0);
  smoothNoise(32, 1);
  smoothNoise(64, 2);
  for (let i = 0; i < size * size; i++) out[i * 4 + 3] = Math.floor(rng.next() * 256);
  return out;
};

export const createNoiseTexture = (rng: Rng): DataTexture => {
  const tex = new DataTexture(makeNoise(rng), NOISE_SIZE, NOISE_SIZE, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
};

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uNoise;
// Width and height of the wall, metres.
uniform vec2 uSize;
// The balls' sand line, the shore, the horizon and the distance to the viewer's eye.
uniform vec4 uLines;
// The wash's mean front, the lowest wet sand, its wrapped time and how hard the surf breaks.
uniform vec4 uWash;
// Phase of the swell rolling in (radians, wrapped to SWELL_WRAP turns) and the clouds' drift
// (noise tiles, wrapped).
uniform vec3 uDrift;
uniform vec3 uSun;
// The time of day: sky, glow (colour, and where across and up the wall and how wide), clouds,
// sea, foam, sand and land, the sun's and moon's discs (across, metres above the horizon,
// radius, strength), stars, and time for their twinkle.
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform vec3 uGlow;
uniform vec3 uGlowAt;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uClouds;
uniform vec3 uSeaTint;
uniform vec3 uSeaSky;
uniform vec3 uFoam;
uniform vec3 uSandTint;
uniform vec3 uLandTint;
uniform vec4 uSunDisc;
uniform vec3 uSunColour;
uniform vec4 uMoonDisc;
uniform float uStars;
uniform vec2 uSkyTime;
varying vec2 vUv;
const float SWELL_WRAP = ${SWELL_WRAP.toFixed(1)};
const vec3 MOON = vec3(0.92, 0.93, 0.88);

${SEA_EDGE_GLSL}
${TONE_GLSL}
${LIGHT_GLSL}
${NET_GLSL}

float nz(vec2 p, int c) {
  vec4 t = texture2D(uNoise, p);
  return c == 0 ? t.r : (c == 1 ? t.g : (c == 2 ? t.b : t.a));
}

float clouds(vec2 q) {
  float n = 0.5 * nz(q, 0) + 0.25 * nz(q * 2.03 + vec2(0.37, 0.11), 1)
    + 0.14 * nz(q * 4.11 + vec2(0.71, 0.53), 2) + 0.07 * nz(q * 8.3 + vec2(0.19, 0.83), 0);
  return n / 0.96;
}

// A disc in the sky, with a halo, cut off by the horizon where it rises out of the sea.
vec3 skyDisc(vec3 sky, vec2 q, float horizon, vec4 disc, vec3 colour, float halo) {
  vec2 c = vec2(disc.x * uSize.x, horizon + disc.y);
  float d = length(q - c);
  float r = disc.z;
  sky += colour * halo * disc.w * exp(-max(d - r, 0.0) / (r * 2.5));
  float core = 1.0 - smoothstep(r - uNetPx, r + uNetPx, d);
  return mix(sky, colour * (0.9 + 0.6 * disc.w), core * min(1.0, disc.w));
}

// Stars: one in a few of the cells of a grid, each at its own place, size and twinkle.
vec3 starField(vec3 sky, vec2 q, float horizon) {
  vec2 g = q * 6.0;
  vec2 cell = floor(g);
  float r1 = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  if (r1 < 0.93) return sky;
  float r2 = fract(r1 * 31.7 + 0.3);
  float r3 = fract(r1 * 57.1 + 0.7);
  vec2 at = (cell + 0.2 + 0.6 * vec2(r2, r3)) / 6.0;
  float d = length(q - at);
  float size = 0.006 + 0.01 * r2;
  float twinkle = 0.65 + 0.35 * sin(uSkyTime.x * (1.0 + 2.0 * r3) + r1 * 40.0);
  float star = (1.0 - smoothstep(size, size + uNetPx * 1.5, d)) * twinkle;
  float high = smoothstep(horizon + 0.15, horizon + 0.9, q.y);
  return sky + vec3(0.9, 0.92, 1.0) * star * high * uStars * (0.5 + 0.5 * r3);
}

// A path of light on the sea towards a disc, wide near the shore and narrow at the horizon,
// broken up by the swell and chop.
vec3 lightPath(float x, float far, float sparkle, vec4 disc, vec3 colour) {
  float width = mix(1.7, 0.12, pow(far, 0.6));
  float across = exp(-pow((x - disc.x * uSize.x) / width, 2.0));
  return colour * disc.w * across * sparkle;
}

vec3 sandColour(vec2 g, float shade) {
  // Grain and drifts of slightly darker and paler sand.
  float drift = nz(g * 0.07, 1) - 0.5;
  float grain = nz(g * 3.1, 3) - 0.5;
  vec3 base = vec3(0.70, 0.60, 0.44);
  vec3 col = base * (1.0 + 0.10 * drift + 0.07 * grain);
  col = mix(col, vec3(0.62, 0.55, 0.47), 0.25 * smoothstep(0.2, 0.45, nz(g * 0.21 + 0.3, 2)));
  return col * shade * uSandTint;
}

void main() {
  vec2 p = vUv * uSize;
  float floorY = uLines.x;
  float shore = uLines.y;
  float horizon = uLines.z;
  float dist = uLines.w;
  float s = p.y;
  vec3 col;

  if (s >= horizon) {
    float h = clamp((s - horizon) / max(uSize.y - horizon, 0.01), 0.0, 1.0);
    vec3 sky = mix(uSkyLow, uSkyTop, pow(h, 0.55));
    // A glow where the light comes from: by day high behind the people's left shoulders.
    float glow = exp(-(pow(vUv.y - uGlowAt.y, 2.0) + pow((vUv.x - uGlowAt.x) * 0.6, 2.0)) / uGlowAt.z);
    sky += uGlow * glow;
    vec2 q = vec2(p.x, s);
    if (uStars > 0.01) sky = starField(sky, q, horizon);
    if (uMoonDisc.w > 0.001) sky = skyDisc(sky, q, horizon, uMoonDisc, MOON, 0.12);
    if (uSunDisc.w > 0.001) sky = skyDisc(sky, q, horizon, uSunDisc, uSunColour, 0.55);
    // Clouds on a layer overhead, shrinking towards the horizon.
    float lift = (s - horizon) / dist;
    float depth = 1.0 / (lift + 0.06);
    vec2 cq = vec2((p.x - 0.5 * uSize.x) * depth * 0.018, depth * 0.11) + uDrift.yz;
    float n = clouds(cq);
    float n2 = clouds(cq + vec2(-0.012, -0.03));
    float cover = smoothstep(0.52, 0.72, n) * smoothstep(0.02, 0.25, lift) * (1.0 - 0.4 * h);
    cover *= uClouds;
    float lit = clamp(0.55 + (n - n2) * 6.0, 0.0, 1.0);
    vec3 cloud = mix(uCloudDark, uCloudLit, lit);
    col = mix(sky, cloud, cover * 0.92);
    // A low headland to the right and an islet to the left, hazy with distance.
    float x = p.x / uSize.x;
    float head = smoothstep(0.62, 0.9, x) * (0.08 + 0.07 * nz(vec2(x * 1.4, 0.5), 2));
    float islet = 0.05 * exp(-pow((x - 0.13) / 0.03, 2.0));
    float land = max(head, islet) * (0.85 + 0.15 * nz(vec2(x * 5.0, 0.2), 1));
    float above = s - horizon;
    if (above < land) {
      float bush = nz(p * vec2(0.6, 2.0), 0);
      vec3 green = mix(vec3(0.13, 0.25, 0.22), vec3(0.24, 0.36, 0.36), above / max(land, 1e-3));
      vec3 haze = uSkyLow * vec3(0.9, 0.895, 0.886);
      col = mix(green * (0.85 + 0.3 * bush) * uLandTint, haze, 0.5);
    }
  } else {
    // Ground below the horizon: how far behind the wall this point is, and its place there.
    float z = s * dist / max(horizon - s, 1e-3);
    float spread = (dist + z) / dist;
    vec2 g = vec2((p.x - 0.5 * uSize.x) * spread, z);
    float front = seaEdge(uWash.x, p.x, uWash.z);
    if (s > shore) {
      float far = clamp((s - shore) / max(horizon - shore, 0.01), 0.0, 1.0);
      vec3 sea = mix(vec3(0.07, 0.47, 0.50), vec3(0.02, 0.26, 0.42), smoothstep(0.0, 0.25, far));
      sea = mix(sea, vec3(0.015, 0.13, 0.31), smoothstep(0.2, 0.75, far));
      sea *= uSeaTint;
      // The swell: long crests rolling in, bent a little, finer with distance until they fade.
      float roll = uDrift.x / (6.2831853 * SWELL_WRAP);
      float bend = nz(vec2(g.x * 0.012, g.y * 0.004), 1) * 6.2831853;
      float phase = g.y * 1.25 + bend + uDrift.x;
      float swell = 0.5 + 0.5 * sin(phase);
      float fine = clamp(1.0 - fwidth(phase) * 0.6, 0.0, 1.0);
      float chop = 0.6 * nz(vec2(g.x * 0.09, g.y * 0.05 + roll), 2)
        + 0.4 * nz(vec2(g.x * 0.23, g.y * 0.13 + roll * 2.0), 0);
      sea *= 1.0 + (0.5 * (swell - 0.5) + 0.35 * (chop - 0.5)) * fine;
      // Sky light catching the face of each crest, and now and then a whitecap.
      sea = mix(sea, vec3(0.32, 0.58, 0.70) * uSeaTint, pow(swell, 10.0) * fine * 0.4);
      float caps = smoothstep(0.82, 0.95, chop * (0.4 + 0.6 * swell)) * fine * (1.0 - far);
      // The sea mirrors the sky only close to the horizon.
      sea = mix(sea, uSeaSky, pow(far, 7.0) * 0.6);
      // The rising sun's and the moon's light on the water.
      float sparkle = 0.18 + 1.4 * smoothstep(0.5, 0.9, chop * (0.45 + 0.55 * swell));
      if (uSunDisc.w > 0.001) sea += lightPath(p.x, far, sparkle, uSunDisc, uSunColour * 0.75);
      if (uMoonDisc.w > 0.001) sea += lightPath(p.x, far, sparkle, uMoonDisc, MOON * 0.35);
      // Surf breaking just off the sand, harder as a wave starts up the beach.
      float band = smoothstep(shore + 0.2, shore + 0.03, s) * smoothstep(shore - 0.01, shore + 0.025, s);
      float lace = 0.6 * nz(vec2(g.x * 0.18, g.y * 0.9 + roll * 2.0), 1)
        + 0.4 * nz(vec2(g.x * 0.5, g.y * 2.2 - roll), 2);
      float foam = band * smoothstep(0.42, 0.72, lace * (0.8 + 0.45 * uWash.w));
      col = mix(sea, uFoam, clamp(foam + caps * 0.6, 0.0, 0.92));
    } else {
      // Ripples blown into the sand, lit from the sun's side.
      float rip = g.y * 46.0 + g.x * 3.0 + 6.0 * nz(g * 0.05, 0);
      float ripFade = clamp(1.0 - fwidth(rip) * 0.35, 0.0, 1.0);
      float slope = cos(rip) * ripFade;
      vec3 dry = sandColour(g, 1.0 + 0.05 * slope);
      float wetSand = smoothstep(uWash.y - 0.02, uWash.y + 0.18, s);
      vec3 wet = dry * vec3(0.66, 0.66, 0.68) + vec3(0.05, 0.07, 0.09) * wetSand * uSandTint;
      col = mix(dry, wet, smoothstep(uWash.y - 0.03, uWash.y + 0.03, s));
      if (s > front) {
        // A thin sheet of water running up and sliding back: the sand shows through near its
        // front, foam laces the front and trails behind it in streaks.
        float depthW = clamp((s - front) / max(shore - front, 0.05), 0.0, 1.0);
        float thick = 0.12 + 0.5 * depthW * depthW;
        vec3 water = mix(col * vec3(0.80, 0.93, 0.95), vec3(0.16, 0.52, 0.55) * uSeaTint, thick);
        water += vec3(0.07, 0.10, 0.12) * uSeaTint * (0.4 + 0.6 * nz(vec2(g.x * 0.3, g.y * 0.8), 2));
        float lace = nz(vec2(g.x * 0.9, g.y * 1.4 + uWash.z * 0.02), 1);
        float edgeFoam = smoothstep(0.07, 0.0, s - front) * (0.5 + 0.5 * lace);
        float streak = smoothstep(0.58, 0.82, nz(vec2(g.x * 0.14, g.y * 1.6 + uWash.z * 0.01), 1));
        float trail = streak * (1.0 - depthW) * 0.55;
        col = mix(water, uFoam * 1.01, clamp(edgeFoam + trail, 0.0, 0.85));
      }
    }
    col *= netShade(vec3(0.5 * uSize.x + g.x, 0.0, z));
  }
  col = netPaint(col, p, s, horizon, dist);
  gl_FragColor = vec4(tone(col), 1.0);
  #include <colorspace_fragment>
}
`;

export interface Beach {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  set(o: {
    width: number;
    height: number;
    floor: number;
    shore: number;
    horizon: number;
    edge: number;
    wetTo: number;
    washTime: number;
    breaking: number;
    swell: number;
    cloudX: number;
    cloudY: number;
    net: NetScene | null;
    /** Metres of wall one pixel of the drawing buffer spans. */
    pixel: number;
  }): void;
}

export const createBeach = (
  noise: DataTexture,
  sun: readonly number[],
  sky: SkyUniforms,
): Beach => {
  const size = new Vector2(1, 1);
  const lines = new Vector4();
  const wash = new Vector4();
  const drift = new Vector3();
  const netA = new Vector4();
  const netB = new Vector4();
  const netBox = new Vector4();
  const netShade = new Vector4();
  const netPx = { value: 0.002 };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uNoise: { value: noise },
      uSize: { value: size },
      uLines: { value: lines },
      uWash: { value: wash },
      uDrift: { value: drift },
      uNetA: { value: netA },
      uNetB: { value: netB },
      uNetBox: { value: netBox },
      uNetShadeBox: { value: netShade },
      uNetPx: netPx,
      uSun: { value: new Vector3(sun[0], sun[1], sun[2]) },
      ...sky,
    },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return {
    mesh,
    material,
    set(o) {
      size.set(o.width, o.height);
      lines.set(o.floor, o.shore, o.horizon, EYE_DISTANCE);
      wash.set(o.edge, o.wetTo, o.washTime, o.breaking);
      drift.set(o.swell, o.cloudX, o.cloudY);
      const n = o.net;
      netPx.value = o.pixel;
      if (n) {
        netA.set(n.fx, n.fz, n.ux, n.uz);
        netB.set(n.length, n.top, n.bottom, n.post);
        netBox.set(...n.box);
        netShade.set(...n.shade);
      } else {
        netB.set(0, 0, 0, 0);
      }
    },
  };
};
