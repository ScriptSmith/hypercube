/**
 * Where everything goes on a frame, in venue px (y down). Pure.
 *
 * A stage is one dimension's demonstration: its 3D view (or two, on a bank's pair), and its
 * controls. Controls are stacked by reach: the slice lever lowest, for children, then the shape
 * buttons, then the turn dials and the orientation buttons, in adult reach; the view fills
 * the rest above.
 *
 * - Panel and kiosk: one stage. The kiosk's dials go up the left edge and its orientation
 *   buttons up the right, with the shapes and the lever along the bottom.
 * - Pair: one stage per half (a cube through a flat world beside a 4D shape), each with its
 *   controls at its outer edge, a fifth of the width clear of the seam. On a bank, one stage:
 *   its slice in the left half and the shadow in the right, the lever and shapes at the left
 *   edge and the dials and orientation buttons at the right.
 * - Wall: three lanes. Dials and orientation buttons in a row at the top of adult reach; the
 *   lever and shapes in the children's band below.
 * - Screen: views only, no controls.
 */
import { VENUE_SIZE } from "../../core/frame";
import type { FrameKind, Rect } from "../../core/types";
import type { Dim } from "./shapes";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export type ViewKind = "stage" | "slice";

export interface ViewSpec {
  kind: ViewKind;
  /** Where the view is drawn. */
  lane: Rect;
  /** Where the shape is framed, inside the lane and clear of the controls. */
  focus: Rect;
}

export interface DialSpec extends Circle {
  index: number;
  /** The world plane it turns in: carries axis plane[0] towards plane[1]. */
  plane: [number, number];
}

export interface OrientSpec {
  rect: Rect;
  /** The dimension of the face that goes first: 0 corner, 1 edge, 2 face, 3 cell. */
  k: number;
  label: string;
}

export interface ShapeSpec {
  rect: Rect;
  family: number;
}

export interface LeverSpec {
  /** Ends of the knob's travel. */
  x0: number;
  x1: number;
  y: number;
  /** Height of the touch area. */
  h: number;
}

export interface StageLayout {
  index: number;
  dim: Dim;
  views: ViewSpec[];
  lever: LeverSpec | null;
  dials: DialSpec[];
  orients: OrientSpec[];
  shapes: ShapeSpec[];
  reset: Circle | null;
  /** A slim upright gauge of the shape's extent along the hidden axis and the cut. */
  gauge: Rect | null;
  caption: { x: number; y: number; width: number; size: number };
  legend: { x: number; y: number; size: number };
  consoles: Rect[];
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  stages: StageLayout[];
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
  /** One entry per stage. */
  dims: readonly Dim[];
  /** A bank's touch frame: one stage showing its own slice. */
  bank: boolean;
}

export const MIN_TARGET = 120;
/** Pair controls keep this share of the width from the seam. */
export const SEAM_SHARE = 0.2;
export const SLOP = 24;

/** Dial planes by stage dimension (world axes: x 0, y 1, z 2, w 3). */
export const DIAL_PLANES: Record<Dim, [number, number][]> = {
  2: [[0, 1]],
  3: [
    [1, 2],
    [0, 1],
  ],
  4: [
    [0, 3],
    [1, 3],
    [2, 3],
  ],
};

const ORIENT_LABELS: Record<Dim, string[]> = {
  2: ["Corner first", "Edge first"],
  3: ["Corner first", "Edge first", "Face first"],
  4: ["Corner first", "Edge first", "Face first", "Cell first"],
};

/** Orientation buttons in the order shown: facet first, down to corner first. */
export const orientKs = (dim: Dim): number[] => Array.from({ length: dim }, (_, i) => dim - 1 - i);

export const orientLabel = (dim: Dim, k: number): string => ORIENT_LABELS[dim][k] ?? "";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});
const centred = (cx: number, cy: number, w: number, h: number): Rect =>
  rect(cx - w / 2, cy - h / 2, w, h);

