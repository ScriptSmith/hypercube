/**
 * The iris's structure, generated once on the GPU into textures in polar coordinates: columns
 * once round the pupil (as `atan(y, x)` in the eye's frame goes from -π to π), rows from the
 * pupil's margin (0) to the iris root at the limbus (1) for a pupil at rest. The surface shader
 * stretches the rows as the pupil changes, and colours them, so one structure serves every
 * colour.
 *
 * What it draws, checked against close-up photographs: radial fibres and the
 * coarser trabeculae of the ciliary zone, which wave along their length and interlace, over a
 * fine spongy grain; finer straight striations in the pupillary zone; the collarette, a jagged
 * raised ring about a third of the way out, with the pupillary zone's own colour gathered along
 * it in spikes and patches rather than filling a disc; Fuchs crypts, deep lens-shaped holes with
 * lighter rims, mostly just outside the collarette and some near the root; broken, wandering
 * circular contraction furrows in the outer ciliary zone; irregular freckles, more of them low.
 * Texture A holds fibre lightness, crypt depth, furrows and the pupillary zone's colour; texture
 * B holds freckles, the slope of the surface for shading, and an uneven pattern round the pupil
 * for its ruff.
 */
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";

export const IRIS_TEX = { width: 4096, height: 1024 };

/**
 * The texture's size for a feed `feedWidth` pixels round: about as many columns as there are
 * pixels round the iris's middle at the full feed, fewer for a small frame such as a preview, so
 * it isn't drawn at a size it can't show.
 */
export const irisTexSize = (feedWidth: number): { width: number; height: number } => {
  const want = 2 ** Math.ceil(Math.log2(Math.max(1, feedWidth * 0.72)));
  const width = Math.max(1024, Math.min(IRIS_TEX.width, want));
  return { width, height: width / 4 };
};

/** The pupil the textures are drawn for, as a fraction of the iris radius (about 4.2 mm). */
export const REST_PUPIL = 0.36;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NOISE = /* glsl */ `
uint mixBits(uint h) {
  h ^= h >> 16;
  h *= 0x7a3f2c95u;
  h ^= h >> 13;
  h *= 0x51d8e3b7u;
  h ^= h >> 16;
  return h;
}
uint hash3(ivec3 p, uint seed) {
  uvec3 q = uvec3(p);
  return mixBits(q.x * 0x2d9c4f61u ^ mixBits(q.y * 0x9b1e6a3du ^ mixBits(q.z * 0x63f0c8a5u ^ seed)));
}
vec3 grad3(uint h) {
  vec3 g = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 511.5 - 1.0;
  return normalize(g + 1e-4);
}
float rand(ivec3 p, uint seed) {
  return float(hash3(p, seed) & 0xffffu) / 65535.0;
}
// Gradient noise, about -1 to 1.
float gnoise(vec3 p, uint seed) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float n000 = dot(grad3(hash3(c, seed)), f);
  float n100 = dot(grad3(hash3(c + ivec3(1, 0, 0), seed)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(grad3(hash3(c + ivec3(0, 1, 0), seed)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(grad3(hash3(c + ivec3(1, 1, 0), seed)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(grad3(hash3(c + ivec3(0, 0, 1), seed)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(grad3(hash3(c + ivec3(1, 0, 1), seed)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(grad3(hash3(c + ivec3(0, 1, 1), seed)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(grad3(hash3(c + ivec3(1, 1, 1), seed)), f - vec3(1.0, 1.0, 1.0));
  return 2.0 * mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
// Noise round the circle at angle phi with 'k' features once round, varying along 'z'.
float ring(float phi, float k, float z, uint seed) {
  float r = k / 6.2831853;
  return gnoise(vec3(r * cos(phi), r * sin(phi), z), seed);
}
`;

