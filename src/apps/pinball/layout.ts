/**
 * The table, as data: walls, bumpers, slingshots, targets, rollovers, flippers and lanes, in
 * table px (a 1080 x 1920 panel, y down). `buildTable` returns fresh shapes each time because the
 * solver keeps per-shape state.
 *
 * Every table shares a skeleton: the shell and arch, the plunger lane, the main and upper
 * flippers, inlanes, outlanes, slingshots, the outlane posts, the deck lane and its tubes, and the
 * lamps the score needs. The middle of the playfield (lanes, bumpers, targets, a theme's toys) is
 * built by a `Middle` function through a `TableBuilder`, which mirrors whatever it adds. The
 * classic middle is `classicMiddle`; themes bring their own (themes/).
 *
 * The plunger lane is on the right. The left table of a pair is mirrored so that its plunger
 * lane, and the plunger pad with it, sit at the outer edge away from the seam.
 *
 * The deck lane is in the upper left, tilted up and to the right, so the shots that go in are
 * the ones from the upper left flipper below it: the main flippers send the ball up at the wrong
 * angle. Through it the ball either climbs off the top of the table to the screen's upper deck
 * or, with no deck, runs round the orbit ramp back into the top of the plunger lane.
 */
import { BALL_R, TABLE_H, TABLE_W } from "./config";
import {
  type Arc,
  arc,
  type Circle,
  circle,
  type Flipper,
  type Gate,
  type Rollover,
  type Seg,
  seg,
  type Shape,
  type ShapeOpts,
} from "./physics";

export type FlipperName = "left" | "right" | "upLeft" | "upRight";

export interface Point {
  x: number;
  y: number;
}

export interface Lamp extends Point {
  tag: string;
  index: number;
  r: number;
}

export interface TableLayout<M = unknown> {
  mirror: boolean;
  /** The theme whose middle this is ("classic" for the classic one). */
  theme: string;
  /** What the middle's builder returned, for the theme's toys and drawing. */
  middle: M;
  shapes: Shape[];
  /** By index: left, right, upLeft, upRight, where left and right are as seen on the table. */
  flippers: Flipper[];
  rollovers: Rollover[];
  gates: Gate[];
  plunger: {
    /** Where a served ball waits. */
    ball: Point;
    /** The tip the ball rests on, moved by the pull. */
    tip: Seg;
    tipY: number;
    /** Longest pull, table px. */
    travel: number;
    /** A ball inside this box is waiting in the lane. */
    zone: { x0: number; y0: number; x1: number; y1: number };
  };
  /** The tube from the deck lane's end up off the top edge, and the orbit ramp. */
  exitTube: Point[];
  orbitTube: Point[];
  /** Where an orbit releases the ball, and with what velocity. */
  orbitRelease: { x: number; y: number; vx: number; vy: number };
  /** The return tube from the top edge down into the table, and where it lets go. */
  returnTube: Point[];
  returnRelease: { x: number; y: number; vx: number; vy: number };
  /** Fractions across the table's top edge where balls leave for and come from the deck. */
  exitU: number;
  returnU: number;
  lamps: Lamp[];
  /** Outlane posts, off until a posts gift raises them. */
  posts: Seg[];
  /** For drawing: lane guides and the deck lane outline. */
  deckLane: { mouth: Point; end: Point; dir: Point };
}

const WALL_R = 7;

/**
 * Adds things to a table being built. Coordinates are as built, for the unmirrored table (plunger
 * lane on the right); the builder mirrors them for a mirrored table. `X`, `A` and `P` give the
 * table's own coordinates for anything worked out by hand.
 */
export interface TableBuilder {
  readonly mirror: boolean;
  X(x: number): number;
  /** An angle as built (radians, y down) as the table's. */
  A(a: number): number;
  P(x: number, y: number): Point;
  /** A plain wall: a thick segment drawn as a rail. */
  wall(ax: number, ay: number, bx: number, by: number, o?: ShapeOpts): Seg;
  seg(ax: number, ay: number, bx: number, by: number, o?: ShapeOpts): Seg;
  circle(x: number, y: number, r: number, o?: ShapeOpts): Circle;
  /** Centreline radius `rad` from angle a0 to a1 (a1 > a0), as built. */
  arc(cx: number, cy: number, rad: number, a0: number, a1: number, o?: ShapeOpts): Arc;
  roll(tag: string, index: number, x: number, y: number, r?: number): Rollover;
  /** A sensor line from a to b, reporting crossings towards `n` as forward. */
  gate(tag: string, index: number, a: Point, b: Point, n: Point): Gate;
  lamp(tag: string, index: number, x: number, y: number, r?: number): Lamp;
}

