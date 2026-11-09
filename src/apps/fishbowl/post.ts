/**
 * The wall's picture is drawn in linear light into a floating-point target, then finished here
 * as a camera would: bright glints bleed a soft glow into their surroundings (bloom, from a
 * chain of ever smaller copies blurred and added back up), a filmic curve brings the light into
 * range, colour is graded a touch, the corners darken slightly, and a little noise breaks up
 * banding in the dark water's smooth gradients.
 */
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  AdditiveBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Keep only what is brighter than the threshold, softly, and halve the size. */
const PREFILTER = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 tap(vec2 o) {
  return texture2D(uSrc, vUv + o * uTexel).rgb;
}
void main() {
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  // One bad pixel must not spread through the whole glow.
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = min(c, vec3(40.0));
  float l = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float k = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

/** Halve again with a small box, which blurs as it goes. */
const DOWN = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb * 0.5;
  c += texture2D(uSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb * 0.125;
  c += texture2D(uSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb * 0.125;
  c += texture2D(uSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb * 0.125;
  c += texture2D(uSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb * 0.125;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Spread a smaller level back up with a tent filter, added onto the one above. */
const UP = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
  c += texture2D(uSrc, vUv + vec2(-1.0, 0.0) * uTexel).rgb * 2.0;
  c += texture2D(uSrc, vUv + vec2(1.0, 0.0) * uTexel).rgb * 2.0;
  c += texture2D(uSrc, vUv + vec2(0.0, -1.0) * uTexel).rgb * 2.0;
  c += texture2D(uSrc, vUv + vec2(0.0, 1.0) * uTexel).rgb * 2.0;
  c += texture2D(uSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(uSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  c += texture2D(uSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  c += texture2D(uSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  gl_FragColor = vec4(c / 16.0 * uWeight, 1.0);
}
`;

const FINISH = /* glsl */ `
uniform sampler2D uHdr;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uBloomOn;
uniform vec2 uSize;
varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 c = texture2D(uHdr, vUv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  if (uBloomOn > 0.5) c += texture2D(uBloom, vUv).rgb * uBloomStrength;
  c = aces(c * uExposure);
  // A little more body in the colours, as a camera's picture has.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.08);
  c = clamp((c - 0.5) * 1.04 + 0.5, 0.0, 1.0);
  // Corners a touch darker.
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.18 * dot(q * vec2(0.9, 1.6), q * vec2(0.9, 1.6));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  // Noise below one step of an 8-bit channel, so dark gradients don't band.
  vec2 p = vUv * uSize;
  float n = fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5;
  gl_FragColor.rgb += n / 255.0;
}
`;

export interface Post {
  /** Draw the scene into this, then call `finish`. */
  readonly target: WebGLRenderTarget;
  resize(width: number, height: number): void;
  /** Bloom, tone map and grade the target onto the canvas. */
  finish(): void;
  dispose(): void;
}

export interface PostOptions {
  /** Multisampling for the scene target (0 off). */
  samples: number;
  bloom: boolean;
  exposure: number;
}

const LEVELS = 6;

export const createPost = (renderer: WebGLRenderer, opts: PostOptions): Post => {
  const make = (samples = 0) =>
    new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: samples >= 0,
      samples: Math.max(0, samples),
    });
  const target = make(opts.samples);
  const levels = Array.from({ length: LEVELS }, () => {
    const t = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    return t;
  });

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const pass = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
    new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
  const prefilter = pass(PREFILTER, {
    uSrc: { value: null },
    uTexel: { value: new Vector2() },
    uThreshold: { value: 0.9 },
  });
  const down = pass(DOWN, { uSrc: { value: null }, uTexel: { value: new Vector2() } });
  const up = pass(UP, {
    uSrc: { value: null },
    uTexel: { value: new Vector2() },
    uWeight: { value: 1 },
  });
  up.blending = AdditiveBlending;
  up.transparent = true;
  const finish = pass(FINISH, {
    uHdr: { value: target.texture },
    uBloom: { value: levels[0]!.texture },
    uBloomStrength: { value: 0.32 },
    uExposure: { value: opts.exposure },
    uBloomOn: { value: opts.bloom ? 1 : 0 },
    uSize: { value: new Vector2(1, 1) },
  });

  const draw = (material: ShaderMaterial, out: WebGLRenderTarget | null) => {
    quad.material = material;
    renderer.setRenderTarget(out);
    renderer.render(scene, camera);
  };
  const texel = (t: Texture | WebGLRenderTarget, v: Vector2) => {
    const w = (t as WebGLRenderTarget).width ?? 1;
    const h = (t as WebGLRenderTarget).height ?? 1;
    return v.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  };

  return {
    target,
    resize(width, height) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      target.setSize(w, h);
      levels.forEach((l, i) => l.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
      (finish.uniforms.uSize!.value as Vector2).set(w, h);
    },
    finish() {
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      if (opts.bloom) {
        prefilter.uniforms.uSrc!.value = target.texture;
        texel(target, prefilter.uniforms.uTexel!.value as Vector2);
        renderer.setRenderTarget(levels[0]!);
        renderer.clear();
        draw(prefilter, levels[0]!);
        for (let i = 1; i < LEVELS; i++) {
          down.uniforms.uSrc!.value = levels[i - 1]!.texture;
          texel(levels[i - 1]!, down.uniforms.uTexel!.value as Vector2);
          draw(down, levels[i]!);
        }
        for (let i = LEVELS - 1; i > 0; i--) {
          up.uniforms.uSrc!.value = levels[i]!.texture;
          texel(levels[i]!, up.uniforms.uTexel!.value as Vector2);
          up.uniforms.uWeight!.value = 1;
          draw(up, levels[i - 1]!);
        }
      }
      draw(finish, null);
      renderer.autoClear = autoClear;
    },
    dispose() {
      target.dispose();
      for (const l of levels) l.dispose();
      for (const m of [prefilter, down, up, finish]) m.dispose();
      quad.geometry.dispose();
    },
  };
};
