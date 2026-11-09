/**
 * The kaleidoscope: one fragment pass. Each pixel is folded into a wedge of pi / m by m mirrors
 * through the centre, turned, scaled and offset into the complex plane, and coloured by how a
 * Julia set's orbit from there behaves: escaping orbits by their smooth escape count (bright
 * near the set, dark far from it), trapped ones by how close they pass to a ring. A change of
 * mirror count crossfades two foldings.
 *
 * Every finger twists the picture around itself in the folded plane, so its twist appears in
 * every mirror image, and a faint ring shows where it is. Nothing is kept between frames: the
 * picture is a pure function of the parameters.
 */
import {
  createProgram,
  createTarget,
  deleteTarget,
  drawFullscreen,
  FULLSCREEN_VS,
  type Program,
  type Target,
} from "./gl";

export const MAX_SWIRLS = 24;
const MAX_ITER = 96;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_canvas;
uniform vec2 u_centre;
uniform float u_scale;
uniform float u_rot;
uniform vec2 u_c;
uniform vec2 u_offset;
uniform vec2 u_trap;
uniform float u_m;
uniform float u_mFrom;
uniform float u_fade;
uniform vec3 u_pal[4];
uniform float u_phase;
uniform int u_iter;
uniform int u_ss;
uniform int u_nSwirl;
uniform vec4 u_swirl[${MAX_SWIRLS}];
uniform vec3 u_ring[${MAX_SWIRLS}];

const float PI = 3.14159265;

vec2 fold(vec2 p, float m) {
  float w = PI / m;
  float a = mod(atan(p.y, p.x), 2.0 * w);
  return length(p) * vec2(cos(abs(a - w)), sin(abs(a - w)));
}

