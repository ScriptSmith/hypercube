/**
 * Where everything goes, in venue px with y down. A frame holds one block per question it shows.
 * Touch frames merged from several panels repeat their blocks in every panel, so nobody reaches
 * across a seam and no button or pipe straddles one.
 *
 * Every tube is fed from above by a pipe: a ball rides up the pipe beside its tube, over the top
 * and drops out of an outlet into the mouth. A tube and its pipe stand together over the answer's
 * button, and the pipe starts on the button's top edge.
 *
 * - wall: one block across the wall with its buttons in the child band, each tube rising from its
 *   button; in `two` the children's question takes the left half and the adults' the right, with
 *   its buttons in the adult band.
 * - panel (and each panel of a pair): text at the top, tubes in the middle, buttons at the bottom
 *   in the child band. More than four answers take two rows: each column of the grid holds two
 *   buttons and two tubes, the upper button's pipe on the column's left and the lower button's
 *   pipe on its right, rising beside the upper button. In `two` the adults' block sits above the
 *   child band and the children's block in it.
 * - kiosk: as a panel, landscape; `two` splits it into left and right halves.
 * - feeder (a bank's touch frame under a screen): only buttons, filling the reachable band in two
 *   columns either side of a riser up the middle of each panel. A ball leaves its button through
 *   a short stub into the riser and goes off the top edge into the screen above.
 * - screen: text and tubes, each answer's picture under its tube, and at the bottom the network
 *   (network.ts) that takes balls from the panels below to their tubes; `two` splits the tubes.
 */
import type { FrameKind } from "../../core/types";
import { displayFor } from "../../core/venue";
import type { TubeGeom } from "./chart";
import { buildNetwork, type Network } from "./network";
import { filleted, type Path, type Pt, type Spout, spoutPoints } from "./pipes";
import type { NodeSpot } from "./transit";

export type { Spout } from "./pipes";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonSpot extends Box {
  answer: number;
}

export interface LabelSpot {
  answer: number;
  /** Centre x, top y, and picture size. */
  cx: number;
  y: number;
  size: number;
  /** Widest the word under it may be. */
  w: number;
}

/** A pipe as drawn. */
export interface PipeDef {
  path: Path;
  inner: number;
  wall: number;
  /** Answer colour, or -1 for a pipe every answer shares. */
  color: number;
  /** Collars where it meets a button, and the nozzle over a tube. */
  intake: boolean;
  outlet: boolean;
}

/** A way a ball can go: its path, the junctions it passes, and the ball's radius. */
export interface Way {
  path: Path;
  nodes: NodeSpot[];
  r: number;
  /** Ends over a tube here, rather than off the frame's top edge. */
  lands: boolean;
}

export interface Block {
  /** Question slot: 0 for the only (or the children's) question, 1 for the adults'. */
  slot: number;
  /** Which panel of a merged frame, left to right. */
  cell: number;
  region: Box;
  text: Box;
  /** Largest font size for the question, venue px. */
  textSize: number;
  tubes: TubeGeom[];
  /** One per tube, in the same order. */
  spouts: Spout[];
  buttons: ButtonSpot[];
  labels: LabelSpot[];
  /** Per answer, where a press sends its ball, on frames with buttons. */
  ways: (Way | null)[];
  /** Balls across a tube at the largest scale. */
  n0: number;
  /** Glass thickness, venue px. */
  glass: number;
}

export interface Layout {
  W: number;
  H: number;
  blocks: Block[];
  pipes: PipeDef[];
  /** Feeder frames: each panel's riser x. */
  risers: number[];
  /** Screens: the pipes from the bank below. */
  network: Network | null;
}

export interface LayoutInput {
  kind: FrameKind;
  W: number;
  H: number;
  /** Panels in the frame (merged pairs). */
  span: number;
  /** Venue y of the top of adult and child reach. */
  adultTop: number;
  childTop: number;
  variant: "one" | "two";
  /** Answers per slot. */
  answers: readonly number[];
  /** A bank's touch frame while its screen is up: buttons only. */
  feeder?: boolean;
  /** Screens: x of each touch panel's riser where it meets the bottom edge. */
  inlets?: readonly number[];
}