const around = (rects: readonly Rect[], pad: number): Rect => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return rect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
};

const circleRect = (c: Circle): Rect => rect(c.x - c.r, c.y - c.r, 2 * c.r, 2 * c.r);
const leverRect = (l: LeverSpec): Rect =>
  rect(l.x0 - l.h / 2, l.y - l.h / 2, l.x1 - l.x0 + l.h, l.h);

/** Rects of every control of a stage, for consoles and tests. */
export const controlRects = (st: StageLayout): Rect[] => [
  ...(st.lever ? [leverRect(st.lever)] : []),
  ...st.dials.map(circleRect),
  ...st.orients.map((o) => o.rect),
  ...st.shapes.map((s) => s.rect),
  ...(st.reset ? [circleRect(st.reset)] : []),
];

const dialsRow = (dim: Dim, cx: number, y: number, r: number, gap: number): DialSpec[] => {
  const planes = DIAL_PLANES[dim];
  const step = 2 * r + gap;
  return planes.map((plane, i) => ({
    index: i,
    plane,
    x: cx + (i - (planes.length - 1) / 2) * step,
    y,
    r,
  }));
};

/** Orientation buttons in a grid of `cols` columns, filling rows from the top. */
const orientGrid = (
  dim: Dim,
  cx: number,
  bottomY: number,
  cols: number,
  w: number,
  h: number,
  gapX: number,
  gapY: number,
): OrientSpec[] => {
  const ks = orientKs(dim);
  const rows = Math.ceil(ks.length / cols);
  return ks.map((k, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, ks.length - row * cols);
    const x = cx + (col - (inRow - 1) / 2) * (w + gapX);
    const y = bottomY - (rows - 1 - row) * (h + gapY);
    return { rect: centred(x, y, w, h), k, label: orientLabel(dim, k) };
  });
};

const shapesRow = (x0: number, y: number, size: number, gap: number, h = size): ShapeSpec[] =>
  [0, 1, 2, 3].map((family) => ({
    family,
    rect: rect(x0 + family * (size + gap), y - h / 2, size, h),
  }));

const stageBase = (
  index: number,
  dim: Dim,
  views: ViewSpec[],
  parts: Partial<StageLayout>,
  pad: number,
): StageLayout => {
  const st: StageLayout = {
    index,
    dim,
    views,
    lever: null,
    dials: [],
    orients: [],
    shapes: [],
    reset: null,
    gauge: null,
    caption: { x: 0, y: 0, width: 0, size: 40 },
    legend: { x: 0, y: 0, size: 30 },
    consoles: [],
    ...parts,
  };
  if (st.consoles.length === 0) {
    const rs = controlRects(st);
    if (rs.length > 0) st.consoles = [around(rs, pad)];
  }
  return st;
};

