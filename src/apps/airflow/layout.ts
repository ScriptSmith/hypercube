/**
 * Where everything goes, in venue px (y down), and how the venue maps onto the lattice.
 *
 * - Wall and kiosk: one tunnel across the frame, wind blowing to the right. A desk at the
 *   upstream end holds the wind slider and the view switch (in the wall's adult band). Lanes
 *   follow it, one per sting: each has a column of shape tiles and a handle the shape rides on.
 * - Panel: an updraft, wind blowing up from a vent along the bottom. A console along the
 *   outer edge holds the view switch, the wind slider and the shape tiles; the chimney beside
 *   it holds one sting. A pair is two panels' worth, mirrored so the consoles sit at its outer
 *   edges, with a wall at the seam; both chimneys share one lattice.
 * - Screen: an updraft across the whole screen, fed by the plumes of the frames below.
 *
 * Each sting has a smaller and a bigger button, bigger on top: stacked beside its angle knob on
 * the wall, on its rod above the knob on panels, and at the top of its tile column on the kiosk,
 * where the knob rides too close to the shape. None of them costs the handle any travel.
 *
 * A sting's `travel` is its handle's range at the usual size. A shape must stay inside its
 * `region` (its lane of the tunnel, or its chimney) at any angle, so as it grows the handle's
 * range shrinks (`travelAt`), and a narrow lane caps how large it can grow (`scales`).
 *
 * The lattice frame runs x downstream and y across (see lattice.ts). For the wall that is y up;
 * for an updraft it is y to the left, so both are right-handed as drawn.
 */
import type { FrameKind, Reach } from "../../core/types";
import { EXHAUST, KINDS, type KindSpec, PLUME_SAMPLES, type View, VIEWS } from "./config";
import { REACH, REACHES, type ShapeId } from "./shapes";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Flow = "right" | "up";

/** (x, y) to (r0 . (x, y, 1), r1 . (x, y, 1)). */
export interface Affine {
  r0: [number, number, number];
  r1: [number, number, number];
}

export const apply = (m: Affine, x: number, y: number): [number, number] => [
  m.r0[0] * x + m.r0[1] * y + m.r0[2],
  m.r1[0] * x + m.r1[1] * y + m.r1[2],
];

export interface Tunnel {
  flow: Flow;
  /** The visible tunnel in venue px. */
  rect: Box;
  /** Venue px per cell. */
  cell: number;
  /** Lattice size, including the hidden exhaust beyond the outlet edge. */
  width: number;
  height: number;
  /** Columns that show; the rest hold the sponge. */
  visible: number;
  toGrid: Affine;
  toVenue: Affine;
  /** Venue directions of the lattice's x (downstream) and y. */
  down: [number, number];
  across: [number, number];
}

export const makeTunnel = (flow: Flow, rect: Box, cellTarget: number): Tunnel => {
  const { x: x0, y: y0, width: w, height: h } = rect;
  if (flow === "right") {
    const height = Math.max(8, Math.round(h / cellTarget));
    const cell = h / height;
    const visible = Math.max(8, Math.round(w / cell));
    const width = visible + Math.max(8, Math.ceil(visible * EXHAUST));
    return {
      flow,
      rect,
      cell,
      width,
      height,
      visible,
      toGrid: { r0: [1 / cell, 0, -x0 / cell], r1: [0, -1 / cell, (y0 + h) / cell] },
      toVenue: { r0: [cell, 0, x0], r1: [0, -cell, y0 + h] },
      down: [1, 0],
      across: [0, -1],
    };
  }
  const height = Math.max(8, Math.round(w / cellTarget));
  const cell = w / height;
  const visible = Math.max(8, Math.round(h / cell));
  const width = visible + Math.max(8, Math.ceil(visible * EXHAUST));
  return {
    flow,
    rect,
    cell,
    width,
    height,
    visible,
    toGrid: { r0: [0, -1 / cell, (y0 + h) / cell], r1: [-1 / cell, 0, (x0 + w) / cell] },
    toVenue: { r0: [0, -cell, x0 + w], r1: [-cell, 0, y0 + h] },
    down: [0, -1],
    across: [-1, 0],
  };
};

