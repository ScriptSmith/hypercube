/**
 * Where the touch pads go on a table, in frame venue px, and which control a touch is on.
 *
 * - Main flippers: the left and right halves of the child band (the bottom 45 %).
 * - Plunger: the bottom corner on the plunger lane's side, taken out of that flipper's half while
 *   a ball waits in the lane.
 * - Upper flippers: the left and right edges of the adult band (the top 45 %).
 *
 * A table next to a seam keeps all its pads SEAM_MARGIN from it.
 */
import { ADULT_BAND, CHILD_BAND, SEAM_MARGIN, TABLE_H, TABLE_W } from "./config";
import type { FlipperName } from "./layout";

export type Control = FlipperName | "plunger";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TablePads {
  /** The table's left edge in the frame, venue px. */
  ox: number;
  left: Box;
  right: Box;
  upLeft: Box;
  upRight: Box;
  plunger: Box;
}

export const PLUNGER_W = 220;
export const PLUNGER_H = 330;
export const UPPER_W = 220;
export const UPPER_H = 424;

export const padsFor = (
  ox: number,
  mirror: boolean,
  seam: { left: boolean; right: boolean },
): TablePads => {
  const x0 = seam.left ? SEAM_MARGIN : 0;
  const x1 = TABLE_W - (seam.right ? SEAM_MARGIN : 0);
  const childTop = TABLE_H * (1 - CHILD_BAND);
  const adultBottom = TABLE_H * ADULT_BAND;
  const mid = TABLE_W / 2;
  const box = (x: number, y: number, w: number, h: number): Box => ({ x: ox + x, y, w, h });
  const plungerX = mirror ? x0 : x1 - PLUNGER_W;
  return {
    ox,
    left: box(x0, childTop, mid - x0, TABLE_H - childTop),
    right: box(mid, childTop, x1 - mid, TABLE_H - childTop),
    upLeft: box(x0, adultBottom - UPPER_H, UPPER_W, UPPER_H),
    upRight: box(x1 - UPPER_W, adultBottom - UPPER_H, UPPER_W, UPPER_H),
    plunger: box(plungerX, TABLE_H - PLUNGER_H, PLUNGER_W, PLUNGER_H),
  };
};

const inside = (b: Box, x: number, y: number) =>
  x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

/** The control under (x, y), venue px in the frame. */
export const controlAt = (
  p: TablePads,
  x: number,
  y: number,
  plungerLive: boolean,
): Control | null => {
  if (plungerLive && inside(p.plunger, x, y)) return "plunger";
  if (inside(p.upLeft, x, y)) return "upLeft";
  if (inside(p.upRight, x, y)) return "upRight";
  if (inside(p.left, x, y)) return "left";
  if (inside(p.right, x, y)) return "right";
  return null;
};

/** Centre of a control's pad, where a bot puts its finger. */
export const centreOf = (p: TablePads, c: Control): { x: number; y: number } => {
  const b = p[c];
  if (c === "left" || c === "right") {
    // Clear of the plunger corner and of the reset control.
    return { x: b.x + b.w / 2, y: b.y + b.h * 0.42 };
  }
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

/** The tables a frame holds: one per merged panel. */
export const tablesIn = (kind: string, span: number | undefined): number =>
  kind === "pair" ? Math.max(2, Math.min(8, span ?? 2)) : 1;