const layoutPanel = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const s = Math.min(W / 1080, H / 1920);
  const dim = input.dims[0] ?? 4;
  const cx = W / 2;
  const leverY = H - 46 * s - 66 * s;
  const lever: LeverSpec = { x0: 110 * s, x1: W - 110 * s, y: leverY, h: 132 * s };
  const shapeY = leverY - 160 * s;
  const shapeSize = 172 * s;
  const shapeGap = 24 * s;
  const rowW = 4 * shapeSize + 3 * shapeGap + 40 * s + 124 * s;
  const sx0 = cx - rowW / 2;
  const shapes = shapesRow(sx0, shapeY, shapeSize, shapeGap, 132 * s);
  const reset = { x: sx0 + rowW - 62 * s, y: shapeY, r: 62 * s };
  const dr = 116 * s;
  const dialY = shapeY - 66 * s - 30 * s - dr;
  const dials = dialsRow(dim, cx, dialY, dr, dim === 4 ? 88 * s : 150 * s);
  const ob = dialY - dr - 30 * s - 60 * s;
  const orients =
    dim === 4
      ? orientGrid(dim, cx, ob, 2, 470 * s, 120 * s, 20 * s, 18 * s)
      : orientGrid(dim, cx, ob, 3, 316 * s, 120 * s, 16 * s, 18 * s);
  const consoleTop = Math.min(...orients.map((o) => o.rect.y)) - 22 * s;
  const gaugeW = 30 * s;
  const top = 128 * s;
  const focus = rect(
    40 * s,
    top,
    W - 80 * s - (gaugeW + 50 * s),
    Math.max(200, consoleTop - 60 * s - top),
  );
  const gauge = rect(
    W - 40 * s - gaugeW,
    top + 60 * s,
    gaugeW,
    Math.max(120, focus.height - 120 * s),
  );
  const view: ViewSpec = { kind: input.bank ? "slice" : "stage", lane: rect(0, 0, W, H), focus };
  return {
    kind: input.kind,
    width: W,
    height: H,
    stages: [
      stageBase(
        0,
        dim,
        [view],
        {
          lever,
          dials,
          orients,
          shapes,
          reset,
          gauge: dim === 4 || input.bank ? gauge : null,
          caption: { x: cx, y: 62 * s, width: W - 260 * s, size: 50 * s },
          legend: { x: 40 * s, y: 112 * s, size: 34 * s },
        },
        22 * s,
      ),
    ],
    home: { x: W - 150 * s, y: 26 * s, size: 120 },
  };
};

/** One half of a pair: the controls in the outer column [x0, x1], the view in the half. */
const pairColumn = (
  index: number,
  dim: Dim,
  half: Rect,
  x0: number,
  x1: number,
  outer: "left" | "right",
  H: number,
  s: number,
): StageLayout => {
  const cw = x1 - x0;
  const cx = (x0 + x1) / 2;
  const leverY = H - 46 * s - 66 * s;
  const rr = 62 * s;
  const lever: LeverSpec = { x0: x0 + 66 * s, x1: x1 - 66 * s, y: leverY, h: 132 * s };
  const size = Math.min(140 * s, (cw - 3 * 20 * s) / 4);
  const shapeY = leverY - 66 * s - 28 * s - 66 * s;
  const shapes = shapesRow(cx - (4 * size + 60 * s) / 2, shapeY, size, 20 * s, 132 * s);
  const dr = dim === 4 ? 92 * s : 100 * s;
  const dialY = shapeY - 66 * s - 28 * s - dr;
  const dials = dialsRow(dim, cx, dialY, dr, dim === 4 ? 22 * s : 60 * s);
  const bw = (cw - 20 * s) / 2;
  const orients = orientGrid(dim, cx, dialY - dr - 26 * s - 60 * s, 2, bw, 120 * s, 20 * s, 16 * s);
  const orientTop = Math.min(...orients.map((o) => o.rect.y));
  const reset = { x: outer === "left" ? x0 + rr : x1 - rr, y: orientTop - 26 * s - rr, r: rr };
  const consoleTop = reset.y - rr - 20 * s;
  const gaugeW = 28 * s;
  const top = 128 * s;
  const gx = outer === "left" ? half.x + 36 * s : half.x + half.width - 36 * s - gaugeW;
  const fx = outer === "left" ? half.x + 36 * s + gaugeW + 30 * s : half.x + 36 * s;
  const focus = rect(
    fx,
    top,
    half.width - 72 * s - gaugeW - 30 * s,
    Math.max(200, consoleTop - 60 * s - top),
  );
  return stageBase(
    index,
    dim,
    [{ kind: "stage", lane: half, focus }],
    {
      lever,
      dials,
      orients,
      shapes,
      reset,
      gauge:
        dim === 4 ? rect(gx, top + 60 * s, gaugeW, Math.max(120, focus.height - 120 * s)) : null,
      caption: { x: half.x + half.width / 2, y: 62 * s, width: half.width - 200 * s, size: 46 * s },
      legend: { x: outer === "left" ? x0 : half.x + 36 * s, y: 112 * s, size: 32 * s },
    },
    20 * s,
  );
};

