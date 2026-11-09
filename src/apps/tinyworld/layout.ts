import type { FrameKind, Reach } from "../../core/types";
import { type Box, contains } from "./config";
import type { PaletteSpec, SwatchDef } from "./swatches";

/**
 * The palette widgets: floating, translucent panels that players can move and resize. Each has
 * a bar on top (move grip, hold-to-reset, resize corner), an optional danger row (fire, lava,
 * acid) held above children's reach, page tabs, and a grid for the current page. Only the
 * controls take touches; a touch in a gap goes through to the world.
 *
 * All lengths are venue px with the origin at the top left of the world. A widget is anchored
 * at a bottom corner (left or right), so resizing grows it up and away from that corner.
 */
export interface WidgetSpec {
  palette: PaletteSpec;
  cols: number;
  /** Base swatch size at scale 1. */
  size: number;
}

export interface WidgetState {
  /** The anchored edge: left edge, or right edge when `fromRight`. */
  x: number;
  /** Bottom edge. */
  bottom: number;
  scale: number;
  page: number;
  fromRight: boolean;
}

/** Where a widget may go. */
export interface WidgetRoom {
  minX: number;
  maxX: number;
  /** Highest point it may reach (top of adult reach). */
  top: number;
  bottom: number;
  /** Danger swatches keep their centres above this line (top of children's reach). */
  childTop: number;
}

export type Part =
  | { type: "swatch"; swatch: SwatchDef; box: Box }
  | { type: "tab"; page: number; box: Box }
  | { type: "move"; box: Box }
  | { type: "resize"; box: Box };

export interface WidgetLayout {
  /** The whole widget in world venue px. */
  box: Box;
  scale: number;
  /**
   * Unscaled size, for the DOM, which scales the whole panel with a transform; and the local y
   * range of the spacer that lifts the danger row (empty: the panel is drawn as two cards).
   */
  base: { width: number; height: number; spacer: number; gapTop: number; gapBottom: number };
  /** Every touchable part the app hit-tests, in world venue px. */
  parts: Part[];
  /** The hold-to-reset control, a DOM button that takes its own touches. */
  reset: Box;
  /** Swatch boxes for the current page and the danger row. */
  swatches: { swatch: SwatchDef; box: Box }[];
}

/** Smallest swatch in venue px: the platform's minimum touch target, so palettes can shrink. */
export const MIN_SWATCH = 120;
/** Smallest control (tabs, bar) in venue px. */
export const MIN_CONTROL = 120;
const PAD = 18;
const GAP = 16;
const MAX_SCALE = 1.6;

export const swatchSize = (kind: FrameKind): number => (kind === "wall" ? 176 : 168);
export const columnsFor = (kind: FrameKind): number =>
  kind === "pair" || kind === "kiosk" ? 3 : 4;

/** Rows of the page grid: enough for the fullest page, so switching pages never resizes. */
export const gridRows = (spec: WidgetSpec): number =>
  Math.max(1, ...spec.palette.pages.map((p) => Math.ceil(p.swatches.length / spec.cols)));

/**
 * Unscaled metrics shared by the layout and the DOM. The bar and tabs grow in local units as the
 * widget shrinks, so on screen they never drop below MIN_CONTROL.
 */