/** Narrowest buttons per kind, venue px. */
export const MIN_BUTTON: Record<FrameKind, number> = {
  panel: 240,
  pair: 240,
  wall: 360,
  kiosk: 200,
  screen: 0,
  sphere: 0,
};

/** Inside diameter of the pipes that carry balls between frames, metres. */
export const NET_PIPE_M = 0.12;
/** A network ball's radius, as a share of the pipe's inside diameter. */
const NET_BALL = 0.4;
/** A pipe's inside diameter, as balls of a tube's largest size across. */
const PIPE_BALLS = 1.2;

export const metresPerPx = (kind: FrameKind, span = 1): number => {
  const d = displayFor(kind, span);
  return d.widthM / d.width;
};

/** Pipe sizes for balls between frames, on a frame of `kind`. */
export const netSizes = (kind: FrameKind) => {
  const inner = NET_PIPE_M / metresPerPx(kind === "pair" ? "panel" : kind);
  const wall = inner * 0.12;
  return { inner, wall, outer: inner + 2 * wall, r: inner * NET_BALL };
};

const EMPTY: Box = { x: 0, y: 0, w: 0, h: 0 };

/** The hook over a tube: its bend, the straight drop to the outlet, and the room it all takes. */
const hookOf = (outer: number, dx: number) => {
  const bend = Math.max(1, Math.min(0.8 * outer, Math.abs(dx) / 2));
  const gapOut = Math.max(8, 0.18 * outer);
  const drop = 0.4 * outer;
  return { bend, gapOut, drop, height: gapOut + drop + bend + outer / 2 };
};

interface TouchSpec {
  slot: number;
  cell: number;
  region: Box;
  answers: number;
  textTop: number;
  textH: number;
  textSize: number;
  /** Keeps the text clear of the top corners, where the runtime's Home control goes. */
  textInset?: number;
  /** Space between the text and the tops of the pipes. */
  minHead: number;
  rows: 1 | 2;
  btnH: number;
  /** Bottom of the lowest row of buttons. */
  btnBottom: number;
  gap: number;
  mx: number;
  maxBtnW: number;
  tubeFrac: number;
  maxTubeW: number;
  chartGap: number;
  n0: number;
  glass: number;
  /** Air between a tube's glass and its pipe. */
  clear: number;
}

interface Placed {
  answer: number;
  button: ButtonSpot;
  /** Tube inside x, and the pipe's x and which way it hooks over (+1 right, -1 left). */
  x0: number;
  px: number;
}

const cornerOf = (w: number, h: number) => 0.14 * Math.min(w, h);

/** A button, a tube and a pipe on the tube's right, centred over the button. */
const unitOver = (answer: number, button: ButtonSpot, wt: number, outer: number, b: TouchSpec) => {
  const g = b.glass;
  const unit = wt + 4 * g + b.clear + outer;
  const cx = button.x + button.w / 2;
  const x0 = cx - unit / 2 + g;
  return { answer, button, x0, px: x0 + wt + g + b.clear + g + outer / 2 };
};

