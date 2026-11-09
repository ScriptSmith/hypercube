/**
 * The upper deck's layout, as data. Two parts:
 *
 * - The playfield, built once for the screen's size: pop bumpers, a big bumper that grows as it
 *   is hit, a cluster of bumpers turning round it, a shuttle bumper on a track, mushrooms and
 *   posts, slingshots, magnets, kickout saucers, a scoop with a vertical up-kicker, a ball lock,
 *   a captive ball, gutters, spinners, the nest's track, and ramps (scripted rides): an orbit
 *   each way round the deck's edge, a loop round the cluster and the up-kicker's ramp.
 * - The slots, rebuilt when tables come and go: above each table, its chute, its return hole, its
 *   part of the floor and its target.
 *
 * Playfield positions are fractions of the deck; sizes are in U, a little more than the largest
 * deck ball's radius, so every lane and pocket fits any ball. Slots keep their chutes and holes
 * exactly above their tables' exits and returns at every bank size.
 */
import { bankFraction } from "../../core/layout";
import { BALL_R, TABLE_W } from "./config";
import { exitU, mirroredAt, returnU } from "./layout";
import { polyLength, type Pt, smoothPath } from "./path";
import {
  type Circle,
  circle,
  type Gate,
  type Rollover,
  type Seg,
  seg,
  type Shape,
} from "./physics";

export interface SlotInfo {
  /** The frame below, or null if no frame at that position has been seen. */
  frame: string | null;
  pos: number;
  /** Which table of that frame, and how many it has. */
  h: number;
  n: number;
  /**
   * Where the slot and its table are, deck px, when they don't follow from a bank's layout: on a
   * wall the tables stand apart, each in the middle of its share of the width.
   */
  at?: SlotPlace;
}

export interface SlotPlace {
  /** The slot's share of the deck's width. */
  x0: number;
  x1: number;
  /** The table's left edge and width. */
  tx: number;
  tw: number;
  mirror: boolean;
}

export interface Slot extends SlotInfo {
  key: string;
  index: number;
  x0: number;
  x1: number;
  chuteX: number;
  holeX: number;
  color: number;
  /** Screen px per table px over this table. */
  k: number;
  playing: boolean;
  /** The table takes balls from the deck: a person's or an attract bot's game is on. */
  open: boolean;
  score: number;
  left: number;
  inPlay: number;
  /** Local ms of the last score message. */
  seen: number;
}

/** A scripted ride: a ramp, an orbit or a loop. */
export interface Rail {
  name: "orbitL" | "orbitR" | "loop" | "vuk";
  pts: Pt[];
  length: number;
  /** The mouth a ball crosses to get on (forwards along the gate's normal), or null. */
  gate: Gate | null;
  /** Slowest crossing that gets on, along the gate's normal. */
  minSpeed: number;
  /** Average speed along the ride, and the speed it leaves at. */
  speed: number;
  exitSpeed: number;
}

export interface Aim {
  vx: number;
  vy: number;
  /** Where it aims, for drawing and tests. */
  tx: number;
  ty: number;
}

export interface MagnetSpec {
  x: number;
  y: number;
  r: number;
  aims: Aim[];
}

export interface SaucerSpec {
  x: number;
  y: number;
  r: number;
  kick: Aim;
}

