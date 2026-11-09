import type { Mode } from "../modes";
import { DRAW_FS, DRAW_VS, FULLSCREEN_VS, MAX_MODES, STEP_FS } from "./shaders";

/** Small WebGL2 helpers. Each throws on failure so the caller can treat it like a lost context. */
interface Program {
  readonly program: WebGLProgram;
  u(name: string): WebGLUniformLocation | null;
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

const createProgram = (gl: WebGL2RenderingContext, vs: string, fs: string): Program => {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
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
  };
};

interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
}

const createTarget = (gl: WebGL2RenderingContext, width: number, height: number): Target => {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!texture || !fbo) throw new Error("target allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16UI, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, fbo };
};

/** The programs, shared by every plate on one context. */
export interface SandKit {
  readonly gl: WebGL2RenderingContext;
  readonly step: Program;
  readonly draw: Program;
  readonly vao: WebGLVertexArrayObject;
  dispose(): void;
}

export const createSandKit = (gl: WebGL2RenderingContext): SandKit => {
  const step = createProgram(gl, FULLSCREEN_VS, STEP_FS);
  const draw = createProgram(gl, DRAW_VS, DRAW_FS);
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  return {
    gl,
    step,
    draw,
    vao,
    dispose() {
      gl.deleteProgram(step.program);
      gl.deleteProgram(draw.program);
      gl.deleteVertexArray(vao);
    },
  };
};

export interface StepInput {
  round: boolean;
  modes: readonly Mode[];
  /** Mode indices to evaluate, strongest first, at most MAX_MODES. */
  active: readonly number[];
  /** Each mode's in-step and quarter-cycle amplitude. */
  re: ArrayLike<number>;
  im: ArrayLike<number>;
  /** The plate's half sides in true lengths. */
  half: { hx: number; hy: number };
  level: number;
  wave2: number;
  lift: number;
  dt: number;
  tick: number;
  /** Grains to sprinkle afresh this step, or null. */
  sprinkle: { seed: number; from: number; to: number } | null;
  /** Share of the grains to step and draw (the rest wait), when frames run slow. */
  share: number;
}

export interface DrawInput {
  /** The plate's rectangle in clip space: left, top, right, bottom. */
  rect: [number, number, number, number];
  /** Grain size in device px. */
  size: number;
  shiver: number;
  tick: number;
  tint: 0 | 1 | 2;
  alpha: number;
  share: number;
}

export interface Sand {
  readonly count: number;
  readonly width: number;
  readonly height: number;
  step(input: StepInput): void;
  /** Scatter every grain evenly, in both state textures. */
  fill(seed: number, input: Omit<StepInput, "sprinkle" | "active">): void;
  draw(input: DrawInput): void;
  /** Every grain's plate position (u, v pairs) and motion, read back synchronously. Tests only. */
  read(): { u: Float32Array; v: Float32Array; motion: Float32Array };
  dispose(): void;
}

const modeParams = new Float32Array(MAX_MODES * 4);
const modeAmps = new Float32Array(MAX_MODES * 2);

export const createSand = (
  kit: SandKit,
  size: { width: number; height: number },
  seed: number,
): Sand => {
  const { gl } = kit;
  let front = createTarget(gl, size.width, size.height);
  let back = createTarget(gl, size.width, size.height);
  const count = size.width * size.height;
  const rows = (share: number) =>
    Math.max(1, Math.min(size.height, Math.ceil(size.height * Math.min(1, Math.max(0.05, share)))));

  const runStep = (input: StepInput) => {
    const p = kit.step;
    gl.useProgram(p.program);
    gl.bindVertexArray(kit.vao);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, front.texture);
    gl.uniform1i(p.u("u_state"), 0);
    gl.uniform1i(p.u("u_round"), input.round ? 1 : 0);
    const n = Math.min(MAX_MODES, input.active.length);
    modeParams.fill(0);
    modeAmps.fill(0);
    for (let i = 0; i < n; i++) {
      const at = input.active[i]!;
      const m = input.modes[at]!;
      if (m.shape === "square") modeParams.set([m.n, m.m, m.a * m.scale, m.b * m.scale], i * 4);
      else modeParams.set([m.n, m.k, m.scale, m.turn], i * 4);
      modeAmps[i * 2] = input.re[at] ?? 0;
      modeAmps[i * 2 + 1] = input.im[at] ?? 0;
    }
    gl.uniform1i(p.u("u_count"), n);
    gl.uniform4fv(p.u("u_mode"), modeParams);
    gl.uniform2fv(p.u("u_amp"), modeAmps);
    gl.uniform2f(p.u("u_half"), input.half.hx, input.half.hy);
    gl.uniform1f(p.u("u_level"), input.level);
    gl.uniform1f(p.u("u_wave2"), input.wave2);
    gl.uniform1f(p.u("u_lift"), input.lift);
    gl.uniform1f(p.u("u_dt"), input.dt);
    gl.uniform1ui(p.u("u_tick"), input.tick >>> 0);
    const sp = input.sprinkle;
    gl.uniform1ui(p.u("u_seed"), (sp?.seed ?? seed) >>> 0);
    gl.uniform2f(p.u("u_span"), sp ? sp.from : 2, sp ? sp.to : 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, back.fbo);
    // A sprinkle reaches every grain, so none is left behind where it was.
    gl.viewport(0, 0, size.width, sp ? size.height : rows(input.share));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    [front, back] = [back, front];
  };

  return {
    count,
    width: size.width,
    height: size.height,
    step: runStep,
    fill(s, input) {
      const all = { ...input, active: [], sprinkle: { seed: s, from: 0, to: 2 } };
      runStep(all);
      runStep(all);
    },
    draw(input) {
      const p = kit.draw;
      gl.useProgram(p.program);
      gl.bindVertexArray(kit.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, front.texture);
      gl.uniform1i(p.u("u_state"), 0);
      gl.uniform4f(p.u("u_rect"), ...input.rect);
      gl.uniform1f(p.u("u_size"), input.size);
      gl.uniform1f(p.u("u_shiver"), input.shiver);
      gl.uniform1ui(p.u("u_tick"), input.tick >>> 0);
      gl.uniform1i(p.u("u_tint"), input.tint);
      gl.uniform1f(p.u("u_alpha"), input.alpha);
      gl.uniform1f(p.u("u_soft"), input.size > 2.5 ? 1 : 0);
      gl.drawArrays(gl.POINTS, 0, rows(input.share) * size.width);
    },
    read() {
      const data = new Uint32Array(count * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, front.fbo);
      gl.readPixels(0, 0, size.width, size.height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const u = new Float32Array(count);
      const v = new Float32Array(count);
      const motion = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        u[i] = (data[i * 4]! / 65535) * 2 - 1;
        v[i] = (data[i * 4 + 1]! / 65535) * 2 - 1;
        motion[i] = data[i * 4 + 3]! / 32767;
      }
      return { u, v, motion };
    },
    dispose() {
      gl.deleteTexture(front.texture);
      gl.deleteFramebuffer(front.fbo);
      gl.deleteTexture(back.texture);
      gl.deleteFramebuffer(back.fbo);
    },
  };
};
