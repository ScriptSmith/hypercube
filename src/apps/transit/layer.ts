/**
 * Vehicles and their trails, drawn in one MapLibre custom layer with instanced quads: a GeoJSON
 * source rebuilt every frame would be far too slow for a full fleet on a wall. Positions are in
 * mercator relative to the region's centre, so float32 keeps them steady when zoomed in.
 *
 * Glyphs are a rounded body with a notch at the back, pointing along the vehicle's heading on
 * screen (worked out in the shader, so map bearing and pitch need no special handling). A
 * vehicle whose heading isn't known yet is a round dot. Ferries are larger, trains longer.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import { trailPoints, type Vehicle, MAX_VEHICLES } from "./fleet";
import { localToMerc, ORIGIN_MX, ORIGIN_MY } from "./geo";

export const LAYER_ID = "transit-vehicles";
const GLYPH_FLOATS = 10;
const TRAIL_FLOATS = 10;
export const MAX_SEGMENTS = 60_000;
const TRAIL_REBUILD_MS = 150;

/** How one vehicle is drawn this frame, filled in by the app. */
export interface Look {
  r: number;
  g: number;
  b: number;
  alpha: number;
  scale: number;
  ring: number;
  /** 0 for none. */
  trailAlpha: number;
  /** Venue px. */
  trailWidth: number;
  /** Draw order: higher on top. 0, 1 or 2. */
  layer: number;
}

export interface LayerDeps {
  vehicles(): ReadonlyMap<number, Vehicle>;
  look(v: Vehicle, out: Look): void;
  /** Device px per glyph venue px at this zoom. */
  glyphPx(zoom: number): number;
  /** Device px per trail venue px. */
  trailPx(): number;
  trailAgeMs(): number;
  now(): number;
}

const MODE_INDEX: Record<Vehicle["mode"], number> = { bus: 0, train: 1, ferry: 2 };

