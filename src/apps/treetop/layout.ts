/**
 * Where lanes go on a touch frame, in venue px. Each panel-wide column of the frame (a panel, or
 * each half of a pair) is one lane in `race`, or two stacked lanes in `pads`: a child lane in the
 * lower half and an adult lane in the upper half. Next to a pair's seam a strip of each lane
 * doesn't flap, because touches close together across the seam can be dropped.
 */
import type { Rect } from "../../core/types";
import { COURSE_H, type Variant } from "./config";
import { MAX_SLOTS } from "./wire";

/** Width of the no-flap strip on each side of a seam, venue px. */
export const SEAM_KEEP = 220;

export interface LaneSpec {
  slot: number;
  /** The lane's area on the frame. */
  rect: Rect;
  /** Where a tap flaps this lane. */
  touch: Rect;
  /** Strips of the lane to draw dim because they don't flap. */
  dim: Rect[];
  /** Venue px per course px. */
  scale: number;
  /** The heavier, faster glider of a `pads` lane pair. */
  adult: boolean;
  /** The `pads` lane this is, or null in `race`. */
  pad: "child" | "adult" | null;
  /** Which panel-wide column of the frame the lane is in. */
  column: number;
}

export interface FrameShape {
  width: number;
  height: number;
  /** Seam x positions, venue px. */
  seams: readonly number[];
}

export const lanesFor = (frame: FrameShape, variant: Variant): LaneSpec[] => {
  const edges = [0, ...[...frame.seams].sort((a, b) => a - b), frame.width];
  const lanes: LaneSpec[] = [];
  for (let col = 0; col + 1 < edges.length && lanes.length < MAX_SLOTS; col++) {
    const x0 = edges[col]!;
    const x1 = edges[col + 1]!;
    if (x1 - x0 < 1) continue;
    const seamLeft = col > 0;
    const seamRight = col + 2 < edges.length;
    const keepL = seamLeft ? Math.min(SEAM_KEEP, (x1 - x0) / 3) : 0;
    const keepR = seamRight ? Math.min(SEAM_KEEP, (x1 - x0) / 3) : 0;
    const rows =
      variant === "pads"
        ? ([
            ["child", frame.height / 2, frame.height / 2],
            ["adult", 0, frame.height / 2],
          ] as const)
        : ([[null, 0, frame.height]] as const);
    for (const [pad, y, h] of rows) {
      if (lanes.length >= MAX_SLOTS) break;
      const rect = { x: x0, y, width: x1 - x0, height: h };
      const dim: Rect[] = [];
      if (keepL) dim.push({ x: x0, y, width: keepL, height: h });
      if (keepR) dim.push({ x: x1 - keepR, y, width: keepR, height: h });
      lanes.push({
        slot: lanes.length,
        rect,
        touch: { x: x0 + keepL, y, width: x1 - x0 - keepL - keepR, height: h },
        dim,
        scale: h / COURSE_H,
        adult: pad === "adult",
        pad,
        column: col,
      });
    }
  }
  return lanes;
};

/** The lane whose touch area holds (x, y), venue px. */
export const laneAt = (lanes: readonly LaneSpec[], x: number, y: number): LaneSpec | null =>
  lanes.find(
    (l) =>
      x >= l.touch.x &&
      x < l.touch.x + l.touch.width &&
      y >= l.touch.y &&
      y < l.touch.y + l.touch.height,
  ) ?? null;

/**
 * A lane's column on the screen above the bank, as fractions of the screen width: the frame's
 * share of the bank, split evenly between the frame's lanes in slot order.
 */
export const columnSpan = (
  pos: number,
  slot: number,
  n: number,
  count: number,
): { x0: number; x1: number } => {
  const c = Math.max(1, count);
  const lanes = Math.max(1, n);
  const s = Math.min(Math.max(0, slot), lanes - 1);
  return { x0: (pos + s / lanes) / c, x1: (pos + (s + 1) / lanes) / c };
};

/** Width of the strip either side of the join between two wall lanes that doesn't flap. */
export const WALL_KEEP = 24;

export interface WallLayout {
  /** Lanes column by column, left to right; in `pads` each column's child lane comes first. */
  lanes: LaneSpec[];
  columns: number;
  /** Venue y of the top of the lanes. */
  laneTop: number;
  /** The pack view runs from the top of the wall down to here. */
  packH: number;
  /** Progress strips between the pack view and the lanes. */
  band: { top: number; bottom: number };
}

/**
 * A wall's lanes and the race above them, venue px. Lanes stand side by side from the floor up
 * to adult reach, one per column in `race`. In `pads` each column has a child lane at the bottom,
 * inside child reach, and an adult lane above it. Above reach are the progress strips and, at
 * the top, the pack view. `reach` is the frame's reach as fractions of its height.
 */
export const wallLayout = (
  frame: { width: number; height: number },
  variant: Variant,
  columns: number,
  reach: { adult: number; child: number },
): WallLayout => {
  const W = frame.width;
  const H = frame.height;
  const n = Math.max(1, Math.round(columns));
  const laneH = Math.round(Math.min(H * 0.6, Math.max(H * 0.3, reach.adult * H)));
  const laneTop = H - laneH;
  const bandH = Math.round(Math.min(340, Math.max(200, laneTop * 0.24)));
  const childH = Math.round(Math.min(laneH / 2, Math.max(laneH * 0.35, reach.child * H)));
  const lanes: LaneSpec[] = [];
  for (let col = 0; col < n; col++) {
    const x0 = Math.round((col * W) / n);
    const x1 = Math.round(((col + 1) * W) / n);
    const keepL = col > 0 ? WALL_KEEP : 0;
    const keepR = col < n - 1 ? WALL_KEEP : 0;
    const rows =
      variant === "pads"
        ? ([
            ["child", H - childH, childH],
            ["adult", laneTop, laneH - childH],
          ] as const)
        : ([[null, laneTop, laneH]] as const);
    rows.forEach(([pad, y, h], slot) => {
      const dim: Rect[] = [];
      if (keepL) dim.push({ x: x0, y, width: keepL, height: h });
      if (keepR) dim.push({ x: x1 - keepR, y, width: keepR, height: h });
      lanes.push({
        slot,
        rect: { x: x0, y, width: x1 - x0, height: h },
        touch: { x: x0 + keepL, y, width: x1 - x0 - keepL - keepR, height: h },
        dim,
        scale: h / COURSE_H,
        adult: pad === "adult",
        pad,
        column: col,
      });
    });
  }
  return {
    lanes,
    columns: n,
    laneTop,
    packH: laneTop - bandH,
    band: { top: laneTop - bandH, bottom: laneTop },
  };
};
