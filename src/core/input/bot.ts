import type { Input } from "../types";

/** One bot finger, down until `up()`. Coordinates are stage px. */
export interface BotTouch {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  move(x: number, y: number): void;
  up(): void;
}

export interface BotHand {
  /** Put a finger down and leave it there until `up()`; steer it with `move()`. */
  press(x: number, y: number): BotTouch;
  tap(x: number, y: number, ms?: number): Promise<void>;
  hold(x: number, y: number, ms: number): Promise<void>;
  /** Press at the first point, move along the path at an even speed over `ms`, then lift. */
  drag(path: readonly { x: number; y: number }[], ms: number): Promise<void>;
  /** Lift every finger and stop gestures in progress. Their promises resolve. */
  release(): void;
  /** Fingers currently down. */
  readonly touches: number;
  dispose(): void;
}

/** Interval between moves during a drag, about one display frame. */
const STEP_MS = 16;
const MAX_TOUCHES = 10;

/**
 * Drives synthetic touches through `input.inject`, so bots and tests take the same path as
 * fingers: hit testing, controls that swallow presses, and the app's input listeners.
 */
export const createBotHand = (input: Pick<Input, "inject">): BotHand => {
  const live = new Set<BotTouch>();
  const waits = new Set<{ timer: number; resolve(): void }>();
  let generation = 0;
  let disposed = false;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const entry = { timer: 0, resolve };
      entry.timer = window.setTimeout(() => {
        waits.delete(entry);
        resolve();
      }, ms);
      waits.add(entry);
    });

  const press = (x: number, y: number): BotTouch => {
    if (live.size >= MAX_TOUCHES) live.values().next().value?.up();
    const id = disposed ? -1 : input.inject.down(x, y);
    let cx = x;
    let cy = y;
    let active = id >= 0;
    const touch: BotTouch = {
      id,
      get x() {
        return cx;
      },
      get y() {
        return cy;
      },
      get active() {
        return active;
      },
      move(nx, ny) {
        if (!active) return;
        cx = nx;
        cy = ny;
        input.inject.move(id, nx, ny);
      },
      up() {
        if (!active) return;
        active = false;
        live.delete(touch);
        input.inject.up(id);
      },
    };
    if (active) live.add(touch);
    return touch;
  };

  const hold = async (x: number, y: number, ms: number) => {
    const gen = generation;
    const t = press(x, y);
    await wait(ms);
    if (gen === generation) t.up();
  };

  const drag = async (path: readonly { x: number; y: number }[], ms: number) => {
    const first = path[0];
    if (!first) return;
    const gen = generation;
    const lengths = [0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      lengths.push(lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = lengths[lengths.length - 1]!;
    const pointAt = (d: number) => {
      let i = 1;
      while (i < path.length - 1 && lengths[i]! < d) i++;
      const a = path[Math.max(0, i - 1)]!;
      const b = path[Math.min(path.length - 1, i)]!;
      const span = lengths[i]! - lengths[i - 1]!;
      const f = span > 0 ? (d - lengths[i - 1]!) / span : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    const t = press(first.x, first.y);
    const steps = Math.max(1, Math.round(ms / STEP_MS));
    for (let i = 1; i <= steps; i++) {
      await wait(ms / steps);
      if (gen !== generation || !t.active) return;
      const p = path.length > 1 ? pointAt((total * i) / steps) : first;
      t.move(p.x, p.y);
    }
    t.up();
  };

  const release = () => {
    generation++;
    for (const w of waits) {
      clearTimeout(w.timer);
      w.resolve();
    }
    waits.clear();
    for (const t of live) t.up();
  };

  return {
    press,
    tap: (x, y, ms = 80) => hold(x, y, ms),
    hold,
    drag,
    release,
    get touches() {
      return live.size;
    },
    dispose() {
      release();
      disposed = true;
    },
  };
};
