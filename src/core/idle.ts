import type { IdleControl, Input } from "./types";

export interface IdleHandle extends IdleControl {
  dispose(): void;
}

/** Re-arming the timer on every move of every finger is wasted work; this is plenty precise. */
const REARM_MS = 250;

/**
 * Goes idle after `timeoutMs` without touches, pokes or holds. With an input that reports all
 * activity (the runtime's does), presses swallowed by controls and station overlays count too.
 */
export const createIdle = (
  input: Input & { onActivity?(cb: () => void): () => void },
  timeoutMs: number,
): IdleHandle => {
  let idle = false;
  let holds = 0;
  let timer = 0;
  let armedAt = -Infinity;
  const listeners = new Set<(idle: boolean) => void>();

  const set = (value: boolean) => {
    if (idle === value) return;
    idle = value;
    for (const cb of listeners) cb(idle);
  };
  const arm = () => {
    clearTimeout(timer);
    timer = 0;
    armedAt = performance.now();
    if (holds === 0) timer = window.setTimeout(() => set(true), timeoutMs);
  };
  const poke = () => {
    set(false);
    arm();
  };
  const touched = () => {
    if (!idle && holds === 0 && timer && performance.now() - armedAt < REARM_MS) return;
    poke();
  };

  const offs = input.onActivity
    ? [input.onActivity(touched)]
    : [input.on("down", touched), input.on("move", touched)];
  arm();

  return {
    get idle() {
      return idle;
    },
    poke,
    hold() {
      holds++;
      poke();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        arm();
      };
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      clearTimeout(timer);
      for (const off of offs) off();
      listeners.clear();
    },
  };
};