/** Builds the middle of the playfield and returns what its toys and drawing need. */
export type Middle<M = unknown> = (b: TableBuilder) => M;

interface BuildOpts<M> {
  mirror: boolean;
  /** The middle of the playfield: the classic one when absent. */
  middle?: Middle<M>;
  /** Names the middle, for drawing and tests. */
  theme?: string;
  /** Overrides for trying other deck lane placements. */
  lane?: { mouth: Point; end: Point; half: number; guard?: number };
}

export const FLIPPER_NAMES: readonly FlipperName[] = ["left", "right", "upLeft", "upRight"];

const DEG = Math.PI / 180;

export const buildTable = <M = unknown>(opts: BuildOpts<M>): TableLayout<M> => {
  const m = opts.mirror;
  const X = (x: number) => (m ? TABLE_W - x : x);
  const A = (a: number) => (m ? Math.PI - a : a);
  const P = (x: number, y: number): Point => ({ x: X(x), y });
  const shapes: Shape[] = [];
  const wall = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    o: ShapeOpts & { oneWay?: { nx: number; ny: number } } = {},
  ) => {
    const s = seg(X(ax), ay, X(bx), by, { r: WALL_R, ...o });
    shapes.push(s);
    return s;
  };

  // Outer shell: left wall, the arch over the top, the plunger lane on the right.
  wall(24, TABLE_H + 40, 24, 640);
  shapes.push(arc(540, 640, 516, Math.PI, Math.PI * 2, { r: WALL_R }));
  wall(1058, 640, 1058, TABLE_H + 40);
  wall(976, TABLE_H + 40, 976, 610);
  // One-way gate at the top of the plunger lane: balls go up through it, not back down.
  const gdx = 1058 - 976;
  const gdy = 548 - 610;
  const gl = Math.hypot(gdx, gdy);
  const gnx = (gdy / gl) * (m ? -1 : 1);
  const gny = -gdx / gl;
  wall(976, 610, 1058, 548, { oneWay: { nx: gnx, ny: gny }, e: 0.2 });

  // Lower playfield, mirror-symmetric about x = 500 (the plunger lane takes the right edge).
  const lower = (side: 1 | -1) => {
    const L = (x: number) => (side === 1 ? x : 1000 - x);
    const i = side === 1 ? 0 : 1;
    wall(L(96), 1330, L(96), 1540);
    // The inlane guide's surface lines up with the top of the flipper at rest, so a ball rolls
    // straight on to it; a raised flipper and the guide make the cradle.
    wall(L(96), 1540, L(294), 1652);
    // Slingshot: a triangle whose inner face kicks.
    wall(L(176), 1360, L(176), 1490);
    wall(L(176), 1490, L(262), 1542);
    const face = seg(X(L(176)), 1360, X(L(262)), 1542, {
      r: WALL_R,
      tag: "sling",
      index: i,
      kick: 1050,
      hitMin: 140,
      e: 0.55,
      scores: true,
    });
    shapes.push(face);
  };
  lower(1);
  lower(-1);
  const posts = [
    seg(X(24), 1300, X(96), 1336, { r: WALL_R, on: false, e: 0.3 }),
    seg(X(976), 1300, X(904), 1336, { r: WALL_R, on: false, e: 0.3 }),
  ];
  shapes.push(...posts);

  // The middle of the playfield: the theme's, built through the builder, which mirrors it.
  const rollovers: Rollover[] = [];
  const gates: Gate[] = [];
  const lamps: Lamp[] = [];
  const middleShapes: Shape[] = [];
  const middleGates: Gate[] = [];
  const builder: TableBuilder = {
    mirror: m,
    X,
    A,
    P,
    wall(ax, ay, bx, by, o = {}) {
      const s = seg(X(ax), ay, X(bx), by, { r: WALL_R, ...o });
      middleShapes.push(s);
      return s;
    },
    seg(ax, ay, bx, by, o = {}) {
      const s = seg(X(ax), ay, X(bx), by, o);
      middleShapes.push(s);
      return s;
    },
    circle(x, y, r, o = {}) {
      const c = circle(X(x), y, r, o);
      middleShapes.push(c);
      return c;
    },
    arc(cx, cy, rad, a0, a1, o = {}) {
      // Mirrored, the angles run the other way round: [a0, a1] becomes [pi - a1, pi - a0].
      const a = m
        ? arc(X(cx), cy, rad, Math.PI - a1, Math.PI - a0, o)
        : arc(cx, cy, rad, a0, a1, o);
      middleShapes.push(a);
      return a;
    },
    roll(tag, index, x, y, r = 20) {
      const o: Rollover = { tag, index, x: X(x), y, r, inside: new Set() };
      rollovers.push(o);
      return o;
    },
    gate(tag, index, a, b, n) {
      const g: Gate = {
        tag,
        index,
        ax: X(a.x),
        ay: a.y,
        bx: X(b.x),
        by: b.y,
        nx: m ? -n.x : n.x,
        ny: n.y,
      };
      middleGates.push(g);
      return g;
    },
    lamp(tag, index, x, y, r = 22) {
      const l: Lamp = { tag, index, x: X(x), y, r };
      lamps.push(l);
      return l;
    },
  };
  const middle = (opts.middle ?? (classicMiddle as unknown as Middle<M>))(builder);
  shapes.push(...middleShapes);

  // Deck lane: two guides, mouth at the bottom left, tilted up and to the right.
  const mouth = opts.lane?.mouth ?? { x: 260, y: 520 };
  const end = opts.lane?.end ?? { x: 322, y: 351 };
  const dl = Math.hypot(end.x - mouth.x, end.y - mouth.y);
  const dir = { x: (end.x - mouth.x) / dl, y: (end.y - mouth.y) / dl };
  const perp = { x: -dir.y, y: dir.x };
  const half = opts.lane?.half ?? 48;
  wall(
    mouth.x - perp.x * half,
    mouth.y - perp.y * half,
    end.x - perp.x * half,
    end.y - perp.y * half,
  );
  // The right guide reaches further down, so steep shots from the main flippers glance off it.
  const guard = opts.lane?.guard ?? 70;
  wall(
    mouth.x + perp.x * half - dir.x * guard,
    mouth.y + perp.y * half - dir.y * guard,
    end.x + perp.x * half,
    end.y + perp.y * half,
  );

  // Plunger tip: moved down by the pull.
  const tipY = 1800;
  const tip = seg(X(983), tipY, X(1051), tipY, { r: WALL_R, e: 0.1 });
  shapes.push(tip);

  const flipper = (
    index: number,
    name: FlipperName,
    px: number,
    py: number,
    len: number,
    r0: number,
    r1: number,
    rest: number,
    up: number,
  ): Flipper => ({
    index,
    name,
    px: X(px),
    py,
    len,
    r0,
    r1,
    rest: A(rest),
    up: A(up),
    angle: A(rest),
    omega: 0,
    held: false,
    speedUp: 32,
    speedDown: 16,
    e: 0.32,
  });
  // As built (unmirrored) the first is on the left; mirrored, it ends up on the right.
  const lo = [
    flipper(0, "left", 320, 1690, 150, 24, 12, 30 * DEG, -28 * DEG),
    flipper(0, "right", 680, 1690, 150, 24, 12, Math.PI - 30 * DEG, Math.PI + 28 * DEG),
    flipper(0, "upLeft", 51, 770, 120, 20, 10, 25 * DEG, -30 * DEG),
    flipper(0, "upRight", 949, 770, 120, 20, 10, Math.PI - 25 * DEG, Math.PI + 30 * DEG),
  ];
  if (m) {
    const swap: Record<FlipperName, FlipperName> = {
      left: "right",
      right: "left",
      upLeft: "upRight",
      upRight: "upLeft",
    };
    for (const f of lo) f.name = swap[f.name as FlipperName];
  }
  const flippers = FLIPPER_NAMES.map((n, i) => {
    const f = lo.find((x) => x.name === n)!;
    f.index = i;
    return f;
  });

  const roll = (tag: string, index: number, x: number, y: number, r = 20) =>
    rollovers.push({ tag, index, x: X(x), y, r, inside: new Set() });
  roll("inlane", 0, 136, 1460);
  roll("inlane", 1, 864, 1460);
  roll("outlane", 0, 60, 1450);
  roll("outlane", 1, 940, 1450);

  const gate = (tag: string, a: Point, b: Point, n: Point): Gate => ({
    tag,
    index: 0,
    ax: X(a.x),
    ay: a.y,
    bx: X(b.x),
    by: b.y,
    nx: m ? -n.x : n.x,
    ny: n.y,
  });
  gates.push(
    gate(
      "deck",
      { x: end.x - perp.x * half, y: end.y - perp.y * half },
      { x: end.x + perp.x * half, y: end.y + perp.y * half },
      dir,
    ),
    ...middleGates,
  );

  const lamp = (tag: string, index: number, x: number, y: number, r = 22) =>
    lamps.push({ tag, index, x: X(x), y, r });
  // Read left to right on a mirrored table too.
  [380, 460, 540, 620].forEach((x, i) => lamp("mult", m ? 3 - i : i, x, 1290, 30));
  lamp("save", 0, 500, 1505, 30);
  lamp("deck", 0, mouth.x + 18, mouth.y + 96, 34);

  const exitStart = { x: end.x, y: end.y };
  const exitTube: Point[] = [P(exitStart.x, exitStart.y), P(end.x, -BALL_R - 6)];
  const orbitTube: Point[] = [P(exitStart.x, exitStart.y), P(end.x, 70), P(1017, 70), P(1017, 640)];
  const returnTube: Point[] = [P(555, -BALL_R - 6), P(555, 200)];

  return {
    mirror: m,
    theme: opts.theme ?? "classic",
    middle,
    shapes,
    flippers,
    rollovers,
    gates,
    plunger: {
      ball: P(1017, tipY - WALL_R - BALL_R - 1),
      tip,
      tipY,
      travel: 90,
      zone: m
        ? { x0: TABLE_W - 1058, y0: 1640, x1: TABLE_W - 976, y1: TABLE_H }
        : { x0: 976, y0: 1640, x1: 1058, y1: TABLE_H },
    },
    exitTube,
    orbitTube,
    orbitRelease: { x: X(1017), y: 640, vx: 0, vy: -2500 },
    returnTube,
    returnRelease: { x: X(555), y: 200, vx: 0, vy: 260 },
    exitU: X(end.x) / TABLE_W,
    returnU: X(555) / TABLE_W,
    lamps,
    posts,
    deckLane: {
      mouth: P(mouth.x, mouth.y),
      end: P(end.x, end.y),
      dir: { x: m ? -dir.x : dir.x, y: dir.y },
    },
  };
};

