/**
 * Where everything goes on a frame, in venue px (y down). Pure.
 *
 * Each arm has a lane: the part of the frame its 3D view draws into, and a focus rectangle
 * inside it that the bench and the arm's reach are framed to, clear of the controls. Dials are
 * stacked the way the arm is built: the base turn lowest, the wrist highest, so the lowest dial
 * moves the lowest joint. The base dial and the grip button are always the lowest controls,
 * for children.
 *
 * - Panel: the view on top, then three rows: wrist (J4 J5 J6), arm (J2 J3, reset), base and grip.
 * - Pair: one arm shared by two people. The left half has the base, shoulder, elbow and grip;
 *   the right half the forearm roll, wrist bend and twist. Both groups keep a fifth of the
 *   width from the seam, and the right half's rows sit between the left's heights.
 * - Kiosk: the view in the middle; base, shoulder and elbow up the left edge, grip, twist, bend
 *   and roll up the right.
 * - Wall: one lane per arm. In each, the five upper dials in a row at the top of adult reach
 *   and the base dial and grip in the children's band below.
 */
import type { FrameKind, Rect } from "../../core/types";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface DialSpec extends Circle {
  joint: number;
}

export interface CellLayout {
  index: number;
  /** Where this arm's view is drawn. */
  lane: Rect;
  /** Where the bench and the arm's reach are framed, inside the lane. */
  focus: Rect;
  /** By joint index. */
  dials: DialSpec[];
  grip: Circle;
  reset: Circle;
  /** Dark panels behind the controls. */
  consoles: Rect[];
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  cells: CellLayout[];
  /** Top-left of a free square for the runtime's Home control, venue px. */
  home: { x: number; y: number; size: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  /** Venue y of the top of adult and child reach. */
  reachTop: { adult: number; child: number };
  seams: readonly number[];
  arms: number;
}

/** Smallest control, and the smallest dial on panels and pairs. */
export const MIN_TARGET = 120;
export const MIN_DIAL = 180;
/** Pair controls keep this share of the width from the seam. */
export const SEAM_SHARE = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const dial = (joint: number, x: number, y: number, r: number): DialSpec => ({ joint, x, y, r });

/** The bounding box of circles, padded. */
const around = (circles: readonly Circle[], pad: number): Rect => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of circles) {
    x0 = Math.min(x0, c.x - c.r);
    y0 = Math.min(y0, c.y - c.r);
    x1 = Math.max(x1, c.x + c.r);
    y1 = Math.max(y1, c.y + c.r);
  }
  return rect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
};

const sortDials = (d: DialSpec[]) => d.sort((a, b) => a.joint - b.joint);

const layoutPanel = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const s = Math.min(W / 1080, H / 1920);
  const bottom = 60 * s;
  const gr = 130 * s;
  const br = 120 * s;
  const ar = 115 * s;
  const wr = 110 * s;
  const yBase = H - bottom - gr;
  const yArm = yBase - gr - 40 * s - ar;
  const yWrist = yArm - ar - 36 * s - wr;
  const cx = W / 2;
  const dials = sortDials([
    dial(0, cx - 270 * s, yBase, br),
    dial(1, cx - 320 * s, yArm, ar),
    dial(2, cx - 40 * s, yArm, ar),
    dial(3, cx - 340 * s, yWrist, wr),
    dial(4, cx, yWrist, wr),
    dial(5, cx + 340 * s, yWrist, wr),
  ]);
  const grip = { x: cx + 270 * s, y: yBase, r: gr };
  const reset = { x: cx + 320 * s, y: yArm, r: 72 * s };
  const all = [...dials, grip, reset];
  const consoleRect = around(all, 22 * s);
  const focusBottom = consoleRect.y - 24 * s;
  return {
    kind: input.kind,
    width: W,
    height: H,
    cells: [
      {
        index: 0,
        lane: rect(0, 0, W, H),
        focus: rect(30 * s, 40 * s, W - 60 * s, Math.max(200, focusBottom - 40 * s)),
        dials,
        grip,
        reset,
        consoles: [consoleRect],
      },
    ],
    home: { x: W - 150 * s, y: 30 * s, size: 120 },
  };
};

const layoutPair = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const seam = input.seams[0] ?? W / 2;
  const s = Math.min(W / 2160, H / 1920);
  const keep = SEAM_SHARE * W;
  const leftMax = seam - keep;
  const rightMin = seam + keep;
  const bottom = 60 * s;
  const gr = 135 * s;
  const r = 122 * s;
  // Left half: base and grip lowest, shoulder and elbow above.
  const yBase = H - bottom - gr;
  const yArm = yBase - gr - 46 * s - r;
  const lx1 = Math.min(leftMax - gr - 20 * s, 480 * s);
  const lx0 = Math.max(r + 50 * s, lx1 - 300 * s);
  // Right half: rows halfway between the left half's heights, so nothing mirrors the seam.
  const yRoll = yArm - 150 * s;
  const yTwist = yBase - 150 * s;
  const rx0 = Math.max(rightMin + r + 20 * s, W - 480 * s);
  const rx1 = Math.min(W - r - 50 * s, rx0 + 300 * s);
  const dials = sortDials([
    dial(0, lx0, yBase, r),
    dial(1, lx0, yArm, r),
    dial(2, lx1, yArm, r),
    dial(3, rx0, yRoll, r),
    dial(4, rx1, yRoll, r),
    dial(5, rx0, yTwist, r),
  ]);
  const grip = { x: lx1, y: yBase, r: gr };
  const reset = { x: rx1, y: yTwist, r: 72 * s };
  const left = around([dials[0]!, dials[1]!, dials[2]!, grip], 22 * s);
  const right = around([dials[3]!, dials[4]!, dials[5]!, reset], 22 * s);
  // The bench narrows towards its front edge, so its lower part fits between the two consoles.
  const top = Math.min(left.y, right.y) + 220 * s;
  return {
    kind: input.kind,
    width: W,
    height: H,
    cells: [
      {
        index: 0,
        lane: rect(0, 0, W, H),
        focus: rect(60 * s, 40 * s, W - 120 * s, Math.max(200, top - 70 * s)),
        dials,
        grip,
        reset,
        consoles: [left, right],
      },
    ],
    home: { x: W - 150 * s, y: 30 * s, size: 120 },
  };
};

