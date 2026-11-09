/**
 * Fun fair: the middle of the playfield and its rules.
 *
 * - Ferris wheel: a station at the wheel's foot in the upper right. A ball that rolls in rises to
 *   the platform, rides a gondola up and over the top, and is thrown off into a top lane. Three
 *   rides light the big wheel: the next rider brings two guests, who land as a multiball.
 * - Carousel: a turning disc in the middle that swings balls rolling over it round, with a centre
 *   column and four horses on poles going round with it (moving posts that score). Each horse hit
 *   lights up; all four make a round, which raises the multiplier.
 * - Bells: three bell bumpers under the top lanes. Ringing each lights a lamp of the cannon's
 *   fuse; all three relight the cannon.
 * - Cannon: a kickback at the foot of the left outlane, lit at the start of a game. It catches a
 *   draining ball, rolls it into the barrel below the inlane guide and fires it in an arc over the
 *   guide back up the table, then waits to be lit.
 * - High striker: a pad on the right with a tower above it. A hit from below sends the puck up
 *   the tower as far as the hit was hard; at the top it rings the bell for a bonus and raises
 *   the multiplier.
 * - The classic top lanes, scored by the table's own lane rules.
 *
 * Coordinates are as built (unmirrored); the builder mirrors shapes, and `b.P`/`b.X` mirror the
 * points kept for the toys and the look.
 */
import { BALL_R } from "../../config";
import {
  createKickout,
  createOrbiter,
  createSpinDisc,
  createToyBox,
  type Kickout,
  strikeLevel,
  type ToyBox,
} from "../../devices";
import type { Point, TableBuilder } from "../../layout";
import type { Arc, Circle, Seg } from "../../physics";
import type { ToyHost } from "../../toys";
import type { ThemeRules } from "../types";
import { createWheel, GUEST, type Wheel } from "./wheel";

export const FAIR_POINTS = {
  bell: 150,
  /** All three bells rung. */
  bells: 1000,
  horse: 250,
  /** Every horse hit once: a round on the carousel, which also raises the multiplier. */
  round: 2000,
  column: 100,
  ride: 1000,
  /** The big wheel's multiball. */
  bigWheel: 5000,
  /** Per mark the puck climbs, of ten. */
  striker: 100,
  /** The puck rings the bell at the top. */
  ring: 5000,
  topBell: 250,
  cannon: 750,
} as const;

/** Rides that light the big wheel. */
export const RIDES = 3;
/** Marks up the high striker's tower; the top one rings its bell. */
export const MARKS = 10;
/** Impact speeds (px/s, into the pad) for the puck's lowest mark and for the bell. */
export const STRIKE = { lo: 350, hi: 3600 };

const DEG = Math.PI / 180;

const LANES = [465, 555, 645];
const BELLS = [
  { x: 470, y: 430 },
  { x: 610, y: 435 },
  { x: 545, y: 560 },
];
const BELL_R = 42;
const WHEEL = { x: 785, y: 420, R: 104, tilt: 32 * DEG, hang: 24, low: 80, gondolas: 6 };
const STATION = { x: 785, y: 540, r: 52, catch: 40 };
/** The station's mouth, degrees (y down): open towards the flippers. */
const MOUTH = { from: 35, to: 145 };
const CAROUSEL = { x: 500, y: 755, r: 112, column: 26, ring: 76, pole: 12, omega: -1.4, grip: 6 };
const STRIKER = { x: 820, pad: 1190, half: 50, column: 12, top: 1003, bell: 985, bellR: 18 };
/** The cannon catches in the outlane and fires from below the inlane guide, out of the way. */
const CANNON = { x: 60, y: 1590, r: 36, mouth: { x: 130, y: 1715 }, land: { x: 215, y: 1150 } };

export interface FairMiddle {
  mirror: boolean;
  /** 1 as built, -1 mirrored. */
  side: 1 | -1;
  lanes: Point[];
  bells: Circle[];
  wheel: {
    hub: Point;
    R: number;
    tilt: number;
    hang: number;
    low: number;
    gondolas: number;
    station: { x: number; y: number; r: number; wall: Arc };
    /** Where a ball thrown off the top lands: in the right-hand top lane. */
    landing: { x: number; y: number; vx: number; vy: number };
  };
  carousel: {
    x: number;
    y: number;
    r: number;
    /** Radians a second in table coordinates (mirrored). */
    omega: number;
    column: Circle;
    horses: Circle[];
    ring: number;
    phases: number[];
  };
  striker: {
    x: number;
    pad: Seg;
    tower: Seg;
    bell: Circle;
    /** The tower's foot and top, where the puck climbs between. */
    base: number;
    top: number;
  };
  cannon: {
    x: number;
    y: number;
    r: number;
    /** The muzzle, where a caught ball settles before it is fired. */
    mouth: Point;
    /** Where the fired ball lands and how it moves on. */
    landing: { x: number; y: number; vx: number; vy: number };
  };
}

