/**
 * A three.js renderer for an app's stage, with the parts every 3D app needs and is easy to get
 * wrong: drawing-buffer size and pixel ratio, compiling shader programs in the background so the
 * page never stalls on a slow driver (Tiny World once froze for seconds doing that), a lost
 * context that comes back, and releasing everything on dispose.
 *
 * Programs are compiled only for the scenes passed to `prepare`. A material added later, or a
 * change that needs a new program variant (lights added, fog, a texture where there was none),
 * compiles on its next draw and blocks the page while it does, so build scenes with every
 * material in place and prefer the cheaper built-in materials (basic, Lambert, Phong).
 */
import {
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
  WebGLRenderer,
} from "three";
import type { FrameInfo } from "./types";

export interface Renderer3D {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** False while programs compile or the context is lost. Draw only when true. */
  readonly ready: boolean;
  /**
   * Compile the programs `scene` needs in the background, and again whenever a lost context
   * comes back. Call it once per scene before drawing it.
   */
  prepare(scene: Object3D, camera: Camera): void;
  /** Match the drawing buffer to the frame's stage and pixel ratio. */
  resize(frame: FrameInfo): void;
  /**
   * After a lost context comes back. three.js uploads geometry and textures again by itself;
   * rebuild anything that lived only on the GPU, such as render targets holding simulation state.
   */
  onRestore(cb: () => void): () => void;
  /** Dispose `x` with the renderer, and return it. */
  keep<T extends { dispose(): void }>(x: T): T;
  dispose(): void;
}

export interface Renderer3DOptions {
  antialias?: boolean;
  /** A transparent background, so DOM or other canvases show through. Default false. */
  alpha?: boolean;
  /** CSS z-index of the canvas inside the stage. Default 0. */
  zIndex?: number;
}

export const createRenderer3D = (
  root: HTMLElement,
  frame: FrameInfo,
  opts: Renderer3DOptions = {},
): Renderer3D => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;z-index:${opts.zIndex ?? 0};`;
  root.append(canvas);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: opts.antialias ?? true,
    alpha: opts.alpha ?? false,
    powerPreference: "high-performance",
  });
  const scenes = new Map<Object3D, Camera>();
  const kept: { dispose(): void }[] = [];
  const restored = new Set<() => void>();
  let pending = 0;
  let lost = false;
  let disposed = false;
  // Bumped on context loss, so compiles started before it can't mark the new context ready.
  let epoch = 0;

  const compile = (scene: Object3D, camera: Camera) => {
    const mine = epoch;
    pending++;
    renderer
      .compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (mine === epoch) pending--;
      });
  };

  const onLost = () => {
    lost = true;
    epoch++;
    pending = 0;
  };
  const onRestored = () => {
    if (disposed) return;
    lost = false;
    for (const [scene, camera] of scenes) compile(scene, camera);
    for (const cb of restored) cb();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const resize = (f: FrameInfo) => {
    renderer.setPixelRatio(f.pixelRatio);
    renderer.setSize(f.width, f.height, false);
    // Browsers cap a drawing buffer (a screen at a high pixel ratio can ask for more than they
    // give), and viewports set for the size asked for then land in the wrong place, so size the
    // buffer to what was given.
    const gl = renderer.getContext();
    const want = canvas.width;
    const got = gl.drawingBufferWidth;
    if (got > 0 && got < want - 1) {
      renderer.setPixelRatio(f.pixelRatio * (got / want) * 0.99);
      renderer.setSize(f.width, f.height, false);
    }
  };
  resize(frame);

  return {
    renderer,
    canvas,
    get ready() {
      return !disposed && !lost && pending === 0;
    },
    prepare(scene, camera) {
      scenes.set(scene, camera);
      if (!lost && !disposed) compile(scene, camera);
    },
    resize,
    onRestore(cb) {
      restored.add(cb);
      return () => restored.delete(cb);
    },
    keep(x) {
      kept.push(x);
      return x;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const x of kept) x.dispose();
      kept.length = 0;
      for (const scene of scenes.keys()) disposeTree(scene);
      scenes.clear();
      restored.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
};

const isTexture = (v: unknown): v is Texture =>
  typeof v === "object" && v !== null && (v as { isTexture?: boolean }).isTexture === true;

/** Dispose every geometry, material and material texture under `obj`. */
export const disposeTree = (obj: Object3D): void => {
  const geometries = new Set<{ dispose(): void }>();
  const materials = new Set<Material>();
  obj.traverse((o) => {
    const mesh = o as Partial<Mesh>;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) materials.add(x);
    else if (m) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) {
    for (const v of Object.values(m)) if (isTexture(v)) v.dispose();
    m.dispose();
  }
};
