/** Small WebGL2 helpers. Each throws on failure so the caller can treat it like a lost context. */

export interface Program {
  readonly program: WebGLProgram;
  u(name: string): WebGLUniformLocation | null;
  use(): void;
  dispose(): void;
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
    dispose() {
      gl.deleteProgram(program);
      cache.clear();
    },
  };
};

/** A fullscreen triangle; every pass draws it. `v_uv` runs 0 to 1 with y up. */
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
  linear?: boolean;
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

export const clearTarget = (gl: WebGL2RenderingContext, t: Target): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, t.width, t.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
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

/** Read a float target synchronously (tests and debugging only: it stalls the pipeline). */
export const readFloats = (gl: WebGL2RenderingContext, t: Target): Float32Array => {
  const out = new Float32Array(t.width * t.height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
};
