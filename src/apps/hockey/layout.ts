/**
 * Where tables, lanes, stations and scores go on each kind of frame. Everything here is in
 * venue px of the frame (stage px divided by `frame.unit`) and is pure, so it can be tested
 * without a browser.
 */
import { bankFraction } from "../../core/layout";
import type { FrameKind, Rect, StationSpec } from "../../core/types";
import type { Side, Variant } from "./config";
import {
  type Box,
  type End,
  type LaneParams,
  laneParams,
  type Mouth,
  type Obstacle,
} from "./physics";

export type ResetCorner = NonNullable<StationSpec["resetCorner"]>;

/** Maps lane coordinates to frame venue px: (a·x + c·y + e, b·x + d·y + f). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const apply = (t: Affine, x: number, y: number) => ({
  x: t.a * x + t.c * y + t.e,
  y: t.b * x + t.d * y + t.f,
});

export const invert = (t: Affine): Affine => {
  const det = t.a * t.d - t.b * t.c;
  const a = t.d / det;
  const b = -t.b / det;
  const c = -t.c / det;
  const d = t.a / det;
  return { a, b, c, d, e: -(a * t.e + c * t.f), f: -(b * t.e + d * t.f) };
};

/** The lane-coordinate box under a venue rect. */
export const rectToBox = (t: Affine, r: Rect): Box => {
  const inv = invert(t);
  const p = apply(inv, r.x, r.y);
  const q = apply(inv, r.x + r.width, r.y + r.height);
  return {
    x0: Math.min(p.x, q.x),
    x1: Math.max(p.x, q.x),
    y0: Math.min(p.y, q.y),
    y1: Math.max(p.y, q.y),
  };
};

/** The venue box a centred wave counter, its pips and timer take up, for targets to avoid. */
const hudBox = (cx: number, top: number, size: number, FW: number): Rect => {
  const half = Math.max(size * 1.4, FW * 0.09);
  return { x: cx - half, y: top, width: half * 2, height: size * 2.5 };
};

/** The venue rect covered by a lane-coordinate box. */
export const boxToRect = (t: Affine, box: Box): Rect => {
  const p = apply(t, box.x0, box.y0);
  const q = apply(t, box.x1, box.y1);
  const x = Math.min(p.x, q.x);
  const y = Math.min(p.y, q.y);
  return { x, y, width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) };
};

export interface PlayerSpec {
  id: string;
  side: Side;
  /** Palette index for this player's colour: the side in hockey, the slot in defence. */
  hue: number;
  /** The end this player defends. */
  goalEnd: 0 | 1;
  /** The part of the lane the player's mallet may use, in lane coordinates. */
  area: Box;
  /** Venue rect people touch to claim and steer, or null for a side only bots play. */
  station: Rect | null;
  /**
   * Where the station's reset control goes. No layout has room for it beside the table, so
   * it takes the corner by the player's own goal, where pucks seldom go.
   */
  resetCorner: ResetCorner;
}

export interface LaneSpec {
  id: string;
  params: LaneParams;
  toVenue: Affine;
  /** Venue bounding rect of the lane surface. */
  rect: Rect;
  child: boolean;
  players: PlayerSpec[];
}

export interface ScoreSpot {
  side: Side;
  /** Centre of the digits, venue px. */
  x: number;
  y: number;
  /** Digit height, venue px. */
  size: number;
  /** Drawn faintly under play (inside the lane) rather than on its own. */
  faint: boolean;
}

/** Defence: where each wave's targets go, and the fixed splitters, in lane coordinates. */
export interface DefenceSpec {
  targets: Box;
  targetR: number;
  splitters: Obstacle[];
  /** Where targets must not go: over the wave counter. */
  keepOut: Box[];
  /** False when the targets are elsewhere (a bank frame whose top opens onto the deck). */
  local: boolean;
}

export interface TableSpec {
  id: string;
  lanes: LaneSpec[];
  scores: ScoreSpot[];
  /** Out-of-reach area above the table on a wall, for scores and celebrations. */
  hud: Rect | null;
  /** Time left as a bar, or as a ring around the first lane's centre circle. */
  timer: { kind: "bar"; rect: Rect } | { kind: "ring" };
  defence?: DefenceSpec;
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  versus: boolean;
  side: Side;
  tables: TableSpec[];
}