/** A wind slider: the thumb runs from `from` (gentle) to `to` (strong), centres in venue px. */
export interface Slider {
  zone: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  thumb: number;
}

export interface ViewButton {
  zone: number;
  view: View;
  box: Box;
}

/** One stretch of inlet with its own wind and view: a pair's half, or the whole tunnel. */
export interface Zone {
  index: number;
  /** Lattice rows (across the stream) this zone's inlet feeds. */
  rows: [number, number];
  /** The part of the tunnel it shows, venue px. */
  rect: Box;
  slider: Slider | null;
  views: ViewButton[];
  /** Background behind its controls (the updraft's console), venue px. */
  console: Box | null;
  /** Which side its console is on. */
  side: "left" | "right";
}

export interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Sting {
  index: number;
  zone: number;
  /** Where the handle's centre can go with the shape at its usual size (see `travelAt`). */
  travel: Range;
  /** Where any part of the shape may go: its lane of the tunnel or its chimney. */
  region: Range;
  /** Shape centre y with the handle at travel.y0 and at travel.y1 (x is the handle's). */
  shapeY: [number, number];
  /** The angle knob sits at this y, or `knobOffset` above the handle when null. */
  knobY: number | null;
  knobOffset: number;
  /** The handle's resting place, as fractions of its travel. */
  home: { u: number; v: number };
  /** Shape tiles. */
  tiles: Box[];
  size: number;
  handle: number;
  knob: number;
  /** The size steps (multiples of `size`) this sting's lane has room for, and the buttons' side. */
  scales: readonly number[];
  sizeButton: number;
  /** The size buttons' centres: fixed, or relative to the knob's centre. */
  sizeAt: { on: "knob" | "fixed"; smaller: [number, number]; bigger: [number, number] };
}

export interface Layout {
  kind: FrameKind;
  venue: { width: number; height: number };
  adultTop: number;
  childTop: number;
  tunnel: Tunnel;
  zones: Zone[];
  stings: Sting[];
  /** Solid walls in lattice cells [x0, y0, x1, y1): a pair's seam. */
  walls: [number, number, number, number][];
  finger: number;
  /** Where a touch frame samples its plume: a line just below its top edge. */
  plume: { line: number; width: number; samples: number } | null;
  seams: number[];
  /** Grille drawn along an updraft's vent, venue px. */
  vents: Box[];
  spec: KindSpec;
}

export interface LayoutInput {
  kind: FrameKind;
  venue: { width: number; height: number };
  reach: Reach;
  /** Number of stings (wall). */
  shapes: number;
  /** Multiplier on the lattice cell (coarser for low res and software GPUs). */
  coarse: number;
  /** Panels in a merged frame. */
  span: number;
  /** Variant without shapes. */
  hands: boolean;
}

/** Nothing a visitor touches comes closer than this to a seam. */
export const SEAM_MARGIN = 120;

/** Room a shape keeps from its region's edges, venue px. */
const REGION_MARGIN = 20;
/** A seam's wall is two cells thick: a shape keeps this far from a seam or a console. */
const CHIMNEY_MARGIN = 30;

/**
 * The size steps a sting has room for: each one up to the largest at which every shape, at any
 * angle, leaves its handle at least half the handle's width of travel each way.
 */
const roomFor = (s: Sting, sizes: readonly number[]): number[] => {
  const out: number[] = [];
  for (const k of sizes) {
    const t = travelAt(s, k);
    const need = s.handle / 2;
    if (k > 1 && (t.x1 - t.x0 < need || t.y1 - t.y0 < need)) break;
    out.push(k);
  }
  return out;
};

