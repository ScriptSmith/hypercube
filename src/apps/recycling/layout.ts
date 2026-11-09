/**
 * Where everything goes on each kind of frame, in venue px (y down). A frame holds one or more
 * sorting lines. Each line has an inlet funnel at the top (items fall into it from the plant, or
 * on a bank from the screen above), a fast belt in the adult band and a slow belt in the
 * children's band (one middle-speed belt on a kiosk), tubes from the inlet to each belt's start,
 * a hopper at each belt's end with a bucket lift back up to the inlet, and the bins.
 *
 * - panel: one line, items flowing right. The three household bins stand under the slow belt in
 *   the children's band; the drop-off box hangs under the fast belt in the adult band (four
 *   300 px mouths don't fit across one panel, and batteries and phones ride the fast belt).
 * - pair: two mirrored lines whose inlets sit either side of the middle and whose belts carry
 *   items outward, so people work at the outer sides; nothing to touch near the seam.
 * - kiosk: one line with one belt, all four bins in a row under it.
 * - wall: three lines side by side, each with all four bins in a row in the children's band.
 *
 * In `simple` there are two bins (recycling and rubbish) and no drop-off box.
 */
import { VENUE_SIZE } from "../../core/frame";
import type { FrameKind } from "../../core/types";
import { BIN_CAP, type Variant } from "./config";
import { type BinKind, binsFor } from "./items";
import { makePath, type Path, type Point } from "./paths";
import type { Mouth } from "./physics";

export type BeltSpeed = "slow" | "mid" | "fast";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Belt {
  id: number;
  line: number;
  speed: BeltSpeed;
  /** Item centres run from `start` to `end` (x) along the surface at height `y`. */
  start: number;
  end: number;
  y: number;
  dir: 1 | -1;
  length: number;
  /** Which items the inlet's diverter sends to it. */
  takes: "tricky" | "obvious" | "any";
  band: "child" | "adult";
  /** From the inlet's bottom to this belt's start, ending at a resting item's centre. */
  tube: Path;
  /** From the belt's end down into its hopper, up the bucket lift and over into the inlet. */
  lift: Path;
}

export interface BinSlot {
  id: number;
  line: number;
  kind: BinKind;
  /** Centre x, width, the rim's height and the bottom. */
  x: number;
  w: number;
  top: number;
  bottom: number;
  /** The opening between the rims. */
  mouth: Mouth;
  /** Belt that items pushed back out land on. */
  belt: number;
  band: "child" | "adult";
  cap: number;
  /** Drop-off boxes hang on the wall; wheelie bins stand on the floor. */
  wheels: boolean;
}

export interface Inlet {
  x: number;
  /** The funnel's mouth: items falling below this go in. */
  y: number;
  w: number;
  /** The funnel's spout, where tubes begin. */
  bottom: number;
}

export interface Line {
  index: number;
  x0: number;
  x1: number;
  inlet: Inlet;
  /** Where the line's own plant drops items when the frame runs alone. */
  spout: Point;
  /** On a wall, the chute from the plant down to the spout. */
  cascade: Path | null;
  belts: number[];
  bins: number[];
  /** Height and x of the bucket lift's rail. */
  liftX: number;
  liftBottom: number;
  liftTop: number;
}

export interface Layout {
  kind: FrameKind;
  variant: Variant;
  width: number;
  height: number;
  /** Item size (drawn) and collision radius. */
  d: number;
  r: number;
  adultTop: number;
  childTop: number;
  lines: Line[];
  belts: Belt[];
  bins: BinSlot[];
  /** Plant and park shown at the top when the frame runs on its own. */
  plant: Rect;
  park: Rect;
  /** Park things stand on this height. */
  ground: number;
  parkSlots: number;
  /** Below this, a falling item has missed every bin. */
  floor: number;
  seams: number[];
  /** Nothing to touch within this distance of a seam. */
  clear: number;
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: number[];
  variant: Variant;
}

/** Item sizes, venue px: at least 140 across on panels and 180 on the wall. */
export const ITEM_D: Record<FrameKind, number> = {
  panel: 150,
  pair: 150,
  kiosk: 140,
  wall: 190,
  screen: 150,
  sphere: 150,
};

/** A wall holds three lines side by side, each this wide in the default wall's venue px. */
const WALL_LINE = VENUE_SIZE.wall.width / 3;
/** Where a wall line's inlet sits from its left edge. */
const WALL_INLET = 295;

/** How far the inlet sits from a panel line's inner side, venue px. */
export const PANEL_INLET = 300;
/** Distance kept clear either side of a pair's seam. */
export const PAIR_CLEAR = 170;
const PANEL_W = 1080;

/**
 * Where each inlet sits across a touch frame, as a share of its width, for a bank's screen to
 * aim at. Matches layoutFor.
 */