const layoutPair = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const s = Math.min(W / 2160, H / 1920);
  const seam = input.seams[0] ?? W / 2;
  const keep = SEAM_SHARE * W;
  const margin = 36 * s;
  const left = rect(0, 0, seam, H);
  const right = rect(seam, 0, W - seam, H);
  if (!input.bank) {
    const d0 = input.dims[0] ?? 3;
    const d1 = input.dims[1] ?? 4;
    return {
      kind: input.kind,
      width: W,
      height: H,
      stages: [
        pairColumn(0, d0, left, margin, seam - keep, "left", H, s),
        pairColumn(1, d1, right, seam + keep, W - margin, "right", H, s),
      ],
      home: { x: W - 150 * s, y: 26 * s, size: 120 },
    };
  }
  // A bank's pair: its slice on the left, the shadow on the right.
  const dim = input.dims[0] ?? 4;
  const lx0 = margin;
  const lx1 = seam - keep;
  const rx0 = seam + keep;
  const rx1 = W - margin;
  const leverY = H - 46 * s - 66 * s;
  const rr = 62 * s;
  const lever: LeverSpec = { x0: lx0 + 66 * s, x1: lx1 - 66 * s, y: leverY, h: 132 * s };
  const size = Math.min(140 * s, (lx1 - lx0 - 60 * s) / 4);
  const shapeY = leverY - 66 * s - 28 * s - 66 * s;
  const reset = { x: lx0 + rr, y: shapeY - 66 * s - 30 * s - rr, r: rr };
  const lcx = (lx0 + lx1) / 2;
  const shapes = shapesRow(lcx - (4 * size + 60 * s) / 2, shapeY, size, 20 * s, 132 * s);
  const rcx = (rx0 + rx1) / 2;
  const dr = dim === 4 ? 92 * s : 100 * s;
  // The right half's rows sit between the left half's heights, so nothing mirrors the seam.
  const dialY = leverY - 80 * s;
  const dials = dialsRow(dim, rcx, dialY, dr, dim === 4 ? 22 * s : 60 * s);
  const bw = (rx1 - rx0 - 20 * s) / 2;
  const orients = orientGrid(
    dim,
    rcx,
    dialY - dr - 26 * s - 60 * s,
    2,
    bw,
    120 * s,
    20 * s,
    18 * s,
  );
  const leftConsole = around(
    [leverRect(lever), circleRect(reset), ...shapes.map((x) => x.rect)],
    20 * s,
  );
  const rightConsole = around([...dials.map(circleRect), ...orients.map((o) => o.rect)], 20 * s);
  const top = 128 * s;
  const gaugeW = 28 * s;
  const lf = rect(
    36 * s + gaugeW + 30 * s,
    top,
    seam - 72 * s - gaugeW - 30 * s,
    Math.max(200, leftConsole.y - 60 * s - top),
  );
  const rf = rect(
    seam + 36 * s,
    top,
    W - seam - 72 * s,
    Math.max(200, rightConsole.y - 60 * s - top),
  );
  return {
    kind: input.kind,
    width: W,
    height: H,
    stages: [
      stageBase(
        0,
        dim,
        [
          { kind: "slice", lane: left, focus: lf },
          { kind: "stage", lane: right, focus: rf },
        ],
        {
          lever,
          dials,
          orients,
          shapes,
          reset,
          gauge: rect(36 * s, top + 60 * s, gaugeW, Math.max(120, lf.height - 120 * s)),
          caption: { x: W / 2, y: 62 * s, width: W - 400 * s, size: 48 * s },
          legend: { x: lf.x, y: 112 * s, size: 32 * s },
          consoles: [leftConsole, rightConsole],
        },
        20 * s,
      ),
    ],
    home: { x: W - 150 * s, y: 26 * s, size: 120 },
  };
};

