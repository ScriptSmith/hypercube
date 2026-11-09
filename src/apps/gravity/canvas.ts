/** Two stacked canvases: a backdrop drawn once per size and the moving layer drawn every frame. */
import type { FrameInfo } from "../../core/types";
import { drawBackdrop } from "./draw";

export interface Layers {
  readonly g: CanvasRenderingContext2D;
  /** Backing-store px per CSS px. */
  readonly ratio: number;
  readonly width: number;
  readonly height: number;
  resize(frame: FrameInfo): void;
  clear(): void;
  dispose(): void;
}

export const createLayers = (
  root: HTMLElement,
  frame: FrameInfo,
  seed: number,
  density = 1,
): Layers => {
  const make = () => {
    const c = document.createElement("canvas");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    return c;
  };
  const bg = make();
  const fg = make();
  root.append(bg, fg);
  const bgc = bg.getContext("2d", { alpha: false })!;
  const g = fg.getContext("2d")!;
  let ratio = 1;
  let width = 1;
  let height = 1;
  const resize = (f: FrameInfo) => {
    ratio = f.pixelRatio;
    width = Math.max(1, Math.round(f.width * ratio));
    height = Math.max(1, Math.round(f.height * ratio));
    for (const c of [bg, fg]) {
      c.width = width;
      c.height = height;
    }
    drawBackdrop(bgc, width, height, seed, density);
  };
  resize(frame);
  return {
    g,
    get ratio() {
      return ratio;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    resize,
    clear() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, width, height);
    },
    dispose() {
      // Shrinking the backing stores frees their memory at once.
      for (const c of [bg, fg]) {
        c.width = 1;
        c.height = 1;
        c.remove();
      }
    },
  };
};