const box = (cx: number, cy: number, w: number, h = w): Box => ({
  x: cx - w / 2,
  y: cy - h / 2,
  width: w,
  height: h,
});

const viewButtons = (zone: number, centres: [number, number][], size: number): ViewButton[] =>
  VIEWS.map((view, i) => {
    const [x, y] = centres[i]!;
    return { zone, view, box: box(x, y, size) };
  });

/** Wall and kiosk: a horizontal tunnel. */
const tunnelLayout = (input: LayoutInput, spec: KindSpec): Layout => {
  const { venue, kind } = input;
  const W = venue.width;
  const H = venue.height;
  const wall = kind === "wall";
  const adultTop = H * (1 - input.reach.adult);
  const childTop = H * (1 - input.reach.child);
  const tunnel = makeTunnel("right", { x: 0, y: 0, width: W, height: H }, spec.cell * input.coarse);
  // The band the stings' handles and tiles live in: the wall's child band, the kiosk's lower part.
  const bandTop = wall ? childTop : H * 0.6;
  const thumb = spec.tile;
  const deskLeft = wall ? 60 : 30;
  const sliderY = wall ? adultTop + 95 : bandTop + 80;
  const viewY = wall ? sliderY + thumb + 25 : sliderY + 145;
  const deskWidth = wall ? 660 : 450;
  const slider: Slider = {
    zone: 0,
    from: { x: deskLeft + thumb / 2 + 10, y: sliderY },
    to: { x: deskLeft + deskWidth - thumb / 2 - (wall ? 0 : 80), y: sliderY },
    thumb,
  };
  const gap = (deskWidth - 3 * spec.tile) / 2;
  const views = viewButtons(
    0,
    [0, 1, 2].map(
      (i) => [deskLeft + spec.tile / 2 + i * (spec.tile + gap), viewY] as [number, number],
    ),
    spec.tile,
  );
  const zone: Zone = {
    index: 0,
    rows: [0, tunnel.height],
    rect: tunnel.rect,
    slider,
    views,
    console: null,
    side: "left",
  };
  const stings: Sting[] = [];
  if (!input.hands) {
    const laneStart = deskLeft + deskWidth + (wall ? 100 : 30);
    const laneEnd = W - (wall ? 80 : 30);
    const n = Math.max(1, Math.min(wall ? 4 : 2, input.shapes));
    const lane = Math.min((laneEnd - laneStart) / n, wall ? 2400 : 900);
    const tile = spec.tile;
    const tileGap = wall ? 18 : 10;
    const half = spec.shape / 2;
    const btn = spec.sizeButton;
    const shapeTop = Math.max(half * 0.6, H * 0.16);
    const homes = [
      { u: 0.3, v: 0.45 },
      { u: 0.4, v: 0.85 },
      { u: 0.35, v: 0.15 },
      { u: 0.45, v: 0.6 },
    ];
    for (let i = 0; i < n; i++) {
      const x0 = laneStart + i * lane;
      const x1 = x0 + lane;
      const tileX = x0 + (wall ? 20 : 10);
      const tilesTop = wall ? bandTop + 30 : H - 15 - 3 * tile - 2 * tileGap;
      const tiles = [0, 1, 2].map((k) => ({
        x: tileX,
        y: tilesTop + k * (tile + tileGap),
        width: tile,
        height: tile,
      }));
      const hx0 = tileX + tile + (wall ? 50 : 40) + spec.handle / 2;
      const hx1 = Math.min(x1 - (wall ? 30 : 20) - spec.handle / 2, W - half - 20);
      let knobY: number | null;
      let hy0: number;
      let hy1: number;
      let shapeBottom: number;
      if (wall) {
        // The angle knob stays in the adult band; the handle moves within the child band.
        knobY = (adultTop + childTop) / 2;
        hy0 = childTop + 40 + spec.handle / 2;
        hy1 = H - 90 - spec.handle / 2;
        shapeBottom = knobY - spec.knob / 2 - half - 40;
      } else {
        // Everything is in reach: the knob rides on the sting just above the handle, and the
        // shape moves with the hand, staying clear of the knob.
        knobY = null;
        hy0 = H * 0.62;
        hy1 = H - 15 - spec.handle / 2;
        const offset = spec.handle / 2 + 10 + spec.knob / 2;
        shapeBottom = Math.min(shapeTop + (hy1 - hy0), hy1 - offset - spec.knob / 2 - half - 15);
      }
      // The wall's buttons stack beside the knob, on its upstream side, where they stay in the
      // lane; the kiosk's top the tile column.
      const sizeAt: Sting["sizeAt"] = wall
        ? {
            on: "knob",
            bigger: [-(spec.knob / 2 + 16 + btn / 2), -(btn / 2 + 5)],
            smaller: [-(spec.knob / 2 + 16 + btn / 2), btn / 2 + 5],
          }
        : {
            on: "fixed",
            bigger: [tileX + tile / 2, tilesTop - 20 - btn * 1.5 - tileGap],
            smaller: [tileX + tile / 2, tilesTop - 20 - btn / 2],
          };
      stings.push({
        index: i,
        zone: 0,
        travel: { x0: hx0, x1: Math.max(hx0, hx1), y0: hy0, y1: Math.max(hy0, hy1) },
        // Set below, once the neighbours' travel is known.
        region: {
          x0: REGION_MARGIN,
          x1: W - REGION_MARGIN,
          y0: REGION_MARGIN,
          y1: H - REGION_MARGIN,
        },
        shapeY: [shapeTop, Math.max(shapeTop, shapeBottom)],
        knobY,
        knobOffset: spec.handle / 2 + 10 + spec.knob / 2,
        home: homes[i % homes.length]!,
        tiles,
        size: spec.shape,
        handle: spec.handle,
        knob: spec.knob,
        scales: spec.sizes,
        sizeButton: btn,
        sizeAt,
      });
    }
    // Neighbouring lanes meet halfway between their handles' ranges, so their shapes never
    // overlap; each lane then grows its shape as far as it has room for.
    for (let i = 0; i < stings.length; i++) {
      const s = stings[i]!;
      const prev = stings[i - 1];
      const next = stings[i + 1];
      if (prev) s.region.x0 = (prev.travel.x1 + s.travel.x0) / 2;
      if (next) s.region.x1 = (s.travel.x1 + next.travel.x0) / 2;
      s.scales = roomFor(s, spec.sizes);
    }
  }
  return {
    kind,
    venue,
    adultTop,
    childTop,
    tunnel,
    zones: [zone],
    stings,
    walls: [],
    finger: spec.finger,
    plume: null,
    seams: [],
    vents: [],
    spec,
  };
};

