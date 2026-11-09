/**
 * Where a bench's parts go, in venue px of the frame (origin top left). A bench has a grid of
 * sockets in the reachable band, a low tray for children's pieces and a high tray for adults',
 * spots at its sides where lamps can sit, a hold-to-reset control and a row of progress lamps.
 * Children's sockets and tray sit in the child band; adults' above them.
 *
 * Panels, pairs and kiosks use the panel sizes (pieces 240 across, rings 360). The wall is
 * about three times coarser per metre, so its pieces are smaller in px but larger in metres.
 */
import type { FrameKind, Reach } from "../../core/types";
import type { Box } from "./trace";

export interface Sizes {
  /** Piece radius: the disc a placed piece sits on. */
  piece: number;
  /** Rotation ring radius and its knob's radius. */
  ring: number;
  knob: number;
  crystal: number;
  /** The small crystal a lens must focus onto. */
  small: number;
  lamp: number;
  /** Spacing of a wide lamp's parallel beams. */
  bundle: number;
}

export const PANEL_SIZES: Sizes = {
  piece: 120,
  ring: 180,
  knob: 62,
  crystal: 40,
  small: 24,
  lamp: 100,
  bundle: 34,
};

export const WALL_SIZES: Sizes = {
  piece: 84,
  ring: 150,
  knob: 62,
  crystal: 60,
  small: 22,
  lamp: 110,
  bundle: 26,
};

export interface Socket {
  x: number;
  y: number;
  /** In the child band. */
  child: boolean;
  /** Which half of a pair (0 on other frames). */
  half: number;
}

export interface Tray {
  box: Box;
  slots: { x: number; y: number }[];
  child: boolean;
  half: number;
}

export interface LampSpot {
  x: number;
  y: number;
  /** The lamp faces into the bench from this side. */
  side: "l" | "r";
}

export interface BenchLayout {
  index: number;
  kind: FrameKind;
  /** Light stays inside this box. */
  box: Box;
  sizes: Sizes;
  sockets: Socket[];
  trays: Tray[];
  lampSpots: LampSpot[];
  reset: Box;
  progress: Box;
  /** Crystals keep out of these. */
  keepOut: Box[];
  /** y of the top of adult and child reach; crystals above `reachTop` are high on the wall. */
  reachTop: number;
  childTop: number;
  /** Most pieces placed on each half (one half except on pairs). */
  limit: number;
  halves: number;
  seams: number[];
  /**
   * On a bank frame, the x of a clear lane near the right edge: the fixed sky splitter sits in it,
   * sending light up to the screen and on into the next frame.
   */
  skyLane: number | null;
  /** A clear square for the runtime's Home control, where the default spot would cover something. */
  home?: Box;
}

export interface FrameLayout {
  W: number;
  H: number;
  kind: FrameKind;
  benches: BenchLayout[];
}

const box = (x: number, y: number, width: number, height: number): Box => ({
  x,
  y,
  width,
  height,
});

/** Slots for `n` pieces in a strip, filled from `from` (the outer end) inwards. */
const strip = (
  b: Box,
  pitch: number,
  from: "left" | "right",
  child: boolean,
  half: number,
): Tray => {
  const n = Math.max(1, Math.floor(b.width / pitch));
  const y = b.y + b.height / 2;
  const slots = Array.from({ length: n }, (_, i) => {
    const k = from === "left" ? i : n - 1 - i;
    return { x: b.x + (k + 0.5) * (b.width / n), y };
  });
  return { box: b, slots, child, half };
};

const spread = (a: number, b: number, n: number): number[] =>
  n <= 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