const middle = (b: TableBuilder): FairMiddle => {
  const side: 1 | -1 = b.mirror ? -1 : 1;
  // The top lanes, as on the classic table.
  for (const gx of [420, 510, 600, 690]) b.wall(gx, 235, gx, 305);
  const lanes = LANES.map((x, i) => {
    b.roll("lane", i, x, 275);
    b.lamp("lane", i, x, 275, 24);
    return b.P(x, 275);
  });

  // Bell bumpers under the lanes.
  const bells = BELLS.map((p, i) =>
    b.circle(p.x, p.y, BELL_R, {
      tag: "bell",
      index: i,
      kick: 1100,
      hitMin: 25,
      e: 0.5,
      scores: true,
    }),
  );

  // The Ferris wheel's station: a pocket open towards the flippers. The wheel itself stands
  // above the playfield, out of the balls' way.
  const wall = b.arc(STATION.x, STATION.y, STATION.r, MOUTH.to * DEG, (MOUTH.from + 360) * DEG, {
    r: 7,
    e: 0.3,
    tag: "station",
  });
  [0, 1, 2].forEach((i) => b.lamp("wheel", i, 700 + i * 25, 760 - i * 60, 18));

  // The carousel: a column in the middle and four horses' poles going round it.
  const column = b.circle(CAROUSEL.x, CAROUSEL.y, CAROUSEL.column, {
    tag: "column",
    kick: 700,
    hitMin: 40,
    e: 0.5,
    scores: true,
  });
  const built = [0, 1, 2, 3].map((i) => i * (Math.PI / 2) + Math.PI / 4);
  const horses = built.map((a, i) =>
    b.circle(
      CAROUSEL.x + Math.cos(a) * CAROUSEL.ring,
      CAROUSEL.y + Math.sin(a) * CAROUSEL.ring,
      CAROUSEL.pole,
      { tag: "horse", index: i, kick: 500, hitMin: 60, e: 0.5, scores: true },
    ),
  );
  const phases = built.map((a) => b.A(a));

  // The high striker: a pad facing down the table, the tower above it and the bell on top.
  const tower = b.seg(STRIKER.x, STRIKER.pad - 14, STRIKER.x, STRIKER.top, {
    r: STRIKER.column,
    tag: "tower",
    e: 0.35,
  });
  const pad = b.seg(STRIKER.x - STRIKER.half, STRIKER.pad, STRIKER.x + STRIKER.half, STRIKER.pad, {
    r: 10,
    tag: "striker",
    e: 0.3,
    hitMin: 120,
    scores: true,
  });
  const bell = b.circle(STRIKER.x, STRIKER.bell, STRIKER.bellR, {
    tag: "topbell",
    e: 0.45,
    hitMin: 80,
    scores: true,
  });

  // The cannon's fuse: a lamp for each bell rung, and the cannon's own lamp in the outlane.
  [0, 1, 2].forEach((i) => b.lamp("bell", i, 175 - i * 25, 1110 + i * 60, 18));
  b.lamp("cannon", 0, 60, 1390, 18);

  const hub = b.P(WHEEL.x, WHEEL.y);
  const st = b.P(STATION.x, STATION.y);
  const landing = b.P(LANES[2]!, 252);
  const fired = b.P(CANNON.land.x, CANNON.land.y);
  return {
    mirror: b.mirror,
    side,
    lanes,
    bells,
    wheel: {
      hub,
      R: WHEEL.R,
      tilt: WHEEL.tilt,
      hang: WHEEL.hang,
      low: WHEEL.low,
      gondolas: WHEEL.gondolas,
      station: { ...st, r: STATION.r, wall },
      landing: { ...landing, vx: 0, vy: 150 },
    },
    carousel: {
      ...b.P(CAROUSEL.x, CAROUSEL.y),
      r: CAROUSEL.r,
      omega: CAROUSEL.omega * side,
      column,
      horses,
      ring: CAROUSEL.ring,
      phases,
    },
    striker: { x: b.X(STRIKER.x), pad, tower, bell, base: STRIKER.pad - 14, top: STRIKER.bell },
    cannon: {
      ...b.P(CANNON.x, CANNON.y),
      r: CANNON.r,
      mouth: b.P(CANNON.mouth.x, CANNON.mouth.y),
      landing: { ...fired, vx: 300 * side, vy: -1550 },
    },
  };
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export interface Striker {
  /** World seconds of the last strike, and how hard it was (0 to 1). */
  readonly at: number;
  readonly level: number;
  /** Seconds the puck takes to reach its height. */
  readonly rise: number;
  /** World seconds the bell last rang. */
  readonly rangAt: number;
}

export interface FairToys extends ToyBox {
  readonly middle: FairMiddle;
  readonly wheel: Wheel;
  readonly cannon: Kickout;
  /** The carousel's turn, radians. */
  carouselAngle(): number;
  /** Bells rung towards relighting the cannon. */
  readonly bells: readonly boolean[];
  /** Horses hit towards the next round. */
  readonly horses: readonly boolean[];
  /** Rides towards the big wheel, and whether it is lit. */
  readonly rides: number;
  readonly lit: boolean;
  /** World seconds the big wheel last started. */
  readonly bigAt: number;
  readonly striker: Striker;
  /** World seconds the cannon last fired (its ball left the muzzle). */
  readonly firedAt: number;
}

/** Seconds the cannon holds a ball, and the share of it spent settling before it fires. */
export const CANNON_HOLD = 1.3;
export const CANNON_AIM = 0.42;
/** Height of the cannon's muzzle, where a caught ball waits to be fired. */
export const MUZZLE_Z = 40;

/** How long the puck takes to climb to `level` of the tower. */
export const riseTime = (level: number) => 0.18 + 0.4 * level;

const toys = (host: ToyHost, m: FairMiddle): FairToys => {
  const w = m.wheel;
  const wheel = createWheel({
    name: "wheel",
    hub: w.hub,
    side: m.side,
    R: w.R,
    tilt: w.tilt,
    hang: w.hang,
    low: w.low,
    gondolas: w.gondolas,
    station: { x: w.station.x, y: w.station.y, r: STATION.catch },
    maxSpeed: 2600,
    lift: 0.4,
    hop: 0.5,
    landing: w.landing,
    idle: 0.45,
    run: 1.25,
    accel: 2.5,
  });
  const c = m.cannon;
  const cannon = createKickout({
    name: "cannon",
    x: c.x,
    y: c.y,
    r: c.r,
    maxSpeed: 6000,
    hold: CANNON_HOLD,
    cool: 0.6,
    armed: false,
    accept: (b) => b.vy > 0,
    out: { x: c.landing.x, y: c.landing.y, vx: c.landing.vx, vy: c.landing.vy },
    // Drops into the barrel, then flies out in an arc over the outlane to land up the table.
    place(_k, t, from) {
      const aim = CANNON_HOLD * CANNON_AIM;
      if (t < aim) {
        const a = ease(t / (aim * 0.5));
        return {
          x: from.x + (c.mouth.x - from.x) * a,
          y: from.y + (c.mouth.y - from.y) * a,
          z: BALL_R + (MUZZLE_Z - BALL_R) * a,
          scale: 1 - 0.2 * a,
        };
      }
      const k = Math.min(1, (t - aim) / (CANNON_HOLD - aim));
      const L = c.landing;
      return {
        x: c.mouth.x + (L.x - c.mouth.x) * k,
        y: c.mouth.y + (L.y - c.mouth.y) * k,
        z: MUZZLE_Z + (BALL_R - MUZZLE_Z) * k + 260 * Math.sin(Math.PI * k),
        scale: 0.8 + 0.2 * Math.min(1, k * 4),
      };
    },
  });
  const cm = m.carousel;
  const horses = cm.horses.map((h, i) =>
    createOrbiter(h, {
      cx: cm.x,
      cy: cm.y,
      radius: cm.ring,
      omega: cm.omega,
      phase: cm.phases[i] ?? 0,
    }),
  );
  const disc = createSpinDisc({ x: cm.x, y: cm.y, r: cm.r, omega: cm.omega, grip: CAROUSEL.grip });
  const bells = [false, false, false];
  const riders = [false, false, false, false];
  let rides = 0;
  let lit = false;
  let bigAt = -Infinity;
  let firedAt = -Infinity;
  const striker = { at: -Infinity, level: 0, rise: 0, rangAt: -Infinity };
  let ringAt = Infinity;

  const box = createToyBox(host, {
    devices: [wheel, cannon],
    movers: horses,
    forces: [disc],
    event(e, now) {
      if (e.type !== "hit") return;
      if (e.tag === "bell") {
        host.add(FAIR_POINTS.bell);
        host.flash("bell", e.index);
        if (!bells[e.index]) {
          bells[e.index] = true;
          host.flash("fuse", e.index);
          if (bells.every(Boolean)) {
            bells.fill(false);
            host.add(FAIR_POINTS.bells);
            host.flash("bells", 0);
            cannon.arm();
          }
        }
      } else if (e.tag === "horse") {
        host.add(FAIR_POINTS.horse);
        host.flash("horse", e.index);
        if (!riders[e.index]) {
          riders[e.index] = true;
          if (riders.every(Boolean)) {
            riders.fill(false);
            host.add(FAIR_POINTS.round);
            host.raiseMultiplier();
            host.flash("round", 0);
          }
        }
      } else if (e.tag === "column") {
        host.add(FAIR_POINTS.column);
        host.flash("column", 0);
      } else if (e.tag === "topbell") {
        host.add(FAIR_POINTS.topBell);
        host.flash("topbell", 0);
      } else if (e.tag === "striker") {
        // Only a hit from below drives the puck up.
        if (e.ball.y < m.striker.pad.ay) return;
        // A puck still on its way up keeps going unless this hit is harder.
        const level = strikeLevel(e.speed, STRIKE.lo, STRIKE.hi);
        if (now < striker.at + striker.rise && level <= striker.level) return;
        striker.at = now;
        striker.level = level;
        striker.rise = riseTime(level);
        const marks = Math.max(1, Math.round(level * MARKS));
        host.add(FAIR_POINTS.striker * marks);
        host.flash("striker", 0);
        ringAt = marks >= MARKS ? now + striker.rise : Infinity;
      }
    },
    taken(d, _b, now) {
      if (d === wheel) {
        host.flash("wheel", 0);
        if (lit) {
          // The big wheel: this rider brings two guests, who land as a multiball.
          lit = false;
          rides = 0;
          bigAt = now;
          wheel.invite(2);
          host.add(FAIR_POINTS.bigWheel);
          host.flash("bigwheel", 0);
        } else {
          rides = Math.min(RIDES, rides + 1);
          lit = rides >= RIDES;
        }
      } else if (d === cannon) {
        host.flash("cannon", 0);
      }
    },
    let(l, d) {
      if (d === wheel && l.why !== GUEST) {
        host.add(FAIR_POINTS.ride);
        host.flash("ride", 0);
      } else if (d === cannon) {
        host.add(FAIR_POINTS.cannon);
      }
    },
    update(_dt, now) {
      if (cannon.ball && firedAt < cannon.since) {
        if (now - cannon.since >= CANNON_HOLD * CANNON_AIM) {
          firedAt = cannon.since + CANNON_HOLD * CANNON_AIM;
          host.shake(0.25);
        }
      }
      if (now >= ringAt) {
        ringAt = Infinity;
        striker.rangAt = now;
        host.add(FAIR_POINTS.ring);
        host.raiseMultiplier();
        host.flash("ring", 0);
      }
    },
    reset() {
      bells.fill(false);
      riders.fill(false);
      rides = 0;
      lit = false;
      bigAt = -Infinity;
      firedAt = -Infinity;
      striker.at = -Infinity;
      striker.level = 0;
      striker.rangAt = -Infinity;
      ringAt = Infinity;
      // A new game starts with the cannon lit.
      cannon.arm();
    },
  });
  return {
    ...box,
    middle: m,
    wheel,
    cannon,
    carouselAngle: () => (horses[0]?.angle ?? 0) - (cm.phases[0] ?? 0),
    bells,
    horses: riders,
    get rides() {
      return rides;
    },
    get lit() {
      return lit;
    },
    get bigAt() {
      return bigAt;
    },
    striker,
    get firedAt() {
      return firedAt;
    },
  };
};

const rules: ThemeRules<FairMiddle> = { id: "fair", middle, toys };

export default rules;
