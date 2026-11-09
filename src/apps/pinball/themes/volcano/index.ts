/**
 * Volcano: the middle of the playfield and its rules.
 *
 * - Volcano and lava ramp: a volcano in the upper right with a lava river running down from its
 *   crater as a ramp. A ball shot up the ramp's mouth rides the lava up into the crater, where it
 *   sits in the lava (a new one is served meanwhile); the volcano rumbles and glows brighter with
 *   each. The third starts a rumbling countdown, then the volcano erupts and throws the balls out
 *   over the playfield as a multiball. While the crater is closed, a ball up the ramp tumbles over
 *   the far rim and down a lava fall onto the upper right flipper.
 * - Friendly dinosaur: a long-necked dinosaur in the middle. Its tail tip is a bumper; a hit on it
 *   makes the dinosaur stomp, which hops the balls near it up the table and shakes the view. It
 *   also stomps now and then by itself.
 * - Dinosaur eggs: three drop targets in a nest on the left facing the right flipper. A hit cracks
 *   an egg and a second (or one hard hit) hatches it: the egg drops and a baby climbs onto the big
 *   dinosaur's back. All three hatched pays a bonus, raises the multiplier and makes the parent
 *   stomp for joy; then new eggs appear.
 * - Steam vents: the classic top lanes, scored by the table's own lane rules.
 *
 * Coordinates are as built (unmirrored); the builder mirrors shapes, and `b.P`/`b.X` mirror the
 * points kept for the toys and the look.
 */
import { BALL_R } from "../../config";
import {
  type Carrier,
  createCarrier,
  createDropBank,
  createLock,
  createRide,
  createToyBox,
  type DropBank,
  type Lock,
  type P3,
  type Ride,
  stomp,
  strikeLevel,
  type ToyBox,
} from "../../devices";
import type { Point, TableBuilder } from "../../layout";
import type { Circle, Gate, Seg } from "../../physics";
import type { ToyHost } from "../../toys";
import type { ThemeRules } from "../types";

export const VOLCANO_POINTS = {
  ramp: 500,
  lock: 1000,
  eruption: 5000,
  spill: 250,
  rumble: 25,
  crack: 250,
  hatch: 500,
  clutch: 5000,
  tail: 150,
  stomp: 250,
  dino: 50,
} as const;

/** The volcano: its solid foot, the cone's base, the crater's rim and the lava's height. */
const VOLCANO = { x: 800, y: 430, r: 85, base: 124, rim: 50, top: 118, lava: 92 };
/** The ramp's mouth: a pocket open towards the flippers, and the line a ball crosses into it. */
const MOUTH = { x0: 616, x1: 736, y: 860, back: 780 };
/** The lava ramp from its mouth up into the crater, as built (z is the ball's centre). */
const RAMP: P3[] = [
  { x: 676, y: 820, z: 34 },
  { x: 684, y: 740, z: 58 },
  { x: 700, y: 660, z: 82 },
  { x: 724, y: 592, z: 104 },
  { x: 754, y: 532, z: 124 },
  { x: 780, y: 488, z: 136 },
  { x: 796, y: 455, z: 122 },
  { x: 800, y: 432, z: 100 },
];
/** Over the far rim and down a lava fall onto the upper right flipper. */
const SPILL: P3[] = [
  { x: 818, y: 398, z: 134 },
  { x: 852, y: 382, z: 126 },
  { x: 890, y: 420, z: 96 },
  { x: 918, y: 486, z: 60 },
  { x: 930, y: 556, z: BALL_R },
];
const DINO = { x: 400, y: 640, r: 56 };
const TAIL = { x: 500, y: 770, r: 26 };
const NEST = { x: 190, y: 1080, len: 56, gap: 12, r: 14 };
/** Where an eruption's balls come down, and how they roll on. */
const LANDINGS = [
  { x: 600, y: 470, vx: -150, vy: 250 },
  { x: 320, y: 830, vx: 80, vy: 350 },
  { x: 560, y: 960, vx: -60, vy: 380 },
];
/** Where the crater lets a ball go when it can't fly it out (beside the volcano's foot). */
const OUTS = [
  { x: 676, y: 548 },
  { x: 650, y: 590 },
  { x: 700, y: 600 },
];