const CONSOLE = 240;
const CONSOLE_INSET = 80;

/** One updraft's controls in a panel-sized half, console on `side`. `x0` is the half's left. */
const updraftHalf = (
  input: LayoutInput,
  spec: KindSpec,
  zone: number,
  x0: number,
  side: "left" | "right",
  rows: [number, number],
  tunnelRect: Box,
): { zone: Zone; sting: Sting | null; chimney: Box } => {
  const H = input.venue.height;
  const span = input.kind === "pair" ? Math.max(2, Math.round(input.span)) : 1;
  const pw = input.venue.width / span;
  const mirror = (x: number) => (side === "left" ? x0 + x : x0 + pw - x);
  // A console against a seam (the middle panels of a wider merged frame) keeps its controls
  // clear of it.
  const seamSide = side === "left" ? x0 > 0 : x0 + pw < input.venue.width;
  const inset = seamSide ? CONSOLE_INSET : 0;
  const width = CONSOLE + inset;
  const cx = mirror(CONSOLE / 2 + inset);
  const console: Box = {
    x: side === "left" ? x0 : x0 + pw - width,
    y: 0,
    width,
    height: H,
  };
  const views = viewButtons(
    zone,
    [
      [cx, 110],
      [cx, 270],
      [cx, 430],
    ],
    140,
  );
  const slider: Slider = {
    zone,
    from: { x: cx, y: 990 },
    to: { x: cx, y: 650 },
    thumb: 140,
  };
  const chimney: Box = {
    x: side === "left" ? x0 + width : x0,
    y: 0,
    width: pw - width,
    height: H,
  };
  const z: Zone = {
    index: zone,
    rows,
    rect: { x: chimney.x, y: tunnelRect.y, width: chimney.width, height: tunnelRect.height },
    slider,
    views,
    console,
    side,
  };
  if (input.hands) return { zone: z, sting: null, chimney };
  const tile = spec.tile;
  const tiles = [0, 1, 2, 3].map((k) => ({
    x: cx - tile / 2,
    y: 1140 + k * (tile + 20),
    width: tile,
    height: tile,
  }));
  const half = spec.shape / 2;
  const btn = spec.sizeButton;
  // The handle keeps clear of the console and of the seam (or the outer edge).
  const inner = mirror(width + half + 30);
  const outer = mirror(pw - SEAM_MARGIN - spec.handle / 2);
  const sting: Sting = {
    index: zone,
    zone,
    travel: { x0: Math.min(inner, outer), x1: Math.max(inner, outer), y0: 1320, y1: 1780 },
    region: {
      x0: chimney.x + CHIMNEY_MARGIN,
      x1: chimney.x + chimney.width - CHIMNEY_MARGIN,
      y0: REGION_MARGIN,
      y1: H - REGION_MARGIN,
    },
    shapeY: [300, 880],
    knobY: null,
    knobOffset: 250,
    home: { u: side === "left" ? 0.45 : 0.55, v: 0.8 },
    tiles,
    size: spec.shape,
    handle: spec.handle,
    knob: spec.knob,
    scales: spec.sizes,
    sizeButton: btn,
    // Stacked on the rod above the knob, bigger on top.
    sizeAt: {
      on: "knob",
      smaller: [0, -(spec.knob / 2 + 10 + btn / 2)],
      bigger: [0, -(spec.knob / 2 + 20 + btn * 1.5)],
    },
  };
  sting.scales = roomFor(sting, spec.sizes);
  return { zone: z, sting, chimney };
};