const touchBlock = (b: TouchSpec): Block => {
  const r = b.region;
  const inset = b.mx + (b.textInset ?? 0);
  const text: Box = { x: r.x + inset, y: r.y + b.textTop, w: r.w - 2 * inset, h: b.textH };
  const inner = r.w - 2 * b.mx;
  const n = b.answers;
  const g = b.glass;
  const k = PIPE_BALLS / b.n0;
  const outerOf = (wt: number) => k * wt + 2 * g;
  const placed: Placed[] = [];
  let wt: number;
  let chartBottom: number;

  if (b.rows === 1) {
    const cw = inner / n;
    const w = Math.min(cw - b.gap, b.maxBtnW);
    const room = w - cornerOf(w, b.btnH) - 4 * g - b.clear;
    wt = Math.min(b.maxTubeW, cw * b.tubeFrac, room / (1 + k));
    for (let i = 0; i < n; i++) {
      const cx = r.x + b.mx + (i + 0.5) * cw;
      const button = { answer: i, x: cx - w / 2, y: b.btnBottom - b.btnH, w, h: b.btnH };
      placed.push(unitOver(i, button, wt, outerOf(wt), b));
    }
    chartBottom = b.btnBottom - b.btnH - b.chartGap;
  } else {
    const cols = Math.ceil(n / 2);
    const cw = inner / cols;
    const span = cw - b.gap;
    const ins = cornerOf(span, b.btnH) / 2;
    const tubeGap = b.gap;
    // Inset, pipe, air, glass, tube, glass, gap, glass, tube, glass, air, pipe, inset.
    wt = Math.min(b.maxTubeW, (span - 2 * ins - 2 * b.clear - 8 * g - tubeGap) / (2 + 2 * k));
    const outer = outerOf(wt);
    const upper = b.btnBottom - 2 * b.btnH - b.gap;
    for (let c = 0; c < cols; c++) {
      const L = r.x + b.mx + c * cw + b.gap / 2;
      const R = L + span;
      const i0 = 2 * c;
      const i1 = 2 * c + 1;
      if (i1 >= n) {
        const button = { answer: i0, x: L, y: b.btnBottom - b.btnH, w: R - L, h: b.btnH };
        placed.push(unitOver(i0, button, wt, outer, b));
        continue;
      }
      const pA = L + ins + outer / 2;
      const t1 = pA + outer / 2 + b.clear + g;
      const t2 = t1 + wt + 2 * g + tubeGap;
      const pB = t2 + wt + g + b.clear + outer / 2;
      const channel = pB - outer / 2 - b.gap / 2;
      placed.push({
        answer: i0,
        button: { answer: i0, x: L, y: upper, w: channel - L, h: b.btnH },
        x0: t1,
        px: pA,
      });
      placed.push({
        answer: i1,
        button: { answer: i1, x: L, y: b.btnBottom - b.btnH, w: R - L, h: b.btnH },
        x0: t2,
        px: pB,
      });
    }
    chartBottom = upper - b.chartGap;
  }

  const outer = outerOf(wt);
  let head = 0;
  for (const p of placed) head = Math.max(head, hookOf(outer, p.x0 + wt / 2 - p.px).height);
  const top = text.y + text.h + b.minHead + head;
  const bottom = Math.max(top + 40, chartBottom);
  placed.sort((p, q) => p.answer - q.answer);
  const tubes: TubeGeom[] = [];
  const spouts: Spout[] = [];
  const ways: Way[] = [];
  for (const p of placed) {
    const cx = p.x0 + wt / 2;
    const hook = hookOf(outer, cx - p.px);
    tubes.push({ answer: p.answer, x0: p.x0, x1: p.x0 + wt, top, bottom });
    const spout: Spout = {
      answer: p.answer,
      x: p.px,
      cx,
      yOut: top - hook.gapOut,
      bend: hook.bend,
      drop: hook.drop,
      inner: k * wt,
      wall: g,
    };
    spouts.push(spout);
    const { pts, radii } = spoutPoints(spout, { x: p.px, y: p.button.y });
    ways.push({
      path: filleted(pts, radii),
      nodes: [{ id: `p${b.slot}.${b.cell}.${p.answer}`, x: p.px, y: p.button.y }],
      r: wt / (2 * b.n0),
      lands: true,
    });
  }
  return {
    slot: b.slot,
    cell: b.cell,
    region: r,
    text,
    textSize: b.textSize,
    tubes,
    spouts,
    buttons: placed.map((p) => p.button),
    labels: [],
    ways,
    n0: b.n0,
    glass: g,
  };
};