export const inletsFor = (kind: FrameKind): number[] => {
  if (kind === "pair") {
    // Each half is a panel line stretched to half the frame, whatever the span.
    const off = PANEL_INLET / (2 * PANEL_W);
    return [0.5 - off, 0.5 + off];
  }
  if (kind === "kiosk") return [240 / 1920];
  if (kind === "wall") return [0, 1, 2].map((i) => (i * WALL_LINE + WALL_INLET) / (3 * WALL_LINE));
  return [PANEL_INLET / PANEL_W];
};

interface Builder {
  belts: Belt[];
  bins: BinSlot[];
  lines: Line[];
}

const capFor = (kind: FrameKind, variant: Variant) =>
  variant === "simple" ? BIN_CAP.simple : kind === "wall" ? BIN_CAP.wall : BIN_CAP.sort;

const addBin = (
  b: Builder,
  line: number,
  kind: BinKind,
  x: number,
  w: number,
  top: number,
  bottom: number,
  belt: number,
  childTop: number,
  rim: number,
  cap: number,
) => {
  b.bins.push({
    id: b.bins.length,
    line,
    kind,
    x,
    w,
    top,
    bottom,
    mouth: { x0: x - w / 2 + rim, x1: x + w / 2 - rim, y: top },
    belt,
    band: top >= childTop ? "child" : "adult",
    cap,
    wheels: kind !== "dropoff",
  });
};

const addBelt = (
  b: Builder,
  line: number,
  o: {
    speed: BeltSpeed;
    start: number;
    end: number;
    y: number;
    takes: Belt["takes"];
    childTop: number;
    tube: Point[];
    lift: Point[];
  },
): number => {
  const id = b.belts.length;
  b.belts.push({
    id,
    line,
    speed: o.speed,
    start: o.start,
    end: o.end,
    y: o.y,
    dir: o.end >= o.start ? 1 : -1,
    length: Math.abs(o.end - o.start),
    takes: o.takes,
    band: o.y >= o.childTop ? "child" : "adult",
    tube: makePath(o.tube),
    lift: makePath(o.lift),
  });
  return id;
};

/**
 * A panel-shaped line: `X(u)` maps distance from the line's inner side (the inlet's side) to
 * frame x, `Y(v)` scales heights; `side` is the inner side's sign (+1 when x grows outward).
 */
const panelLine = (
  b: Builder,
  index: number,
  X: (u: number) => number,
  Y: (v: number) => number,
  o: {
    variant: Variant;
    r: number;
    d: number;
    childTop: number;
    binW: number;
    /** Distance of the outermost bin's outer edge from the inner side. */
    outer: number;
    /** Where the slow belt starts, from the inner side. */
    slowAt: number;
    cap: number;
  },
) => {
  const { r, d, variant, childTop } = o;
  const inlet: Inlet = { x: X(PANEL_INLET), y: Y(430), w: 250, bottom: Y(520) };
  const liftX = X(1035);
  const liftTop = Y(330);
  const intoInlet = (): Point[] => [
    { x: liftX, y: liftTop },
    { x: inlet.x, y: liftTop },
    { x: inlet.x, y: inlet.y - d * 0.3 },
  ];
  const fastY = Y(760);
  const slowY = Y(1300);
  const sort = variant === "sort";
  const fastStart = X(250);
  const slowStart = X(o.slowAt);
  const end = X(990);
  const fast = addBelt(b, index, {
    speed: "fast",
    start: fastStart,
    end,
    y: fastY,
    takes: sort ? "tricky" : "any",
    childTop,
    tube: [
      { x: inlet.x, y: inlet.bottom },
      { x: inlet.x, y: Y(580) },
      { x: fastStart, y: Y(650) },
      { x: fastStart, y: fastY - r },
    ],
    lift: [{ x: end, y: fastY - r }, { x: liftX, y: fastY + d * 0.4 }, ...intoInlet()],
  });
  const pipe = X(90);
  const slow = addBelt(b, index, {
    speed: "slow",
    start: slowStart,
    end,
    y: slowY,
    takes: sort ? "obvious" : "any",
    childTop,
    tube: [
      { x: inlet.x, y: inlet.bottom },
      { x: inlet.x, y: Y(555) },
      { x: pipe, y: Y(620) },
      { x: pipe, y: Y(1170) },
      { x: slowStart, y: slowY - r },
    ],
    lift: [{ x: end, y: slowY - r }, { x: liftX, y: slowY + d * 0.4 }, ...intoInlet()],
  });
  const rim = d * 0.09;
  const kinds = binsFor(variant);
  const floorTop = Y(1465);
  const bottom = Y(1900);
  const household = kinds.filter((k) => k !== "dropoff");
  const n = household.length;
  const span = n * o.binW;
  // Household bins stand in a row from the outer edge inwards.
  household.forEach((kind, i) => {
    const u = o.outer - span + o.binW * (i + 0.5);
    addBin(b, index, kind, X(u), o.binW, floorTop, bottom, slow, childTop, rim, o.cap);
  });
  if (kinds.includes("dropoff")) {
    addBin(b, index, "dropoff", X(790), 330, Y(930), Y(1140), fast, childTop, rim, o.cap);
  }
  const lineBins = b.bins.filter((s) => s.line === index).map((s) => s.id);
  const xs = [X(0), X(PANEL_W)];
  b.lines.push({
    index,
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    inlet,
    spout: { x: inlet.x, y: Y(268) },
    cascade: null,
    belts: [fast, slow],
    bins: lineBins,
    liftX,
    liftBottom: slowY + d * 0.75,
    liftTop,
  });
};

