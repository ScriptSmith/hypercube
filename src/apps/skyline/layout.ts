/**
 * Where everything goes, in venue px (y down), and each crane's world. Pure.
 *
 * Every crane has a lane: the strip of sky it builds in, above a ground line, and its controls
 * below the ground. A lane's world is laid out from the mast outwards: the mast, lots, and the
 * yard with the lift at its far end, spare room shared between the gaps. The world's scale is
 * the largest that fits both the lane's width and the building rows wanted in its sky.
 *
 * Controls under each crane: the block buttons lowest (children), the drag pad and the release
 * button above them, and the lift rising beside them to the yard (or, on a bank, out of the
 * frame's top edge to the screen).
 *
 * - Panel: one crane, one lot, ground a little above the middle.
 * - Pair: one crane per half, masts at the outer edges; controls keep a fifth of the width
 *   from the seam, so the two people stand at the outer sides.
 * - Wall: two or three lanes; the ground at the top of adult reach, the pad and release in the
 *   adult band and the buttons in the children's band, either side of the lift.
 * - Kiosk: one crane over two lots, the mast on the right; controls along the bottom.
 * - Screen: one narrow lane per crane above each touch frame, the yard deck along the bottom.
 */
import type { FrameKind, Rect } from "../../core/types";
import { BH, KIND, type Variant } from "./config";
import type { World } from "./crane";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface BlockButton {
  kind: number;
  rect: Rect;
}

export interface Lift {
  /** Shaft centre and width, venue px. */
  x: number;
  width: number;
  /** Where a sent block starts (over its button) is per button; it rides up from `bottom`. */
  bottom: number;
  /** The yard's ground line in solo; a bank frame's lift carries on to its top edge. */
  top: number;
}

/** World units to venue px: x = ox + wx * s, y = gy - wy * s. */
export interface Scene {
  s: number;
  ox: number;
  gy: number;
}

