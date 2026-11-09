/**
 * Where everything goes on a touch frame, in venue px. Boards need no touch, so they sit in the
 * middle; pads (or a pair's levers) go in the children's band, low and at the outer edges, never
 * either side of a seam; each board's small level control is in adult reach; the frame's own
 * marble run and jar take the top, which on a wall nobody can reach.
 *
 * Pure: the screen above a bank runs it too, with each frame's nominal size, to know where that
 * frame's tubes rise.
 */
import type { FrameKind, Rect } from "../../core/types";
import { displayFor, reachFor } from "../../core/venue";
import { collectorStage, fitScale } from "./boardcam";
import type { Orient } from "./maze";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** A straight lever: the knob slides from (x0, y0) to (x1, y1); `axis` is what it tips. */
export interface Lever {
  axis: "x" | "y";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  knob: number;
  /** Where a touch takes the lever. */
  hit: Rect;
}

export interface BoardSlot {
  /** Scissor rectangle for the board's view, and the part the board must fill. */
  lane: Rect;
  focus: Rect;
  orient: Orient;
  /** The collector's place along the board's far rim, as a share of its width. */
  along: number;
  pad: Circle | null;
  levers: { h: Lever; v: Lever } | null;
  minus: Circle;
  plus: Circle;
  label: { x: number; y: number; size: number };
  /** Where the tube rises from the collector. */
  tube: { x: number; y: number };
}