const FIELDS = /* glsl */ `
uniform float uRest;
uniform uint uSeed;
const float TAU = 6.2831853;

// Depth of the nearest crypt in a ring of cells, 0 to 1, and the lighter rim round its mouth.
float crypts(float phi, float rr, float rc, uint seed, out float rim) {
  float cells = 40.0;
  float rows = 9.0;
  vec2 p = vec2(phi / TAU * cells, (rr - uRest) / (1.0 - uRest) * rows);
  vec2 cell = floor(p);
  float best = 0.0;
  rim = 0.0;
  // Crypts reach almost three rows along the radius, so look that far.
  for (int j = -3; j <= 3; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      if (c.y < 0.0 || c.y >= rows) continue;
      ivec3 id = ivec3(int(mod(c.x, cells)), int(c.y), 7);
      float h0 = rand(id, seed);
      float h1 = rand(id + ivec3(0, 0, 1), seed);
      float h2 = rand(id + ivec3(0, 0, 2), seed);
      float h3 = rand(id + ivec3(0, 0, 3), seed);
      vec2 centre = c + vec2(0.25 + 0.5 * h0, 0.25 + 0.5 * h1);
      float crr = uRest + centre.y / rows * (1.0 - uRest);
      // Crypts gather just outside the collarette, with smaller ones near the root.
      float chance = 0.75 * exp(-pow((crr - (rc + 0.06)) / 0.08, 2.0))
        + 0.35 * exp(-pow((crr - 0.88) / 0.05, 2.0)) + 0.05;
      if (h2 > chance) continue;
      float size = mix(0.35, 0.9, h3) * (crr > 0.8 ? 0.55 : 1.0);
      // Lens-shaped: long along the radius, pointed at both ends, the outline a little uneven.
      vec2 d = (p - centre) * vec2(1.0, 0.45);
      float wob = min(1.15, 1.0 + 0.18 * gnoise(vec3(p * 3.0, h3 * 9.0), seed));
      float dist = (abs(d.x) + 0.6 * d.y * d.y / max(0.05, size)) / (size * wob);
      // Steep walls round a deep floor.
      best = max(best, 1.0 - smoothstep(0.55, 0.78, dist));
      rim = max(rim, exp(-pow((dist - 0.86) / 0.11, 2.0)));
    }
  }
  rim *= 1.0 - best;
  return best;
}

// Freckles: irregular blotches of pigment, more of them on the lower half.
float freckles(float phi, float rr, uint seed) {
  float cells = 11.0;
  float rows = 3.0;
  vec2 p = vec2(phi / TAU * cells, (rr - uRest) / (1.0 - uRest) * rows);
  vec2 cell = floor(p);
  float best = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      ivec3 id = ivec3(int(mod(c.x, cells)), int(c.y), 31);
      float at = (c.x + 0.5) / cells * TAU;
      if (rand(id, seed) > 0.1 + 0.09 * (0.5 - 0.5 * sin(at))) continue;
      vec2 centre = c + vec2(0.25 + 0.5 * rand(id + ivec3(0, 0, 1), seed),
                             0.25 + 0.5 * rand(id + ivec3(0, 0, 2), seed));
      float size = mix(0.07, 0.24, pow(rand(id + ivec3(0, 0, 3), seed), 1.5));
      float wob = 1.0 + 0.4 * gnoise(vec3(p * 5.0, 1.0), seed) + 0.18 * gnoise(vec3(p * 14.0, 2.0), seed);
      float dist = length((p - centre) * vec2(1.0, 0.8)) / (size * max(0.4, wob));
      best = max(best, 1.0 - smoothstep(0.78, 1.0, dist));
    }
  }
  return best;
}

// The stroma's spongy grain: distances to the nearest two points in a polar grid of cells.
vec2 pores(float phi, float rr, float n, float rows, uint seed) {
  vec2 p = vec2(phi / TAU * n, rr * rows);
  vec2 cell = floor(p);
  float f1 = 9.0;
  float f2 = 9.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      ivec3 id = ivec3(int(mod(c.x, n)), int(c.y), 41);
      vec2 o = c + vec2(rand(id, seed), rand(id + ivec3(0, 0, 1), seed));
      float dd = length(p - o);
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
      } else if (dd < f2) {
        f2 = dd;
      }
    }
  }
  return vec2(f1, f2);
}

// Low-frequency noise in the iris's flat plane, so patches don't line up with the polar grid.
float plane(float phi, float rr, float k, uint seed) {
  return gnoise(vec3(cos(phi) * rr * k, sin(phi) * rr * k, 0.37 * k), seed);
}

// light, crypt, furrow, centre in a; freckle, height, ruff in b.
void irisFields(float phi, float s, out vec4 a, out vec4 b) {
  float rr = uRest + s * (1.0 - uRest);
  uint sd = uSeed;
  // The collarette: a jagged, irregular ring about a third of the way out.
  float rc = uRest + 0.33 * (1.0 - uRest)
    + 0.03 * ring(phi, 4.0, 0.0, sd + 1u)
    + 0.022 * ring(phi, 26.0, 0.0, sd + 2u)
    + 0.018 * ring(phi, 70.0, 0.0, sd + 19u)
    + 0.009 * ring(phi, 120.0, 0.0, sd + 3u);
  float inner = 1.0 - smoothstep(rc - 0.006, rc + 0.008, rr);
  // Trabeculae: raised strands running out from the collarette, interlacing a little and
  // waving along their length as the strands of light irises do.
  float warp = 0.016 * ring(phi, 23.0, rr * 3.0, sd + 4u) + 0.007 * ring(phi, 71.0, rr * 8.0, sd + 5u);
  float crimp = sin(rr * 110.0 + 9.0 * ring(phi, 18.0, 0.0, sd + 23u))
    * (0.55 + 0.45 * ring(phi, 11.0, rr * 2.0, sd + 24u));
  float pw = phi + warp * (1.0 - 0.7 * inner) + 0.006 * crimp * (1.0 - inner);
  float coarse = 1.0 - abs(ring(pw, 54.0, rr * 3.0, sd + 6u));
  float mid = 1.0 - abs(ring(pw + 0.5 * warp, 150.0, rr * 7.0, sd + 7u));
  float fine = 1.0 - abs(ring(pw, 420.0, rr * 16.0, sd + 8u));
  float grain = ring(phi, 1000.0, rr * 300.0, sd + 17u);
  // Cords: smooth strands lying side by side, bending slowly, broken along their length.
  float cordA = pow(0.5 + 0.5 * cos(pw * 72.0 + 2.5 * ring(phi, 13.0, rr * 1.5, sd + 34u)), 3.0);
  float cordB = pow(0.5 + 0.5 * cos(pw * 170.0 + 3.0 * ring(phi, 29.0, rr * 2.5, sd + 35u)), 4.0);
  float breakA = smoothstep(-0.4, 0.3, ring(pw, 72.0, rr * 9.0, sd + 36u));
  float strands = 0.4 * cordA * breakA + 0.25 * cordB * (0.6 + 0.4 * breakA)
    + 0.3 * pow(coarse, 4.0) + 0.1 * pow(fine, 4.0);
  // The spongy grain everywhere: a raised mesh round small pits, at two sizes.
  vec2 cBig = pores(pw, rr, 220.0, 70.0, sd + 30u);
  vec2 cSmall = pores(pw, rr, 560.0, 170.0, sd + 31u);
  float mesh = 0.6 * (1.0 - smoothstep(0.0, 0.3, cBig.y - cBig.x))
    + 0.4 * (1.0 - smoothstep(0.0, 0.3, cSmall.y - cSmall.x));
  float pit = 0.6 * (1.0 - smoothstep(0.05, 0.5, cBig.x)) + 0.4 * (1.0 - smoothstep(0.05, 0.5, cSmall.x));
  // The pupillary zone: finer, straighter striations.
  float striae = 1.0 - abs(ring(phi + 0.004 * ring(phi, 40.0, rr * 5.0, sd + 9u), 260.0, rr * 2.0, sd + 10u));
  float pz = 0.15 * pow(striae, 4.0) + 0.3 * pow(mid, 4.0) + 0.25 * pow(coarse, 4.0) + 0.15 * cordB;
  float mottled = 0.5 + 0.5 * plane(phi, rr, 5.0, sd + 18u);
  float light = mix(0.18 + 0.8 * strands, 0.25 + 0.55 * pz, inner);
  light *= 0.7 + 0.6 * mottled;
  light *= 0.82 + 0.3 * mesh - 0.25 * pit;
  light += 0.07 * grain;
  float ridge = exp(-pow((rr - rc) / 0.022, 2.0)) * (0.65 + 0.35 * mid);
  light = mix(light, 0.72 + 0.25 * fine, ridge * 0.65);
  // Near the root the stroma thins into the darker ring.
  light *= 1.0 - 0.3 * smoothstep(0.86, 0.99, rr);
  float rim;
  float c = crypts(phi, rr, rc, sd + 12u, rim) * (1.0 - 0.85 * inner);
  rim *= 1.0 - 0.85 * inner;
  // Trabeculae bridge across crypts, and the floor shows the deeper strands.
  c *= 1.0 - 0.8 * cordA * breakA;
  c *= 0.7 + 0.3 * smoothstep(0.2, 0.8, 1.0 - mid);
  light += 0.22 * rim;
  // Broken circular furrows in the outer ciliary zone, each wandering on its own, at uneven
  // spacing and width.
  float furrow = 0.0;
  float k0 = (rr - 0.69) / 0.065;
  float b0 = floor(k0 + 0.5);
  for (int i = -1; i <= 1; i++) {
    float fb = b0 + float(i);
    if (fb < 0.0 || fb > 4.0) continue;
    float at = 0.69 + fb * 0.065
      + 0.018 * ring(phi, 9.0, fb * 2.3, sd + 13u)
      + 0.008 * ring(phi, 23.0, fb * 1.7, sd + 25u);
    float w = 0.005 + 0.006 * (0.5 + 0.5 * ring(phi, 14.0, fb * 3.1, sd + 26u));
    float arcs = smoothstep(-0.05, 0.4, ring(phi, 5.0 + fb, fb * 3.1, sd + 14u));
    furrow = max(furrow, (1.0 - smoothstep(w * 0.4, w, abs(rr - at))) * arcs);
  }
  furrow *= smoothstep(0.66, 0.72, rr) * (1.0 - smoothstep(0.95, 0.98, rr));
  // The pupillary zone's own colour gathers along the collarette and reaches out past it in
  // spikes of uneven length, in patches round the ring; it rarely fills an even disc.
  float jag = 0.6 * ring(phi, 48.0, 0.0, sd + 20u) + 0.4 * ring(phi, 130.0, 0.4, sd + 21u);
  float reach = 0.01 + 0.2 * pow(clamp(0.45 + 0.75 * jag, 0.0, 1.0), 2.5);
  float spike = 1.0 - smoothstep(rc + 0.6 * reach - 0.01, rc + reach, rr);
  float band = exp(-pow((rr - rc + 0.025) / 0.07, 2.0));
  float patches = smoothstep(-0.35, 0.55, ring(phi, 7.0, 0.7, sd + 22u) + 0.4 * plane(phi, rr, 9.0, sd + 15u));
  // In radial streaks and clumps, as pigment lies along the tissue.
  float rays = 0.6 * smoothstep(-0.2, 0.6, ring(phi, 80.0, rr * 4.0, sd + 32u))
    + 0.4 * smoothstep(-0.3, 0.5, ring(phi, 33.0, rr * 2.0, sd + 33u));
  float centre = spike * mix(0.4, 1.0, band) * mix(0.3, 1.0, patches) * mix(0.45, 1.0, rays);
  centre *= 0.75 + 0.25 * mottled;
  float freck = freckles(phi, rr, sd + 16u);
  float height = 0.45 + 0.3 * strands + 0.22 * ridge - 0.3 * c + 0.08 * rim - 0.18 * furrow
    + 0.08 * pz * inner + 0.06 * mesh - 0.05 * pit;
  // An uneven pattern round the pupil for its ruff, the same in every row.
  float ruff = clamp(0.5 + 0.35 * ring(phi, 45.0, 0.0, sd + 27u) + 0.3 * ring(phi, 130.0, 0.0, sd + 28u), 0.0, 1.0);
  a = vec4(clamp(light, 0.0, 1.0), clamp(c, 0.0, 1.0), clamp(furrow, 0.0, 1.0), clamp(centre, 0.0, 1.0));
  b = vec4(freck, clamp(height, 0.0, 1.0), ruff, 1.0);
}
`;

