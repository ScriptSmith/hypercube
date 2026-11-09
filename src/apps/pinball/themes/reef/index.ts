/**
 * Reef: the middle of the playfield and its rules.
 *
 * - Pufferfish: three pop bumpers that puff up when hit, spines out, and slowly go down again,
 *   kicking all the while.
 * - Giant clam: lies low on the right and opens and closes by itself. A ball that rolls in while
 *   it is open is caught: the shell snaps shut, a pearl lights, then it opens and spits the ball
 *   at the left flipper. Shut, it is a hard shell that balls bounce off. The third pearl pays a
 *   jackpot, and the pearls come out after the ball as two more balls.
 * - Current: a drift across the upper playfield that pushes balls one way, and now and then turns
 *   round and runs the other way.
 * - Turtle ramp: a mouth on the left takes shots from the right flipper up a ramp that curls over
 *   and drops the ball into the left inlane, with a sea turtle swimming along beside it. Every
 *   third ride raises the multiplier.
 * - Starfish: the classic bank of three targets in the upper right, scored by the table's rules.
 * - Shell lanes: the classic top lanes.
 *
 * Coordinates are as built (unmirrored); the builder mirrors shapes, and `b.P`/`b.X` mirror the
 * points kept for the toys and the look.
 */
import { BALL_R } from "../../config";
import {
  type Box,
  createFlow,
  createKickout,
  createPuffer,
  createRide,
  createToyBox,
  type Kickout,
  type P3,
  type Ride,
  type ToyBox,
} from "../../devices";
import type { Point, TableBuilder } from "../../layout";
import type { Arc, Circle, Gate, Seg } from "../../physics";
import type { ToyHost } from "../../toys";
import type { ThemeRules } from "../types";

export const REEF_POINTS = {
  puffer: 150,
  /** A ball bouncing off the shut clam. */
  shell: 50,
  clam: 1000,
  pearls: 7500,
  turtle: 2000,
  turtles: 5000,
} as const;

const PUFFERS = [
  { x: 460, y: 480 },
  { x: 650, y: 445 },
  { x: 560, y: 620 },
];
export const PUFF = { r0: 38, r1: 54, grow: 0.12, hold: 1, shrink: 0.9 } as const;
const CLAM = { x: 770, y: 1035, r: 56, catch: 40, lip: 50 };
/** Where the clam spits: at the left flipper. */
const CLAM_AIM = { x: 400, y: 1640, speed: 1100 };
/** The ramp's mouth, its axis (up the ramp) and its half width. */
const MOUTH = { x: 360, y: 1125, half: 50, depth: 66 };
const MOUTH_DIR = { x: Math.cos(250 * (Math.PI / 180)), y: Math.sin(250 * (Math.PI / 180)) };
/** Slowest crossing of the mouth that climbs the ramp, px/s along its axis. */
export const RIDE_MIN = 250;
const CURRENT = { x0: 380, y0: 330, x1: 960, y1: 740, accel: 420, turn: 0.9 };

/** The clam's timing, seconds. */
export const CLAM_S = {
  open: 7,
  closing: 0.7,
  shut: 2.5,
  opening: 0.8,
  /** Holding a ball: snapping shut, staying shut, and opening to spit it out. */
  snap: 0.15,
  hold: 2,
  spit: 0.4,
  /** Gap between the pearls that follow a jackpot's ball out. */
  pearl: 0.3,
} as const;

export interface ReefMiddle {
  mirror: boolean;
  lanes: Point[];
  puffers: Circle[];
  clam: {
    x: number;
    y: number;
    r: number;
    /** The shell balls bounce off while the clam is shut, and the hinge on its right, always up. */
    shell: Circle;
    hinge: Arc;
    /** Where it lets balls out, and the way they go. */
    lip: Point;
    aim: { vx: number; vy: number };
    /** The pearl balls of a jackpot: one aim each. */
    pearls: { vx: number; vy: number }[];
    /** 1 on a table as built, -1 mirrored. */
    side: number;
  };
  current: { box: Box; dir: Point };
  ramp: {
    mouth: Point;
    /** Up the ramp, as seen on the table. */
    dir: Point;
    half: number;
    walls: Seg[];
    gate: Gate;
    /** The ride, from the top of the mouth to the inlane, with height. */
    path: P3[];
  };
  stars: Seg[];
}

const DEG = Math.PI / 180;

const norm = (x: number, y: number) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