/**
 * The classic middle: three top lanes, three pop bumpers, a bank of three stand-up targets in the
 * upper right facing the upper right flipper, and a spinner in the middle.
 */
export const classicMiddle: Middle<null> = (b) => {
  for (const gx of [420, 510, 600, 690]) b.wall(gx, 235, gx, 305);
  [
    { x: 480, y: 450 },
    { x: 660, y: 440 },
    { x: 570, y: 565 },
  ].forEach((p, i) =>
    b.circle(p.x, p.y, 46, {
      tag: "bumper",
      index: i,
      kick: 1150,
      hitMin: 25,
      e: 0.5,
      scores: true,
    }),
  );
  // Stand-up targets in the upper right, facing the upper right flipper.
  const t0 = { x: 820, y: 330 };
  const t1 = { x: 930, y: 450 };
  const tl = Math.hypot(t1.x - t0.x, t1.y - t0.y);
  const td = { x: (t1.x - t0.x) / tl, y: (t1.y - t0.y) / tl };
  const spots: Point[] = [];
  for (let k = 0; k < 3; k++) {
    const s0 = 6 + k * 52;
    const s1 = s0 + 44;
    const a = { x: t0.x + td.x * s0, y: t0.y + td.y * s0 };
    const c = { x: t0.x + td.x * s1, y: t0.y + td.y * s1 };
    b.seg(a.x, a.y, c.x, c.y, {
      r: 10,
      tag: "target",
      index: k,
      e: 0.35,
      hitMin: 120,
      scores: true,
    });
    spots.push({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
  }
  [465, 555, 645].forEach((x, i) => b.roll("lane", i, x, 275));
  b.gate("spinner", 0, { x: 450, y: 800 }, { x: 550, y: 800 }, { x: 0, y: -1 });
  [465, 555, 645].forEach((x, i) => b.lamp("lane", i, x, 275, 24));
  spots.forEach((p, i) => b.lamp("target", i, p.x - td.y * 34, p.y + td.x * 34, 16));
  b.lamp("spinner", 0, 500, 800, 30);
  return null;
};

/** Fraction across the table's top edge where a deck ball leaves or arrives, for any table. */
export const EXIT_U = 322 / TABLE_W;
export const RETURN_U = 555 / TABLE_W;
export const exitU = (mirror: boolean) => (mirror ? 1 - EXIT_U : EXIT_U);
export const returnU = (mirror: boolean) => (mirror ? 1 - RETURN_U : RETURN_U);

/** The left tables of a merged frame are mirrored, so every plunger sits at an outer edge. */
export const mirroredAt = (index: number, tables: number) =>
  tables >= 2 && index < Math.floor(tables / 2);