const FIELD_PASS = /* glsl */ `
${NOISE}
${FIELDS}
uniform int uOut;
varying vec2 vUv;
void main() {
  vec4 a;
  vec4 b;
  irisFields((vUv.x - 0.5) * TAU, vUv.y, a, b);
  gl_FragColor = uOut == 0 ? a : b;
}
`;

// The slope of the height field, for shading; freckles and the ruff's pattern carried through.
const SLOPE_PASS = /* glsl */ `
uniform sampler2D uFields;
uniform vec2 uTexel;
uniform float uSlope;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uFields, vUv);
  float hx = texture2D(uFields, vUv + vec2(uTexel.x, 0.0)).g - texture2D(uFields, vUv - vec2(uTexel.x, 0.0)).g;
  float hy = texture2D(uFields, vUv + vec2(0.0, uTexel.y)).g - texture2D(uFields, vUv - vec2(0.0, uTexel.y)).g;
  gl_FragColor = vec4(c.r, clamp(0.5 + uSlope * hx, 0.0, 1.0), clamp(0.5 + uSlope * hy, 0.0, 1.0), c.b);
}
`;

export interface IrisTextures {
  /** Fibres, crypts, furrows, pupillary zone. */
  readonly a: WebGLRenderTarget;
  /** Freckles, slope round, slope outward, the ruff's pattern. */
  readonly b: WebGLRenderTarget;
  /** The tissue's height in green, with mipmaps, for depth in the shader. */
  readonly height: WebGLRenderTarget;
  /** True once drawn into the current context. */
  readonly done: boolean;
  /** Draw them, once the renderer is ready. */
  draw(): void;
  /** The context was lost and came back: draw again. */
  invalidate(): void;
  dispose(): void;
}