const layoutKiosk = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const s = Math.min(W / 1920, H / 1080);
  const dim = input.dims[0] ?? 4;
  const dr = 100 * s;
  const lx = 40 * s + dr;
  const planes = DIAL_PLANES[dim];
  const dials: DialSpec[] = planes.map((plane, i) => ({
    index: i,
    plane,
    x: lx,
    y: H - 40 * s - dr - i * (2 * dr + 22 * s),
    r: dr,
  }));
  const topDial = dials[dials.length - 1]!;
  const reset = { x: lx, y: topDial.y - dr - 34 * s - 62 * s, r: 62 * s };
  const bw = 320 * s;
  const bh = 120 * s;
  const rx = W - 40 * s - bw / 2;
  const orients: OrientSpec[] = orientKs(dim).map((k, i, all) => ({
    k,
    label: orientLabel(dim, k),
    rect: centred(rx, H - 24 * s - bh / 2 - (all.length - 1 - i) * (bh + 18 * s), bw, bh),
  }));
  const rowY = H - 40 * s - 62 * s;
  const size = 124 * s;
  const sx0 = lx + dr + 60 * s;
  const shapes = shapesRow(sx0, rowY, size, 18 * s);
  const leverX0 = sx0 + 4 * size + 3 * 18 * s + 120 * s;
  const leverX1 = rx - bw / 2 - 130 * s;
  const lever: LeverSpec = {
    x0: leverX0,
    x1: Math.max(leverX0 + 200, leverX1),
    y: rowY,
    h: 124 * s,
  };
  const left = around([...dials.map(circleRect), circleRect(reset)], 18 * s);
  const right = around(
    orients.map((o) => o.rect),
    18 * s,
  );
  const bottom = around([...shapes.map((x) => x.rect), leverRect(lever)], 18 * s);
  const gaugeW = 28 * s;
  const fx0 = left.x + left.width + 30 * s;
  const fx1 = right.x - 40 * s - gaugeW - 30 * s;
  const top = 100 * s;
  const focus = rect(fx0, top, fx1 - fx0, Math.max(200, bottom.y - 30 * s - top));
  return {
    kind: input.kind,
    width: W,
    height: H,
    stages: [
      stageBase(
        0,
        dim,
        [{ kind: input.bank ? "slice" : "stage", lane: rect(0, 0, W, H), focus }],
        {
          lever,
          dials,
          orients,
          shapes,
          reset,
          gauge: dim === 4 ? rect(fx1 + 30 * s, top + 40 * s, gaugeW, focus.height - 80 * s) : null,
          caption: { x: (fx0 + fx1) / 2, y: 50 * s, width: fx1 - fx0, size: 44 * s },
          legend: { x: fx0, y: 50 * s, size: 30 * s },
          consoles: [left, right, bottom],
        },
        18 * s,
      ),
    ],
    home: { x: W / 2 - 60, y: 24 * s, size: 120 },
  };
};

/** One stage's share of the default wall, which the wall's sizes are drawn for. */
const WALL_STAGE = { width: VENUE_SIZE.wall.width / 3, height: VENUE_SIZE.wall.height };

/** A screen's size against the default screen's, which the screen's sizes are drawn for. */
export const screenScale = (W: number, H: number): number =>
  Math.min(W / VENUE_SIZE.screen.width, H / VENUE_SIZE.screen.height);

