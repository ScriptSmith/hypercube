/**
 * A small WebGL2 sprite batcher: textured, tinted, rotated quads from one atlas, drawn as
 * instances in as few calls as possible. Panels and the screen both draw with it, so a full
 * redraw of a 4000 x 3600 screen is a few hundred instances rather than Canvas2D paths.
 *
 * Colours are premultiplied. An instance with `add` set draws additively (glows, sparks).
 * On context loss it waits for the browser to restore the context, and if that doesn't happen
 * soon it replaces the canvas, then rebuilds everything from the atlas it keeps.
 */

/** A sprite's place in the atlas, in texture coordinates, and its size in atlas px. */
export interface Region {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

export interface Gfx {
  readonly ready: boolean;
  /** Set the drawing buffer size in device px. */
  resize(width: number, height: number): void;
  setAtlas(source: HTMLCanvasElement): void;
  /** Start a frame, cleared to `rgb` (0 to 1). False when nothing can be drawn now. */
  begin(r: number, g: number, b: number): boolean;
  /**
   * Draw a region. (x, y) is where the anchor (fractions of the sprite, 0.5 is the middle) lands,
   * in device px; `rot` turns about the anchor. `sub` crops the region (fractions u0 v0 u1 v1).
   */
  sprite(
    reg: Region,
    x: number,
    y: number,
    w: number,
    h: number,
    color: Rgb,
    alpha: number,
    rot?: number,
    ax?: number,
    ay?: number,
    add?: boolean,
    sub?: readonly [number, number, number, number],
  ): void;
  /** Draw only inside this device px rect until the next clip; null draws everywhere. */
  clip(x: number, y: number, w: number, h: number): void;
  unclip(): void;
  end(): void;
  dispose(): void;
}

/** A colour as 0 to 1 floats. */
export type Rgb = readonly [number, number, number];

export const rgb = (hex: string): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? Number.parseInt(m[1]!, 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const WHITE: Rgb = [1, 1, 1];

const FLOATS = 16;
const MAX_INSTANCES = 4096;
const RESTORE_WAIT_MS = 4000;

const VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;
layout(location=2) in vec4 xform;
layout(location=3) in vec4 uv;
layout(location=4) in vec4 color;
uniform vec2 view;
out vec2 vUv;
out vec4 vColor;
out float vAdd;
void main() {
  vec2 local = (corner - xform.xy) * rect.zw;
  float c = cos(xform.z);
  float s = sin(xform.z);
  vec2 p = rect.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0.0, 1.0);
  vUv = mix(uv.xy, uv.zw, corner);
  vColor = color;
  vAdd = xform.w;
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D atlas;
in vec2 vUv;
in vec4 vColor;
in float vAdd;
out vec4 outColor;
void main() {
  vec4 t = texture(atlas, vUv);
  vec4 c = vec4(t.rgb * vColor.rgb, t.a) * vColor.a;
  outColor = vec4(c.rgb, c.a * (1.0 - vAdd));
}`;

interface Resources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  corners: WebGLBuffer;
  instances: WebGLBuffer;
  texture: WebGLTexture | null;
  view: WebGLUniformLocation | null;
}

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`shader: ${gl.getShaderInfoLog(s) ?? "?"}`);
  }
  return s;
};

export const createGfx = (host: HTMLElement, z: number, onError: (msg: string) => void): Gfx => {
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let res: Resources | null = null;
  let atlas: HTMLCanvasElement | null = null;
  let size = { w: 1, h: 1 };
  let timer = 0;
  let disposed = false;
  let reported = false;
  const data = new Float32Array(MAX_INSTANCES * FLOATS);
  let count = 0;

  const report = (msg: string) => {
    if (reported) return;
    reported = true;
    onError(msg);
  };

  const upload = () => {
    if (!gl || !res || !atlas) return;
    if (res.texture) gl.deleteTexture(res.texture);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    res.texture = tex;
  };

  const build = () => {
    if (!gl || gl.isContextLost()) return;
    try {
      const program = gl.createProgram();
      if (!program) throw new Error("createProgram failed");
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
        throw new Error(`link: ${gl.getProgramInfoLog(program) ?? "?"}`);
      }
      const vao = gl.createVertexArray();
      const corners = gl.createBuffer();
      const instances = gl.createBuffer();
      if (!vao || !corners || !instances) throw new Error("buffer setup failed");
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(1 + i);
        gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
        gl.vertexAttribDivisor(1 + i, 1);
      }
      gl.bindVertexArray(null);
      res = {
        program,
        vao,
        corners,
        instances,
        texture: null,
        view: gl.getUniformLocation(program, "view"),
      };
      upload();
    } catch (err) {
      if (gl.isContextLost()) return;
      res = null;
      report(`treetop: WebGL setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    res = null;
    clearTimeout(timer);
    timer = window.setTimeout(replace, RESTORE_WAIT_MS);
  };
  const onRestored = () => {
    clearTimeout(timer);
    build();
  };

