/**
 * The upper deck laid out as a band across the top of a wall, much wider than it is tall. It has
 * the same pieces as a screen's deck (deckgeo.ts), with the same names and jobs, so deck.ts runs
 * either:
 *
 * - in the middle, the big bumper with its turning cluster, the loop round them, the shuttle and
 *   two pop bumpers above, and the scoop below among mushrooms;
 * - on the left, a gutter into a saucer, the captive ball over a magnet and an orbit mouth beside
 *   it; on the right, the lock, a gutter into a saucer, a magnet and the other orbit mouth;
 * - slingshots on both end walls; the orbits rise from their mouths and run the length of the top
 *   edge, and the scoop's ramp climbs beside the loop and runs along the top into the lock;
 * - pop bumpers and mushrooms in the wings, so that a shot up any table's chute finds something.
 *
 * Sizes are in U, as on a screen, and speeds scale with S, the height of the screen whose deck
 * this one moves like. Rows are placed for a band BAND_ROWS units tall between the ceiling and
 * the chutes' tops, and spread out evenly on a taller one; a wall's deck is sized so its band is
 * never shorter (see wallgeo.ts).
 */
import {
  type Aim,
  aimAt,
  deckPhysics,
  flight,
  launchLine,
  type MagnetSpec,
  type Playfield,
  type Rail,
  type SaucerSpec,
  unitFor,
} from "./deckgeo";
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

/** How far up a band's chutes reach, in ball radii: lower than a screen's, to leave room above. */
export const BAND_CHUTE = 12;
/** Height between a band's ceiling and its chutes' tops that its rows are placed for, in U. */
export const BAND_ROWS = 46;

/** Where the wings' pop bumper groups, mushroom diamonds and magnets are, as shares of the width. */
const WING_POPS = [0.125, 0.315] as const;
const WING_MUSH = 0.405;
const MAGNET_X = 0.24;

/** The ceiling of a band of height H, deck px. */
export const bandCeiling = (H: number, U: number) => Math.max(1.5 * U, H * 0.03);

/**
 * Least height of a band, deck px: its rows, the ceiling above them (3 % of the height) and the
 * chutes and floor below (see launchLine).
 */
export const bandHeight = (U: number) => (BAND_ROWS * U + (BAND_CHUTE + 2.1) * U + 2) / 0.97;