const layoutWall = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const n = Math.max(1, input.dims.length);
  const L = W / n;
  const s = clamp(Math.min(L / WALL_STAGE.width, H / WALL_STAGE.height), 0.5, 2);
  const child = clamp(input.reachTop.child, 0, H);
  const adult = clamp(input.reachTop.adult, 0, child);
  // Keep controls off the floor: the lowest 8 % of the wall is below a child's knees.
  const floor = H * 0.92;
  const dr = clamp((child - adult - 60) / 2, MIN_TARGET / 2 + 10, 111 * s);
  const yAdult = adult + 27 * s + dr;
  const yChild = clamp((child + floor) / 2, child + 67 * s, floor - 67 * s);
  const stages: StageLayout[] = [];
  for (let i = 0; i < n; i++) {
    const dim = input.dims[i] ?? 4;
    const x0 = i * L;
    // Adult row: dials then orientation buttons, from the left, leaving the right end free.
    const dialGap = 36 * s;
    const bw = 210 * s;
    const bh = Math.max(MIN_TARGET, Math.min(116 * s, child - adult - 60));
    const nd = DIAL_PLANES[dim].length;
    const nk = dim;
    const groupW = nd * 2 * dr + (nd - 1) * dialGap + 62 * s + nk * bw + (nk - 1) * 18 * s;
    const gx0 = x0 + Math.max(53 * s, (L - 178 * s - groupW) / 2);
    const dcx = gx0 + (nd * 2 * dr + (nd - 1) * dialGap) / 2;
    const dials = dialsRow(dim, dcx, yAdult, dr, dialGap);
    const ox0 = gx0 + nd * 2 * dr + (nd - 1) * dialGap + 62 * s;
    const orients: OrientSpec[] = orientKs(dim).map((k, j) => ({
      k,
      label: orientLabel(dim, k),
      rect: centred(ox0 + j * (bw + 18 * s) + bw / 2, yAdult, bw, bh),
    }));
    // Children's row: the lever, the shapes and reset.
    const lever: LeverSpec = { x0: x0 + 107 * s, x1: x0 + 1075 * s, y: yChild, h: 124 * s };
    const size = 124 * s;
    const shapes = shapesRow(x0 + 1182 * s, yChild, size, 18 * s);
    const reset = { x: x0 + 1182 * s + 4 * size + 53 * s + 80 * s, y: yChild, r: 62 * s };
    const adultConsole = around([...dials.map(circleRect), ...orients.map((o) => o.rect)], 21 * s);
    const childConsole = around(
      [leverRect(lever), ...shapes.map((x) => x.rect), circleRect(reset)],
      21 * s,
    );
    const top = 133 * s;
    const gaugeW = 30 * s;
    const focus = rect(
      x0 + 62 * s,
      top,
      L - 124 * s - gaugeW - 36 * s,
      Math.max(300, adultConsole.y - 44 * s - top),
    );
    stages.push(
      stageBase(
        i,
        dim,
        [{ kind: "stage", lane: rect(x0, 0, L, H), focus }],
        {
          lever,
          dials,
          orients,
          shapes,
          reset,
          gauge:
            dim === 4
              ? rect(
                  x0 + L - 62 * s - gaugeW,
                  top + 71 * s,
                  gaugeW,
                  Math.max(200, focus.height - 142 * s),
                )
              : null,
          caption: { x: x0 + L / 2, y: 71 * s, width: L - 213 * s, size: 64 * s },
          legend: { x: x0 + 62 * s, y: 133 * s, size: 41 * s },
          consoles: [adultConsole, childConsole],
        },
        21 * s,
      ),
    );
  }
  return {
    kind: input.kind,
    width: W,
    height: H,
    stages,
    home: { x: W - 160 * s, y: adult + 27 * s, size: 160 },
  };
};

/**
 * A screen on its own, views only: a square and a cube side by side above, and the 4D shape
 * across the whole width below; or, without a 4D stage, side by side.
 */