  function replace() {
    if (disposed) return;
    if (canvas) {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      canvas.remove();
    }
    res = null;
    canvas = document.createElement("canvas");
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;z-index:${z};`;
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    host.prepend(canvas);
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      report("treetop: WebGL2 is not available");
      return;
    }
    build();
  }

  const flush = () => {
    if (!gl || !res || count === 0) {
      count = 0;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, res.instances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    count = 0;
  };

  replace();

  return {
    get ready() {
      return !!gl && !!res && !!res.texture && !gl.isContextLost();
    },
    resize(width, height) {
      size = { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) };
      if (canvas && (canvas.width !== size.w || canvas.height !== size.h)) {
        canvas.width = size.w;
        canvas.height = size.h;
      }
    },
    setAtlas(source) {
      atlas = source;
      upload();
    },
    begin(r, g, b) {
      if (!gl || !res || !res.texture || gl.isContextLost()) return false;
      gl.viewport(0, 0, size.w, size.h);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(r, g, b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(res.program);
      gl.uniform2f(res.view, size.w, size.h);
      gl.bindVertexArray(res.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.texture);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      count = 0;
      return true;
    },
    sprite(reg, x, y, w, h, color, alpha, rot = 0, ax = 0.5, ay = 0.5, add = false, sub) {
      if (alpha <= 0.002 || w === 0 || h === 0) return;
      if (count >= MAX_INSTANCES) flush();
      const o = count * FLOATS;
      const du = reg.u1 - reg.u0;
      const dv = reg.v1 - reg.v0;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = w;
      data[o + 3] = h;
      data[o + 4] = ax;
      data[o + 5] = ay;
      data[o + 6] = rot;
      data[o + 7] = add ? 1 : 0;
      data[o + 8] = sub ? reg.u0 + du * sub[0] : reg.u0;
      data[o + 9] = sub ? reg.v0 + dv * sub[1] : reg.v0;
      data[o + 10] = sub ? reg.u0 + du * sub[2] : reg.u1;
      data[o + 11] = sub ? reg.v0 + dv * sub[3] : reg.v1;
      data[o + 12] = color[0];
      data[o + 13] = color[1];
      data[o + 14] = color[2];
      data[o + 15] = Math.min(1, alpha);
      count++;
    },
    clip(x, y, w, h) {
      flush();
      if (!gl) return;
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(size.w, Math.ceil(x + w));
      const y1 = Math.min(size.h, Math.ceil(y + h));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, size.h - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    },
    unclip() {
      flush();
      gl?.disable(gl.SCISSOR_TEST);
    },
    end() {
      flush();
      gl?.disable(gl.SCISSOR_TEST);
      gl?.bindVertexArray(null);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      if (gl && res && !gl.isContextLost()) {
        gl.deleteProgram(res.program);
        gl.deleteVertexArray(res.vao);
        gl.deleteBuffer(res.corners);
        gl.deleteBuffer(res.instances);
        if (res.texture) gl.deleteTexture(res.texture);
      }
      res = null;
      if (canvas) {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        canvas.remove();
      }
      // Let the browser reclaim the context now rather than at garbage collection.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      canvas = null;
      atlas = null;
    },
  };
};