const GLYPH_VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_px;
uniform float u_step;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in vec4 a_shape;
layout(location = 3) in vec4 a_color;
out vec2 v_local;
out vec4 v_color;
out vec3 v_dims;
out float v_ring;
out float v_emph;
out float v_aa;
void main() {
  vec4 c0 = u_matrix * vec4(a_pos, 0.0, 1.0);
  vec4 c1 = u_matrix * vec4(a_pos + vec2(sin(a_shape.x), -cos(a_shape.x)) * u_step, 0.0, 1.0);
  vec2 p0 = c0.xy / c0.w;
  vec2 d = (c1.xy / c1.w - p0) * u_viewport;
  vec2 fwd = dot(d, d) > 1e-12 ? normalize(d) : vec2(0.0, 1.0);
  vec2 side = vec2(fwd.y, -fwd.x);
  float kind = mod(a_shape.y, 4.0);
  vec2 hs = kind < 0.5 ? vec2(4.6, 8.2) : kind < 1.5 ? vec2(4.9, 12.5) : vec2(7.0, 11.5);
  hs *= a_shape.z;
  float pad = 3.0 + 7.0 * max(0.0, a_shape.z - 1.0) + a_shape.w * 12.0;
  vec2 local = a_corner * (hs + pad);
  vec2 off = (side * local.x + fwd * local.y) * u_px;
  gl_Position = c0.w > 0.0 ? vec4(p0 + off * 2.0 / u_viewport, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  v_local = local;
  v_color = a_color;
  v_dims = vec3(hs, a_shape.y);
  v_ring = a_shape.w;
  v_emph = clamp((a_shape.z - 1.0) * 3.0, 0.0, 1.0);
  v_aa = 1.0 / max(u_px, 0.05);
}`;

const GLYPH_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
in vec3 v_dims;
in float v_ring;
in float v_emph;
in float v_aa;
out vec4 frag;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 h = v_dims.xy;
  bool round = v_dims.z > 3.5;
  float d;
  if (round) {
    d = length(v_local) - max(h.x, h.y * 0.62);
  } else {
    d = box(v_local, h, min(h.x, h.y) * 0.85);
    float notch = (v_local.y + h.y) - (h.x - abs(v_local.x)) * 0.75;
    d = max(d, -notch);
  }
  float fill = 1.0 - smoothstep(-v_aa, v_aa, d);
  float edge = 1.0 - smoothstep(-v_aa, v_aa, d - 1.5);
  float nose = round ? 0.0 : smoothstep(h.y * 0.2, h.y * 0.75, v_local.y);
  vec3 body = mix(v_color.rgb, vec3(1.0), 0.5 * nose);
  float ga = v_emph * 0.55 * exp(-max(d, 0.0) / 3.5) * (1.0 - fill);
  vec3 rgb = v_color.rgb * ga;
  float a = ga;
  float oa = 0.85 * clamp(edge - fill, 0.0, 1.0);
  rgb = rgb * (1.0 - oa) + vec3(0.02, 0.03, 0.05) * oa;
  a = a * (1.0 - oa) + oa;
  rgb = rgb * (1.0 - fill) + body * fill;
  a = a * (1.0 - fill) + fill;
  float r = max(h.x, h.y) + 7.0;
  float ra = v_ring * (1.0 - smoothstep(0.7, 2.0, abs(length(v_local) - r)));
  rgb = rgb * (1.0 - ra) + vec3(1.0) * ra;
  a = a * (1.0 - ra) + ra;
  frag = vec4(rgb, a) * v_color.a;
}`;

const TRAIL_VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_px;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_seg;
layout(location = 2) in vec4 a_col;
layout(location = 3) in vec2 a_alpha;
out float v_a;
out float v_across;
out vec3 v_rgb;
void main() {
  vec4 ca = u_matrix * vec4(a_seg.xy, 0.0, 1.0);
  vec4 cb = u_matrix * vec4(a_seg.zw, 0.0, 1.0);
  vec2 pa = ca.xy / ca.w;
  vec2 pb = cb.xy / cb.w;
  vec2 d = (pb - pa) * u_viewport;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float hw = 0.5 * a_col.w * u_px + 0.75;
  vec2 p = mix(pa, pb, a_corner.x);
  bool ok = ca.w > 0.0 && cb.w > 0.0;
  gl_Position = ok ? vec4(p + n * a_corner.y * hw * 2.0 / u_viewport, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  v_a = mix(a_alpha.x, a_alpha.y, a_corner.x);
  v_across = a_corner.y;
  v_rgb = a_col.rgb;
}`;

const TRAIL_FS = `#version 300 es
precision highp float;
in float v_a;
in float v_across;
in vec3 v_rgb;
out vec4 frag;
void main() {
  float a = v_a * (1.0 - smoothstep(0.5, 1.0, abs(v_across)));
  frag = vec4(v_rgb * a, a);
}`;

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

const compile = (
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  uniforms: string[],
): Program => {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`transit shader: ${gl.getShaderInfoLog(s) ?? "compile failed"}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  const v = shader(gl.VERTEX_SHADER, vs);
  const f = shader(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`transit program: ${gl.getProgramInfoLog(prog) ?? "link failed"}`);
  }
  const u: Program["u"] = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
  return { prog, u };
};

/** MapLibre's matrix times a translation to the region's centre, in float64. */
export const rtcMatrix = (m: ArrayLike<number>, out: Float32Array): Float32Array => {
  for (let i = 0; i < 16; i++) out[i] = m[i]!;
  for (let r = 0; r < 4; r++) out[12 + r] = m[r]! * ORIGIN_MX + m[4 + r]! * ORIGIN_MY + m[12 + r]!;
  return out;
};

export interface VehicleLayer extends CustomLayerInterface {
  /** Glyphs and trail segments drawn in the last frame. */
  stats(): { glyphs: number; segments: number; frames: number };
  /** The map lost its GL context; the layer is re-added when it comes back. */
  contextLost(): void;
}