/** A vertical span in venue px, such as a player's calibrated band. */
export interface Band {
  top: number;
  bottom: number;
}

export interface LayoutInput {
  kind: FrameKind;
  /** Frame size in venue px. */
  width: number;
  height: number;
  /** Venue y of the top of adult and child reach. */
  reachTop: { adult: number; child: number };
  /** Venue x of physical seams. */
  seams: readonly number[];
  versus: boolean;
  side: Side;
  childLane: boolean;
  variant: Variant;
  speed: number;
  /** Solo wall: several tables, or one long table. */
  wall?: "tables" | "long";
  /** Players per side on a long table, or per frame in versus. */
  players?: number;
  /**
   * The band each lane must fit inside, by lane id: the players' common band once a match
   * starts. The table is the playing canvas, so it never reaches outside it.
   */
  bands?: Readonly<Record<string, Band>>;
  /** Defence on a bank with a screen: the top of each frame opens onto the screen's deck. */
  deck?: boolean;
}

/** Keeps each player's hand this far from a seam, as a fraction of the frame width. */
export const SEAM_CLEAR = 0.1;
/** Smallest lane width we will build; below it the wall drops the child lane. */
const MIN_LANE = 360;
/** Lanes sit this far inside a band, so the rim is inside it too. */
const BAND_INSET = 16;
/** Slots along a wall in defence. */
export const WALL_SLOTS = 6;
/** Speed a splitter adds to a puck, as a fraction of the cap. */
const SPLITTER_KICK = 0.12;