export interface Playfield {
  W: number;
  H: number;
  U: number;
  gravity: number;
  vmax: number;
  damping: number;
  ceiling: number;
  /** Fixed solid shapes, the moving ones included. */
  shapes: Shape[];
  gates: Gate[];
  /** Star rollovers low on the deck, lit in the colour of the last ball over them. */
  stars: Rollover[];
  /** Walls drawn as rails (frame, gutters, housings, the captive ball's chamber). */
  walls: Seg[];
  pops: Circle[];
  mushrooms: Circle[];
  posts: Circle[];
  slings: { face: Seg; under: Seg; pts: Pt[] }[];
  big: Circle;
  bigR: number;
  cluster: { x: number; y: number; radius: number; omega: number; bumpers: Circle[] };
  shuttle: { bumper: Circle; x0: number; x1: number; y: number; period: number };
  spinners: Gate[];
  rails: Rail[];
  magnets: MagnetSpec[];
  saucers: SaucerSpec[];
  vuk: { x: number; y: number; r: number; rail: number };
  lock: {
    x: number;
    mouth: { x: number; y: number; r: number };
    /** Where held balls sit, bottom first. */
    stack: Pt[];
    top: number;
    bottom: number;
    out: Aim & { x: number; y: number };
  };
  captive: {
    rest: Pt;
    r: number;
    box: { x0: number; y0: number; x1: number; y1: number };
    target: Seg;
    posts: Circle[];
  };
  /** Gutters, for drawing: floor polylines. */
  gutters: Pt[][];
  /** Height of the shared total's digits, when it isn't the screen's usual size. */
  totalSize?: number;
  /** False when the tables' scores aren't shown above their slots (their tables show them). */
  columns?: boolean;
  nest: { y: number; minX: number; maxX: number; cupW: number; depth: number };
  bubbles: { y0: number; y1: number; r: number };
}

export interface SlotGeometry {
  R: number;
  Rc: number;
  slots: Slot[];
  slotShapes: Shape[];
  floor: Seg[];
  pillars: Seg[];
  targets: Seg[];
  holeY: number;
  edgeY: number;
  launchY: number;
  railY: number;
}

export type DeckGeometry = Playfield & SlotGeometry;

/** Deck physics for a screen of height H. */
export const deckPhysics = (H: number) => ({
  gravity: H * 0.62,
  vmax: H * 1.3,
  damping: 0.05,
});

export const DECK_SUBSTEPS = 6;
const HZ = 120;

/**
 * Fly a ball from (x, y) at (vx, vy) for `ms`, as the solver would with nothing in the way.
 * Returns where it ends up and how it is moving.
 */
export const flight = (
  p: { gravity: number; damping: number },
  x: number,
  y: number,
  vx: number,
  vy: number,
  ms: number,
) => {
  const h = 1 / (HZ * DECK_SUBSTEPS);
  const damp = Math.max(0, 1 - p.damping * h);
  const n = Math.round(ms / 1000 / h);
  for (let i = 0; i < n; i++) {
    vy += p.gravity * h;
    vx *= damp;
    vy *= damp;
    x += vx * h;
    y += vy * h;
  }
  return { x, y, vx, vy };
};

/**
 * The launch that reaches (tx, ty) still rising at `up` px/s, or falling if `up` is negative,
 * corrected for the solver's damping.
 */
export const aimAt = (
  p: { gravity: number; damping: number },
  from: Pt,
  tx: number,
  ty: number,
  up: number,
): Aim => {
  const g = p.gravity;
  const dx = tx - from.x;
  const dy = ty - from.y;
  // Arrive with vy = -up: dy = -up T - g T^2 / 2.
  const disc = up * up - 2 * g * dy;
  const T = Math.max(0.08, (-up + Math.sqrt(Math.max(0, disc))) / g);
  let vx = dx / T;
  let vy = (dy - (g * T * T) / 2) / T;
  for (let i = 0; i < 6; i++) {
    const end = flight(p, from.x, from.y, vx, vy, T * 1000);
    vx += (tx - end.x) / T;
    vy += (ty - end.y) / T;
  }
  return { vx, vy, tx, ty };
};

export const slotKey = (s: SlotInfo) => (s.frame ? `${s.frame}:${s.h}` : `@${s.pos}:${s.h}`);

