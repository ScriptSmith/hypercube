/**
 * Where things go on a touch frame, in venue px. Ponds sit in the children's band at the bottom
 * (the lower 45 % of a panel, the bottom quarter of a wall), each with a strip of reeds along its
 * top where herons lean in. Above each pond, in the adults' band, are its four floor tiles and its
 * switch for small or big changes in the young. The family tree (or, under a screen, the lines
 * rising to it) fills the top. On a pair each half is laid out like a panel, and nothing a
 * visitor touches comes within 120 px of the seam.
 */
import type { FrameKind } from "../../core/types";
import { PANEL_FISH, wallFish } from "./config";
import { FLOORS, type FloorId } from "./genes";
import type { Box } from "./pond";

export interface TileSpec {
  floor: FloorId;
  box: Box;
}

export interface PondLayout {
  /** The pond as drawn, reeds included. */
  water: Box;
  /** The reed strip along its top. */
  rim: Box;
  /** Where fish swim. */
  box: Box;
  tiles: TileSpec[];
  /** The two halves of the small-or-big switch. */
  small: Box;
  big: Box;
  /** Tips of this pond's fish spread over this range of x. */
  tips: [number, number];
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  ponds: PondLayout[];
  /** The tree (or the lines rising to the screen), above the controls. */
  tree: Box;
  fish: number;
  target: number;
  /** A free square for the runtime's Home control, venue px. */
  home: { x: number; y: number; size: number } | null;
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: number[];
  /** Ponds along a wall. */
  ponds: number;
}

const SEAM_GAP = 130;
const POND_SEAM_GAP = 60;
const RIM = 64;

const pondFor = (
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  ctl: { tile: number; gap: number; pill: { w: number; h: number }; row: boolean },
  inner: { left: number; right: number },
): PondLayout => {
  const water: Box = {
    x: x0 + inner.left,
    y: top,
    w: Math.max(100, x1 - x0 - inner.left - inner.right),
    h: bottom - top,
  };
  const rim: Box = { x: water.x, y: water.y, w: water.w, h: RIM };
  const box: Box = {
    x: water.x + 12,
    y: water.y + RIM + 6,
    w: water.w - 24,
    h: water.h - RIM - 16,
  };
  const t = ctl.tile;
  const rowW = 4 * t + 3 * ctl.gap;
  const pillW = ctl.pill.w;
  // Controls are kept inside the pond's own span, clear of a seam beside it.
  const cx0 = x0 + Math.max(40, inner.left === POND_SEAM_GAP ? SEAM_GAP : 40);
  const cx1 = x1 - Math.max(40, inner.right === POND_SEAM_GAP ? SEAM_GAP : 40);
  const tileY = top - 34 - t;
  let tilesX: number;
  let pill: Box;
  if (ctl.row) {
    const total = rowW + 60 + pillW;
    const start = cx0 + Math.max(0, (cx1 - cx0 - total) / 2);
    tilesX = start;
    pill = { x: start + rowW + 60, y: tileY + (t - ctl.pill.h) / 2, w: pillW, h: ctl.pill.h };
  } else {
    tilesX = cx0 + Math.max(0, (cx1 - cx0 - rowW) / 2);
    pill = {
      x: cx0 + Math.max(0, (cx1 - cx0 - pillW) / 2),
      y: tileY - 44 - ctl.pill.h,
      w: pillW,
      h: ctl.pill.h,
    };
  }
  const tiles = FLOORS.map((floor, i) => ({
    floor,
    box: { x: tilesX + i * (t + ctl.gap), y: tileY, w: t, h: t },
  }));
  return {
    water,
    rim,
    box,
    tiles,
    small: { x: pill.x, y: pill.y, w: pill.w / 2, h: pill.h },
    big: { x: pill.x + pill.w / 2, y: pill.y, w: pill.w / 2, h: pill.h },
    tips: [water.x + 24, water.x + water.w - 24],
  };
};

const topOf = (p: PondLayout): number => Math.min(p.small.y, p.tiles[0]?.box.y ?? p.small.y);

export const layoutFor = (input: LayoutInput): Layout => {
  const W = input.width;
  const H = input.height;
  if (input.kind === "wall") {
    const n = Math.min(4, Math.max(1, Math.round(input.ponds)));
    const margin = 40;
    const gap = 60;
    const w = (W - 2 * margin - (n - 1) * gap) / n;
    const top = Math.max(input.reachTop.child, H * 0.72);
    const pill = { w: 440, h: 170 };
    const tile = Math.min(230, (w - 80 - 60 - pill.w - 3 * 26) / 4);
    const ponds = Array.from({ length: n }, (_, i) => {
      const x0 = margin + i * (w + gap);
      return pondFor(
        x0,
        x0 + w,
        top,
        H - 26,
        { tile, gap: 26, pill, row: true },
        { left: 0, right: 0 },
      );
    });
    const ctlTop = Math.min(...ponds.map(topOf));
    const last = ponds[n - 1]!;
    const pillRight = last.big.x + last.big.w;
    const size = 170;
    const free = W - margin - pillRight;
    const home =
      free >= size + 80
        ? { x: W - margin - size - 20, y: last.big.y + (last.big.h - size) / 2, size }
        : null;
    return {
      kind: "wall",
      width: W,
      height: H,
      ponds,
      tree: { x: margin, y: 30, w: W - 2 * margin, h: Math.max(200, ctlTop - 70) },
      fish: 100,
      target: wallFish(n),
      home,
    };
  }
  // Panels and pairs: one pond per panel-wide half.
  const span = input.kind === "pair" ? Math.max(2, input.seams.length + 1) : 1;
  const half = W / span;
  const top = Math.max(input.reachTop.child, H * 0.55);
  const tile = Math.min(200, (half - 2 * SEAM_GAP - 3 * 22) / 4);
  const ponds = Array.from({ length: span }, (_, i) => {
    const x0 = i * half;
    const left = i > 0 ? POND_SEAM_GAP : 30;
    const right = i < span - 1 ? POND_SEAM_GAP : 30;
    return pondFor(
      x0,
      x0 + half,
      top,
      H - 28,
      { tile, gap: 22, pill: { w: 560, h: 160 }, row: false },
      { left, right },
    );
  });
  const ctlTop = Math.min(...ponds.map(topOf));
  return {
    kind: input.kind,
    width: W,
    height: H,
    ponds,
    tree: { x: 30, y: 30, w: W - 60, h: Math.max(160, ctlTop - 80) },
    fish: 84,
    target: PANEL_FISH,
    home: null,
  };
};

const inside = (b: Box, x: number, y: number, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

export type Hit =
  | { kind: "tile"; pond: number; floor: FloorId }
  | { kind: "mutation"; pond: number; value: "small" | "big" }
  | { kind: "pond"; pond: number };

/** What a touch at a venue point lands on. Controls get a little slack around their edges. */
export const hitAt = (layout: Layout, x: number, y: number): Hit | null => {
  for (let i = 0; i < layout.ponds.length; i++) {
    const p = layout.ponds[i]!;
    for (const t of p.tiles)
      if (inside(t.box, x, y, 10)) return { kind: "tile", pond: i, floor: t.floor };
    if (inside(p.small, x, y, 10)) return { kind: "mutation", pond: i, value: "small" };
    if (inside(p.big, x, y, 10)) return { kind: "mutation", pond: i, value: "big" };
  }
  for (let i = 0; i < layout.ponds.length; i++) {
    const p = layout.ponds[i]!;
    if (inside(p.water, x, y, 40)) return { kind: "pond", pond: i };
  }
  return null;
};