const GOALS: readonly [End, End] = [
  { kind: "goal", side: 0 },
  { kind: "goal", side: 1 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const horizontal = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
const mirrored = (x: number, y: number): Affine => ({ a: -1, b: 0, c: 0, d: 1, e: x, f: y });
/** Lane x runs up the frame from `bottom`; lane y runs left to right from `left`. */
const upwards = (left: number, bottom: number): Affine => ({
  a: 0,
  b: -1,
  c: 1,
  d: 0,
  e: left,
  f: bottom,
});

/**
 * The part of a default vertical span [top, bottom] inside `band` (inset a little), never
 * shorter than `min`. Without a band the default stands.
 */
export const fitSpan = (
  top: number,
  bottom: number,
  band: Band | undefined,
  min: number,
): [number, number] => {
  if (!band) return [top, bottom];
  let a = Math.max(top, band.top + BAND_INSET);
  let b = Math.min(bottom, band.bottom - BAND_INSET);
  const need = Math.min(min, bottom - top);
  if (b - a < need) {
    const mid = clamp((a + b) / 2, top + need / 2, bottom - need / 2);
    a = mid - need / 2;
    b = mid + need / 2;
  }
  return [a, b];
};

const lane = (
  input: LayoutInput,
  id: string,
  toVenue: Affine,
  length: number,
  width: number,
  ends: readonly [End, End],
  child: boolean,
  players: PlayerSpec[],
  drift: 0 | 1 | null = null,
): LaneSpec => ({
  id,
  params: laneParams({
    length,
    width,
    ends,
    variant: input.variant,
    speed: input.speed,
    child,
    drift,
  }),
  toVenue,
  rect: boxToRect(toVenue, { x0: 0, y0: 0, x1: length, y1: width }),
  child,
  players,
});

/** Lane-coordinate strip under a venue x range, clipped to the lane. */
const stripUnder = (t: Affine, length: number, width: number, x0: number, x1: number): Box => {
  const inv = invert(t);
  const a = apply(inv, x0, 0).x;
  const b = apply(inv, x1, 0).x;
  return {
    x0: Math.max(0, Math.min(a, b)),
    x1: Math.min(length, Math.max(a, b)),
    y0: 0,
    y1: width,
  };
};

/** A horizontal two-player lane with stations over its left and right parts. */
const twoSided = (
  input: LayoutInput,
  id: string,
  box: Rect,
  stations: [Rect, Rect] | null,
  child: boolean,
): LaneSpec => {
  const t = horizontal(box.x, box.y);
  const L = box.width;
  const W = box.height;
  const left = stations?.[0] ?? { x: box.x, y: box.y, width: L / 2, height: W };
  const right = stations?.[1] ?? { x: box.x + L / 2, y: box.y, width: L / 2, height: W };
  return lane(input, id, t, L, W, GOALS, child, [
    {
      id: `${id}-l`,
      side: 0,
      hue: 0,
      goalEnd: 0,
      area: stripUnder(t, L, W, left.x, left.x + left.width),
      station: stations ? left : null,
      resetCorner: "top-left",
    },
    {
      id: `${id}-r`,
      side: 1,
      hue: 1,
      goalEnd: 1,
      area: stripUnder(t, L, W, right.x, right.x + right.width),
      station: stations ? right : null,
      resetCorner: "top-right",
    },
  ]);
};

/**
 * Scores for a table that fills most of a frame: big in the larger empty strip above or below
 * the lane when the lane has shrunk to fit a band, otherwise faint inside its top.
 */
const sideScores = (
  input: LayoutInput,
  laneRect: Rect,
  xs: readonly [number, number],
): Pick<TableSpec, "scores" | "timer"> => {
  const { width: FW, height: FH } = input;
  const above = laneRect.y;
  const below = FH - (laneRect.y + laneRect.height);
  const room = Math.max(above, below);
  if (room >= FH * 0.16) {
    const size = Math.min(room * 0.6, FW * 0.16, 520);
    const y = above >= below ? above * 0.45 : laneRect.y + laneRect.height + below * 0.5;
    return {
      scores: [
        { side: 0, x: xs[0], y, size, faint: false },
        { side: 1, x: xs[1], y, size, faint: false },
      ],
      timer: { kind: "bar", rect: { x: FW * 0.4, y: y - 14, width: FW * 0.2, height: 28 } },
    };
  }
  const size = Math.min(laneRect.height * 0.2, FW * 0.16, FH * 0.18);
  const y = laneRect.y + size * 0.85;
  return {
    scores: [
      { side: 0, x: xs[0], y, size, faint: true },
      { side: 1, x: xs[1], y, size, faint: true },
    ],
    timer: { kind: "ring" },
  };
};

/**
 * Panel: the player against a bot. The station is the whole panel; the table fits the
 * player's band, upright (player's goal at the bottom) when the band is tall enough and
 * across the panel (player on the left) when it is short.
 */
const panel = (input: LayoutInput): Layout => {
  const { width: FW, height: FH } = input;
  const m = 30;
  const [top, bottom] = fitSpan(m, FH - m, input.bands?.t0, MIN_LANE);
  const station: Rect = { x: 0, y: 0, width: FW, height: FH };
  const gap = 30;
  const tall = bottom - top >= FW * 0.9;
  let spec: LaneSpec;
  if (tall) {
    const L = bottom - top;
    const W = FW - 2 * m;
    spec = lane(input, "t0", upwards(m, bottom), L, W, GOALS, false, [
      {
        id: "p",
        side: 0,
        hue: 0,
        goalEnd: 0,
        area: { x0: 0, y0: 0, x1: L / 2 - gap, y1: W },
        station,
        // Beside the goal at the bottom, well away from the centre line and the scores.
        resetCorner: "bottom-right",
      },
      {
        id: "bot",
        side: 1,
        hue: 1,
        goalEnd: 1,
        area: { x0: L / 2 + gap, y0: 0, x1: L, y1: W },
        station: null,
        resetCorner: "top-right",
      },
    ]);
  } else {
    const L = FW - 2 * m;
    const W = bottom - top;
    spec = lane(input, "t0", horizontal(m, top), L, W, GOALS, false, [
      {
        id: "p",
        side: 0,
        hue: 0,
        goalEnd: 0,
        area: { x0: 0, y0: 0, x1: L / 2 - gap, y1: W },
        station,
        resetCorner: "bottom-left",
      },
      {
        id: "bot",
        side: 1,
        hue: 1,
        goalEnd: 1,
        area: { x0: L / 2 + gap, y0: 0, x1: L, y1: W },
        station: null,
        resetCorner: "top-right",
      },
    ]);
  }
  let place: Pick<TableSpec, "scores" | "timer">;
  if (tall && FH - (bottom - top) < FH * 0.16) {
    // Upright and full height: faint scores either side of the centre line, on the left.
    const size = Math.min(220, FW * 0.2);
    const cy = (top + bottom) / 2;
    place = {
      scores: [
        { side: 0, x: m + size * 0.7, y: cy + size * 0.85, size, faint: true },
        { side: 1, x: m + size * 0.7, y: cy - size * 0.85, size, faint: true },
      ],
      timer: { kind: "ring" },
    };
  } else {
    place = sideScores(input, spec.rect, [FW * 0.3, FW * 0.7]);
  }
  return {
    kind: input.kind,
    width: FW,
    height: FH,
    versus: false,
    side: 0,
    tables: [{ id: "t0", lanes: [spec], hud: null, ...place }],
  };
};

/** Pair, kiosk (and a screen, which gets bots only): one horizontal table across the frame. */
const single = (input: LayoutInput): Layout => {
  const { width: FW, height: FH } = input;
  const m = input.kind === "pair" ? 36 : 30;
  const [top, bottom] = fitSpan(m, FH - m, input.bands?.t0, MIN_LANE);
  const box = { x: m, y: top, width: FW - 2 * m, height: bottom - top };
  let stations: [Rect, Rect] | null = null;
  if (input.kind === "pair" || input.kind === "kiosk") {
    // On a pair, each player keeps a tenth of the width clear of the seam, so their hands are
    // never within a fifth of the width of each other across it.
    const seam = input.seams[0];
    const centre = seam ?? FW / 2;
    const clear = seam === undefined ? 60 : FW * SEAM_CLEAR;
    stations = [
      { x: 0, y: 0, width: centre - clear, height: FH },
      { x: centre + clear, y: 0, width: FW - centre - clear, height: FH },
    ];
  }
  const spec = twoSided(input, "t0", box, stations, false);
  return {
    kind: input.kind,
    width: FW,
    height: FH,
    versus: false,
    side: 0,
    tables: [
      {
        id: "t0",
        lanes: [spec],
        hud: null,
        ...sideScores(input, spec.rect, [FW * 0.25, FW * 0.75]),
      },
    ],
  };
};

/** Top of adult reach on a wall, leaving room for at least one lane below it. */
const wallReach = (input: LayoutInput) =>
  Math.min(Math.max(0, input.reachTop.adult), input.height - MIN_LANE - 70);

/** Several tables side by side in the reachable band, scores in the unreachable part above. */
const wallTables = (input: LayoutInput): Layout => {
  const { width: FW, height: FH } = input;
  const reach = wallReach(input);
  const childTop = Math.min(Math.max(reach, input.reachTop.child), FH - 70);
  const adultBottom = childTop - 20;
  const withChild =
    input.childLane && adultBottom - (reach + 30) >= MIN_LANE && FH - 30 - (childTop + 20) >= 300;
  const n = withChild ? 3 : 4;
  const slot = FW / n;
  const tables: TableSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * slot;
    const mid = x0 + slot / 2;
    const id = `t${i}`;
    const stationsFor = (top: number, bottom: number): [Rect, Rect] => [
      { x: x0 + 16, y: top, width: mid - 60 - (x0 + 16), height: bottom - top },
      { x: mid + 60, y: top, width: x0 + slot - 16 - (mid + 60), height: bottom - top },
    ];
    const laneX = x0 + 50;
    const laneL = slot - 100;
    const [aTop, aBottom] = fitSpan(
      reach + 30,
      withChild ? adultBottom : FH - 40,
      input.bands?.[id],
      MIN_LANE,
    );
    const lanes: LaneSpec[] = [
      twoSided(
        input,
        id,
        { x: laneX, y: aTop, width: laneL, height: aBottom - aTop },
        stationsFor(reach, withChild ? childTop : FH),
        false,
      ),
    ];
    if (withChild) {
      const [cTop, cBottom] = fitSpan(childTop + 20, FH - 30, input.bands?.[`${id}c`], 300);
      lanes.push(
        twoSided(
          input,
          `${id}c`,
          { x: laneX, y: cTop, width: laneL, height: cBottom - cTop },
          stationsFor(childTop, FH),
          true,
        ),
      );
    }
    const hudH = reach;
    const size = Math.min(hudH * 0.48, slot * 0.3);
    tables.push({
      id,
      lanes,
      scores: [
        { side: 0, x: x0 + slot * 0.3, y: hudH * 0.5, size, faint: false },
        { side: 1, x: x0 + slot * 0.7, y: hudH * 0.5, size, faint: false },
      ],
      hud: { x: x0, y: 0, width: slot, height: hudH },
      timer: {
        kind: "bar",
        rect: { x: x0 + slot * 0.3, y: hudH * 0.5 + size * 0.75, width: slot * 0.4, height: 28 },
      },
    });
  }
  return { kind: input.kind, width: FW, height: FH, versus: false, side: 0, tables };
};

/** Station x ranges for `k` players working out from a goal at the left edge of `span`. */
const zonesFrom = (span: number, k: number, slots: number): [number, number][] => {
  const each = span / slots;
  return Array.from({ length: k }, (_, i) => [
    i * each + (i > 0 ? 30 : 0),
    (i + 1) * each - (i < slots - 1 ? 30 : 0),
  ]);
};

/** HUD across a whole wall: side 0's score left of centre, side 1's right of it. */
const wideHud = (FW: number, hudH: number): Pick<TableSpec, "scores" | "hud" | "timer"> => {
  const size = Math.min(hudH * 0.48, FW * 0.1);
  const y = hudH * 0.5;
  return {
    scores: [
      { side: 0, x: FW * 0.4, y, size, faint: false },
      { side: 1, x: FW * 0.6, y, size, faint: false },
    ],
    hud: { x: 0, y: 0, width: FW, height: hudH },
    timer: {
      kind: "bar",
      rect: { x: FW * 0.42, y: y + size * 0.75, width: FW * 0.16, height: 28 },
    },
  };
};

/**
 * One long table from one end of the wall to the other, its goals at the ends. Each side's
 * players stand in zones working out from their goal; with one player a side the middle of
 * the table is open water.
 */
const wallLong = (input: LayoutInput): Layout => {
  const { width: FW, height: FH } = input;
  const reach = wallReach(input);
  const m = 40;
  const [top, bottom] = fitSpan(reach + 30, FH - 40, input.bands?.long, MIN_LANE);
  const t = horizontal(m, top);
  const L = FW - 2 * m;
  const W = bottom - top;
  const k = clamp(Math.round(input.players ?? 3), 1, 4);
  const zones = zonesFrom(FW / 2, k, Math.max(2, k));
  // Seats alternate sides, goal zones first, so the first two test bots face each other.
  const players: PlayerSpec[] = [];
  zones.forEach(([a, b], i) => {
    for (const side of [0, 1] as const) {
      const x0 = side === 0 ? a : FW - b;
      const x1 = side === 0 ? b : FW - a;
      players.push({
        id: `long${side}${i}`,
        side,
        hue: side,
        goalEnd: side,
        area: stripUnder(t, L, W, x0, x1),
        station: { x: x0, y: reach, width: x1 - x0, height: FH - reach },
        resetCorner: side === 0 ? "top-left" : "top-right",
      });
    }
  });
  return {
    kind: input.kind,
    width: FW,
    height: FH,
    versus: false,
    side: 0,
    tables: [
      {
        id: "long",
        lanes: [lane(input, "long", t, L, W, GOALS, false, players)],
        ...wideHud(FW, reach),
      },
    ],
  };
};

/**
 * Versus: this frame holds one end of a long table. Its goal is at the outer edge (left for
 * side 0, right for side 1) and the other edge is open, at the frame's edge, so with side 0 on
 * the left the two frames read as one table: a puck slides off one and straight onto the other.
 * Up to four players share the end, each in a zone working out from the goal.
 */
const versus = (input: LayoutInput): Layout => {
  const { width: FW, height: FH, side } = input;
  const isWall = input.kind === "wall";
  const m = isWall ? 40 : 36;
  const defaultTop = isWall ? wallReach(input) + 30 : m;
  const [top, bottom] = fitSpan(defaultTop, FH - (isWall ? 40 : m), input.bands?.v, MIN_LANE);
  const W = bottom - top;
  const L = FW - m;
  const t = side === 0 ? horizontal(m, top) : mirrored(FW - m, top);
  const ends: readonly [End, End] = [
    { kind: "goal", side },
    { kind: "open", side: side === 0 ? 1 : 0, leaveAt: -1 },
  ];
  const k = clamp(Math.round(input.players ?? 3), 1, isWall ? 4 : 2);
  let ranges: [number, number][];
  if (isWall) {
    ranges = zonesFrom(FW, k, Math.max(2, k));
  } else {
    const seam = input.seams[0] ?? FW / 2;
    const clear = FW * SEAM_CLEAR;
    ranges = (
      [
        [0, seam - clear],
        [seam + clear, FW],
      ] as [number, number][]
    ).slice(0, k);
  }
  // Ranges run out from a goal on the left; side 1's goal is on the right.
  if (side === 1) ranges = ranges.map(([a, b]) => [FW - b, FW - a]);
  const stationTop = isWall ? defaultTop - 30 : 0;
  const players: PlayerSpec[] = ranges.map(([a, b], i) => ({
    id: `v${i}`,
    side,
    hue: side,
    goalEnd: 0,
    area: stripUnder(t, L, W, a, b),
    station: { x: a, y: stationTop, width: b - a, height: FH - stationTop },
    // Every zone keeps it on its goal side, away from the open end where pucks come in.
    resetCorner: side === 0 ? "top-left" : "top-right",
  }));
  players.sort((p, q) => p.area.x0 - q.area.x0);
  const spec = lane(input, "v", t, L, W, ends, false, players);
  // Side 0's score sits on the left and side 1's on the right on both frames, so the two
  // frames read as one long table.
  const place = isWall
    ? wideHud(FW, stationTop)
    : { hud: null, ...sideScores(input, spec.rect, [FW * 0.25, FW * 0.75]) };
  return {
    kind: input.kind,
    width: FW,
    height: FH,
    versus: true,
    side,
    tables: [{ id: "v", lanes: [spec], ...place }],
  };
};

/**
 * Defence: one rink filling the frame, its goal slots along the bottom edge, one per player,
 * side by side. Each player guards their slot from a zone just above it; the targets sit high
 * up where only pucks reach. On a bank with a screen the top is open onto the screen's deck,
 * which holds the targets instead.
 */
const defence = (input: LayoutInput): Layout => {
  const { width: FW, height: FH, kind } = input;
  const isWall = kind === "wall";
  const m = isWall ? 40 : 30;
  // Stations (and so slots) left to right.
  let stations: Rect[];
  const reach = isWall ? wallReach(input) : 0;
  if (isWall) {
    const each = FW / WALL_SLOTS;
    stations = Array.from({ length: WALL_SLOTS }, (_, i) => ({
      x: i * each + 30,
      y: reach,
      width: each - 60,
      height: FH - reach,
    }));
  } else if (kind === "panel") {
    stations = [{ x: 0, y: 0, width: FW, height: FH }];
  } else {
    const seam = input.seams[0];
    const centre = seam ?? FW / 2;
    const clear = seam === undefined ? 60 : FW * SEAM_CLEAR;
    stations = [
      { x: 0, y: 0, width: centre - clear, height: FH },
      { x: centre + clear, y: 0, width: FW - centre - clear, height: FH },
    ];
  }
  const band = input.bands?.d;
  const [bandTop, bottom] = fitSpan(isWall ? reach : m, FH - m, band, MIN_LANE);
  const top = input.deck ? 0 : m;
  const L = bottom - top;
  const W = FW - 2 * m;
  const t = upwards(m, bottom);
  // Players guard from their band; never so deep that a mallet could reach the targets.
  const depth = Math.min(bottom - bandTop, L * 0.45);
  const mouths: Mouth[] = stations.map((st, i) => {
    const cy = st.x + st.width / 2 - m;
    const half = Math.min(st.width * 0.24, W * 0.2);
    return { y0: cy - half, y1: cy + half, slot: i, open: true };
  });
  const players: PlayerSpec[] = stations.map((st, i) => ({
    id: `d${i}`,
    side: 0,
    hue: i,
    goalEnd: 0,
    area: { x0: 0, x1: depth, y0: Math.max(0, st.x - m), y1: Math.min(W, st.x + st.width - m) },
    station: st,
    resetCorner: st.x + st.width / 2 < FW / 2 ? "bottom-left" : "bottom-right",
  }));
  const ends: readonly [End, End] = [
    { kind: "goal", side: 0, mouths },
    { kind: input.deck ? "open" : "wall", side: 0 },
  ];
  const spec = lane(input, "d", t, L, W, ends, false, players, 0);
  const r = spec.params.puckR;
  // Splitters between the players and the targets: one per pair of slots, at least one.
  const splitCount = Math.max(1, Math.round(stations.length / 2));
  const splitters: Obstacle[] = input.deck
    ? []
    : Array.from({ length: splitCount }, (_, i) => ({
        id: 100 + i,
        x: depth + (L - depth) * 0.22,
        y: (W * (i + 1)) / (splitCount + 1),
        r: r * 1.5,
        kick: SPLITTER_KICK,
      }));
  const size = Math.min(isWall ? reach * 0.32 : FH * 0.14, FW * 0.12);
  return {
    kind,
    width: FW,
    height: FH,
    versus: false,
    side: 0,
    tables: [
      {
        id: "d",
        lanes: [spec],
        scores: [{ side: 0, x: FW / 2, y: top + size * 0.95, size, faint: true }],
        hud: null,
        // Under the wave pips, which sit just below the counter.
        timer: {
          kind: "bar",
          rect: { x: FW * 0.42, y: top + size * 2.15, width: FW * 0.16, height: isWall ? 28 : 16 },
        },
        defence: {
          targets: { x0: depth + (L - depth) * 0.42, x1: L - r * 5, y0: W * 0.06, y1: W * 0.94 },
          targetR: r * 1.5,
          splitters,
          keepOut: [rectToBox(t, hudBox(FW / 2, top, size, FW))],
          local: !input.deck,
        },
      },
    ],
  };
};

/** Puck radius on the screen's deck: bigger than on a panel, since it is seen from further off. */
const DECK_PUCK = 58;

/**
 * Defence on a bank: the screen's deck. One rink spans the screen, its bottom edge open over
 * each touch frame (lane y follows the bank left to right, so a puck leaving the top of a frame
 * comes up straight above it) and the targets high up. Mouth `slot` is the frame's position.
 */
export const deckLayout = (input: {
  width: number;
  height: number;
  count: number;
  speed: number;
}): Layout => {
  const { width: FW, height: FH } = input;
  const m = 40;
  const n = Math.max(1, Math.round(input.count));
  const L = FH - m;
  const W = FW - 2 * m;
  const t = upwards(m, FH);
  const mouths: Mouth[] = Array.from({ length: n }, (_, i) => ({
    y0: bankFraction(i, 0.04, n) * FW - m,
    y1: bankFraction(i, 0.96, n) * FW - m,
    slot: i,
    open: false,
  }));
  const ends: readonly [End, End] = [
    { kind: "goal", side: 0, mouths },
    { kind: "wall", side: 0 },
  ];
  const params = {
    ...laneParams({
      length: L,
      width: W,
      ends,
      variant: "defence",
      speed: input.speed,
      child: false,
      drift: 0,
    }),
    puckR: DECK_PUCK,
  };
  const spec: LaneSpec = {
    id: "deck",
    params,
    toVenue: t,
    rect: boxToRect(t, { x0: 0, y0: 0, x1: L, y1: W }),
    child: false,
    players: [],
  };
  const r = DECK_PUCK;
  const splitCount = Math.max(2, Math.round(n / 2));
  const size = Math.min(FH * 0.08, 340);
  return {
    kind: "screen",
    width: FW,
    height: FH,
    versus: false,
    side: 0,
    tables: [
      {
        id: "deck",
        lanes: [spec],
        scores: [{ side: 0, x: FW / 2, y: m + size * 0.85, size, faint: false }],
        hud: null,
        timer: {
          kind: "bar",
          rect: { x: FW * 0.45, y: m + size * 1.9, width: FW * 0.1, height: 20 },
        },
        defence: {
          targets: { x0: L * 0.42, x1: L * 0.8, y0: W * 0.05, y1: W * 0.95 },
          targetR: r * 2,
          splitters: Array.from({ length: splitCount }, (_, i) => ({
            id: 100 + i,
            x: L * 0.24,
            y: (W * (i + 1)) / (splitCount + 1),
            r: r * 1.6,
            kick: SPLITTER_KICK,
          })),
          keepOut: [rectToBox(t, hudBox(FW / 2, m, size, FW))],
          local: true,
        },
      },
    ],
  };
};

export const layoutFor = (input: LayoutInput): Layout => {
  if (input.variant === "defence") return defence(input);
  if (input.versus && (input.kind === "wall" || input.kind === "pair")) return versus(input);
  switch (input.kind) {
    case "panel":
      return panel(input);
    case "wall":
      return input.wall === "long" ? wallLong(input) : wallTables(input);
    default:
      return single(input);
  }
};