const clampRows = (n: number, inner: number, gap: number, minW: number): 1 | 2 =>
  n > 1 && inner / n - gap < minW ? 2 : 1;

const wall = (i: LayoutInput): Block[] => {
  const { W, H } = i;
  const childTop = Math.min(H - 300, Math.max(H * 0.5, i.childTop));
  const adultTop = Math.min(childTop - 240, Math.max(H * 0.35, i.adultTop));
  const lowH = Math.min(440, H - childTop - 100);
  const base = {
    textTop: 60,
    textH: 220,
    minHead: 30,
    rows: 1 as const,
    gap: 90,
    maxBtnW: 760,
    tubeFrac: 0.5,
    maxTubeW: 470,
    chartGap: 60,
    n0: 4,
    glass: 12,
    clear: 24,
  };
  if (i.variant === "one") {
    return [
      touchBlock({
        ...base,
        slot: 0,
        cell: 0,
        region: { x: 0, y: 0, w: W, h: H },
        answers: i.answers[0] ?? 2,
        textSize: 150,
        btnH: lowH,
        btnBottom: H - 110,
        mx: 160,
      }),
    ];
  }
  const half = W / 2;
  const highH = Math.max(200, Math.min(300, childTop - adultTop - 40));
  return [
    touchBlock({
      ...base,
      slot: 0,
      cell: 0,
      region: { x: 0, y: 0, w: half, h: H },
      answers: i.answers[0] ?? 2,
      textSize: 130,
      btnH: lowH,
      btnBottom: H - 110,
      mx: 130,
    }),
    touchBlock({
      ...base,
      slot: 1,
      cell: 0,
      region: { x: half, y: 0, w: half, h: H },
      answers: i.answers[1] ?? 2,
      textSize: 130,
      btnH: highH,
      btnBottom: adultTop + 20 + highH,
      mx: 130,
      gap: 70,
    }),
  ];
};

const panelCell = (i: LayoutInput, cell: number, x: number, w: number): Block[] => {
  const { H } = i;
  const childTop = Math.min(H - 600, Math.max(H * 0.3, i.childTop));
  const mx = 20;
  const gap = 16;
  const minW = MIN_BUTTON.panel;
  const shared = {
    cell,
    mx,
    gap,
    maxBtnW: 520,
    n0: 3,
    glass: 6,
    clear: 10,
    textInset: 130,
    maxTubeW: 220,
  };
  if (i.variant === "one") {
    const n = i.answers[0] ?? 2;
    const rows = n > 4 ? 2 : clampRows(n, w - 2 * mx, gap, minW);
    return [
      touchBlock({
        ...shared,
        slot: 0,
        region: { x, y: 0, w, h: H },
        answers: n,
        textTop: 40,
        textH: 200,
        textSize: 72,
        minHead: 24,
        rows,
        btnH: rows === 1 ? 290 : 250,
        btnBottom: H - 40,
        tubeFrac: 0.6,
        chartGap: 40,
      }),
    ];
  }
  const nKid = i.answers[0] ?? 2;
  const nAdult = i.answers[1] ?? 2;
  const kidRows = nKid > 4 ? 2 : clampRows(nKid, w - 2 * mx, gap, minW);
  const adultRows = nAdult > 4 ? 2 : clampRows(nAdult, w - 2 * mx, gap, minW);
  const adultH = childTop - 10;
  return [
    touchBlock({
      ...shared,
      slot: 0,
      region: { x, y: childTop, w, h: H - childTop },
      answers: nKid,
      textTop: 16,
      textH: 110,
      textSize: 54,
      minHead: 10,
      rows: kidRows,
      btnH: kidRows === 1 ? 260 : 240,
      btnBottom: H - 40,
      tubeFrac: 0.6,
      chartGap: 30,
    }),
    touchBlock({
      ...shared,
      slot: 1,
      region: { x, y: 0, w, h: adultH },
      answers: nAdult,
      textTop: 24,
      textH: 130,
      textSize: 58,
      minHead: 10,
      rows: adultRows,
      btnH: adultRows === 1 ? 260 : 240,
      btnBottom: adultH - 20,
      tubeFrac: 0.6,
      chartGap: 30,
    }),
  ];
};

