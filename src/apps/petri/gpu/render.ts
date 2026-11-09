import type { Box, Circle } from "../dish";
import type { Culture } from "./culture";
import {
  bindTexture,
  createProgram,
  createTarget,
  deleteTarget,
  drawFullscreen,
  FULLSCREEN_VS,
  type Program,
  type Target,
} from "./gl";

/**
 * Draws a culture onto the canvas: a dark bench, the agar (a round dish on a screen) with a lit
 * rim, the culture's own colours, a two-level soft glow taken from a quarter-resolution copy, and
 * effects (splashes, flying drops, food and salt). All positions are frame venue px, y down.
 */
export const MAX_FX = 24;
export const MAX_MARKS = 16;

export const FX = { ripple: 0, bead: 1, food: 2, salt: 3 } as const;

/** Life's cells are small, so they get more glow; reaction patterns are large and get less. */
const BLOOM_GAIN = { life: 1.8, slime: 1, turing: 0.8 } as const;

export interface ViewInputs {
  time: number;
  /** Frame size in venue px. */
  venue: { width: number; height: number };
  world: Box;
  dish: Circle | null;
  /** Where the culture's window ends on a bank panel (venue y), or null when it fills the frame. */
  benchTop: number | null;
  fxCount: number;
  /** x, y, radius, age (0 to 1). */
  fxA: Float32Array;
  /** r, g, b, kind. */
  fxB: Float32Array;
  wash: { front: number; radial: boolean };
  /** x positions (venue px) of slice or region borders, marked faintly. */
  marks: readonly number[];
  colors: Float32Array;
  strainColors: Float32Array;
}

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform vec2 u_canvas;
uniform vec2 u_venue;
uniform vec4 u_world;
uniform float u_cell;
in vec2 v_uv;
out vec4 o;
vec2 venueAt(vec2 frag) { return vec2(frag.x, u_canvas.y - frag.y) / u_canvas * u_venue; }
`;

const BLOOM_SRC_FS = (snippet: string) => `${PRELUDE}
uniform vec4 u_dish;
uniform float u_bloomGain;
${snippet}
void main() {
  vec2 v = venueAt(gl_FragCoord.xy);
  vec2 w = v - u_world.xy;
  if (w.x < 0.0 || w.y < 0.0 || w.x > u_world.z || w.y > u_world.w) { o = vec4(0.0); return; }
  if (u_dish.z > 0.0 && length(v - u_dish.xy) > u_dish.z) { o = vec4(0.0); return; }
  vec4 c = cultureColor(w / u_cell, 1.0);
  o = vec4(c.rgb * c.a * u_bloomGain, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_step;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 0.227;
  c += (texture(u_src, v_uv + u_step * 1.385).rgb + texture(u_src, v_uv - u_step * 1.385).rgb) * 0.316;
  c += (texture(u_src, v_uv + u_step * 3.231).rgb + texture(u_src, v_uv - u_step * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;

const COMPOSITE_FS = (snippet: string) => `${PRELUDE}
uniform vec4 u_dish;
uniform float u_benchTop;
uniform sampler2D u_bloom1;
uniform sampler2D u_bloom2;
uniform float u_time;
uniform float u_pxPerVenue;
uniform int u_fxCount;
uniform vec4 u_fxA[${MAX_FX}];
uniform vec4 u_fxB[${MAX_FX}];
uniform vec2 u_washLine;
uniform int u_markCount;
uniform float u_marks[${MAX_MARKS}];
${snippet}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 effects(vec2 v, vec3 col) {
  for (int i = 0; i < ${MAX_FX}; i++) {
    if (i >= u_fxCount) break;
    vec4 a = u_fxA[i];
    vec4 b = u_fxB[i];
    vec2 d = v - a.xy;
    float reach = a.z * 3.5 + 40.0;
    if (abs(d.x) > reach || abs(d.y) > reach) continue;
    float r = length(d);
    int kind = int(b.w + 0.5);
    if (kind == 0) {
      float rad = a.z * (0.35 + 1.1 * a.w);
      float ring = exp(-pow((r - rad) / (6.0 + 10.0 * a.w), 2.0));
      col += b.rgb * ring * pow(1.0 - a.w, 1.5) * 0.9;
    } else if (kind == 1) {
      float core = 1.0 - smoothstep(a.z * 0.55, a.z, r);
      float halo = exp(-r * r / (a.z * a.z * 3.0));
      col = mix(col, mix(b.rgb, vec3(1.0), 0.55), core * 0.9);
      col += b.rgb * halo * 0.65;
    } else if (kind == 2) {
      float size = a.z * mix(0.45, 1.0, a.w);
      float wob = 1.0 + 0.08 * sin(atan(d.y, d.x) * 5.0 + u_time * 0.7);
      float blob = 1.0 - smoothstep(size * 0.8 * wob, size * wob, r);
      float halo = exp(-r * r / (size * size * 2.5));
      vec3 food = mix(vec3(1.0, 0.72, 0.28), vec3(1.0, 0.93, 0.7), 1.0 - r / max(1.0, size));
      col = mix(col, food, blob * 0.9);
      col += vec3(1.0, 0.65, 0.2) * halo * 0.25 * a.w;
    } else {
      float size = a.z * mix(0.4, 0.85, a.w);
      vec2 q = abs(d);
      float hex = max(q.x * 0.866 + q.y * 0.5, q.y);
      float shape = 1.0 - smoothstep(size * 0.9, size, hex);
      float facet = 0.75 + 0.25 * sign(d.x * d.y);
      col = mix(col, vec3(0.78, 0.9, 1.0) * facet, shape * 0.85 * a.w);
      col += vec3(0.5, 0.75, 1.0) * exp(-r * r / (size * size * 3.0)) * 0.2 * a.w;
    }
  }
  return col;
}

void main() {
  vec2 v = venueAt(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / u_canvas;
  float px = 1.0 / max(0.0001, u_pxPerVenue);
  // The room: near black with a faint cool falloff.
  vec2 centred = v / u_venue - 0.5;
  vec3 col = mix(vec3(0.020, 0.028, 0.045), vec3(0.008, 0.010, 0.018), clamp(length(centred) * 1.4, 0.0, 1.0));
  vec2 w = v - u_world.xy;
  bool inRect = w.x >= 0.0 && w.y >= 0.0 && w.x <= u_world.z && w.y <= u_world.w;
  float inside = inRect ? 1.0 : 0.0;
  float rimDist = 1e9;
  if (u_dish.z > 0.0) {
    float d = length(v - u_dish.xy);
    rimDist = d - u_dish.z;
    inside = 1.0 - smoothstep(-2.0 * px, 0.0, rimDist);
  }
  if (inside > 0.0) {
    // Agar: deep teal, lit a little from the top left.
    vec2 rel = (v - u_world.xy) / max(u_world.zw, vec2(1.0)) - vec2(0.35, 0.3);
    vec3 agar = mix(vec3(0.030, 0.062, 0.072), vec3(0.012, 0.024, 0.034), clamp(length(rel) * 1.2, 0.0, 1.0));
    col = mix(col, agar, inside);
    vec4 c = cultureColor(w / u_cell, u_cell * u_pxPerVenue);
    col += c.rgb * inside;
  }
  col += texture(u_bloom1, uv).rgb * 0.85 + texture(u_bloom2, uv).rgb * 0.9;
  if (u_dish.z > 0.0) {
    // A glass rim: a bright thin edge, a soft outer glow and a highlight towards the top left.
    float edge = exp(-pow(rimDist / (7.0 + 3.0 * px), 2.0));
    float outer = exp(-max(0.0, rimDist) / 90.0) * step(0.0, rimDist);
    float ang = atan(v.y - u_dish.y, v.x - u_dish.x);
    float spec = pow(max(0.0, cos(ang + 2.35)), 6.0);
    col += vec3(0.55, 0.78, 0.86) * edge * (0.35 + 0.9 * spec);
    col += vec3(0.10, 0.22, 0.28) * outer * 0.8;
    float inner = exp(-pow((rimDist + 26.0) / 14.0, 2.0));
    col += vec3(0.25, 0.4, 0.45) * inner * 0.18 * (0.4 + spec);
    for (int i = 0; i < ${MAX_MARKS}; i++) {
      if (i >= u_markCount) break;
      float dx = abs(v.x - u_marks[i]);
      float along = smoothstep(-120.0, -10.0, rimDist) * (1.0 - smoothstep(-10.0, 4.0, rimDist));
      col += vec3(0.45, 0.65, 0.72) * (1.0 - smoothstep(1.5, 4.0 + px, dx)) * along * 0.5;
    }
  } else if (u_markCount > 0) {
    for (int i = 0; i < ${MAX_MARKS}; i++) {
      if (i >= u_markCount) break;
      float dx = abs(v.x - u_marks[i]);
      float fade = smoothstep(0.0, u_venue.y * 0.25, v.y) * (1.0 - smoothstep(u_venue.y * 0.5, u_venue.y * 0.75, v.y));
      col += vec3(0.4, 0.6, 0.7) * (1.0 - smoothstep(1.0, 3.0 + px, dx)) * fade * 0.06;
    }
  }
  if (u_benchTop > 0.0) {
    // Below the culture's window: a dark bench with a lit lip where the window ends.
    float below = smoothstep(u_benchTop - 2.0 * px, u_benchTop + 2.0 * px, v.y);
    vec3 bench = mix(vec3(0.026, 0.032, 0.048), vec3(0.010, 0.012, 0.020), clamp((v.y - u_benchTop) / (u_venue.y - u_benchTop + 1.0), 0.0, 1.0));
    col = mix(col, bench, below);
    float lip = exp(-pow((v.y - u_benchTop) / 5.0, 2.0));
    col += vec3(0.35, 0.55, 0.62) * lip * 0.45;
  }
  if (u_washLine.x >= 0.0 && u_washLine.x <= 1.2) {
    float d;
    if (u_washLine.y > 0.5) {
      vec2 c = u_dish.z > 0.0 ? u_dish.xy : u_world.xy + u_world.zw * 0.5;
      float r = u_dish.z > 0.0 ? u_dish.z : length(u_world.zw) * 0.5;
      d = length(v - c) - u_washLine.x * r;
    } else {
      d = v.x - (u_world.x + u_washLine.x * u_world.z);
    }
    col += vec3(0.35, 0.75, 0.85) * exp(-d * d / 900.0) * 0.35 * inside;
  }
  col = effects(v, col);
  col = col / (1.0 + max(col - 1.0, 0.0));
  col += (hash12(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

export interface Renderer {
  draw(view: ViewInputs, canvasW: number, canvasH: number): void;
  dispose(): void;
}

const setCommon = (
  gl: WebGL2RenderingContext,
  p: Program,
  view: ViewInputs,
  culture: Culture,
  w: number,
  h: number,
) => {
  gl.uniform2f(p.u("u_canvas"), w, h);
  gl.uniform2f(p.u("u_venue"), view.venue.width, view.venue.height);
  gl.uniform4f(p.u("u_world"), view.world.x, view.world.y, view.world.width, view.world.height);
  gl.uniform1f(p.u("u_cell"), culture.cell);
  const d = view.dish;
  gl.uniform4f(p.u("u_dish"), d?.x ?? 0, d?.y ?? 0, d?.r ?? 0, 0);
  gl.uniform3fv(p.u("u_colors[0]"), view.colors);
  gl.uniform3fv(p.u("u_strainColors[0]"), view.strainColors);
};

export const createRenderer = (gl: WebGL2RenderingContext, culture: Culture): Renderer => {
  const bloomSrc = createProgram(gl, FULLSCREEN_VS, BLOOM_SRC_FS(culture.snippet));
  const blur = createProgram(gl, FULLSCREEN_VS, BLUR_FS);
  const composite = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS(culture.snippet));
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("renderer allocation failed");
  let size = { w: 0, h: 0 };
  let targets: Target[] = [];
  const marks = new Float32Array(MAX_MARKS);

  const resize = (w: number, h: number) => {
    if (size.w === w && size.h === h && targets.length) return;
    for (const t of targets) deleteTarget(gl, t);
    const qw = Math.max(1, Math.round(w / 4));
    const qh = Math.max(1, Math.round(h / 4));
    const ew = Math.max(1, Math.round(w / 16));
    const eh = Math.max(1, Math.round(h / 16));
    const spec = { internal: gl.RGBA8, linear: true };
    targets = [
      createTarget(gl, qw, qh, spec),
      createTarget(gl, qw, qh, spec),
      createTarget(gl, ew, eh, spec),
      createTarget(gl, ew, eh, spec),
    ];
    size = { w, h };
  };

  const blurPass = (src: Target, dst: Target, dx: number, dy: number) => {
    blur.use();
    bindTexture(gl, 0, src.texture, blur.u("u_src"));
    gl.uniform2f(blur.u("u_step"), dx / src.width, dy / src.height);
    drawFullscreen(gl, dst.fbo, dst.width, dst.height);
  };

  return {
    draw(view, w, h) {
      resize(w, h);
      const [q1, q2, e1, e2] = targets as [Target, Target, Target, Target];
      gl.bindVertexArray(vao);

      bloomSrc.use();
      setCommon(gl, bloomSrc, view, culture, q1.width, q1.height);
      gl.uniform1f(bloomSrc.u("u_bloomGain"), BLOOM_GAIN[culture.family]);
      culture.bind(bloomSrc, 1);
      drawFullscreen(gl, q1.fbo, q1.width, q1.height);
      blurPass(q1, q2, 1, 0);
      blurPass(q2, q1, 0, 1);
      blurPass(q1, e1, 2, 0);
      blurPass(e1, e2, 0, 2);
      blurPass(e2, e1, 2, 0);
      blurPass(e1, e2, 0, 2);

      composite.use();
      setCommon(gl, composite, view, culture, w, h);
      culture.bind(composite, 3);
      bindTexture(gl, 0, q1.texture, composite.u("u_bloom1"));
      bindTexture(gl, 1, e2.texture, composite.u("u_bloom2"));
      gl.uniform1f(composite.u("u_time"), view.time);
      gl.uniform1f(composite.u("u_pxPerVenue"), w / view.venue.width);
      gl.uniform1f(composite.u("u_benchTop"), view.benchTop ?? -1);
      gl.uniform1i(composite.u("u_fxCount"), view.fxCount);
      gl.uniform4fv(composite.u("u_fxA[0]"), view.fxA);
      gl.uniform4fv(composite.u("u_fxB[0]"), view.fxB);
      gl.uniform2f(composite.u("u_washLine"), view.wash.front, view.wash.radial ? 1 : 0);
      const n = Math.min(MAX_MARKS, view.marks.length);
      for (let i = 0; i < n; i++) marks[i] = view.marks[i] ?? 0;
      gl.uniform1i(composite.u("u_markCount"), n);
      gl.uniform1fv(composite.u("u_marks[0]"), marks);
      drawFullscreen(gl, null, w, h);
    },
    dispose() {
      for (const t of targets) deleteTarget(gl, t);
      targets = [];
      gl.deleteVertexArray(vao);
      for (const p of [bloomSrc, blur, composite]) gl.deleteProgram(p.program);
    },
  };
};
