/**
 * The picture as drawn. Before the waves come in, the walk-through shows the circle larger
 * (and for the arc step, where the unrolled arc has room); when they come in, it slides back
 * beside them and the graphs fade in. It eases towards wherever it should be, so a change of
 * step mid-slide carries on smoothly.
 */
import { type Layout, lerpBox, lerpPic, type Pic, type TextBox } from "./layout";
import type { Parts, StepId } from "./walk";

/** Time constant of the slide, in seconds. */
export const SLIDE_S = 0.28;

export type Zoom = "none" | "zoom" | "arc";

export interface View {
  readonly pic: Pic;
  /** The readout's box, which moves up larger where the zoom leaves room. */
  readonly readout: TextBox;
  /** How far zoomed: 1 fully, 0 in place. */
  readonly u: number;
  /** How much of the graphs shows. */
  readonly graphAlpha: number;
  step(dt: number, zoom: Zoom): void;
}

/** Which picture a step wants. */
export const zoomFor = (sh: { parts: Parts; id: StepId | null }): Zoom =>
  sh.parts.graphs ? "none" : sh.id === "arc" ? "arc" : "zoom";

const targetOf = (l: Layout, z: Zoom): Pic =>
  z === "none" || !l.zoom ? l.pic : z === "arc" ? (l.zoomArc ?? l.zoom) : l.zoom;

export const createView = (layout: () => Layout, zoom: Zoom): View => {
  let current = targetOf(layout(), zoom);
  const zoomedness = () => {
    const l = layout();
    if (!l.zoom) return 0;
    const span = l.zoom.r - l.pic.r;
    // The arc step's circle can be no larger than the full picture's; it is still zoomed.
    const away =
      Math.hypot(current.cx - l.pic.cx, current.cy - l.pic.cy) + Math.abs(current.r - l.pic.r);
    return Math.max(0, Math.min(1, away / Math.max(1, span)));
  };
  return {
    get pic() {
      return current;
    },
    get readout() {
      const l = layout();
      return lerpBox(l.readout, l.readoutZoom, zoomedness());
    },
    get u() {
      return zoomedness();
    },
    get graphAlpha() {
      return (1 - zoomedness()) ** 2;
    },
    step(dt, z) {
      const target = targetOf(layout(), z);
      const k = 1 - Math.exp(-Math.max(0, dt) / SLIDE_S);
      const next = lerpPic(current, target, k);
      const close =
        Math.abs(next.cx - target.cx) < 0.5 &&
        Math.abs(next.cy - target.cy) < 0.5 &&
        Math.abs(next.r - target.r) < 0.5;
      current = close ? target : next;
    },
  };
};
