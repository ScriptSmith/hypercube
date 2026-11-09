/**
 * Where workstations, slots and the build go on a touch frame, in venue px, from the frame's size,
 * reach and seams. A panel is one workstation; a pair is one per panel; a wall has `stations`
 * along it. Each workstation has a child slot low and (unless `slots` is "low") an adult slot
 * above it, each with a narrow rail on the side away from any seam that holds its reset control
 * and progress. Pure, so tests can check every frame kind.
 */
import type { FrameKind } from "../../core/types";
import type { SlotsMode } from "./config";
import type { Band } from "./tasks/common";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  /** Venue y of the top of adult and child reach (larger is lower). */
  reachTop: { adult: number; child: number };
  /** Venue x of physical seams. */
  seams: readonly number[];
  /** Panels in the frame (2 or more for merged panels). */
  span: number;
  /** Workstations on a wall. */
  stations: number;
  slots: SlotsMode;
}

export interface SlotSpec {
  band: Band;
  /** The whole slot. */
  rect: Box;
  /** Where the task lives. */
  task: Box;
  /** The rail beside the task: reset control at the top, progress below. */
  rail: Box;
  reset: { x: number; y: number; r: number };
  /** Smallest touch target for tasks here. */
  target: number;
  coarse: boolean;
}

export interface Workstation {
  index: number;
  x0: number;
  x1: number;
  low: SlotSpec;
  high: SlotSpec | null;
  /** Where this workstation shows its order: its part of the top strip, or a chip on the wall. */
  badge: Box;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  stations: Workstation[];
  /** The top strip of a panel or pair, or the area above reach on a wall. */
  top: Box;
  /** The adult area left as scenery when only child slots show, else null. */
  scene: Box | null;
  /** A free spot for the runtime's Home control, venue px. */
  home: Box;
}

/** Nothing a task draws or takes touches in comes nearer a seam than this. */
export const SEAM_CLEAR = 120;
export const RESET_SIZE = 120;
const RAIL = 140;
/** Wall rails are wider, so the first one can also hold the Home control under its reset. */
const WALL_RAIL = 176;
const WALL_HOME = 160;
const GAP = 12;

const TARGETS = {
  panel: { low: 180, high: 130 },
  wall: { low: 200, high: 150 },
} as const;

const slotSpec = (
  band: Band,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  railSide: -1 | 1,
  coarse: boolean,
): SlotSpec => {
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const rw = coarse ? WALL_RAIL : RAIL;
  const rail =
    railSide < 0 ? { x: x0, y: y0, w: rw, h: y1 - y0 } : { x: x1 - rw, y: y0, w: rw, h: y1 - y0 };
  const task =
    railSide < 0
      ? { x: x0 + rw + GAP, y: y0, w: x1 - x0 - rw - GAP, h: y1 - y0 }
      : { x: x0, y: y0, w: x1 - x0 - rw - GAP, h: y1 - y0 };
  const r = RESET_SIZE / 2;
  const t = coarse ? TARGETS.wall : TARGETS.panel;
  return {
    band,
    rect,
    task,
    rail,
    reset: { x: rail.x + rail.w / 2, y: y0 + 10 + r, r },
    target: t[band],
    coarse,
  };
};

/** Smallest adult slot worth showing. */
const MIN_HIGH = 260;

export const layoutFor = (input: LayoutInput): Layout => {
  const { width: W, height: H, reachTop } = input;
  const childTop = Math.min(H - 300, Math.max(0, reachTop.child));
  const stations: Workstation[] = [];
  if (input.kind === "wall") {
    const n = Math.max(1, Math.round(input.stations));
    const m = 24;
    const adultTop = Math.min(childTop - 120, Math.max(0, reachTop.adult));
    const sw = W / n;
    for (let i = 0; i < n; i++) {
      const x0 = i * sw;
      const x1 = x0 + sw;
      // The first station's rails sit at the wall's left edge, clear of its neighbour.
      const side: -1 | 1 = i === 0 ? -1 : 1;
      const low = slotSpec("low", x0 + m, x1 - m, childTop + 10, H - m, side, true);
      const highH = childTop - 8 - (adultTop + 8);
      const high =
        input.slots === "both" && highH >= 200
          ? slotSpec("high", x0 + m, x1 - m, adultTop + 8, childTop - 8, side, true)
          : null;
      const chip = 120;
      stations.push({
        index: i,
        x0,
        x1,
        low,
        high,
        badge: { x: (x0 + x1) / 2 - chip / 2, y: adultTop - chip - 14, w: chip, h: chip },
      });
    }
    const topH = Math.max(0, adultTop - 10);
    // Home goes in the first rail under its reset: the adult one, else the child one.
    const first = stations[0]!;
    const homeRail = (first.high ?? first.low).rail;
    const homeTop = (first.high ?? first.low).reset.y + RESET_SIZE / 2 + 12;
    return {
      kind: input.kind,
      width: W,
      height: H,
      stations,
      top: { x: 0, y: 0, w: W, h: topH },
      scene: input.slots === "low" ? { x: 0, y: adultTop, w: W, h: childTop - adultTop } : null,
      home: {
        x: homeRail.x + (homeRail.w - WALL_HOME) / 2,
        y: homeTop,
        w: WALL_HOME,
        h: WALL_HOME,
      },
    };
  }

  // Panels and merged panels: one workstation per panel.
  const m = 22;
  const span = Math.max(1, Math.round(input.span));
  const pw = W / span;
  const stripBottom = Math.min(childTop - MIN_HIGH, Math.max(reachTop.adult, H * 0.205));
  const highTop = stripBottom + 14;
  const showHigh = input.slots === "both" && childTop - 10 - highTop >= MIN_HIGH;
  const nearSeam = (x: number) => input.seams.some((s) => Math.abs(s - x) < 2);
  for (let i = 0; i < span; i++) {
    const x0 = i * pw;
    const x1 = x0 + pw;
    const left = nearSeam(x0) ? x0 + SEAM_CLEAR : x0 + m;
    const right = nearSeam(x1) ? x1 - SEAM_CLEAR : x1 - m;
    // The rail sits away from the seam: left on a pair's left panel, right otherwise.
    const side: -1 | 1 = nearSeam(x1) && !nearSeam(x0) ? -1 : 1;
    const low = slotSpec("low", left, right, childTop + 10, H - m, side, false);
    const high = showHigh
      ? slotSpec("high", left, right, highTop, childTop - 10, side, false)
      : null;
    stations.push({
      index: i,
      x0,
      x1,
      low,
      high,
      badge: { x: left, y: m, w: right - left, h: stripBottom - m },
    });
  }
  return {
    kind: input.kind,
    width: W,
    height: H,
    stations,
    top: { x: 0, y: 0, w: W, h: stripBottom },
    scene: showHigh ? null : { x: 0, y: highTop, w: W, h: childTop - 10 - highTop },
    // The top strip's left corner is clear of the order card's picture and progress ring.
    home: { x: m + 12, y: m + 12, w: RESET_SIZE, h: RESET_SIZE },
  };
};

/** Every slot of a layout: the child slots first, then the adult ones. */
export const slotsOf = (l: Layout): { station: number; spec: SlotSpec }[] => [
  ...l.stations.map((s) => ({ station: s.index, spec: s.low })),
  ...l.stations.flatMap((s) => (s.high ? [{ station: s.index, spec: s.high }] : [])),
];
