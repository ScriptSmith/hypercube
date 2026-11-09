import { elementPropsData, PROPS_UNIT } from "../elements";
import { FULLSCREEN_VS } from "../shaders/common";
import { createLookupTexture, createProgramSet, type ProgramSet } from "./gl";
import { createRenderer, RENDER_PROGRAMS, type RenderGeometry, type Renderer } from "./render";
import { createSim, SIM_PROGRAMS, type Sim } from "./sim";

/**
 * Owns the canvas, its WebGL2 context and every GPU resource. Each context compiles its programs
 * once, without blocking where the browser allows it, and keeps them across resizes; the canvas
 * stays hidden over the CSS backdrop until they're ready. On context loss it hides the canvas
 * (the backdrop and the palette stay up) and waits for the browser to restore the context; if
 * that doesn't happen soon, it replaces the canvas with a fresh one. Either way `onReady` runs
 * again so the app can rebuild its world.
 */
export interface GpuOptions {
  host: HTMLElement;
  onReady(sim: Sim): void;
  onError(message: string): void;
}

export interface Gpu {
  readonly ready: boolean;
  readonly lost: boolean;
  /** A software rasteriser (SwiftShader, llvmpipe): the app should use a coarser grid. */
  readonly software: boolean;
  /** Allocate for a world size and set the canvas backing size. */
  configure(geo: RenderGeometry, canvasW: number, canvasH: number): void;
  /** Run GPU work if the context is usable. Errors count as a lost context. */
  run(work: (sim: Sim, renderer: Renderer, gl: WebGL2RenderingContext) => void): void;
  /** Test hook: lose the context now and restore it after `ms` (if the extension exists). */
  simulateLoss(ms: number): boolean;
  dispose(): void;
}

/** How long to wait for the browser to restore a lost context before replacing the canvas. */
const RESTORE_WAIT_MS = 4000;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30_000;
/** How often to check whether the programs have finished compiling. */
const POLL_MS = 50;
const SAMPLERS = { u_props: PROPS_UNIT };

export const createGpu = (opts: GpuOptions): Gpu => {
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let sim: Sim | null = null;
  let renderer: Renderer | null = null;
  let props: WebGLTexture | null = null;
  let programs: ProgramSet | null = null;
  let geo: RenderGeometry | null = null;
  let size = { w: 1, h: 1 };
  let timer = 0;
  let pollTimer = 0;
  let retryMs = RETRY_MIN_MS;
  let lost = false;
  let disposed = false;
  let reported = false;
  let software = false;

  const fitCanvas = () => {
    if (!canvas) return;
    if (canvas.width !== size.w) canvas.width = size.w;
    if (canvas.height !== size.h) canvas.height = size.h;
  };

  /** The world's targets, which depend on its size. */
  const releaseWorld = () => {
    try {
      if (gl && !gl.isContextLost()) {
        renderer?.dispose();
        sim?.dispose();
      }
    } catch {
      // The context is going away anyway.
    }
    renderer = null;
    sim = null;
  };

  const release = () => {
    releaseWorld();
    clearTimeout(pollTimer);
    try {
      if (gl && !gl.isContextLost()) {
        programs?.dispose();
        if (props) gl.deleteTexture(props);
      }
    } catch {
      // As above.
    }
    programs = null;
    props = null;
  };

  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };

  const fail = (message: string) => {
    if (!reported) {
      reported = true;
      opts.onError(message);
    }
    release();
    if (canvas) canvas.style.visibility = "hidden";
    later(replaceCanvas, retryMs);
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
  };

  const build = () => {
    clearTimeout(pollTimer);
    if (disposed || !gl || !geo || !programs || gl.isContextLost()) return;
    if (!programs.ready()) {
      pollTimer = window.setTimeout(build, POLL_MS);
      return;
    }
    fitCanvas();
    releaseWorld();
    try {
      sim = createSim(gl, programs, geo.gridW, geo.gridH);
      renderer = createRenderer(gl, programs, geo);
      opts.onReady(sim);
    } catch (err) {
      if (gl.isContextLost()) return;
      fail(`tinyworld: GPU setup failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    lost = false;
    retryMs = RETRY_MIN_MS;
    if (canvas) canvas.style.visibility = "visible";
  };

  /** A new or restored context: upload the element table and start compiling every program. */
  const start = () => {
    if (disposed || !gl || gl.isContextLost()) return;
    release();
    try {
      const table = elementPropsData();
      props = createLookupTexture(gl, PROPS_UNIT, table.width, table.height, table.data);
      programs = createProgramSet(
        gl,
        FULLSCREEN_VS,
        [...SIM_PROGRAMS, ...RENDER_PROGRAMS],
        SAMPLERS,
      );
    } catch (err) {
      if (gl.isContextLost()) return;
      fail(`tinyworld: GPU setup failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    build();
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    clearTimeout(pollTimer);
    renderer = null;
    sim = null;
    props = null;
    programs = null;
    if (canvas) canvas.style.visibility = "hidden";
    later(replaceCanvas, RESTORE_WAIT_MS);
  };

  const onRestored = () => {
    clearTimeout(timer);
    start();
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
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;visibility:hidden;";
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    opts.host.prepend(canvas);
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      lost = true;
      fail("tinyworld: WebGL2 is not available");
      return;
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    start();
  }

  replaceCanvas();

  return {
    get ready() {
      return !lost && sim !== null && renderer !== null;
    },
    get lost() {
      return lost;
    },
    get software() {
      return software;
    },

    configure(next, canvasW, canvasH) {
      size = { w: Math.max(1, Math.round(canvasW)), h: Math.max(1, Math.round(canvasH)) };
      // Resizing the canvas waits for the GPU to catch up, so while the programs compile it
      // happens in build instead.
      if (programs?.ready()) fitCanvas();
      const changed =
        !geo ||
        geo.gridW !== next.gridW ||
        geo.gridH !== next.gridH ||
        geo.worldCellsW !== next.worldCellsW ||
        geo.worldCellsH !== next.worldCellsH;
      geo = next;
      if (changed) build();
    },

    run(work) {
      if (lost || !gl || !sim || !renderer) return;
      try {
        work(sim, renderer, gl);
      } catch (err) {
        if (gl.isContextLost()) return;
        fail(`tinyworld: GPU frame failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    simulateLoss(ms) {
      const ext = gl?.getExtension("WEBGL_lose_context");
      if (!ext) return false;
      ext.loseContext();
      window.setTimeout(() => ext.restoreContext(), ms);
      return true;
    },

    dispose() {
      disposed = true;
      clearTimeout(timer);
      release();
      if (canvas) {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        canvas.remove();
      }
      // Let the browser reclaim the context now rather than at garbage collection.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      canvas = null;
    },
  };
};
