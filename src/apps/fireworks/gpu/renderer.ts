/**
 * Draws one frame's part of the sky. Stars and shell sparks are additive points in an
 * accumulation buffer (half resolution on big frames) that fades a little every frame, which
 * leaves short trails; two blurred copies of it give the bloom; a last pass lays it all over the
 * night sky with the light the bursts throw.
 *
 * On context loss the canvas hides (the dark page background shows) until the browser restores
 * it, or a fresh canvas replaces it a few seconds later.
 */
import type { Engine } from "../engine";
import { COLORS, MIXED, SHAPE } from "../recipe";
import type { Burst, Shell } from "../records";
import type { Region } from "../sky";
import { createProgram, createTarget, deleteTarget, type Program, type Target } from "./gl";
import {
  BLUR_FS,
  BURST_VS,
  COMPOSITE_FS,
  DOWN_FS,
  FADE_FS,
  FLOOR_FS,
  FULLSCREEN_VS,
  MAX_GLOWS,
  MAX_LIGHTS,
  POINT_FS,
  SHELL_VS,
} from "./shaders";

export interface View {
  region: Region;
  /** Sky y of the horizon (top of the pads) and of the top of the sky, for the gradient. */
  horizon: number;
  zenith: number;
  /** Draw hills below the horizon. */
  ground: boolean;
  /** Grid cell for the faint background stars, sky units. */
  starCell: number;
}

export interface Glow {
  x: number;
  y: number;
  width: number;
  strength: number;
  rgb: readonly [number, number, number];
}

export interface RendererOptions {
  host: HTMLElement;
  onError(message: string): void;
}

export interface Renderer {
  readonly ready: boolean;
  readonly lost: boolean;
  readonly software: boolean;
  /** Canvas backing size in device px. */
  resize(width: number, height: number): void;
  /** `now` is clock ms; `density` scales star counts. */
  draw(
    now: number,
    dt: number,
    engine: Engine,
    view: View,
    glows: readonly Glow[],
    density: number,
  ): void;
  simulateLoss(ms: number): boolean;
  dispose(): void;
}

const RESTORE_WAIT_MS = 4000;
/**
 * Losses within this window count towards a longer wait. A browser with too many contexts takes
 * the oldest one away whenever a new one starts, so replacing at once just takes another frame's.
 */
const LOSS_WINDOW_MS = 120_000;
const MAX_WAIT_MS = 60_000;
/** Trail persistence: the accumulation keeps e^(-dt / TRAIL_S) each frame. */
const TRAIL_S = 0.1;
const SPARK_RATE = 70;
const SPARK_LIFE = 0.55;
const TAIL: Partial<Record<number, number>> = {
  [SHAPE.willow]: 4,
  [SHAPE.palm]: 3,
  [SHAPE.crossette]: 2,
  [SHAPE.cascade]: 2,
};

interface Gpu {
  gl: WebGL2RenderingContext;
  float: boolean;
  burst: Program;
  shell: Program;
  fade: Program;
  floor: Program;
  down: Program;
  blur: Program;
  composite: Program;
  vao: WebGLVertexArrayObject;
  acc: Target | null;
  b1: Target | null;
  b1t: Target | null;
  b2: Target | null;
  b2t: Target | null;
  view: Region | null;
}

const PALETTE = new Float32Array(COLORS.flatMap((c) => [...c.rgb]));
const WHITE: readonly [number, number, number] = [1, 0.92, 0.82];

const rgbOf = (c: number): readonly [number, number, number] =>
  c >= MIXED ? WHITE : (COLORS[c]?.rgb ?? WHITE);

