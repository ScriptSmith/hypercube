import type { FrameKind, Rect } from "../../core/types";

/** The parts of `FrameInfo` the layout needs, in stage px (`unit` is stage px per venue px). */
export interface MenuFrame {
  kind: FrameKind;
  width: number;
  height: number;
  unit: number;
  reachTop: { adult: number; child: number };
  seams: readonly number[];
}

export interface TitleSpot {
  /** Centre of the text. */
  x: number;
  y: number;
  /** Widest the text may run before it wraps. */
  width: number;
  size: number;
}

export interface MenuLayout {
  /** One title per panel on a pair, so no words sit across a seam. */
  titles: TitleSpot[];
  /** Tile spots for a full page, most reachable first. */
  slots: Rect[];
  /** Row of each slot (0 is filled first) and columns per row. */
  rowOf: number[];
  cols: number;
  rows: number;
  /** How far a short page's rows move down for each row it leaves empty (0 keeps them put). */
  rowShift: number;
  perPage: number;
  /** Height of the picture at the top of each tile; the rest holds the title. */
  imageHeight: number;
  labelSize: number;
  /** Partly filled rows are centred, except where centring would put a tile on a seam. */
  centre: boolean;
  /** Page arrows, present only when the apps don't fit on one page. */
  prev: Rect | null;
  next: Rect | null;
  /** Page dots, one row per panel on a pair. */
  dots: { x: number; y: number; size: number }[];
  radius: number;
}

/** 16:10, the shape of the gallery thumbnails. */
const IMAGE_ASPECT = 10 / 16;

export const pageCount = (count: number, perPage: number): number =>
  Math.max(1, Math.ceil(count / Math.max(1, perPage)));

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

/** Rows of a grid laid from the bottom up, so the first apps land lowest, where children reach. */
const bottomUpGrid = (
  colX: readonly number[],
  tileW: number,
  tileH: number,
  rows: number,
  bottom: number,
  gap: number,
) => {
  const slots: Rect[] = [];
  const rowOf: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = bottom - (r + 1) * tileH - r * gap;
    for (const x of colX) {
      slots.push(rect(x, y, tileW, tileH));
      rowOf.push(r);
    }
  }
  return { slots, rowOf };
};

const panelLayout = (f: MenuFrame, count: number): MenuLayout => {
  const u = f.unit;
  const { width: W, height: H } = f;
  const margin = 56 * u;
  const gap = 44 * u;
  const arrow = 170 * u;
  const cols = 2;
  const rows = 2;
  const tileW = (W - 2 * margin - gap) / cols;
  const imageHeight = tileW * IMAGE_ASPECT;
  const tileH = imageHeight + 150 * u;
  const paging = count > cols * rows;
  const bottom = paging ? H - margin - arrow - gap : H - margin;
  const colX = [margin, margin + tileW + gap];
  const grid = bottomUpGrid(colX, tileW, tileH, rows, bottom, gap);
  const top = bottom - rows * tileH - (rows - 1) * gap;
  const arrowY = H - margin - arrow;
  return {
    titles: [{ x: W / 2, y: top * 0.55, width: W - 2 * margin, size: 104 * u }],
    ...grid,
    cols,
    rows,
    rowShift: 0,
    perPage: cols * rows,
    imageHeight,
    labelSize: 60 * u,
    centre: true,
    prev: paging ? rect(margin, arrowY, arrow, arrow) : null,
    next: paging ? rect(W - margin - arrow, arrowY, arrow, arrow) : null,
    dots: paging ? [{ x: W / 2, y: arrowY + arrow / 2, size: 24 * u }] : [],
    radius: 32 * u,
  };
};

/**
 * One column per panel. Each keeps a fifth of a panel clear on its side of every seam, so two
 * hands on neighbouring columns are never close enough across a seam for touches to drop.
 */
