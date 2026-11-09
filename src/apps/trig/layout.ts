/**
 * Where everything goes, in venue px (y down). Pure.
 *
 * Every frame has the same picture: the unit circle at the left and the graphs to its right,
 * their horizontal axis the circle's, their upright axis the line x = 1 touching the circle
 * at (1, 0). So a height on the circle carries straight across to the curves, the tan length
 * on that line is already on the graph's axis, and the arc from (1, 0) unrolls onto the
 * graph's axis. One radius is one unit up the graph; along it one radian is `s` px, the radius
 * itself where there is room (wall, kiosk, screen), less on panels and pairs.
 *
 * Designs are for each kind's venue size, centred across the actual frame and kept to its
 * bottom, where reach is measured from.
 */
import { VENUE_SIZE } from "../../core/frame";
import type { FrameKind, Rect } from "../../core/types";
import { type Fn, TAU } from "./config";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Pic {
  cx: number;
  cy: number;
  /** One unit. */
  r: number;
  /** The graph's origin: (1, 0) on the circle, on the line x = 1. */
  x0: number;
  /** Px per radian along the graph. */
  s: number;
  /** The graph's end, at a full turn. */
  x1: number;
  /** The picture's extent; tan is clipped to `top` and `bottom`. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Base line width, label and axis text sizes. */
  line: number;
  label: number;
  axis: number;
}

export interface TextBox extends Rect {
  size: number;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  bank: boolean;
  touch: boolean;
  pic: Pic;
  /**
   * The circle drawn larger, for the walk-through's steps before the waves, or null. The frame
   * slides between it and `pic`; touches follow whichever is drawn.
   */
  zoom: Pic | null;
  /** For the arc step: where the unrolled arc has room to lie along the axis. */
  zoomArc: Pic | null;
  /** Where a finger scrubs the graph. */
  graph: Rect;
  wheel: Circle | null;
  toggles: { fn: Fn; rect: Rect }[];
  /** `explore`: "Show me", where Back and Next are while the steps show. */
  walk: Rect | null;
  /** Back and Next, and the row of step dots, shown while the steps are. */
  back: Rect | null;
  next: Rect | null;
  dots: { x: number; y: number; gap: number; r: number } | null;
  caption: TextBox & { lines: number };
  readout: TextBox;
  /** Where the readout goes, larger, while the circle is zoomed, if the zoom leaves room. */
  readoutZoom: TextBox | null;
  /** Screens: the row of beads, one above each touch frame. */
  beads: { y: number; amp: number; r: number } | null;
  /** Bank frames: a strip in the frame's colour along the top edge, under its bead. */
  strip: Rect | null;
  home: { x: number; y: number };
}

export interface LayoutInput {
  kind: FrameKind;
  /** Venue px. */
  width: number;
  height: number;
  bank: boolean;
  steps: boolean;
}

export const MIN_TARGET = 120;
/** Pair controls keep this share of the width from the seam. */
export const SEAM_SHARE = 0.2;

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const pic = (
  cx: number,
  cy: number,
  r: number,
  graphEnd: number,
  box: { left: number; right: number; top: number; bottom: number },
  text: { line: number; label: number; axis: number },
): Pic => {
  const x0 = cx + r;
  const s = Math.min(r, (graphEnd - x0) / TAU);
  return { cx, cy, r, x0, s, x1: x0 + TAU * s, ...box, ...text };
};

/** A larger circle for the steps before the waves: lines and names grow a little with it. */
const zoomed = (
  cx: number,
  cy: number,
  r: number,
  box: { left: number; right: number; top: number; bottom: number },
  line: number,
  label: number,
  axis: number,
): Pic => ({
  cx,
  cy,
  r,
  x0: cx + r,
  s: r,
  x1: cx + r + TAU * r,
  ...box,
  line: line * 1.35,
  label: label * 1.2,
  axis: axis * 1.1,
});

interface Design {
  pic: Pic;
  zoom: Pic;
  zoomArc?: Pic;
  wheel: Circle | null;
  toggles: Rect[];
  walk: Rect | null;
  back: Rect | null;
  next: Rect | null;
  dots: { x: number; y: number; gap: number; r: number } | null;
  caption: TextBox & { lines: number };
  readout: TextBox;
  readoutZoom?: TextBox;
  beads: { y: number; amp: number; r: number } | null;
  home: { x: number; y: number };
}

