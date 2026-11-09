import type { Loop, LoopSpec } from "./types";

/** Longest real-time gap we simulate after a stall, so a hiccup can't trigger a catch-up spiral. */
const MAX_FRAME_SECONDS = 0.25;

export const createLoop = (spec: LoopSpec): Loop => {
  const step = 1 / (spec.hz ?? 60);
  let handle = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  const tick = (now: number) => {
    handle = requestAnimationFrame(tick);
    // A frame's timestamp can predate start() when mount blocked the page, so clamp below too.
    const elapsed = Math.max(0, Math.min((now - last) / 1000, MAX_FRAME_SECONDS));
    last = now;
    acc += elapsed;
    while (acc >= step) {
      spec.update?.(step);
      acc -= step;
    }
    spec.render?.(acc / step);
  };

  return {
    start() {
      if (running) return;
      running = true;
      acc = 0;
      last = performance.now();
      handle = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    get running() {
      return running;
    },
  };
};