export const STOMP = {
  /** Seconds from the start of a stomp to the feet coming down. */
  slam: 0.32,
  /** Seconds the whole stomp takes, for the look. */
  length: 0.8,
  /** Least time between two stomps. */
  cool: 6,
  /** Balls this close to the dinosaur hop, as fast as `up` at its feet. */
  radius: 300,
  up: 900,
  /** It stomps by itself every `every` to `every + spread` seconds. */
  every: 18,
  spread: 14,
};

export const ERUPT = {
  /** Flight time and height of a ball thrown out by an eruption, and by a crater letting go early. */
  t: 1,
  high: 360,
  burpT: 0.7,
  burp: 140,
};

export interface VolcanoMiddle {
  mirror: boolean;
  /** The volcano: its solid foot, cone and crater (the crater's centre at the lava's surface). */
  volcano: {
    x: number;
    y: number;
    r: number;
    base: number;
    rim: number;
    top: number;
    lava: number;
    body: Circle;
  };
  /** Where balls sit in the crater, and where they rise to in the countdown. */
  slots: P3[];
  drop: P3[];
  outs: { x: number; y: number; vx: number; vy: number }[];
  landings: { x: number; y: number; vx: number; vy: number }[];
  ramp: { gate: Gate; path: P3[]; walls: Seg[]; mouth: Point; back: number; half: number };
  spill: { path: P3[]; out: { x: number; y: number; vx: number; vy: number } };
  dino: {
    body: Circle;
    tail: Circle;
    tailBody: Seg;
    /** Where the head is (raised), and the three seats on its back. */
    head: P3;
    seats: P3[];
    /** +1 as built, -1 mirrored: which way its tail points across the table. */
    side: number;
  };
  eggs: Seg[];
  /** The nest's middle and the direction along its row of eggs. */
  nest: { x: number; y: number; along: Point; len: number };
  lanes: Point[];
  vents: Seg[];
}

const DEG = Math.PI / 180;

