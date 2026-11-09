/**
 * Where everything goes on each kind of frame, in venue px. Pure, so tests can check reach,
 * touch-target sizes and the pair's seam.
 *
 * - panel: the eye on top, the simulated view below it with its caption, the caption card,
 *   sliders, then the condition tiles and the near, far and correction buttons in the
 *   children's band. With the bank's screen present the view's space goes to the eye.
 * - pair: the eye large in the left half with sliders and part buttons at its outer edge; the
 *   view, its caption and the card in the right half, tiles and buttons at its outer edge.
 *   Controls stay a fifth of the width from the seam.
 * - wall: the eye very large at the left, rising into the unreachable top, with part chips in
 *   reach below it; two views side by side at the top right ("Typical eye" and "This eye"),
 *   the card, sliders, tiles and buttons in the reach band.
 * - kiosk: the eye at the left, the view at the right, controls along the bottom.
 */
import { VENUE_SIZE } from "../../core/frame";
import type { FrameKind } from "../../core/types";
import type { ConditionId } from "./captions";
import { hasStrength } from "./model";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SliderId = "length" | "radius" | "age" | "light" | "strength";
export type ButtonId = "near" | "far" | "corrA" | "corrB" | "next" | "prev" | "only";

export interface ViewSlot {
  rect: Rect;
  /** Label over the view ("Typical eye", "This eye"), or null. */
  label: string | null;
  /** This view shows a typical eye of the same age and light, for comparison. */
  typical: boolean;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  eye: Rect;
  views: ViewSlot[];
  /** The view caption's box, under the views. */
  viewCaption: Rect | null;
  /** The caption card's text box (title and one line). */
  card: Rect;
  more: Rect;
  /** Slider slots, in order; which slider fills each depends on the condition. */
  sliderSlots: Rect[];
  tiles: Rect[];
  buttons: Partial<Record<ButtonId, Rect>>;
  /** Part chips (the wall only). */
  chips: Rect[];
  /** The magnified mosaic of rods and cones, over the eye's corner. */
  inset: Rect;
  home: { x: number; y: number };
  text: { title: number; caption: number; view: number; label: number; tile: number; min: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  /** Venue y of the top of adult and child reach. */
  reachTop: { adult: number; child: number };
  /** In a bank with its screen present: the view moves to the screen. */
  screenUp: boolean;
}

/** Smallest touch target, venue px (AGENTS.md). */
export const MIN_TARGET = 120;
/** Controls on a pair stay this share of the width away from the seam. */
export const SEAM_SHARE = 0.2;
export const TILE_COUNT = 11;
export const PART_COUNT = 21;

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** n cells in a grid of `cols` columns inside `r`, row by row. */
export const grid = (r: Rect, n: number, cols: number, gap: number, rows?: number): Rect[] => {
  const rs = rows ?? Math.ceil(n / cols);
  const w = (r.width - gap * (cols - 1)) / cols;
  const h = (r.height - gap * (rs - 1)) / rs;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const row = Math.floor(i / cols);
    out.push(R(r.x + c * (w + gap), r.y + row * (h + gap), w, h));
  }
  return out;
};

const panel = (i: LayoutInput): Layout => {
  const W = 1080;
  const H = 1920;
  const m = 24;
  const buttons = grid(R(m, H - 12 - 124, W - 2 * m, 124), 5, 5, 10);
  const tiles = grid(
    R(m, buttons[0]!.y - 12 - 2 * 128 - 10, W - 2 * m, 2 * 128 + 10),
    11,
    6,
    10,
    2,
  );
  const sliderSlots = grid(
    R(m, tiles[0]!.y - 12 - 2 * 122 - 10, W - 2 * m, 2 * 122 + 10),
    4,
    2,
    14,
  );
  const cardY = sliderSlots[0]!.y - 12 - 222;
  const card = R(m, cardY, W - 2 * m - 190, 222);
  const more = R(W - m - 176, cardY + 51, 176, 120);
  const views: ViewSlot[] = [];
  let viewCaption: Rect | null = null;
  let eye: Rect;
  if (i.screenUp) {
    eye = R(0, 0, W, cardY - 8);
  } else {
    const capH = 118;
    const viewH = 430;
    const capY = cardY - 8 - capH;
    const viewY = capY - 6 - viewH;
    views.push({ rect: R(m, viewY, W - 2 * m, viewH), label: null, typical: false });
    viewCaption = R(m, capY, W - 2 * m, capH);
    eye = R(0, 0, W, viewY - 8);
  }
  return {
    kind: "panel",
    width: W,
    height: H,
    eye,
    views,
    viewCaption,
    card,
    more,
    sliderSlots,
    tiles,
    buttons: {
      near: buttons[0]!,
      far: buttons[1]!,
      corrA: buttons[2]!,
      corrB: buttons[3]!,
      next: buttons[4]!,
      only: R(m, eye.y + eye.height - 132, 300, 124),
    },
    chips: [],
    inset: R(W - 20 - 330, 20, 330, 330),
    home: { x: 20, y: 20 },
    text: { title: 44, caption: 32, view: 30, label: 28, tile: 26, min: 24 },
  };
};

