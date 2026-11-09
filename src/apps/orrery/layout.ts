/**
 * Where everything goes, in venue px (y down). Pure.
 *
 * Each kind has a design for its venue size, centred across the actual frame and kept to its
 * bottom, where reach is measured from. The space view is in 3D; ground views are 3D too; the
 * controls are drawn on a 2D canvas above them (wheels, the dial, sliders) or are the UI kit's
 * buttons (spin, reset, the flat orbit and the speeds).
 *
 * Heights: the wheel and the spin button are lowest, for children; the tilt, time and place
 * controls above them in adult reach. On a pair every control is at least a fifth of the width
 * from the seam, and the space and ground views keep to one half each.
 */
import { VENUE_SIZE } from "../../core/frame";
import type { FrameKind, Rect } from "../../core/types";
import type { Variant } from "./config";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Slider {
  x0: number;
  x1: number;
  y: number;
  /** The knob's radius; the knob is the touch target. */
  r: number;
  /** Text size for its marks. */
  text: number;
  /** Marks go above the track (true) or below. */
  above: boolean;
}

export interface TextBox extends Rect {
  size: number;
}

export interface GroundBox {
  rect: Rect;
  /** Which place: 0 the frame's own (Brisbane, or the bank's latitude), 1 the wall's other place. */
  place: number;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  variant: Variant;
  bank: boolean;
  touch: boolean;
  /** The space view and the part of it clear of controls, where the scene is framed. */
  space: { rect: Rect; focus: Rect } | null;
  grounds: GroundBox[];
  /** A bank frame's ground view while its screen shows the space view. */
  groundTall: Rect | null;
  wheel: Circle | null;
  spin: Rect | null;
  dial: Circle | null;
  tilt: Slider | null;
  resetTilt: Rect | null;
  /** One per ground view, on solo frames. */
  places: Slider[];
  flat: Rect | null;
  speeds: Rect[];
  caption: TextBox & { lines: number };
  /** Base text size for labels on the views. */
  text: number;
  /** The frame's colour along the top edge (bank frames). */
  strip: Rect | null;
  /** Screens over a bank: the band of labels along the bottom, one above each frame. */
  bankStrip: Rect | null;
  home: { x: number; y: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  variant: Variant;
  bank: boolean;
  /** The wall shows a second place. */
  compare: boolean;
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

type Design = Omit<Layout, "kind" | "width" | "height" | "variant" | "bank" | "touch">;

const empty = {
  space: null,
  grounds: [],
  groundTall: null,
  wheel: null,
  spin: null,
  dial: null,
  tilt: null,
  resetTilt: null,
  places: [],
  flat: null,
  speeds: [],
  strip: null,
  bankStrip: null,
} satisfies Partial<Design>;

const row3 = (x: number, y: number, w: number, h: number, gap: number): Rect[] =>
  [0, 1, 2].map((i) => rect(x + i * (w + gap), y, w, h));

const panel = (moon: boolean, bank: boolean): Design => {
  const top = bank ? 26 : 0;
  // A bank frame has no place slider, so its views and controls have more room.
  const g0 = bank ? 800 : 740;
  const g1 = bank ? 1240 : 1160;
  return {
    ...empty,
    space: {
      rect: rect(0, 130 + top, 1080, g0 - 130 - top),
      focus: rect(0, 200 + top, 1080, g0 - 210 - top),
    },
    grounds: [{ rect: rect(0, g0, 1080, g1 - g0), place: 0 }],
    groundTall: bank ? rect(0, 130 + top, 1080, g1 - 130 - top) : null,
    tilt: moon ? null : { x0: 110, x1: 740, y: g1 + 100, r: 64, text: 38, above: true },
    resetTilt: moon ? null : rect(820, g1 + 38, 200, 124),
    flat: moon ? rect(60, g1 + 38, 330, 124) : null,
    speeds: moon ? row3(560, g1 + 38, 140, 124, 20) : [],
    places: bank ? [] : [{ x0: 110, x1: 970, y: 1420, r: 64, text: 36, above: false }],
    wheel: bank ? { x: 235, y: 1720, r: 180 } : { x: 225, y: 1752, r: 156 },
    spin: bank ? rect(455, 1650, 150, 150) : rect(450, 1682, 150, 150),
    dial: bank ? { x: 850, y: 1720, r: 180 } : { x: 860, y: 1752, r: 156 },
    caption: { ...rect(30, 10 + top, 1020, 116), size: 54, lines: 2 },
    text: 40,
    strip: bank ? rect(0, 0, 1080, 18) : null,
    home: { x: 930, y: 1560 },
  };
};

const pair = (moon: boolean, bank: boolean): Design => {
  const top = bank ? 26 : 0;
  return {
    ...empty,
    space: {
      rect: rect(0, 160 + top, 1080, 1110 - top),
      focus: rect(0, 200 + top, 1080, 1070 - top),
    },
    grounds: [{ rect: rect(1080, 160 + top, 1080, 1110 - top), place: 0 }],
    tilt: moon ? null : { x0: 90, x1: 420, y: 1395, r: 64, text: 34, above: false },
    resetTilt: moon ? null : rect(500, 1333, 148, 124),
    flat: moon ? rect(70, 1280, 330, 124) : null,
    speeds: moon ? row3(70, 1420, 130, 124, 15) : [],
    places: bank
      ? []
      : [{ x0: 1590, x1: 2080, y: moon ? 1400 : 1400, r: 64, text: 34, above: true }],
    wheel: { x: 250, y: moon ? 1735 : 1710, r: 180 },
    spin: rect(470, 1640, 160, 150),
    dial: { x: 1910, y: moon ? 1735 : 1710, r: moon ? 160 : 180 },
    caption: { ...rect(40, 16 + top, 1000, 140), size: 58, lines: 2 },
    text: 46,
    strip: bank ? rect(0, 0, 2160, 18) : null,
    home: { x: 1500, y: 1780 },
  };
};

const wall = (moon: boolean, compare: boolean): Design => {
  const spaceX = compare ? 1690 : 0;
  const spaceW = 4070 - spaceX;
  const grounds: GroundBox[] = [{ rect: rect(4070, 0, 1690, 1245), place: 0 }];
  const places: Slider[] = [{ x0: 4295, x1: 5540, y: 1405, r: 71, text: 48, above: true }];
  if (compare) {
    // Sliders are in place order (Brisbane first), whatever side they are on.
    grounds.unshift({ rect: rect(0, 0, 1690, 1245), place: 1 });
    places.push({ x0: 220, x1: 1465, y: 1405, r: 71, text: 48, above: true });
  }
  return {
    ...empty,
    space: {
      rect: rect(spaceX, 0, spaceW, 2160),
      focus: rect(spaceX + (compare ? 0 : 355), 185, spaceW - (compare ? 0 : 710), 1085),
    },
    grounds,
    places,
    tilt: moon ? null : { x0: 1940, x1: 2960, y: 1405, r: 71, text: 48, above: true },
    resetTilt: moon ? null : rect(3040, 1340, 230, 135),
    flat: moon ? rect(1910, 1340, 410, 135) : null,
    speeds: moon ? row3(2380, 1340, 150, 135, 21) : [],
    wheel: { x: 2665, y: 1875, r: 250 },
    spin: rect(3040, 1795, 170, 160),
    dial: { x: 3670, y: 1475, r: 195 },
    caption: { ...rect(spaceX + 53, 36, spaceW - 105, 140), size: 100, lines: 1 },
    text: 62,
    home: { x: 3340, y: 1955 },
  };
};

const kiosk = (moon: boolean): Design => ({
  ...empty,
  space: { rect: rect(0, 90, 960, 640), focus: rect(0, 130, 960, 600) },
  grounds: [{ rect: rect(960, 90, 960, 640), place: 0 }],
  tilt: moon ? null : { x0: 540, x1: 900, y: 806, r: 60, text: 30, above: false },
  resetTilt: moon ? null : rect(960, 746, 170, 120),
  flat: moon ? rect(470, 746, 320, 120) : null,
  speeds: moon ? row3(810, 746, 120, 120, 14) : [],
  places: [{ x0: 640, x1: 1530, y: 1000, r: 60, text: 30, above: true }],
  wheel: { x: 165, y: 922, r: 148 },
  spin: rect(335, 930, 130, 130),
  dial: { x: 1760, y: 922, r: 148 },
  caption: { ...rect(20, 8, 1880, 80), size: 46, lines: 1 },
  text: 32,
  home: { x: 1210, y: 746 },
});

const screen = (bank: boolean): Design => ({
  ...empty,
  space: {
    rect: rect(0, 0, 4000, 3600),
    focus: bank ? rect(235, 355, 3530, 2680) : rect(235, 355, 3530, 3095),
  },
  caption: { ...rect(115, 65, 3770, 245), size: 140, lines: 1 },
  text: 103,
  bankStrip: bank ? rect(0, 3120, 4000, 480) : null,
  home: { x: 3705, y: 3280 },
});

const designFor = (i: LayoutInput): Design => {
  const moon = i.variant === "moon";
  switch (i.kind) {
    case "wall":
      return wall(moon, i.compare);
    case "pair":
      return pair(moon, i.bank);
    case "kiosk":
      return kiosk(moon);
    case "screen":
      return screen(i.bank);
    default:
      return panel(moon, i.bank);
  }
};

const moveRect = (r: Rect, dx: number, dy: number): Rect =>
  rect(r.x + dx, r.y + dy, r.width, r.height);

/** The layout for a frame: the kind's design, centred across it and kept to its bottom. */
export const layoutFor = (input: LayoutInput): Layout => {
  const d = designFor(input);
  const { width: vw, height: vh } = VENUE_SIZE[input.kind];
  const dx = (input.width - vw) / 2;
  const dy = input.height - vh;
  // Views stretch to fill a frame larger than the design; controls keep their size.
  const grow = (r: Rect): Rect =>
    rect(
      r.x + (r.x <= 0 ? 0 : dx),
      Math.max(0, r.y + Math.min(0, dy)),
      r.width + (r.x <= 0 && r.x + r.width >= vw ? input.width - vw : 0),
      r.height + Math.max(0, dy),
    );
  const mv = (r: Rect) => moveRect(r, dx, dy);
  const circle = (c: Circle | null) => (c ? { ...c, x: c.x + dx, y: c.y + dy } : null);
  const slider = (s: Slider): Slider => ({ ...s, x0: s.x0 + dx, x1: s.x1 + dx, y: s.y + dy });
  return {
    kind: input.kind,
    width: input.width,
    height: input.height,
    variant: input.variant,
    bank: input.bank,
    touch: input.kind !== "screen",
    space: d.space ? { rect: grow(d.space.rect), focus: mv(d.space.focus) } : null,
    grounds: d.grounds.map((g) => ({ rect: grow(g.rect), place: g.place })),
    groundTall: d.groundTall ? grow(d.groundTall) : null,
    wheel: circle(d.wheel),
    spin: d.spin ? mv(d.spin) : null,
    dial: circle(d.dial),
    tilt: d.tilt ? slider(d.tilt) : null,
    resetTilt: d.resetTilt ? mv(d.resetTilt) : null,
    places: d.places.map(slider),
    flat: d.flat ? mv(d.flat) : null,
    speeds: d.speeds.map(mv),
    caption: { ...d.caption, ...moveRect(d.caption, dx, Math.min(0, dy)) },
    text: d.text,
    strip: d.strip ? rect(0, 0, input.width, d.strip.height) : null,
    bankStrip: d.bankStrip ? rect(0, d.bankStrip.y + dy, input.width, d.bankStrip.height) : null,
    home: { x: d.home.x + dx, y: d.home.y + dy },
  };
};

// ---- Touch -----------------------------------------------------------------------------------

export type Hit =
  | { kind: "wheel" }
  | { kind: "dial" }
  | { kind: "tilt" }
  | { kind: "place"; index: number }
  | { kind: "space" };

/** Where a slider's knob is for a value between 0 and 1. */
export const sliderX = (s: Slider, u: number): number =>
  s.x0 + (s.x1 - s.x0) * Math.max(0, Math.min(1, u));

/** The value (0 to 1) along a slider at x. */
export const sliderU = (s: Slider, x: number): number =>
  Math.max(0, Math.min(1, (x - s.x0) / Math.max(1, s.x1 - s.x0)));

const onSlider = (s: Slider, x: number, y: number) =>
  x >= s.x0 - s.r && x <= s.x1 + s.r && Math.abs(y - s.y) <= s.r;

const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/**
 * What a finger at (x, y) takes hold of. Sliders take the whole track, so a touch anywhere on
 * it moves the knob there; the wheel and dial take their discs and a margin.
 */
export const hitAt = (l: Layout, x: number, y: number, spaceShown = true): Hit | null => {
  if (!l.touch) return null;
  if (l.wheel && Math.hypot(x - l.wheel.x, y - l.wheel.y) <= l.wheel.r + 24)
    return { kind: "wheel" };
  if (l.dial && Math.hypot(x - l.dial.x, y - l.dial.y) <= l.dial.r + 24) return { kind: "dial" };
  if (l.tilt && onSlider(l.tilt, x, y)) return { kind: "tilt" };
  const p = l.places.findIndex((s) => onSlider(s, x, y));
  if (p >= 0) return { kind: "place", index: p };
  if (spaceShown && l.space && inRect(l.space.rect, x, y)) return { kind: "space" };
  return null;
};

/** The rectangles of every touch target, for checks. */
export const targets = (l: Layout): { name: string; rect: Rect }[] => {
  const out: { name: string; rect: Rect }[] = [];
  const c = (name: string, k: Circle | null) => {
    if (k) out.push({ name, rect: rect(k.x - k.r, k.y - k.r, 2 * k.r, 2 * k.r) });
  };
  c("wheel", l.wheel);
  c("dial", l.dial);
  if (l.spin) out.push({ name: "spin", rect: l.spin });
  if (l.resetTilt) out.push({ name: "resetTilt", rect: l.resetTilt });
  if (l.flat) out.push({ name: "flat", rect: l.flat });
  l.speeds.forEach((r, i) => out.push({ name: `speed${i}`, rect: r }));
  const s = (name: string, k: Slider | null) => {
    if (k) out.push({ name, rect: rect(k.x0 - k.r, k.y - k.r, k.x1 - k.x0 + 2 * k.r, 2 * k.r) });
  };
  s("tilt", l.tilt);
  l.places.forEach((p, i) => s(`place${i}`, p));
  return out;
};
