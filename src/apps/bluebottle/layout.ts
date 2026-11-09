/**
 * Where everything goes on a frame, in venue px (origin top left). The beach is a grid of
 * square cells of at least CELL px along the bottom of the frame, inside the reachable band;
 * the sky above it holds the sea, the lifeguard tower, the progress and the wash control.
 * Cell edges fall on every seam, so no cell straddles a bezel.
 */
import type { FrameKind, Reach } from "../../core/types";
import { CELL } from "./config";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TouchLayout {
  kind: FrameKind;
  W: number;
  H: number;
  cell: number;
  cols: number;
  rows: number;
  beach: Box;
  /** Rows, counted up from the bottom, in the child band. */
  kid: number;
  /** y of the horizon, the top of the foam and the top of the wet sand. */
  horizon: number;
  shore: number;
  /** Lifeguard tower: its feet stand on the bottom edge of this box. */
  tower: Box;
  progress: Box;
  /** Flags left: an icon and the number. */
  flags: Box;
  /** A row of small flags, one per patch cleared today. */
  today: Box;
  /** The whole patch in miniature, on bank frames. */
  map: Box | null;
  /** The banner when a patch clears. */
  banner: Box;
  wash: Box[];
  home: Box | null;
}

/** Sky band above a panel's beach, at least. */
export const SKY_MIN = 400;
const MARGIN = 36;
export const WASH_SIZE = 150;
/** On a wall the wash control sits above the beach, so this much of the adult band is kept. */
const WASH_REACH = 60;

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/** Rows whose centres sit inside the child band. */
export const kidRows = (H: number, top: number, cell: number, rows: number, reach: Reach) => {
  const childTop = H * (1 - Math.min(1, Math.max(0, reach.child)));
  let n = 0;
  for (let r = rows - 1; r >= 0; r--) {
    if (top + (r + 0.5) * cell >= childTop) n++;
    else break;
  }
  return n;
};

export const touchLayout = (
  kind: FrameKind,
  venue: { width: number; height: number },
  reach: Reach,
  bank: boolean,
): TouchLayout => {
  const W = venue.width;
  const H = venue.height;
  const cols = Math.max(1, Math.floor(W / CELL));
  // Cells grow to fill the width exactly, so a panel's 1080 px are 8 cells of 135.
  const cell = W / cols;
  const wall = kind === "wall";
  const reachH = H * Math.min(1, Math.max(0.2, reach.adult));
  const rows = Math.max(
    3,
    wall
      ? Math.floor((reachH - WASH_REACH) / cell)
      : Math.floor((Math.min(H, reachH) - SKY_MIN) / cell),
  );
  const beachH = rows * cell;
  const beach = box((W - cols * cell) / 2, H - beachH, cols * cell, beachH);
  const kid = kidRows(H, beach.y, cell, rows, reach);
  const top = beach.y;

  if (wall) {
    const horizon = top * 0.47;
    const shore = top - 230;
    const tower = box(260, top * 0.18, 520, shore + 90 - top * 0.18);
    const progress = box(W / 2 - 1100, top * 0.56, 2200, 92);
    const flags = box(W / 2 - 340, progress.y + 140, 680, 130);
    const today = box(W / 2 + 1350, top * 0.56 - 20, Math.min(1500, W / 2 - 1510), 150);
    const wash = [box(MARGIN + 20, top - WASH_SIZE - 14, WASH_SIZE, WASH_SIZE)];
    return {
      kind,
      W,
      H,
      cell,
      cols,
      rows,
      beach,
      kid,
      horizon,
      shore,
      tower,
      progress,
      flags,
      today,
      map: null,
      banner: box(W / 2 - 1500, top * 0.16, 3000, 360),
      wash,
      home: box(W - MARGIN - 20 - 160, top - 160 - 14, 160, 160),
    };
  }

  // Panels and pairs: a band of sky, sea and shoreline above the beach.
  const horizon = Math.round(top * 0.27);
  const shore = Math.round(top * 0.78);
  const tower = box(26, 22, 190, top - 34);
  const left = tower.x + tower.width + 40;
  const span = (kind === "pair" ? W / 2 : W) - left - MARGIN;
  const washBox = box(W - MARGIN - WASH_SIZE, top - WASH_SIZE - 12, WASH_SIZE, WASH_SIZE);
  const progressW = kind === "pair" ? span : span - WASH_SIZE - 40;
  const map = bank ? box(left, 28, kind === "pair" ? span : W - left - MARGIN, 96) : null;
  const progress = box(left, (map ? 150 : horizon + 30) + 4, progressW, 56);
  const flags = box(left, progress.y + 84, 360, 76);
  const today =
    kind === "pair"
      ? box(W / 2 + 160, progress.y - 8, W / 2 - 160 - MARGIN - 40, 76)
      : box(left + 380, progress.y + 84, Math.max(80, progressW - 380), 76);
  const banner =
    kind === "pair"
      ? box(W / 2 + 120, 30, W / 2 - 240, 170)
      : box(left, 30, W - left - MARGIN, 120);
  return {
    kind,
    W,
    H,
    cell,
    cols,
    rows,
    beach,
    kid,
    horizon,
    shore,
    tower,
    progress,
    flags,
    today,
    map,
    banner,
    wash: [washBox],
    home: null,
  };
};