/** Every table's place under the screen, from the touch frames seen so far. */
export const slotInfos = (
  count: number,
  stations: readonly { frame: string; pos: number; kind: string; span?: number }[],
): SlotInfo[] => {
  const byPos = new Map<number, { frame: string; n: number }>();
  for (const p of stations) {
    if (p.pos < 0 || p.pos >= count || byPos.has(p.pos)) continue;
    byPos.set(p.pos, {
      frame: p.frame,
      n: p.kind === "pair" ? Math.max(2, Math.min(8, p.span ?? 2)) : 1,
    });
  }
  // Positions nobody has reported yet are drawn like their neighbours.
  const tally = new Map<number, number>();
  for (const v of byPos.values()) tally.set(v.n, (tally.get(v.n) ?? 0) + 1);
  let usual = 1;
  let most = 0;
  for (const [n, c] of tally) if (c > most) [usual, most] = [n, c];
  const out: SlotInfo[] = [];
  for (let pos = 0; pos < count; pos++) {
    const f = byPos.get(pos);
    const n = f?.n ?? usual;
    for (let h = 0; h < n; h++) out.push({ frame: f?.frame ?? null, pos, h, n });
  }
  return out;
};

/** How far up a screen's chutes reach, in ball radii. */
export const CHUTE_R = 16;

/** Where balls leave the chutes, for a deck of height H and balls of radius R. */
export const launchLine = (H: number, R: number, chute = CHUTE_R) =>
  H - chute * R - 1.1 * R - R - 2;

/** The size of a unit for a screen of height H: just over the largest deck ball's radius. */
export const unitFor = (H: number) => H * 0.0095;