const pairLayout = (f: MenuFrame, count: number): MenuLayout => {
  const u = f.unit;
  const { width: W, height: H } = f;
  const panels = Math.max(2, f.seams.length + 1);
  const panelW = W / panels;
  const margin = 64 * u;
  const clear = panelW * 0.2;
  const gap = 48 * u;
  const arrow = 180 * u;
  const rows = 2;
  const ranges = Array.from({ length: panels }, (_, i) => ({
    left: i * panelW + (i === 0 ? margin : clear),
    right: (i + 1) * panelW - (i === panels - 1 ? margin : clear),
  }));
  const usable = Math.min(...ranges.map((r) => r.right - r.left));
  const tileW = Math.min(640 * u, usable);
  const imageHeight = tileW * IMAGE_ASPECT;
  const tileH = imageHeight + 160 * u;
  const paging = count > panels * rows;
  const bottom = paging ? H - margin - arrow - gap : H - margin;
  const colX = ranges.map((r) => (r.left + r.right) / 2 - tileW / 2);
  const grid = bottomUpGrid(colX, tileW, tileH, rows, bottom, gap);
  const top = bottom - rows * tileH - (rows - 1) * gap;
  const arrowY = H - margin - arrow;
  return {
    titles: ranges.map((r) => ({
      x: (r.left + r.right) / 2,
      y: top * 0.55,
      width: r.right - r.left,
      size: 96 * u,
    })),
    ...grid,
    cols: panels,
    rows,
    rowShift: 0,
    perPage: panels * rows,
    imageHeight,
    labelSize: 64 * u,
    centre: false,
    prev: paging ? rect(margin, arrowY, arrow, arrow) : null,
    next: paging ? rect(W - margin - arrow, arrowY, arrow, arrow) : null,
    dots: paging
      ? ranges.map((r) => ({ x: (r.left + r.right) / 2, y: arrowY + arrow / 2, size: 26 * u }))
      : [],
    radius: 36 * u,
  };
};

/** One row of tiles inside the reachable band; the tall space above is for the title. */
const wallLayout = (f: MenuFrame, count: number): MenuLayout => {
  const u = f.unit;
  const { width: W, height: H } = f;
  const margin = 100 * u;
  const below = 70 * u;
  const gap = 110 * u;
  const arrow = 300 * u;
  const arrowGap = 90 * u;
  const labelH = 170 * u;
  const bandTop = Math.min(Math.max(0, f.reachTop.adult), H);
  const tileH = Math.max(420 * u, Math.min(800 * u, H - bandTop - below - 60 * u));
  const imageHeight = tileH - labelH;
  const tileW = imageHeight / IMAGE_ASPECT;
  const fit = (room: number) => Math.max(1, Math.floor((room + gap) / (tileW + gap) + 1e-6));
  const paging = count > fit(W - 2 * margin);
  const cols = paging ? fit(W - 2 * (margin + arrow + arrowGap)) : fit(W - 2 * margin);
  const rowW = cols * tileW + (cols - 1) * gap;
  const y = H - below - tileH;
  const slots = Array.from({ length: cols }, (_, i) =>
    rect((W - rowW) / 2 + i * (tileW + gap), y, tileW, tileH),
  );
  const arrowY = y + tileH / 2 - arrow / 2;
  return {
    titles: [{ x: W / 2, y: Math.max(0, y - 60 * u) * 0.5, width: W - 2 * margin, size: 280 * u }],
    slots,
    rowOf: slots.map(() => 0),
    cols,
    rows: 1,
    rowShift: 0,
    perPage: cols,
    imageHeight,
    labelSize: 96 * u,
    centre: true,
    prev: paging ? rect(margin, arrowY, arrow, arrow) : null,
    next: paging ? rect(W - margin - arrow, arrowY, arrow, arrow) : null,
    dots: paging ? [{ x: W / 2, y: y - 70 * u, size: 44 * u }] : [],
    radius: 48 * u,
  };
};