/**
 * Panel and pair: one updraft per panel. The first half of a merged frame's panels have their
 * consoles on the left and the rest on the right, so a pair's consoles sit at its outer edges.
 * One lattice spans every chimney; consoles inside it and seams between chimneys are walls.
 */
const updraftLayout = (input: LayoutInput, spec: KindSpec): Layout => {
  const { venue, kind } = input;
  const W = venue.width;
  const H = venue.height;
  const span = kind === "pair" ? Math.max(2, Math.round(input.span)) : 1;
  const pw = W / span;
  const sides: ("left" | "right")[] = Array.from({ length: span }, (_, i) =>
    span === 1 || i < span / 2 ? "left" : "right",
  );
  const chimneys = sides.map((side, i) => {
    const seamSide = side === "left" ? i > 0 : i < span - 1;
    const width = CONSOLE + (seamSide ? CONSOLE_INSET : 0);
    return side === "left"
      ? { x: i * pw + width, width: pw - width }
      : { x: i * pw, width: pw - width };
  });
  const left = chimneys[0]!.x;
  const last = chimneys[span - 1]!;
  const rect: Box = { x: left, y: 0, width: last.x + last.width - left, height: H };
  const tunnel = makeTunnel("up", rect, spec.cell * input.coarse);
  const rowOf = (vx: number) =>
    Math.min(tunnel.height, Math.max(0, Math.round((rect.x + rect.width - vx) / tunnel.cell)));
  const zones: Zone[] = [];
  const stings: Sting[] = [];
  const walls: [number, number, number, number][] = [];
  const seams: number[] = [];
  for (let i = 0; i < span; i++) {
    const c = chimneys[i]!;
    const rows: [number, number] = [rowOf(c.x + c.width), rowOf(c.x)];
    const h = updraftHalf(input, spec, i, i * pw, sides[i]!, rows, rect);
    zones.push(h.zone);
    if (h.sting) stings.push({ ...h.sting, index: stings.length });
    if (i > 0) seams.push(i * pw);
    const prev = chimneys[i - 1];
    if (!prev) continue;
    if (Math.abs(prev.x + prev.width - c.x) < 1) {
      // Two chimneys meet at a seam: a thin wall keeps them apart.
      const mid = rowOf(c.x);
      walls.push([0, mid - 1, tunnel.width, mid + 1]);
    } else {
      // A console between two chimneys is solid.
      walls.push([0, rowOf(c.x), tunnel.width, rowOf(prev.x + prev.width)]);
    }
  }
  const vents = zones.map((z) => ({ x: z.rect.x, y: H - 26, width: z.rect.width, height: 26 }));
  return {
    kind,
    venue,
    adultTop: H * (1 - input.reach.adult),
    childTop: H * (1 - input.reach.child),
    tunnel,
    zones,
    stings,
    walls,
    finger: spec.finger,
    plume: { line: 10, width: W, samples: PLUME_SAMPLES * span },
    seams,
    vents,
    spec,
  };
};