export interface CraneLayout {
  index: number;
  lane: Rect;
  scene: Scene;
  world: World;
  pad: Rect;
  release: Circle;
  buttons: BlockButton[];
  lift: Lift;
  /** The dark console behind this crane's controls. */
  console: Rect;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  /** Venue y of the ground line. */
  ground: number;
  cranes: CraneLayout[];
  home: { x: number; y: number; size: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: readonly number[];
  cranes: number;
  variant: Variant;
}

export const MIN_TARGET = 120;
/** Block buttons on panels and pairs, and on the wall. */
export const MIN_BUTTON = 160;
export const MIN_WALL_BUTTON = 220;
export const MIN_PAD = { width: 600, height: 400 };
/** Pair controls keep this share of the width from the seam. */
export const SEAM_SHARE = 0.2;

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

/** A lift shaft takes a block with a little room either side. */
export const liftWidth = (s: number) => 1.12 * s;

/** Clearance above the tallest building: sling, a carried block, cable, sheave, jib. */
const HEADROOM = 2.75;
/** The tower head above the jib, and a little sky over it. */
export const APEX = 0.8;

export interface ArrangeSpec {
  lane: Rect;
  /** Venue y of the ground line and of the sky's top. */
  gy: number;
  top: number;
  mast: "left" | "right";
  /** Lots and the yard in order from the mast outwards; the lift sits at the yard's far end. */
  seq: ("lot" | "yard")[];
  cols: number;
  yardSlots: number;
  rows: number;
  tall: boolean;
  /** Narrow pieces, for the screen's thin lanes. */
  thin?: boolean;
  /** Put the lift here, a share of the lane's width from its left (a bank frame's report). */
  liftAt?: number;
  /** The jib at least this share of the way up the sky. */
  jibShare?: number;
  /** Nudge the jib down a little, so neighbouring cranes' jibs don't line up. */
  lower?: boolean;
}

/** A crane's world in its lane, and the scale that maps it. */
export const arrange = (a: ArrangeSpec): { scene: Scene; world: World } => {
  const thin = !!a.thin;
  const M = thin ? 0.75 : 1.3;
  const L = a.tall ? (thin ? 2 : 2.6) : a.cols + (thin ? 0.3 : 0.5);
  const slotW = thin ? 1.04 : 1.1;
  const Y = a.yardSlots * slotW;
  const F = thin ? 0.6 : 0.9;
  const pieces = a.seq.map((p) => (p === "lot" ? L : Y + F));
  const total = M + pieces.reduce((s, w) => s + w, 0) + 0.3;
  const sky = Math.max(1, a.gy - a.top);
  const needH = a.rows * BH + HEADROOM + 0.3 + APEX;
  const s = Math.min(a.lane.width / total, sky / needH);
  const W = a.lane.width / s;
  const H = sky / s;
  // Spare room goes into the gaps after the mast and between pieces, so the last piece (the
  // lift, on panels) keeps to the far edge.
  const gap = Math.max(0, W - total) / Math.max(1, a.seq.length);
  const at = (d: number) => (a.mast === "left" ? d : W - d);

  const mastD = thin ? 0.32 : 0.5;
  const lots: { d: number }[] = [];
  let yardD = 0;
  let d = M;
  a.seq.forEach((p, i) => {
    d += gap;
    if (p === "lot") lots.push({ d: d + L / 2 });
    else yardD = d;
    d += pieces[i]!;
  });
  let liftD = yardD + Y + F / 2;
  if (a.liftAt !== undefined) {
    const want = a.mast === "left" ? a.liftAt * W : (1 - a.liftAt) * W;
    const shift = Math.min(W - F / 2 - 0.1, Math.max(M + Y + F / 2, want)) - liftD;
    liftD += shift;
    yardD += shift;
    // Lots next to the yard keep clear of it, centred in what room is left.
    const before = lots.filter((l) => l.d < yardD);
    const after = lots.filter((l) => l.d > yardD);
    const spread = (group: { d: number }[], from: number, to: number) => {
      const room = (to - from) / Math.max(1, group.length);
      group.forEach((l, i) => {
        l.d = from + room * (i + 0.5);
      });
    };
    spread(before, M, yardD);
    spread(after, yardD + Y + F, W - 0.15);
  }
  const yard = Array.from({ length: a.yardSlots }, (_, i) => at(yardD + Y - (i + 0.5) * slotW));
  // The jib and the tower head above it stay in the lane.
  const jibTop = H - APEX;
  const fit = Math.floor((jibTop - 0.3 - HEADROOM) / BH);
  const maxRows = Math.max(2, Math.min(a.tall ? a.rows : 6, fit));
  let jibY = Math.min(jibTop, maxRows * BH + HEADROOM + 0.3);
  if (a.jibShare !== undefined) jibY = Math.max(jibY, Math.min(jibTop, a.jibShare * H));
  if (a.lower) jibY -= Math.min(0.35, jibY * 0.04);
  const far = Math.min(W - 0.2, d + 0.1);
  const mastX = at(mastD);
  const reachFrom = at(mastD + (thin ? 0.55 : 0.8));
  const reachTo = at(far);
  const world: World = {
    left: 0,
    right: W,
    height: H,
    mastX,
    jibY,
    jibFrom: at(mastD - (thin ? 0.9 : 1.4)),
    jibTo: at(far + 0.25),
    tMin: Math.min(reachFrom, reachTo),
    tMax: Math.max(reachFrom, reachTo),
    lots: lots.map((l) => ({ x: at(l.d), cols: a.tall ? 1 : a.cols })),
    maxRows,
    yard,
    liftX: at(liftD),
    storeX: at(liftD),
  };
  return { scene: { s, ox: a.lane.x, gy: a.gy }, world };
};

export const toVenue = (sc: Scene, x: number, y: number) => ({
  x: sc.ox + x * sc.s,
  y: sc.gy - y * sc.s,
});

/** Block kinds offered by the buttons: three on a pair's narrow halves and in `tall`. */
const kindsFor = (narrow: boolean, tall: boolean): number[] =>
  tall || narrow
    ? tall
      ? [KIND.plain, KIND.glass, KIND.balcony]
      : [KIND.plain, KIND.glass, KIND.roof]
    : [KIND.plain, KIND.glass, KIND.balcony, KIND.roof];

const buttonsIn = (
  kinds: number[],
  x0: number,
  x1: number,
  y: number,
  size: number,
): BlockButton[] => {
  const n = kinds.length;
  const gap = n > 1 ? Math.max(16, (x1 - x0 - n * size) / (n - 1)) : 0;
  const w = n * size + (n - 1) * gap;
  const start = x0 + (x1 - x0 - w) / 2;
  return kinds.map((kind, i) => ({ kind, rect: rect(start + i * (size + gap), y, size, size) }));
};

const panelLike = (
  inp: LayoutInput,
  laneX: number,
  laneW: number,
  mast: "left" | "right",
  index: number,
  ctl: { x0: number; x1: number },
  gy: number,
  narrow: boolean,
): CraneLayout => {
  const tall = inp.variant === "tall";
  const lane = rect(laneX, 0, laneW, inp.height);
  const { scene, world } = arrange({
    lane,
    gy,
    top: 0,
    mast,
    seq: ["lot", "yard"],
    cols: 3,
    yardSlots: 2,
    rows: tall ? 12 : 6,
    tall,
  });
  const liftX = toVenue(scene, world.liftX, 0).x;
  const H = inp.height;
  const size = 180;
  const by = H - 40 - size;
  const kinds = kindsFor(narrow, tall);
  const buttons = buttonsIn(kinds, ctl.x0, ctl.x1, by, size);
  const padH = 420;
  const padY = by - 50 - padH;
  let pad: Rect;
  let release: Circle;
  if (narrow) {
    // A pair's half: the pad as wide as the controls' room, the release above it at the outer side.
    pad = rect(ctl.x0, padY, ctl.x1 - ctl.x0, padH);
    const r = 85;
    const rx = mast === "left" ? ctl.x0 + r : ctl.x1 - r;
    release = { x: rx, y: Math.max(gy + r + 20, padY - 30 - r), r };
  } else {
    const r = 95;
    const padW = Math.min(640, ctl.x1 - ctl.x0 - 2 * r - 30);
    const px = mast === "left" ? ctl.x0 : ctl.x1 - padW;
    pad = rect(px, padY, padW, padH);
    release = {
      x: mast === "left" ? px + padW + 30 + r : px - 30 - r,
      y: padY + padH / 2,
      r,
    };
  }
  const shaft = liftWidth(scene.s);
  return {
    index,
    lane,
    scene,
    world,
    pad,
    release,
    buttons,
    lift: { x: liftX, width: shaft, bottom: H - 30, top: gy },
    console: rect(laneX, gy, laneW, H - gy),
  };
};

const panelLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const gy = Math.round(inp.height * 0.58);
  const c = panelLike(inp, 0, W, "left", 0, { x0: 30, x1: 0 }, gy, false);
  // The controls fill the room left of the lift.
  const ctl = { x0: 30, x1: c.lift.x - c.lift.width / 2 - 30 };
  const crane = panelLike(inp, 0, W, "left", 0, ctl, gy, false);
  return {
    kind: inp.kind,
    width: W,
    height: inp.height,
    ground: gy,
    cranes: [crane],
    home: { x: W - 150, y: 30, size: 120 },
  };
};

const pairLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const seam = inp.seams[0] ?? W / 2;
  const margin = SEAM_SHARE * W;
  const gy = Math.round(inp.height * 0.5);
  const left = panelLike(inp, 0, seam, "left", 0, { x0: 24, x1: seam - margin - 24 }, gy, true);
  const right = panelLike(
    inp,
    seam,
    W - seam,
    "right",
    1,
    { x0: seam + margin + 24, x1: W - 24 },
    gy,
    true,
  );
  return {
    kind: inp.kind,
    width: W,
    height: inp.height,
    ground: gy,
    cranes: [left, right],
    home: { x: seam - 60, y: 30, size: 120 },
  };
};

const wallLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const H = inp.height;
  const n = Math.max(1, Math.min(3, inp.cranes));
  const laneW = W / n;
  const gy = Math.round(inp.reachTop.adult);
  const tall = inp.variant === "tall";
  const size = Math.max(MIN_WALL_BUTTON, Math.min(250, (H - inp.reachTop.child) * 0.4));
  const by = H - 50 - size;
  const cranes: CraneLayout[] = [];
  for (let i = 0; i < n; i++) {
    const lane = rect(i * laneW, 0, laneW, H);
    const { scene, world } = arrange({
      lane,
      gy,
      top: 0,
      mast: "left",
      seq: tall ? ["lot", "yard"] : n >= 3 ? ["lot", "yard", "lot"] : ["lot", "yard", "lot", "lot"],
      cols: 3,
      yardSlots: 4,
      rows: tall ? 14 : 6,
      tall,
      lower: i % 2 === 1,
    });
    const liftX = toVenue(scene, world.liftX, 0).x;
    const shaft = liftWidth(scene.s);
    const kinds = kindsFor(false, tall);
    // Buttons either side of the lift's foot, as many on each side as fit.
    const gap = 36;
    const half = Math.ceil(kinds.length / 2);
    const leftKinds = kinds.slice(0, half);
    const rightKinds = kinds.slice(half);
    const leftEnd = liftX - shaft / 2 - gap;
    const rightStart = liftX + shaft / 2 + gap;
    let buttons: BlockButton[] = [
      ...leftKinds.map((kind, j) => ({
        kind,
        rect: rect(leftEnd - (leftKinds.length - j) * (size + gap) + gap, by, size, size),
      })),
      ...rightKinds.map((kind, j) => ({
        kind,
        rect: rect(rightStart + j * (size + gap), by, size, size),
      })),
    ];
    // If the right-hand ones would leave the lane, put them all on the left.
    if (buttons.some((b) => b.rect.x + b.rect.width > lane.x + laneW - 20)) {
      buttons = kinds.map((kind, j) => ({
        kind,
        rect: rect(leftEnd - (kinds.length - j) * (size + gap) + gap, by, size, size),
      }));
    }
    const padY = gy + 40;
    const padH = Math.max(MIN_PAD.height, by - 60 - padY);
    const r = 125;
    const padX = lane.x + 60;
    const padW = Math.max(MIN_PAD.width, Math.min(900, liftX - shaft / 2 - 60 - 2 * r - 50 - padX));
    const release: Circle = { x: padX + padW + 40 + r, y: padY + padH * 0.45, r };
    cranes.push({
      index: i,
      lane,
      scene,
      world,
      pad: rect(padX, padY, padW, padH),
      release,
      buttons,
      lift: { x: liftX, width: shaft, bottom: H - 30, top: gy },
      console: rect(lane.x, gy, laneW, H - gy),
    });
  }
  return {
    kind: inp.kind,
    width: W,
    height: H,
    ground: gy,
    cranes,
    home: { x: W - 200, y: gy + 30, size: 160 },
  };
};

const kioskLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const H = inp.height;
  const tall = inp.variant === "tall";
  const gy = Math.round(H * 0.64);
  const lane = rect(0, 0, W, H);
  const { scene, world } = arrange({
    lane,
    gy,
    top: 0,
    mast: "right",
    seq: tall ? ["lot", "yard"] : ["lot", "lot", "yard"],
    cols: 3,
    yardSlots: 3,
    rows: tall ? 8 : 4,
    tall,
  });
  const liftX = toVenue(scene, world.liftX, 0).x;
  const shaft = liftWidth(scene.s);
  const size = 160;
  const g = 20;
  const kinds = kindsFor(false, tall);
  const bx = Math.max(liftX + shaft / 2 + 30, 40);
  const top = H - 20 - 2 * size - g;
  const buttons: BlockButton[] = kinds.map((kind, i) => ({
    kind,
    rect: rect(bx + (i % 2) * (size + g), top + Math.floor(i / 2) * (size + g), size, size),
  }));
  const padX = bx + 2 * size + g + 60;
  const padW = 660;
  const padY = gy + 25;
  const padH = H - 20 - padY;
  const r = 110;
  return {
    kind: inp.kind,
    width: W,
    height: H,
    ground: gy,
    cranes: [
      {
        index: 0,
        lane,
        scene,
        world,
        pad: rect(padX, padY, padW, padH),
        release: { x: padX + padW + 50 + r, y: padY + padH / 2, r },
        buttons,
        lift: { x: liftX, width: shaft, bottom: H - 20, top: gy },
        console: rect(0, gy, W, H - gy),
      },
    ],
    home: { x: W - 150, y: 30, size: 120 },
  };
};

