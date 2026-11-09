/**
 * Draws the fluid as luminous ink in dark water, and the day's layers over the top of it.
 *
 * Ink: total density sets how opaque it is (1 - exp(-gain * density)), and its colour is the
 * density's hue with a little extra saturation, so a dense mix of related inks stays a colour
 * rather than going white or grey. The density's gradient lights it from above, which gives the
 * billows their depth.
 *
 * Layers: one row of the layer texture per band, COLUMNS texels across, linearly interpolated, so
 * a band only varies gently along its length. Band edges wave slightly (fixed waves, a little
 * less than a third of the thinnest band) and carry a fine sediment grain; the stack's lower edge
 * blends into the water.
 */
import { MAX_BANDS } from "../strata";
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

export const LAYER_COLUMNS = 32;

const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_dye;
uniform vec2 u_dyeTexel;
uniform vec2 u_venue;
uniform float u_gain;
uniform float u_light;
uniform sampler2D u_layers;
uniform int u_bands;
uniform float u_edges[${MAX_BANDS + 1}];
uniform float u_wave;
uniform float u_layerAlpha;
uniform float u_glow;
uniform vec3 u_glowRgb;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float density(vec2 uv) {
  vec3 d = max(texture(u_dye, uv).rgb, vec3(0.0));
  return d.r + d.g + d.b;
}

float wave(float x, float i) {
  return u_wave * (0.6 * sin(x * 0.0021 + i * 1.7) + 0.4 * sin(x * 0.0057 + i * 2.9));
}