const pair = (i: LayoutInput): Layout => {
  const W = 2160;
  const H = 1920;
  const zone = W / 2 - W * SEAM_SHARE; // 648: controls stay this far out from the seam
  const m = 20;
  const childTop = Math.max(i.reachTop.child, H * 0.5);
  // Left outer edge: sliders, then the part buttons.
  const left = R(m, 1030, zone - m - 8, H - 1030 - m);
  const sliderSlots = grid(R(left.x, left.y, left.width, 5 * 120 + 4 * 12), 5, 1, 12);
  const partY = sliderSlots[4]!.y + 120 + 30;
  const partRow = grid(R(left.x, partY, left.width, 128), 2, 2, 16);
  // Right outer edge, in the children's band: tiles and buttons.
  const rx = W - zone + 8;
  const rw = W - m - rx;
  const tiles = grid(R(rx, childTop + 8, rw, 4 * 122 + 3 * 10), 11, 3, 10, 4);
  const btnY = tiles[tiles.length - 1]!.y + 122 + 22;
  const btns = grid(R(rx, btnY, rw, 2 * 124 + 10), 4, 2, 10, 2);
  const views: ViewSlot[] = [];
  let viewCaption: Rect | null = null;
  const vx = W / 2 + 20;
  let cardY: number;
  if (i.screenUp) {
    cardY = 40;
  } else {
    views.push({ rect: R(vx, 24, W - m - vx, 590), label: null, typical: false });
    viewCaption = R(vx, 24 + 590 + 6, W - m - vx, 124);
    cardY = viewCaption.y + viewCaption.height + 8;
  }
  const cardH = Math.min(300, childTop - 8 - cardY);
  const more = R(W - m - 150, cardY + (cardH - 130) / 2, 150, 130);
  const card = R(vx, cardY, more.x - 12 - vx, cardH);
  return {
    kind: "pair",
    width: W,
    height: H,
    eye: R(0, 0, W / 2 - 10, 1010),
    views,
    viewCaption,
    card,
    more,
    sliderSlots,
    tiles,
    buttons: {
      near: btns[0]!,
      far: btns[1]!,
      corrA: btns[2]!,
      corrB: btns[3]!,
      prev: partRow[0]!,
      next: partRow[1]!,
      only: R(m, 1010 - 134, 320, 124),
    },
    chips: [],
    inset: R(W / 2 - 30 - 360, 30, 360, 360),
    home: { x: 24, y: 24 },
    text: { title: 42, caption: 30, view: 28, label: 26, tile: 24, min: 22 },
  };
};

const wall = (i: LayoutInput): Layout => {
  const { width: W, height: H } = VENUE_SIZE.wall;
  const adult = i.reachTop.adult;
  const child = i.reachTop.child;
  const m = 36;
  const eye = R(0, 0, 2420, child - 9);
  const chips = grid(R(m, child + 11, 2420 - 2 * m, H - child - 11 - m), 21, 7, 14, 3);
  const vx = 2505;
  const vw = W - m - vx;
  const viewW = (vw - 53) / 2;
  const viewH = Math.min(viewW * 0.56, adult - 107 - 205 - 27);
  const views: ViewSlot[] = [
    { rect: R(vx, 98, viewW, viewH), label: "Typical eye", typical: true },
    { rect: R(vx + viewW + 53, 98, viewW, viewH), label: "This eye", typical: false },
  ];
  const viewCaption = R(vx, 98 + viewH + 11, vw, adult - (98 + viewH + 11) - 11);
  // The reach band: card, sliders; then tiles and buttons in the children's band.
  const bandTop = adult + 9;
  const bandH = child - 11 - bandTop;
  const sliderX = 4140;
  const sliderSlots = grid(R(sliderX, bandTop, W - m - sliderX, bandH), 6, 3, 21, 2);
  const more = R(sliderX - 27 - 230, bandTop + (bandH - 196) / 2, 230, 196);
  const card = R(vx, bandTop, more.x - 21 - vx, bandH);
  const tiles = grid(R(vx, child + 11, 2170, H - child - 11 - m), 11, 6, 18, 2);
  const bx = vx + 2170 + 36;
  const btns = grid(R(bx, child + 11, W - m - bx, H - child - 11 - m), 6, 3, 18, 2);
  return {
    kind: "wall",
    width: W,
    height: H,
    eye,
    views,
    viewCaption,
    card,
    more,
    sliderSlots,
    tiles,
    buttons: {
      near: btns[0]!,
      far: btns[1]!,
      next: btns[2]!,
      corrA: btns[3]!,
      corrB: btns[4]!,
      prev: btns[5]!,
      only: R(m, eye.height - 150, 390, 133),
    },
    chips,
    inset: R(2420 - 36 - 500, 36, 500, 500),
    home: { x: 36, y: adult - 178 },
    text: { title: 68, caption: 50, view: 48, label: 41, tile: 37, min: 36 },
  };
};