/** The screen: one wide updraft. Its inlet comes from the plumes below (see inflow.ts). */
const screenLayout = (input: LayoutInput, spec: KindSpec): Layout => {
  const { venue } = input;
  const tunnel = makeTunnel(
    "up",
    { x: 0, y: 0, width: venue.width, height: venue.height },
    spec.cell * input.coarse,
  );
  return {
    kind: "screen",
    venue,
    adultTop: venue.height,
    childTop: venue.height,
    tunnel,
    zones: [
      {
        index: 0,
        rows: [0, tunnel.height],
        rect: tunnel.rect,
        slider: null,
        views: [],
        console: null,
        side: "left",
      },
    ],
    stings: [],
    walls: [],
    finger: 0,
    plume: null,
    seams: [],
    vents: [],
    spec,
  };
};

export const computeLayout = (input: LayoutInput): Layout => {
  const spec = KINDS[input.kind];
  if (input.kind === "screen") return screenLayout(input, spec);
  if (input.kind === "panel" || input.kind === "pair") return updraftLayout(input, spec);
  return tunnelLayout(input, spec);
};

// ---- Sting geometry -----------------------------------------------------------------------

/** The shape centre for a handle at (hx, hy). */
export const shapeAt = (s: Sting, hx: number, hy: number): { x: number; y: number } => {
  const t = s.travel.y1 > s.travel.y0 ? (hy - s.travel.y0) / (s.travel.y1 - s.travel.y0) : 0;
  return { x: hx, y: s.shapeY[0] + (s.shapeY[1] - s.shapeY[0]) * Math.min(1, Math.max(0, t)) };
};

/** The angle knob's centre for a handle at (hx, hy). */
export const knobAt = (s: Sting, hx: number, hy: number): { x: number; y: number } => ({
  x: hx,
  y: s.knobY ?? hy - s.knobOffset,
});

/** The size buttons for a handle at (hx, hy). */
export const sizeButtonsAt = (s: Sting, hx: number, hy: number): { smaller: Box; bigger: Box } => {
  const k = s.sizeAt.on === "knob" ? knobAt(s, hx, hy) : { x: 0, y: 0 };
  const at = ([dx, dy]: [number, number]) => box(k.x + dx, k.y + dy, s.sizeButton);
  return { smaller: at(s.sizeAt.smaller), bigger: at(s.sizeAt.bigger) };
};