void main() {
  vec2 venue = vec2(v_uv.x, 1.0 - v_uv.y) * u_venue;

  vec3 water = mix(vec3(0.006, 0.014, 0.03), vec3(0.016, 0.03, 0.055), v_uv.y);
  float vig = smoothstep(1.25, 0.35, length((v_uv - 0.5) * vec2(1.2, 1.0)));
  water *= 0.7 + 0.3 * vig;

  vec3 d = max(texture(u_dye, v_uv).rgb, vec3(0.0));
  float s = d.r + d.g + d.b;
  // Thin ink stays luminous rather than dimming towards brown: opacity rises steeply at first.
  float a = pow(1.0 - exp(-u_gain * s), 0.7);
  vec3 hue = d / max(max(d.r, max(d.g, d.b)), 1e-4);
  float l = dot(hue, vec3(0.299, 0.587, 0.114));
  hue = clamp(mix(vec3(l), hue, 1.3), 0.0, 1.0);
  float sx = density(v_uv + vec2(u_dyeTexel.x, 0.0)) - density(v_uv - vec2(u_dyeTexel.x, 0.0));
  float sy = density(v_uv + vec2(0.0, u_dyeTexel.y)) - density(v_uv - vec2(0.0, u_dyeTexel.y));
  vec3 n = normalize(vec3(-sx * u_light, -sy * u_light, 1.0));
  float lit = 0.78 + 0.32 * dot(n, normalize(vec3(-0.35, 0.75, 0.55)));
  vec3 ink = hue * (0.55 + 0.6 * a) * lit;
  vec3 col = mix(water, ink, a);

  if (u_bands > 0 && u_layerAlpha > 0.0) {
    float bottom = u_edges[u_bands] + wave(venue.x, float(u_bands));
    // The newest band's glow where ink is settling just under it.
    float under = venue.y - bottom;
    col += u_glowRgb * u_glow * u_layerAlpha * exp(-max(under, 0.0) / 60.0) * step(0.0, under) * 0.35;
    int band = -1;
    float lo = 0.0;
    float hi = 0.0;
    for (int i = 0; i < ${MAX_BANDS}; i++) {
      if (i >= u_bands) break;
      float top = i == 0 ? -1.0 : u_edges[i] + wave(venue.x, float(i));
      float bot = u_edges[i + 1] + wave(venue.x, float(i + 1));
      if (venue.y < bot) {
        band = i;
        lo = top;
        hi = bot;
        break;
      }
    }
    if (band >= 0) {
      vec4 t = texture(u_layers, vec2(v_uv.x, (float(band) + 0.5) / ${MAX_BANDS}.0));
      // Muted like sediment: a little greyer and darker than the ink that made it.
      float grey = dot(t.rgb, vec3(0.299, 0.587, 0.114));
      vec3 layer = mix(vec3(grey), t.rgb, 0.72) * (0.2 + 0.5 * t.a);
      // Graded bedding: each layer lighter at its top, darker where the next one settled on it.
      float depth = clamp((venue.y - lo) / max(1.0, hi - lo), 0.0, 1.0);
      layer *= 1.08 - 0.22 * depth;
      // Fine laminae and a soft grain, fixed in place.
      float lam = sin(venue.y * 0.55 + 2.0 * sin(venue.x * 0.0031 + float(band)));
      float grain = hash(floor(venue / 7.0)) - 0.5;
      layer *= 0.96 + 0.03 * lam + 0.04 * grain;
      float edge = min(venue.y - lo, hi - venue.y);
      layer *= mix(0.55, 1.0, smoothstep(0.0, 2.5, edge));
      float fade = band == u_bands - 1 ? smoothstep(0.0, 8.0, hi - venue.y) : 1.0;
      col = mix(col, layer, u_layerAlpha * fade);
    }
  }
  o = vec4(col, 1.0);
}`;

export interface LayerInputs {
  /** Band edges in venue px from the top: bands + 1 values. */
  edges: readonly number[];
  bands: number;
  wave: number;
  alpha: number;
  glow: number;
  glowRgb: readonly [number, number, number];
}

export interface InkView {
  /** Upload the bands' look: per band, COLUMNS RGB triples and levels. */
  setLayers(rows: readonly { rgb: Float32Array; level: Float32Array }[]): void;
  draw(
    dye: Target,
    venue: { width: number; height: number },
    gain: number,
    layers: LayerInputs,
    w: number,
    h: number,
    target?: WebGLFramebuffer | null,
  ): void;
  /** Draw into a small offscreen target and read it back (tests: brightness over time). */
  sample(
    dye: Target,
    venue: { width: number; height: number },
    gain: number,
    layers: LayerInputs,
    w: number,
    h: number,
  ): Uint8Array;
  dispose(): void;
}

export const createInkView = (gl: WebGL2RenderingContext): InkView => {
  const program: Program = createProgram(gl, FULLSCREEN_VS, FS);
  const vao = gl.createVertexArray();
  const layers = gl.createTexture();
  if (!layers) throw new Error("texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, layers);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, LAYER_COLUMNS, MAX_BANDS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const bytes = new Uint8Array(LAYER_COLUMNS * MAX_BANDS * 4);
  let probe: Target | null = null;
  const edges = new Float32Array(MAX_BANDS + 1);

  return {
    setLayers(rows) {
      bytes.fill(0);
      rows.slice(0, MAX_BANDS).forEach((r, b) => {
        for (let i = 0; i < LAYER_COLUMNS; i++) {
          const o = (b * LAYER_COLUMNS + i) * 4;
          bytes[o] = Math.round((r.rgb[i * 3] ?? 0) * 255);
          bytes[o + 1] = Math.round((r.rgb[i * 3 + 1] ?? 0) * 255);
          bytes[o + 2] = Math.round((r.rgb[i * 3 + 2] ?? 0) * 255);
          bytes[o + 3] = Math.round((r.level[i] ?? 0) * 255);
        }
      });
      gl.bindTexture(gl.TEXTURE_2D, layers);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        LAYER_COLUMNS,
        MAX_BANDS,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      );
    },
    draw(dye, venue, gain, l, w, h, target = null) {
      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND);
      program.use();
      bindTexture(gl, 0, dye.texture, program.u("u_dye"));
      bindTexture(gl, 1, layers, program.u("u_layers"));
      gl.uniform2f(program.u("u_dyeTexel"), 1 / dye.width, 1 / dye.height);
      gl.uniform2f(program.u("u_venue"), venue.width, venue.height);
      gl.uniform1f(program.u("u_gain"), gain);
      gl.uniform1f(program.u("u_light"), 1.4);
      edges.fill(0);
      for (let i = 0; i < Math.min(MAX_BANDS + 1, l.edges.length); i++) edges[i] = l.edges[i]!;
      gl.uniform1fv(program.u("u_edges"), edges);
      gl.uniform1i(program.u("u_bands"), Math.min(MAX_BANDS, l.bands));
      gl.uniform1f(program.u("u_wave"), l.wave);
      gl.uniform1f(program.u("u_layerAlpha"), l.alpha);
      gl.uniform1f(program.u("u_glow"), l.glow);
      gl.uniform3f(program.u("u_glowRgb"), l.glowRgb[0], l.glowRgb[1], l.glowRgb[2]);
      drawFullscreen(gl, target, w, h);
      gl.bindVertexArray(null);
    },
    sample(dye, venue, gain, l, w, h) {
      if (!probe || probe.width !== w || probe.height !== h) {
        deleteTarget(gl, probe);
        probe = createTarget(gl, w, h, { internal: gl.RGBA8 });
      }
      this.draw(dye, venue, gain, l, w, h, probe.fbo);
      const out = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    },
    dispose() {
      deleteTarget(gl, probe);
      program.dispose();
      gl.deleteTexture(layers);
      gl.deleteVertexArray(vao);
    },
  };
};