export const createRenderer = (opts: RendererOptions): Renderer => {
  let canvas: HTMLCanvasElement | null = null;
  let g: Gpu | null = null;
  let size = { w: 1, h: 1 };
  let lost = false;
  let software = false;
  let disposed = false;
  let reported = false;
  let timer = 0;
  let losses: number[] = [];

  /** 4 s after a first loss, doubling with each further loss in the last two minutes. */
  const replaceAfter = () => {
    const t = performance.now();
    losses = losses.filter((at) => t - at < LOSS_WINDOW_MS);
    losses.push(t);
    return Math.min(MAX_WAIT_MS, RESTORE_WAIT_MS * 2 ** (losses.length - 1));
  };

  const fail = (message: string) => {
    if (!reported) {
      reported = true;
      opts.onError(message);
    }
    release();
    lost = true;
    if (canvas) canvas.style.visibility = "hidden";
    clearTimeout(timer);
    timer = window.setTimeout(replaceCanvas, 8000);
  };

  const releaseTargets = (x: Gpu) => {
    for (const t of [x.acc, x.b1, x.b1t, x.b2, x.b2t]) deleteTarget(x.gl, t);
    x.acc = x.b1 = x.b1t = x.b2 = x.b2t = null;
    x.view = null;
  };

  function release() {
    const x = g;
    g = null;
    if (!x || x.gl.isContextLost()) return;
    try {
      releaseTargets(x);
      for (const p of [x.burst, x.shell, x.fade, x.floor, x.down, x.blur, x.composite]) {
        x.gl.deleteProgram(p.program);
      }
      x.gl.deleteVertexArray(x.vao);
    } catch {
      // Going away anyway.
    }
  }

  const build = (gl: WebGL2RenderingContext) => {
    release();
    try {
      const float =
        gl.getExtension("EXT_color_buffer_float") !== null ||
        gl.getExtension("EXT_color_buffer_half_float") !== null;
      const vao = gl.createVertexArray();
      if (!vao) throw new Error("createVertexArray failed");
      g = {
        gl,
        float,
        burst: createProgram(gl, BURST_VS, POINT_FS),
        shell: createProgram(gl, SHELL_VS, POINT_FS),
        fade: createProgram(gl, FULLSCREEN_VS, FADE_FS),
        floor: createProgram(gl, FULLSCREEN_VS, FLOOR_FS),
        down: createProgram(gl, FULLSCREEN_VS, DOWN_FS),
        blur: createProgram(gl, FULLSCREEN_VS, BLUR_FS),
        composite: createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS),
        vao,
        acc: null,
        b1: null,
        b1t: null,
        b2: null,
        b2t: null,
        view: null,
      };
      gl.useProgram(g.burst.program);
      gl.uniform3fv(g.burst.u("u_palette"), PALETTE);
      lost = false;
      if (canvas) canvas.style.visibility = "visible";
    } catch (err) {
      if (gl.isContextLost()) return;
      fail(`fireworks: GPU setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    g = null;
    if (canvas) canvas.style.visibility = "hidden";
    clearTimeout(timer);
    timer = window.setTimeout(replaceCanvas, replaceAfter());
  };
  const onRestored = () => {
    clearTimeout(timer);
    const gl = canvas?.getContext("webgl2");
    if (gl) build(gl);
  };

  function replaceCanvas() {
    if (disposed) return;
    release();
    if (canvas) {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      canvas.remove();
    }
    canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    opts.host.prepend(canvas);
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      fail("fireworks: WebGL2 is not available");
      return;
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    build(gl);
  }

  /** Accumulation size: the canvas, scaled down so big frames stay cheap. */
  const ensureTargets = (x: Gpu, region: Region) => {
    const budget = software ? 0.45e6 : 4.6e6;
    const scale = Math.min(1, Math.sqrt(budget / Math.max(1, size.w * size.h)));
    const aw = Math.max(2, Math.round(size.w * scale));
    const ah = Math.max(2, Math.round(size.h * scale));
    const same =
      x.acc &&
      x.acc.width === aw &&
      x.acc.height === ah &&
      x.view &&
      x.view.x0 === region.x0 &&
      x.view.x1 === region.x1 &&
      x.view.y0 === region.y0 &&
      x.view.y1 === region.y1;
    if (same) return;
    releaseTargets(x);
    const { gl, float } = x;
    x.acc = createTarget(gl, aw, ah, float);
    const w1 = Math.max(1, Math.round(aw / 2));
    const h1 = Math.max(1, Math.round(ah / 2));
    x.b1 = createTarget(gl, w1, h1, float);
    x.b1t = createTarget(gl, w1, h1, float);
    const w2 = Math.max(1, Math.round(w1 / 2));
    const h2 = Math.max(1, Math.round(h1 / 2));
    x.b2 = createTarget(gl, w2, h2, float);
    x.b2t = createTarget(gl, w2, h2, float);
    x.view = { ...region };
  };

  const fullscreen = (gl: WebGL2RenderingContext, t: Target | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.width : size.w, t ? t.height : size.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const sampler = (
    gl: WebGL2RenderingContext,
    p: Program,
    name: string,
    unit: number,
    t: Target,
  ) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.uniform1i(p.u(name), unit);
  };

  const overlaps = (r: Region, x0: number, y0: number, x1: number, y1: number) =>
    x1 >= r.x0 && x0 <= r.x1 && y1 >= r.y0 && y0 <= r.y1;

  const drawBursts = (
    x: Gpu,
    now: number,
    engine: Engine,
    region: Region,
    ppu: number,
    density: number,
  ) => {
    const { gl } = x;
    const p = x.burst;
    gl.useProgram(p.program);
    gl.uniform4f(p.u("u_view"), region.x0, region.y0, region.x1, region.y1);
    gl.uniform1f(p.u("u_pxPerUnit"), ppu);
    for (const b of engine.bursts.slots) {
      if (!b.live) continue;
      const age = (now - b.t0) / 1000;
      if (age <= 0) continue;
      const reach = b.radius * 1.5 + Math.abs(b.vx) + Math.abs(b.vy) + b.gravity * 2;
      if (!overlaps(region, b.x - reach, b.y - reach * 1.6, b.x + reach, b.y + reach)) continue;
      const n = Math.max(8, Math.round(b.count * density));
      const tail = TAIL[b.shape] ?? 1;
      const fade = b.endAt === Infinity ? 1 : Math.max(0, Math.min(1, (b.endAt - now) / 350));
      if (fade <= 0) continue;
      setBurst(gl, p, b, age, n, tail, fade);
      gl.drawArrays(gl.POINTS, 0, n * tail);
    }
  };

  const setBurst = (
    gl: WebGL2RenderingContext,
    p: Program,
    b: Burst,
    age: number,
    n: number,
    tail: number,
    fade: number,
  ) => {
    const a = rgbOf(b.color);
    const c = rgbOf(b.color2);
    gl.uniform2f(p.u("u_origin"), b.x, b.y);
    gl.uniform2f(p.u("u_drift"), b.vx, b.vy);
    gl.uniform1f(p.u("u_age"), age);
    gl.uniform1f(p.u("u_speed"), b.speed);
    gl.uniform1f(p.u("u_grav"), b.gravity);
    gl.uniform1f(p.u("u_drag"), b.drag);
    gl.uniform1f(p.u("u_life"), b.life);
    gl.uniform1i(p.u("u_shape"), b.shape);
    gl.uniform1ui(p.u("u_seed"), b.seed >>> 0);
    gl.uniform1i(p.u("u_count"), n);
    gl.uniform1i(p.u("u_tail"), tail);
    gl.uniform1f(p.u("u_tilt"), b.tilt);
    gl.uniform3f(p.u("u_colA"), a[0], a[1], a[2]);
    gl.uniform3f(p.u("u_colB"), c[0], c[1], c[2]);
    gl.uniform1i(p.u("u_mixed"), b.color >= MIXED ? 1 : 0);
    gl.uniform1f(p.u("u_star"), b.star);
    gl.uniform1f(p.u("u_fade"), fade);
  };

  const drawShells = (x: Gpu, now: number, engine: Engine, region: Region, ppu: number) => {
    const { gl } = x;
    const p = x.shell;
    gl.useProgram(p.program);
    gl.uniform4f(p.u("u_view"), region.x0, region.y0, region.x1, region.y1);
    gl.uniform1f(p.u("u_pxPerUnit"), ppu);
    gl.uniform1f(p.u("u_rate"), SPARK_RATE);
    gl.uniform1f(p.u("u_sparkLife"), SPARK_LIFE);
    for (const s of engine.shells.slots) {
      if (!s.live) continue;
      const age = (now - s.t0) / 1000;
      const end = (s.tb - s.t0) / 1000;
      if (age <= 0 || age - end > SPARK_LIFE) continue;
      if (!shellVisible(s, age, end, region)) continue;
      const first = Math.max(0, Math.floor((age - SPARK_LIFE) * SPARK_RATE));
      const last = Math.floor(Math.min(age, end) * SPARK_RATE);
      const count = Math.max(0, last - first + 1);
      const col = rgbOf(s.color);
      gl.uniform2f(p.u("u_origin"), s.path.x, s.path.y);
      gl.uniform2f(p.u("u_vel"), s.path.vx, s.path.vy);
      gl.uniform1f(p.u("u_grav"), s.path.g);
      gl.uniform1f(p.u("u_age"), age);
      gl.uniform1f(p.u("u_end"), end);
      gl.uniform1i(p.u("u_first"), first);
      gl.uniform1f(p.u("u_star"), s.star);
      gl.uniform3f(p.u("u_col"), col[0], col[1], col[2]);
      gl.uniform1ui(p.u("u_seed"), s.seed >>> 0);
      gl.drawArrays(gl.POINTS, 0, count + 1);
    }
  };

  const shellVisible = (s: Shell, age: number, end: number, r: Region): boolean => {
    const t1 = Math.min(age, end);
    const t0 = Math.max(0, t1 - SPARK_LIFE);
    const at = (t: number) => ({
      x: s.path.x + s.path.vx * t,
      y: s.path.y + s.path.vy * t - 0.5 * s.path.g * t * t,
    });
    const a = at(t0);
    const b = at(t1);
    const m = s.star * 6 + 200;
    return overlaps(
      r,
      Math.min(a.x, b.x) - m,
      Math.min(a.y, b.y) - m,
      Math.max(a.x, b.x) + m,
      Math.max(a.y, b.y) + m,
    );
  };

  const lightsOf = (now: number, engine: Engine) => {
    const out: { b: Burst; i: number }[] = [];
    for (const b of engine.bursts.slots) {
      if (!b.live) continue;
      const age = (now - b.t0) / 1000;
      if (age <= 0 || age > 2) continue;
      const i = b.light * Math.min(1, age / 0.08) * Math.exp(-age / 0.55);
      out.push({ b, i });
    }
    out.sort((p, q) => q.i - p.i);
    return out.slice(0, MAX_LIGHTS);
  };

  const lightData = new Float32Array(MAX_LIGHTS * 4);
  const lightCol = new Float32Array(MAX_LIGHTS * 3);
  const glowData = new Float32Array(MAX_GLOWS * 4);
  const glowCol = new Float32Array(MAX_GLOWS * 3);

  const composite = (x: Gpu, now: number, engine: Engine, view: View, ppuCanvas: number) => {
    const { gl } = x;
    const p = x.composite;
    const r = view.region;
    gl.useProgram(p.program);
    sampler(gl, p, "u_acc", 0, x.acc!);
    sampler(gl, p, "u_bloom1", 1, x.b1!);
    sampler(gl, p, "u_bloom2", 2, x.b2!);
    gl.uniform4f(p.u("u_view"), r.x0, r.y0, r.x1, r.y1);
    gl.uniform2f(p.u("u_res"), size.w, size.h);
    gl.uniform1f(p.u("u_pxPerUnit"), ppuCanvas);
    gl.uniform1f(p.u("u_time"), (now / 1000) % 1000);
    gl.uniform1f(p.u("u_horizon"), view.horizon);
    gl.uniform1f(p.u("u_zenith"), view.zenith);
    gl.uniform1f(p.u("u_ground"), view.ground ? 1 : 0);
    gl.uniform1f(p.u("u_starCell"), Math.max(20, view.starCell));
    const lights = lightsOf(now, engine);
    lights.forEach(({ b, i }, k) => {
      lightData.set([b.x, b.y, b.radius * 1.3, i], k * 4);
      const c = rgbOf(b.color);
      lightCol.set(c, k * 3);
    });
    gl.uniform4fv(p.u("u_lights"), lightData);
    gl.uniform3fv(p.u("u_lightCol"), lightCol);
    gl.uniform1i(p.u("u_lightCount"), lights.length);
    gl.uniform4fv(p.u("u_glows"), glowData);
    gl.uniform3fv(p.u("u_glowCol"), glowCol);
    fullscreen(gl, null);
  };

  replaceCanvas();

  return {
    get ready() {
      return !lost && g !== null;
    },
    get lost() {
      return lost;
    },
    get software() {
      return software;
    },
    resize(w, h) {
      size = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
      if (canvas) {
        if (canvas.width !== size.w) canvas.width = size.w;
        if (canvas.height !== size.h) canvas.height = size.h;
      }
    },
    draw(now, dt, engine, view, glows, density) {
      const x = g;
      if (lost || !x || disposed) return;
      const { gl } = x;
      try {
        ensureTargets(x, view.region);
        const acc = x.acc!;
        const r = view.region;
        const ppuAcc = acc.width / Math.max(1e-6, r.x1 - r.x0);
        gl.bindVertexArray(x.vao);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);

        // Fade what's there, leaving short trails.
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        gl.useProgram(x.fade.program);
        gl.uniform1f(x.fade.u("u_keep"), Math.exp(-Math.min(0.25, dt) / TRAIL_S));
        fullscreen(gl, acc);
        if (!x.float) {
          // 8-bit targets round small values up forever; take a little off so trails reach black.
          gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(x.floor.program);
          gl.uniform1f(x.floor.u("u_floor"), 1.5 / 255);
          fullscreen(gl, acc);
        }

        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
        gl.viewport(0, 0, acc.width, acc.height);
        drawBursts(x, now, engine, r, ppuAcc, density);
        drawShells(x, now, engine, r, ppuAcc);

        gl.disable(gl.BLEND);
        const down = (src: Target, dst: Target) => {
          gl.useProgram(x.down.program);
          sampler(gl, x.down, "u_src", 0, src);
          gl.uniform2f(x.down.u("u_texel"), 1 / src.width, 1 / src.height);
          fullscreen(gl, dst);
        };
        const blur = (src: Target, tmp: Target) => {
          gl.useProgram(x.blur.program);
          sampler(gl, x.blur, "u_src", 0, src);
          gl.uniform2f(x.blur.u("u_step"), 1 / src.width, 0);
          fullscreen(gl, tmp);
          sampler(gl, x.blur, "u_src", 0, tmp);
          gl.uniform2f(x.blur.u("u_step"), 0, 1 / tmp.height);
          fullscreen(gl, src);
        };
        down(acc, x.b1!);
        blur(x.b1!, x.b1t!);
        down(x.b1!, x.b2!);
        blur(x.b2!, x.b2t!);
        blur(x.b2!, x.b2t!);

        const n = Math.min(MAX_GLOWS, glows.length);
        for (let i = 0; i < n; i++) {
          const gw = glows[i]!;
          glowData.set([gw.x, gw.y, gw.width, gw.strength], i * 4);
          glowCol.set(gw.rgb, i * 3);
        }
        gl.useProgram(x.composite.program);
        gl.uniform1i(x.composite.u("u_glowCount"), n);
        composite(x, now, engine, view, size.w / Math.max(1e-6, r.x1 - r.x0));
      } catch (err) {
        if (gl.isContextLost()) return;
        fail(`fireworks: GPU frame failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    simulateLoss(ms) {
      const ext = g?.gl.getExtension("WEBGL_lose_context");
      if (!ext) return false;
      ext.loseContext();
      window.setTimeout(() => ext.restoreContext(), ms);
      return true;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      const gl = g?.gl;
      release();
      if (canvas) {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        canvas.remove();
      }
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      canvas = null;
    },
  };
};
