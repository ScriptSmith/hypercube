/**
 * Where the balls stand on a wall: in a row along a floor near the bottom, as large as the wall
 * allows, so a child reaches the lower part of each and the windows sit above the crowd's heads
 * but not out of reading range. Each ball is seen from its own eye straight in front of it, a
 * little above its centre, so every ball looks at the people in front of it.
 */
import type { FrameInfo } from "../../core/types";
import { outline } from "./wallview";

export type BallCount = 1 | 2 | 3;

/** The eye: how far above the balls' centres and how far out from the wall, ball radii. */
export const EYE = { up: 0.22, out: 3.4 };
/** Venue px of floor left below the balls, for their shadows. */
const FLOOR_GAP = 230;
/** Venue px kept clear above the balls. */
const TOP_GAP = 110;
/** A ball's outline fills at most this share of its slot along the wall. */
const SLOT_FILL = 0.84;

export interface WallLayout {
  count: BallCount;
  /** Stage px per ball radius on the picture. */
  scale: number;
  /** Each ball's centre at rest, stage px (y down). */
  balls: { x: number; y: number }[];
  /** Stage y of the floor under the balls, where they touch it. */
  floor: number;
  /** Radius of each ball's outline as drawn, stage px, and how far its middle sits above the centre. */
  outline: number;
  outlineRise: number;
}

/** The outline of a ball at rest, in ball radii. */
export const restOutline = () => outline([0, EYE.up, EYE.out]);

export const wallLayout = (
  frame: Pick<FrameInfo, "width" | "height" | "unit">,
  count: BallCount,
): WallLayout => {
  const { width, height, unit } = frame;
  const o = restOutline();
  const slot = width / count;
  const tall = height - (FLOOR_GAP + TOP_GAP) * unit;
  // The outline is a little larger than the ball, and its top is what has to fit under the gap.
  const fromWidth = (SLOT_FILL * slot) / 2 / o.r;
  const fromHeight = tall / (1 + o.y + o.r);
  const scale = Math.max(1, Math.min(fromWidth, fromHeight));
  const floor = height - FLOOR_GAP * unit;
  const y = floor - scale;
  const balls = Array.from({ length: count }, (_, i) => ({ x: slot * (i + 0.5), y }));
  return { count, scale, balls, floor, outline: o.r * scale, outlineRise: o.y * scale };
};

/** Which ball a touch at stage (x, y) is on, or -1; touches a little outside still count. */
export const ballAt = (
  layout: WallLayout,
  x: number,
  y: number,
  centres: readonly { x: number; y: number }[] = layout.balls,
): number => {
  let best = -1;
  let bestD = Infinity;
  centres.forEach((c, i) => {
    const d = Math.hypot(x - c.x, y - (c.y - layout.outlineRise));
    if (d < layout.outline * 1.12 && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
};