const middle = (b: TableBuilder): ReefMiddle => {
  const side = b.mirror ? -1 : 1;
  // Shell lanes under the arch, as on the classic table.
  for (const gx of [420, 510, 600, 690]) b.wall(gx, 235, gx, 305);
  const lanes = [465, 555, 645].map((x, i) => {
    b.roll("lane", i, x, 275);
    b.lamp("lane", i, x, 275, 24);
    return b.P(x, 275);
  });

  const puffers = PUFFERS.map((p, i) =>
    b.circle(p.x, p.y, PUFF.r0, {
      tag: "puffer",
      index: i,
      kick: 1100,
      hitMin: 25,
      e: 0.5,
      scores: true,
    }),
  );

  // Starfish on the classic targets in the upper right, facing down the table.
  const t0 = { x: 820, y: 330 };
  const t1 = { x: 930, y: 450 };
  const tl = Math.hypot(t1.x - t0.x, t1.y - t0.y);
  const td = { x: (t1.x - t0.x) / tl, y: (t1.y - t0.y) / tl };
  const stars: Seg[] = [];
  for (let k = 0; k < 3; k++) {
    const s0 = 6 + k * 52;
    const s1 = s0 + 44;
    const a = { x: t0.x + td.x * s0, y: t0.y + td.y * s0 };
    const c = { x: t0.x + td.x * s1, y: t0.y + td.y * s1 };
    stars.push(
      b.seg(a.x, a.y, c.x, c.y, {
        r: 10,
        tag: "target",
        index: k,
        e: 0.35,
        hitMin: 120,
        scores: true,
      }),
    );
    const mx = (a.x + c.x) / 2;
    const my = (a.y + c.y) / 2;
    b.lamp("target", k, mx - td.y * 34, my + td.x * 34, 16);
  }

  // The clam, hinged on its right: the hinge and the raised lid make a wall that is always there,
  // so an open clam is a pocket that takes balls from above, below and the left; and a shell
  // that is solid while it is shut (the toys switch it off while it is open).
  const hinge = b.arc(CLAM.x, CLAM.y, CLAM.r, -70 * DEG, 70 * DEG, { r: 8, tag: "hinge", e: 0.3 });
  const shell = b.circle(CLAM.x, CLAM.y, CLAM.r, {
    tag: "clam",
    e: 0.35,
    hitMin: 80,
    scores: true,
  });
  const toFlip = norm(CLAM_AIM.x - CLAM.x, CLAM_AIM.y - CLAM.y);
  const lip = b.P(CLAM.x + toFlip.x * CLAM.lip, CLAM.y + toFlip.y * CLAM.lip);
  const aimAt = (turn: number) => {
    const a = Math.atan2(toFlip.y, toFlip.x) + turn;
    return { vx: side * Math.cos(a) * CLAM_AIM.speed, vy: Math.sin(a) * CLAM_AIM.speed };
  };
  [-1, 0, 1].forEach((k, i) =>
    b.lamp("pearl", i, CLAM.x + k * 58, CLAM.y + 95 - Math.abs(k) * 12, 17),
  );

  // The turtle ramp's mouth: a short channel up and to the left, closed at its far end, with a
  // gate across its entrance. Balls fast enough climb the ramp from the gate.
  const d = MOUTH_DIR;
  const p = { x: -d.y, y: d.x };
  const M = { x: MOUTH.x, y: MOUTH.y };
  const E = { x: M.x + d.x * MOUTH.depth, y: M.y + d.y * MOUTH.depth };
  const h = MOUTH.half;
  const corner = (o: Point, k: number) => ({ x: o.x + p.x * h * k, y: o.y + p.y * h * k });
  const walls = [
    [corner(M, -1), corner(E, -1)],
    [corner(M, 1), corner(E, 1)],
    [corner(E, -1), corner(E, 1)],
  ].map(([a, c]) => b.seg(a!.x, a!.y, c!.x, c!.y, { r: 8, tag: "reef", e: 0.4 }));
  const g0 = { x: corner(M, -1).x + d.x * 12, y: corner(M, -1).y + d.y * 12 };
  const g1 = { x: corner(M, 1).x + d.x * 12, y: corner(M, 1).y + d.y * 12 };
  const gate = b.gate("ramp", 0, g0, g1, d);
  [0, 1, 2].forEach((i) => b.lamp("turtle", i, 300 - i * 18, 1185 + i * 37, 18));
  // Up out of the mouth, round a hairpin over the left side, and down into the left inlane.
  const path: P3[] = [
    [326, 1035, 40],
    [305, 985, 62],
    [275, 945, 82],
    [235, 915, 96],
    [190, 905, 102],
    [150, 920, 102],
    [125, 960, 98],
    [117, 1020, 92],
    [122, 1100, 80],
    [130, 1180, 62],
    [135, 1250, 45],
    [136, 1300, 32],
    [136, 1328, BALL_R],
  ].map(([x, y, z]) => ({ ...b.P(x!, y!), z: z! }));

  return {
    mirror: b.mirror,
    lanes,
    puffers,
    clam: {
      ...b.P(CLAM.x, CLAM.y),
      r: CLAM.r,
      shell,
      hinge,
      lip,
      aim: aimAt(0),
      pearls: [aimAt(-0.32), aimAt(0.26)],
      side,
    },
    current: {
      box: b.mirror
        ? { x0: b.X(CURRENT.x1), y0: CURRENT.y0, x1: b.X(CURRENT.x0), y1: CURRENT.y1 }
        : { x0: CURRENT.x0, y0: CURRENT.y0, x1: CURRENT.x1, y1: CURRENT.y1 },
      dir: { x: side, y: 0 },
    },
    ramp: {
      mouth: b.P(M.x, M.y),
      dir: { x: side * d.x, y: d.y },
      half: h,
      walls,
      gate,
      path,
    },
    stars,
  };
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export type ClamPhase = "open" | "closing" | "shut" | "opening" | "holding";

type Puffer = ReturnType<typeof createPuffer>;
type Flow = ReturnType<typeof createFlow>;

export interface ReefToys extends ToyBox {
  readonly middle: ReefMiddle;
  readonly puffers: readonly Puffer[];
  readonly clam: Kickout;
  readonly ride: Ride;
  readonly flow: Flow;
  readonly clamPhase: ClamPhase;
  /** How far open the clam's lid is: 0 shut, 1 wide open. */
  lid(now: number): number;
  /** Pearls lit towards the next jackpot, 0 to 3. */
  readonly pearls: number;
  /** Rides up the turtle ramp this game. */
  readonly rides: number;
  /** World seconds of the last jackpot and the current's last turn. */
  readonly jackpotAt: number;
  readonly turnAt: number;
}

const toys = (host: ToyHost, m: ReefMiddle): ReefToys => {
  const puffers = m.puffers.map((c) => createPuffer(c, PUFF));
  const flow = createFlow({
    box: m.current.box,
    dir: m.current.dir,
    accel: CURRENT.accel,
    turn: CURRENT.turn,
  });
  const c = m.clam;
  let phase: ClamPhase = "shut";
  let phaseAt = 0;
  let lid0 = 0;
  const lidAt = (now: number): number => {
    const t = now - phaseAt;
    switch (phase) {
      case "open":
        return 1;
      case "closing":
        return lid0 * (1 - ease(t / CLAM_S.closing));
      case "shut":
        return 0;
      case "opening":
        return lid0 + (1 - lid0) * ease(t / CLAM_S.opening);
      case "holding": {
        if (t < CLAM_S.snap) return lid0 * (1 - t / CLAM_S.snap);
        const spitFrom = CLAM_S.hold - CLAM_S.spit;
        return t < spitFrom ? 0 : ease((t - spitFrom) / CLAM_S.spit);
      }
    }
  };
  const to = (p: ClamPhase, now: number) => {
    lid0 = lidAt(now);
    phase = p;
    phaseAt = now;
  };
  const clam = createKickout({
    name: "clam",
    x: c.x,
    y: c.y,
    r: 50,
    maxSpeed: 2800,
    hold: CLAM_S.hold,
    cool: 1.2,
    out: { x: c.lip.x, y: c.lip.y, vx: c.aim.vx, vy: c.aim.vy },
    accept: () => phase === "open",
    // Into the middle and down into the shell; hidden while it is shut; up to the lip to go.
    place(_k, t, from) {
      const spitFrom = CLAM_S.hold - CLAM_S.spit;
      if (t < spitFrom) {
        const s = ease(t / CLAM_S.snap);
        return {
          x: from.x + (c.x - from.x) * s,
          y: from.y + (c.y - from.y) * s,
          z: BALL_R - 12 * s,
          scale: t < CLAM_S.snap ? 1 - 0.2 * s : 0,
        };
      }
      const s = ease((t - spitFrom) / CLAM_S.spit);
      return {
        x: c.x + (c.lip.x - c.x) * s,
        y: c.y + (c.lip.y - c.y) * s,
        z: BALL_R - 12 + 12 * s,
        scale: s < 0.15 ? 0 : 0.8 + 0.2 * s,
      };
    },
  });
  const ride = createRide({
    name: "turtle",
    path: m.ramp.path,
    speed: 480,
    exit: { vx: 0, vy: 420 },
    max: 3,
  });
  let pearls = 0;
  let jackpotDue = false;
  let jackpotAt = -Infinity;
  let rides = 0;
  let turnAt = 0;
  let nextTurn = 9;
  let heading = Math.atan2(m.current.dir.y, m.current.dir.x);
  /** Pearl balls waiting to come out after a jackpot's ball: when, and which aim. */
  const spits: { at: number; i: number }[] = [];

  /** Make the shell solid when the lid is down and no ball is where it would be. */
  const solid = (now: number) => {
    const want = lidAt(now) < 0.25;
    if (!want) {
      c.shell.on = false;
      return;
    }
    if (c.shell.on) return;
    const reach = c.shell.r + BALL_R + 2;
    c.shell.on = host.world.balls.every((b) => Math.hypot(b.x - c.x, b.y - c.y) > reach);
  };

  const box = createToyBox(host, {
    devices: [clam, ride],
    movers: puffers,
    forces: [flow],
    event(e) {
      if (e.type === "hit") {
        if (e.tag === "puffer") {
          puffers[e.index]?.puff();
          host.add(REEF_POINTS.puffer);
          host.flash("puffer", e.index);
        } else if (e.tag === "clam") {
          host.add(REEF_POINTS.shell);
          host.flash("clam", 0);
        }
      } else if (e.type === "cross" && e.tag === "ramp" && e.dir > 0 && e.speed >= RIDE_MIN) {
        if (box.put(ride, e.ball)) host.flash("ramp", 0);
      }
    },
    taken(d, _b, now) {
      if (d !== clam) return;
      to("holding", now);
      pearls = Math.min(3, pearls + 1);
      if (pearls >= 3) jackpotDue = true;
      host.add(REEF_POINTS.clam);
      host.flash("pearl", pearls - 1);
      host.flash("snap", 0);
    },
    let(_l, d, now) {
      if (d === ride) {
        rides++;
        host.add(REEF_POINTS.turtle);
        host.flash("turtle", (rides - 1) % 3);
        if (rides % 3 === 0) {
          host.add(REEF_POINTS.turtles);
          host.raiseMultiplier();
          host.flash("turtles", 0);
        }
        return;
      }
      if (d !== clam) return;
      if (jackpotDue) {
        jackpotDue = false;
        pearls = 0;
        jackpotAt = now;
        host.add(REEF_POINTS.pearls);
        host.flash("jackpot", 0);
        host.shake(0.35);
        spits.length = 0;
        c.pearls.forEach((_, i) => spits.push({ at: now + CLAM_S.pearl * (i + 1), i }));
      }
    },
    update(_dt, now) {
      // The clam's own rhythm, when it isn't holding a ball.
      const t = now - phaseAt;
      if (phase === "holding" && !clam.ball) to("open", now - CLAM_S.open * 0.4);
      else if (phase === "open" && t >= CLAM_S.open) to("closing", now);
      else if (phase === "closing" && t >= CLAM_S.closing) to("shut", now);
      else if (phase === "shut" && t >= CLAM_S.shut) to("opening", now);
      else if (phase === "opening" && t >= CLAM_S.opening) to("open", now);
      solid(now);
      for (let i = spits.length - 1; i >= 0; i--) {
        const s = spits[i]!;
        if (now < s.at) continue;
        spits.splice(i, 1);
        const v = c.pearls[s.i];
        if (v && host.playing()) host.addBall(c.lip.x, c.lip.y, v.vx, v.vy);
      }
      // The current turns round now and then, never quite straight across.
      if (now >= nextTurn) {
        const back = Math.cos(heading) >= 0 ? Math.PI : 0;
        heading = back + (host.random() - 0.5) * 0.6;
        flow.aim(Math.cos(heading), Math.sin(heading));
        turnAt = now;
        nextTurn = now + 8 + host.random() * 6;
      }
    },
    reset() {
      phase = "shut";
      phaseAt = host.now();
      lid0 = 0;
      c.shell.on = true;
      pearls = 0;
      jackpotDue = false;
      jackpotAt = -Infinity;
      rides = 0;
      spits.length = 0;
      heading = Math.atan2(m.current.dir.y, m.current.dir.x);
      turnAt = host.now();
      nextTurn = host.now() + 9;
    },
  });
  return {
    ...box,
    middle: m,
    puffers,
    clam,
    ride,
    flow,
    get clamPhase() {
      return phase;
    },
    lid: lidAt,
    get pearls() {
      return pearls;
    },
    get rides() {
      return rides;
    },
    get jackpotAt() {
      return jackpotAt;
    },
    get turnAt() {
      return turnAt;
    },
  };
};

const rules: ThemeRules<ReefMiddle> = { id: "reef", middle, toys };

export default rules;