/** Three toggles in a row starting at x, each w wide with gap between. */
const row = (x: number, y: number, w: number, h: number, gap: number): Rect[] =>
  [0, 1, 2].map((i) => rect(x + i * (w + gap), y, w, h));

const wall = (steps: boolean): Design => ({
  pic: pic(
    1530,
    1305,
    535,
    5690,
    { left: 940, right: 5725, top: 295, bottom: 2140 },
    { line: 12, label: 76, axis: 55 },
  ),
  zoom: zoomed(2400, 1305, 730, { left: 940, right: 5725, top: 295, bottom: 2140 }, 12, 76, 55),
  wheel: { x: 285, y: 1930, r: 185 },
  toggles: row(89, 1580, 220, 125, 27),
  walk: steps ? null : rect(500, 1780, 380, 125),
  back: rect(515, 1770, 170, 135),
  next: rect(700, 1770, 170, 135),
  dots: { x: 695, y: 1990, gap: 57, r: 16 },
  caption: { ...rect(105, 62, 5545, 205), size: 135, lines: 1 },
  readout: { ...rect(98, 375, 825, 1085), size: 82 },
  beads: null,
  home: { x: 890, y: 1980 },
});

const panel = (steps: boolean, bank: boolean): Design => {
  const top = bank ? 22 : 0;
  return {
    pic: pic(
      250,
      900,
      215,
      1045,
      { left: 20, right: 1060, top: 510, bottom: 1300 },
      { line: 6, label: 46, axis: 34 },
    ),
    zoom: zoomed(540, 980, 330, { left: 20, right: 1060, top: 510, bottom: 1330 }, 6, 46, 34),
    zoomArc: zoomed(250, 960, 215, { left: 20, right: 1060, top: 510, bottom: 1330 }, 6, 46, 34),
    wheel: { x: 290, y: 1665, r: 200 },
    toggles: row(612, 1405, 136, 136, 20),
    walk: steps ? null : rect(612, 1600, 448, 136),
    back: rect(612, 1600, 214, 136),
    next: rect(846, 1600, 214, 136),
    dots: { x: 736, y: 1800, gap: 48, r: 13 },
    caption: { ...rect(40, 26 + top, 1000, 186), size: 64, lines: 2 },
    readout: { ...rect(60, 228 + top, 960, 270), size: 54 },
    beads: null,
    home: { x: 900, y: 1760 },
  };
};

const pair = (steps: boolean, bank: boolean): Design => {
  const top = bank ? 22 : 0;
  return {
    pic: pic(
      560,
      960,
      360,
      2110,
      { left: 40, right: 2130, top: 300 + top, bottom: 1400 },
      { line: 8, label: 56, axis: 40 },
    ),
    zoom: zoomed(560, 900, 440, { left: 40, right: 2130, top: 300 + top, bottom: 1400 }, 8, 56, 40),
    zoomArc: zoomed(
      410,
      900,
      360,
      { left: 40, right: 2130, top: 300 + top, bottom: 1400 },
      8,
      56,
      40,
    ),
    wheel: { x: 330, y: 1665, r: 205 },
    toggles: row(1560, 1450, 165, 140, 22),
    walk: steps ? null : rect(1560, 1630, 539, 140),
    back: rect(1560, 1630, 258, 140),
    next: rect(1841, 1630, 258, 140),
    dots: { x: 1830, y: 1840, gap: 60, r: 14 },
    caption: { ...rect(60, 28 + top, 1020, 250), size: 72, lines: 2 },
    readout: { ...rect(1180, 34 + top, 920, 250), size: 52 },
    readoutZoom: { ...rect(1250, 990, 860, 400), size: 70 },
    beads: null,
    home: { x: 600, y: 1700 },
  };
};

const kiosk = (steps: boolean): Design => ({
  pic: pic(
    222,
    470,
    190,
    1610,
    { left: 20, right: 1900, top: 112, bottom: 772 },
    { line: 5, label: 40, axis: 30 },
  ),
  zoom: zoomed(560, 440, 260, { left: 20, right: 1900, top: 112, bottom: 772 }, 5, 40, 30),
  wheel: { x: 215, y: 918, r: 145 },
  toggles: row(390, 850, 122, 140, 14),
  walk: steps ? null : rect(800, 850, 420, 140),
  back: rect(860, 850, 160, 140),
  next: rect(1040, 850, 160, 140),
  dots: { x: 1030, y: 1040, gap: 36, r: 9 },
  caption: { ...rect(30, 12, 1860, 92), size: 54, lines: 1 },
  readout: { ...rect(1250, 800, 650, 262), size: 46 },
  readoutZoom: { ...rect(1060, 500, 820, 270), size: 50 },
  beads: null,
  home: { x: 1720, y: 140 },
});