export const buildBandPlayfield = (W: number, H: number, S: number): Playfield => {
  const U = unitFor(S);
  const phys = deckPhysics(S);
  const wr = Math.max(4, U * 0.3);
  const c = W / 2;
  const ceiling = bandCeiling(H, U);
  const L = launchLine(H, U, BAND_CHUTE);
  // Rows below the shuttle spread out on a taller band; those near the ceiling and above the
  // chutes stay put.
  const sy = Math.max(1, (L - ceiling) / (BAND_ROWS * U));
  const top = (a: number) => ceiling + a * U;
  const mid = (a: number) => ceiling + a * U * sy;
  const low = (b: number) => L - b * U;
  const P = (x: number, y: number): Pt => ({ x, y });

  const shapes: Shape[] = [];
  const walls: Seg[] = [];
  const wall = (a: Pt, b: Pt, o: { e?: number } = {}) => {
    const s = seg(a.x, a.y, b.x, b.y, { r: wr, e: o.e ?? 0.5 });
    shapes.push(s);
    walls.push(s);
    return s;
  };
  wall({ x: 0, y: 0 }, { x: 0, y: H });
  wall({ x: W, y: 0 }, { x: W, y: H });
  wall({ x: 0, y: ceiling }, { x: W, y: ceiling });

  // Slingshots on the end walls, pointing in.
  const slings: Playfield["slings"] = [];
  for (const side of [0, 1]) {
    const sx = (d: number) => (side === 0 ? d * U : W - d * U);
    const T = { x: sx(0), y: low(14.5) };
    const B = { x: sx(0), y: low(0.6) };
    const I = { x: sx(5.6), y: low(7.8) };
    const face = seg(T.x, T.y, I.x, I.y, {
      r: wr,
      tag: "sling",
      index: side,
      kick: S * 0.3,
      hitMin: 140,
      e: 0.55,
      scores: true,
    });
    const under = seg(B.x, B.y, I.x, I.y, { r: wr, e: 0.5 });
    shapes.push(face, under);
    slings.push({ face, under, pts: [T, I, B] });
  }

  // The centrepiece: a big bumper with three small ones turning round it, and the loop.
  const centre = P(c, mid(29));
  const bigR = 2.6 * U;
  const big = circle(centre.x, centre.y, bigR, {
    tag: "big",
    index: 0,
    kick: S * 0.3,
    hitMin: 20,
    e: 0.5,
    scores: true,
  });
  shapes.push(big);
  const clusterR = 6 * U;
  const clusterBumpers = [0, 1, 2].map((i) => {
    const a = (i * Math.PI * 2) / 3;
    return circle(centre.x + Math.cos(a) * clusterR, centre.y + Math.sin(a) * clusterR, 1.2 * U, {
      tag: "cluster",
      index: i,
      kick: S * 0.26,
      hitMin: 20,
      e: 0.5,
      scores: true,
    });
  });
  shapes.push(...clusterBumpers);

  // The shuttle runs to and fro above the cluster.
  const shuttleY = top(16);
  const shuttle = circle(c, shuttleY, 1.5 * U, {
    tag: "shuttle",
    index: 0,
    kick: S * 0.25,
    hitMin: 20,
    e: 0.5,
    scores: true,
  });
  shapes.push(shuttle);

  // The wings' groups go where they fit, left of the middle (and the same on the right): clear of
  // the gutter at the end, the magnet's column and the middle, and of each other.
  const magX = W * MAGNET_X;
  const taken: number[] = [];
  const room = (x: number) =>
    x - 7 * U > 31 * U &&
    (x + 7 * U < magX - 9 * U || x - 7 * U > magX + 3 * U) &&
    x + 7 * U < c - 22 * U &&
    taken.every((t) => Math.abs(t - x) > 14 * U);

  // Pop bumpers: two above the cluster, clear of the magnets' throws in to it and the loop below
  // them, and in each wing two groups of three, point up, so a ball rising between the lower two
  // meets the third.
  const popAt: Pt[] = [P(c - 17.5 * U, mid(23.5)), P(c + 17.5 * U, mid(23.5))];
  for (const f of WING_POPS) {
    if (!room(W * f)) continue;
    taken.push(W * f);
    for (const x of [W * f, W * (1 - f)]) {
      popAt.push(P(x - 5 * U, mid(24)), P(x + 5 * U, mid(24)), P(x, mid(17)));
    }
  }
  const pops: Circle[] = popAt.map((p, i) =>
    circle(p.x, p.y, 1.9 * U, {
      tag: "bumper",
      index: i,
      kick: S * 0.28,
      hitMin: 20,
      e: 0.5,
      scores: true,
    }),
  );
  shapes.push(...pops);

  // Mushrooms round the scoop, a diamond of them between each wing and the middle, and a row
  // low in each outer wing.
  const scoop = P(c, low(1.7));
  const mushAt: Pt[] = [
    P(c - 4.6 * U, low(3.4)),
    P(c + 4.6 * U, low(3.4)),
    P(c - 9.4 * U, low(5)),
    P(c + 9.4 * U, low(5)),
  ];
  const diamond = room(W * WING_MUSH);
  for (const x of diamond ? [W * WING_MUSH, W * (1 - WING_MUSH)] : []) {
    mushAt.push(P(x, mid(15)), P(x - 3.5 * U, mid(19)), P(x + 3.5 * U, mid(19)), P(x, mid(23)));
  }
  for (const s of [-1, 1]) {
    for (const [d, b] of [
      [W * 0.09, 6.5],
      [W * 0.12, 9.5],
      [W * 0.15, 6.5],
    ] as const) {
      mushAt.push(P(s < 0 ? d : W - d, low(b)));
    }
  }
  const mushrooms = mushAt.map((p, i) =>
    circle(p.x, p.y, 0.9 * U, { tag: "mushroom", index: i, e: 0.6, scores: true }),
  );
  shapes.push(...mushrooms);
  const posts: Circle[] = [];

  // Magnets low in the wings, with the captive ball's chamber straight above the left one.
  const magY = low(10);
  const magL = P(magX, magY);
  const magR = P(W - magX, magY);

  // Spinners in the orbit mouths, up and out from the magnets, which throw steeply up through
  // them.
  const mouthY = magY - 12 * U;
  const mouthHalf = 1.7 * U;
  const mouths = [magL.x - 6 * U, magR.x + 6 * U];
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

  const cx = magL.x;
  const chamberTop = mid(17.5);
  const postY = mid(27.5);
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

  // Gutters: one from the top left down to the left saucer, one from under the lock down to the
  // right saucer.
  const gutters: Pt[][] = [];
  const gutter = (a: Pt, b: Pt) => {
    wall(a, b, { e: 0.2 });
    gutters.push([a, b]);
    return { a, b };
  };
  const lockX = W - 7.5 * U;
  const lockTop = top(5);
  const lockBottom = top(18.5);
  const gl = gutter(P(3.5 * U, top(9)), P(28 * U, top(17.5)));
  const gr = gutter(P(W - 4.7 * U, lockBottom + 2.2 * U), P(W - 30 * U, lockBottom + 7.7 * U));
  const onGutter = (g: { a: Pt; b: Pt }, back: number) => {
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const l = Math.hypot(dx, dy);
    const flip = dx / l > 0 ? 1 : -1;
    const nx = (dy / l) * flip;
    const ny = (-dx / l) * flip;
    const off = U + wr;
    return { x: g.b.x - (dx / l) * back + nx * off, y: g.b.y - (dy / l) * back + ny * off };
  };
  const saucerL = onGutter(gl, 1.4 * U);
  const saucerR = onGutter(gr, 1.4 * U);

  // The lock in the top right corner: a tube against the end wall, open at the top.
  wall(
    { x: lockX - 1.5 * U, y: lockTop + 2.6 * U },
    { x: lockX - 1.5 * U, y: lockBottom - 2.4 * U },
  );
  const stack = [0, 1, 2].map((i) => ({ x: lockX, y: lockBottom - U - i * 2.15 * U }));

  // Rides.
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
  const lockIn = { x: lockX, y: lockTop };
  /**
   * Points every few units from a to b (both left out), so the curve through them doesn't
   * overshoot next to short segments.
   */
  const along = (a: Pt, b: Pt, every = 12): Pt[] => {
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (every * U)));
    return Array.from({ length: n - 1 }, (_, i) =>
      P(a.x + ((b.x - a.x) * (i + 1)) / n, a.y + ((b.y - a.y) * (i + 1)) / n),
    );
  };
  /** Straight up from an orbit's mouth, then along the top towards `s` (1 right, -1 left). */
  const rise = (m: number, s: number, y: number): Pt[] => {
    const a = P(m, mouthY - 5 * U);
    const b = P(m, top(7.5));
    return [P(m, mouthY), a, ...along(a, b, 4), b, P(m + s * 2.6 * U, y + U), P(m + s * 7 * U, y)];
  };
  const rails: Rail[] = [];
  // Straight up from the left mouth and along the top edge into the lock.
  const runL = top(2.2);
  const turnL = mouths[0]! + 7 * U;
  rails.push(
    rail(
      "orbitL",
      [
        ...rise(mouths[0]!, 1, runL),
        ...along(P(turnL, runL), P(W - 11 * U, runL)),
        P(W - 11 * U, top(2.3)),
        lockIn,
      ],
      { gate: mouthGate(mouths[0]!, 0), minSpeed: 1300, speed: 3600, exitSpeed: 350 },
    ),
  );
  // Straight up from the right mouth and all the way back along the top onto the left gutter.
  const runR = top(1.2);
  const turnR = mouths[1]! - 7 * U;
  rails.push(
    rail(
      "orbitR",
      [
        ...rise(mouths[1]!, -1, runR),
        ...along(P(turnR, runR), P(6 * U, runR)),
        P(6 * U, top(1.3)),
        P(4.2 * U, top(6.5)),
      ],
      { gate: mouthGate(mouths[1]!, 1), minSpeed: 1300, speed: 3600, exitSpeed: 350 },
    ),
  );
  // A turn and a quarter round the cluster: in at the bottom moving right, out of the right side
  // straight up towards the shuttle.
  const loopR = 10 * U;
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
    exitSpeed: 1700,
  });
  // The up-kicker's ramp, from the scoop up beside the loop and along the top into the lock.
  const vx = c + 13.2 * U;
  const runV = top(4.6);
  const climb = [P(vx, centre.y + 2 * U), P(vx, top(10))];
  rails.push(
    rail(
      "vuk",
      [
        scoop,
        P(c + 3.5 * U, scoop.y - 3.2 * U),
        P(c + 10.5 * U, centre.y + 7 * U),
        climb[0]!,
        ...along(climb[0]!, climb[1]!, 4),
        climb[1]!,
        P(vx + 2.4 * U, runV + 1.2 * U),
        P(vx + 7 * U, runV),
        ...along(P(vx + 7 * U, runV), P(W - 13 * U, runV)),
        P(W - 13 * U, runV),
        lockIn,
      ],
      { speed: 3000, exitSpeed: 300 },
    ),
  );
  const gates: Gate[] = [...spinners, ...rails.flatMap((r) => (r.gate ? [r.gate] : []))];

  // Star rollovers along the bottom, either side of the middle.
  const stars: Rollover[] = [];
  const starY = low(2.6);
  const leftXs: number[] = [];
  for (let x = c - 19 * U; x > 20 * U; x -= Math.max(9 * U, W * 0.04)) leftXs.push(x);
  const starXs = [...leftXs, ...leftXs.map((x) => W - x)].sort((a, b) => a - b);
  starXs.forEach((x, index) =>
    stars.push({ tag: "star", index, x, y: starY, r: 1.3 * U, inside: new Set<number>() }),
  );

  // Magnets. The left one throws in turn at the left orbit's mouth, the loop's mouth and the
  // captive ball above it; the right one at the right orbit's mouth and into the cluster.
  const above = (g: Gate, d: number) => ({
    x: (g.ax + g.bx) / 2 + g.nx * d,
    y: (g.ay + g.by) / 2 + g.ny * d,
  });
  const gateAim = (from: Pt, g: Gate, up: number) => {
    const t = above(g, 0);
    return aimAt(phys, from, t.x, t.y, up);
  };
  /** A throw that reaches (tx, ty) after `ms`, for long throws along the band. */
  const lob = (from: Pt, tx: number, ty: number, ms: number): Aim => {
    const T = ms / 1000;
    let vx = (tx - from.x) / T;
    let vy = (ty - from.y - (phys.gravity * T * T) / 2) / T;
    for (let i = 0; i < 6; i++) {
      const end = flight(phys, from.x, from.y, vx, vy, ms);
      vx += (tx - end.x) / T;
      vy += (ty - end.y) / T;
    }
    return { vx, vy, tx, ty };
  };
  const magnets: MagnetSpec[] = [
    {
      ...magL,
      r: 2.3 * U,
      aims: [
        gateAim(magL, rails[0]!.gate!, 2000),
        lob(magL, loopGate.ax + U, (loopGate.ay + loopGate.by) / 2, 900),
        aimAt(phys, magL, cx, postY + 0.6 * U, 2000),
      ],
    },
    {
      ...magR,
      r: 2.3 * U,
      aims: [
        gateAim(magR, rails[1]!.gate!, 2000),
        lob(magR, centre.x + 2.6 * U, centre.y + 1.5 * U, 700),
      ],
    },
  ];

  const saucers: SaucerSpec[] = [
    {
      ...saucerL,
      r: 1.4 * U,
      kick: aimAt(phys, saucerL, W * WING_POPS[0]!, mid(20), -400),
    },
    {
      ...saucerR,
      r: 1.4 * U,
      kick: aimAt(phys, saucerR, W * (1 - WING_POPS[0]!), mid(20), -400),
    },
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
    shuttle: { bumper: shuttle, x0: c - 10 * U, x1: c + 10 * U, y: shuttleY, period: 6 },
    spinners,
    rails,
    magnets,
    saucers,
    vuk: { x: scoop.x, y: scoop.y, r: 1.6 * U, rail: 3 },
    lock: {
      x: lockX,
      mouth: { x: lockX, y: lockTop + U, r: 2 * U },
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
    totalSize: 3.2 * U,
    columns: false,
    nest: { y: top(13), minX: W * 0.1, maxX: W * 0.9, cupW: 2.3 * U, depth: 2.4 * U },
    bubbles: { y0: low(3), y1: top(2), r: 2.2 * U },
  };
};