const clampReach = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A tall bench (a panel, or a pair's two halves): adults' tray at the top, two adult socket rows,
 * two child socket rows, children's tray at the bottom, lamps on the side edges.
 */
/** How far in from the right edge a bank frame's sky lane runs. */
export const SKY_LANE_INSET = 140;

const tallBench = (
  W: number,
  H: number,
  reach: Reach,
  kind: FrameKind,
  span: number,
  bank: boolean,
) => {
  const s = PANEL_SIZES;
  const R = s.piece;
  const reachTop = H * (1 - clampReach(reach.adult));
  const childTop = H * (1 - clampReach(reach.child));
  const halves = kind === "pair" ? Math.max(2, span) : 1;
  const hw = W / halves;
  const seams = Array.from({ length: halves - 1 }, (_, i) => (i + 1) * hw);
  const uiH = 140;
  const trayH = 200;
  const adultTray = box(0, Math.max(uiH + 10, reachTop + 20), 0, trayH);
  const childTray = box(0, H - trayH - 20, 0, trayH);
  const top = adultTray.y + adultTray.height + 40 + R;
  const bottom = childTray.y - 30 - R;
  const rows = spread(top, bottom, 4);
  const sockets: Socket[] = [];
  const trays: Tray[] = [];
  const pitch = 240;
  const skyLane = bank ? W - SKY_LANE_INSET : null;
  for (let h = 0; h < halves; h++) {
    const x0 = h * hw;
    // Keep 120 px clear of a seam, the lamp housings clear of the outer edges, and on a bank
    // the sky lane clear of pieces.
    const inL = h > 0 ? 120 + R + 10 : 200;
    const lastHalf = h === halves - 1;
    // Before the sky lane, two columns leave room for crystals on the light running into it.
    const inR = !lastHalf ? 120 + R + 10 : bank ? SKY_LANE_INSET + 330 : 200;
    const cols = spread(x0 + inL, x0 + hw - inR, lastHalf && bank ? 2 : 3);
    for (const y of rows)
      for (const x of cols) sockets.push({ x, y, child: y >= childTop, half: h });
    const outer: "left" | "right" = h === 0 ? "left" : "right";
    const tL = x0 + (h > 0 ? 120 : 50);
    const tR = x0 + hw - (h < halves - 1 ? 120 : 50);
    trays.push(strip(box(tL, childTray.y, tR - tL, trayH), pitch, outer, true, h));
    trays.push(strip(box(tL, adultTray.y, tR - tL, trayH), pitch, outer, false, h));
  }
  const lampSpots: LampSpot[] = [];
  const lampYs = spread(rows[0]!, rows[3]!, 7);
  for (const y of lampYs) {
    lampSpots.push({ x: 64, y, side: "l" });
    lampSpots.push({ x: W - 64, y, side: "r" });
  }
  const reset = box(30, 14, 130, 130);
  // Away from the runtime's Home control (top right) and, on a pair, from the seam.
  const progress = halves > 1 ? box(hw + 160, 40, hw - 360, 70) : box(W / 2 - 300, 40, 600, 70);
  const keepOut = [
    ...trays.map((t) => t.box),
    box(0, 0, W, uiH),
    box(0, rows[0]! - R, 110, rows[3]! - rows[0]! + 2 * R),
  ];
  if (!bank) keepOut.push(box(W - 110, rows[0]! - R, 110, rows[3]! - rows[0]! + 2 * R));
  // Nothing worth looking at straddles a bezel.
  for (const x of seams) keepOut.push(box(x - 50, 0, 100, H));
  return {
    sizes: s,
    sockets,
    trays,
    lampSpots,
    reset,
    progress,
    keepOut,
    reachTop,
    childTop,
    halves,
    seams,
    skyLane,
  };
};

const kioskBench = (W: number, H: number, reach: Reach) => {
  const s = PANEL_SIZES;
  const reachTop = H * (1 - clampReach(reach.adult));
  const childTop = H * (1 - clampReach(reach.child));
  const trayH = 200;
  const ty = H - trayH - 20;
  const rows = [330, ty - 40 - s.piece];
  const cols = spread(300, W - 300, 5);
  const sockets: Socket[] = [];
  for (const y of rows) for (const x of cols) sockets.push({ x, y, child: y >= childTop, half: 0 });
  const trays = [
    strip(box(60, ty, W / 2 - 90, trayH), 215, "left", true, 0),
    strip(box(W / 2 + 30, ty, W / 2 - 90, trayH), 215, "right", false, 0),
  ];
  const lampSpots: LampSpot[] = [];
  for (const y of spread(rows[0]!, rows[1]!, 3)) {
    lampSpots.push({ x: 64, y, side: "l" });
    lampSpots.push({ x: W - 64, y, side: "r" });
  }
  const reset = box(30, 14, 120, 120);
  const progress = box(W / 2 - 330, 36, 660, 66);
  const keepOut = [
    ...trays.map((t) => t.box),
    box(0, 0, W, 136),
    box(0, rows[0]! - s.piece, 110, rows[1]! - rows[0]! + 2 * s.piece),
    box(W - 110, rows[0]! - s.piece, 110, rows[1]! - rows[0]! + 2 * s.piece),
  ];
  return {
    sizes: s,
    sockets,
    trays,
    lampSpots,
    reset,
    progress,
    keepOut,
    reachTop,
    childTop,
    halves: 1,
    seams: [] as number[],
    skyLane: null,
  };
};

/**
 * One of a wall's benches: three socket rows within adult reach, the top one for adults with
 * the reset at its left end and the adults' tray at its right; the children's tray below.
 * Lamps sit at both ends at child height, so their beams never cross the trays.
 */
const wallBench = (x0: number, BW: number, H: number, reach: Reach) => {
  const s = WALL_SIZES;
  const R = s.piece;
  const reachTop = H * (1 - clampReach(reach.adult));
  const childTop = H * (1 - clampReach(reach.child));
  const trayH = 180;
  const ty = H - trayH - 20;
  const r3 = ty - 34 - R;
  const r1 = Math.max(reachTop + R + 6, r3 - 2 * 290);
  const r2 = (r1 + r3) / 2;
  const side = 230;
  const maxCols = 7;
  const span = BW - 2 * side;
  const n = Math.max(3, Math.min(maxCols, Math.floor(span / 330) + 1));
  const cols = spread(x0 + side, x0 + BW - side, n);
  const sockets: Socket[] = [];
  const resetW = 150;
  const reset = box(x0 + 40, r1 - resetW / 2, resetW, resetW);
  const trayPitch = 200;
  const adultW = trayPitch * 4;
  const adultTray = box(x0 + BW - 40 - adultW, r1 - trayH / 2, adultW, trayH);
  // Left of the adults' tray stays clear for the runtime's Home control.
  const home = box(adultTray.x - 200, r1 - 80, 160, 160);
  for (const x of cols) {
    if (x - R > reset.x + reset.width + 20 && x + R < home.x - 20) {
      sockets.push({ x, y: r1, child: r1 >= childTop, half: 0 });
    }
  }
  for (const y of [r2, r3])
    for (const x of cols) sockets.push({ x, y, child: y >= childTop, half: 0 });
  const childW = Math.min(BW - 2 * side, trayPitch * 4);
  const trays = [
    strip(box(x0 + BW / 2 - childW / 2, ty, childW, trayH), trayPitch, "left", true, 0),
    strip(adultTray, trayPitch, "right", false, 0),
  ];
  const lampSpots: LampSpot[] = [];
  for (const y of spread(r2, r3, 3)) {
    lampSpots.push({ x: x0 + 70, y, side: "l" });
    lampSpots.push({ x: x0 + BW - 70, y, side: "r" });
  }
  const progress = box(x0 + BW / 2 - 420, 70, 840, 80);
  const keepOut = [
    ...trays.map((t) => t.box),
    reset,
    home,
    box(x0, 0, BW, 170),
    box(x0, r2 - R, 130, r3 - r2 + 2 * R),
    box(x0 + BW - 130, r2 - R, 130, r3 - r2 + 2 * R),
  ];
  return {
    sizes: s,
    sockets,
    trays,
    lampSpots,
    reset,
    progress,
    keepOut,
    reachTop,
    childTop,
    halves: 1,
    seams: [] as number[],
    skyLane: null,
    home,
  };
};

/** Pieces each half of a bench may hold: 6 on a panel or half a pair, 8 on a wall bench. */
export const limitOf = (kind: FrameKind): number => (kind === "wall" ? 8 : 6);

export const frameLayout = (
  kind: FrameKind,
  venue: { width: number; height: number },
  reach: Reach,
  opts: { benches?: number; span?: number; bank?: boolean } = {},
): FrameLayout => {
  const W = venue.width;
  const H = venue.height;
  if (kind === "wall") {
    const n = Math.max(1, Math.min(3, Math.round(opts.benches ?? 2)));
    const BW = W / n;
    return {
      W,
      H,
      kind,
      benches: Array.from({ length: n }, (_, i) => ({
        index: i,
        kind,
        box: box(i * BW, 0, BW, H),
        limit: limitOf(kind),
        ...wallBench(i * BW, BW, H, reach),
      })),
    };
  }
  const part =
    kind === "kiosk"
      ? kioskBench(W, H, reach)
      : tallBench(W, H, reach, kind, opts.span ?? 2, opts.bank ?? false);
  return {
    W,
    H,
    kind,
    benches: [{ index: 0, kind, box: box(0, 0, W, H), limit: limitOf(kind), ...part }],
  };
};

export const inBox = (b: Box, x: number, y: number, pad = 0): boolean =>
  x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad;
