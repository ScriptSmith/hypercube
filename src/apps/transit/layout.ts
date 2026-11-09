/**
 * Where things go on each frame kind, in venue px.
 *
 * - Wall: the map fills it. Two consoles (one on a narrower wall) sit low: route buttons in the
 *   adult band and the three mode buttons below them in the child band, with a column of zoom
 *   buttons on the side facing the middle. Visitors drag the map anywhere off the consoles, and
 *   tap vehicles on the open map within reach.
 * - Kiosk: the map above a strip of mode buttons, then route buttons; zoom buttons on the map's
 *   right edge.
 * - Screen: the map alone.
 */
import type { FrameKind } from "../../core/types";
import { FEATURED, MODES, type Mode } from "./routes";
import type { Padding } from "./views";

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
}

export type ZoomAction = "reset" | "in" | "out";
/** Top to bottom: zooming in and out stay lowest, within children's reach on the wall. */
export const ZOOMS: readonly ZoomAction[] = ["reset", "in", "out"];

export interface TransitLayout {
  map: Box;
  /** Dark backing behind each console's buttons. */
  panels: Box[];
  modes: { mode: Mode; box: Box }[];
  lines: { line: string; box: Box }[];
  zooms: { action: ZoomAction; box: Box }[];
  /** The attribution's anchor point (its bottom edge) and text size. */
  attribution: { x: number; y: number; size: number; align: "right" | "center" };
  /** Taps above this y are out of reach and ignored. */
  tapTop: number;
  /** Drags and pinches start only below this y. */
  dragTop: number;
  /** Camera padding inside the map box. */
  pad: Padding;
  /** Venue px a finger moves before a touch is a drag, and the reach of a pinch's second finger. */
  slop: number;
  pinch: number;
  /** Size factors for this kind: vehicle glyphs, the vehicle card, map text and lines. */
  glyph: number;
  card: number;
  text: number;
}

export const WALL = {
  lineW: 250,
  lineH: 190,
  minLineH: 160,
  gap: 28,
  cols: 4,
  mode: 280,
  minMode: 160,
  modeGap: 64,
  margin: 36,
  zoom: 180,
  minZoom: 160,
  zoomGap: 30,
  zoomSide: 44,
  slop: 12,
  pinch: 200,
} as const;

/** Share of a wall's width kept as open map between its two consoles, at least. */
const OPEN = 0.42;

export const KIOSK = {
  strip: 260,
  mode: 170,
  modeGap: 18,
  lineGap: 14,
  edge: 32,
  split: 44,
  zoom: 120,
  zoomGap: 16,
  zoomEdge: 24,
  slop: 30,
  pinch: 600,
} as const;

export const layoutFor = (input: LayoutInput): TransitLayout => {
  if (input.kind === "screen") return screenLayout(input);
  if (input.kind === "wall" || input.width >= 3000) return wallLayout(input);
  return kioskLayout(input);
};

const screenLayout = ({ width, height }: LayoutInput): TransitLayout => ({
  map: { x: 0, y: 0, w: width, h: height },
  panels: [],
  modes: [],
  lines: [],
  zooms: [],
  attribution: { x: width - 40, y: height - 30, size: 34, align: "right" },
  tapTop: height,
  dragTop: height,
  pad: { top: 60, right: 60, bottom: 60, left: 60 },
  slop: 0,
  pinch: 0,
  glyph: 2.2,
  card: 1.6,
  text: 2.3,
});

