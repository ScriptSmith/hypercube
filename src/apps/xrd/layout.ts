/**
 * Where everything goes, in venue px. Pure, so tests can check every kind for reach, target
 * sizes and the pair's seam.
 *
 * A frame holds one or more cards. Every card but the kiosk's is a column about a panel wide (a
 * panel, each half of a pair, each of the wall's six columns), so chapters lay out for two shapes:
 * `column` and `landscape`. A column reads top to bottom: the headline and date tag, the watch
 * view, the caption and "So" line, the hands-on figure, the adults' controls with the Maths
 * button at the outer end, the children's controls, and at the bottom the chapter tabs (solo) or
 * Back and Next (a bank frame with more than one chapter). On the wall the figure starts at the
 * top of adult reach, and the machine's banner runs across the top. The kiosk's card is
 * landscape: the watch view left, everything else right, eleven tabs along the bottom.
 *
 * Heights are fixed from the top down, so every frame of a bank, every half of a pair and every
 * column of the wall puts its figure, and the blue beam through it, at the same height: the beam
 * lines up across bezels.
 */
import { MIN_TARGET, MIN_TARGET_WALL, SEAM_SHARE } from "./config";
import type { FrameKind } from "../../core/types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CardShape = "column" | "landscape";
export type BottomMode = "tabs" | "nav" | "none";

/** Font sizes, venue px. */
export interface TypeScale {
  headline: number;
  caption: number;
  so: number;
  tag: number;
  label: number;
  maths: number;
  small: number;
}

export interface CardLayout {
  index: number;
  rect: Rect;
  shape: CardShape;
  /** A pair half's outer edge, where its controls go; null elsewhere. */
  outer: "left" | "right" | null;
  head: Rect;
  watch: Rect;
  /** Caption and "So" line. */
  text: Rect;
  figure: Rect;
  /** The chapter's controls for adults (the Maths button is beside it, not in it). */
  adult: Rect;
  /** The chapter's controls for children, lowest. */
  child: Rect;
  /** The Maths button, or null when the option hides the maths. */
  maths: Rect | null;
  /** Where the open Maths fold covers the card. */
  fold: Rect;
  /** A column's middle (watch, text, figure), for chapters that ask for another split; null on the kiosk. */
  mid: Mid | null;
  /** Tabs or Back and Next. */
  bottom: Rect | null;
  tabs: Rect[];
  nav: { back: Rect; next: Rect; dots: Rect } | null;
  /** Touches count only in here: the card less the pair's seam zone. */
  safe: Rect;
  /** Height of the blue beam that threads every card. */
  beamY: number;
  /** Smallest touch target here. */
  target: number;
  /** Top of adult and child reach, venue px from the frame's top. */
  reach: { adult: number; child: number };
  type: TypeScale;
}

/** A column card's middle: the watch view on top, the caption and "So" line, the figure below. */
export interface Mid {
  top: number;
  bottom: number;
  /** Height of the caption block. */
  text: number;
  x: number;
  width: number;
  /** The highest the figure may start (on the wall, the top of adult reach). */
  figureTop: number;
  beamY: number;
}

/** Share of the middle a figure takes by default, and the least and most a chapter may ask. */
export const DEFAULT_SPLIT = 0.5;
export const MIN_SPLIT = 0.32;
export const MAX_SPLIT = 0.62;

/** The watch view, text and figure for a figure taking `share` of the middle. */
export const splitMid = (m: Mid, share: number): { watch: Rect; text: Rect; figure: Rect } => {
  const free = m.bottom - m.top - m.text - 2 * GAP;
  const s = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, share));
  let figureH = Math.round(free * s);
  // Never above the highest it may start, and always holding the beam.
  figureH = Math.min(figureH, m.bottom - m.figureTop);
  figureH = Math.max(figureH, Math.min(m.bottom - m.figureTop, m.bottom - m.beamY + 60));
  const figure: Rect = { x: m.x, y: m.bottom - figureH, width: m.width, height: figureH };
  const text: Rect = { x: m.x, y: figure.y - GAP - m.text, width: m.width, height: m.text };
  const watch: Rect = {
    x: m.x,
    y: m.top,
    width: m.width,
    height: Math.max(0, text.y - GAP - m.top),
  };
  return { watch, text, figure };
};

/** The card's layout with the Maths fold over the caption and figure instead of the watch view. */
export const foldOverFigure = (l: CardLayout): CardLayout => ({
  ...l,
  fold: union(l.text, l.figure),
});

/** A card's layout with the figure taking `share` of its middle: the beam stays where it was. */
export const withSplit = (l: CardLayout, share: number): CardLayout => {
  if (!l.mid) return l;
  const { watch, text, figure } = splitMid(l.mid, share);
  return { ...l, watch, text, figure, fold: union(watch, text) };
};