/** Over a bank the beads take the bottom; alone, the picture moves down into the room. */
const screen = (bank: boolean): Design => ({
  pic: pic(
    610,
    bank ? 1820 : 2100,
    440,
    3875,
    { left: 95, right: 3905, top: 790, bottom: bank ? 2745 : 3470 },
    { line: 11, label: 86, axis: 62 },
  ),
  zoom: zoomed(
    1235,
    bank ? 1780 : 2100,
    bank ? 845 : 940,
    { left: 95, right: 3905, top: 790, bottom: bank ? 2745 : 3470 },
    11,
    86,
    62,
  ),
  zoomArc: zoomed(
    805,
    bank ? 1780 : 2100,
    655,
    { left: 95, right: 3905, top: 790, bottom: bank ? 2745 : 3470 },
    11,
    86,
    62,
  ),
  wheel: null,
  toggles: [],
  walk: null,
  back: null,
  next: null,
  dots: null,
  caption: { ...rect(150, 105, 3700, 280), size: 160, lines: 1 },
  readout: { ...rect(150, 440, 3700, 280), size: 98 },
  readoutZoom: { ...rect(2375, bank ? 1920 : 2250, 1480, bank ? 750 : 940), size: 140 },
  beads: bank ? { y: 3180, amp: 280, r: 54 } : null,
  home: { x: 3705, y: 3280 },
});

const designFor = (input: LayoutInput): Design => {
  switch (input.kind) {
    case "wall":
      return wall(input.steps);
    case "pair":
      return pair(input.steps, input.bank);
    case "kiosk":
      return kiosk(input.steps);
    case "screen":
      return screen(input.bank);
    default:
      return panel(input.steps, input.bank);
  }
};

const movePic = (z: Pic, dx: number, dy: number): Pic => ({
  ...z,
  cx: z.cx + dx,
  cy: z.cy + dy,
  x0: z.x0 + dx,
  x1: z.x1 + dx,
  left: z.left + dx,
  right: z.right + dx,
  top: Math.max(0, z.top + dy),
  bottom: z.bottom + dy,
});

const moveRect = (r: Rect, dx: number, dy: number): Rect =>
  rect(r.x + dx, r.y + dy, r.width, r.height);

/** The layout for a frame: the kind's design, centred across it and kept to its bottom. */
export const layoutFor = (input: LayoutInput): Layout => {
  const d = designFor(input);
  const { width: vw, height: vh } = VENUE_SIZE[input.kind];
  const dx = (input.width - vw) / 2;
  const dy = input.height - vh;
  const p = d.pic;
  const P: Pic = {
    ...p,
    cx: p.cx + dx,
    cy: p.cy + dy,
    x0: p.x0 + dx,
    x1: p.x1 + dx,
    left: p.left + dx,
    right: p.right + dx,
    top: Math.max(0, p.top + dy),
    bottom: p.bottom + dy,
  };
  const Z = movePic(d.zoom, dx, dy);
  const pad = Math.max(40, P.r * 0.12);
  const touch = input.kind !== "screen";
  const fns: Fn[] = ["sin", "cos", "tan"];
  return {
    kind: input.kind,
    width: input.width,
    height: input.height,
    bank: input.bank,
    touch,
    pic: P,
    zoom: Z,
    zoomArc: d.zoomArc ? movePic(d.zoomArc, dx, dy) : Z,
    graph: rect(P.x0, P.top, P.x1 - P.x0 + pad, P.bottom - P.top),
    wheel: d.wheel ? { x: d.wheel.x + dx, y: d.wheel.y + dy, r: d.wheel.r } : null,
    toggles: d.toggles.map((r, i) => ({ fn: fns[i]!, rect: moveRect(r, dx, dy) })),
    walk: d.walk ? moveRect(d.walk, dx, dy) : null,
    back: d.back ? moveRect(d.back, dx, dy) : null,
    next: d.next ? moveRect(d.next, dx, dy) : null,
    dots: d.dots ? { ...d.dots, x: d.dots.x + dx, y: d.dots.y + dy } : null,
    caption: { ...d.caption, ...moveRect(d.caption, dx, Math.min(0, dy)) },
    readout: { ...d.readout, ...moveRect(d.readout, dx, Math.min(0, dy)) },
    readoutZoom: d.readoutZoom ? { ...d.readoutZoom, ...moveRect(d.readoutZoom, dx, dy) } : null,
    beads: d.beads ? { ...d.beads, y: d.beads.y + dy } : null,
    strip: input.bank && touch ? rect(0, 0, input.width, 16) : null,
    home: { x: d.home.x + dx, y: d.home.y + dy },
  };
};