const middle = (b: TableBuilder): VolcanoMiddle => {
  const side = b.mirror ? -1 : 1;
  // Steam vents: basalt posts between the top lanes, as on the classic table.
  const vents = [420, 510, 600, 690].map((gx) => b.wall(gx, 235, gx, 305, { tag: "vent" }));
  const lanes = [465, 555, 645].map((x, i) => {
    b.roll("lane", i, x, 275);
    b.lamp("lane", i, x, 275, 24);
    return b.P(x, 275);
  });

  // The volcano's foot is solid; balls reach the crater only up the ramp.
  const body = b.circle(VOLCANO.x, VOLCANO.y, VOLCANO.r, {
    tag: "volcano",
    e: 0.4,
    hitMin: 300,
    scores: true,
  });
  const c = b.P(VOLCANO.x, VOLCANO.y);
  const slots: P3[] = [90, 210, 330].map((deg) => ({
    ...b.P(VOLCANO.x + Math.cos(deg * DEG) * 24, VOLCANO.y + Math.sin(deg * DEG) * 24),
    z: VOLCANO.lava + 4,
  }));
  const drop: P3[] = slots.map((s) => ({ ...s, z: VOLCANO.lava + 22 }));
  const landings = LANDINGS.map((l) => ({ ...b.P(l.x, l.y), vx: side * l.vx, vy: l.vy }));
  const outs = OUTS.map((o, i) => ({ ...b.P(o.x, o.y), vx: landings[i]!.vx, vy: landings[i]!.vy }));

  // The ramp's mouth: a pocket of rock open towards the flippers, so balls come in only from
  // below; one crossing its line fast enough rides up the lava.
  const walls = [
    b.seg(MOUTH.x0, MOUTH.y + 8, MOUTH.x0, MOUTH.back, { r: 7, tag: "ramp", e: 0.3 }),
    b.seg(MOUTH.x1, MOUTH.y + 8, MOUTH.x1, MOUTH.back, { r: 7, tag: "ramp", e: 0.3 }),
    b.seg(MOUTH.x0, MOUTH.back, MOUTH.x1, MOUTH.back, { r: 7, tag: "ramp", e: 0.3 }),
  ];
  const gate = b.gate(
    "ramp",
    0,
    { x: MOUTH.x0 + 7, y: MOUTH.y },
    { x: MOUTH.x1 - 7, y: MOUTH.y },
    { x: 0, y: -1 },
  );
  const path = RAMP.map((p) => ({ ...b.P(p.x, p.y), z: p.z }));
  const spillPath = SPILL.map((p) => ({ ...b.P(p.x, p.y), z: p.z }));
  const spillEnd = spillPath.at(-1)!;
  [-32, 0, 32].forEach((dx, i) => b.lamp("lock", i, 676 + dx, 904, 15));

  // The dinosaur: a solid body, a tail along to its tip, and the tip a bumper.
  const dinoBody = b.circle(DINO.x, DINO.y, DINO.r, {
    tag: "dino",
    e: 0.45,
    hitMin: 200,
    scores: true,
  });
  const tailBody = b.seg(440, 680, 482, 752, { r: 16, tag: "dinotail", e: 0.4 });
  const tail = b.circle(TAIL.x, TAIL.y, TAIL.r, {
    tag: "tail",
    kick: 1100,
    hitMin: 25,
    e: 0.5,
    scores: true,
  });
  const seats: P3[] = [
    { ...b.P(DINO.x - 11, DINO.y - 14), z: 72 },
    { ...b.P(DINO.x + 5, DINO.y + 6), z: 73 },
    { ...b.P(DINO.x + 20, DINO.y + 25), z: 69 },
  ];

  // Eggs in a row facing the right flipper, as drop targets.
  const toFlipper = { x: 600 - NEST.x, y: 1715 - NEST.y };
  const l = Math.hypot(toFlipper.x, toFlipper.y);
  const along = { x: toFlipper.y / l, y: -toFlipper.x / l };
  const eggs = [-1, 0, 1].map((k, i) => {
    const cx = NEST.x + along.x * k * (NEST.len + NEST.gap);
    const cy = NEST.y + along.y * k * (NEST.len + NEST.gap);
    const h = NEST.len / 2;
    b.lamp("egg", i, cx + (toFlipper.x / l) * 46, cy + (toFlipper.y / l) * 46, 13);
    return b.seg(cx - along.x * h, cy - along.y * h, cx + along.x * h, cy + along.y * h, {
      r: NEST.r,
      tag: "egg",
      index: i,
      e: 0.3,
      hitMin: 150,
      scores: true,
    });
  });

  return {
    mirror: b.mirror,
    volcano: {
      ...c,
      r: VOLCANO.r,
      base: VOLCANO.base,
      rim: VOLCANO.rim,
      top: VOLCANO.top,
      lava: VOLCANO.lava,
      body,
    },
    slots,
    drop,
    outs,
    landings,
    ramp: {
      gate,
      path,
      walls,
      mouth: b.P((MOUTH.x0 + MOUTH.x1) / 2, MOUTH.y),
      back: MOUTH.back,
      half: (MOUTH.x1 - MOUTH.x0) / 2,
    },
    spill: {
      path: spillPath,
      out: { x: spillEnd.x, y: spillEnd.y, vx: side * -80, vy: 220 },
    },
    dino: {
      body: dinoBody,
      tail,
      tailBody,
      head: { ...b.P(420, 510), z: 165 },
      seats,
      side,
    },
    eggs,
    nest: { ...b.P(NEST.x, NEST.y), along: { x: side * along.x, y: along.y }, len: NEST.len },
    lanes,
    vents,
  };
};

