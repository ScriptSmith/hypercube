import { MAX_CLOUDS, MAX_CURSORS, MAX_GHOSTS, MAX_HEATS, MAX_ZONES } from "../shaders/common";
import { BLUR_FS, COMPOSITE_FS, DOWN_FS, SHADE_FS, SKY_FS } from "../shaders/render";
import {
  bindTexture,
  checkFramebuffer,
  createColorTarget,
  createColorTexture,
  deleteTarget,
  drawFullscreen,
  type ProgramSet,
  type Target,
} from "./gl";

export const RENDER_PROGRAMS = [SHADE_FS, DOWN_FS, BLUR_FS, SKY_FS, COMPOSITE_FS];

/** Per-frame render inputs, filled by the app and reused (no allocation). */
export interface RenderInputs {
  time: number;
  /** World reveal height, 0 to 1.2 (fully shown). */
  reveal: number;
  cloudCount: number;
  /** MAX_CLOUDS vec4s: (cx, cy, rx, ry) in cells, and (darkness, opacity, seed, -). */
  clouds: Float32Array;
  cloudLook: Float32Array;
  cursorCount: number;
  /** MAX_CURSORS vec4s: (x, y, radius, strength) in venue px, and (r, g, b, -). */
  cursors: Float32Array;
  cursorColors: Float32Array;
  ghostCount: number;
  /** MAX_GHOSTS vec4s: (cx, cy, hx, hy) in cells, and (shape, mirror, material, -). */
  ghostA: Float32Array;
  ghostB: Float32Array;
  /** Gadget effects: MAX_ZONES zones (x, y, width, height) and (kind, -, -, -) in venue px. */
  fxCount: number;
  fxA: Float32Array;
  fxB: Float32Array;
  /** Heater and cooler glows: MAX_HEATS of (x, y, radius, sign) in venue px. */
  glowCount: number;
  glows: Float32Array;
}

export const createRenderInputs = (): RenderInputs => ({
  time: 0,
  reveal: 1.2,
  cloudCount: 0,
  clouds: new Float32Array(MAX_CLOUDS * 4),
  cloudLook: new Float32Array(MAX_CLOUDS * 4),
  cursorCount: 0,
  cursors: new Float32Array(MAX_CURSORS * 4),
  cursorColors: new Float32Array(MAX_CURSORS * 4),
  ghostCount: 0,
  ghostA: new Float32Array(MAX_GHOSTS * 4),
  ghostB: new Float32Array(MAX_GHOSTS * 4),
  fxCount: 0,
  fxA: new Float32Array(MAX_ZONES * 4),
  fxB: new Float32Array(MAX_ZONES * 4),
  glowCount: 0,
  glows: new Float32Array(MAX_HEATS * 4),
});

export interface RenderGeometry {
  gridW: number;
  gridH: number;
  /** World size in cells and in venue px (the visible part of the grid). */
  worldCellsW: number;
  worldCellsH: number;
  worldW: number;
  worldH: number;
  cell: number;
}

export interface Renderer {
  draw(state: WebGLTexture, inputs: RenderInputs, canvasW: number, canvasH: number): void;
  dispose(): void;
}

