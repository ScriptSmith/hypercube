/**
 * Turns touches on the tile area into launches and page turns. A tile launches only when the
 * same finger lands and lifts on it without travelling far, so a hand brushing across the
 * screen starts nothing. A mostly sideways stroke turns the page.
 */
export interface TapOptions {
  /** Index of the tile at a point, or -1. */
  hit(x: number, y: number): number;
  /** Travel (stage px) beyond which a press stops being a tap. */
  slop: number;
  /** Sideways travel (stage px) that counts as a swipe. */
  swipe: number;
}

export type TapOutcome = { type: "launch"; index: number } | { type: "page"; dir: 1 | -1 } | null;

interface Press {
  /** The tile still armed by this finger, or -1 once it slid off or travelled too far. */
  index: number;
  x0: number;
  y0: number;
}

/** Fingers tracked at once. Touch frames lose lifts now and then, so old ones are dropped. */
const MAX_PRESSES = 20;

export interface TapTracker {
  down(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number): TapOutcome;
  cancel(id: number): void;
  /** Tiles currently held by an armed finger. */
  armed(): Set<number>;
  clear(): void;
}

export const createTapTracker = (opts: TapOptions): TapTracker => {
  const presses = new Map<number, Press>();

  const disarm = (p: Press, x: number, y: number) => {
    if (p.index < 0) return;
    if (opts.hit(x, y) !== p.index || Math.hypot(x - p.x0, y - p.y0) > opts.slop) p.index = -1;
  };

  return {
    down(id, x, y) {
      presses.delete(id);
      presses.set(id, { index: opts.hit(x, y), x0: x, y0: y });
      if (presses.size > MAX_PRESSES) {
        const oldest = presses.keys().next().value;
        if (oldest !== undefined) presses.delete(oldest);
      }
    },
    move(id, x, y) {
      const p = presses.get(id);
      if (p) disarm(p, x, y);
    },
    up(id, x, y) {
      const p = presses.get(id);
      if (!p) return null;
      presses.delete(id);
      disarm(p, x, y);
      if (p.index >= 0) return { type: "launch", index: p.index };
      const dx = x - p.x0;
      const dy = y - p.y0;
      if (Math.abs(dx) >= opts.swipe && Math.abs(dx) >= 2 * Math.abs(dy)) {
        return { type: "page", dir: dx < 0 ? 1 : -1 };
      }
      return null;
    },
    cancel(id) {
      presses.delete(id);
    },
    armed() {
      const out = new Set<number>();
      for (const p of presses.values()) if (p.index >= 0) out.add(p.index);
      return out;
    },
    clear() {
      presses.clear();
    },
  };
};
