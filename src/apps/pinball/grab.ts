/**
 * The ball grab: a person who touches on or near a ball on their table picks it up, drags it and
 * throws it by letting go. The table keeps track of who holds what (table.ts) and the solver
 * moves held balls (physics.ts); this decides which ball a touch takes and what a new touch does.
 */
import { type Control, controlAt, type TablePads } from "./pads";
import type { Ball } from "./physics";
import type { Table } from "./table";

/** The ball nearest (x, y) with its edge within `reach` of it, leaving out `skip`, or null. */
export const pickBall = (
  balls: readonly Ball[],
  x: number,
  y: number,
  reach: number,
  skip: (b: Ball) => boolean,
): Ball | null => {
  let best: Ball | null = null;
  let bestD = Infinity;
  for (const b of balls) {
    if (skip(b)) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d <= b.r + reach && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
};

/**
 * What a new touch at (x, y), frame venue px, does on a table: a person's touch near a ball picks
 * it up and works nothing else; any other touch works the pad under it. Bots never pick up.
 */
export const touchDown = (
  table: Table,
  pads: TablePads,
  finger: number,
  x: number,
  y: number,
  person: boolean,
): Control | "grab" | null => {
  if (person && table.grab(finger, x - pads.ox, y)) return "grab";
  return controlAt(pads, x, y, table.waiting());
};