/** Cell under a venue point on this frame's beach, as a local column and row, or null. */
export const cellAt = (l: TouchLayout, x: number, y: number): { c: number; r: number } | null => {
  const { beach, cell } = l;
  if (x < beach.x || y < beach.y || x >= beach.x + beach.width || y >= beach.y + beach.height)
    return null;
  const c = Math.min(l.cols - 1, Math.floor((x - beach.x) / cell));
  const r = Math.min(l.rows - 1, Math.floor((y - beach.y) / cell));
  return { c, r };
};

/** Centre of a local cell, venue px. */
export const cellCentre = (l: TouchLayout, c: number, r: number) => ({
  x: l.beach.x + (c + 0.5) * l.cell,
  y: l.beach.y + (r + 0.5) * l.cell,
});

export interface ScreenLayout {
  W: number;
  H: number;
  horizon: number;
  /** The whole patch, full width so its columns sit over the frames below. */
  map: Box;
  tower: Box;
  progress: Box;
  flags: Box;
  today: Box;
  banner: Box;
}

/** The map may take at most this share of the screen's height. */
const MAP_MAX = 0.72;

export const screenLayout = (
  venue: { width: number; height: number },
  cols: number,
  rows: number,
): ScreenLayout => {
  const W = venue.width;
  const H = venue.height;
  // Square cells across the full width put each frame's columns right above it. A short bank
  // would make that map too tall, so then the cells shrink and the map is centred instead.
  let cell = W / Math.max(1, cols);
  if (cell * rows > H * MAP_MAX) cell = (H * MAP_MAX) / rows;
  const mapW = cell * cols;
  const mapH = cell * rows;
  // Low on the screen, just above the frames whose columns it shows.
  const map = box((W - mapW) / 2, Math.min(H * 0.7, H - mapH - H * 0.04), mapW, mapH);
  const T = map.y;
  const progH = Math.min(H * 0.035, T * 0.1);
  const progress = box(W * 0.25, T * 0.3, W * 0.5, progH);
  const row = progress.y + progH + T * 0.04;
  const rowH = Math.min(H * 0.05, T * 0.14);
  const towerW = Math.min(W * 0.16, T * 0.55);
  return {
    W,
    H,
    horizon: Math.min(H * 0.44, T * 0.6),
    map,
    tower: box(W * 0.035, T * 0.1, towerW, T * 0.85),
    progress,
    flags: box(W * 0.25, row, W * 0.2, rowH),
    today: box(W * 0.5, row, W * 0.42, rowH),
    banner: box(W * 0.22, T * 0.04, W * 0.56, Math.min(H * 0.11, T * 0.22)),
  };
};

/** Seams (venue x) that fall inside a frame of `span` panels. */
export const seamsOf = (W: number, span: number): number[] =>
  Array.from({ length: Math.max(0, span - 1) }, (_, i) => ((i + 1) * W) / span);