const kioskLine = (
  b: Builder,
  X: (u: number) => number,
  Y: (v: number) => number,
  o: { variant: Variant; r: number; d: number; childTop: number; cap: number },
) => {
  const { r, d, variant, childTop } = o;
  const inlet: Inlet = { x: X(240), y: Y(384), w: 240, bottom: Y(462) };
  const liftX = X(1862);
  const liftTop = Y(306);
  const y = Y(592);
  const start = X(240);
  const end = X(1712);
  const belt = addBelt(b, 0, {
    speed: "mid",
    start,
    end,
    y,
    takes: "any",
    childTop,
    tube: [
      { x: inlet.x, y: inlet.bottom },
      { x: start, y: y - r },
    ],
    lift: [
      { x: end, y: y - r },
      { x: liftX, y: y + d * 0.45 },
      { x: liftX, y: liftTop },
      { x: inlet.x, y: liftTop },
      { x: inlet.x, y: inlet.y - d * 0.3 },
    ],
  });
  const kinds = binsFor(variant);
  const w = kinds.length === 4 ? 410 : 760;
  const left = 40;
  kinds.forEach((kind, i) => {
    addBin(
      b,
      0,
      kind,
      X(left + w * (i + 0.5)),
      w,
      Y(748),
      Y(1062),
      belt,
      childTop,
      d * 0.09,
      o.cap,
    );
  });
  b.lines.push({
    index: 0,
    x0: X(0),
    x1: X(1920),
    inlet,
    spout: { x: inlet.x, y: Y(236) },
    cascade: null,
    belts: [belt],
    bins: b.bins.map((s) => s.id),
    liftX,
    liftBottom: y + d * 0.8,
    liftTop,
  });
};

const wallLine = (
  b: Builder,
  index: number,
  X: (u: number) => number,
  Y: (v: number) => number,
  o: { variant: Variant; r: number; d: number; childTop: number; cap: number },
) => {
  const { r, d, variant, childTop } = o;
  const inlet: Inlet = { x: X(WALL_INLET), y: Y(1145), w: 265, bottom: Y(1235) };
  const liftX = X(1835);
  const liftTop = Y(1100);
  const fastY = Y(1500);
  const slowY = Y(1770);
  const sort = variant === "sort";
  const fastStart = X(400);
  const slowStart = X(180);
  const end = X(1670);
  const intoInlet = (): Point[] => [
    { x: liftX, y: liftTop },
    { x: inlet.x, y: liftTop },
    { x: inlet.x, y: inlet.y - d * 0.3 },
  ];
  const fast = addBelt(b, index, {
    speed: "fast",
    start: fastStart,
    end,
    y: fastY,
    takes: sort ? "tricky" : "any",
    childTop,
    tube: [
      { x: inlet.x, y: inlet.bottom },
      { x: inlet.x, y: Y(1290) },
      { x: fastStart, y: Y(1375) },
      { x: fastStart, y: fastY - r },
    ],
    lift: [{ x: end, y: fastY - r }, { x: liftX, y: fastY + d * 0.4 }, ...intoInlet()],
  });
  const pipe = X(105);
  const slow = addBelt(b, index, {
    speed: "slow",
    start: slowStart,
    end,
    y: slowY,
    takes: sort ? "obvious" : "any",
    childTop,
    tube: [
      { x: inlet.x, y: inlet.bottom },
      { x: inlet.x, y: Y(1270) },
      { x: pipe, y: Y(1330) },
      { x: pipe, y: Y(1620) },
      { x: slowStart, y: slowY - r },
    ],
    lift: [{ x: end, y: slowY - r }, { x: liftX, y: slowY + d * 0.4 }, ...intoInlet()],
  });
  const kinds = binsFor(variant);
  const w = kinds.length === 4 ? 380 : 710;
  kinds.forEach((kind, i) => {
    addBin(
      b,
      index,
      kind,
      X(35 + w * (i + 0.5)),
      w,
      Y(1890),
      Y(2150),
      slow,
      childTop,
      d * 0.09,
      o.cap,
    );
  });
  const outlet = X(675);
  b.lines.push({
    index,
    x0: X(0),
    x1: X(WALL_LINE),
    inlet,
    spout: { x: inlet.x, y: Y(1075) },
    cascade: makePath([
      { x: outlet, y: Y(805) },
      { x: X(420), y: Y(875) },
      { x: X(570), y: Y(940) },
      { x: inlet.x, y: Y(1020) },
      { x: inlet.x, y: Y(1075) },
    ]),
    belts: [fast, slow],
    bins: b.bins.filter((s) => s.line === index).map((s) => s.id),
    liftX,
    liftBottom: slowY + d * 0.75,
    liftTop,
  });
};