export const createRenderer = (
  gl: WebGL2RenderingContext,
  programs: ProgramSet,
  geo: RenderGeometry,
): Renderer => {
  const shade = programs.get(SHADE_FS);
  const down = programs.get(DOWN_FS);
  const blur = programs.get(BLUR_FS);
  const sky = programs.get(SKY_FS);
  const composite = programs.get(COMPOSITE_FS);

  const W = geo.gridW;
  const H = geo.gridH;
  // Colour and light at grid resolution, written together.
  const colorTex = createColorTexture(gl, W, H);
  const glowTex = createColorTexture(gl, W, H);
  const shadeFbo = gl.createFramebuffer();
  if (!shadeFbo) throw new Error("framebuffer allocation failed");
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadeFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, glowTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  checkFramebuffer(gl);

  // Glow at a quarter and a sixteenth of the grid, each blurred twice (across, then down).
  const q = (n: number, f: number) => Math.max(1, Math.ceil(n / f));
  const glowA = createColorTarget(gl, q(W, 4), q(H, 4));
  const tempA = createColorTarget(gl, q(W, 4), q(H, 4));
  const glowB = createColorTarget(gl, q(W, 16), q(H, 16));
  const tempB = createColorTarget(gl, q(W, 16), q(H, 16));
  // Clouds are soft, so a sixth of venue resolution is plenty, whatever the cell size.
  const skyTarget = createColorTarget(gl, q(geo.worldW, 6), q(geo.worldH, 6));

  const vao = gl.createVertexArray();

  const downsample = (source: WebGLTexture, srcW: number, srcH: number, out: Target) => {
    gl.useProgram(down.program);
    bindTexture(gl, 0, source, down.u("u_src"));
    gl.uniform2f(down.u("u_texel"), 1 / srcW, 1 / srcH);
    drawFullscreen(gl, out.fbo, out.width, out.height);
  };

  const blurTwice = (target: Target, temp: Target) => {
    gl.useProgram(blur.program);
    bindTexture(gl, 0, target.texture, blur.u("u_src"));
    gl.uniform2f(blur.u("u_step"), 1 / target.width, 0);
    drawFullscreen(gl, temp.fbo, temp.width, temp.height);
    bindTexture(gl, 0, temp.texture, blur.u("u_src"));
    gl.uniform2f(blur.u("u_step"), 0, 1 / target.height);
    drawFullscreen(gl, target.fbo, target.width, target.height);
  };

  return {
    draw(state, r, canvasW, canvasH) {
      gl.bindVertexArray(vao);

      gl.useProgram(shade.program);
      bindTexture(gl, 0, state, shade.u("u_state"));
      gl.uniform2i(shade.u("u_size"), W, H);
      gl.uniform1f(shade.u("u_time"), r.time);
      drawFullscreen(gl, shadeFbo, W, H);

      downsample(glowTex, W, H, glowA);
      blurTwice(glowA, tempA);
      downsample(glowA.texture, glowA.width, glowA.height, glowB);
      blurTwice(glowB, tempB);

      gl.useProgram(sky.program);
      gl.uniform2f(sky.u("u_worldCells"), geo.worldCellsW, geo.worldCellsH);
      gl.uniform1f(sky.u("u_time"), r.time);
      gl.uniform1i(sky.u("u_cloudCount"), r.cloudCount);
      gl.uniform4fv(sky.u("u_cloud"), r.clouds);
      gl.uniform4fv(sky.u("u_cloudLook"), r.cloudLook);
      drawFullscreen(gl, skyTarget.fbo, skyTarget.width, skyTarget.height);

      const c = composite;
      gl.useProgram(c.program);
      bindTexture(gl, 0, colorTex, c.u("u_color"));
      bindTexture(gl, 1, glowA.texture, c.u("u_glowA"));
      bindTexture(gl, 2, glowB.texture, c.u("u_glowB"));
      bindTexture(gl, 3, skyTarget.texture, c.u("u_sky"));
      gl.uniform2f(c.u("u_gridSize"), W, H);
      gl.uniform2f(c.u("u_worldCells"), geo.worldCellsW, geo.worldCellsH);
      gl.uniform2f(c.u("u_worldVenue"), geo.worldW, geo.worldH);
      gl.uniform1f(c.u("u_cell"), geo.cell);
      gl.uniform1f(c.u("u_ppc"), canvasW / geo.worldCellsW);
      gl.uniform1f(c.u("u_time"), r.time);
      gl.uniform1f(c.u("u_reveal"), r.reveal);
      gl.uniform1i(c.u("u_cursorCount"), r.cursorCount);
      gl.uniform4fv(c.u("u_cursor"), r.cursors);
      gl.uniform4fv(c.u("u_cursorColor"), r.cursorColors);
      gl.uniform1i(c.u("u_ghostCount"), r.ghostCount);
      gl.uniform4fv(c.u("u_ghostA"), r.ghostA);
      gl.uniform4fv(c.u("u_ghostB"), r.ghostB);
      gl.uniform1i(c.u("u_fxCount"), r.fxCount);
      gl.uniform4fv(c.u("u_fxA"), r.fxA);
      gl.uniform4fv(c.u("u_fxB"), r.fxB);
      gl.uniform1i(c.u("u_glowCount"), r.glowCount);
      gl.uniform4fv(c.u("u_glowFx"), r.glows);
      drawFullscreen(gl, null, canvasW, canvasH);
    },

    dispose() {
      for (const t of [glowA, tempA, glowB, tempB, skyTarget]) deleteTarget(gl, t);
      gl.deleteTexture(colorTex);
      gl.deleteTexture(glowTex);
      gl.deleteFramebuffer(shadeFbo);
      gl.deleteVertexArray(vao);
    },
  };
};