export interface FrameLayout {
  kind: FrameKind;
  width: number;
  height: number;
  cards: CardLayout[];
  /** The wall's machine, across the top. */
  banner: Rect | null;
}

export interface CardSpec {
  /** What the bottom band shows. */
  bottom: BottomMode;
  /**
   * The space kept for it, when that differs: every frame of a bank keeps room for Back and Next
   * so their figures line up, and one without them gives the room to the children's controls.
   */
  reserve?: BottomMode;
  /** Tabs to lay out (solo frames). */
  tabs?: number;
}

export interface LayoutInput {
  kind: Exclude<FrameKind, "screen">;
  /** Venue px. */
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  /** One spec per card: one on a panel or kiosk, two on a pair, six on a wall. */
  cards: readonly CardSpec[];
  maths: boolean;
}

export const PAD = 44;
const GAP = 16;
export const BANNER_HEIGHT = 540;

const TYPE: Record<"column" | "wall" | "landscape", TypeScale> = {
  column: { headline: 74, caption: 48, so: 44, tag: 32, label: 38, maths: 70, small: 32 },
  wall: { headline: 82, caption: 52, so: 48, tag: 36, label: 44, maths: 76, small: 34 },
  landscape: { headline: 60, caption: 38, so: 36, tag: 28, label: 32, maths: 58, small: 28 },
};

export const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

export const inset = (r: Rect, dx: number, dy = dx): Rect => ({
  x: r.x + dx,
  y: r.y + dy,
  width: Math.max(0, r.width - 2 * dx),
  height: Math.max(0, r.height - 2 * dy),
});

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

export const centre = (r: Rect): { x: number; y: number } => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/** Split a rect into cells across, by weights, with gaps between. */
export const splitRow = (r: Rect, weights: readonly number[], gap = GAP): Rect[] => {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const free = r.width - gap * (weights.length - 1);
  let x = r.x;
  return weights.map((w) => {
    const width = (free * w) / total;
    const cell = { x, y: r.y, width, height: r.height };
    x += width + gap;
    return cell;
  });
};

/** Split a rect into rows, top to bottom, by weights. */
export const splitColumn = (r: Rect, weights: readonly number[], gap = GAP): Rect[] => {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const free = r.height - gap * (weights.length - 1);
  let y = r.y;
  return weights.map((w) => {
    const height = (free * w) / total;
    const cell = { x: r.x, y, width: r.width, height };
    y += height + gap;
    return cell;
  });
};

/** The largest square of at most `max` centred in a rect. */
export const square = (r: Rect, max = Number.POSITIVE_INFINITY): Rect => {
  const s = Math.min(r.width, r.height, max);
  return { x: r.x + (r.width - s) / 2, y: r.y + (r.height - s) / 2, width: s, height: s };
};

/** Tab cells in rows of at most `perRow`, centred. */
export const tabRects = (band: Rect, count: number, perRow: number, gap = 14): Rect[] => {
  if (count <= 0) return [];
  const rows = Math.ceil(count / perRow);
  const h = (band.height - gap * (rows - 1)) / rows;
  const w = (band.width - gap * (perRow - 1)) / perRow;
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const col = i - row * perRow;
    const x0 = band.x + (band.width - (inRow * w + (inRow - 1) * gap)) / 2;
    out.push({ x: x0 + col * (w + gap), y: band.y + row * (h + gap), width: w, height: h });
  }
  return out;
};

const MATHS_W = 230;
const TAB_ROW = 122;
const NAV_H = 140;

interface ColumnArgs {
  rect: Rect;
  lane: Rect;
  outer: "left" | "right" | null;
  spec: CardSpec;
  wall: boolean;
  maths: boolean;
  reach: { adult: number; child: number };
  index: number;
}

