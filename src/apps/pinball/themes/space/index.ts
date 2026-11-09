/**
 * Space: the middle of the playfield and its rules.
 *
 * - Rocket lock: a launch pad scoop in the upper right with a rocket standing on its gantry above
 *   it, pointing up the table. A ball caught in the pad climbs into the rocket's portholes (a new
 *   one is served meanwhile); the third starts a countdown, the rocket lifts off, and the three
 *   balls kick out of the pad as a multiball. A new rocket rises onto the pad.
 * - Planet and moons: a planet bumper with two moons going round it, bumpers too.
 * - Black hole: a sink low on the right that catches a passing ball, spirals it in, holds it and
 *   spits it out towards the left flipper.
 * - Asteroids: three drop targets on the left facing the right flipper; all down pays a bonus and
 *   raises the multiplier, then they rise again.
 * - Star lanes: the classic top lanes, scored by the table's own lane rules.
 *
 * Coordinates are as built (unmirrored); the builder mirrors shapes, and `b.P`/`b.X` mirror the
 * points kept for the toys and the look.
 */
import { BALL_R } from "../../config";
import {
  type Aim,
  createDropBank,
  createKickout,
  createLock,
  createOrbiter,
  createToyBox,
  type DropBank,
  type Kickout,
  type Lock,
  type P3,
  type ToyBox,
} from "../../devices";
import type { Point, TableBuilder } from "../../layout";
import type { Arc, Circle, Seg } from "../../physics";
import type { ToyHost } from "../../toys";
import type { ThemeRules } from "../types";

export const SPACE_POINTS = {
  planet: 150,
  moon: 250,
  lock: 1000,
  liftoff: 5000,
  hole: 750,
  asteroid: 500,
  asteroids: 5000,
} as const;

/** The pad, its pocket and the rocket above it, in built coordinates. */
const PAD = { x: 790, y: 480, r: 62 };
const ROCKET = { base: 410, nose: 272, body: 36 };
/** Where the pocket's mouth opens, degrees (y down): from down-right round to the left. */
const MOUTH = { from: 48, to: 168 };
const PLANET = { x: 520, y: 620, r: 52 };
const MOON = { r: 22, orbit: 140, omega: 1.1 };
const HOLE = { x: 770, y: 1000, r: 46, disc: 96 };
const BANK = { x: 190, y: 1080, len: 56, gap: 12, r: 14 };

export interface SpaceMiddle {
  mirror: boolean;
  pad: { x: number; y: number; r: number; wall: Arc };
  /** The rocket, along the table from its base to its nose, and its body's radius. */
  rocket: { x: number; base: number; nose: number; body: number };
  /** Where locked balls sit: in the rocket's portholes, first to last; and in the pad to launch. */
  slots: P3[];
  drop: P3[];
  outs: { x: number; y: number; vx: number; vy: number }[];
  planet: Circle;
  moons: Circle[];
  orbit: { x: number; y: number; radius: number; omega: number };
  hole: { x: number; y: number; r: number; disc: number; spin: number; aim: Aim };
  asteroids: Seg[];
  lanes: Point[];
}

const DEG = Math.PI / 180;

