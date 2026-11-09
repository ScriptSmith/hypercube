/**
 * Touches on the pads and levers. A pad is absolute: touch anywhere on it and the board tips
 * towards that point, more the further out, so small children get it at once; the knob sits
 * under the finger. Fingers that slide off keep steering (clamped). With several fingers on one
 * pad, the latest wins; when it lifts, the one before it takes over.
 */
import type { Layout } from "./layout";

export type ControlKind = "pad" | "h" | "v";

interface Hold {
  board: number;
  kind: ControlKind;
  x: number;
  y: number;
  synthetic: boolean;
  order: number;
}

/** A pad touch's command: its offset from the middle over this share of the radius. */
export const PAD_REACH = 0.78;
/** A touch starts on a pad within this share of its radius. */
const PAD_HIT = 1.08;
const MAX_HOLDS = 24;

export interface Controls {
  /** Returns the control a new touch landed on, if any. */
  down(
    id: number,
    x: number,
    y: number,
    synthetic: boolean,
  ): { board: number; kind: ControlKind } | null;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  /** The latest finger on a board's pad as a command (unit disc), and whether it is a bot's. */
  pad(board: number): { x: number; y: number; synthetic: boolean } | null;
  /** The latest finger on a lever, from -1 to 1, and whether it is a bot's. */
  lever(board: number, kind: "h" | "v"): { v: number; synthetic: boolean } | null;
  setLayout(layout: Layout): void;
  clear(): void;
  readonly holds: number;
}

export const padCommand = (pad: { x: number; y: number; r: number }, x: number, y: number) => {
  let cx = (x - pad.x) / (pad.r * PAD_REACH);
  let cy = (y - pad.y) / (pad.r * PAD_REACH);
  const l = Math.hypot(cx, cy);
  if (l > 1) {
    cx /= l;
    cy /= l;
  }
  return { x: cx, y: cy };
};

export const createControls = (initial: Layout): Controls => {
  let layout = initial;
  const holds = new Map<number, Hold>();
  let order = 0;

  const latest = (board: number, kind: ControlKind): Hold | null => {
    let best: Hold | null = null;
    for (const h of holds.values()) {
      if (h.board === board && h.kind === kind && (!best || h.order > best.order)) best = h;
    }
    return best;
  };

  return {
    down(id, x, y, synthetic) {
      holds.delete(id);
      for (let b = 0; b < layout.boards.length; b++) {
        const slot = layout.boards[b]!;
        let kind: ControlKind | null = null;
        if (slot.pad && Math.hypot(x - slot.pad.x, y - slot.pad.y) <= slot.pad.r * PAD_HIT) {
          kind = "pad";
        } else if (slot.levers) {
          for (const k of ["h", "v"] as const) {
            const r = slot.levers[k].hit;
            if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) kind = k;
          }
        }
        if (!kind) continue;
        if (holds.size >= MAX_HOLDS) {
          const oldest = [...holds.entries()].sort((a, c) => a[1].order - c[1].order)[0];
          if (oldest) holds.delete(oldest[0]);
        }
        holds.set(id, { board: b, kind, x, y, synthetic, order: ++order });
        return { board: b, kind };
      }
      return null;
    },
    move(id, x, y) {
      const h = holds.get(id);
      if (!h) return;
      h.x = x;
      h.y = y;
    },
    up(id) {
      holds.delete(id);
    },
    pad(board) {
      const h = latest(board, "pad");
      const pad = layout.boards[board]?.pad;
      if (!h || !pad) return null;
      return { ...padCommand(pad, h.x, h.y), synthetic: h.synthetic };
    },
    lever(board, kind) {
      const h = latest(board, kind);
      const l = layout.boards[board]?.levers?.[kind];
      if (!h || !l) return null;
      const dx = l.x1 - l.x0;
      const dy = l.y1 - l.y0;
      const t = ((h.x - l.x0) * dx + (h.y - l.y0) * dy) / Math.max(1e-6, dx * dx + dy * dy);
      return { v: Math.min(1, Math.max(-1, t * 2 - 1)), synthetic: h.synthetic };
    },
    setLayout(l) {
      layout = l;
      holds.clear();
    },
    clear() {
      holds.clear();
    },
    get holds() {
      return holds.size;
    },
  };
};