const column = (a: ColumnArgs): CardLayout => {
  const { rect, lane, spec, wall } = a;
  const type = wall ? TYPE.wall : TYPE.column;
  const target = wall ? MIN_TARGET_WALL : MIN_TARGET;
  const x = rect.x + PAD;
  const w = rect.width - 2 * PAD;
  const top = rect.y + PAD;
  const bottomEdge = rect.y + rect.height - PAD * 0.8;

  // Bottom band: tabs in rows, or Back and Next.
  const perRow = a.outer ? 3 : 6;
  const reserve = spec.reserve ?? spec.bottom;
  const tabRows = reserve === "tabs" ? Math.ceil((spec.tabs ?? 0) / perRow) : 0;
  const bottomH =
    reserve === "tabs" && tabRows > 0
      ? tabRows * TAB_ROW + (tabRows - 1) * 12
      : reserve === "nav"
        ? NAV_H
        : 0;
  const bottom: Rect | null =
    bottomH > 0 ? { x: lane.x, y: bottomEdge - bottomH, width: lane.width, height: bottomH } : null;

  const childH = wall ? 300 : 216;
  const adultH = wall ? 190 : 164;
  const childBottom = bottom ? bottom.y - GAP : bottomEdge;
  let child: Rect = { x: lane.x, y: childBottom - childH, width: lane.width, height: childH };
  const adultBand: Rect = {
    x: lane.x,
    y: child.y - GAP - adultH,
    width: lane.width,
    height: adultH,
  };
  const head: Rect = { x, y: top, width: w, height: wall ? 250 : 228 };
  const midTop = head.y + head.height + GAP;
  const midBottom = adultBand.y - GAP;
  const textH = wall ? 236 : 210;
  const mid: Mid = {
    top: midTop,
    bottom: midBottom,
    text: textH,
    x,
    width: w,
    // The figure is for touching: on the wall it lies within adult reach.
    figureTop: wall ? Math.max(a.reach.adult + 8, midTop) : midTop,
    beamY: 0,
  };
  const free = midBottom - midTop - textH - 2 * GAP;
  // The beam's height is fixed for the card, inside the smallest figure any chapter may ask for.
  const smallest = Math.min(free * MIN_SPLIT, midBottom - mid.figureTop);
  mid.beamY = Math.round(midBottom - smallest * 0.5);
  const { watch, text, figure } = splitMid(mid, wall ? 1 : DEFAULT_SPLIT);
  let maths: Rect | null = null;
  let adult = adultBand;
  if (a.maths) {
    const mh = Math.max(target, Math.min(adultBand.height, 128));
    const mx = a.outer === "left" ? adultBand.x : adultBand.x + adultBand.width - MATHS_W;
    maths = { x: mx, y: adultBand.y + adultBand.height - mh, width: MATHS_W, height: mh };
    adult = {
      x: a.outer === "left" ? adultBand.x + MATHS_W + GAP : adultBand.x,
      y: adultBand.y,
      width: adultBand.width - MATHS_W - GAP,
      height: adultBand.height,
    };
  }

  // A frame keeping room it doesn't use gives it to the children's controls.
  const shownBottom = spec.bottom === reserve ? bottom : null;
  if (bottom && !shownBottom) child = { ...child, height: bottomEdge - child.y };

  const tabs =
    spec.bottom === "tabs" && shownBottom ? tabRects(shownBottom, spec.tabs ?? 0, perRow, 12) : [];
  let nav: CardLayout["nav"] = null;
  if (spec.bottom === "nav" && shownBottom) {
    const bottom = shownBottom;
    const bw = Math.min(300, (bottom.width - 2 * GAP) / 3);
    const bh = Math.max(target, bottom.height - 10);
    const by = bottom.y + (bottom.height - bh) / 2;
    nav = {
      back: { x: bottom.x, y: by, width: bw, height: bh },
      next: { x: bottom.x + bottom.width - bw, y: by, width: bw, height: bh },
      dots: { x: bottom.x + bw + GAP, y: by, width: bottom.width - 2 * bw - 2 * GAP, height: bh },
    };
  }

  return {
    index: a.index,
    rect,
    shape: "column",
    outer: a.outer,
    head,
    watch,
    text,
    figure,
    adult,
    child,
    maths,
    fold: union(watch, text),
    mid,
    bottom: shownBottom,
    tabs,
    nav,
    // On a pair half, the lane out to the card's outer edge; elsewhere the whole card.
    safe:
      a.outer === "left"
        ? { x: rect.x, y: rect.y, width: lane.x + lane.width - rect.x, height: rect.height }
        : a.outer === "right"
          ? { x: lane.x, y: rect.y, width: rect.x + rect.width - lane.x, height: rect.height }
          : rect,
    beamY: mid.beamY,
    target,
    reach: a.reach,
    type,
  };
};

/** The kiosk's watch view's share of the card's width by default, and the least and most. */
export const DEFAULT_WATCH_SHARE = 0.47;
export const MIN_WATCH_SHARE = 0.3;
export const MAX_WATCH_SHARE = 0.6;

