/**
 * Where everything goes on a touch frame, in venue px (y down). Pure.
 *
 * Every harmonic has a vertical amplitude slider in the children's band (lowest) and a phase
 * dial above it; its thread rises from the top of the dial up its column. Designs are for the
 * venue size of each kind, centred across the actual frame and kept to its bottom edge, where
 * reach is measured from.
 *
 * - Bank panel: one harmonic, big controls; the thread rises out of the top edge to the screen.
 *   A small picture at the top is shown only while the screen is gone.
 * - Bank pair: one harmonic per half, its controls at the outer side, clear of the seam; the
 *   right half's sit lower than the left's so they never mirror each other.
 * - Solo panel: five harmonics in columns, dials staggered in two rows; the picture and cloth
 *   above.
 * - Solo pair: three harmonics per half, each half's dials staggered the opposite way.
 * - Kiosk: six harmonics along the bottom, the picture above.
 * - Wall: 6, 8 or 10 harmonic columns across the reach band, the picture in the upper wall.
 */
import { VENUE_SIZE } from "../../core/frame";
import type { FrameKind, Rect } from "../../core/types";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface SliderSpec {
  x: number;
  /** y of the handle's centre at amplitude 0 (bottom) and 1 (top). */
  y0: number;
  y1: number;
  /** Handle size. */
  w: number;
  h: number;
}