const wallLayout = ({ width, height, reachTop }: LayoutInput): TransitLayout => {
  const adultTop = Math.max(0, Math.min(height - 300, reachTop.adult));
  const childTop = Math.max(adultTop + 200, Math.min(height - 180, reachTop.child));
  const lines = FEATURED.map((l) => l.id);
  const rows = Math.ceil(lines.length / WALL.cols);
  const band = childTop - adultTop;
  const lineH = Math.max(
    WALL.minLineH,
    Math.min(WALL.lineH, (band - WALL.gap * (rows - 1) - 2 * 20) / rows),
  );
  const gridW = WALL.cols * WALL.lineW + (WALL.cols - 1) * WALL.gap;
  const gridH = rows * lineH + (rows - 1) * WALL.gap;
  const childBand = height - childTop;
  const mode = Math.max(WALL.minMode, Math.min(WALL.mode, childBand - 2 * 36));
  const consoles = width >= 4200 ? [0.17, 0.83] : [0.2];
  const out: TransitLayout = {
    map: { x: 0, y: 0, w: width, h: height },
    panels: [],
    modes: [],
    lines: [],
    zooms: [],
    attribution: { x: width / 2, y: height - 20, size: 26, align: "center" },
    tapTop: adultTop,
    dragTop: 0,
    pad: { top: 80, right: 80, bottom: Math.round((height - adultTop) * 0.45), left: 80 },
    slop: WALL.slop,
    pinch: WALL.pinch,
    glyph: 1.8,
    card: 1.6,
    text: 1.9,
  };
  const gridTop = adultTop + Math.max(16, (band - gridH) / 2);
  const modesW = MODES.length * mode + (MODES.length - 1) * WALL.modeGap;
  const my = childTop + (childBand - mode) / 2;
  const contentW = Math.max(gridW, modesW);
  const foot = my + mode;
  const zoom = Math.max(
    WALL.minZoom,
    Math.min(WALL.zoom, (foot - gridTop - (ZOOMS.length - 1) * WALL.zoomGap) / ZOOMS.length),
  );
  const colH = ZOOMS.length * zoom + (ZOOMS.length - 1) * WALL.zoomGap;
  // Two consoles stand near the ends, but never so far in that less than OPEN of the wall is
  // left as open map between them.
  const inner = contentW / 2 + WALL.zoomSide + zoom + WALL.margin;
  const nearEnd = Math.max(
    contentW / 2 + 2 * WALL.margin,
    Math.min(width * consoles[0]!, (width * (1 - OPEN)) / 2 - inner),
  );
  for (const f of consoles) {
    const cx = Math.round(consoles.length === 1 ? width * f : f < 0.5 ? nearEnd : width - nearEnd);
    const x0 = cx - gridW / 2;
    lines.forEach((line, i) => {
      const row = Math.floor(i / WALL.cols);
      const inRow = Math.min(WALL.cols, lines.length - row * WALL.cols);
      // Centre a short last row.
      const rowX = x0 + ((WALL.cols - inRow) * (WALL.lineW + WALL.gap)) / 2;
      const col = i % WALL.cols;
      out.lines.push({
        line,
        box: {
          x: rowX + col * (WALL.lineW + WALL.gap),
          y: gridTop + row * (lineH + WALL.gap),
          w: WALL.lineW,
          h: lineH,
        },
      });
    });
    MODES.forEach((m, i) => {
      out.modes.push({
        mode: m,
        box: { x: cx - modesW / 2 + i * (mode + WALL.modeGap), y: my, w: mode, h: mode },
      });
    });
    // Zoom buttons in a column on the side facing the middle, level with the mode buttons' foot.
    const right = cx < width / 2;
    const zx = right ? cx + contentW / 2 + WALL.zoomSide : cx - contentW / 2 - WALL.zoomSide - zoom;
    ZOOMS.forEach((action, i) => {
      out.zooms.push({
        action,
        box: { x: zx, y: foot - colH + i * (zoom + WALL.zoomGap), w: zoom, h: zoom },
      });
    });
    const x0p = Math.min(cx - contentW / 2, zx) - WALL.margin;
    const x1p = Math.max(cx + contentW / 2, zx + zoom) + WALL.margin;
    const y0p = Math.min(gridTop, foot - colH) - WALL.margin;
    out.panels.push({ x: x0p, y: y0p, w: x1p - x0p, h: height - y0p - 18 });
  }
  return out;
};

const kioskLayout = ({ width, height }: LayoutInput): TransitLayout => {
  const strip = Math.min(KIOSK.strip, Math.round(height * 0.3));
  const mapH = height - strip;
  const mode = Math.min(KIOSK.mode, strip - 50);
  const out: TransitLayout = {
    map: { x: 0, y: 0, w: width, h: mapH },
    panels: [{ x: 0, y: mapH, w: width, h: strip }],
    modes: [],
    lines: [],
    zooms: [],
    attribution: { x: width - 18, y: mapH - 10, size: 17, align: "right" },
    tapTop: 0,
    dragTop: 0,
    pad: { top: 24, right: 24 + KIOSK.zoom + KIOSK.zoomEdge, bottom: 24, left: 24 },
    slop: KIOSK.slop,
    pinch: KIOSK.pinch,
    glyph: 1,
    card: 1,
    text: 1.1,
  };
  MODES.forEach((m, i) => {
    out.modes.push({
      mode: m,
      box: {
        x: KIOSK.edge + i * (mode + KIOSK.modeGap),
        y: mapH + (strip - mode) / 2,
        w: mode,
        h: mode,
      },
    });
  });
  const colH = ZOOMS.length * KIOSK.zoom + (ZOOMS.length - 1) * KIOSK.zoomGap;
  ZOOMS.forEach((action, i) => {
    out.zooms.push({
      action,
      box: {
        x: width - KIOSK.zoomEdge - KIOSK.zoom,
        y: (mapH - colH) / 2 + i * (KIOSK.zoom + KIOSK.zoomGap),
        w: KIOSK.zoom,
        h: KIOSK.zoom,
      },
    });
  });
  const lines = FEATURED.map((l) => l.id);
  const x0 = KIOSK.edge + MODES.length * mode + (MODES.length - 1) * KIOSK.modeGap + KIOSK.split;
  const avail = width - KIOSK.edge - x0;
  const w = Math.floor((avail - (lines.length - 1) * KIOSK.lineGap) / lines.length);
  const h = Math.min(strip - 60, Math.round(w * 1.05));
  lines.forEach((line, i) => {
    out.lines.push({
      line,
      box: { x: x0 + i * (w + KIOSK.lineGap), y: mapH + (strip - h) / 2, w, h },
    });
  });
  return out;
};

/**
 * The widest stretch of reachable map clear of consoles and zoom buttons, in venue px: where a
 * bot drags the map.
 */
export const openArea = (l: TransitLayout): Box | null => {
  const top = Math.max(l.map.y, l.tapTop);
  const bottom = l.map.y + l.map.h;
  if (bottom - top < 1) return null;
  const blocks = [...l.panels, ...l.zooms.map((z) => z.box)]
    .filter((b) => b.y < bottom && b.y + b.h > top)
    .map((b) => [b.x, b.x + b.w] as const)
    .sort((a, b) => a[0] - b[0]);
  let best: Box | null = null;
  let x = l.map.x;
  const consider = (x1: number) => {
    if (x1 - x > (best?.w ?? 0)) best = { x, y: top, w: x1 - x, h: bottom - top };
  };
  for (const [b0, b1] of blocks) {
    consider(Math.min(b0, l.map.x + l.map.w));
    x = Math.max(x, b1);
  }
  consider(l.map.x + l.map.w);
  return best;
};
