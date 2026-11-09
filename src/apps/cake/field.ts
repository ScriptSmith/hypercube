/**
 * The glaze as a field over the whole ball, in the pudding's own frame: an equirectangular
 * half-float texture, updated a few times a second (more while something stretches or springs)
 * at well under the feed's resolution. Each texel holds:
 *
 * - r: glaze thickness (about 1 for a drip's stem), from which the surface pass gets coverage,
 *   by thresholding so edges stay crisp, opacity and the glaze's surface slope;
 * - g: thickness times freshness, so g / r is how fresh (opaque, white) the glaze there is;
 * - b: sheen, where glaze is or has lately been, left glossy on the pudding as it fades;
 * - a: a soft halo round the glaze, for the shade under its raised edge.
 *
 * One pass draws the cap and the pool round the bottom pole over every texel; then each drip is
 * a quad over its own latitudes and longitudes, its shape worked out from 3D directions (so the
 * poles and the seam are clean), max-blended in. Only the texels a drip covers do its work.
 */
import {
  CustomBlending,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  MaxEquation,
  Mesh,
  NearestFilter,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  BufferAttribute,
  ClampToEdgeWrapping,
  WebGLRenderTarget,
  Vector2,
  Vector4,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { type DripShape, EDGE_N, type Glaze, MAX_DRIPS, TOP_OVERLAP } from "./glaze";
import { EQ_GLSL, QUAD_VERTEX } from "./glsl";

/** Rounding width of the cap's edge, radians. */
const CAP_ROUND = 0.03;
/** Reach of the halo beyond the glaze, radians. */
const HALO = 0.03;
const MARGIN = 0.06;
/** Latitude below which a drip's quad is drawn separately, being wide there. */
const SPLIT = -0.9;

const CAP_FRAGMENT = /* glsl */ `
${EQ_GLSL}
uniform sampler2D uEdge;
uniform float uCapFresh;
uniform vec2 uWave;
uniform vec4 uPool;
uniform float uThick;
uniform vec4 uMouth[${MAX_DRIPS}];
uniform int uMouths;
varying vec2 vUv;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

vec4 edgeAt(float x) {
  float s = x * ${EDGE_N}.0 - 0.5;
  float i = floor(s);
  float t = s - i;
  int a = int(mod(i, ${EDGE_N}.0));
  int b = int(mod(i + 1.0, ${EDGE_N}.0));
  return mix(texelFetch(uEdge, ivec2(a, 0), 0), texelFetch(uEdge, ivec2(b, 0), 0), t);
}

void main() {
  float lon = vUv.x * 2.0 * EQ_PI - EQ_PI;
  float lat = vUv.y * EQ_PI - 0.5 * EQ_PI;
  vec4 E = edgeAt(vUv.x);
  // A finer wander along the ridge than the samples hold, in whole waves round the pudding so
  // it joins at the seam.
  float edge = E.r + 0.022 * sin(5.0 * lon + 1.3 + 0.8 * sin(2.0 * lon))
    + 0.011 * sin(13.0 * lon + 0.4 + 1.1 * sin(3.0 * lon)) + 0.004 * sin(31.0 * lon + 2.1 + sin(7.0 * lon));
  // Where a drip leaves the cap the glaze flows over the edge: cap and drip share one outline,
  // flared where they meet, and the lip runs round the drip instead of across it. Each mouth is
  // the top of a drip's stem, which wanders as the drip's own quad draws it.
  float d = edge - lat;
  float below = 0.0;
  if (d > -0.06 && d < 0.14) {
    vec3 p = latLonDir(lat, lon);
    for (int i = 0; i < ${MAX_DRIPS}; i++) {
      if (i >= uMouths) break;
      vec4 M = uMouth[i];
      float dl = abs(mod(lon - M.x + EQ_PI, 2.0 * EQ_PI) - EQ_PI) * cos(lat);
      if (dl > 3.0 * M.y + 0.1) continue;
      float wander = M.z * (0.55 * sin(lat * 7.0 + M.x * 5.3) + 0.3 * sin(lat * 17.0 + M.x * 2.1));
      float x = asin(clamp(dot(p, vec3(cos(M.x), 0.0, -sin(M.x))), -1.0, 1.0)) - wander;
      float y = clamp(lat, edge - 0.12, edge + 0.05);
      float dm = length(vec2(x, lat - y)) - M.y * (1.0 - 0.15 * smoothstep(edge, edge - 0.12, lat));
      float joined = smin(d, dm + (1.0 - M.w) * 0.1, 0.05);
      if (joined < d) below = max(below, M.w * smoothstep(0.02, -0.02, dm));
      d = joined;
    }
  }
  float into = -d;
  float e = clamp(into / ${CAP_ROUND}, 0.0, 1.0);
  // Gentle undulations left by the pour.
  float c = cos(lat);
  float wave = sin(6.0 * lon + 9.0 * lat + 2.0 * sin(3.0 * lon)) * sin(4.0 * lon - 7.0 * lat + 1.0);
  float ripple = sin(17.0 * lon + 23.0 * lat + 1.5 * sin(5.0 * lon - 3.0 * lat));
  float body = uThick * (0.95 + 0.4 * smoothstep(edge, 1.35, lat)) * (1.0 + c * (0.12 * wave + 0.04 * ripple));
  body += 0.75 * uThick * uWave.y * exp(-pow((lat - uWave.x) / 0.09, 2.0));
  float rim = uThick * (0.16 + 0.3 * E.b) * exp(-pow((into - 0.45 * ${CAP_ROUND}) / (0.3 * ${CAP_ROUND}), 2.0));
  float h = into > 0.0 ? body * sqrt(1.0 - (1.0 - e) * (1.0 - e)) + rim : 0.0;
  // Down a drip's mouth the cap gives way to the drip's own shape.
  if (lat < edge) h *= 1.0 - smoothstep(0.03, 0.1, edge - lat) * max(below, step(0.0, -d));
  float fresh = uCapFresh * mix(0.85, 1.0, smoothstep(0.0, 0.25, into));
  float sheen = smoothstep(E.g - 0.012, E.g + 0.004, lat);
  float halo = exp(-max(d, 0.0) / ${HALO});

  // The puddle round the bottom pole.
  float theta = lat + 0.5 * EQ_PI;
  if (uPool.x > 0.0) {
    float r = uPool.x;
    float ep = clamp((r - theta) / 0.025, 0.0, 1.0);
    float hp = theta < r ? uPool.z * (0.95 * sqrt(1.0 - (1.0 - ep) * (1.0 - ep)) + 0.22 * exp(-pow((r - theta - 0.011) / 0.007, 2.0))) : 0.0;
    if (hp > h) {
      h = hp;
      fresh = uPool.y;
    }
    sheen = max(sheen, smoothstep(r + 0.03, r, theta));
    halo = max(halo, exp(-max(theta - r, 0.0) / ${HALO}));
  }
  gl_FragColor = vec4(h, h * fresh, sheen, halo);
}
`;

const DRIP_VERTEX = /* glsl */ `
attribute vec4 aBox;
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute float aSheen;
varying vec2 vLL;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
varying float vSheen;
void main() {
  float lon = mix(aBox.x, aBox.y, position.x);
  float lat = mix(aBox.z, aBox.w, position.y);
  vLL = vec2(lon, lat);
  vA = aA;
  vB = aB;
  vC = aC;
  vSheen = aSheen;
  gl_Position = vec4(lon / 3.141592653589793, lat / 1.5707963267948966, 0.0, 1.0);
}
`;

const DRIP_FRAGMENT = /* glsl */ `
${EQ_GLSL}
uniform float uHalo;
varying vec2 vLL;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
varying float vSheen;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

void main() {
  vec3 p = latLonDir(vLL.y, vLL.x);
  float lon0 = vA.x;
  float top = vA.y;
  float tip = vA.z;
  float beadLat = vA.w;
  float w0 = vB.x;
  float w1 = vB.y;
  float rb = vB.z;
  float rbA = vB.w;
  float wn = vC.x;
  float hs = vC.y;
  float hb = vC.z;
  float fresh = vC.w;
  // Across: the angle from the drip's meridian plane; along: the angle within that plane, which
  // carries on smoothly through the poles.
  vec3 east = vec3(cos(lon0), 0.0, -sin(lon0));
  vec3 out_ = vec3(sin(lon0), 0.0, cos(lon0));
  float y = atan(p.y, dot(p, out_));
  // Drips wander a little from the straight line down.
  float wander = w1 * (0.55 * sin(y * 7.0 + lon0 * 5.3) + 0.3 * sin(y * 17.0 + lon0 * 2.1));
  float x = asin(clamp(dot(p, east), -1.0, 1.0)) - wander;

  float span = max(top - tip, 1e-4);
  float u = clamp((y - tip) / span, 0.0, 1.0);
  // Tapering down the stem, a little uneven, flaring where it leaves the cap.
  // Where the drip leaves the cap's edge it widens into it, and above the edge it thins under
  // the cap, so the two join without a seam.
  float edge = top - ${TOP_OVERLAP};
  // The cap draws where the drip leaves it; above the edge the drip thins away under the cap.
  float w = mix(w1, w0, u) * (1.0 + 0.05 * sin(y * 41.0 + lon0 * 17.0));
  hs *= (1.0 - 0.6 * smoothstep(edge - 0.01, top, y)) * (1.0 - 0.15 * smoothstep(edge - 0.1, edge, y));
  float dStem;
  if (y > top) dStem = length(vec2(x, y - top)) - w0 * 1.35;
  else if (y < tip) dStem = length(vec2(x, y - tip)) - w1;
  else dStem = abs(x) - w;
  vec2 q = vec2(x / rb, (y - beadLat) / rbA);
  float qq = dot(q, q);
  float dBead = (sqrt(qq) - 1.0) * min(rb, rbA);
  float d = smin(dStem, dBead, 0.45 * w1);
  if (wn > 0.0) {
    float ty = clamp(y, beadLat, tip);
    d = smin(d, length(vec2(x, y - ty)) - wn, 0.3 * w1);
  }
  // Round across, like a rivulet's section, with a slightly raised rim.
  float rho = max(w, 1e-4);
  float e = clamp(-d / rho, 0.0, 1.0);
  float h = d < 0.0 ? hs * sqrt(1.0 - (1.0 - e) * (1.0 - e)) : 0.0;
  // The raised rim along the edges.
  h += d < 0.0 ? 0.14 * hs * exp(-pow((-d - 0.12 * rho) / (0.08 * rho), 2.0)) : 0.0;
  // The bead's dome.
  float hd = qq < 1.0 ? hb * sqrt(1.0 - qq) : 0.0;
  h = max(h, hd);
  float halo = exp(-max(d, 0.0) / uHalo) * min(1.0, 1.5 * hs);
  gl_FragColor = vec4(h, h * fresh, vSheen * smoothstep(0.012, -0.004, d), halo);
}
`;

export interface GlazeField {
  readonly texture: WebGLRenderTarget["texture"];
  readonly size: Vector2;
  /** Draw the glaze as it is now. */
  update(g: Glaze): void;
  /** Size the field for a feed with this many rows. */
  resize(rows: number): void;
  dispose(): void;
}

const fieldRows = (rows: number) => {
  const want = rows * 0.42;
  let h = 128;
  while (h < want && h < 1024) h *= 2;
  return h;
};

export const createGlazeField = (r3d: Renderer3D, rows: number, thick: number): GlazeField => {
  let h = fieldRows(rows);
  const target = new WebGLRenderTarget(2 * h, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const size = new Vector2(2 * h, h);

  const edgeData = new Float32Array(EDGE_N * 4);
  const edgeTex = new DataTexture(edgeData, EDGE_N, 1, RGBAFormat, FloatType);
  edgeTex.minFilter = NearestFilter;
  edgeTex.magFilter = NearestFilter;
  edgeTex.generateMipmaps = false;
  edgeTex.needsUpdate = true;

  const capU = {
    uEdge: { value: edgeTex },
    uCapFresh: { value: 1 },
    uWave: { value: new Vector2() },
    uPool: { value: new Vector4() },
    uThick: { value: thick },
    uMouth: { value: Array.from({ length: MAX_DRIPS }, () => new Vector4()) },
    uMouths: { value: 0 },
  };
  const capMaterial = new ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: CAP_FRAGMENT,
    uniforms: capU,
    depthTest: false,
    depthWrite: false,
  });
  const capQuad = new PlaneGeometry(2, 2);
  const cap = new Mesh(capQuad, capMaterial);
  cap.frustumCulled = false;

  const instances = 4 * MAX_DRIPS;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const attr = (n: number) => {
    const a = new InstancedBufferAttribute(new Float32Array(instances * n), n);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const aBox = attr(4);
  const aA = attr(4);
  const aB = attr(4);
  const aC = attr(4);
  const aSheen = attr(1);
  geometry.setAttribute("aBox", aBox);
  geometry.setAttribute("aA", aA);
  geometry.setAttribute("aB", aB);
  geometry.setAttribute("aC", aC);
  geometry.setAttribute("aSheen", aSheen);
  geometry.instanceCount = 0;
  const dripMaterial = new ShaderMaterial({
    vertexShader: DRIP_VERTEX,
    fragmentShader: DRIP_FRAGMENT,
    uniforms: { uHalo: { value: HALO } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });
  const drips = new Mesh(geometry, dripMaterial);
  drips.frustumCulled = false;

  const scene = new Scene();
  scene.add(cap);
  scene.add(drips);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  r3d.prepare(scene, camera);

  const put = (
    a: InstancedBufferAttribute,
    i: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ) => {
    const arr = a.array as Float32Array;
    arr[i * 4] = x;
    arr[i * 4 + 1] = y;
    arr[i * 4 + 2] = z;
    arr[i * 4 + 3] = w;
  };

  return {
    texture: target.texture,
    size,
    update(g) {
      for (let i = 0; i < EDGE_N; i++) {
        edgeData[i * 4] = g.edge[i]!;
        edgeData[i * 4 + 1] = g.low[i]!;
        edgeData[i * 4 + 2] = g.ridge[i]!;
      }
      edgeTex.needsUpdate = true;
      capU.uCapFresh.value = g.capFresh;
      capU.uWave.value.set(g.wave.lat, g.wave.amount);
      const b = g.bottom();
      capU.uPool.value.set(b.radius, g.pool.fresh, b.radius > 0 ? thick * 0.9 : 0, 0);
      let mouths = 0;
      for (const d of g.drips) {
        if (mouths >= MAX_DRIPS) break;
        const s = g.shape(d);
        // A fading drip's mouth closes up again as it thins.
        const strength = Math.min(1, Math.max(0, (s.hs - 0.1) / 0.5));
        if (strength <= 0) continue;
        capU.uMouth.value[mouths++]!.set(s.lon, s.w0, s.w1, strength);
      }
      capU.uMouths.value = mouths;

      let n = 0;
      const quad = (s: DripShape, lat0: number, lat1: number, half: number) => {
        const c = Math.cos(Math.max(Math.abs(lat0), Math.abs(lat1)));
        const dl = c * Math.PI <= half ? Math.PI : Math.min(Math.PI, half / c);
        const shift = s.lon >= 0 ? -2 * Math.PI : 2 * Math.PI;
        for (const off of [0, shift]) {
          put(aBox, n, s.lon - dl + off, s.lon + dl + off, lat0, lat1);
          put(aA, n, s.lon, s.top, s.tip, s.beadLat);
          put(aB, n, s.w0, s.w1, s.rb, s.rbAlong);
          put(aC, n, s.wn, s.hs, s.hb, s.fresh);
          (aSheen.array as Float32Array)[n] = s.sheen;
          n++;
        }
      };
      for (const d of g.drips) {
        if (n + 4 > instances) break;
        const s = g.shape(d);
        if (s.hs <= 0.001 && s.sheen <= 0.001) continue;
        const lat0 = Math.max(-Math.PI / 2, s.beadLat - s.rbAlong - MARGIN);
        const lat1 = Math.min(Math.PI / 2, s.top + 0.12);
        const half = Math.max(1.8 * s.w0, s.rb, s.w1) + MARGIN;
        // Near the pole a drip spreads over many longitudes, so draw that part on its own and
        // keep the rest of the drip's quad narrow.
        if (lat0 < SPLIT && lat1 > SPLIT) {
          quad(s, lat0, SPLIT + 0.01, half);
          quad(s, SPLIT, lat1, half);
        } else {
          quad(s, lat0, lat1, half);
        }
      }
      geometry.instanceCount = n;
      for (const a of [aBox, aA, aB, aC, aSheen]) a.needsUpdate = true;

      const r = r3d.renderer;
      r.setRenderTarget(target);
      r.render(scene, camera);
      r.setRenderTarget(null);
    },
    resize(rows) {
      const nh = fieldRows(rows);
      if (nh === h) return;
      h = nh;
      target.setSize(2 * h, h);
      size.set(2 * h, h);
    },
    dispose() {
      target.dispose();
      edgeTex.dispose();
      capMaterial.dispose();
      capQuad.dispose();
      dripMaterial.dispose();
      geometry.dispose();
    },
  };
};