/** A grid with the arrows at the sides. Everything on a kiosk is within everyone's reach. */
const kioskLayout = (f: MenuFrame, count: number): MenuLayout => {
  const u = f.unit;
  const { width: W, height: H } = f;
  const margin = 40 * u;
  const gap = 36 * u;
  const arrow = 150 * u;
  const titleBand = 150 * u;
  const cols = 3;
  const rows = 2;
  const labelH = 104 * u;
  const paging = count > cols * rows;
  const side = paging ? margin + arrow + gap : margin;
  const gridTop = titleBand;
  const gridBottom = H - 80 * u;
  const byHeight = ((gridBottom - gridTop - (rows - 1) * gap) / rows - labelH) / IMAGE_ASPECT;
  const byWidth = (W - 2 * side - (cols - 1) * gap) / cols;
  const tileW = Math.min(byHeight, byWidth);
  const imageHeight = tileW * IMAGE_ASPECT;
  const tileH = imageHeight + labelH;
  const gridW = cols * tileW + (cols - 1) * gap;
  const gridH = rows * tileH + (rows - 1) * gap;
  const x0 = (W - gridW) / 2;
  const y0 = gridTop + (gridBottom - gridTop - gridH) / 2;
  const slots: Rect[] = [];
  const rowOf: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push(rect(x0 + c * (tileW + gap), y0 + r * (tileH + gap), tileW, tileH));
      rowOf.push(r);
    }
  }
  const arrowY = y0 + gridH / 2 - arrow / 2;
  return {
    titles: [{ x: W / 2, y: titleBand * 0.55, width: W - 2 * margin, size: 88 * u }],
    slots,
    rowOf,
    cols,
    rows,
    rowShift: (tileH + gap) / 2,
    perPage: cols * rows,
    imageHeight,
    labelSize: 58 * u,
    centre: true,
    prev: paging ? rect(margin, arrowY, arrow, arrow) : null,
    next: paging ? rect(W - margin - arrow, arrowY, arrow, arrow) : null,
    dots: paging ? [{ x: W / 2, y: (y0 + gridH + H) / 2, size: 20 * u }] : [],
    radius: 26 * u,
  };
};

/** Where everything goes for `count` apps on this frame. */
export const layoutMenu = (f: MenuFrame, count: number): MenuLayout => {
  switch (f.kind) {
    case "panel":
      return panelLayout(f, count);
    case "pair":
      return pairLayout(f, count);
    case "wall":
      return wallLayout(f, count);
    case "kiosk":
    case "screen":
    case "sphere":
      return kioskLayout(f, count);
  }
};

/**
 * Spots for the `n` tiles of one page, in app order. A short page spreads its tiles evenly over
 * the rows it needs, fuller rows first, and centres each row unless the layout forbids it.
 */
export const pageTiles = (layout: MenuLayout, n: number): Rect[] => {
  const count = Math.max(0, Math.min(n, layout.perPage));
  if (count === layout.perPage || !layout.centre) return layout.slots.slice(0, count);
  const rows: Rect[][] = [];
  layout.slots.forEach((s, i) => {
    const r = layout.rowOf[i] ?? 0;
    (rows[r] ??= []).push(s);
  });
  const used = Math.ceil(count / layout.cols);
  const dy = (layout.rows - used) * layout.rowShift;
  const out: Rect[] = [];
  for (let r = 0; r < used; r++) {
    const row = rows[r] ?? [];
    const k = Math.floor(count / used) + (r < count % used ? 1 : 0);
    const first = row[0];
    const last = row[row.length - 1];
    if (!first || !last) continue;
    const step = row.length > 1 ? (row[1]?.x ?? first.x) - first.x : 0;
    const span = (k - 1) * step + first.width;
    const x0 = (first.x + last.x + last.width) / 2 - span / 2;
    for (let i = 0; i < k; i++) out.push({ ...first, x: x0 + i * step, y: first.y + dy });
  }
  return out;
};
