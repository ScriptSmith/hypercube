/**
 * Bots for attract and testing: now and then (every 20 to 40 s) a synthetic touch on a mode,
 * route or zoom button, a drag across the open map, or a tap on a vehicle in the reachable band,
 * through the same input path as a person. They hold off while people are using the frame.
 */
import type { Input, Rng } from "../../core/types";
import type { Box } from "./layout";

export const FIRST_MS = 6000;
export const EVERY_MS: [number, number] = [20_000, 40_000];
/** Bots wait this long after a person's touch. */
export const QUIET_MS = 30_000;
const TAP_MS = 140;
const DRAG_STEPS = 10;
const DRAG_STEP_MS = 60;

export interface BotTarget {
  kind: "mode" | "line" | "zoom" | "vehicle";
  id: string;
  x: number;
  y: number;
}

export interface Bots {
  tick(now: number): void;
  readonly actions: number;
  readonly last: BotTarget | null;
  readonly drags: number;
  dispose(): void;
}

export const createBots = (opts: {
  input: Input;
  rng: Rng;
  buttons(): BotTarget[];
  vehicles(): BotTarget[];
  /** Stage px where a drag may run, or null for none. */
  open?(): Box | null;
  /** Local ms of the latest person's touch. */
  humanAt(): number;
  start: number;
}): Bots => {
  let next = opts.start + FIRST_MS;
  let actions = 0;
  let last: BotTarget | null = null;
  let drags = 0;
  let dragging = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  const tap = (t: BotTarget) => {
    const id = opts.input.inject.down(t.x, t.y);
    later(TAP_MS, () => opts.input.inject.up(id));
  };

  /** A finger across part of `area`, moving steadily, then lifting. */
  const drag = (area: Box) => {
    const x0 = area.x + area.w * opts.rng.range(0.3, 0.7);
    const y0 = area.y + area.h * opts.rng.range(0.3, 0.7);
    const angle = opts.rng.range(0, Math.PI * 2);
    const len = Math.min(area.w, area.h) * opts.rng.range(0.25, 0.45);
    const x1 = Math.max(area.x, Math.min(area.x + area.w, x0 + Math.cos(angle) * len));
    const y1 = Math.max(area.y, Math.min(area.y + area.h, y0 + Math.sin(angle) * len));
    const id = opts.input.inject.down(x0, y0);
    dragging = true;
    drags++;
    let step = 0;
    const next = () => {
      step++;
      if (step > DRAG_STEPS) {
        opts.input.inject.up(id);
        dragging = false;
        return;
      }
      const k = step / DRAG_STEPS;
      opts.input.inject.move(id, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      later(DRAG_STEP_MS, next);
    };
    later(DRAG_STEP_MS, next);
  };

  return {
    tick(now) {
      if (now < next) return;
      next = now + opts.rng.range(EVERY_MS[0], EVERY_MS[1]);
      if (now - opts.humanAt() < QUIET_MS || dragging) return;
      const r = opts.rng.next();
      if (r >= 0.73 && r < 0.85) {
        const area = opts.open?.();
        if (area && area.w > 0 && area.h > 0) {
          actions++;
          drag(area);
          return;
        }
      }
      const buttons = opts.buttons();
      const modes = buttons.filter((b) => b.kind === "mode");
      const lines = buttons.filter((b) => b.kind === "line");
      const zooms = buttons.filter((b) => b.kind === "zoom");
      const vehicles = r >= 0.85 ? opts.vehicles() : [];
      let target: BotTarget | null = null;
      if (vehicles.length) target = opts.rng.pick(vehicles);
      else if (r < 0.35 && modes.length) target = opts.rng.pick(modes);
      else if (r >= 0.65 && r < 0.73 && zooms.length) target = opts.rng.pick(zooms);
      else if (lines.length) target = opts.rng.pick(lines);
      else if (modes.length) target = opts.rng.pick(modes);
      if (!target) return;
      actions++;
      last = target;
      tap(target);
    },
    get actions() {
      return actions;
    },
    get last() {
      return last;
    },
    get drags() {
      return drags;
    },
    dispose() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
};