export const buildPlayfield = (W: number, H: number): Playfield => {
  const U = unitFor(H);
  const phys = deckPhysics(H);
  const X = (f: number) => f * W;
  const Y = (f: number) => f * H;
  const P = (fx: number, fy: number): Pt => ({ x: X(fx), y: Y(fy) });
  const wr = Math.max(4, U * 0.3);
  const shapes: Shape[] = [];
  const walls: Seg[] = [];
  const wall = (a: Pt, b: Pt, o: { e?: number } = {}) => {
    const s = seg(a.x, a.y, b.x, b.y, { r: wr, e: o.e ?? 0.5 });
    shapes.push(s);
    walls.push(s);
    return s;
  };
  const ceiling = Y(0.03);
  wall({ x: 0, y: 0 }, { x: 0, y: H });
  wall({ x: W, y: 0 }, { x: W, y: H });
  wall({ x: 0, y: ceiling }, { x: W, y: ceiling });

  // Slingshots on the side walls, arrowheads pointing in: a ball falling down a wall is kicked
  // up and in, and one rising from a chute below glances off the steep underside, up and in.
  const slings: Playfield["slings"] = [];
  for (const side of [0, 1]) {
    const sx = (f: number) => (side === 0 ? X(f) : W - X(f));
    const T = { x: sx(0), y: Y(0.5) };
    const B = { x: sx(0), y: Y(0.7) };
    const I = { x: sx(0.06), y: Y(0.585) };
    const face = seg(T.x, T.y, I.x, I.y, {
      r: wr,
      tag: "sling",
      index: side,
      kick: H * 0.3,
      hitMin: 140,
      e: 0.55,
      scores: true,
    });
    const under = seg(B.x, B.y, I.x, I.y, { r: wr, e: 0.5 });
    shapes.push(face, under);
    slings.push({ face, under, pts: [T, I, B] });
  }

  // Classic pop bumpers either side of the cluster.
  const pops: Circle[] = [P(0.29, 0.385), P(0.345, 0.48), P(0.71, 0.385), P(0.655, 0.48)].map(
    (p, i) =>
      circle(p.x, p.y, 1.9 * U, {
        tag: "bumper",
        index: i,
        kick: H * 0.28,
        hitMin: 20,
        e: 0.5,
        scores: true,
      }),
  );
  shapes.push(...pops);

  // The centrepiece: a big bumper with three small ones turning round it.
  const centre = P(0.5, 0.445);
  const bigR = 2.8 * U;
  const big = circle(centre.x, centre.y, bigR, {
    tag: "big",
    index: 0,
    kick: H * 0.3,
    hitMin: 20,
    e: 0.5,
    scores: true,
  });
  shapes.push(big);
  const clusterR = 7.2 * U;
  const clusterBumpers = [0, 1, 2].map((i) => {
    const a = (i * Math.PI * 2) / 3;
    return circle(centre.x + Math.cos(a) * clusterR, centre.y + Math.sin(a) * clusterR, 1.25 * U, {
      tag: "cluster",
      index: i,
      kick: H * 0.26,
      hitMin: 20,
      e: 0.5,
      scores: true,
    });
  });
  shapes.push(...clusterBumpers);

  // A shuttle bumper running to and fro above the cluster.
  const shuttle = circle(X(0.5), Y(0.315), 1.5 * U, {
    tag: "shuttle",
    index: 0,
    kick: H * 0.25,
    hitMin: 20,
    e: 0.5,
    scores: true,
  });
  shapes.push(shuttle);

  // Mushrooms (passive bumpers) above the scoop.
  const mushrooms = [
    P(0.4, 0.585),
    P(0.5, 0.575),
    P(0.6, 0.585),
    P(0.44, 0.645),
    P(0.56, 0.645),
  ].map((p, i) => circle(p.x, p.y, 0.9 * U, { tag: "mushroom", index: i, e: 0.6, scores: true }));
  shapes.push(...mushrooms);
  const posts: Circle[] = [];

  // Spinners in the orbit mouths.
  const mouthY = Y(0.425);
  const mouthHalf = 1.7 * U;
  const mouths = [X(0.115), X(0.885)];
  const spinners: Gate[] = mouths.map((x, index) => ({
    tag: "spinner",
    index,
    ax: x - mouthHalf,
    ay: mouthY,
    bx: x + mouthHalf,
    by: mouthY,
    nx: 0,
    ny: -1,
  }));
  for (const x of mouths) {
    const guard = [x - mouthHalf - 0.5 * U, x + mouthHalf + 0.5 * U].map((gx) =>
      circle(gx, mouthY + 0.3 * U, 0.4 * U, { e: 0.5 }),
    );
    shapes.push(...guard);
    posts.push(...guard);
  }

  // The captive ball's chamber, left of the pop bumpers.
  const cx = X(0.19);
  const chamberTop = Y(0.32);
  const postY = Y(0.42);
  const capR = 0.8 * U;
  const half = U + 6 + wr;
  wall({ x: cx - half, y: chamberTop - U }, { x: cx - half, y: postY });
  wall({ x: cx + half, y: chamberTop - U }, { x: cx + half, y: postY });
  wall({ x: cx - half, y: chamberTop - U }, { x: cx + half, y: chamberTop - U });
  const capPostR = 0.35 * U;
  const capS = 1.04 * U;
  const capPosts = [cx - capS, cx + capS].map((x) => circle(x, postY, capPostR, { e: 0.3 }));
  shapes.push(...capPosts);
  const capTarget = seg(cx - half + wr, chamberTop, cx + half - wr, chamberTop, {
    r: 0.25 * U,
    tag: "captive",
    index: 0,
    e: 0.3,
    hitMin: 200,
    scores: true,
  });
  shapes.push(capTarget);
  const restY = postY - Math.sqrt((capR + capPostR) ** 2 - capS * capS);

  // Gutters: one from the top left down to the left saucer, one from the lock down to the right
  // saucer. Each saucer sits where a ball rolling off its gutter's end passes.
  const gutters: Pt[][] = [];
  const gutter = (a: Pt, b: Pt) => {
    wall(a, b, { e: 0.2 });
    gutters.push([a, b]);
    return { a, b };
  };
  const gl = gutter(P(0.03, 0.125), P(0.245, 0.205));
  const gr = gutter(P(0.955, 0.228), P(0.765, 0.272));
  const onGutter = (g: { a: Pt; b: Pt }, back: number) => {
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const l = Math.hypot(dx, dy);
    // Above the floor's line, on the side away from gravity.
    const flip = dx / l > 0 ? 1 : -1;
    const nx = (dy / l) * flip;
    const ny = (-dx / l) * flip;
    const off = U + wr;
    return { x: g.b.x - (dx / l) * back + nx * off, y: g.b.y - (dy / l) * back + ny * off };
  };
  const saucerL = onGutter(gl, 1.4 * U);
  const saucerR = onGutter(gr, 1.4 * U);

  // The lock in the top right corner: a tube against the wall, open at the top.
  const lockX = X(0.935);
  const lockTop = Y(0.08);
  const lockBottom = Y(0.215);
  // The housing stops well above the gutter, so a ball that falls through a full lock rolls out.
  wall({ x: lockX - 1.5 * U, y: Y(0.105) }, { x: lockX - 1.5 * U, y: Y(0.19) });
  const stack = [0, 1, 2].map((i) => ({ x: lockX, y: lockBottom - U - i * 2.15 * U }));

  // Ramps and orbits.
  const step = U * 0.6;
  const rail = (
    name: Rail["name"],
    ctrl: Pt[],
    o: { gate?: Gate | null; minSpeed?: number; speed: number; exitSpeed: number },
  ): Rail => {
    const pts = smoothPath(ctrl, step);
    return {
      name,
      pts,
      length: polyLength(pts),
      gate: o.gate ?? null,
      minSpeed: o.minSpeed ?? 0,
      speed: o.speed,
      exitSpeed: o.exitSpeed,
    };
  };
  const mouthGate = (x: number, index: number): Gate => ({
    tag: "rail",
    index,
    ax: x - mouthHalf,
    ay: mouthY,
    bx: x + mouthHalf,
    by: mouthY,
    nx: 0,
    ny: -1,
  });
  // Rides into the lock come down into its mouth from above and to the left.
  const lockIn = { x: lockX, y: Y(0.08) };
  const rails: Rail[] = [];
  // Round the deck clockwise from the left mouth and into the lock.
  rails.push(
    rail(
      "orbitL",
      [
        { x: mouths[0]!, y: mouthY },
        P(0.085, 0.36),
        P(0.032, 0.27),
        P(0.022, 0.12),
        P(0.045, 0.058),
        P(0.5, 0.05),
        P(0.89, 0.052),
        lockIn,
      ],
      { gate: mouthGate(mouths[0]!, 0), minSpeed: 1300, speed: 3000, exitSpeed: 350 },
    ),
  );
  // Round the other way from the right mouth, onto the left gutter.
  rails.push(
    rail(
      "orbitR",
      [
        { x: mouths[1]!, y: mouthY },
        P(0.915, 0.36),
        P(0.968, 0.27),
        P(0.978, 0.12),
        P(0.955, 0.044),
        P(0.5, 0.04),
        P(0.07, 0.046),
        P(0.045, 0.085),
      ],
      { gate: mouthGate(mouths[1]!, 1), minSpeed: 1300, speed: 3000, exitSpeed: 350 },
    ),
  );
  // A turn and a quarter round the cluster: in at the bottom moving right, up the right side and
  // over the top, then out of the right side straight up towards the shuttle.
  const loopR = 10.2 * U;
  const loopPts: Pt[] = [];
  const a0 = Math.PI / 2;
  const a1 = -Math.PI * 2;
  for (let a = a0; a >= a1 - 1e-6; a -= (6 * Math.PI) / 180) {
    loopPts.push({ x: centre.x + Math.cos(a) * loopR, y: centre.y + Math.sin(a) * loopR });
  }
  const mouth = loopPts[0]!;
  const loopGate: Gate = {
    tag: "rail",
    index: 2,
    ax: mouth.x,
    ay: mouth.y - 1.6 * U,
    bx: mouth.x,
    by: mouth.y + 1.6 * U,
    nx: 1,
    ny: 0,
  };
  rails.push({
    name: "loop",
    pts: loopPts,
    length: polyLength(loopPts),
    gate: loopGate,
    minSpeed: 1300,
    speed: 2700,
    exitSpeed: 2000,
  });
  // The up-kicker's ramp, from the scoop up the right side to the top of the lock.
  const scoop = P(0.5, 0.73);
  rails.push(
    rail(
      "vuk",
      [
        scoop,
        P(0.5, 0.69),
        P(0.62, 0.6),
        P(0.76, 0.5),
        P(0.84, 0.33),
        P(0.9, 0.13),
        P(0.915, 0.06),
        lockIn,
      ],
      { speed: 2400, exitSpeed: 300 },
    ),
  );
  const gates: Gate[] = [...spinners, ...rails.flatMap((r) => (r.gate ? [r.gate] : []))];
  const stars: Rollover[] = [0.13, 0.22, 0.31, 0.4, 0.6, 0.69, 0.78, 0.87].map((fx, index) => ({
    tag: "star",
    index,
    x: X(fx),
    y: Y(0.715),
    r: 1.3 * U,
    inside: new Set<number>(),
  }));

  // Magnets low on each side. The left one throws in turn at the left orbit's mouth, the loop's
  // mouth and the captive ball; the right one at the right orbit's mouth and into the cluster.
  const magL = P(0.19, 0.635);
  const magR = P(0.81, 0.635);
  const above = (g: Gate, d: number) => ({
    x: (g.ax + g.bx) / 2 + g.nx * d,
    y: (g.ay + g.by) / 2 + g.ny * d,
  });
  // Through a gate fast enough to ride: steeply up through the orbits' level mouths, and
  // flatter through the loop's slanted one.
  const gateAim = (from: Pt, g: Gate, up: number) => {
    const t = above(g, 0);
    return aimAt(phys, from, t.x, t.y, up);
  };
  const magnets: MagnetSpec[] = [
    {
      ...magL,
      r: 2.3 * U,
      aims: [
        gateAim(magL, rails[0]!.gate!, 2000),
        gateAim(magL, loopGate, 300),
        aimAt(phys, magL, cx, postY + 0.6 * U, 2000),
      ],
    },
    {
      ...magR,
      r: 2.3 * U,
      aims: [gateAim(magR, rails[1]!.gate!, 2000), aimAt(phys, magR, centre.x, centre.y, 1200)],
    },
  ];

  const saucers: SaucerSpec[] = [
    { ...saucerL, r: 1.4 * U, kick: aimAt(phys, saucerL, X(0.4), Y(0.36), -400) },
    { ...saucerR, r: 1.4 * U, kick: aimAt(phys, saucerR, X(0.6), Y(0.38), -400) },
  ];

  const outFrom = { x: lockX - 1.0 * U, y: lockBottom + 0.2 * U };
  return {
    W,
    H,
    U,
    ...phys,
    ceiling,
    shapes,
    gates,
    stars,
    walls,
    pops,
    mushrooms,
    posts,
    slings,
    big,
    bigR,
    cluster: { x: centre.x, y: centre.y, radius: clusterR, omega: 0.55, bumpers: clusterBumpers },
    shuttle: { bumper: shuttle, x0: X(0.37), x1: X(0.63), y: Y(0.315), period: 7.5 },
    spinners,
    rails,
    magnets,
    saucers,
    vuk: { x: scoop.x, y: scoop.y, r: 1.6 * U, rail: 3 },
    lock: {
      x: lockX,
      mouth: { x: lockX, y: Y(0.09), r: 2 * U },
      stack,
      top: lockTop,
      bottom: lockBottom,
      out: { ...outFrom, vx: -700, vy: 150, tx: outFrom.x, ty: outFrom.y },
    },
    captive: {
      rest: { x: cx, y: restY },
      r: capR,
      box: { x0: cx - half, y0: chamberTop - U, x1: cx + half, y1: postY + capPostR },
      target: capTarget,
      posts: capPosts,
    },
    gutters,
    nest: { y: Y(0.195), minX: X(0.33), maxX: X(0.67), cupW: 2.3 * U, depth: 2.4 * U },
    bubbles: { y0: Y(0.74), y1: Y(0.07), r: 2.2 * U },
  };
};