export const createVehicleLayer = (deps: LayerDeps): VehicleLayer => {
  let gl: WebGL2RenderingContext | null = null;
  let map: MlMap | null = null;
  let glyph: Program | null = null;
  let trail: Program | null = null;
  let glyphVao: WebGLVertexArrayObject | null = null;
  let trailVao: WebGLVertexArrayObject | null = null;
  let glyphBuf: WebGLBuffer | null = null;
  let trailBuf: WebGLBuffer | null = null;
  let quadBuf: WebGLBuffer | null = null;
  let stripBuf: WebGLBuffer | null = null;
  const glyphData = new Float32Array(MAX_VEHICLES * GLYPH_FLOATS);
  const trailData = new Float32Array(MAX_SEGMENTS * TRAIL_FLOATS);
  const matrix = new Float32Array(16);
  const look: Look = {
    r: 1,
    g: 1,
    b: 1,
    alpha: 1,
    scale: 1,
    ring: 0,
    trailAlpha: 0,
    trailWidth: 0,
    layer: 1,
  };
  const pts: number[] = [];
  const merc = new Float32Array(2);
  let glyphs = 0;
  let segments = 0;
  let frames = 0;
  let trailAt = 0;
  /** The GL context was lost: our objects died with it. */
  let stale = false;
  const order: Vehicle[][] = [[], [], []];
  const looks = new Map<number, Look>();

  const setup = (g: WebGL2RenderingContext) => {
    glyph = compile(g, GLYPH_VS, GLYPH_FS, ["u_matrix", "u_viewport", "u_px", "u_step"]);
    trail = compile(g, TRAIL_VS, TRAIL_FS, ["u_matrix", "u_viewport", "u_px"]);
    quadBuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quadBuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    stripBuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, stripBuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), g.STATIC_DRAW);
    glyphBuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, glyphBuf);
    g.bufferData(g.ARRAY_BUFFER, glyphData.byteLength, g.DYNAMIC_DRAW);
    trailBuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, trailBuf);
    g.bufferData(g.ARRAY_BUFFER, trailData.byteLength, g.DYNAMIC_DRAW);

    const inst = (loc: number, size: number, stride: number, offset: number) => {
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, size, g.FLOAT, false, stride, offset);
      g.vertexAttribDivisor(loc, 1);
    };
    glyphVao = g.createVertexArray();
    g.bindVertexArray(glyphVao);
    g.bindBuffer(g.ARRAY_BUFFER, quadBuf);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, glyphBuf);
    const gs = GLYPH_FLOATS * 4;
    inst(1, 2, gs, 0);
    inst(2, 4, gs, 8);
    inst(3, 4, gs, 24);
    trailVao = g.createVertexArray();
    g.bindVertexArray(trailVao);
    g.bindBuffer(g.ARRAY_BUFFER, stripBuf);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, trailBuf);
    const ts = TRAIL_FLOATS * 4;
    inst(1, 4, ts, 0);
    inst(2, 4, ts, 16);
    inst(3, 2, ts, 32);
    g.bindVertexArray(null);
    g.bindBuffer(g.ARRAY_BUFFER, null);
  };

  const lookOf = (v: Vehicle): Look => {
    let l = looks.get(v.key);
    if (!l) {
      l = { ...look };
      looks.set(v.key, l);
    }
    deps.look(v, l);
    return l;
  };

  const fillGlyphs = (): number => {
    for (const list of order) list.length = 0;
    for (const v of deps.vehicles().values()) {
      if (v.alpha <= 0) continue;
      const l = lookOf(v);
      if (l.alpha <= 0) continue;
      order[Math.max(0, Math.min(2, l.layer))]!.push(v);
    }
    let n = 0;
    for (const list of order) {
      for (const v of list) {
        if (n >= MAX_VEHICLES) break;
        const l = looks.get(v.key)!;
        const o = n * GLYPH_FLOATS;
        localToMerc(v.x, v.y, merc);
        glyphData[o] = merc[0]!;
        glyphData[o + 1] = merc[1]!;
        glyphData[o + 2] = v.heading;
        glyphData[o + 3] = MODE_INDEX[v.mode] + (v.headingKnown ? 0 : 4);
        glyphData[o + 4] = l.scale;
        glyphData[o + 5] = l.ring;
        glyphData[o + 6] = l.r;
        glyphData[o + 7] = l.g;
        glyphData[o + 8] = l.b;
        glyphData[o + 9] = l.alpha * v.alpha;
        n++;
      }
    }
    if (looks.size > deps.vehicles().size * 2 + 64) {
      for (const k of looks.keys()) if (!deps.vehicles().has(k)) looks.delete(k);
    }
    return n;
  };

  const fillTrails = (now: number): number => {
    let n = 0;
    const maxAge = deps.trailAgeMs();
    for (const list of order) {
      for (const v of list) {
        const l = looks.get(v.key);
        if (!l || l.trailAlpha <= 0 || v.trailN === 0) continue;
        trailPoints(v, pts, maxAge, now);
        const count = pts.length / 2;
        if (count < 2) continue;
        const base = l.trailAlpha * v.alpha;
        let ax = 0;
        let ay = 0;
        for (let i = 0; i < count; i++) {
          localToMerc(pts[i * 2]!, pts[i * 2 + 1]!, merc);
          if (i > 0) {
            if (n >= MAX_SEGMENTS) return n;
            const o = n * TRAIL_FLOATS;
            trailData[o] = ax;
            trailData[o + 1] = ay;
            trailData[o + 2] = merc[0]!;
            trailData[o + 3] = merc[1]!;
            trailData[o + 4] = l.r;
            trailData[o + 5] = l.g;
            trailData[o + 6] = l.b;
            trailData[o + 7] = l.trailWidth;
            trailData[o + 8] = base * ((i - 1) / (count - 1)) ** 1.5;
            trailData[o + 9] = base * (i / (count - 1)) ** 1.5;
            n++;
          }
          ax = merc[0]!;
          ay = merc[1]!;
        }
      }
    }
    return n;
  };

  const layer: VehicleLayer = {
    id: LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    onAdd(m, g) {
      map = m;
      gl = g;
      stale = false;
      setup(g);
    },
    onRemove(_m, g) {
      // After a lost context the old objects are already gone and belong to nothing.
      if (!stale) {
        g.deleteProgram(glyph?.prog ?? null);
        g.deleteProgram(trail?.prog ?? null);
        for (const b of [glyphBuf, trailBuf, quadBuf, stripBuf]) g.deleteBuffer(b);
        g.deleteVertexArray(glyphVao);
        g.deleteVertexArray(trailVao);
      }
      stale = false;
      glyph = trail = null;
      gl = null;
      map = null;
      looks.clear();
    },
    render(g: WebGL2RenderingContext, input: CustomRenderMethodInput) {
      if (!gl || !map || !glyph || !trail || g.isContextLost()) return;
      frames++;
      const now = deps.now();
      const zoom = map.getZoom();
      rtcMatrix(input.defaultProjectionData.mainMatrix, matrix);
      glyphs = fillGlyphs();
      g.disable(g.DEPTH_TEST);
      g.disable(g.STENCIL_TEST);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      const vw = g.drawingBufferWidth;
      const vh = g.drawingBufferHeight;

      if (now - trailAt >= TRAIL_REBUILD_MS) {
        trailAt = now;
        segments = fillTrails(now);
        if (segments > 0) {
          g.bindBuffer(g.ARRAY_BUFFER, trailBuf);
          g.bufferSubData(g.ARRAY_BUFFER, 0, trailData, 0, segments * TRAIL_FLOATS);
        }
      }
      if (segments > 0) {
        g.useProgram(trail.prog);
        g.uniformMatrix4fv(trail.u.u_matrix!, false, matrix);
        g.uniform2f(trail.u.u_viewport!, vw, vh);
        g.uniform1f(trail.u.u_px!, deps.trailPx());
        g.bindVertexArray(trailVao);
        g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, segments);
      }
      if (glyphs > 0) {
        g.bindBuffer(g.ARRAY_BUFFER, glyphBuf);
        g.bufferSubData(g.ARRAY_BUFFER, 0, glyphData, 0, glyphs * GLYPH_FLOATS);
        g.useProgram(glyph.prog);
        g.uniformMatrix4fv(glyph.u.u_matrix!, false, matrix);
        g.uniform2f(glyph.u.u_viewport!, vw, vh);
        g.uniform1f(glyph.u.u_px!, deps.glyphPx(zoom));
        g.uniform1f(glyph.u.u_step!, 20 / (512 * 2 ** zoom));
        g.bindVertexArray(glyphVao);
        g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, glyphs);
      }
      g.bindVertexArray(null);
      g.bindBuffer(g.ARRAY_BUFFER, null);
    },
    stats: () => ({ glyphs, segments, frames }),
    contextLost() {
      stale = true;
    },
  };
  return layer;
};
