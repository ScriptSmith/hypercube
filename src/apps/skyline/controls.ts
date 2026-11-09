/**
 * Touches on the controls, in venue px. Pure (no DOM), so tests can drive it.
 *
 * - A pad takes the finger that lands on it (a little margin counts) and maps it to the hook's
 *   target: across is the trolley, up and down the hook. The latest finger on a pad wins.
 * - The release button lets go of the load. A block button sends one block up the lift.
 */
import type { Rect } from "../../core/types";
import type { Layout } from "./layout";

export type Who = "person" | "bot";

export interface ControlEvents {
  aim(crane: number, x: number, y: number, who: Who): void;
  /** The finger on a pad lifted. */
  lift(crane: number, who: Who): void;
  release(crane: number, who: Who): void;
  send(crane: number, kind: number, who: Who): void;
}

/** The pad's live area, inside its frame. */
export const PAD_INSET = 26;
const PAD_SLOP = 36;
const BUTTON_SLOP = 14;
const RELEASE_SLOP = 22;

export const padBox = (pad: Rect): Rect => ({
  x: pad.x + PAD_INSET,
  y: pad.y + PAD_INSET,
  width: Math.max(1, pad.width - 2 * PAD_INSET),
  height: Math.max(1, pad.height - 2 * PAD_INSET),
});

/** A venue point to the pad's box (y up), clamped to it. */
export const padToBox = (pad: Rect, x: number, y: number) => {
  const b = padBox(pad);
  return {
    x: Math.min(1, Math.max(0, (x - b.x) / b.width)),
    y: Math.min(1, Math.max(0, 1 - (y - b.y) / b.height)),
  };
};

/** The pad's box to a venue point. */
export const boxToPad = (pad: Rect, x: number, y: number) => {
  const b = padBox(pad);
  return { x: b.x + x * b.width, y: b.y + (1 - y) * b.height };
};

const inRect = (r: Rect, x: number, y: number, slop: number) =>
  x >= r.x - slop && x <= r.x + r.width + slop && y >= r.y - slop && y <= r.y + r.height + slop;

export interface Controls {
  down(id: number, x: number, y: number, who: Who, now: number): boolean;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  /** Which finger holds a crane's pad. */
  holder(crane: number): number | null;
  /** When each button was last pressed (ms), by crane and kind, for the press look. */
  readonly pressed: Map<string, number>;
  readonly releasedAt: Map<number, number>;
  setLayout(l: Layout): void;
  clear(): void;
}

export const createControls = (initial: Layout, ev: ControlEvents): Controls => {
  let layout = initial;
  const pads = new Map<number, { crane: number; who: Who }>();
  const pressed = new Map<string, number>();
  const releasedAt = new Map<number, number>();

  const holder = (crane: number) => {
    let last: number | null = null;
    for (const [id, h] of pads) if (h.crane === crane) last = id;
    return last;
  };

  return {
    down(id, x, y, who, now) {
      for (const c of layout.cranes) {
        if (inRect(c.pad, x, y, PAD_SLOP)) {
          // The latest finger takes the pad.
          for (const [other, h] of pads) if (h.crane === c.index) pads.delete(other);
          pads.set(id, { crane: c.index, who });
          const p = padToBox(c.pad, x, y);
          ev.aim(c.index, p.x, p.y, who);
          return true;
        }
        const r = c.release;
        if (Math.hypot(x - r.x, y - r.y) <= r.r + RELEASE_SLOP) {
          releasedAt.set(c.index, now);
          ev.release(c.index, who);
          return true;
        }
        for (const b of c.buttons) {
          if (!inRect(b.rect, x, y, BUTTON_SLOP)) continue;
          pressed.set(`${c.index}:${b.kind}`, now);
          ev.send(c.index, b.kind, who);
          return true;
        }
      }
      return false;
    },
    move(id, x, y) {
      const h = pads.get(id);
      if (!h) return;
      const c = layout.cranes[h.crane];
      if (!c) return;
      const p = padToBox(c.pad, x, y);
      ev.aim(h.crane, p.x, p.y, h.who);
    },
    up(id) {
      const h = pads.get(id);
      if (!h) return;
      pads.delete(id);
      ev.lift(h.crane, h.who);
    },
    holder,
    pressed,
    releasedAt,
    setLayout(l) {
      layout = l;
      pads.clear();
    },
    clear() {
      pads.clear();
    },
  };
};