/**
 * Above each table: its chute, its return hole, its part of the floor and its target. `unit` caps
 * the ball's radius and `chute` is how far up the chutes reach, in ball radii.
 */
export const buildSlots = (
  W: number,
  H: number,
  count: number,
  infos: SlotInfo[],
  unit = unitFor(H),
  chute = CHUTE_R,
): SlotGeometry => {
  const slots: Slot[] = infos.map((s, index) => {
    const at = s.at;
    const x0 = at ? at.x0 : W * bankFraction(s.pos, s.h / s.n, count);
    const x1 = at ? at.x1 : W * bankFraction(s.pos, (s.h + 1) / s.n, count);
    const mirror = at ? at.mirror : mirroredAt(s.h, s.n);
    const tx = at ? at.tx : x0;
    const w = at ? at.tw : x1 - x0;
    return {
      ...s,
      key: slotKey(s),
      index,
      x0,
      x1,
      chuteX: tx + exitU(mirror) * w,
      holeX: tx + returnU(mirror) * w,
      color: (s.pos * s.n + s.h) % 8,
      k: w / TABLE_W,
      playing: false,
      open: false,
      score: 0,
      left: 0,
      inPlay: 0,
      seen: -Infinity,
    };
  });
  const minW = Math.min(...slots.map((s) => (s.at ? s.at.tw : s.x1 - s.x0)), W);
  const Rc = BALL_R * (minW / TABLE_W);
  const R = Math.max(12, Math.min(unit, Rc * 3));
  const wr = Math.max(4, R * 0.3);
  const shapes: Shape[] = [];
  const wall = (ax: number, ay: number, bx: number, by: number) => {
    const s = seg(ax, ay, bx, by, { r: wr, e: 0.5 });
    shapes.push(s);
    return s;
  };
  const edgeY = H - 9 * R;
  const holeY = H - 5 * R;
  const gap = 1.45 * R;
  const floor: Seg[] = [];
  for (const s of slots) {
    floor.push(wall(s.x0, edgeY, s.holeX - gap, holeY));
    floor.push(wall(s.holeX + gap, holeY, s.x1, edgeY));
  }
  const floorAt = (s: Slot, x: number) =>
    x < s.holeX
      ? edgeY + ((holeY - edgeY) * (x - s.x0)) / Math.max(1, s.holeX - gap - s.x0)
      : edgeY + ((holeY - edgeY) * (s.x1 - x)) / Math.max(1, s.x1 - s.holeX - gap);
  const pr = 1.1 * R;
  const launchY = launchLine(H, R, chute);
  const pillars: Seg[] = [];
  for (const s of slots) {
    // Room under the chute for a ball rolling down the floor, measured across the slope.
    const run = s.chuteX < s.holeX ? s.holeX - gap - s.x0 : s.x1 - s.holeX - gap;
    const slope = (holeY - edgeY) / Math.max(1, run);
    const clear = (2.3 * R + pr + wr) * Math.sqrt(1 + slope * slope);
    const p = seg(s.chuteX, floorAt(s, s.chuteX) - clear, s.chuteX, H - chute * R, {
      r: pr,
      e: 0.5,
    });
    shapes.push(p);
    pillars.push(p);
  }
  // Each table's target stands on the far side of its hole from its chute.
  const targets: Seg[] = slots.map((s, i) => {
    const mirror = s.at ? s.at.mirror : mirroredAt(s.h, s.n);
    const w = s.x1 - s.x0;
    const cx = s.x0 + (mirror ? 0.2 : 0.8) * w;
    const half = Math.min(1.5 * R, w * 0.11);
    // Low end towards the hole, like the floor beneath it, so nothing rests against the wall.
    const tilt = (mirror ? -1 : 1) * 0.35 * half;
    const y = edgeY - 4.6 * R;
    const t = seg(cx - half, y + tilt, cx + half, y - tilt, {
      r: 0.45 * R,
      tag: "target",
      index: i,
      e: 0.4,
      hitMin: 60,
      scores: true,
    });
    shapes.push(t);
    return t;
  });
  return {
    R,
    Rc,
    slots,
    slotShapes: shapes,
    floor,
    pillars,
    targets,
    holeY,
    edgeY,
    launchY,
    railY: H - 2.2 * R,
  };
};