export const metrics = (spec: WidgetSpec, scale = 1) => {
  const S = spec.size;
  const bar = Math.max(MIN_CONTROL / scale, 0.75 * S);
  const tab = Math.max(MIN_CONTROL / scale, 0.75 * S);
  const width = spec.cols * S + (spec.cols - 1) * GAP + 2 * PAD;
  const rows = gridRows(spec);
  const grid = rows * S + (rows - 1) * GAP;
  const danger = spec.palette.danger.length > 0 ? S + GAP : 0;
  const tabs = spec.palette.pages.length > 1 ? tab + GAP : 0;
  return {
    S,
    bar,
    tab,
    width,
    rows,
    grid,
    danger,
    tabs,
    height: PAD + bar + GAP + danger + tabs + grid + PAD,
  };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The smallest scale that keeps swatches at least MIN_SWATCH. */
export const minScale = (spec: WidgetSpec): number => Math.max(0.5, MIN_SWATCH / spec.size);

/**
 * Lay a widget out in its room, clamping its state (position and scale) so it stays inside. The
 * returned state is the clamped one; callers keep it.
 */
export const layoutWidget = (
  spec: WidgetSpec,
  state: WidgetState,
  room: WidgetRoom,
): { layout: WidgetLayout; state: WidgetState } => {
  const available = room.bottom - room.top;
  const roomWidth = room.maxX - room.minX;
  let s = clamp(state.scale, minScale(spec), MAX_SCALE);
  let m = metrics(spec, s);
  let spacer = 0;
  let bottom = state.bottom;
  let x = state.x;
  for (let pass = 0; pass < 3; pass++) {
    // Scale down if the room can't hold it, then keep it inside.
    s = Math.max(minScale(spec), Math.min(s, available / (m.height + spacer), roomWidth / m.width));
    m = metrics(spec, s);
    const w = m.width * s;
    bottom = clamp(bottom, room.top + (m.height + spacer) * s, room.bottom);
    x = state.fromRight ? clamp(x, room.minX + w, room.maxX) : clamp(x, room.minX, room.maxX - w);
    if (m.danger === 0) break;
    // Lift the danger row until its centre is above children's reach.
    const fromBottom = (PAD + m.grid + m.tabs + m.S / 2) * s;
    const need = bottom - fromBottom - (room.childTop - 4);
    spacer = Math.max(0, need / s);
  }
  const h = (m.height + spacer) * s;
  const w = m.width * s;
  const left = state.fromRight ? x - w : x;
  const top = bottom - h;
  // Local unscaled coordinates to world boxes.
  const at = (lx: number, ly: number, lw: number, lh: number): Box => ({
    x: left + lx * s,
    y: top + ly * s,
    width: lw * s,
    height: lh * s,
  });

  const parts: Part[] = [];
  const swatches: { swatch: SwatchDef; box: Box }[] = [];
  const inner = m.width - 2 * PAD;
  // Bar: reset at the anchored end, resize at the far end, the grip between them.
  const resizeX = state.fromRight ? PAD : m.width - PAD - m.bar;
  const resetX = state.fromRight ? m.width - PAD - m.bar : PAD;
  const reset = at(resetX, PAD, m.bar, m.bar);
  parts.push({ type: "resize", box: at(resizeX, PAD, m.bar, m.bar) });
  parts.push({ type: "move", box: at(PAD + m.bar + GAP, PAD, inner - 2 * (m.bar + GAP), m.bar) });

  // From the top: bar, danger row, then the spacer that holds the danger row above children's
  // reach, then tabs and the page grid at the bottom.
  let y = PAD + m.bar + GAP;
  if (m.danger > 0) {
    const n = spec.palette.danger.length;
    const rowW = n * m.S + (n - 1) * GAP;
    spec.palette.danger.forEach((sw, i) => {
      const box = at(PAD + (inner - rowW) / 2 + i * (m.S + GAP), y, m.S, m.S);
      parts.push({ type: "swatch", swatch: sw, box });
      swatches.push({ swatch: sw, box });
    });
  }
  y += m.danger + spacer;
  const pages = spec.palette.pages;
  const page = clamp(Math.round(state.page), 0, pages.length - 1);
  if (m.tabs > 0) {
    const tw = (inner - (pages.length - 1) * GAP) / pages.length;
    pages.forEach((_, i) => {
      parts.push({ type: "tab", page: i, box: at(PAD + i * (tw + GAP), y, tw, m.tab) });
    });
    y += m.tabs;
  }
  const items = pages[page]?.swatches ?? [];
  items.forEach((sw, i) => {
    const row = Math.floor(i / spec.cols);
    const col = i % spec.cols;
    const box = at(PAD + col * (m.S + GAP), y + row * (m.S + GAP), m.S, m.S);
    parts.push({ type: "swatch", swatch: sw, box });
    swatches.push({ swatch: sw, box });
  });

  return {
    layout: {
      box: { x: left, y: top, width: w, height: h },
      scale: s,
      base: {
        width: m.width,
        height: m.height + spacer,
        spacer,
        gapTop: PAD + m.bar + GAP + m.danger - GAP / 2,
        gapBottom: PAD + m.bar + GAP + m.danger + spacer - GAP / 2,
      },
      parts,
      reset,
      swatches,
    },
    state: { ...state, x, bottom, scale: s, page },
  };
};

/** The part of a widget under (x, y), or null for a gap (which belongs to the world). */
export const hitWidget = (layout: WidgetLayout, x: number, y: number): Part | null => {
  if (!contains(layout.box, x, y)) return null;
  for (const p of layout.parts) if (contains(p.box, x, y)) return p;
  return null;
};

/**
 * Resize by dragging the far top corner. The scale grows with the finger's distance from the
 * anchored corner, relative to where the drag began, so the widget never jumps on the first move.
 */
export const resizeTo = (
  spec: WidgetSpec,
  state: WidgetState,
  from: { scale: number; x: number; y: number },
  fx: number,
  fy: number,
): WidgetState => {
  const reach = (x: number, y: number) =>
    Math.max(1, (state.fromRight ? state.x - x : x - state.x) + (state.bottom - y));
  const ratio = reach(fx, fy) / reach(from.x, from.y);
  return { ...state, scale: Math.max(minScale(spec), from.scale * ratio) };
};

/**
 * The square kept for the runtime's Home control (shown when a visitor launched this app), in
 * venue px: the middle of a wall at the top of the reach band, between the two palettes, or the
 * top right of a panel or pair. No palette may move or grow into it.
 */
export const homeReserve = (
  kind: FrameKind,
  world: { width: number; height: number },
  reach: Reach,
): Box | null => {
  const top = Math.max(0, world.height * (1 - reach.adult)) + 28;
  if (kind === "wall") return { x: world.width / 2 - 80, y: top, width: 160, height: 160 };
  if (kind === "screen") return null;
  return { x: world.width - 28 - 120, y: top, width: 120, height: 120 };
};

/** Default widgets and their rooms for a frame kind. */
export const homeWidgets = (
  kind: FrameKind,
  world: { width: number; height: number },
  reach: Reach,
  spec: WidgetSpec,
): { state: WidgetState; room: WidgetRoom }[] => {
  const W = world.width;
  const H = world.height;
  const margin = 20;
  const top = Math.max(0, H * (1 - reach.adult));
  const childTop = H * (1 - reach.child);
  const reserve = homeReserve(kind, world, reach);
  const room = (minX: number, maxX: number): WidgetRoom => {
    // A room under the Home square starts below it.
    const under =
      reserve && kind !== "wall" && reserve.x < maxX && reserve.x + reserve.width > minX;
    return {
      minX,
      maxX,
      top: under ? Math.max(top, reserve.y + reserve.height + margin) : top,
      bottom: H - margin,
      childTop,
    };
  };
  const home = (x: number, fromRight: boolean) => ({
    x,
    bottom: H - margin,
    scale: 1,
    page: 0,
    fromRight,
  });
  switch (kind) {
    case "wall":
      // The Home square sits between the two halves' rooms.
      return [
        { state: home(margin, false), room: room(margin, W / 2 - 80 - margin) },
        { state: home(W - margin, true), room: room(W / 2 + 80 + margin, W - margin) },
      ];
    case "pair":
    case "kiosk": {
      // Keep each palette a tenth of the width clear of the seam.
      const seam = W / 2;
      const clear = W * 0.1;
      return [
        { state: home(margin, false), room: room(margin, seam - clear) },
        { state: home(W - margin, true), room: room(seam + clear, W - margin) },
      ];
    }
    case "panel": {
      const w = metrics(spec).width;
      return [{ state: home((W - w) / 2, false), room: room(margin, W - margin) }];
    }
    case "screen":
    case "sphere":
      return [];
  }
};

/** Which widget's side a position is on: the one whose centre is nearest across. */
export const nearestWidget = (layouts: readonly WidgetLayout[], x: number): number => {
  let best = 0;
  let bestD = Infinity;
  layouts.forEach((l, i) => {
    const d = Math.abs(l.box.x + l.box.width / 2 - x);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
};
