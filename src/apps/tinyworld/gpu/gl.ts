/** Small WebGL2 helpers. Every function throws on failure so callers can treat it as context loss. */

export interface Program {
  readonly program: WebGLProgram;
  /** Uniform location by name, cached. Null for uniforms the compiler removed. */
  u(name: string): WebGLUniformLocation | null;
}

interface Linking {
  program: WebGLProgram;
  shaders: WebGLShader[];
}

/** Compile and link without asking how it went, which would wait for the driver to finish. */
const startProgram = (gl: WebGL2RenderingContext, vertex: string, fragment: string): Linking => {
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  const shaders: WebGLShader[] = [];
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("createShader failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    shaders.push(shader);
  }
  gl.linkProgram(program);
  return { program, shaders };
};

/**
 * Check the link (waiting for it if it hasn't finished) and fix sampler uniforms to texture
 * units for the program's lifetime, for textures that stay bound to one unit.
 */
const finishProgram = (
  gl: WebGL2RenderingContext,
  { program, shaders }: Linking,
  samplers: Record<string, number>,
): Program => {
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const logs = shaders.map((s) => gl.getShaderInfoLog(s) ?? "").filter(Boolean);
    throw new Error(`program link failed: ${[gl.getProgramInfoLog(program), ...logs].join(" ")}`);
  }
  for (const s of shaders) gl.deleteShader(s);
  const cache = new Map<string, WebGLUniformLocation | null>();
  gl.useProgram(program);
  for (const [name, unit] of Object.entries(samplers)) {
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }
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
  };
};

/**
 * Every program one context uses, keyed by fragment source and kept for the context's life, so
 * a resize only reallocates textures. A big shader can take the driver seconds to compile, and
 * asking for the result blocks the page until it's done; with KHR_parallel_shader_compile,
 * `ready` polls instead, so the page stays responsive while the programs build.
 */
export interface ProgramSet {
  /** True once every program named at creation has finished compiling. Never blocks. */
  ready(): boolean;
  /** A program by fragment source. One not named at creation is compiled now, blocking. */
  get(fragment: string): Program;
  dispose(): void;
}

const COMPLETION_STATUS_KHR = 0x91b1;

export const createProgramSet = (
  gl: WebGL2RenderingContext,
  vertex: string,
  fragments: string[],
  samplers: Record<string, number> = {},
): ProgramSet => {
  const parallel = gl.getExtension("KHR_parallel_shader_compile") !== null;
  const linking = new Map<string, Linking>();
  const done = new Map<string, Program>();
  for (const f of fragments) linking.set(f, startProgram(gl, vertex, f));
  let settled = !parallel;
  return {
    ready() {
      if (settled) return true;
      for (const l of linking.values()) {
        if (!gl.getProgramParameter(l.program, COMPLETION_STATUS_KHR)) return false;
      }
      settled = true;
      return true;
    },
    get(fragment) {
      let p = done.get(fragment);
      if (p) return p;
      let l = linking.get(fragment);
      if (!l) {
        l = startProgram(gl, vertex, fragment);
        linking.set(fragment, l);
      }
      p = finishProgram(gl, l, samplers);
      linking.delete(fragment);
      done.set(fragment, p);
      return p;
    },
    dispose() {
      for (const l of linking.values()) {
        for (const s of l.shaders) gl.deleteShader(s);
        gl.deleteProgram(l.program);
      }
      for (const p of done.values()) gl.deleteProgram(p.program);
      linking.clear();
      done.clear();
    },
  };
};

export interface Target {
  readonly texture: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

/** The world state: one RGBA8UI texel per cell, nearest sampling only. */
export const createStateTarget = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Target => {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!texture || !fbo) throw new Error("state target allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, width, height);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
    gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  checkFramebuffer(gl);
  return { texture, fbo, width, height };
};

/** A filterable RGBA8 colour target, optionally sharing a framebuffer with other attachments. */
export const createColorTexture = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

export const createColorTarget = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Target => {
  const texture = createColorTexture(gl, width, height);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error("framebuffer allocation failed");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  checkFramebuffer(gl);
  return { texture, fbo, width, height };
};

export const checkFramebuffer = (gl: WebGL2RenderingContext): void => {
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
};

export const deleteTarget = (gl: WebGL2RenderingContext, t: Target | null): void => {
  if (!t) return;
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.fbo);
};

/** Draw the fullscreen triangle into `fbo` (null for the canvas) at the given size. */
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

/** A small RGBA32F lookup table, bound to `unit` and left there. */
export const createLookupTexture = (
  gl: WebGL2RenderingContext,
  unit: number,
  width: number,
  height: number,
  data: Float32Array,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("texture allocation failed");
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
  return texture;
};