/** Layout for a touch frame (or a lone screen, laid out as a wall would be by `screenLayout`). */
export const layoutFor = (inp: LayoutInput): Layout => {
  switch (inp.kind) {
    case "pair":
      return pairLayout(inp);
    case "wall":
      return wallLayout(inp);
    case "kiosk":
      return kioskLayout(inp);
    default:
      return panelLayout(inp);
  }
};

/** One crane lane above a bank: which frame column it is, and which half of a pair. */
export interface ScreenColumn {
  /** The frame's position in the bank, and the crane within it (0, or 1 for a pair's right half). */
  pos: number;
  crane: number;
  /** Share of the bank's width where this lane starts and how wide it is. */
  from: number;
  width: number;
  /** Where its frame's lift leaves, as a share of the lane's width; null until reported. */
  liftAt: number | null;
  /** Whether the lane's mast is on its left, as on its frame below. */
  mast: "left" | "right";
}

/** Default share across a lane where a bank frame's lift leaves, before it reports. */
export const defaultLiftShare = (
  kind: "panel" | "pair",
  crane: number,
  variant: Variant = "build",
): number => {
  const inp: LayoutInput = {
    kind,
    width: kind === "pair" ? 2160 : 1080,
    height: 1920,
    reachTop: { adult: 0, child: 1056 },
    seams: kind === "pair" ? [1080] : [],
    cranes: 1,
    variant,
  };
  const l = layoutFor(inp).cranes[crane] ?? layoutFor(inp).cranes[0]!;
  return (l.lift.x - l.lane.x) / l.lane.width;
};

export interface ScreenLayout {
  width: number;
  height: number;
  ground: number;
  cranes: (CraneLayout & { column: ScreenColumn })[];
}

/** The screen: one thin lane per crane, the yard deck along the bottom edge. */
export const screenLayout = (
  width: number,
  height: number,
  columns: readonly ScreenColumn[],
  variant: Variant,
): ScreenLayout => {
  const gy = Math.round(height * 0.955);
  const tall = variant === "tall";
  const cranes = columns.map((col, i) => {
    const lane = rect(col.from * width, 0, col.width * width, height);
    const thin = lane.width < 700;
    const { scene, world } = arrange({
      lane,
      gy,
      top: 0,
      mast: col.mast,
      seq: ["lot", "yard"],
      cols: lane.width < 600 ? 2 : 3,
      yardSlots: lane.width < 600 ? 1 : 2,
      rows: tall ? 36 : 6,
      tall,
      thin,
      liftAt: col.liftAt ?? undefined,
      jibShare: tall ? undefined : 0.45,
      lower: i % 2 === 1,
    });
    const liftX = toVenue(scene, world.liftX, 0).x;
    const crane: CraneLayout & { column: ScreenColumn } = {
      index: i,
      lane,
      scene,
      world,
      pad: rect(0, 0, 0, 0),
      release: { x: 0, y: 0, r: 0 },
      buttons: [],
      lift: { x: liftX, width: Math.max(30, 0.55 * scene.s), bottom: height, top: gy },
      console: rect(lane.x, gy, lane.width, height - gy),
      column: col,
    };
    return crane;
  });
  return { width, height, ground: gy, cranes };
};
