import { vi } from "vitest";
import type { FrameInfo } from "../../src/core/types";

/** Fake timers that also cover `performance.now()`, which input and stations read. */
export const useFakeClock = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });

/**
 * A stage-like element `width` x `height` CSS px in layout, drawn at `scale` and offset by
 * (left, top) on screen, as when a fitted stage sits in a scaled iframe.
 */
export const makeRoot = (opts: {
  width: number;
  height: number;
  left?: number;
  top?: number;
  scale?: number;
}): HTMLElement => {
  const { width, height, left = 0, top = 0, scale = 1 } = opts;
  const root = document.createElement("div");
  document.body.append(root);
  root.getBoundingClientRect = () =>
    ({
      x: left,
      y: top,
      left,
      top,
      width: width * scale,
      height: height * scale,
      right: left + width * scale,
      bottom: top + height * scale,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(root, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(root, "offsetHeight", { value: height, configurable: true });
  return root;
};

export const firePointer = (
  target: EventTarget,
  type: string,
  init: PointerEventInit & { pointerId: number },
): boolean =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", ...init }),
  );

export const panelFrame = (over: Partial<FrameInfo> = {}): FrameInfo => ({
  kind: "panel",
  venueWidth: 1080,
  venueHeight: 1920,
  width: 1080,
  height: 1920,
  unit: 1,
  pixelRatio: 1,
  touch: true,
  reach: { adult: 1, child: 0.5 },
  reachTop: { adult: 0, child: 960 },
  seams: [],
  ...over,
});