vec2 turn(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 pal(float t) {
  float x = fract(t) * 4.0;
  int i = int(floor(x));
  float f = smoothstep(0.0, 1.0, fract(x));
  return mix(u_pal[i], u_pal[(i + 1) % 4], f);
}

vec3 shade(vec2 z) {
  float trapP = 1e9;
  float trapL = 1e9;
  float n = 0.0;
  bool escaped = false;
  for (int i = 0; i < ${MAX_ITER}; i++) {
    if (i >= u_iter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + u_c;
    float r2 = dot(z, z);
    trapP = min(trapP, length(z - u_trap));
    trapL = min(trapL, min(abs(z.x), abs(z.y)));
    if (r2 > 256.0) {
      n = float(i) + 1.0 - log2(log2(r2) * 0.5);
      escaped = true;
      break;
    }
  }
  // Thin bright stalks where orbits pass close to the axes, soft blobs near the point trap.
  float stalk = exp(-trapL * 10.0);
  float blob = exp(-trapP * 3.0);
  if (escaped) {
    float edge = pow(clamp(n / 16.0, 0.0, 1.0), 1.1);
    vec3 band = pal(0.45 * log2(n + 1.0) + u_phase);
    return band * (0.1 + 0.8 * edge) + pal(u_phase + 0.5) * stalk * (0.2 + 0.6 * edge);
  }
  vec3 inside = pal(trapP * 0.9 + u_phase + 0.25);
  return inside * (0.05 + 0.6 * blob) + pal(u_phase + 0.75) * stalk * 0.35;
}

vec3 look(vec2 px, float m) {
  vec2 p = fold(px - u_centre, m);
  for (int i = 0; i < ${MAX_SWIRLS}; i++) {
    if (i >= u_nSwirl) break;
    vec4 s = u_swirl[i];
    vec2 f = fold(s.xy - u_centre, m);
    vec2 d = p - f;
    float g = exp(-dot(d, d) / (s.z * s.z));
    if (g > 0.003) p = f + turn(d, s.w * g);
  }
  return shade(turn(p, u_rot) * u_scale + u_offset);
}

vec3 pixel(vec2 px) {
  vec3 c = look(px, u_m);
  if (u_fade < 1.0) c = mix(look(px, u_mFrom), c, smoothstep(0.0, 1.0, u_fade));
  return c;
}

void main() {
  vec2 px = v_uv * u_canvas;
  vec3 c = vec3(0.0);
  if (u_ss > 1) {
    c += pixel(px + vec2(-0.25, -0.25));
    c += pixel(px + vec2(0.25, -0.25));
    c += pixel(px + vec2(-0.25, 0.25));
    c += pixel(px + vec2(0.25, 0.25));
    c *= 0.25;
  } else {
    c = pixel(px);
  }
  for (int i = 0; i < ${MAX_SWIRLS}; i++) {
    if (i >= u_nSwirl) break;
    vec4 s = u_swirl[i];
    float d = length(px - s.xy);
    float r = s.z * 0.55;
    float ring = exp(-pow((d - r) / (s.z * 0.06), 2.0));
    c += u_ring[i] * ring * 0.35;
  }
  o = vec4(c, 1.0);
}`;

export interface KaleidoInputs {
  /** Canvas px, y up. */
  centre: readonly [number, number];
  /** Complex units per canvas px. */
  scale: number;
  rot: number;
  c: readonly [number, number];
  offset: readonly [number, number];
  /** The orbit trap's point, in the complex plane. */
  trap: readonly [number, number];
  mirrors: number;
  fromMirrors: number;
  fade: number;
  palette: readonly (readonly [number, number, number])[];
  phase: number;
  iterations: number;
  supersample: boolean;
  /** Per finger: canvas x, y (y up), radius px, twist angle; and its ring colour. */
  swirls: readonly { x: number; y: number; r: number; angle: number; rgb: readonly number[] }[];
}

export interface KaleidoView {
  draw(k: KaleidoInputs, w: number, h: number): void;
  /** Draw into a small offscreen target and read it back (tests: brightness over time). */
  sample(k: KaleidoInputs, w: number, h: number): Uint8Array;
  dispose(): void;
}

export const createKaleidoView = (gl: WebGL2RenderingContext): KaleidoView => {
  const program: Program = createProgram(gl, FULLSCREEN_VS, FS);
  const vao = gl.createVertexArray();
  const swirl = new Float32Array(MAX_SWIRLS * 4);
  const ring = new Float32Array(MAX_SWIRLS * 3);
  const pal = new Float32Array(12);
  let probe: Target | null = null;

  const setUniforms = (k: KaleidoInputs, w: number, h: number) => {
    program.use();
    gl.uniform2f(program.u("u_canvas"), w, h);
    gl.uniform2f(program.u("u_centre"), k.centre[0], k.centre[1]);
    gl.uniform1f(program.u("u_scale"), k.scale);
    gl.uniform1f(program.u("u_rot"), k.rot);
    gl.uniform2f(program.u("u_c"), k.c[0], k.c[1]);
    gl.uniform2f(program.u("u_offset"), k.offset[0], k.offset[1]);
    gl.uniform2f(program.u("u_trap"), k.trap[0], k.trap[1]);
    gl.uniform1f(program.u("u_m"), k.mirrors);
    gl.uniform1f(program.u("u_mFrom"), k.fromMirrors);
    gl.uniform1f(program.u("u_fade"), k.fade);
    for (let i = 0; i < 4; i++) {
      const c = k.palette[i % Math.max(1, k.palette.length)] ?? [1, 1, 1];
      pal.set([c[0], c[1], c[2]], i * 3);
    }
    gl.uniform3fv(program.u("u_pal"), pal);
    gl.uniform1f(program.u("u_phase"), k.phase);
    gl.uniform1i(program.u("u_iter"), Math.max(8, Math.min(MAX_ITER, Math.round(k.iterations))));
    gl.uniform1i(program.u("u_ss"), k.supersample ? 2 : 1);
    const n = Math.min(MAX_SWIRLS, k.swirls.length);
    for (let i = 0; i < n; i++) {
      const s = k.swirls[i]!;
      swirl.set([s.x, s.y, Math.max(1, s.r), s.angle], i * 4);
      ring.set([s.rgb[0] ?? 1, s.rgb[1] ?? 1, s.rgb[2] ?? 1], i * 3);
    }
    gl.uniform1i(program.u("u_nSwirl"), n);
    gl.uniform4fv(program.u("u_swirl"), swirl);
    gl.uniform3fv(program.u("u_ring"), ring);
  };

  return {
    draw(k, w, h) {
      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND);
      setUniforms(k, w, h);
      drawFullscreen(gl, null, w, h);
      gl.bindVertexArray(null);
    },
    sample(k, w, h) {
      if (!probe || probe.width !== w || probe.height !== h) {
        deleteTarget(gl, probe);
        probe = createTarget(gl, w, h, { internal: gl.RGBA8 });
      }
      gl.bindVertexArray(vao);
      setUniforms(k, w, h);
      drawFullscreen(gl, probe.fbo, w, h);
      gl.bindVertexArray(null);
      const out = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    },
    dispose() {
      program.dispose();
      deleteTarget(gl, probe);
      gl.deleteVertexArray(vao);
    },
  };
};