/** A bank's touch panel under its screen: buttons only, and the riser up the middle. */
const feederCell = (
  i: LayoutInput,
  cell: number,
  x: number,
  w: number,
): { blocks: Block[]; pipes: PipeDef[]; riser: number } => {
  const { H } = i;
  const childTop = Math.min(H - 600, Math.max(H * 0.3, i.childTop));
  const net = netSizes("panel");
  const rx = x + w / 2;
  const mx = 20;
  const gap = 16;
  const channel = net.outer + 2 * 14;
  const regions: { slot: number; region: Box }[] =
    i.variant === "one"
      ? [{ slot: 0, region: { x, y: childTop + 10, w, h: H - 30 - childTop - 10 } }]
      : [
          { slot: 0, region: { x, y: childTop + 10, w, h: H - 30 - childTop - 10 } },
          { slot: 1, region: { x, y: 30, w, h: childTop - 50 } },
        ];
  const blocks: Block[] = [];
  const stubs: { block: number; answer: number; edge: Pt; from: Pt; cy: number }[] = [];
  for (const { slot, region } of regions) {
    const n = i.answers[slot] ?? 2;
    const rows = Math.ceil(n / 2);
    const rowH = (region.h - (rows - 1) * gap) / rows;
    const left = { x0: region.x + mx, x1: rx - channel / 2 };
    const right = { x0: rx + channel / 2, x1: region.x + region.w - mx };
    const buttons: ButtonSpot[] = [];
    for (let a = 0; a < n; a++) {
      const row = Math.floor(a / 2);
      const onLeft = a % 2 === 0;
      const col = onLeft ? left : right;
      // An odd last answer on the right stretches down to fill the column.
      const tall = !onLeft && a === n - 2 && n % 2 === 1;
      const y = region.y + row * (rowH + gap);
      const h = tall ? 2 * rowH + gap : rowH;
      buttons.push({ answer: a, x: col.x0, y, w: col.x1 - col.x0, h });
      // The ball starts on the button's inner edge, or a little in from it, far enough from the
      // riser that a ball waiting there is clear of the balls rushing past.
      const back = Math.max(0, 2.3 * net.r - channel / 2);
      stubs.push({
        block: blocks.length,
        answer: a,
        edge: { x: onLeft ? col.x1 : col.x0, y: y + h / 2 },
        from: { x: onLeft ? col.x1 - back : col.x0 + back, y: y + h / 2 },
        cy: y + h / 2,
      });
    }
    blocks.push({
      slot,
      cell,
      region,
      text: EMPTY,
      textSize: 0,
      tubes: [],
      spouts: [],
      buttons,
      labels: [],
      ways: buttons.map(() => null),
      n0: 3,
      glass: 6,
    });
  }
  // Junctions on the riser: every stub, and points between them, which the balls book in turn.
  const lowest = Math.max(...stubs.map((s) => s.cy));
  const spots = new Set<number>(stubs.map((s) => Math.round(s.cy)));
  for (let y = lowest; y > -net.r; y -= 2.5 * net.outer) spots.add(Math.round(y));
  spots.add(Math.round(-net.r));
  const ys = [...spots].sort((a, b) => a - b);
  const bend = Math.min(0.8 * net.outer, channel / 2);
  const pipes: PipeDef[] = [];
  for (const s of stubs) {
    const path = filleted([s.from, { x: rx, y: s.cy }, { x: rx, y: -net.r * 1.2 }], [0, bend, 0]);
    const nodes: NodeSpot[] = [{ id: `s${cell}.${s.block}.${s.answer}`, x: s.from.x, y: s.from.y }];
    for (const [k, y] of ys.entries()) {
      if (y <= s.cy + 0.5) nodes.push({ id: `r${cell}:${k}`, x: rx, y });
    }
    blocks[s.block]!.ways[s.answer] = { path, nodes, r: net.r, lands: false };
    // The stub stops at the riser's inside, so its own inside opens the riser's wall.
    const into = rx + (s.edge.x < rx ? -1 : 1) * (net.inner / 2 - 1);
    pipes.push({
      path: filleted([s.edge, { x: into, y: s.cy }], 0),
      inner: net.inner,
      wall: net.wall,
      color: s.answer,
      intake: true,
      outlet: false,
    });
  }
  pipes.unshift({
    path: filleted(
      [
        { x: rx, y: lowest + net.inner / 2 },
        { x: rx, y: -net.outer },
      ],
      0,
    ),
    inner: net.inner,
    wall: net.wall,
    color: -1,
    intake: false,
    outlet: false,
  });
  return { blocks, pipes, riser: rx };
};