const layoutScreen = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input;
  const s = screenScale(W, H);
  const ladder = input.dims.length === 3;
  const lanes: Rect[] = ladder
    ? [rect(0, 0, W / 2, H * 0.42), rect(W / 2, 0, W / 2, H * 0.42), rect(0, H * 0.42, W, H * 0.58)]
    : input.dims.map((_, i, all) => rect((i * W) / all.length, 0, W / all.length, H));
  const stages = input.dims.map((dim, i) => {
    const lane = lanes[i] ?? rect(0, 0, W, H);
    const top = 260 * s;
    const focus = rect(
      lane.x + 80 * s,
      lane.y + top,
      lane.width - 160 * s,
      lane.height - top - 150 * s,
    );
    return stageBase(
      i,
      dim,
      [{ kind: "stage", lane, focus }],
      {
        caption: {
          x: lane.x + lane.width / 2,
          y: lane.y + 130 * s,
          width: lane.width - 160 * s,
          size: 92 * s,
        },
        legend: { x: lane.x + 80 * s, y: lane.y + lane.height - 120 * s, size: 56 * s },
      },
      0,
    );
  });
  return { kind: input.kind, width: W, height: H, stages, home: { x: W - 200, y: 40, size: 160 } };
};

export const layoutFor = (input: LayoutInput): Layout => {
  switch (input.kind) {
    case "wall":
      return layoutWall(input);
    case "kiosk":
      return layoutKiosk(input);
    case "pair":
      return layoutPair(input);
    case "screen":
      return layoutScreen(input);
    default:
      return layoutPanel(input);
  }
};

// ---- Hit testing ----------------------------------------------------------------------------

export type Hit =
  | { stage: number; kind: "lever" }
  | { stage: number; kind: "dial"; index: number }
  | { stage: number; kind: "orient"; k: number }
  | { stage: number; kind: "shape"; family: number }
  | { stage: number; kind: "view"; view: number };

const inRect = (r: Rect, x: number, y: number, slop = 0) =>
  x >= r.x - slop && x <= r.x + r.width + slop && y >= r.y - slop && y <= r.y + r.height + slop;

/** The control under a point (allowing `slop` around each), else the view, else null. */
export const hitAt = (layout: Layout, x: number, y: number, slop = SLOP): Hit | null => {
  let best: Hit | null = null;
  let bestD = Infinity;
  const consider = (h: Hit, d: number) => {
    if (d <= slop && d < bestD) {
      bestD = d;
      best = h;
    }
  };
  const rectDist = (r: Rect) =>
    Math.max(r.x - x, 0, x - (r.x + r.width)) + Math.max(r.y - y, 0, y - (r.y + r.height));
  for (const st of layout.stages) {
    if (st.lever) consider({ stage: st.index, kind: "lever" }, rectDist(leverRect(st.lever)));
    for (const d of st.dials) {
      consider(
        { stage: st.index, kind: "dial", index: d.index },
        Math.max(0, Math.hypot(x - d.x, y - d.y) - d.r),
      );
    }
    for (const o of st.orients)
      consider({ stage: st.index, kind: "orient", k: o.k }, rectDist(o.rect));
    for (const sh of st.shapes) {
      consider({ stage: st.index, kind: "shape", family: sh.family }, rectDist(sh.rect));
    }
  }
  if (best) return best;
  // The reset button is the UI kit's and swallows its own presses; keep the view off it.
  for (const st of layout.stages) {
    if (st.reset && Math.hypot(x - st.reset.x, y - st.reset.y) <= st.reset.r + slop) return null;
    if (st.consoles.some((c) => inRect(c, x, y))) return null;
  }
  for (const st of layout.stages) {
    for (let v = 0; v < st.views.length; v++) {
      if (inRect(st.views[v]!.lane, x, y)) return { stage: st.index, kind: "view", view: v };
    }
  }
  return null;
};

/** The lever position (-1 to 1) for a finger at venue x. */
export const leverAt = (l: LeverSpec, x: number): number =>
  clamp(((x - l.x0) / Math.max(1, l.x1 - l.x0)) * 2 - 1, -1, 1);

/** The venue x of the lever's knob at position t. */
export const leverX = (l: LeverSpec, t: number): number =>
  l.x0 + ((clamp(t, -1, 1) + 1) / 2) * (l.x1 - l.x0);