/** Where the point is at angle θ. */
export const pointAt = (p: Pic, theta: number): { x: number; y: number } => ({
  x: p.cx + p.r * Math.cos(theta),
  y: p.cy - p.r * Math.sin(theta),
});

/** The graph's x for an angle in [0, 2π]. */
export const graphX = (p: Pic, theta: number): number => p.x0 + theta * p.s;

/** The angle for a graph x, clamped to one turn. */
export const graphTheta = (p: Pic, x: number): number =>
  Math.max(0, Math.min(TAU, (x - p.x0) / p.s));

/** A finger's angle about a centre, anticlockwise from the right, in [0, 2π). */
export const angleAbout = (cx: number, cy: number, x: number, y: number): number => {
  const a = Math.atan2(cy - y, x - cx);
  return a < 0 ? a + TAU : a;
};

/** Between two text boxes, as the picture slides. */
export const lerpBox = (a: TextBox, b: TextBox | null, u: number): TextBox => {
  if (!b || u <= 0) return a;
  if (u >= 1) return b;
  const m = (x: number, y: number) => x + (y - x) * u;
  return {
    x: m(a.x, b.x),
    y: m(a.y, b.y),
    width: m(a.width, b.width),
    height: m(a.height, b.height),
    size: m(a.size, b.size),
  };
};

/** Between two pictures: `u` 0 is `a`, 1 is `b`. */
export const lerpPic = (a: Pic, b: Pic, u: number): Pic => {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const m = (x: number, y: number) => x + (y - x) * u;
  const cx = m(a.cx, b.cx);
  const r = m(a.r, b.r);
  const s = m(a.s, b.s);
  return {
    cx,
    cy: m(a.cy, b.cy),
    r,
    x0: cx + r,
    s,
    x1: cx + r + TAU * s,
    left: m(a.left, b.left),
    right: m(a.right, b.right),
    top: m(a.top, b.top),
    bottom: m(a.bottom, b.bottom),
    line: m(a.line, b.line),
    label: m(a.label, b.label),
    axis: m(a.axis, b.axis),
  };
};

/** Touches this far from the centre count as on the circle (turning it). */
export const ringOf = (p: Pic) => ({
  inner: p.r * 0.28,
  outer: p.r + Math.max(MIN_TARGET * 0.6, p.r * 0.2),
});

/** A touch this close to the point drags the point itself. */
export const grabOf = (p: Pic): number => Math.max(MIN_TARGET * 0.75, p.r * 0.3);

export type Hit = "wheel" | "point" | "ring" | "graph";

const inRect = (r: Rect, x: number, y: number, pad = 0) =>
  x >= r.x - pad && x <= r.x + r.width + pad && y >= r.y - pad && y <= r.y + r.height + pad;

/**
 * What a finger at (x, y) takes hold of, with the point at angle θ on picture `p` (the one
 * drawn). The graph counts only while it is shown.
 */
export const hitAt = (
  l: Layout,
  p: Pic,
  theta: number,
  x: number,
  y: number,
  graphs = true,
): Hit | null => {
  if (!l.touch) return null;
  if (l.wheel && Math.hypot(x - l.wheel.x, y - l.wheel.y) <= l.wheel.r + 30) return "wheel";
  const pt = pointAt(p, theta);
  if (Math.hypot(x - pt.x, y - pt.y) <= grabOf(p)) return "point";
  const d = Math.hypot(x - p.cx, y - p.cy);
  // Left of the line x = 1 the circle owns the touch; right of it the graph does.
  if (d <= ringOf(p).outer && (x < p.x0 || d <= p.r)) return "ring";
  if (graphs && inRect(l.graph, x, y)) return "graph";
  return null;
};