const kiosk = (i: LayoutInput): Block[] => {
  const { W, H } = i;
  const mx = 24;
  const gap = 16;
  const minW = MIN_BUTTON.kiosk;
  const one = (slot: number, x: number, w: number, n: number, textSize: number): Block => {
    const rows = clampRows(n, w - 2 * mx, gap, minW);
    return touchBlock({
      slot,
      cell: 0,
      region: { x, y: 0, w, h: H },
      answers: n,
      textTop: 24,
      textH: 120,
      textSize,
      textInset: 150,
      minHead: 12,
      rows,
      btnH: rows === 1 ? 230 : 190,
      btnBottom: H - 24,
      gap,
      mx,
      maxBtnW: 420,
      tubeFrac: 0.55,
      maxTubeW: 240,
      chartGap: 30,
      n0: 4,
      glass: 5,
      clear: 10,
    });
  };
  if (i.variant === "one") return [one(0, 0, W, i.answers[0] ?? 2, 64)];
  return [one(0, 0, W / 2, i.answers[0] ?? 2, 52), one(1, W / 2, W / 2, i.answers[1] ?? 2, 52)];
};

/** The screen's network band: the header's centre line sits this far above the bottom. */
const HEADER_UP = 175;

const headerOf = (net: ReturnType<typeof netSizes>) => ({ inner: 2.4 * 2 * net.r, wall: net.wall });

/** The screen's network for these blocks and the panels below at `inlets`. */
export const networkFor = (
  W: number,
  H: number,
  blocks: readonly Block[],
  inlets: readonly number[],
): Network => {
  const pipe = netSizes("screen");
  return buildNetwork({
    W,
    H,
    blocks,
    inlets: inlets.length ? inlets : [W / 2],
    pipe,
    header: headerOf(pipe),
    yHeader: H - HEADER_UP,
  });
};