const kiosk = (i: LayoutInput): Layout => {
  const W = 1920;
  const H = 1080;
  const m = 18;
  const top = 500;
  const views: ViewSlot[] = i.screenUp
    ? []
    : [{ rect: R(960, 12, W - m - 960, 404), label: null, typical: false }];
  const viewCaption = i.screenUp ? null : R(960, 420, W - m - 960, top - 420 - 4);
  const more = R(1200, top + 14, 140, 136);
  const card = R(m, top + 4, more.x - 12 - m, 158);
  const sliderSlots = grid(R(m, top + 172, W - 2 * m, 120), 5, 5, 14);
  const lowY = sliderSlots[0]!.y + 120 + 12;
  const lowH = H - m - lowY;
  const tiles = grid(R(m, lowY, 1300, lowH), 11, 6, 10, 2);
  const bx = m + 1300 + 24;
  const btns = grid(R(bx, lowY, W - m - bx, lowH), 6, 3, 10, 2);
  return {
    kind: "kiosk",
    width: W,
    height: H,
    eye: R(0, 0, i.screenUp ? W : 948, top),
    views,
    viewCaption,
    card,
    more,
    sliderSlots,
    tiles,
    buttons: {
      near: btns[0]!,
      far: btns[1]!,
      next: btns[2]!,
      corrA: btns[3]!,
      corrB: btns[4]!,
      prev: btns[5]!,
      only: R(16, top - 132, 300, 124),
    },
    chips: [],
    inset: R(948 - 16 - 260, 16, 260, 260),
    home: { x: 16, y: 16 },
    text: { title: 36, caption: 27, view: 25, label: 23, tile: 22, min: 20 },
  };
};

const nominal = (i: LayoutInput): Layout => {
  switch (i.kind) {
    case "pair":
      return pair(i);
    case "wall":
      return wall(i);
    case "kiosk":
      return kiosk(i);
    default:
      return panel(i);
  }
};

/**
 * The layout for a frame. It is designed at the kind's nominal size; a frame of another size
 * gets it scaled uniformly and centred, with reach measured in nominal units.
 */
export const layoutFor = (i: LayoutInput): Layout => {
  const kind = i.kind === "screen" ? "panel" : i.kind;
  const { width: W, height: H } = VENUE_SIZE[kind];
  const s = Math.min(i.width / W, i.height / H);
  const ox = (i.width - W * s) / 2;
  const oy = (i.height - H * s) / 2;
  const l = nominal({
    ...i,
    kind,
    width: W,
    height: H,
    reachTop: { adult: (i.reachTop.adult - oy) / s, child: (i.reachTop.child - oy) / s },
  });
  if (Math.abs(s - 1) < 1e-6 && Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) return l;
  const t = (r: Rect): Rect => R(ox + r.x * s, oy + r.y * s, r.width * s, r.height * s);
  const buttons: Partial<Record<ButtonId, Rect>> = {};
  for (const [k, r] of Object.entries(l.buttons)) if (r) buttons[k as ButtonId] = t(r);
  return {
    ...l,
    width: i.width,
    height: i.height,
    eye: t(l.eye),
    views: l.views.map((v) => ({ ...v, rect: t(v.rect) })),
    viewCaption: l.viewCaption ? t(l.viewCaption) : null,
    card: t(l.card),
    more: t(l.more),
    sliderSlots: l.sliderSlots.map(t),
    tiles: l.tiles.map(t),
    buttons,
    chips: l.chips.map(t),
    inset: t(l.inset),
    home: { x: ox + l.home.x * s, y: oy + l.home.y * s },
    text: {
      title: l.text.title * s,
      caption: l.text.caption * s,
      view: l.text.view * s,
      label: l.text.label * s,
      tile: l.text.tile * s,
      min: l.text.min * s,
    },
  };
};

/** The sliders for a condition, filling the layout's slots in order. */
export const slidersFor = (c: ConditionId, slots: number): SliderId[] => {
  if (slots >= 5) {
    const all: SliderId[] = ["length", "radius", "age", "light"];
    return hasStrength(c) ? [...all, "strength"] : all;
  }
  if (!hasStrength(c)) return ["length", "radius", "age", "light"];
  return c === "astigmatism"
    ? ["strength", "radius", "age", "light"]
    : ["strength", "length", "age", "light"];
};

export const inRect = (r: Rect, x: number, y: number, pad = 0): boolean =>
  x >= r.x - pad && x <= r.x + r.width + pad && y >= r.y - pad && y <= r.y + r.height + pad;
