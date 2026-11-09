import { MAX_SHAPES } from "../lattice";
import {
  bindTexture,
  createProgram,
  createReadback,
  createSingle,
  createTarget,
  createTexture,
  deleteTarget,
  drawFullscreen,
  type Program,
  readFloats,
  type Target,
} from "./gl";
import {
  ADVECT_FS,
  CORRECT_FS,
  FORCES_FS,
  FULLSCREEN_VS,
  INIT_FS,
  MACRO_FS,
  MASK_FS,
  MASK_VS,
  PLUME_FS,
  PROBE_FS,
  RENDER_FS,
  STEP_FS,
} from "./shaders";

/** Programs shared by every solver on one context. */
export interface Kit {
  readonly gl: WebGL2RenderingContext;
  readonly programs: Record<
    | "step"
    | "init"
    | "macro"
    | "mask"
    | "advect"
    | "correct"
    | "render"
    | "forces"
    | "plume"
    | "probe",
    Program
  >;
  readonly empty: WebGLVertexArrayObject;
  dispose(): void;
}

export const createKit = (gl: WebGL2RenderingContext): Kit => {
  const made: Program[] = [];
  const make = (vs: string, fs: string) => {
    const p = createProgram(gl, vs, fs);
    made.push(p);
    return p;
  };
  try {
    const programs = {
      step: make(FULLSCREEN_VS, STEP_FS),
      init: make(FULLSCREEN_VS, INIT_FS),
      macro: make(FULLSCREEN_VS, MACRO_FS),
      mask: make(MASK_VS, MASK_FS),
      advect: make(FULLSCREEN_VS, ADVECT_FS),
      correct: make(FULLSCREEN_VS, CORRECT_FS),
      render: make(FULLSCREEN_VS, RENDER_FS),
      forces: make(FULLSCREEN_VS, FORCES_FS),
      plume: make(FULLSCREEN_VS, PLUME_FS),
      probe: make(FULLSCREEN_VS, PROBE_FS),
    };
    const empty = gl.createVertexArray();
    if (!empty) throw new Error("vertex array allocation failed");
    return {
      gl,
      programs,
      empty,
      dispose() {
        for (const p of made) gl.deleteProgram(p.program);
        gl.deleteVertexArray(empty);
      },
    };
  } catch (err) {
    for (const p of made) gl.deleteProgram(p.program);
    throw err;
  }
};

/** An affine map: (x, y) to (r0 . (x, y, 1), r1 . (x, y, 1)). */
export interface Affine {
  r0: [number, number, number];
  r1: [number, number, number];
}

export interface StepParams {
  smagorinsky: number;
  spongeFrom: number;
  spongeTau: number;
  forceEma: number;
  /** Relaxation time of the stress's trace (0: the shear's). See LatticeParams.bulk. */
  bulk: number;
  /** A non-reflecting inlet. See LatticeParams.soft. */
  soft: boolean;
}

export interface RenderSpec {
  /** Canvas pixels (y down) to grid cells. */
  toGrid: Affine;
  canvas: { width: number; height: number };
  view: number;
  uref: number;
  /** Vorticity at which swirl colours saturate. */
  wref: number;
  tints: readonly [number, number, number][];
  back: [number, number, number];
}

export interface PlumeSpec {
  /** Venue px to grid cells. */
  toGrid: Affine;
  /** Venue y of the sampling line and the frame's venue width. */
  line: number;
  width: number;
  samples: number;
  /** Grid velocity to (up, right): up = d0 . v, right = d1 . v. */
  dir: [number, number, number, number];
  uref: number;
  range: number;
}

/** Rows each shape's force sum is spread over. */
export const FORCE_ROWS = 64;
/** Cells per side of each health probe block. */
export const PROBE_BLOCK = 8;
/** Floats per mask vertex: x, y (grid cells), vx, vy (lattice units), id. */
export const MASK_FLOATS = 5;
const MAX_MASK_VERTICES = 6000;

