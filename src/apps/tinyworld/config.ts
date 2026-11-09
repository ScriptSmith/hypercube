import type { FrameKind, OptionValues } from "../../core/types";

export type Variant = "sandbox" | "delta";
export type PaletteSet = "child" | "full";

/** Axis-aligned box in venue px, origin at the top left like the stage. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldConfig {
  kind: FrameKind;
  variant: Variant;
  palette: PaletteSet;
  weather: boolean;
  /** Cell size in venue px. */
  cell: number;
  /** Most pieces in the world at once. The oldest is recycled beyond this. */
  pieceCap: number;
  /** Most gadgets (geysers, fans, heaters, coolers, spouts) at once. */
  gadgetCap: number;
  /** Most beetles at once. */
  beetleCap: number;
}

/** Cell sizes the option may ask for. Auto picks 3 on a wall and 4 elsewhere. */
const CELL_SIZES = [2, 3, 4];

export const readConfig = (
  kind: FrameKind,
  variant: string,
  options: OptionValues,
): WorldConfig => {
  const cellOpt = Number(options.cell);
  const cell = CELL_SIZES.includes(cellOpt) ? cellOpt : kind === "wall" ? 3 : 4;
  return {
    kind,
    variant: variant === "delta" ? "delta" : "sandbox",
    palette: options.palette === "child" ? "child" : "full",
    weather: options.weather !== false,
    cell,
    pieceCap: kind === "wall" ? 8 : kind === "panel" ? 5 : 6,
    gadgetCap: kind === "wall" ? 4 : 3,
    beetleCap: kind === "wall" ? 10 : 6,
  };
};

/**
 * Software rasterisers run every fragment of a branchy shader in full, so they get a cell size
 * that keeps the grid near this many cells. Real GPUs never need it.
 */
export const SOFTWARE_CELLS = 24_000;

export const softwareCell = (width: number, height: number, cell: number): number =>
  Math.max(cell, Math.ceil(Math.sqrt((width * height) / SOFTWARE_CELLS)));

/**
 * The world in venue px and in cells. Cell rows count up from the bottom of the stage (the GL
 * convention), while venue y counts down from the top (the DOM convention).
 */
export interface Geometry {
  /** World size in venue px: the stage divided by `unit`, so normally the venue size. */
  width: number;
  height: number;
  cell: number;
  gridW: number;
  gridH: number;
  /** CSS px per venue px. */
  unit: number;
}

export const computeGeometry = (
  stage: { width: number; height: number; unit: number },
  cell: number,
  maxTexture = 8192,
): Geometry => {
  const unit = stage.unit > 0 ? stage.unit : 1;
  const width = Math.max(1, stage.width / unit);
  const height = Math.max(1, stage.height / unit);
  // A huge stage on a small GPU gets coarser cells rather than failing.
  let c = cell;
  while (Math.ceil(Math.max(width, height) / c) > maxTexture) c++;
  return {
    width,
    height,
    cell: c,
    gridW: Math.max(2, Math.ceil(width / c)),
    gridH: Math.max(2, Math.ceil(height / c)),
    unit,
  };
};

/** Venue px (y down) to fractional cell coordinates (y up). */
export const venueToCell = (g: Geometry, x: number, y: number): { x: number; y: number } => ({
  x: x / g.cell,
  y: (g.height - y) / g.cell,
});

/** A venue box as cell bounds: x0 and y0 inclusive, x1 and y1 exclusive, y up. */
export const boxToCells = (
  g: Geometry,
  b: Box,
): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: Math.floor(b.x / g.cell),
  x1: Math.ceil((b.x + b.width) / g.cell),
  y0: Math.floor((g.height - (b.y + b.height)) / g.cell),
  y1: Math.ceil((g.height - b.y) / g.cell),
});

export const contains = (b: Box, x: number, y: number, pad = 0): boolean =>
  x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad;

export const overlaps = (a: Box, b: Box, pad = 0): boolean =>
  a.x < b.x + b.width + pad &&
  b.x < a.x + a.width + pad &&
  a.y < b.y + b.height + pad &&
  b.y < a.y + a.height + pad;