const middle = (b: TableBuilder): SpaceMiddle => {
  // Star lanes under the arch, as on the classic table.
  for (const gx of [420, 510, 600, 690]) b.wall(gx, 235, gx, 305);
  const lanes = [465, 555, 645].map((x, i) => {
    b.roll("lane", i, x, 275);
    b.lamp("lane", i, x, 275, 24);
    return b.P(x, 275);
  });

  // The launch pad's pocket, open towards the flippers, and the rocket's gantry behind it.
  const wall = b.arc(PAD.x, PAD.y, PAD.r, MOUTH.to * DEG, (MOUTH.from + 360) * DEG, {
    r: 7,
    e: 0.3,
    tag: "pad",
  });
  // The rocket's body is solid, so balls bounce off it rather than pass under it.
  b.seg(PAD.x, ROCKET.base - 21, PAD.x, ROCKET.nose + 40, {
    r: ROCKET.body,
    tag: "rocket",
    e: 0.35,
  });
  const slots: P3[] = [0, 1, 2].map((i) => ({ ...b.P(PAD.x, ROCKET.base - 32 - i * 30), z: 70 }));
  // For the countdown the balls drop out of the rocket into the pad, ready to be fired out.
  const drop: P3[] = [-34, 0, 34].map((dx) => ({ ...b.P(PAD.x + dx, PAD.y + 8), z: BALL_R }));
  const outs = [100, 122, 144].map((deg) => {
    const p = b.P(PAD.x - 18, PAD.y + 34);
    const v = 1250;
    const side = b.mirror ? -1 : 1;
    return { x: p.x, y: p.y, vx: side * Math.cos(deg * DEG) * v, vy: Math.sin(deg * DEG) * v };
  });
  [0, 1, 2].forEach((i) => b.lamp("rocket", i, PAD.x - 66 + i * 66, PAD.y + 92, 18));

  // The planet and its moons. The moons start opposite each other; the toys move them.
  const planet = b.circle(PLANET.x, PLANET.y, PLANET.r, {
    tag: "planet",
    kick: 1150,
    hitMin: 25,
    e: 0.5,
    scores: true,
  });
  const moons = [0, 1].map((i) =>
    b.circle(PLANET.x + (i === 0 ? MOON.orbit : -MOON.orbit), PLANET.y, MOON.r, {
      tag: "moon",
      index: i,
      kick: 900,
      hitMin: 25,
      e: 0.5,
      scores: true,
    }),
  );

  // Asteroid drop targets in a row facing the right flipper.
  const toFlipper = { x: 600 - BANK.x, y: 1715 - BANK.y };
  const l = Math.hypot(toFlipper.x, toFlipper.y);
  const along = { x: toFlipper.y / l, y: -toFlipper.x / l };
  const asteroids = [-1, 0, 1].map((k, i) => {
    const cx = BANK.x + along.x * k * (BANK.len + BANK.gap);
    const cy = BANK.y + along.y * k * (BANK.len + BANK.gap);
    const h = BANK.len / 2;
    return b.seg(cx - along.x * h, cy - along.y * h, cx + along.x * h, cy + along.y * h, {
      r: BANK.r,
      tag: "asteroid",
      index: i,
      e: 0.3,
      hitMin: 150,
      scores: true,
    });
  });

  // The black hole spits towards the left flipper.
  const hole = b.P(HOLE.x, HOLE.y);
  const flip = b.P(400, 1640);
  const d = Math.hypot(flip.x - hole.x, flip.y - hole.y);
  const aim = { vx: ((flip.x - hole.x) / d) * 1150, vy: ((flip.y - hole.y) / d) * 1150 };

  const pad = b.P(PAD.x, PAD.y);
  const centre = b.P(PLANET.x, PLANET.y);
  return {
    mirror: b.mirror,
    pad: { ...pad, r: PAD.r, wall },
    rocket: { x: pad.x, base: ROCKET.base, nose: ROCKET.nose, body: ROCKET.body },
    slots,
    drop,
    outs,
    planet,
    moons,
    orbit: { ...centre, radius: MOON.orbit, omega: MOON.omega },
    hole: { ...hole, r: HOLE.r, disc: HOLE.disc, spin: b.mirror ? -1 : 1, aim },
    asteroids,
    lanes,
  };
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export interface SpaceToys extends ToyBox {
  readonly middle: SpaceMiddle;
  readonly lock: Lock;
  readonly hole: Kickout;
  readonly bank: DropBank;
  /** The moons' angle round the planet, radians. */
  moonAngle(): number;
  /** World seconds of the last lift-off. */
  readonly liftoffAt: number;
}

const toys = (host: ToyHost, m: SpaceMiddle): SpaceToys => {
  const lock = createLock({
    name: "rocket",
    mouth: { x: m.pad.x, y: m.pad.y, r: 40 },
    maxSpeed: 3000,
    slots: m.slots,
    drop: m.drop,
    slotScale: 0.45,
    countdown: 2,
    gap: 0.35,
    timeout: 12,
    cool: 2.5,
    out: m.outs,
  });
  const h = m.hole;
  const hole = createKickout({
    name: "hole",
    x: h.x,
    y: h.y,
    r: h.r,
    maxSpeed: 2600,
    hold: 1.5,
    cool: 1.2,
    out: { vx: h.aim.vx, vy: h.aim.vy },
    // Spirals in over the disc, sinks out of sight, and comes back up just before it is spat out.
    place(k, _t, from) {
      const d0 = Math.hypot(from.x - h.x, from.y - h.y);
      const a0 = Math.atan2(from.y - h.y, from.x - h.x);
      const s = ease(Math.min(1, k / 0.6));
      const back = ease(Math.max(0, (k - 0.85) / 0.15));
      const r = d0 * (1 - s);
      const a = a0 + h.spin * s * Math.PI * 3;
      return {
        x: h.x + Math.cos(a) * r,
        y: h.y + Math.sin(a) * r,
        z: BALL_R * (1 - 1.4 * s + 1.4 * back),
        scale: 1 - 0.7 * s + 0.7 * back,
      };
    },
  });
  const moons = m.moons.map((c, i) =>
    createOrbiter(c, {
      cx: m.orbit.x,
      cy: m.orbit.y,
      radius: m.orbit.radius,
      omega: m.orbit.omega * (m.mirror ? -1 : 1),
      phase: i * Math.PI,
    }),
  );
  const bank = createDropBank({ targets: m.asteroids, rise: 2, idle: 25 });
  let phase = lock.phase;
  let liftoffAt = -Infinity;

  const box = createToyBox(host, {
    devices: [lock, hole],
    movers: moons,
    event(e, now) {
      if (e.type !== "hit") return;
      if (e.tag === "planet") {
        host.add(SPACE_POINTS.planet);
        host.flash("planet", 0);
      } else if (e.tag === "moon") {
        host.add(SPACE_POINTS.moon);
        host.flash("moon", e.index);
      } else if (e.tag === "asteroid") {
        const r = bank.hit(e.index, now);
        if (!r) return;
        host.add(SPACE_POINTS.asteroid);
        host.flash("asteroid", e.index);
        if (r === "done") {
          host.add(SPACE_POINTS.asteroids);
          host.raiseMultiplier();
          host.flash("asteroids", 0);
        }
      }
    },
    taken(d) {
      if (d === lock) {
        host.add(SPACE_POINTS.lock);
        host.flash("rocket", lock.count - 1);
      } else if (d === hole) {
        host.add(SPACE_POINTS.hole);
        host.flash("hole", 0);
      }
    },
    update(_dt, now) {
      bank.update(now, host.world.balls);
      if (lock.phase !== phase) {
        if (lock.phase === "release" && lock.full) {
          liftoffAt = now;
          host.add(SPACE_POINTS.liftoff);
          host.flash("liftoff", 0);
          host.shake(0.6);
        }
        phase = lock.phase;
      }
    },
    reset() {
      bank.reset();
      phase = lock.phase;
      liftoffAt = -Infinity;
    },
  });
  return {
    ...box,
    middle: m,
    lock,
    hole,
    bank,
    moonAngle: () => moons[0]?.angle ?? 0,
    get liftoffAt() {
      return liftoffAt;
    },
  };
};

const rules: ThemeRules<SpaceMiddle> = { id: "space", middle, toys };

export default rules;