export interface Solver {
  readonly width: number;
  readonly height: number;
  readonly visible: number;
  /** Inlet rows: per row (u, v, tau, 0), then per row (smoke r, g, b, 0). */
  setInlet(data: Float32Array): void;
  /** Restart: the inlet's flow everywhere and its smoke streaks across the whole tunnel. */
  init(): void;
  /** Redraw the solids from triangles (MASK_FLOATS per vertex). */
  drawMask(vertices: Float32Array, count: number): void;
  /** Replace the mask with RGBA bytes (tests). */
  uploadMask(bytes: Uint8Array): void;
  step(n: number, p: StepParams): void;
  /** Velocity for the smoke, the picture and the samplers; call after stepping. */
  macro(): void;
  /** Move the smoke by `steps` lattice steps of the current flow, fading it by `fade`. */
  advect(steps: number, fade: number, inject: number): void;
  render(spec: RenderSpec): void;
  /** Start reading the forces on each shape inside boxes [x0, y0, x1, y1] (grid cells). */
  requestForces(boxes: readonly (readonly [number, number, number, number])[]): void;
  /** Per shape: force x, force y and cells counted, once a request has finished. */
  pollForces(): Float32Array | null;
  requestPlume(spec: PlumeSpec): void;
  /** Bytes: samples x 2 rows of RGBA. */
  pollPlume(): Uint8Array | null;
  requestProbe(): void;
  pollProbe(): Uint8Array | null;
  /** Probe texture size, in blocks. */
  readonly probeSize: { width: number; height: number };
  /** The three population textures as floats (tests; it stalls). */
  readPopulations(): Float32Array[];
  /** Velocity, density - 1 and the solid flag of one cell (tests; it stalls). */
  readVelocity(x: number, y: number): number[] | null;
  dispose(): void;
}