const landscape = (
  rect: Rect,
  spec: CardSpec,
  maths: boolean,
  reach: CardLayout["reach"],
  watchShare = DEFAULT_WATCH_SHARE,
): CardLayout => {
  const type = TYPE.landscape;
  const target = MIN_TARGET;
  const x0 = rect.x + 40;
  const w = rect.width - 80;
  const top = rect.y + 30;
  const bottomEdge = rect.y + rect.height - 30;
  const tabsH = spec.bottom === "tabs" ? 124 : spec.bottom === "nav" ? 130 : 0;
  const bottom: Rect | null =
    tabsH > 0 ? { x: x0, y: bottomEdge - tabsH, width: w, height: tabsH } : null;
  const head: Rect = { x: x0, y: top, width: w, height: 112 };
  const bodyTop = head.y + head.height + GAP;
  const bodyBottom = (bottom ? bottom.y : bottomEdge) - GAP;
  const share = Math.min(MAX_WATCH_SHARE, Math.max(MIN_WATCH_SHARE, watchShare));
  const leftW = Math.round(w * share);
  const watch: Rect = { x: x0, y: bodyTop, width: leftW, height: bodyBottom - bodyTop };
  const rx = x0 + leftW + 28;
  const rw = x0 + w - rx;
  const [text, figure, adultBand, child] = splitColumn(
    { x: rx, y: bodyTop, width: rw, height: bodyBottom - bodyTop },
    [160, 250, 130, 150],
    12,
  ) as [Rect, Rect, Rect, Rect];
  let mathsRect: Rect | null = null;
  let adult = adultBand;
  if (maths) {
    mathsRect = {
      x: adultBand.x + adultBand.width - 200,
      y: adultBand.y + adultBand.height - target,
      width: 200,
      height: target,
    };
    adult = { ...adultBand, width: adultBand.width - 200 - GAP };
  }
  const tabs = spec.bottom === "tabs" && bottom ? tabRects(bottom, spec.tabs ?? 0, 11, 12) : [];
  let nav: CardLayout["nav"] = null;
  if (spec.bottom === "nav" && bottom) {
    nav = {
      back: { x: bottom.x, y: bottom.y, width: 280, height: bottom.height },
      next: { x: bottom.x + bottom.width - 280, y: bottom.y, width: 280, height: bottom.height },
      dots: { x: bottom.x + 300, y: bottom.y, width: bottom.width - 600, height: bottom.height },
    };
  }
  return {
    index: 0,
    rect,
    shape: "landscape",
    outer: null,
    head,
    watch,
    text,
    figure,
    adult,
    child,
    maths: mathsRect,
    fold: watch,
    mid: null,
    bottom,
    tabs,
    nav,
    safe: rect,
    beamY: Math.round(figure.y + figure.height * 0.5),
    target,
    reach,
    type,
  };
};

/**
 * A kiosk card laid out again with its watch view taking `share` of its width, for a chapter whose
 * reasoning happens in the figure (chapter 11's fingerprints). Other shapes are returned as they are.
 */
export const withWatchShare = (l: CardLayout, share: number): CardLayout => {
  if (l.shape !== "landscape") return l;
  const spec: CardSpec =
    l.tabs.length > 0
      ? { bottom: "tabs", tabs: l.tabs.length }
      : l.nav
        ? { bottom: "nav" }
        : { bottom: "none" };
  return { ...landscape(l.rect, spec, l.maths !== null, l.reach, share), index: l.index };
};

export const layoutFrame = (input: LayoutInput): FrameLayout => {
  const { kind, width: W, height: H } = input;
  const reach = { adult: input.reachTop.adult, child: input.reachTop.child };
  const spec = (i: number): CardSpec => input.cards[i] ?? { bottom: "none" };
  if (kind === "kiosk") {
    return {
      kind,
      width: W,
      height: H,
      banner: null,
      cards: [landscape({ x: 0, y: 0, width: W, height: H }, spec(0), input.maths, reach)],
    };
  }
  if (kind === "wall") {
    const n = Math.max(1, input.cards.length);
    const banner: Rect = { x: 0, y: 0, width: W, height: Math.min(BANNER_HEIGHT, H * 0.24) };
    const cw = W / n;
    const cards = Array.from({ length: n }, (_, i) => {
      const rect = { x: i * cw, y: banner.height, width: cw, height: H - banner.height };
      return column({
        rect,
        lane: inset(rect, PAD, 0),
        outer: null,
        spec: spec(i),
        wall: true,
        maths: input.maths,
        reach,
        index: i,
      });
    });
    return { kind, width: W, height: H, banner, cards };
  }
  if (kind === "pair") {
    const half = W / 2;
    const zone = W * SEAM_SHARE;
    const cards = [0, 1].map((i) => {
      const rect = { x: i * half, y: 0, width: half, height: H };
      const outer = i === 0 ? "left" : "right";
      const laneW = half - zone - PAD;
      const lane = {
        x: i === 0 ? PAD : W - PAD - laneW,
        y: 0,
        width: laneW,
        height: H,
      };
      return column({
        rect,
        lane,
        outer,
        spec: spec(i),
        wall: false,
        maths: input.maths,
        reach,
        index: i,
      });
    });
    return { kind, width: W, height: H, banner: null, cards };
  }
  const rect = { x: 0, y: 0, width: W, height: H };
  return {
    kind,
    width: W,
    height: H,
    banner: null,
    cards: [
      column({
        rect,
        lane: inset(rect, PAD, 0),
        outer: null,
        spec: spec(0),
        wall: false,
        maths: input.maths,
        reach,
        index: 0,
      }),
    ],
  };
};
