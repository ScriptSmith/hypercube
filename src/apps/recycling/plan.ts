/**
 * The way a hand carries an item to a bin without passing down through another bin's mouth on
 * the way (on panels the drop-off box hangs above the household bins). Used by bots and the
 * attract mode's ghost hand.
 */
import type { BinSlot, Layout } from "./layout";
import type { Point } from "./paths";

export const planCarry = (layout: Layout, from: Point, target: BinSlot): Point[] => {
  const { r, d } = layout;
  const pts: Point[] = [{ ...from }];
  let at: Point = { ...from };
  const goal = target.mouth;
  const blockers = layout.bins
    .filter((b) => b !== target && b.top > at.y && b.top < goal.y)
    .sort((a, b) => a.top - b.top);
  for (const b of blockers) {
    const m = b.mouth;
    // Going straight down at the target's x misses it.
    if (target.x < m.x0 - r || target.x > m.x1 + r) continue;
    // Step round it: across to its nearer side above it, down past its bottom, then on.
    const side = target.x < b.x ? m.x0 - r * 1.4 : m.x1 + r * 1.4;
    const x = Math.min(layout.width - r, Math.max(r, side));
    const y = b.bottom + r * 1.1;
    pts.push({ x, y: at.y }, { x, y });
    at = { x, y };
  }
  pts.push({ x: target.x, y: Math.min(at.y, goal.y - d * 0.9) });
  pts.push({ x: target.x, y: goal.y + d * 0.35 });
  return pts;
};

/** Length of a polyline. */
export const pathLength = (pts: readonly Point[]): number => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return n;
};
