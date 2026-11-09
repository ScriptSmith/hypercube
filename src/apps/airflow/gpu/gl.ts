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

export interface Texture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export interface TextureSpec {
  internal: number;
  /** Linear filtering; state textures are fetched texel by texel. */
  linear?: boolean;
}

export const createTexture = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  spec: TextureSpec,
): Texture => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, spec.internal, width, height);
  const filter = spec.linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, width, height };
};

/** A framebuffer drawing into one or more textures of the same size. */
export interface Target {
  readonly fbo: WebGLFramebuffer;
  readonly textures: readonly Texture[];
  readonly width: number;
  readonly height: number;
}

export const createTarget = (gl: WebGL2RenderingContext, textures: readonly Texture[]): Target => {
  const fbo = gl.createFramebuffer();
  const first = textures[0];
  if (!fbo || !first) throw new Error("framebuffer allocation failed");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const buffers: number[] = [];
  textures.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.texture, 0);
    buffers.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(buffers);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, textures, width: first.width, height: first.height };
};

export const deleteTarget = (
  gl: WebGL2RenderingContext,
  t: Target | null | undefined,
  withTextures = true,
): void => {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  if (withTextures) for (const x of t.textures) gl.deleteTexture(x.texture);
};

/** One texture with its own framebuffer. */
export const createSingle = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  spec: TextureSpec,
): Target => createTarget(gl, [createTexture(gl, width, height, spec)]);

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

/** Draw the fullscreen triangle into `target` (null for the canvas, sized `size`). */
export const drawFullscreen = (
  gl: WebGL2RenderingContext,
  target: Target | null,
  size?: { width: number; height: number },
): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  const w = target ? target.width : (size?.width ?? gl.drawingBufferWidth);
  const h = target ? target.height : (size?.height ?? gl.drawingBufferHeight);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};

/**
 * Reads a small target back without stalling: readPixels into a pixel buffer, a fence, and
 * the values collected in a later frame once the fence has passed.
 */
export interface Readback<T extends Uint8Array | Float32Array> {
  readonly busy: boolean;
  start(target: Target): void;
  poll(): T | null;
  dispose(): void;
}

export const createReadback = <T extends Uint8Array | Float32Array>(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  float: T extends Float32Array ? true : false,
): Readback<T> => {
  const data = (
    float ? new Float32Array(width * height * 4) : new Uint8Array(width * height * 4)
  ) as T;
  const pbo = gl.createBuffer();
  if (!pbo) throw new Error("buffer allocation failed");
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, data.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  let fence: WebGLSync | null = null;
  return {
    get busy() {
      return fence !== null;
    },
    start(target) {
      if (fence) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, width, height, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    },
    poll() {
      if (!fence || gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(fence);
      fence = null;
      return data;
    },
    dispose() {
      if (fence) gl.deleteSync(fence);
      fence = null;
      gl.deleteBuffer(pbo);
    },
  };
};

/** Read a float texture's first attachment now (tests and debugging only: it stalls). */
export const readFloats = (gl: WebGL2RenderingContext, target: Target, attachment = 0) => {
  const out = new Float32Array(target.width * target.height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, out);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
};