/**
 * The handle's range with the shape at `scale` times its size, reaching `reach` of its size
 * from its centre (REACHES; any shape by default): the usual travel, narrowed just enough that
 * the shape stays inside its region at any angle. A range too narrow to keep closes on its
 * middle.
 */
export const travelAt = (s: Sting, scale: number, reach = REACH): Range => {
  const e = reach * scale * s.size;
  const t = s.travel;
  const r = s.region;
  // The shape's y follows the handle's along a line (see shapeAt).
  const span = t.y1 - t.y0;
  const slope = span > 0 ? (s.shapeY[1] - s.shapeY[0]) / span : 0;
  const yAt = (shapeY: number) => (slope > 0 ? t.y0 + (shapeY - s.shapeY[0]) / slope : t.y0);
  const close = (a: number, b: number): [number, number] =>
    a <= b ? [a, b] : [(a + b) / 2, (a + b) / 2];
  const [x0, x1] = close(Math.max(t.x0, r.x0 + e), Math.min(t.x1, r.x1 - e));
  const [y0, y1] = close(Math.max(t.y0, yAt(r.y0 + e)), Math.min(t.y1, yAt(r.y1 - e)));
  return { x0, x1, y0, y1 };
};

/** The handle's range for a shape at `scale` times its size. */
export const travelOf = (s: Sting, shape: ShapeId, scale: number): Range =>
  travelAt(s, scale, REACHES[shape]);

/** Keep a handle inside a range (its travel at the usual size by default). */
export const clampHandle = (
  s: Sting,
  hx: number,
  hy: number,
  range: Range = s.travel,
): { x: number; y: number } => ({
  x: Math.min(range.x1, Math.max(range.x0, Number.isFinite(hx) ? hx : range.x0)),
  y: Math.min(range.y1, Math.max(range.y0, Number.isFinite(hy) ? hy : range.y0)),
});

/** Keep a shape reaching `extent` venue px from its centre inside its sting's region. */
export const clampShape = (
  s: Sting,
  x: number,
  y: number,
  extent: number,
): { x: number; y: number } => {
  const r = s.region;
  const keep = (a: number, b: number, v: number) =>
    a <= b ? Math.min(b, Math.max(a, v)) : (a + b) / 2;
  return { x: keep(r.x0 + extent, r.x1 - extent, x), y: keep(r.y0 + extent, r.y1 - extent, y) };
};

/** The handle's home position. */
export const homeOf = (s: Sting): { x: number; y: number } => ({
  x: s.travel.x0 + (s.travel.x1 - s.travel.x0) * s.home.u,
  y: s.travel.y0 + (s.travel.y1 - s.travel.y0) * s.home.v,
});

/** The direction the stream blows, in degrees anticlockwise as drawn (0 is to the right). */
export const streamAngle = (t: Tunnel): number => (t.flow === "right" ? 0 : 90);

export const inBox = (b: Box, x: number, y: number, pad = 0): boolean =>
  x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad;

/** Slider position (0 gentle to 1 strong) for a touch at (x, y). */
export const sliderValue = (s: Slider, x: number, y: number): number => {
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  const len2 = dx * dx + dy * dy || 1;
  return Math.min(1, Math.max(0, ((x - s.from.x) * dx + (y - s.from.y) * dy) / len2));
};

export const sliderPoint = (s: Slider, v: number): { x: number; y: number } => ({
  x: s.from.x + (s.to.x - s.from.x) * v,
  y: s.from.y + (s.to.y - s.from.y) * v,
});

/** The slider's touch area: its track plus the thumb's size around it. */
export const sliderBox = (s: Slider): Box => {
  const x0 = Math.min(s.from.x, s.to.x) - s.thumb / 2;
  const y0 = Math.min(s.from.y, s.to.y) - s.thumb / 2;
  return {
    x: x0,
    y: y0,
    width: Math.abs(s.to.x - s.from.x) + s.thumb,
    height: Math.abs(s.to.y - s.from.y) + s.thumb,
  };
};