const layoutKiosk = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const s = Math.min(W / 1920, H / 1080);
  const r = 112 * s;
  const gr = 124 * s;
  const lx = 40 * s + r;
  const rx = W - 40 * s - r;
  const bottom = H - 40 * s;
  const step = 2 * r + 22 * s;
  const dials = sortDials([
    dial(0, lx, bottom - r, r),
    dial(1, lx, bottom - r - step, r),
    dial(2, lx, bottom - r - 2 * step, r),
    dial(5, rx, bottom - 2 * gr - 22 * s - r, r),
    dial(4, rx, bottom - 2 * gr - 22 * s - r - step, r),
    dial(3, rx, bottom - 2 * gr - 22 * s - r - 2 * step, r),
  ]);
  const grip = { x: rx - (gr - r), y: bottom - gr, r: gr };
  const resetR = 66 * s;
  const reset = {
    x: lx,
    y: Math.max(resetR + 24 * s, dials[2]!.y - r - 26 * s - resetR),
    r: resetR,
  };
  const left = around([dials[0]!, dials[1]!, dials[2]!, reset], 18 * s);
  const right = around([dials[3]!, dials[4]!, dials[5]!, grip], 18 * s);
  const fx0 = left.x + left.width + 30 * s;
  const fx1 = right.x - 30 * s;
  return {
    kind: input.kind,
    width: W,
    height: H,
    cells: [
      {
        index: 0,
        lane: rect(0, 0, W, H),
        focus: rect(fx0, 30 * s, fx1 - fx0, H - 60 * s),
        dials,
        grip,
        reset,
        consoles: [left, right],
      },
    ],
    home: { x: W / 2 - 60, y: 24 * s, size: 120 },
  };
};

const layoutWall = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const n = clamp(Math.round(input.arms), 1, 3);
  const child = clamp(input.reachTop.child, 0, H);
  const adult = clamp(input.reachTop.adult, 0, child);
  // Keep controls off the floor: the lowest 8 % of the wall is below a child's knees.
  const floor = H - H * 0.08;
  const L = W / n;
  const gr = 165;
  const br = 150;
  // Narrow cells (three arms on a smaller wall) shrink the adult dials a little and pull them
  // in, keeping them apart and the last cell's clear of the Home control.
  const ar = clamp((child - adult - 40) / 2, 120, Math.min(140, 0.07 * L));
  const yAdult = adult + 20 + ar;
  const yChild = Math.max(child + gr + 10, Math.min(floor - gr, yAdult + ar + 70 + gr));
  const gapA = Math.min(330, (L - 2 * ar - 160) / 4, (L / 2 - 200 - ar) / 2);
  const cells: CellLayout[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * L;
    const cx = x0 + L / 2;
    const dials = sortDials([
      dial(0, cx - 300, yChild, br),
      ...[1, 2, 3, 4, 5].map((j, k) => dial(j, cx + (k - 2) * gapA, yAdult, ar)),
    ]);
    const grip = { x: cx + 300, y: yChild, r: gr };
    const reset = { x: Math.min(x0 + L - 110, cx + 720), y: yChild + 30, r: 85 };
    const consoleRect = around([...dials, grip, reset], 26);
    cells.push({
      index: i,
      lane: rect(x0, 0, L, H),
      focus: rect(x0 + 50, 50, L - 100, Math.max(300, consoleRect.y - 80)),
      dials,
      grip,
      reset,
      consoles: [consoleRect],
    });
  }
  return {
    kind: input.kind,
    width: W,
    height: H,
    cells,
    home: { x: W - 190, y: adult + 30, size: 160 },
  };
};

export const layoutFor = (input: LayoutInput): Layout => {
  switch (input.kind) {
    case "wall":
      return layoutWall(input);
    case "kiosk":
      return layoutKiosk(input);
    case "pair":
      return layoutPair(input);
    default:
      return layoutPanel(input);
  }
};

export const SLOP = 30;

/** The control under a point, allowing `slop` venue px around each. */
export const controlAt = (
  layout: Layout,
  x: number,
  y: number,
  slop = SLOP,
): { cell: number; kind: "dial"; joint: number } | { cell: number; kind: "grip" } | null => {
  let best: { cell: number; kind: "dial"; joint: number } | { cell: number; kind: "grip" } | null =
    null;
  let bestD = Infinity;
  for (const c of layout.cells) {
    for (const d of c.dials) {
      const dist = Math.hypot(x - d.x, y - d.y) - d.r;
      if (dist <= slop && dist < bestD) {
        bestD = dist;
        best = { cell: c.index, kind: "dial", joint: d.joint };
      }
    }
    const g = c.grip;
    const dist = Math.hypot(x - g.x, y - g.y) - g.r;
    if (dist <= slop && dist < bestD) {
      bestD = dist;
      best = { cell: c.index, kind: "grip" };
    }
  }
  return best;
};