export interface RunArea {
  /** Rails go between x0 and x1, from below `top` down to no lower than `railBottom`. */
  x0: number;
  x1: number;
  top: number;
  railBottom: number;
  /** The jar hangs under the last rail, centred on `cx`, at most `maxW` wide, above `floor`. */
  jar: { cx: number; floor: number; maxW: number };
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  boards: BoardSlot[];
  run: RunArea;
  home: { x: number; y: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: number[];
  /** Boards on a wall. */
  boards: number;
  /** One board tipped by two levers, on a pair. */
  together: boolean;
}

export const PAD_R = { panel: 190, wall: 270 } as const;
export const BUTTON_R = 66;
export const LEVER = { length: 520, knob: 86, hit: 230 } as const;
const M = 40;

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

/** The board shape that comes out bigger in `focus`. */
const bestOrient = (focus: Rect): Orient =>
  fitScale(focus, "landscape") > fitScale(focus, "portrait") ? "landscape" : "portrait";

const slot = (
  o: Omit<BoardSlot, "orient" | "tube" | "along"> & { orient?: Orient; along?: number },
): BoardSlot => {
  const orient = o.orient ?? bestOrient(o.focus);
  const along = o.along ?? 0;
  return { ...o, orient, along, tube: collectorStage(o.lane, o.focus, orient, along) };
};

/** A level control: minus, the number, plus, centred on (cx, cy). */
const levelControl = (cx: number, cy: number) => ({
  minus: { x: cx - 110, y: cy, r: BUTTON_R },
  plus: { x: cx + 110, y: cy, r: BUTTON_R },
  label: { x: cx, y: cy, size: 58 },
});

const panelLayout = (i: LayoutInput): Layout => {
  const W = i.width;
  const H = i.height;
  const runBottom = Math.round(H * 0.25);
  const pad = { x: W / 2, y: H - M - PAD_R.panel, r: PAD_R.panel };
  const focusTop = runBottom + 150;
  const focus = rect(50, focusTop, W - 100, pad.y - pad.r - 40 - focusTop);
  const lane = rect(0, runBottom + 20, W, pad.y - pad.r - 20 - (runBottom + 20));
  return {
    kind: i.kind,
    width: W,
    height: H,
    boards: [slot({ lane, focus, pad, levers: null, ...levelControl(220, runBottom + 84) })],
    run: {
      x0: M,
      x1: W - M,
      top: 30,
      railBottom: 250,
      jar: { cx: W - 190, floor: runBottom + 140, maxW: 300 },
    },
    home: { x: W - 200, y: focusTop + 20 },
  };
};

const pairSideLayout = (i: LayoutInput): Layout => {
  const W = i.width;
  const H = i.height;
  const seam = i.seams[0] ?? W / 2;
  const runBottom = Math.round(H * 0.25);
  const padY = H - M - PAD_R.panel;
  const focusTop = runBottom + 150;
  const focusBottom = padY - PAD_R.panel - 40;
  const gap = 90;
  const boards = [0, 1].map((b) => {
    const left = b === 0;
    const x0 = left ? 0 : seam;
    const x1 = left ? seam : W;
    const focus = left
      ? rect(50, focusTop, seam - gap - 50, focusBottom - focusTop)
      : rect(seam + gap, focusTop, W - 50 - seam - gap, focusBottom - focusTop);
    const lane = rect(x0, runBottom + 20, x1 - x0, padY - PAD_R.panel - 20 - (runBottom + 20));
    const pad = { x: left ? M + PAD_R.panel : W - M - PAD_R.panel, y: padY, r: PAD_R.panel };
    return slot({
      lane,
      focus,
      pad,
      levers: null,
      ...levelControl(left ? 220 : W - 220, runBottom + 84),
    });
  });
  return {
    kind: i.kind,
    width: W,
    height: H,
    boards,
    run: {
      x0: M,
      x1: W - M,
      top: 30,
      railBottom: 250,
      jar: { cx: seam, floor: runBottom + 140, maxW: 320 },
    },
    home: { x: W - 470, y: runBottom + 20 },
  };
};

const pairTogetherLayout = (i: LayoutInput): Layout => {
  const W = i.width;
  const H = i.height;
  const seam = i.seams[0] ?? W / 2;
  const runBottom = Math.round(H * 0.22);
  const leverY = H - M - LEVER.hit / 2;
  const h: Lever = {
    axis: "x",
    x0: M + LEVER.knob,
    y0: leverY,
    x1: M + LEVER.knob + LEVER.length,
    y1: leverY,
    knob: LEVER.knob,
    hit: rect(M, leverY - LEVER.hit / 2, LEVER.length + 2 * LEVER.knob, LEVER.hit),
  };
  const vx = W - M - LEVER.hit / 2;
  const vBottom = H - M - LEVER.knob;
  const v: Lever = {
    axis: "y",
    x0: vx,
    y0: vBottom - LEVER.length,
    x1: vx,
    y1: vBottom,
    knob: LEVER.knob,
    hit: rect(
      vx - LEVER.hit / 2,
      vBottom - LEVER.length - LEVER.knob,
      LEVER.hit,
      LEVER.length + 2 * LEVER.knob,
    ),
  };
  const focusTop = runBottom + 130;
  const focusRight = v.hit.x - 40;
  const focus = rect(200, focusTop, focusRight - 200, h.hit.y - 30 - focusTop);
  const lane = rect(0, runBottom + 20, v.hit.x - 10, h.hit.y - 10 - (runBottom + 20));
  // The tube rises to the left of the seam, not on it.
  const along = -0.27;
  const board = slot({
    lane,
    focus,
    pad: null,
    levers: { h, v },
    along,
    ...levelControl(220, runBottom + 84),
  });
  return {
    kind: i.kind,
    width: W,
    height: H,
    boards: [board],
    run: {
      x0: M,
      x1: W - M,
      top: 30,
      railBottom: 220,
      jar: { cx: seam + 320, floor: runBottom + 120, maxW: 320 },
    },
    home: { x: W - 210, y: runBottom + 20 },
  };
};

const kioskLayout = (i: LayoutInput): Layout => {
  const W = i.width;
  const H = i.height;
  const pad = { x: W - M - PAD_R.panel, y: H - M - PAD_R.panel, r: PAD_R.panel };
  const runBottom = 220;
  const focus = rect(420, runBottom + 40, pad.x - pad.r - 60 - 420, H - 30 - (runBottom + 40));
  const lane = rect(400, runBottom - 30, pad.x - pad.r - 20 - 400, H - (runBottom - 30));
  return {
    kind: i.kind,
    width: W,
    height: H,
    boards: [slot({ lane, focus, pad, levers: null, ...levelControl(pad.x, pad.y - pad.r - 130) })],
    run: {
      x0: M,
      x1: focus.x + focus.width / 2 + 160,
      top: 26,
      railBottom: runBottom - 40,
      jar: { cx: 200, floor: H - M, maxW: 300 },
    },
    home: { x: W - 200, y: 30 },
  };
};

const wallLayout = (i: LayoutInput): Layout => {
  const W = i.width;
  const H = i.height;
  const n = Math.min(4, Math.max(2, Math.round(i.boards)));
  const L = W / n;
  const r = n === 4 ? PAD_R.wall - 20 : PAD_R.wall;
  const runBottom = Math.round(H * 0.44);
  const boards = Array.from({ length: n }, (_, b) => {
    const x = b * L;
    const pad = { x: x + L - 60 - r, y: H - 50 - r, r };
    const focus = rect(
      x + 80,
      runBottom + 110,
      pad.x - r - 80 - (x + 80),
      H - 40 - (runBottom + 110),
    );
    const lane = rect(x, runBottom + 20, pad.x - r - 30 - x, H - (runBottom + 20));
    // Level control above the pad, in adult reach but clear of the children's band.
    const ctrlY = Math.min(i.reachTop.child - BUTTON_R - 20, pad.y - r - 150);
    return slot({
      lane,
      focus,
      pad,
      levers: null,
      ...levelControl(pad.x, Math.max(i.reachTop.adult + 140, ctrlY)),
    });
  });
  return {
    kind: i.kind,
    width: W,
    height: H,
    boards,
    run: {
      x0: 60,
      x1: W - 60,
      top: 40,
      railBottom: runBottom - 250,
      jar: { cx: W / 2, floor: runBottom + 40, maxW: 700 },
    },
    home: { x: W - 220, y: i.reachTop.adult + 10 },
  };
};

export const layoutFor = (i: LayoutInput): Layout => {
  switch (i.kind) {
    case "pair":
      return i.together ? pairTogetherLayout(i) : pairSideLayout(i);
    case "kiosk":
      return kioskLayout(i);
    case "wall":
      return wallLayout(i);
    default:
      return panelLayout(i);
  }
};

/** The same slot with its board in another shape (a resize must not change a board's shape). */
export const withOrient = (s: BoardSlot, orient: Orient): BoardSlot =>
  s.orient === orient
    ? s
    : { ...s, orient, tube: collectorStage(s.lane, s.focus, orient, s.along) };

/** A frame's layout at its kind's venue size and default reach, as a screen above it sees it. */
export const nominalLayout = (
  kind: FrameKind,
  opts: { span?: number; boards?: number; together?: boolean } = {},
): Layout => {
  const d = displayFor(kind, opts.span ?? (kind === "pair" ? 2 : 1));
  const reach = reachFor(d);
  const span = kind === "pair" ? Math.max(2, opts.span ?? 2) : 1;
  return layoutFor({
    kind,
    width: d.width,
    height: d.height,
    reachTop: { adult: d.height * (1 - reach.adult), child: d.height * (1 - reach.child) },
    seams: Array.from({ length: span - 1 }, (_, k) => ((k + 1) * d.width) / span),
    boards: opts.boards ?? 3,
    together: opts.together ?? false,
  });
};