export const createIrisTextures = (
  r3d: Renderer3D,
  seed: number,
  size: { width: number; height: number } = IRIS_TEX,
): IrisTextures => {
  const { width, height } = size;
  const target = (mips: boolean) =>
    new WebGLRenderTarget(width, height, {
      depthBuffer: false,
      generateMipmaps: mips,
      minFilter: mips ? LinearMipmapLinearFilter : LinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
    });
  const a = target(true);
  const b = target(true);
  const raw = target(true);
  const fields = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FIELD_PASS,
    uniforms: { uRest: { value: REST_PUPIL }, uSeed: { value: seed >>> 0 }, uOut: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const slope = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: SLOPE_PASS,
    uniforms: {
      uFields: { value: raw.texture },
      uTexel: { value: [1 / width, 1 / height] },
      // The same slope for a feature at any size of texture.
      uSlope: { value: (3.2 * width) / IRIS_TEX.width },
    },
    depthTest: false,
    depthWrite: false,
  });
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new PlaneGeometry(2, 2);
  const fieldScene = new Scene();
  const fieldQuad = new Mesh(geometry, fields);
  fieldQuad.frustumCulled = false;
  fieldScene.add(fieldQuad);
  const slopeScene = new Scene();
  const slopeQuad = new Mesh(geometry, slope);
  slopeQuad.frustumCulled = false;
  slopeScene.add(slopeQuad);
  r3d.prepare(fieldScene, camera);
  r3d.prepare(slopeScene, camera);
  let done = false;

  return {
    a,
    b,
    height: raw,
    get done() {
      return done;
    },
    draw() {
      if (done || !r3d.ready) return;
      const r = r3d.renderer;
      fields.uniforms.uOut!.value = 0;
      r.setRenderTarget(a);
      r.render(fieldScene, camera);
      fields.uniforms.uOut!.value = 1;
      r.setRenderTarget(raw);
      r.render(fieldScene, camera);
      r.setRenderTarget(b);
      r.render(slopeScene, camera);
      r.setRenderTarget(null);
      done = true;
    },
    invalidate() {
      done = false;
    },
    dispose() {
      a.dispose();
      b.dispose();
      raw.dispose();
    },
  };
};
