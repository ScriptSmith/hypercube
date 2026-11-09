/** Small WebGL2 helpers. Each throws on failure so the caller can treat it like a lost context. */

export interface Program {
  readonly program: WebGLProgram;
  u(name: string): WebGLUniformLocation | null;
  use(): void;
}

const compile = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
};

export const createProgram = (
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): Program => {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? ""}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    u(name) {
      let loc = cache.get(name);
      if (loc === undefined) {
        loc = gl.getUniformLocation(program, name);
        cache.set(name, loc);
      }
      return loc;
    },
    use() {
      gl.useProgram(program);
    },
  };
};

/** A fullscreen triangle; every pass draws it. */
export const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_uv;
void main() {
  vec2 p = P[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export interface Target {
  readonly texture: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

export interface TargetSpec {
  internal: number;
  /** Linear filtering for colour targets; state targets are fetched texel by texel. */
  linear?: boolean;
  repeat?: boolean;
}

export const createTarget = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  spec: TargetSpec,
): Target => {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!texture || !fbo) throw new Error("target allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, spec.internal, width, height);
  const filter = spec.linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  const wrap = spec.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, fbo, width, height };
};

export const deleteTarget = (gl: WebGL2RenderingContext, t: Target | null | undefined): void => {
  if (!t) return;
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.fbo);
};

/** A small float data texture (no filtering), refilled from the CPU. */
export const createDataTexture = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

export const bindTexture = (
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  location: WebGLUniformLocation | null,
): void => {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(location, unit);
};

/** Draw the fullscreen triangle into `fbo` (null for the canvas). */
export const drawFullscreen = (
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null,
  width: number,
  height: number,
): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};

/** Ping-pong pair of state targets. */
export interface Pair {
  readonly front: Target;
  readonly back: Target;
  swap(): void;
  dispose(): void;
}

export const createPair = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  spec: TargetSpec,
): Pair => {
  let a = createTarget(gl, width, height, spec);
  let b = createTarget(gl, width, height, spec);
  return {
    get front() {
      return a;
    },
    get back() {
      return b;
    },
    swap() {
      [a, b] = [b, a];
    },
    dispose() {
      deleteTarget(gl, a);
      deleteTarget(gl, b);
    },
  };
};

/**
 * Reads a small RGBA8 target back without stalling: readPixels into a pixel buffer, a fence, and
 * the bytes collected in a later frame once the fence has passed.
 */
export interface Readback {
  readonly busy: boolean;
  start(target: Target): void;
  poll(): Uint8Array | null;
  dispose(): void;
}

export const createReadback = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Readback => {
  const bytes = new Uint8Array(width * height * 4);
  const pbo = gl.createBuffer();
  if (!pbo) throw new Error("buffer allocation failed");
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  let fence: WebGLSync | null = null;
  return {
    get busy() {
      return fence !== null;
    },
    start(target) {
      if (fence) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    },
    poll() {
      if (!fence || gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(fence);
      fence = null;
      return bytes;
    },
    dispose() {
      if (fence) gl.deleteSync(fence);
      fence = null;
      gl.deleteBuffer(pbo);
    },
  };
};

/** GLSL integer hash shared with `hash3` in `life.ts`. */
export const GLSL_HASH = `
uint hash3(uint x, uint y, uint z) {
  uint h = x * 0x165667b1u + y * 0x27d4eb2fu;
  h += z * 0x9e3779b1u;
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
float hashf(uint x, uint y, uint z) { return float(hash3(x, y, z) & 0xffffffu) / 16777216.0; }
`;
