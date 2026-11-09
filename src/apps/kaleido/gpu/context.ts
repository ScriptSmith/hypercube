/**
 * Owns the canvas and its WebGL2 context. On context loss it hides the canvas and waits for the
 * browser to restore it; if that takes too long it replaces the canvas. Either way `onReady` runs
 * again and the app rebuilds its GPU state. The fluid starts afresh; the day's layers live on the
 * CPU and survive.
 */
export interface GpuCaps {
  /** Float render targets (EXT_color_buffer_float), which the fluid needs. */
  float: boolean;
  /** A software rasteriser, which gets coarser grids and fewer iterations. */
  software: boolean;
}

export interface GpuOptions {
  host: HTMLElement;
  onReady(gl: WebGL2RenderingContext, caps: GpuCaps): void;
  onLost(): void;
  onError(message: string): void;
}

export interface Gpu {
  readonly gl: WebGL2RenderingContext | null;
  readonly caps: GpuCaps;
  readonly ready: boolean;
  /** Contexts lost since mount. */
  readonly losses: number;
  resize(width: number, height: number): void;
  /** Run GPU work if the context is usable. A thrown error counts as a lost context. */
  run(work: (gl: WebGL2RenderingContext) => void): void;
  /** Test hook: lose the context now and restore it after `ms`. */
  simulateLoss(ms: number): boolean;
  dispose(): void;
}

const RESTORE_WAIT_MS = 4000;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30_000;

export const createGpu = (opts: GpuOptions): Gpu => {
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let caps: GpuCaps = { float: false, software: false };
  let ready = false;
  let disposed = false;
  let timer = 0;
  let retryMs = RETRY_MIN_MS;
  let reported = false;
  let losses = 0;
  let size = { w: 1, h: 1 };

  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };

  const fail = (message: string) => {
    if (!reported) {
      reported = true;
      opts.onError(message);
    }
    ready = false;
    opts.onLost();
    if (canvas) canvas.style.visibility = "hidden";
    later(replace, retryMs);
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
  };

  const build = () => {
    if (disposed || !gl || gl.isContextLost()) return;
    // A restored context comes back without its extensions.
    caps = { ...caps, float: gl.getExtension("EXT_color_buffer_float") !== null };
    gl.getExtension("OES_texture_float_linear");
    try {
      opts.onReady(gl, caps);
    } catch (err) {
      if (gl.isContextLost()) return;
      fail(`kaleido: GPU setup failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    ready = true;
    retryMs = RETRY_MIN_MS;
    if (canvas) canvas.style.visibility = "visible";
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    losses++;
    ready = false;
    opts.onLost();
    if (canvas) canvas.style.visibility = "hidden";
    later(replace, RESTORE_WAIT_MS);
  };

  const onRestored = () => {
    clearTimeout(timer);
    build();
  };

  function replace() {
    if (disposed) return;
    ready = false;
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
      fail("kaleido: WebGL2 is not available");
      return;
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    caps = {
      float: gl.getExtension("EXT_color_buffer_float") !== null,
      software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name),
    };
    build();
  }

  replace();

  return {
    get gl() {
      return gl;
    },
    get caps() {
      return caps;
    },
    get ready() {
      return ready && gl !== null && !gl.isContextLost();
    },
    get losses() {
      return losses;
    },
    resize(w, h) {
      size = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
      if (canvas && (canvas.width !== size.w || canvas.height !== size.h)) {
        canvas.width = size.w;
        canvas.height = size.h;
      }
    },
    run(work) {
      if (!ready || !gl) return;
      try {
        work(gl);
      } catch (err) {
        if (gl.isContextLost()) return;
        fail(`kaleido: GPU frame failed: ${err instanceof Error ? err.message : String(err)}`);
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
      if (canvas) {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        canvas.remove();
      }
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      canvas = null;
    },
  };
};