export interface StrandSpec {
  /** Index on this frame. */
  index: number;
  /** Harmonic number, from 1. */
  k: number;
  /** The thread's column: centre and width. */
  col: { x: number; w: number };
  slider: SliderSpec;
  dial: Circle;
  /** Hold to let this harmonic go (bank frames: one per harmonic). */
  reset: Circle | null;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  bank: boolean;
  strands: StrandSpec[];
  /** Where the epicycles and the wave go: always on solo frames, a bank frame's stand-in. */
  picture: Rect;
  /** Where threads end under the picture. */
  heddle: number;
  /** Solo frames' cloth. */
  cloth: Rect | null;
  /** Solo frames: one hold-to-reset for the frame. */
  reset: Circle | null;
  /** Top-left of a free square for the runtime's Home control. */
  home: { x: number; y: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: readonly number[];
  bank: boolean;
  /** Harmonics on a wall (6, 8 or 10). */
  harmonics: number;
  /** Harmonic number of this frame's first harmonic (bank frames). */
  firstK: number;
}

export const MIN_TARGET = 120;
/** Dials on panels and pairs are at least this wide, and slider handles this big each way. */
export const MIN_DIAL = 200;
export const MIN_HANDLE = 140;
/** Pair controls keep this share of the width from the seam. */
export const SEAM_SHARE = 0.2;
/** Extra reach around a control that still counts as a touch on it. */
export const HIT_PAD = 28;

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

interface Design {
  strands: Omit<StrandSpec, "k">[];
  picture: Rect;
  heddle: number;
  cloth: Rect | null;
  reset: Circle | null;
  home: { x: number; y: number };
}

const bankPanel = (): Design => ({
  strands: [
    {
      index: 0,
      col: { x: 540, w: 1080 },
      dial: { x: 540, y: 790, r: 190 },
      slider: { x: 540, y0: 1790, y1: 1200, w: 170, h: 140 },
      reset: { x: 950, y: 975, r: 66 },
    },
  ],
  picture: rect(40, 40, 1000, 420),
  heddle: 480,
  cloth: null,
  reset: null,
  home: { x: 880, y: 1160 },
});

const bankPair = (): Design => ({
  strands: [
    {
      index: 0,
      col: { x: 540, w: 1080 },
      dial: { x: 360, y: 760, r: 190 },
      slider: { x: 360, y0: 1780, y1: 1190, w: 170, h: 140 },
      reset: { x: 562, y: 1000, r: 66 },
    },
    {
      index: 1,
      col: { x: 1620, w: 1080 },
      dial: { x: 1800, y: 880, r: 190 },
      slider: { x: 1800, y0: 1820, y1: 1270, w: 170, h: 140 },
      reset: { x: 1598, y: 1120, r: 66 },
    },
  ],
  picture: rect(40, 40, 2080, 400),
  heddle: 460,
  cloth: null,
  reset: null,
  home: { x: 1960, y: 120 },
});

/** Columns of small staggered controls: `xs` centres, `rows` the dial row of each. */
const columns = (
  xs: number[],
  colW: number,
  rows: number[],
  slider: { y0: number; y1: number }[],
  r: number,
  first = 0,
): Omit<StrandSpec, "k">[] =>
  xs.map((x, i) => ({
    index: first + i,
    col: { x, w: colW },
    dial: { x, y: rows[i]!, r },
    slider: { x, y0: slider[i]!.y0, y1: slider[i]!.y1, w: 150, h: 140 },
    reset: null,
  }));

const soloPanel = (): Design => {
  const xs = [-2, -1, 0, 1, 2].map((d) => 540 + d * 211);
  const rows = xs.map((_, i) => (i % 2 === 0 ? 960 : 1180));
  const slider = xs.map(() => ({ y0: 1810, y1: 1405 }));
  return {
    strands: columns(xs, 211, rows, slider, 110),
    picture: rect(30, 236, 1020, 480),
    heddle: 760,
    cloth: rect(0, 24, 1080, 176),
    reset: { x: 962, y: 1180, r: 66 },
    home: { x: 38, y: 1100 },
  };
};

const soloPair = (): Design => {
  const left = [-1, 0, 1].map((d) => 324 + d * 205);
  const right = [-1, 0, 1].map((d) => 1836 + d * 205);
  return {
    strands: [
      ...columns(
        left,
        205,
        [960, 1180, 960],
        left.map(() => ({ y0: 1800, y1: 1400 })),
        110,
      ),
      // Staggered the other way and a little lower, so nothing mirrors the left half.
      ...columns(
        right,
        205,
        [1180, 960, 1180],
        right.map(() => ({ y0: 1840, y1: 1440 })),
        110,
        3,
      ),
    ],
    picture: rect(30, 236, 2100, 480),
    heddle: 760,
    cloth: rect(0, 24, 2160, 176),
    reset: { x: 529, y: 1180, r: 66 },
    home: { x: 1961, y: 880 },
  };
};

const kiosk = (): Design => {
  const colW = 295;
  const xs = Array.from({ length: 6 }, (_, i) => colW / 2 + i * colW);
  return {
    strands: xs.map((x, i) => ({
      index: i,
      col: { x, w: colW },
      dial: { x, y: 592, r: 110 },
      slider: { x, y0: 1000, y1: 812, w: 150, h: 140 },
      reset: null,
    })),
    picture: rect(30, 118, 1860, 282),
    heddle: 420,
    cloth: rect(0, 12, 1920, 96),
    reset: { x: 1840, y: 640, r: 62 },
    home: { x: 1765, y: 840 },
  };
};

const wall = (n: number): Design => {
  const W = VENUE_SIZE.wall.width;
  const colW = W / n;
  const xs = Array.from({ length: n }, (_, i) => (i + 0.5) * colW);
  return {
    strands: xs.map((x, i) => ({
      index: i,
      col: { x, w: colW },
      dial: { x, y: 1405, r: 135 },
      slider: { x, y0: 2060, y1: 1670, w: 170, h: 140 },
      reset: null,
    })),
    picture: rect(55, 260, W - 110, 675),
    heddle: 970,
    cloth: rect(0, 27, W, 205),
    // Between the last two dials.
    reset: { x: (n - 1) * colW, y: 1405, r: 62 },
    home: { x: colW - 71, y: 1335 },
  };
};

const designFor = (input: LayoutInput): Design => {
  switch (input.kind) {
    case "pair":
      return input.bank ? bankPair() : soloPair();
    case "kiosk":
      return kiosk();
    case "wall":
      return wall(input.harmonics <= 6 ? 6 : input.harmonics <= 8 ? 8 : 10);
    default:
      return input.bank ? bankPanel() : soloPanel();
  }
};

const shiftCircle = (c: Circle, dx: number, dy: number): Circle => ({
  x: c.x + dx,
  y: c.y + dy,
  r: c.r,
});

/** The layout for a frame: the kind's design, centred across it and kept to its bottom. */
export const layoutFor = (input: LayoutInput): Layout => {
  const kind = input.kind === "screen" || input.kind === "sphere" ? "panel" : input.kind;
  const d = designFor({ ...input, kind });
  const { width: vw, height: vh } = VENUE_SIZE[kind];
  const dx = (input.width - vw) / 2;
  const dy = input.height - vh;
  // Pictures and cloth stretch across the frame's whole width, keeping their margins.
  const widen = (r: Rect): Rect => rect(r.x, r.y + dy, Math.max(1, r.width + 2 * dx), r.height);
  return {
    kind,
    width: input.width,
    height: input.height,
    bank: input.bank,
    strands: d.strands.map((s, i, all) => ({
      index: s.index,
      k: input.bank ? input.firstK + s.index : s.index + 1,
      // A bank frame's columns split its whole width evenly, as the screen's split the bank.
      col: input.bank
        ? { x: ((i + 0.5) * input.width) / all.length, w: input.width / all.length }
        : { x: s.col.x + dx, w: s.col.w },
      slider: { ...s.slider, x: s.slider.x + dx, y0: s.slider.y0 + dy, y1: s.slider.y1 + dy },
      dial: shiftCircle(s.dial, dx, dy),
      reset: s.reset ? shiftCircle(s.reset, dx, dy) : null,
    })),
    picture: widen(d.picture),
    heddle: d.heddle + dy,
    cloth: d.cloth ? widen(d.cloth) : null,
    reset: d.reset ? shiftCircle(d.reset, dx, dy) : null,
    home: { x: d.home.x + dx, y: d.home.y + dy },
  };
};

/**
 * Harmonics a bank frame of this kind carries: one on a panel, two on merged panels (one per
 * half, however many panels are merged, so its layout and the screen's columns agree).
 */
export const perFrame = (kind: FrameKind): number => (kind === "pair" ? 2 : 1);

/** Amplitude for a finger at venue y on a slider. */
export const sliderValue = (s: SliderSpec, y: number): number =>
  Math.max(0, Math.min(1, (s.y0 - y) / (s.y0 - s.y1)));

/** The handle's centre y for an amplitude. */
export const sliderY = (s: SliderSpec, amp: number): number => s.y0 + (s.y1 - s.y0) * amp;

export interface ControlHit {
  type: "slider" | "dial";
  strand: number;
}

const inSlider = (s: SliderSpec, x: number, y: number) =>
  Math.abs(x - s.x) <= s.w / 2 + HIT_PAD &&
  y >= s.y1 - s.h / 2 - HIT_PAD &&
  y <= s.y0 + s.h / 2 + HIT_PAD;

/** The control under a venue point, nearest first, or null. */
export const controlAt = (l: Layout, x: number, y: number): ControlHit | null => {
  let best: { hit: ControlHit; d: number } | null = null;
  const consider = (hit: ControlHit, d: number) => {
    if (!best || d < best.d) best = { hit, d };
  };
  for (const s of l.strands) {
    const dd = Math.hypot(x - s.dial.x, y - s.dial.y);
    if (dd <= s.dial.r + HIT_PAD) consider({ type: "dial", strand: s.index }, dd - s.dial.r);
    if (inSlider(s.slider, x, y))
      consider({ type: "slider", strand: s.index }, Math.abs(x - s.slider.x) - s.slider.w / 2);
  }
  return (best as { hit: ControlHit; d: number } | null)?.hit ?? null;
};