const screen = (i: LayoutInput): { blocks: Block[]; network: Network } => {
  const { W, H } = i;
  const net = netSizes("screen");
  const header = headerOf(net);
  const yHeader = H - HEADER_UP;
  const regionH = yHeader - (header.inner + 2 * header.wall) / 2 - 50;
  const glass = 12;
  const clear = 22;
  const one = (slot: number, x: number, w: number, n: number, two: boolean): Block => {
    const mx = two ? 110 : 180;
    const cw = (w - 2 * mx) / n;
    const textTop = 140;
    const textH = two ? 380 : 460;
    const labelH = two ? 330 : 420;
    const chartGap = 60;
    const wt = Math.min(two ? 360 : 560, cw * 0.62, cw - 40 - 4 * glass - clear - net.outer);
    const tubes: TubeGeom[] = [];
    const spouts: Spout[] = [];
    const labels: LabelSpot[] = [];
    const unit = wt + 4 * glass + clear + net.outer;
    const hook = hookOf(net.outer, -(wt / 2 + 2 * glass + clear + net.outer / 2));
    const top = textTop + textH + 40 + hook.height;
    const bottom = Math.max(top + 40, regionH - labelH - chartGap);
    for (let a = 0; a < n; a++) {
      const sx = x + mx + (a + 0.5) * cw;
      const x0 = sx - unit / 2 + glass;
      const cx = x0 + wt / 2;
      tubes.push({ answer: a, x0, x1: x0 + wt, top, bottom });
      spouts.push({
        answer: a,
        x: x0 + wt + 2 * glass + clear + net.outer / 2,
        cx,
        yOut: top - hook.gapOut,
        bend: hook.bend,
        drop: hook.drop,
        inner: net.inner,
        wall: net.wall,
      });
      // A picture is no wider than its tube's glass and gap, so the branch beside it climbs clear.
      const w = 2 * (wt / 2 + 2 * glass + clear) - 10;
      labels.push({
        answer: a,
        cx,
        y: bottom + chartGap * 0.6,
        size: Math.min(cw * 0.6, two ? 200 : 270, labelH * 0.66, w),
        w,
      });
    }
    return {
      slot,
      cell: 0,
      region: { x, y: 0, w, h: regionH },
      text: { x: x + mx, y: textTop, w: w - 2 * mx, h: textH },
      textSize: two ? 150 : 210,
      tubes,
      spouts,
      buttons: [],
      labels,
      ways: [],
      n0: 4,
      glass,
    };
  };
  const blocks =
    i.variant === "one"
      ? [one(0, 0, W, i.answers[0] ?? 2, false)]
      : [one(0, 0, W / 2, i.answers[0] ?? 2, true), one(1, W / 2, W / 2, i.answers[1] ?? 2, true)];
  return { blocks, network: networkFor(W, H, blocks, i.inlets ?? []) };
};

/** Pipes drawn for the feeds of a touch frame's own tubes. */
const feedPipes = (blocks: readonly Block[]): PipeDef[] =>
  blocks.flatMap((b) =>
    b.spouts.map((s, k) => ({
      path: b.ways[s.answer]?.path ?? filleted([], 0),
      inner: s.inner,
      wall: s.wall,
      color: b.tubes[k]?.answer ?? s.answer,
      intake: true,
      outlet: true,
    })),
  );

export const layoutFrame = (i: LayoutInput): Layout => {
  const base = { W: i.W, H: i.H, risers: [] as number[], network: null };
  if (i.kind === "wall") {
    const blocks = wall(i);
    return { ...base, blocks, pipes: feedPipes(blocks) };
  }
  if (i.kind === "kiosk") {
    const blocks = kiosk(i);
    return { ...base, blocks, pipes: feedPipes(blocks) };
  }
  if (i.kind === "screen") {
    const { blocks, network } = screen(i);
    return { ...base, blocks, pipes: network.pipes, network };
  }
  const span = Math.max(1, Math.floor(i.span));
  const w = i.W / span;
  const blocks: Block[] = [];
  const pipes: PipeDef[] = [];
  const risers: number[] = [];
  for (let c = 0; c < span; c++) {
    if (i.feeder) {
      const f = feederCell(i, c, c * w, w);
      blocks.push(...f.blocks);
      pipes.push(...f.pipes);
      risers.push(f.riser);
    } else blocks.push(...panelCell(i, c, c * w, w));
  }
  return { ...base, blocks, pipes: i.feeder ? pipes : feedPipes(blocks), risers };
};

/** Seams of a merged frame, venue px. */
export const seamsOf = (W: number, span: number): number[] =>
  Array.from({ length: Math.max(0, span - 1) }, (_, k) => ((k + 1) * W) / span);

/** The button under (x, y), with its block, or null. */
export const buttonAt = (
  layout: Layout,
  x: number,
  y: number,
): { block: Block; button: ButtonSpot } | null => {
  for (const block of layout.blocks) {
    for (const button of block.buttons) {
      if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h)
        return { block, button };
    }
  }
  return null;
};