export const layoutFor = (input: LayoutInput): Layout => {
  const { kind, width: W, height: H, variant } = input;
  const nom = { w: VENUE_SIZE[kind].width, h: VENUE_SIZE[kind].height };
  const sx = W / nom.w;
  const sy = H / nom.h;
  const d = ITEM_D[kind] * Math.min(1, Math.max(0.5, Math.min(sx, sy)));
  const r = d * 0.45;
  const childTop = input.reachTop.child;
  const b: Builder = { belts: [], bins: [], lines: [] };
  const Y = (v: number) => v * sy;
  const cap = capFor(kind, variant);
  let plant: Rect;
  let park: Rect;
  let ground: number;
  let clear = 0;

  if (kind === "pair") {
    const half = W / 2;
    const hx = half / PANEL_W;
    clear = PAIR_CLEAR;
    const outer = 1068;
    const binW = (outer - PAIR_CLEAR - 4) / (variant === "simple" ? 2 : 3);
    // Left line runs outward to the left: its inner side is the middle.
    // The slow belt starts far enough out that its items are clear of the seam.
    const o = { variant, r, d, childTop, binW, outer, slowAt: PAIR_CLEAR + 40, cap };
    panelLine(b, 0, (u) => half - u * hx, Y, o);
    panelLine(b, 1, (u) => half + u * hx, Y, o);
    plant = { x: half - 460 * hx, y: Y(30), width: 920 * hx, height: Y(220) };
    park = { x: 20, y: 0, width: W - 40, height: Y(250) };
    ground = Y(248);
  } else if (kind === "kiosk") {
    kioskLine(b, (u) => u * sx, Y, { variant, r, d, childTop, cap });
    plant = { x: 60 * sx, y: Y(20), width: 360 * sx, height: Y(192) };
    park = { x: 450 * sx, y: 0, width: 1440 * sx, height: Y(218) };
    ground = Y(214);
  } else if (kind === "wall") {
    for (let i = 0; i < 3; i++) {
      wallLine(b, i, (u) => (i * WALL_LINE + u) * sx, Y, { variant, r, d, childTop, cap });
    }
    plant = { x: 135 * sx, y: Y(460), width: (3 * WALL_LINE - 270) * sx, height: Y(340) };
    park = { x: 0, y: 0, width: W, height: Y(420) };
    ground = Y(390);
  } else {
    const binW = variant === "simple" ? 500 : 340;
    panelLine(b, 0, (u) => u * sx, Y, {
      variant,
      r,
      d,
      childTop,
      binW,
      outer: 1064,
      slowAt: variant === "sort" ? 135 : 150,
      cap,
    });
    plant = { x: 150 * sx, y: Y(30), width: 300 * sx, height: Y(222) };
    park = { x: 470 * sx, y: 0, width: 590 * sx, height: Y(250) };
    ground = Y(248);
  }

  const slot = kind === "wall" ? 480 * sx : kind === "kiosk" ? 180 * sx : 140 * sx;
  const parkSlots =
    kind === "pair"
      ? 2 * Math.max(1, Math.floor((plant.x - park.x) / slot))
      : Math.max(1, Math.min(12, Math.floor(park.width / slot)));

  return {
    kind,
    variant,
    width: W,
    height: H,
    d,
    r,
    adultTop: input.reachTop.adult,
    childTop,
    lines: b.lines,
    belts: b.belts,
    bins: b.bins,
    plant,
    park,
    ground,
    parkSlots: Math.min(12, parkSlots),
    floor: H - d * 0.1,
    seams: input.seams,
    clear,
  };
};

/** The bin slots of one line. */
export const lineBins = (layout: Layout, line: number): BinSlot[] =>
  layout.bins.filter((b) => b.line === line);

/** The bin of a given kind on a line, if the line has one. */
export const binOfKind = (layout: Layout, line: number, kind: BinKind): BinSlot | undefined =>
  layout.bins.find((b) => b.line === line && b.kind === kind);
