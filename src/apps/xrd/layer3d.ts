/**
 * The frame's one 3D renderer, shared by every chapter and the machine. It is made on first use,
 * under the cards' canvases: a 3D view shows wherever the card above it is left transparent, so a
 * chapter asking for a view must not paint over its rectangle (the card draws no background).
 *
 * Each view is a scene and a camera drawn into a scissored rectangle of the frame (venue px).
 * Views without a rectangle are skipped, so a chapter that isn't showing costs nothing. Scenes are
 * compiled in the background (renderer3d's `prepare`); nothing draws until they are ready. Each
 * view is also drawn once into a single pixel soon after it is made, one per frame, so its buffers
 * and textures are uploaded then and a frame's memory settles before a visitor opens it.
 */
import type { Camera, Object3D, OrthographicCamera, PerspectiveCamera } from "three";
import { createRenderer3D, disposeTree, type Renderer3D } from "../../core/renderer3d";
import type { FrameInfo } from "../../core/types";
import type { Rect } from "./layout";

export interface View3D {
  readonly scene: Object3D;
  readonly camera: PerspectiveCamera | OrthographicCamera;
  /** Venue px, frame coordinates; null hides the view. */
  rect: Rect | null;
  /** Called just before each draw, with the view's size in stage px. */
  beforeDraw?: (width: number, height: number) => void;
  /** Stop drawing and release the scene's geometry, materials and textures. */
  dispose(): void;
}

export interface Layer3D {
  readonly r3d: Renderer3D;
  /** True once every scene has compiled and the context is up. */
  readonly ready: boolean;
  view(scene: Object3D, camera: PerspectiveCamera | OrthographicCamera): View3D;
  /** Draw every view that has a rectangle. */
  render(): void;
  resize(frame: FrameInfo): void;
  dispose(): void;
}

const MAX_VIEWS = 16;

export const createLayer3D = (root: HTMLElement, frame: FrameInfo): Layer3D => {
  let f = frame;
  const r3d = createRenderer3D(root, frame, { alpha: true, zIndex: 0 });
  const renderer = r3d.renderer;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const views = new Set<View3D>();
  /** Views drawn at least once, for real or into the warm-up pixel. */
  const drawn = new WeakSet<View3D>();
  let disposed = false;

  const aspect = (camera: Camera, w: number, h: number) => {
    const c = camera as PerspectiveCamera;
    if (c.isPerspectiveCamera) {
      const a = w / Math.max(1, h);
      if (Math.abs(c.aspect - a) > 1e-4) {
        c.aspect = a;
        c.updateProjectionMatrix();
      }
    }
  };

  return {
    r3d,
    get ready() {
      return r3d.ready;
    },
    view(scene, camera) {
      if (views.size >= MAX_VIEWS) throw new Error("too many 3D views");
      r3d.prepare(scene, camera);
      const v: View3D = {
        scene,
        camera,
        rect: null,
        dispose() {
          views.delete(v);
          disposeTree(scene);
          // renderer3d keeps every prepared scene until it is disposed and has no way to forget
          // one; emptied, this one holds nothing more.
          scene.clear();
        },
      };
      views.add(v);
      return v;
    },
    render() {
      if (disposed || !r3d.ready) return;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.clear();
      const u = f.unit;
      let any = false;
      for (const v of views) {
        const r = v.rect;
        if (!r || r.width <= 0 || r.height <= 0) continue;
        const x = r.x * u;
        const w = r.width * u;
        const h = r.height * u;
        const y = f.height - (r.y * u + h);
        v.beforeDraw?.(w, h);
        aspect(v.camera, w, h);
        renderer.setScissorTest(true);
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        renderer.render(v.scene, v.camera);
        drawn.add(v);
        any = true;
      }
      for (const v of views) {
        if (v.rect || drawn.has(v)) continue;
        // The frame's bottom-left pixel, cleared again by the next frame's draw.
        drawn.add(v);
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, 1, 1);
        renderer.setScissor(0, 0, 1, 1);
        renderer.render(v.scene, v.camera);
        any = true;
        break;
      }
      if (any) renderer.setScissorTest(false);
    },
    resize(frame2) {
      f = frame2;
      r3d.resize(frame2);
    },
    dispose() {
      disposed = true;
      for (const v of views) v.dispose();
      views.clear();
      r3d.dispose();
    },
  };
};
