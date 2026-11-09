/**
 * The simulated views, on the frame's three.js renderer. Three passes:
 *
 * 1. Prepare: each scene layer's picture (sRGB, premultiplied) becomes linear light in a
 *    half-float target with mipmaps, with the night lamps added brighter than white, so their
 *    out-of-focus discs keep their light. Once per size and day or night.
 * 2. Blur: each layer is averaged over its kernel's taps (kernel.ts: a disc, an ellipse or a
 *    comet), sampling a texture level matched to the taps' spacing, and the layers are laid
 *    over each other far to near. Only when a kernel changes.
 * 3. Effects, every frame, into the view's rectangle: cataract straylight (a veil built from
 *    equal-weight octaves of the picture, which falls off as 1/θ² as the CIE 146:2002 glare
 *    function does), haloes and a slight fade; soft blurred or faded patches for glaucoma in
 *    an arc that keeps to one side of the horizontal midline with the centre clear; central
 *    blur, waves or filled-in detail for macular degeneration; blur that comes and goes for
 *    diabetic retinopathy; a colour matrix for colour vision deficiency; then sRGB out.
 *
 * Programs are raw GLSL ES 3.0, so one program serves render targets and the screen alike, and
 * every pass is handed to `prepare` before anything draws.
 */
import {
  ClampToEdgeWrapping,
  CanvasTexture,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
  Matrix3,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { type Kernel, MAX_TAPS } from "./kernel";
import { drawScene, type Layer, MAX_LAMPS, type SceneArt } from "./scene";

export interface ViewRect {
  /** Stage CSS px, top left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Effects {
  /** Share of light scattered into the veil (cataract, keratoconus glare), 0 to 0.5. */
  veil: number;
  /** Haloes round bright lights, 0 to 1. */
  halo: number;
  /** Slight extra blur from a cloudy lens, degrees. */
  haze: number;
  /** 0 full colour to 1 grey; kept small (cataract: "less colourful"). */
  fade: number;
  /** Multiplier on linear RGB, close to white (a slight warm tint at most). */
  tint: readonly [number, number, number];
  glaucoma: number;
  /** 0 what the person may notice, 1 what an eye test maps. */
  glaucomaMap: number;
  amd: number;
  /** 0 blurry, 1 wavy, 2 parts missing. */
  amdMode: number;
  /** Central blur strength now (diabetic retinopathy, comes and goes). */
  dr: number;
  floaters: number;
  /** Linear RGB matrix, rows top to bottom. */
  cvd: readonly number[];
}

export const NO_EFFECTS: Effects = {
  veil: 0,
  halo: 0,
  haze: 0,
  fade: 0,
  tint: [1, 1, 1],
  glaucoma: 0,
  glaucomaMap: 0,
  amd: 0,
  amdMode: 0,
  dr: 0,
  floaters: 0,
  cvd: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

export interface ViewDraw {
  slot: number;
  rect: ViewRect;
  /** far, mid, near. */
  kernels: readonly [Kernel, Kernel, Kernel];
  /** A key for the kernels; the blur reruns when it changes. */
  key: string;
  night: boolean;
  /** Where the eye looks, fractions from the top left. */
  fix: readonly [number, number];
  effects: Effects;
  time: number;
}

export interface Sight {
  readonly fov: number;
  /** Draw the views (the renderer's default target, scissored). */
  draw(views: readonly ViewDraw[], frameH: number): void;
  /** Where the eye looks in a view of this size, from its picture. */
  fixFor(width: number, height: number, night: boolean, looking: "near" | "far"): [number, number];
  /** Forget everything on the GPU that a lost context took (targets are rebuilt on use). */
  invalidate(): void;
  /** Composite blur passes run so far, for tests. */
  readonly blurs: number;
  dispose(): void;
}

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const PREP = /* glsl */ `
precision highp float;
uniform sampler2D uArt;
uniform vec2 uSize;
uniform int uLamps;
uniform vec4 uLamp[${MAX_LAMPS}];
uniform vec4 uLampRgb[${MAX_LAMPS}];
in vec2 vUv;
out vec4 outColor;
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  vec4 c = texture(uArt, vUv);
  vec3 enc = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  vec3 lin = toLinear(clamp(enc, 0.0, 1.0)) * c.a;
  float a = c.a;
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uLamps) break;
    float d = length(px - uLamp[i].xy) / max(1.0, uLamp[i].z);
    float m = 1.0 - smoothstep(0.7, 1.0, d);
    lin += uLampRgb[i].rgb * uLampRgb[i].a * m;
    a = max(a, m);
  }
  outColor = vec4(lin, a);
}`;

const BLUR = /* glsl */ `
precision highp float;
uniform sampler2D uFar;
uniform sampler2D uMid;
uniform sampler2D uNear;
uniform vec2 uTapFar[${MAX_TAPS}];
uniform vec2 uTapMid[${MAX_TAPS}];
uniform vec2 uTapNear[${MAX_TAPS}];
uniform ivec3 uCount;
uniform vec3 uLod;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 far = vec4(0.0);
  for (int i = 0; i < ${MAX_TAPS}; i++) {
    if (i >= uCount.x) break;
    far += textureLod(uFar, vUv + uTapFar[i], uLod.x);
  }
  far /= float(uCount.x);
  vec4 mid = vec4(0.0);
  for (int i = 0; i < ${MAX_TAPS}; i++) {
    if (i >= uCount.y) break;
    mid += textureLod(uMid, vUv + uTapMid[i], uLod.y);
  }
  mid /= float(uCount.y);
  vec4 near = vec4(0.0);
  for (int i = 0; i < ${MAX_TAPS}; i++) {
    if (i >= uCount.z) break;
    near += textureLod(uNear, vUv + uTapNear[i], uLod.z);
  }
  near /= float(uCount.z);
  vec4 c = mid + far * (1.0 - mid.a);
  c = near + c * (1.0 - near.a);
  outColor = vec4(c.rgb, 1.0);
}`;

const FLOATERS = 6;

const FX = /* glsl */ `
precision highp float;
uniform sampler2D uImg;
uniform vec2 uSize;
uniform float uPxPerDeg;
uniform float uMaxLod;
uniform vec2 uFix;
uniform float uVeil;
uniform float uHalo;
uniform float uHaze;
uniform float uFade;
uniform vec3 uTint;
uniform float uGlaucoma;
uniform float uMap;
uniform float uAmd;
uniform float uAmdMode;
uniform float uDr;
uniform float uFloaters;
uniform vec3 uFloat[${FLOATERS}];
uniform mat3 uCvd;
uniform float uTime;
in vec2 vUv;
out vec4 outColor;

float lodFor(float deg) { return clamp(log2(max(1.0, deg * uPxPerDeg)), 0.0, uMaxLod); }
vec3 at(vec2 uv, float lod) { return textureLod(uImg, clamp(uv, vec2(0.0), vec2(1.0)), lod).rgb; }
vec3 toSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  // Degrees from where the eye looks: x right, y up.
  vec2 d = (vUv - vec2(uFix.x, 1.0 - uFix.y)) * uSize / uPxPerDeg;
  float r = length(d);

  // Macular degeneration: the middle bends gently in the wavy example.
  float amdR = 3.0 + 9.0 * uAmd;
  float amdMask = uAmd > 0.0 ? 1.0 - smoothstep(amdR * 0.55, amdR, r) : 0.0;
  if (uAmdMode > 0.5 && uAmdMode < 1.5) {
    vec2 w = vec2(sin(d.y * 1.7 + uTime * 0.6), sin(d.x * 1.5 - uTime * 0.5)) * 0.35 * uAmd;
    uv += w * amdMask * uPxPerDeg / uSize;
  }

  vec3 c = at(uv, 0.0);
  if (uHaze > 0.0) c = mix(c, at(uv, lodFor(uHaze)), 0.65);

  // Straylight: equal weights per octave, 0.5 to 16 degrees.
  if (uVeil > 0.0) {
    vec3 v = vec3(0.0);
    for (int i = 0; i < 6; i++) v += at(uv, lodFor(0.5 * pow(2.0, float(i))));
    v /= 6.0;
    c = mix(c, v, uVeil);
  }
  if (uHalo > 0.0) {
    vec3 ring = vec3(0.0);
    float rr = 1.4 * uPxPerDeg;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      ring += at(uv + vec2(cos(a), sin(a)) * rr / uSize, lodFor(0.25));
    }
    vec3 bright = max(ring / 8.0 - vec3(1.0), vec3(0.0));
    c += bright * 0.12 * uHalo;
  }

  // Glaucoma: an arc above the midline, from beside the blind spot round to the nose side,
  // with a step along the midline; soft-edged, never black, the centre clear.
  if (uGlaucoma > 0.0) {
    float s = uGlaucoma;
    float ang = atan(d.y, -d.x);
    float upper = smoothstep(0.0, 1.2, d.y);
    float lower = smoothstep(0.0, 1.2, -d.y) * smoothstep(0.6, 1.0, s);
    float inner = 9.0 - 2.0 * s;
    float outer = 15.0 + 12.0 * s;
    float band = smoothstep(inner - 2.0, inner + 1.5, r) * (1.0 - smoothstep(outer, outer + 3.0, r));
    float arc = smoothstep(-0.2, 0.5, ang) * (1.0 - smoothstep(2.6, 3.1, ang));
    float step1 = smoothstep(-12.0, -18.0, d.x) * (1.0 - smoothstep(0.0, 7.0, d.y)) * upper;
    float m = max(band * arc * upper, step1) + band * lower * 0.6;
    m *= smoothstep(4.0, 7.0, r) * clamp(s * 1.4, 0.0, 1.0);
    vec3 soft = at(uv, lodFor(1.2 + 1.5 * s));
    vec3 grey = vec3(dot(soft, vec3(0.2126, 0.7152, 0.0722)));
    vec3 notice = mix(soft, mix(soft, grey, 0.35), 0.5);
    vec3 mapped = mix(soft, grey * 0.55 + vec3(0.12), 0.8);
    vec3 shown = mix(notice, mapped, uMap);
    c = mix(c, shown, m * mix(0.55, 1.0, uMap));
  }

  // Macular degeneration: central blur, waves (above) or detail filled in from around it;
  // the edges stay sharp.
  if (uAmd > 0.0) {
    vec3 blur = at(uv, lodFor(0.35 + 1.2 * uAmd));
    vec3 fill = at(uv, lodFor(amdR * 1.4));
    vec3 inner = uAmdMode > 1.5 ? mix(blur, fill, 0.85) : blur;
    c = mix(c, inner, amdMask * (uAmdMode > 0.5 && uAmdMode < 1.5 ? 0.55 : 0.92));
  }

  // Diabetic retinopathy, one example: blur from swelling at the macula that comes and goes.
  if (uDr > 0.0) {
    float m = 1.0 - smoothstep(4.0, 11.0, r);
    c = mix(c, at(uv, lodFor(0.3 + 0.8 * uDr)), m * uDr);
  }
  if (uFloaters > 0.0) {
    for (int i = 0; i < ${FLOATERS}; i++) {
      vec2 p = (vUv - uFloat[i].xy) * uSize / uPxPerDeg;
      float f = 1.0 - smoothstep(uFloat[i].z * 0.4, uFloat[i].z, length(p * vec2(1.0, 1.6)));
      c *= 1.0 - 0.45 * f * uFloaters;
    }
  }

  c *= uTint;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(y), uFade);
  c = uCvd * c;
  // A little dither keeps dark gradients smooth.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outColor = vec4(toSrgb(c) + n / 255.0, 1.0);
}`;

interface SourceSet {
  key: string;
  w: number;
  h: number;
  night: boolean;
  art: SceneArt;
  textures: CanvasTexture[];
  targets: WebGLRenderTarget[];
  prepared: boolean;
  used: number;
}

interface Composite {
  target: WebGLRenderTarget;
  key: string;
  w: number;
  h: number;
}

/** Most picture sizes kept at once (a screen has the featured view and the columns). */
const MAX_SETS = 4;
const MAX_SLOTS = 16;
/** Composite targets are at most this many pixels; a blurred picture needs no more. */
const MAX_PIXELS = 1.6e6;

export const createSight = (
  r3d: Renderer3D,
  opts: { fov: number; scale?: number; maxPixels?: number },
): Sight => {
  const renderer: WebGLRenderer = r3d.renderer;
  const fov = opts.fov;
  const half =
    renderer.extensions.has("EXT_color_buffer_float") ||
    renderer.extensions.has("EXT_color_buffer_half_float");
  const type = half ? HalfFloatType : UnsignedByteType;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new PlaneGeometry(2, 2);
  const mat = (frag: string, uniforms: Record<string, { value: unknown }>) =>
    new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  const vec2s = (n: number) => Array.from({ length: n }, () => new Vector2());
  const prepMat = mat(PREP, {
    uArt: { value: null },
    uSize: { value: new Vector2(1, 1) },
    uLamps: { value: 0 },
    uLamp: { value: Array.from({ length: MAX_LAMPS }, () => new Vector4()) },
    uLampRgb: { value: Array.from({ length: MAX_LAMPS }, () => new Vector4()) },
  });
  const blurMat = mat(BLUR, {
    uFar: { value: null },
    uMid: { value: null },
    uNear: { value: null },
    uTapFar: { value: vec2s(MAX_TAPS) },
    uTapMid: { value: vec2s(MAX_TAPS) },
    uTapNear: { value: vec2s(MAX_TAPS) },
    uCount: { value: new Vector3(1, 1, 1) },
    uLod: { value: new Vector3() },
  });
  const fxMat = mat(FX, {
    uImg: { value: null },
    uSize: { value: new Vector2(1, 1) },
    uPxPerDeg: { value: 10 },
    uMaxLod: { value: 8 },
    uFix: { value: new Vector2(0.5, 0.5) },
    uVeil: { value: 0 },
    uHalo: { value: 0 },
    uHaze: { value: 0 },
    uFade: { value: 0 },
    uTint: { value: new Vector3(1, 1, 1) },
    uGlaucoma: { value: 0 },
    uMap: { value: 0 },
    uAmd: { value: 0 },
    uAmdMode: { value: 0 },
    uDr: { value: 0 },
    uFloaters: { value: 0 },
    uFloat: { value: Array.from({ length: FLOATERS }, () => new Vector3()) },
    uCvd: { value: new Matrix3() },
    uTime: { value: 0 },
  });
  // The uniform blocks hold ivec3 counts; three uploads a Vector3 there as floats otherwise.
  (blurMat.uniforms.uCount as { value: unknown }).value = [1, 1, 1];
  const scenes = [prepMat, blurMat, fxMat].map((m) => {
    const s = new Scene();
    const mesh = new Mesh(quad, m);
    mesh.frustumCulled = false;
    s.add(mesh);
    return s;
  });
  const [prepScene, blurScene, fxScene] = scenes as [Scene, Scene, Scene];
  for (const s of scenes) r3d.prepare(s, camera);

  const sets: SourceSet[] = [];
  const slots: (Composite | null)[] = [];
  let tick = 0;
  let blurs = 0;
  let disposed = false;

  const target = (w: number, h: number, mips: boolean) =>
    new WebGLRenderTarget(w, h, {
      type,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: mips,
      minFilter: mips ? LinearMipmapLinearFilter : LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
    });

  const freeSet = (s: SourceSet) => {
    for (const t of s.textures) t.dispose();
    for (const t of s.targets) t.dispose();
  };

  const sourceFor = (w: number, h: number, night: boolean): SourceSet => {
    const key = `${w}x${h}:${night ? "n" : "d"}`;
    let s = sets.find((x) => x.key === key);
    if (!s) {
      const art = drawScene(w, h, fov, night);
      const textures = [art.far, art.mid, art.near].map((l: Layer) => {
        const t = new CanvasTexture(l.canvas);
        t.colorSpace = NoColorSpace;
        t.premultiplyAlpha = true;
        t.generateMipmaps = false;
        t.minFilter = LinearFilter;
        t.magFilter = LinearFilter;
        t.flipY = true;
        return t;
      });
      s = {
        key,
        w,
        h,
        night,
        art,
        textures,
        targets: [0, 1, 2].map(() => target(w, h, true)),
        prepared: false,
        used: 0,
      };
      sets.push(s);
      while (sets.length > MAX_SETS) {
        // Drop the least recently used set that isn't this one.
        let drop = 0;
        for (let i = 1; i < sets.length; i++) if (sets[i]!.used < sets[drop]!.used) drop = i;
        if (sets[drop] === s) drop = drop === 0 ? 1 : 0;
        const [gone] = sets.splice(drop, 1);
        if (gone) freeSet(gone);
        for (const c of slots) if (c) c.key = "";
      }
    }
    s.used = ++tick;
    return s;
  };

  const prepare = (s: SourceSet) => {
    const layers = [s.art.far, s.art.mid, s.art.near];
    const u = prepMat.uniforms;
    for (let i = 0; i < 3; i++) {
      const layer = layers[i]!;
      u.uArt!.value = s.textures[i] as Texture;
      (u.uSize!.value as Vector2).set(s.w, s.h);
      u.uLamps!.value = Math.min(MAX_LAMPS, layer.lamps.length);
      const lamps = u.uLamp!.value as Vector4[];
      const rgbs = u.uLampRgb!.value as Vector4[];
      for (let j = 0; j < MAX_LAMPS; j++) {
        const l = layer.lamps[j];
        if (l) {
          lamps[j]!.set(l.x, l.y, l.r, 0);
          rgbs[j]!.set(l.rgb[0], l.rgb[1], l.rgb[2], l.intensity);
        } else rgbs[j]!.set(0, 0, 0, 0);
      }
      renderer.setRenderTarget(s.targets[i]!);
      renderer.render(prepScene, camera);
    }
    s.prepared = true;
  };

  const sizeOf = (r: ViewRect): [number, number] => {
    const ratio = renderer.getPixelRatio() * (opts.scale ?? 1);
    let w = Math.max(8, Math.round(r.width * ratio));
    let h = Math.max(8, Math.round(r.height * ratio));
    const px = w * h;
    const cap = opts.maxPixels ?? MAX_PIXELS;
    if (px > cap) {
      const k = Math.sqrt(cap / px);
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    return [w, h];
  };

  const setTaps = (arr: Vector2[], k: Kernel, w: number, h: number) => {
    const vfov = (fov * h) / w;
    for (let i = 0; i < MAX_TAPS; i++) {
      if (i < k.count) arr[i]!.set(k.taps[i * 2]! / fov, -k.taps[i * 2 + 1]! / vfov);
      else arr[i]!.set(0, 0);
    }
  };

  const lodOf = (k: Kernel, w: number) => {
    const px = (k.spacing * w) / fov;
    return Math.max(0, Math.log2(Math.max(1, px * 0.85)));
  };

  const blur = (c: Composite, s: SourceSet, v: ViewDraw) => {
    const u = blurMat.uniforms;
    u.uFar!.value = s.targets[0]!.texture;
    u.uMid!.value = s.targets[1]!.texture;
    u.uNear!.value = s.targets[2]!.texture;
    const [kf, km, kn] = v.kernels;
    setTaps(u.uTapFar!.value as Vector2[], kf, s.w, s.h);
    setTaps(u.uTapMid!.value as Vector2[], km, s.w, s.h);
    setTaps(u.uTapNear!.value as Vector2[], kn, s.w, s.h);
    u.uCount!.value = [kf.count, km.count, kn.count];
    (u.uLod!.value as Vector3).set(lodOf(kf, s.w), lodOf(km, s.w), lodOf(kn, s.w));
    renderer.setRenderTarget(c.target);
    renderer.render(blurScene, camera);
    blurs++;
  };

  return {
    fov,
    draw(views, frameH) {
      if (disposed || !r3d.ready) return;
      const prevTarget = renderer.getRenderTarget();
      for (const v of views) {
        if (v.slot >= MAX_SLOTS) continue;
        const [w, h] = sizeOf(v.rect);
        const s = sourceFor(w, h, v.night);
        if (!s.prepared) {
          prepare(s);
          for (const c of slots) if (c && c.w === w && c.h === h) c.key = "";
        }
        let c = slots[v.slot] ?? null;
        if (!c || c.w !== w || c.h !== h) {
          c?.target.dispose();
          c = { target: target(w, h, true), key: "", w, h };
          slots[v.slot] = c;
        }
        const key = `${s.key}|${v.key}`;
        if (c.key !== key) {
          blur(c, s, v);
          c.key = key;
        }
      }
      renderer.setRenderTarget(prevTarget);
      const u = fxMat.uniforms;
      for (const v of views) {
        const c = slots[v.slot];
        if (!c) continue;
        const e = v.effects;
        u.uImg!.value = c.target.texture;
        (u.uSize!.value as Vector2).set(c.w, c.h);
        u.uPxPerDeg!.value = c.w / fov;
        u.uMaxLod!.value = Math.floor(Math.log2(Math.max(c.w, c.h)));
        (u.uFix!.value as Vector2).set(v.fix[0], v.fix[1]);
        u.uVeil!.value = e.veil;
        u.uHalo!.value = e.halo;
        u.uHaze!.value = e.haze;
        u.uFade!.value = e.fade;
        (u.uTint!.value as Vector3).set(e.tint[0], e.tint[1], e.tint[2]);
        u.uGlaucoma!.value = e.glaucoma;
        u.uMap!.value = e.glaucomaMap;
        u.uAmd!.value = e.amd;
        u.uAmdMode!.value = e.amdMode;
        u.uDr!.value = e.dr;
        u.uFloaters!.value = e.floaters;
        const fl = u.uFloat!.value as Vector3[];
        for (let i = 0; i < FLOATERS; i++) {
          // Soft spots drifting slowly downwards and sideways, wrapping round.
          const t = v.time * (0.012 + i * 0.003);
          fl[i]!.set(
            (0.2 + 0.13 * i + 0.05 * Math.sin(v.time * 0.2 + i)) % 1,
            1 - ((0.15 + 0.17 * i + t) % 1),
            0.6 + 0.25 * (i % 3),
          );
        }
        const m = e.cvd;
        // Matrix3.set takes rows; GLSL gets it column-major, as three uploads it.
        (u.uCvd!.value as Matrix3).set(
          m[0]!,
          m[1]!,
          m[2]!,
          m[3]!,
          m[4]!,
          m[5]!,
          m[6]!,
          m[7]!,
          m[8]!,
        );
        u.uTime!.value = v.time;
        const y = frameH - v.rect.y - v.rect.height;
        renderer.setViewport(v.rect.x, y, v.rect.width, v.rect.height);
        renderer.setScissor(v.rect.x, y, v.rect.width, v.rect.height);
        renderer.render(fxScene, camera);
      }
    },
    fixFor(width, height, night, looking) {
      const [w, h] = sizeOf({ x: 0, y: 0, width, height });
      const s = sourceFor(w, h, night);
      const p = s.art.fix[looking];
      return [p[0], p[1]];
    },
    invalidate() {
      for (const s of sets) s.prepared = false;
      for (const c of slots) if (c) c.key = "";
    },
    get blurs() {
      return blurs;
    },
    dispose() {
      disposed = true;
      for (const s of sets) freeSet(s);
      sets.length = 0;
      for (const c of slots) c?.target.dispose();
      slots.length = 0;
      quad.dispose();
      prepMat.dispose();
      blurMat.dispose();
      fxMat.dispose();
    },
  };
};