export const createSolver = (
  kit: Kit,
  size: { width: number; height: number; visible: number; plumeSamples: number },
): Solver => {
  const { gl, programs: P } = kit;
  const { width: W, height: H } = size;
  const made: Target[] = [];
  const target = (t: Target) => {
    made.push(t);
    return t;
  };
  const stateTarget = () =>
    target(
      createTarget(gl, [
        createTexture(gl, W, H, { internal: gl.RGBA32F }),
        createTexture(gl, W, H, { internal: gl.RGBA32F }),
        createTexture(gl, W, H, { internal: gl.RGBA32F }),
      ]),
    );
  let front = stateTarget();
  let back = stateTarget();
  const mask = target(createSingle(gl, W, H, { internal: gl.RGBA8 }));
  const inlet = createTexture(gl, H, 2, { internal: gl.RGBA32F });
  const vel = target(createSingle(gl, W, H, { internal: gl.RGBA16F, linear: true }));
  let dye = target(createSingle(gl, W, H, { internal: gl.RGBA16F, linear: true }));
  let dyeNext = target(createSingle(gl, W, H, { internal: gl.RGBA16F, linear: true }));
  const fwd = target(createSingle(gl, W, H, { internal: gl.RGBA16F, linear: true }));
  const bwd = target(createSingle(gl, W, H, { internal: gl.RGBA16F, linear: true }));
  const forces = target(createSingle(gl, FORCE_ROWS, MAX_SHAPES, { internal: gl.RGBA32F }));
  const samples = Math.max(1, size.plumeSamples);
  const plume = target(createSingle(gl, samples, 2, { internal: gl.RGBA8 }));
  const probeSize = { width: Math.ceil(W / PROBE_BLOCK), height: Math.ceil(H / PROBE_BLOCK) };
  const probe = target(createSingle(gl, probeSize.width, probeSize.height, { internal: gl.RGBA8 }));
  const forceRead = createReadback<Float32Array>(gl, FORCE_ROWS, MAX_SHAPES, true);
  const plumeRead = createReadback<Uint8Array>(gl, samples, 2, false);
  const probeRead = createReadback<Uint8Array>(gl, probeSize.width, probeSize.height, false);
  const sums = new Float32Array(MAX_SHAPES * 3);

  const maskVao = gl.createVertexArray();
  const maskBuf = gl.createBuffer();
  if (!maskVao || !maskBuf) throw new Error("buffer allocation failed");
  gl.bindVertexArray(maskVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, maskBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_MASK_VERTICES * MASK_FLOATS * 4, gl.DYNAMIC_DRAW);
  const stride = MASK_FLOATS * 4;
  const attr = (name: string, n: number, offset: number) => {
    const loc = gl.getAttribLocation(P.mask.program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, offset);
  };
  attr("a_pos", 2, 0);
  attr("a_vel", 2, 8);
  attr("a_id", 1, 16);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const clearMask = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 128 / 255, 128 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  clearMask();

  const bindState = (prog: Program, t: Target) => {
    bindTexture(gl, 0, t.textures[0]!.texture, prog.u("u_f0"));
    bindTexture(gl, 1, t.textures[1]!.texture, prog.u("u_f1"));
    bindTexture(gl, 2, t.textures[2]!.texture, prog.u("u_f2"));
  };

  const fullscreen = (t: Target | null, sizeOf?: { width: number; height: number }) => {
    gl.bindVertexArray(kit.empty);
    drawFullscreen(gl, t, sizeOf);
  };

  const advectPass = (src: Target, out: Target, shift: number) => {
    P.advect.use();
    bindTexture(gl, 0, src.textures[0]!.texture, P.advect.u("u_src"));
    bindTexture(gl, 1, vel.textures[0]!.texture, P.advect.u("u_vel"));
    gl.uniform2f(P.advect.u("u_size"), W, H);
    gl.uniform1f(P.advect.u("u_shift"), shift);
    fullscreen(out);
  };

  const correctPass = (shift: number, fade: number, inject: number) => {
    P.correct.use();
    bindTexture(gl, 0, dye.textures[0]!.texture, P.correct.u("u_phi"));
    bindTexture(gl, 1, fwd.textures[0]!.texture, P.correct.u("u_fwd"));
    bindTexture(gl, 2, bwd.textures[0]!.texture, P.correct.u("u_bwd"));
    bindTexture(gl, 3, vel.textures[0]!.texture, P.correct.u("u_vel"));
    bindTexture(gl, 4, inlet.texture, P.correct.u("u_inlet"));
    gl.uniform2f(P.correct.u("u_size"), W, H);
    gl.uniform1f(P.correct.u("u_shift"), shift);
    gl.uniform1f(P.correct.u("u_fade"), fade);
    gl.uniform1f(P.correct.u("u_inject"), inject);
    fullscreen(dyeNext);
    [dye, dyeNext] = [dyeNext, dye];
  };

  const solver: Solver = {
    width: W,
    height: H,
    visible: size.visible,
    probeSize,
    setInlet(data) {
      gl.bindTexture(gl.TEXTURE_2D, inlet.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, H, 2, gl.RGBA, gl.FLOAT, data);
    },
    init() {
      P.init.use();
      bindTexture(gl, 0, inlet.texture, P.init.u("u_inlet"));
      bindTexture(gl, 1, mask.textures[0]!.texture, P.init.u("u_mask"));
      fullscreen(front);
      solver.macro();
      // Smoke from the inlet pattern everywhere, as though the tunnel had been running.
      correctPass(0, 1, W + 1);
    },
    drawMask(vertices, count) {
      clearMask();
      const n = Math.min(count, MAX_MASK_VERTICES);
      if (n <= 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, maskBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, n * MASK_FLOATS);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      P.mask.use();
      gl.uniform2f(P.mask.u("u_size"), W, H);
      gl.bindVertexArray(maskVao);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      gl.bindVertexArray(null);
    },
    uploadMask(bytes) {
      gl.bindTexture(gl.TEXTURE_2D, mask.textures[0]!.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    },
    step(n, p) {
      const prog = P.step;
      prog.use();
      bindTexture(gl, 3, mask.textures[0]!.texture, prog.u("u_mask"));
      bindTexture(gl, 4, inlet.texture, prog.u("u_inlet"));
      gl.uniform2i(prog.u("u_size"), W, H);
      gl.uniform1f(prog.u("u_c2"), p.smagorinsky * p.smagorinsky);
      gl.uniform1f(prog.u("u_spongeFrom"), p.spongeFrom);
      gl.uniform1f(prog.u("u_spongeTau"), p.spongeTau);
      gl.uniform1f(prog.u("u_ema"), p.forceEma);
      gl.uniform1f(prog.u("u_bulk"), p.bulk);
      gl.uniform1i(prog.u("u_soft"), p.soft ? 1 : 0);
      for (let i = 0; i < n; i++) {
        bindState(prog, front);
        fullscreen(back);
        [front, back] = [back, front];
      }
    },
    macro() {
      P.macro.use();
      bindState(P.macro, front);
      bindTexture(gl, 3, mask.textures[0]!.texture, P.macro.u("u_mask"));
      fullscreen(vel);
    },
    advect(steps, fade, inject) {
      advectPass(dye, fwd, steps);
      advectPass(fwd, bwd, -steps);
      correctPass(steps, fade, inject);
    },
    render(spec) {
      const prog = P.render;
      prog.use();
      bindTexture(gl, 0, dye.textures[0]!.texture, prog.u("u_dye"));
      bindTexture(gl, 1, vel.textures[0]!.texture, prog.u("u_vel"));
      gl.uniform3fv(prog.u("u_row0"), spec.toGrid.r0);
      gl.uniform3fv(prog.u("u_row1"), spec.toGrid.r1);
      gl.uniform2f(prog.u("u_canvas"), spec.canvas.width, spec.canvas.height);
      gl.uniform2f(prog.u("u_tex"), W, H);
      gl.uniform2f(prog.u("u_visible"), size.visible, H);
      gl.uniform1i(prog.u("u_view"), spec.view);
      gl.uniform1f(prog.u("u_uref"), spec.uref);
      gl.uniform1f(prog.u("u_wref"), spec.wref);
      gl.uniform3fv(prog.u("u_tint0"), spec.tints[0] ?? [1, 1, 1]);
      gl.uniform3fv(prog.u("u_tint1"), spec.tints[1] ?? [1, 1, 1]);
      gl.uniform3fv(prog.u("u_tint2"), spec.tints[2] ?? [1, 1, 1]);
      gl.uniform3fv(prog.u("u_back"), spec.back);
      fullscreen(null, spec.canvas);
    },
    requestForces(boxes) {
      if (forceRead.busy) return;
      const prog = P.forces;
      prog.use();
      bindTexture(gl, 0, front.textures[2]!.texture, prog.u("u_f2"));
      const flat = new Int32Array(MAX_SHAPES * 4);
      for (let i = 0; i < MAX_SHAPES; i++) {
        const b = boxes[i];
        if (!b) continue;
        flat[i * 4] = Math.max(0, Math.floor(b[0]));
        flat[i * 4 + 1] = Math.max(0, Math.floor(b[1]));
        flat[i * 4 + 2] = Math.min(W, Math.ceil(b[2]));
        flat[i * 4 + 3] = Math.min(H, Math.ceil(b[3]));
      }
      gl.uniform4iv(prog.u("u_box"), flat);
      gl.uniform1i(prog.u("u_rows"), FORCE_ROWS);
      fullscreen(forces);
      forceRead.start(forces);
    },
    pollForces() {
      const data = forceRead.poll();
      if (!data) return null;
      sums.fill(0);
      for (let s = 0; s < MAX_SHAPES; s++) {
        for (let r = 0; r < FORCE_ROWS; r++) {
          const o = (s * FORCE_ROWS + r) * 4;
          sums[s * 3] = sums[s * 3]! + data[o]!;
          sums[s * 3 + 1] = sums[s * 3 + 1]! + data[o + 1]!;
          sums[s * 3 + 2] = sums[s * 3 + 2]! + data[o + 2]!;
        }
      }
      return sums;
    },
    requestPlume(spec) {
      if (plumeRead.busy) return;
      const prog = P.plume;
      prog.use();
      bindTexture(gl, 0, vel.textures[0]!.texture, prog.u("u_vel"));
      bindTexture(gl, 1, dye.textures[0]!.texture, prog.u("u_dye"));
      gl.uniform3fv(prog.u("u_row0"), spec.toGrid.r0);
      gl.uniform3fv(prog.u("u_row1"), spec.toGrid.r1);
      gl.uniform2f(prog.u("u_tex"), W, H);
      gl.uniform2f(prog.u("u_visible"), size.visible, H);
      gl.uniform1f(prog.u("u_line"), spec.line);
      gl.uniform1f(prog.u("u_width"), spec.width);
      gl.uniform1f(prog.u("u_n"), samples);
      gl.uniform4fv(prog.u("u_dir"), spec.dir);
      gl.uniform1f(prog.u("u_uref"), spec.uref);
      gl.uniform1f(prog.u("u_range"), spec.range);
      fullscreen(plume);
      plumeRead.start(plume);
    },
    pollPlume() {
      return plumeRead.poll();
    },
    requestProbe() {
      if (probeRead.busy) return;
      P.probe.use();
      bindTexture(gl, 0, vel.textures[0]!.texture, P.probe.u("u_vel"));
      gl.uniform2i(P.probe.u("u_size"), W, H);
      fullscreen(probe);
      probeRead.start(probe);
    },
    pollProbe() {
      return probeRead.poll();
    },
    readPopulations() {
      return [0, 1, 2].map((i) => readFloats(gl, front, i));
    },
    readVelocity(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      const out = new Float32Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, vel.fbo);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return Array.from(out);
    },
    dispose() {
      forceRead.dispose();
      plumeRead.dispose();
      probeRead.dispose();
      for (const t of made) deleteTarget(gl, t);
      gl.deleteTexture(inlet.texture);
      gl.deleteBuffer(maskBuf);
      gl.deleteVertexArray(maskVao);
    },
  };
  return solver;
};