export interface VolcanoToys extends ToyBox {
  readonly middle: VolcanoMiddle;
  /** The crater, holding balls towards an eruption. */
  readonly lock: Lock;
  readonly ramp: Ride;
  readonly spill: Ride;
  /** Balls flying out of the crater. */
  readonly erupt: Carrier;
  readonly eggs: DropBank;
  /** Each egg: cracked and waiting for its second hit; when it last cracked and hatched. */
  readonly cracked: readonly boolean[];
  readonly crackAt: readonly number[];
  readonly hatchAt: readonly number[];
  /** World seconds the latest stomp began, and the latest eruption. */
  readonly stompAt: number;
  readonly eruptAt: number;
}

const toys = (host: ToyHost, m: VolcanoMiddle): VolcanoToys => {
  const v = m.volcano;
  const size = m.slots.length;
  const lock = createLock({
    name: "crater",
    // Inside the solid foot, so nothing rolls in: balls come only from the ramp.
    mouth: { x: v.x, y: v.y, r: 1 },
    maxSpeed: 0,
    slots: m.slots,
    drop: m.drop,
    slotScale: 0.75,
    countdown: 2.5,
    gap: 0.3,
    timeout: 14,
    cool: 3,
    out: m.outs,
  });
  const ramp = createRide({ name: "ramp", path: m.ramp.path, speed: 1050, exit: 0, max: 4 });
  const spill = createRide({
    name: "spill",
    path: m.spill.path,
    speed: 700,
    exit: { vx: m.spill.out.vx, vy: m.spill.out.vy },
    max: 6,
  });
  const crater: P3 = { x: v.x, y: v.y, z: v.lava + 8 };
  const landingOf = (from: P3, slot: number) => {
    const i = m.outs.findIndex((o) => Math.hypot(o.x - from.x, o.y - from.y) < 2);
    return m.landings[i >= 0 ? i : slot % m.landings.length]!;
  };
  const erupt = createCarrier({
    name: "erupt",
    wants: () => false,
    max: 8,
    place(since, now, from, slot) {
      const L = landingOf(from, slot);
      const big = lock.full;
      const T = big ? ERUPT.t : ERUPT.burpT;
      const k = Math.min(1, (now - since) / T);
      return {
        x: crater.x + (L.x - crater.x) * k,
        y: crater.y + (L.y - crater.y) * k,
        z: crater.z + (BALL_R - crater.z) * k + 4 * (big ? ERUPT.high : ERUPT.burp) * k * (1 - k),
        done: k >= 1 ? { vx: L.vx, vy: L.vy } : undefined,
      };
    },
  });
  const eggs = createDropBank({ targets: m.eggs, rise: 4, idle: 30 });
  const cracked = m.eggs.map(() => false);
  const crackAt = m.eggs.map(() => -Infinity);
  const hatchAt = m.eggs.map(() => -Infinity);
  let stompAt = -Infinity;
  let slammed = true;
  let nextStomp = STOMP.every;
  let eruptAt = -Infinity;
  let phase = lock.phase;
  let nextRumble = 0;

  const startStomp = (now: number, force = false) => {
    if (!force && now - stompAt < STOMP.cool) return;
    stompAt = now;
    slammed = false;
    nextStomp = now + STOMP.every + host.random() * STOMP.spread;
  };

  const box = createToyBox(host, {
    devices: [lock, ramp, spill, erupt],
    event(e, now) {
      if (e.type === "cross") {
        if (e.tag !== "ramp" || e.dir <= 0 || e.speed < 450 || e.ball.hold) return;
        if (box.put(ramp, e.ball)) {
          host.add(VOLCANO_POINTS.ramp);
          host.flash("ramp", 0);
        }
        return;
      }
      if (e.type !== "hit") return;
      if (e.tag === "tail") {
        host.add(VOLCANO_POINTS.tail);
        host.flash("tail", 0);
        startStomp(now);
      } else if (e.tag === "dino") {
        host.add(VOLCANO_POINTS.dino);
        host.flash("dino", 0);
      } else if (e.tag === "volcano") {
        host.add(VOLCANO_POINTS.rumble);
        host.flash("volcano", 0);
      } else if (e.tag === "egg") {
        const i = e.index;
        if (!eggs.up[i]) return;
        // A cracked egg hatches on its next hit; a hard hit hatches it at once.
        if (!cracked[i] && strikeLevel(e.speed, 700, 2100) < 0.8) {
          cracked[i] = true;
          crackAt[i] = now;
          host.add(VOLCANO_POINTS.crack);
          host.flash("crack", i);
          return;
        }
        const r = eggs.hit(i, now);
        if (!r) return;
        cracked[i] = false;
        hatchAt[i] = now;
        host.add(VOLCANO_POINTS.hatch);
        host.flash("egg", i);
        if (r === "done") {
          host.add(VOLCANO_POINTS.clutch);
          host.raiseMultiplier();
          host.flash("clutch", 0);
          startStomp(now, true);
        }
      }
    },
    taken(d) {
      if (d === lock) {
        host.add(VOLCANO_POINTS.lock);
        host.flash("crater", lock.count - 1);
        host.shake(0.12 + 0.06 * lock.count);
      }
    },
    let(l, d) {
      if (d === ramp) {
        // Into the crater while it is open and has room; otherwise over the rim and down.
        if (lock.phase === "open" && lock.count < size && box.put(lock, l.ball)) return;
        if (box.put(spill, l.ball)) {
          host.add(VOLCANO_POINTS.spill);
          return;
        }
        const o = m.spill.out;
        host.free(l.ball, o.x, o.y, o.vx, o.vy);
      } else if (d === lock) {
        // Thrown out of the crater; if the table can't take it, it stays beside the foot.
        box.put(erupt, l.ball);
      }
    },
    update(_dt, now) {
      eggs.update(now, host.world.balls);
      if (lock.phase !== phase) {
        if (lock.phase === "release" && lock.full) {
          eruptAt = now;
          host.add(VOLCANO_POINTS.eruption);
          host.flash("erupt", 0);
          host.shake(0.8);
        }
        if (lock.phase === "countdown") nextRumble = now;
        phase = lock.phase;
      }
      // The countdown rumbles harder and harder.
      if (lock.phase === "countdown" && now >= nextRumble) {
        const k = Math.min(1, (now - lock.phaseAt) / lock.spec.countdown);
        host.shake(0.15 + 0.25 * k);
        nextRumble = now + 0.4;
      }
      if (!slammed && now - stompAt >= STOMP.slam) {
        slammed = true;
        const b = m.dino.body;
        stomp(host.world.balls, b.x, b.y, STOMP.radius, STOMP.up);
        host.add(VOLCANO_POINTS.stomp);
        host.flash("stomp", 0);
        // Softer than an eruption's: it happens often, and on a wall beside other tables.
        host.shake(0.3);
      }
      if (host.playing() && now >= nextStomp) startStomp(now);
    },
    reset() {
      eggs.reset();
      cracked.fill(false);
      crackAt.fill(-Infinity);
      hatchAt.fill(-Infinity);
      stompAt = -Infinity;
      slammed = true;
      nextStomp = host.now() + STOMP.every;
      eruptAt = -Infinity;
      phase = lock.phase;
      nextRumble = 0;
    },
  });
  return {
    ...box,
    middle: m,
    lock,
    ramp,
    spill,
    erupt,
    eggs,
    cracked,
    crackAt,
    hatchAt,
    get stompAt() {
      return stompAt;
    },
    get eruptAt() {
      return eruptAt;
    },
  };
};

const rules: ThemeRules<VolcanoMiddle> = { id: "volcano", middle, toys };

export default rules;
