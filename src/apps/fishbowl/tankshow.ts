/**
 * Everything that moves in the wall's tank, as plain data stepped at a fixed rate, in venue
 * metres (see `tank.ts`): the fish and their steering, shoals, habits, what a finger on the
 * glass does, the food, the shrimp on the ground and the snails on the glass. Deterministic
 * from its random stream, so a run can be replayed and tested without drawing anything.
 *
 * Fish steer as in the bowl: wishes (head for a spot in the part of the tank the kind likes,
 * keep inside the water and out of sight of the side panes, keep clear of stones, wood and each
 * other, keep with the shoal) add up to a direction they turn towards at their own pace, and
 * hard limits after each step keep them in the water. A habit or a touch takes a fish over for a
 * while with wishes of its own.
 */
import type { Rng } from "../../core/types";
import type { Vec3 } from "../../core/view3d";
import { createScheduler, type Plan, type Rule, type Scheduler } from "./habits";
import { FAUNA, type Fauna, type SpeciesId, type TankCast } from "./species";
import { intoSolid, type TankLayout } from "./tank";
import {
  add,
  clamp,
  copy,
  cross,
  dist,
  dot,
  len,
  madd,
  norm,
  rotate,
  scale,
  smooth,
  sub,
  TAU,
  type V3,
  v3,
} from "./vec";

const UP: V3 = [0, 1, 0];
const OUT: V3 = [0, 0, 1];

export type TankHabit = "kiss" | "chase" | "loop" | "dart" | "nap" | "air" | "puff";
export const TANK_HABITS: readonly (TankHabit | "feed")[] = [
  "kiss",
  "chase",
  "loop",
  "dart",
  "nap",
  "air",
  "puff",
  "feed",
];

const RULES: Record<TankHabit, Rule> = {
  kiss: { weight: 3, cooldown: 18 },
  chase: { weight: 1.8, cooldown: 30 },
  loop: { weight: 1.2, cooldown: 30 },
  dart: { weight: 1.6, cooldown: 16 },
  nap: { weight: 1.2, cooldown: 80 },
  air: { weight: 1.6, cooldown: 22 },
  puff: { weight: 2, cooldown: 45 },
};

/** Most food in the water and on the ground at once. */
export const MAX_FOOD = 160;
/** Most food one hold sprinkles. */
const HOLD_FOOD = 30;
/** Flakes a feeding time drops. */
const FEED_FOOD = 36;
/** Most fingers remembered as holding at once. */
const MAX_FINGERS = 24;
/** Most taps remembered for curious fish to come and look at. */
const MAX_TAPS = 8;
/** How far a tap on the glass startles fish, metres. */
export const STARTLE_REACH = 2.4;
/** Hunger comes back from full over this long, seconds. */
const HUNGER_BACK = 240;
const LOG = 64;

type Task =
  | { kind: "kiss"; phase: "approach" | "align" | "hold" | "back"; t: number; at: V3; hold: number }
  | { kind: "peek"; phase: "approach" | "align" | "hold"; t: number; at: V3; hold: number }
  | { kind: "flee"; from: TankFish; t: number; until: number }
  | { kind: "pursue"; target: TankFish; t: number; until: number; nipped: number }
  | { kind: "loop"; phase: "approach" | "loop"; t: number; at: V3; turned: number }
  | { kind: "dart"; dir: V3; t: number; until: number; speed: number }
  | { kind: "puff"; phase: "inflate" | "hold" | "deflate"; t: number; hold: number }
  | { kind: "nap"; phase: "approach" | "rest" | "wiggle"; t: number; at: V3; rest: number }
  | { kind: "air"; phase: "up" | "gulp" | "down"; t: number; x: number; z: number }
  | { kind: "feed"; target: Food | null }
  | { kind: "cling"; at: V3; normal: V3; t: number; stay: number }
  | { kind: "move"; to: V3; normal: V3; t: number };

export interface TankFish {
  readonly id: number;
  readonly species: SpeciesId;
  readonly spec: Fauna;
  readonly len: number;
  pos: V3;
  fwd: V3;
  up: V3;
  speed: number;
  yaw: number;
  phase: number;
  amp: number;
  bend: number;
  fin: number;
  mouth: number;
  puff: number;
  /** The cory's wink, or how far a gourami's threads reach forward. */
  wink: number;
  look: number;
  readonly tint: number;
  task: Task | null;
  /** Which way along the tank it is heading, 1 or -1. */
  way: number;
  goal: { at: V3; next: number; cruise: number; hover: number };
  habit: Habit | null;
  gulp: number;
  /** 0 full to 1 hungry. */
  hunger: number;
  /** Fright from a tap, fading. */
  fear: number;
  /** Index of its shoal in `shoals`, or -1. */
  shoal: number;
  /** Where it is in its kick and glide, 0 to 1 (kicking swimmers only). */
  kick: number;
  /** The way it means to go, smoothed so it never twitches between wishes. */
  steer: V3;
  /** Where it was at the last check that it is getting somewhere, and when that is. */
  moved: V3;
  checkAt: number;
}

export interface Food {
  pos: V3;
  drift: V3;
  float: number;
  sink: number;
  spin: number;
  angle: number;
  age: number;
  landed: number;
  tone: number;
  eaten: boolean;
}

export interface Shrimp {
  pos: V3;
  /** Unit heading along the ground. */
  heading: V3;
  speed: number;
  /** Walking, picking at the ground, or flicking away backwards. */
  state: "walk" | "pick" | "flick";
  t: number;
  until: number;
  /** Phases of the legs and the claws. */
  legs: number;
  claws: number;
  /** Height of a flick's hop above the ground. */
  hop: number;
  size: number;
  target: Food | null;
}

export interface Snail {
  /** On the front glass: x and y in metres, heading along the glass. */
  x: number;
  y: number;
  heading: number;
  speed: number;
  pause: number;
  turn: number;
  mouth: number;
  wave: number;
  size: number;
  /** 1 tucked into its shell after a knock on the glass. */
  tuck: number;
}

export interface Habit {
  readonly kind: TankHabit | "feed";
  readonly side: number;
  readonly start: number;
  readonly actors: TankFish[];
  done: boolean;
  spot?: V3;
  spawned?: number;
}

/** A finger on the glass the fish know about. */
export interface Tap {
  x: number;
  y: number;
  at: number;
  /** When curious fish come to look, and whether they have been sent. */
  look: number;
  sent: boolean;
}

export interface TankLog {
  kind: TankHabit | "feed" | "tap" | "hold";
  side: number;
  t: number;
}

export interface TankShowOptions {
  cast: TankCast;
  feeding: boolean;
  layout: TankLayout;
  /** The eye the scene is seen from, to keep fish where people see them. */
  eye: Vec3;
}

export interface TankShow {
  readonly time: number;
  readonly fish: readonly TankFish[];
  readonly food: readonly Food[];
  readonly shrimp: readonly Shrimp[];
  readonly snails: readonly Snail[];
  readonly habits: readonly Habit[];
  readonly taps: readonly Tap[];
  readonly feeding: boolean;
  readonly counts: Record<TankHabit | "feed" | "tap" | "hold", number>;
  readonly sideCounts: number[];
  readonly log: readonly TankLog[];
  readonly scheduler: Scheduler<TankHabit>;
  readonly layout: TankLayout;
  step(dt: number): void;
  /** A knock on the glass at (x, y): nearby fish start away, and curious ones come to look. */
  tap(x: number, y: number): void;
  /** Finger `finger`, held on the glass at x, sprinkles food on the surface above it. */
  sprinkle(x: number, finger: number): void;
  /** Finger `finger` has lifted. */
  lift(finger: number): void;
  /** Start a habit now, ending whatever its actors were doing. False when it can't. */
  trigger(kind: TankHabit | "feed", side?: number): boolean;
  /** Let go of anything a visitor started: food, peeks, frights. */
  calm(): void;
  sideOf(x: number): number;
}

const ease = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

const horizontal = (v: V3): V3 => norm([v[0], 0, v[2]], [1, 0, 0]);

export const createTankShow = (rng: Rng, opts: TankShowOptions): TankShow => {
  const { layout } = opts;
  const { box, ground } = layout;
  const water = box.water;
  const eye = opts.eye;
  const glassMid = (box.glass.left + box.glass.right) / 2;
  const glassHalf = (box.glass.right - box.glass.left) / 2;
  const ez = Math.max(1, eye[2]);
  const scheduler = createScheduler<TankHabit>(rng.fork("habits"), {
    feeding: opts.feeding,
    rules: RULES,
    gap: [3, 7],
    maxActive: 3,
    feedEvery: [170, 260],
    firstFeed: [50, 100],
  });
  const pick = rng.fork("choices");
  const counts = Object.fromEntries(
    [...TANK_HABITS, "tap", "hold"].map((k) => [k, 0]),
  ) as TankShow["counts"];
  const sideCounts = [0, 0, 0];
  const log: TankLog[] = [];
  const habits: Habit[] = [];
  const food: Food[] = [];
  const taps: Tap[] = [];
  const held = new Map<number, number>();
  let time = 0;
  let feeding: Habit | null = null;

  const sideOf = (x: number) =>
    clamp(Math.floor(((x - box.glass.left) / (glassHalf * 2)) * 3), 0, 2);
  const sideCentre = (side: number) => box.glass.left + ((side + 0.5) * glassHalf * 2) / 3;

  /** Half the width people see at depth z (negative behind the glass), about the eye. */
  const seenHalf = (z: number) => glassHalf * ((ez - z) / ez);
  const seenX = (z: number, margin: number): [number, number] => {
    const h = Math.max(0.5, seenHalf(z) - margin);
    return [Math.max(box.left + margin, eye[0] - h), Math.min(box.right - margin, eye[0] + h)];
  };

  const half = (f: TankFish) => f.spec.halfHeight * f.len;
  const sideHalf = (f: TankFish) => f.spec.halfWidth * f.len * (1 + f.puff);
  const floorOf = (f: TankFish, p: V3) =>
    ground(p[0], p[2]) +
    half(f) * (f.puff > 0 ? 2 : 1) * (f.spec.roles.bottom ? 0.95 : 1.25) +
    0.02;
  const ceilOf = (f: TankFish, reach = 0) => water - 0.06 - half(f) * (1 + f.puff) + reach;
  /** Nearest a fish's middle comes to the front glass. */
  const frontOf = (f: TankFish) => -(sideHalf(f) + 0.06);

  const zoneY = (f: TankFish, x: number, z: number): [number, number] => {
    const lo = floorOf(f, [x, 0, z]);
    const hi = ceilOf(f);
    const [a, b] = f.spec.zone;
    return [lo + (hi - lo) * a, lo + (hi - lo) * Math.max(a + 0.02, b)];
  };

  const inLump = (p: V3, pad: number) =>
    layout.lumps.some((l) => dist(p, l.centre) < l.radius + pad) ||
    layout.solids.some((s) => intoSolid(s, p, pad).depth > 0);

  const fish: TankFish[] = [];
  const shoals: {
    species: SpeciesId;
    members: TankFish[];
    goal: V3;
    next: number;
    cruise: number;
    way: number;
  }[] = [];

  const newGoal = (f: TankFish, way: number): V3 => {
    const near = f.spec.near;
    for (let k = 0; k < 12; k++) {
      const z = -pick.range(near[0], near[1]);
      const [x0, x1] = seenX(z, f.len * 0.8);
      const step = pick.range(2, 6);
      let x = f.pos[0] + way * step;
      if (x < x0 || x > x1) x = f.pos[0] - way * step;
      x = clamp(x, x0, x1);
      const [y0, y1] = zoneY(f, x, z);
      const p: V3 = [x, pick.range(y0, y1), z];
      if (!inLump(p, f.len * 0.4)) return p;
    }
    return copy(f.pos);
  };

  const place = (spec: Fauna, i: number): V3 => {
    const own = rng.fork(`place-${i}`);
    for (let k = 0; k < 60; k++) {
      const z = -own.range(spec.near[0], spec.near[1]);
      const [x0, x1] = seenX(z, spec.length);
      const x = own.range(x0, x1);
      const g = ground(x, z);
      const top = water - 0.1 - spec.halfHeight * spec.length;
      const lo = g + spec.halfHeight * spec.length + 0.05;
      const y =
        lo + (top - lo) * own.range(spec.zone[0], Math.max(spec.zone[0] + 0.02, spec.zone[1]));
      const p: V3 = [x, y, z];
      if (inLump(p, spec.length * 0.4)) continue;
      if (fish.every((g2) => dist(g2.pos, p) > (g2.len + spec.length) * 0.6)) return p;
    }
    return [glassMid, (water + box.floor) / 2, -1.5];
  };

  opts.cast.fish.forEach((id, i) => {
    const spec = FAUNA[id];
    const own = rng.fork(`fish-${i}`);
    const size = own.range(0.9, 1.1);
    const pos = place(spec, i);
    const way = own.next() < 0.5 ? -1 : 1;
    const f: TankFish = {
      id: i,
      species: id,
      spec,
      len: spec.length * size,
      pos,
      fwd: [way, 0, 0],
      up: [0, 1, 0],
      speed: spec.cruise[0],
      yaw: 0,
      phase: own.range(0, TAU),
      amp: 0.5,
      bend: 0,
      fin: own.range(0, TAU),
      mouth: 0,
      puff: 0,
      wink: 0,
      look: 0,
      tint: own.next(),
      task: null,
      way,
      goal: {
        at: copy(pos),
        next: own.range(1, 5),
        cruise: own.range(spec.cruise[0], spec.cruise[1]),
        hover: 0,
      },
      habit: null,
      gulp: 0,
      hunger: own.range(0.4, 0.9),
      fear: 0,
      shoal: -1,
      kick: own.next(),
      steer: [way, 0, 0],
      moved: copy(pos),
      checkAt: own.range(2, 4),
    };
    fish.push(f);
  });
  for (const f of fish) {
    if (!f.spec.shoal) continue;
    let s = shoals.findIndex((x) => x.species === f.species);
    if (s < 0) {
      s = shoals.length;
      shoals.push({
        species: f.species,
        members: [],
        goal: copy(f.pos),
        next: 0,
        cruise: f.spec.cruise[0],
        way: f.way,
      });
    }
    f.shoal = s;
    shoals[s]!.members.push(f);
  }
  for (const f of fish) f.goal.at = newGoal(f, f.way);

  // Plecos start on the glass or the wood.
  const clingSpot = (f: TankFish): { at: V3; normal: V3 } => {
    const r = pick.next();
    if (r < 0.6) {
      // The front glass, low to middling, where it shows its sucker mouth to people.
      const [x0, x1] = seenX(0, 1);
      const x = pick.range(x0, x1);
      const g = ground(x, -0.1);
      const y = pick.range(g + f.len * 0.6, Math.min(water - f.len, g + 2.2));
      return { at: [x, y, -(f.spec.halfHeight * f.len + 0.01)], normal: [0, 0, -1] };
    }
    if (r < 0.85 && layout.rocks.length > 0) {
      const rock = layout.rocks[pick.int(Math.min(3, layout.rocks.length))]!;
      const y = ground(rock.x, rock.z) + rock.size[1] * 1.3;
      return {
        at: [rock.x, y + f.spec.halfHeight * f.len, rock.z + rock.size[2] * 0.2],
        normal: [0, 1, 0],
      };
    }
    const x = pick.range(...seenX(-1.5, 1));
    const z = -pick.range(0.6, 2);
    return { at: [x, ground(x, z) + f.spec.halfHeight * f.len, z], normal: [0, 1, 0] };
  };
  for (const f of fish) {
    if (!f.spec.roles.clinger) continue;
    const s = clingSpot(f);
    f.pos = copy(s.at);
    f.task = { kind: "cling", at: s.at, normal: s.normal, t: 0, stay: pick.range(30, 90) };
  }

  const shrimp: Shrimp[] = Array.from({ length: opts.cast.shrimp }, (_, i) => {
    const own = rng.fork(`shrimp-${i}`);
    const z = -own.range(0.4, 1.8);
    const x = own.range(...seenX(z, 1));
    const a = own.range(0, TAU);
    return {
      pos: [x, ground(x, z), z],
      heading: [Math.cos(a), 0, Math.sin(a)],
      speed: 0,
      state: "walk",
      t: 0,
      until: own.range(2, 6),
      legs: own.range(0, TAU),
      claws: own.range(0, TAU),
      hop: 0,
      size: own.range(0.4, 0.5),
      target: null,
    };
  });

  const snailBand = (x: number) => {
    const g = ground(x, -0.05);
    return [g + 0.15, water - 0.35] as const;
  };
  const snails: Snail[] = Array.from({ length: opts.cast.snails }, (_, i) => {
    const own = rng.fork(`snail-${i}`);
    const [x0, x1] = seenX(0, 1.2);
    const x = own.range(x0, x1);
    const [y0, y1] = snailBand(x);
    return {
      x,
      y: own.range(y0, Math.min(y1, y0 + 1.8)),
      heading: own.range(0, TAU),
      speed: 0.02,
      pause: own.range(5, 20),
      turn: 0,
      mouth: 0,
      wave: 0,
      size: own.range(0.24, 0.3),
      tuck: 0,
    };
  });

  const free = (f: TankFish) =>
    f.habit === null && f.puff === 0 && (f.task === null || f.task.kind === "feed");

  // ---- Steering ---------------------------------------------------------------------------

  const shoalWish = (f: TankFish): V3 => {
    const s = shoals[f.shoal]!;
    const sp = f.spec.shoal!;
    let centre = v3();
    let heading = v3();
    let apart = v3();
    let n = 0;
    const reach = f.len * 7;
    for (const g of s.members) {
      if (g === f) continue;
      const d = sub(g.pos, f.pos);
      const dd = len(d);
      if (dd > reach) continue;
      centre = add(centre, g.pos);
      heading = add(heading, g.fwd);
      const room = f.len * sp.spacing;
      if (dd < room && dd > 1e-6) apart = madd(apart, d, -((room - dd) / (room * dd)) * 1.8);
      n++;
    }
    const toGoal = norm(sub(s.goal, f.pos));
    // Stragglers head for the whole shoal's middle, so a split shoal comes back together.
    const all = shoalCentre(s);
    const off = dist(all, f.pos);
    const regroup = scale(norm(sub(all, f.pos)), clamp((off - f.len * 4) / (f.len * 4), 0, 1.5));
    if (n === 0) return add(scale(toGoal, 1.2), regroup);
    centre = scale(centre, 1 / n);
    const toCentre = sub(centre, f.pos);
    const d = len(toCentre);
    return add(
      add(
        scale(norm(heading), 0.8 * sp.pull),
        scale(norm(toCentre), clamp((d - f.len * 1.5) * 1.2, 0, 1.5) * sp.pull),
      ),
      add(add(apart, scale(toGoal, 0.55)), regroup),
    );
  };

  /** The ordinary wishes: head for the goal, a new one now and then. */
  const wander = (f: TankFish, dt: number): { dir: V3; speed: number } => {
    const g = f.goal;
    if (f.shoal >= 0) {
      const s = shoals[f.shoal]!;
      g.cruise = s.cruise * (0.93 + f.tint * 0.14);
      return { dir: shoalWish(f), speed: g.cruise };
    }
    g.next -= dt;
    if (g.next <= 0 || dist(g.at, f.pos) < f.len * 0.8) {
      if (pick.next() < 0.18) f.way = -f.way;
      g.at = newGoal(f, f.way);
      g.next = pick.range(4, 11);
      g.cruise = pick.range(f.spec.cruise[0], f.spec.cruise[1]);
      const hover =
        f.species === "puffer"
          ? 0.45
          : f.spec.roles.feelers
            ? 0.3
            : f.species === "angel"
              ? 0.25
              : 0.08;
      g.hover = pick.next() < hover ? pick.range(1.5, 4) : 0;
    }
    let speed = g.cruise;
    if (g.hover > 0) {
      g.hover -= dt;
      speed = f.len * 0.03;
    }
    return { dir: norm(sub(g.at, f.pos)), speed };
  };

  const keepClear = (f: TankFish, wish: V3, o: { front: boolean; reach: number }): V3 => {
    let w = wish;
    const ahead = madd(f.pos, f.fwd, 0.15 + f.speed * 0.8 + f.len * 0.5);
    const lim = o.front ? frontOf(f) - f.len * 0.25 : -0.02 - sideHalf(f);
    if (ahead[2] > lim) w = madd(w, OUT, -(ahead[2] - lim) * 6);
    const back = box.back + 0.25 + sideHalf(f);
    if (ahead[2] < back) w = madd(w, OUT, (back - ahead[2]) * 6);
    const [x0, x1] = seenX(Math.min(-0.1, f.pos[2]), f.len * 0.6);
    if (ahead[0] < x0) w = madd(w, [1, 0, 0], (x0 - ahead[0]) * 2.5);
    if (ahead[0] > x1) w = madd(w, [-1, 0, 0], (ahead[0] - x1) * 2.5);
    const top = ceilOf(f, o.reach);
    if (ahead[1] > top) w = madd(w, UP, -(ahead[1] - top) * 8);
    const bottom = floorOf(f, ahead);
    if (ahead[1] < bottom) w = madd(w, UP, (bottom - ahead[1]) * 8);
    /**
     * Which way round something in the way: the way it was already turning, or met head on,
     * its own side, so it never dithers between the two.
     */
    const round = (out: V3): V3 => {
      const along = sub(f.fwd, scale(out, dot(f.fwd, out)));
      const side = norm(cross(out, UP), [1, 0, 0]);
      const pref = f.tint < 0.5 ? -1 : 1;
      return norm(madd(along, side, pref * 0.35), side);
    };
    for (const l of layout.lumps) {
      const d = sub(ahead, l.centre);
      const dd = len(d);
      const room = l.radius + f.len * 0.45;
      if (dd < room && dd > 1e-6) {
        const k = (room - dd) / room;
        const out = scale(d, 1 / dd);
        w = madd(madd(w, out, k * 2.5), round(out), k * 1.5);
      }
    }
    // Stones and wood: turn away, and slide along them the way it was going.
    const pad = sideHalf(f) + 0.2;
    for (const s of layout.solids) {
      for (const [pt, k] of [
        [ahead, 1],
        [f.pos, 1.6],
      ] as const) {
        const hit = intoSolid(s, pt, pad);
        if (hit.depth <= 0) continue;
        const out = copy(hit.out);
        w = madd(w, out, hit.depth * 7 * k);
        w = madd(w, round(out), hit.depth * 3 * k);
      }
    }
    for (const g of fish) {
      if (g === f || (g.shoal >= 0 && g.shoal === f.shoal)) continue;
      const d = sub(f.pos, g.pos);
      const dd = len(d);
      const room = (f.len + g.len) * 0.55;
      if (dd < room && dd > 1e-6) {
        const shy = g.len > f.len * 1.5 ? 2 : g.len * 1.5 < f.len ? 0.4 : 1;
        w = madd(w, d, ((room - dd) / (room * dd)) * 2.2 * shy);
      }
    }
    // A fright keeps fish off the glass where the knock was.
    if (f.fear > 0.05) {
      for (const t of taps) {
        const d = sub(f.pos, [t.x, t.y, 0]);
        const dd = len(d);
        if (dd < STARTLE_REACH * 1.4 && dd > 1e-6) w = madd(w, d, (f.fear * 2.5) / dd);
      }
    }
    return w;
  };

  const turnToward = (f: TankFish, wish: V3, dt: number, pitch: number, rate: number) => {
    let d = norm(wish, f.fwd);
    const s = Math.sin(pitch);
    if (Math.abs(d[1]) > s) {
      const h = horizontal(d);
      const c = Math.cos(pitch);
      d = [h[0] * c, Math.sign(d[1]) * s, h[2] * c];
    }
    const cos = clamp(dot(f.fwd, d), -1, 1);
    const angle = Math.acos(cos);
    let yaw = 0;
    if (angle > 1e-5) {
      let axis = cross(f.fwd, d);
      axis = len(axis) > 1e-6 ? norm(axis) : copy(f.up);
      const step = Math.min(angle, rate * dt);
      f.fwd = norm(rotate(f.fwd, axis, step));
      f.up = rotate(f.up, axis, step);
      yaw = (dot(axis, f.up) * step) / dt;
    }
    f.yaw += (yaw - f.yaw) * (1 - Math.exp(-dt * 6));
  };

  const level = (f: TankFish, dt: number, rate = 2.5) => {
    let want = sub(UP, scale(f.fwd, dot(UP, f.fwd)));
    want = len(want) > 1e-4 ? norm(want) : copy(f.up);
    want = rotate(want, f.fwd, clamp(-f.yaw * 0.2, -0.35, 0.35));
    const mixed = norm(madd(f.up, want, 1 - Math.exp(-dt * rate)));
    f.up = norm(sub(mixed, scale(f.fwd, dot(mixed, f.fwd))), want);
  };

  /** Turn a fish pressed against something to run along it instead of into it. */
  const slide = (f: TankFish, out: V3) => {
    const into = dot(f.fwd, out);
    if (into < 0) f.fwd = norm(madd(f.fwd, out, -into * 1.05), f.fwd);
    const sInto = dot(f.steer, out);
    if (sInto < 0) f.steer = norm(madd(f.steer, out, -sInto * 1.05), f.fwd);
  };

  const contain = (f: TankFish, reach: number, front: number) => {
    // Nothing passes through stones or wood; then the glass and the surface have the last word.
    const pad = sideHalf(f) + 0.02;
    for (const s of layout.solids) {
      for (const k of [0.45, 0, -0.45]) {
        const p = madd(f.pos, f.fwd, f.len * k);
        const { depth, out } = intoSolid(s, p, pad);
        if (depth <= 0) continue;
        const way = copy(out);
        f.pos = madd(f.pos, way, depth);
        slide(f, way);
      }
    }
    for (const k of [0.5, -0.5]) {
      const tip = madd(f.pos, f.fwd, f.len * k);
      if (tip[2] > -0.015) f.pos[2] -= tip[2] + 0.015;
      if (tip[2] < box.back + 0.05) f.pos[2] += box.back + 0.05 - tip[2];
      if (tip[0] < box.left + 0.05) f.pos[0] += box.left + 0.05 - tip[0];
      if (tip[0] > box.right - 0.05) f.pos[0] -= tip[0] - box.right + 0.05;
      // Nose and tail stay in the water and off the ground too.
      const lid = water - 0.03;
      if (tip[1] > lid) f.pos[1] -= tip[1] - lid;
      const g = ground(tip[0], tip[2]) + 0.02;
      if (tip[1] < g) f.pos[1] += g - tip[1];
    }
    if (f.pos[2] > front) {
      f.pos[2] = front;
      slide(f, [0, 0, -1]);
    }
    // However far it reaches, its body stays under the surface.
    const top = Math.min(ceilOf(f, reach) + 0.03, water - 0.03 - half(f) * 0.5);
    if (f.pos[1] > top) {
      f.pos[1] = top;
      slide(f, [0, -1, 0]);
    }
    const bottom = floorOf(f, f.pos) - 0.02;
    if (f.pos[1] < bottom) {
      f.pos[1] = bottom;
      slide(f, [0, 1, 0]);
    }
  };

  // ---- Habits -----------------------------------------------------------------------------

  const begin = (plan: Plan<TankHabit>, actors: TankFish[], spot?: V3): Habit => {
    const h: Habit = { kind: plan.kind, side: plan.side, start: time, actors, done: false };
    if (spot) h.spot = spot;
    for (const f of actors) f.habit = h;
    habits.push(h);
    counts[plan.kind]++;
    sideCounts[plan.side] = (sideCounts[plan.side] ?? 0) + 1;
    log.push({ kind: plan.kind, side: plan.side, t: time });
    if (log.length > LOG) log.shift();
    scheduler.started(plan, time);
    return h;
  };

  const rest = (f: TankFish): Task | null => {
    if (f.spec.roles.clinger) {
      const s = clingSpot(f);
      return { kind: "move", to: s.at, normal: s.normal, t: 0 };
    }
    return null;
  };

  const done = (f: TankFish) => {
    f.task = rest(f);
    const h = f.habit;
    f.habit = null;
    if (h && h.actors.every((a) => a.habit !== h)) h.done = true;
  };

  const cancel = (h: Habit) => {
    for (const f of h.actors) {
      if (f.habit !== h) continue;
      if (f.task?.kind === "puff") {
        f.task = { kind: "puff", phase: "deflate", t: 0, hold: 0 };
        continue;
      }
      f.task = rest(f);
      f.habit = null;
    }
    h.done = true;
  };

  const ofRole = (role: keyof Fauna["roles"]) => fish.filter((f) => f.spec.roles[role]);
  const freeOf = (list: TankFish[]) => list.filter(free);
  const nearestTo = (list: TankFish[], p: V3) =>
    list.reduce<TankFish | null>((b, f) => (!b || dist(f.pos, p) < dist(b.pos, p) ? f : b), null);

  /** A spot on the front glass on `side`, at a height people see well, for fish `f`. */
  const glassSpot = (f: TankFish, side: number): V3 => {
    const x = sideCentre(side) + pick.range(-1.4, 1.4);
    const g = ground(x, -0.2);
    const [y0, y1] = zoneY(f, x, -0.3);
    const y = clamp(pick.range(1.1, 2.6), Math.max(y0, g + half(f) + 0.2), y1);
    return [x, y, 0];
  };

  const startKiss = (side: number): boolean => {
    const options = freeOf(ofRole("kiss"));
    if (options.length === 0) return false;
    const at = glassSpot(options[0]!, side);
    const f = nearestTo(options, at)!;
    const spot = glassSpot(f, side);
    begin({ kind: "kiss", side }, [f], spot);
    f.task = { kind: "kiss", phase: "approach", t: 0, at: spot, hold: pick.range(4.5, 7) };
    return true;
  };

  const startChase = (): boolean => {
    for (const a of freeOf(ofRole("chase"))) {
      const mates = freeOf(fish.filter((g) => g !== a && g.species === a.species));
      const b = nearestTo(mates, a.pos);
      if (!b) continue;
      const [chaser, chased] = pick.next() < 0.5 ? [a, b] : [b, a];
      const until = pick.range(6, 10);
      begin({ kind: "chase", side: sideOf(chased.pos[0]) }, [chaser, chased]);
      chased.task = { kind: "flee", from: chaser, t: 0, until };
      chaser.task = { kind: "pursue", target: chased, t: 0, until, nipped: 0 };
      return true;
    }
    return false;
  };

  const startLoop = (side: number): boolean => {
    const options = freeOf(ofRole("loop"));
    const x = sideCentre(side) + pick.range(-1.5, 1.5);
    const z = -pick.range(1, 1.8);
    const [y0, y1] = zoneY(options[0] ?? fish[0]!, x, z);
    const at: V3 = [x, (y0 + y1) / 2 + 0.3, z];
    const f = nearestTo(options, at);
    if (!f) return false;
    begin({ kind: "loop", side }, [f], at);
    f.task = { kind: "loop", phase: "approach", t: 0, at, turned: 0 };
    return true;
  };

  const shoalCentre = (s: (typeof shoals)[number]) => {
    let c = v3();
    for (const f of s.members) c = add(c, f.pos);
    return scale(c, 1 / Math.max(1, s.members.length));
  };

  /** The whole shoal turns and flashes away together. */
  const flash = (s: (typeof shoals)[number], dir: V3 | null, from?: V3) => {
    s.way = -s.way;
    const base = dir ?? norm([s.way, pick.range(-0.2, 0.2), pick.range(-0.4, -0.1)]);
    for (const [i, f] of s.members.entries()) {
      if (!free(f) && f.task?.kind !== "dart") continue;
      const away = from ? norm(add(norm(sub(f.pos, from)), scale(base, 0.6))) : base;
      const jitter = rotate(away, UP, ((i % 5) - 2) * 0.07);
      f.task = {
        kind: "dart",
        dir: norm([jitter[0], jitter[1] * 0.6, Math.min(jitter[2], -0.15)]),
        t: 0,
        until: pick.range(0.5, 0.9),
        speed: f.spec.burst,
      };
    }
    const c = shoalCentre(s);
    s.goal = [c[0] + s.way * 4, c[1], clamp(c[2] - 0.6, box.back + 1, -0.6)];
    s.next = pick.range(4, 8);
  };

  const startDart = (): boolean => {
    const options = shoals.filter((s) => s.members.filter(free).length >= 3);
    if (options.length === 0) return false;
    const s = options[pick.int(options.length)]!;
    const actors = s.members.filter(free);
    flash(s, null);
    begin({ kind: "dart", side: sideOf(shoalCentre(s)[0]) }, actors);
    return true;
  };

  const startNap = (side: number): boolean => {
    const options = freeOf(fish.filter((f) => f.species === "cory"));
    const x = sideCentre(side) + pick.range(-1.6, 1.6);
    const z = -pick.range(0.45, 1.1);
    const at: V3 = [x, ground(x, z), z];
    const f = nearestTo(options, at);
    if (!f) return false;
    begin({ kind: "nap", side }, [f], at);
    f.task = { kind: "nap", phase: "approach", t: 0, at, rest: pick.range(18, 35) };
    return true;
  };

  const startAir = (side: number): boolean => {
    const options = freeOf(fish.filter((f) => f.species === "cory"));
    const x = sideCentre(side) + pick.range(-1.6, 1.6);
    const f = nearestTo(options, [x, box.floor, -0.8]);
    if (!f) return false;
    begin({ kind: "air", side }, [f]);
    f.task = { kind: "air", phase: "up", t: 0, x: f.pos[0], z: clamp(f.pos[2], -1.4, -0.4) };
    return true;
  };

  const startPuff = (): boolean => {
    const p = fish.find((f) => f.spec.roles.puff && free(f));
    if (!p) return false;
    begin({ kind: "puff", side: sideOf(p.pos[0]) }, [p]);
    p.task = { kind: "puff", phase: "inflate", t: 0, hold: pick.range(4, 6) };
    return true;
  };

  const spawnFood = (x: number, z: number) => {
    if (food.length >= MAX_FOOD) {
      // Make room: the oldest on the ground goes first.
      let oldest = -1;
      for (let i = 0; i < food.length; i++) {
        if (food[i]!.landed > 0 && (oldest < 0 || food[i]!.landed > food[oldest]!.landed))
          oldest = i;
      }
      if (oldest < 0) return;
      food.splice(oldest, 1);
    }
    food.push({
      pos: [x, water - 0.02, z],
      drift: [pick.range(-0.03, 0.03), 0, pick.range(-0.02, 0.02)],
      float: pick.range(0.4, 2.5),
      sink: pick.range(0.12, 0.2),
      spin: pick.range(-2, 2),
      angle: pick.range(0, TAU),
      age: 0,
      landed: 0,
      tone: pick.next(),
      eaten: false,
    });
  };

  const startFeed = (side: number): boolean => {
    for (const h of habits) if (!h.done) cancel(h);
    const x = sideCentre(side) + pick.range(-1, 1);
    const spot: V3 = [x, water, -0.8];
    const h = begin({ kind: "feed", side }, []);
    h.spot = spot;
    h.spawned = 0;
    feeding = h;
    for (const f of fish) f.hunger = Math.max(f.hunger, 0.8);
    return true;
  };

  const start = (plan: Plan<TankHabit>): boolean => {
    switch (plan.kind) {
      case "kiss":
        return startKiss(plan.side);
      case "chase":
        return startChase();
      case "loop":
        return startLoop(plan.side);
      case "dart":
        return startDart();
      case "nap":
        return startNap(plan.side);
      case "air":
        return startAir(plan.side);
      case "puff":
        return startPuff();
      case "feed":
        return startFeed(plan.side);
    }
  };

  const where = (kind: TankHabit): number | null | false => {
    switch (kind) {
      case "kiss":
        return freeOf(ofRole("kiss")).length > 0 ? null : false;
      case "chase": {
        const c = freeOf(ofRole("chase"));
        const pair = c.find((a) => c.some((b) => b !== a && b.species === a.species));
        return pair ? sideOf(pair.pos[0]) : false;
      }
      case "loop":
        return freeOf(ofRole("loop")).length > 0 ? null : false;
      case "dart": {
        const s = shoals.find((x) => x.members.filter(free).length >= 3);
        return s ? sideOf(shoalCentre(s)[0]) : false;
      }
      case "nap":
      case "air":
        return freeOf(fish.filter((f) => f.species === "cory")).length > 0 ? null : false;
      case "puff": {
        const p = fish.find((f) => f.spec.roles.puff && free(f));
        return p ? sideOf(p.pos[0]) : false;
      }
    }
  };

  // ---- Touch --------------------------------------------------------------------------------

  const tap = (x: number, y: number) => {
    counts.tap++;
    log.push({ kind: "tap", side: sideOf(x), t: time });
    if (log.length > LOG) log.shift();
    const at: V3 = [x, y, 0];
    const flashed = new Set<number>();
    for (const f of fish) {
      const d = dist(f.pos, at);
      if (d > STARTLE_REACH + f.len * 0.5) continue;
      f.fear = Math.min(1, f.fear + (1 - d / (STARTLE_REACH * 1.2)));
      if (f.task?.kind === "cling") {
        // A pleco right by the knock lets go and scoots off; one further away holds on.
        if (d < 1.2)
          f.task = {
            kind: "dart",
            dir: norm([pick.range(-1, 1), 0.2, -1]),
            t: 0,
            until: 0.6,
            speed: f.spec.burst,
          };
        continue;
      }
      if (f.task?.kind === "puff" || f.task?.kind === "nap") continue;
      if (f.shoal >= 0) {
        flashed.add(f.shoal);
        continue;
      }
      if (f.habit) cancel(f.habit);
      const away = norm(sub(f.pos, at), [0, 0, -1]);
      f.task = {
        kind: "dart",
        dir: norm([away[0], away[1] * 0.5, Math.min(away[2], -0.4)]),
        t: 0,
        until: pick.range(0.45, 0.8),
        speed: f.spec.burst,
      };
      if (f.spec.roles.puff && d < STARTLE_REACH * 0.7 && f.puff === 0) {
        f.task = { kind: "puff", phase: "inflate", t: 0, hold: pick.range(3, 5) };
      }
    }
    for (const s of flashed) flash(shoals[s]!, null, at);
    for (const sh of shrimp) {
      if (dist(sh.pos, at) > STARTLE_REACH) continue;
      sh.state = "flick";
      sh.t = 0;
      sh.until = 0.5;
      sh.heading = norm([sh.pos[0] - x, 0, Math.min(-0.3, sh.pos[2])]);
    }
    for (const s of snails) if (Math.hypot(s.x - x, s.y - y) < STARTLE_REACH * 0.8) s.tuck = 1;
    taps.push({ x, y, at: time, look: time + pick.range(1.2, 2.2), sent: false });
    while (taps.length > MAX_TAPS) taps.shift();
  };

  /** Curious fish come to look at a finger once the fright has passed. */
  const sendLookers = (t: Tap) => {
    t.sent = true;
    const at: V3 = [t.x, t.y, 0];
    const options = fish
      .filter(
        (f) => (f.spec.roles.curious ?? 0) > 0 && (free(f) || f.task?.kind === "dart") && !f.habit,
      )
      .map((f) => ({
        f,
        w: ((f.spec.roles.curious ?? 0) * pick.next()) / (1 + dist(f.pos, at) * 0.3),
      }))
      .filter((o) => dist(o.f.pos, at) < 7)
      .sort((a, b) => b.w - a.w);
    const big = options.filter((o) => o.f.len > 0.7).slice(0, 2);
    const small = options.filter((o) => o.f.len <= 0.7).slice(0, 3);
    for (const [i, { f }] of [...big, ...small].entries()) {
      // Each comes to its own spot by the finger, at a height it can reach.
      const a = (i / 5) * TAU + pick.range(-0.4, 0.4);
      const r = f.len * 0.55 + 0.2;
      const x = t.x + Math.cos(a) * r;
      const [y0, y1] = [floorOf(f, [x, 0, -0.3]), ceilOf(f)];
      const y = clamp(t.y + Math.sin(a) * r * 0.6, y0, y1);
      f.task = { kind: "peek", phase: "approach", t: 0, at: [x, y, 0], hold: pick.range(3, 6) };
    }
  };

  const sprinkle = (x: number, finger: number) => {
    const n = held.get(finger) ?? 0;
    if (n >= HOLD_FOOD) return;
    if (n === 0) {
      counts.hold++;
      log.push({ kind: "hold", side: sideOf(x), t: time });
      if (log.length > LOG) log.shift();
      // Fingers that never lifted (a lost pointer) are forgotten oldest first.
      if (held.size >= MAX_FINGERS) held.delete(held.keys().next().value!);
    }
    held.set(finger, n + 1);
    spawnFood(x + pick.range(-0.45, 0.45), -pick.range(0.25, 1.4));
    for (const f of fish) f.hunger = Math.max(f.hunger, 0.5);
  };

  // ---- Food ---------------------------------------------------------------------------------

  const mouthOf = (f: TankFish) => madd(f.pos, f.fwd, f.len * 0.48);

  const tryEat = (f: TankFish) => {
    const m = mouthOf(f);
    const reach = 0.06 + f.len * 0.12;
    for (const k of food) {
      if (k.eaten) continue;
      const across = Math.hypot(k.pos[0] - m[0], k.pos[2] - m[2]);
      const up = k.pos[1] - m[1];
      // A fish can suck in food floating just above its mouth.
      const above = k.pos[1] > water - 0.1 ? reach + 0.12 : reach;
      if (across > reach || up < -reach || up > above) continue;
      k.eaten = true;
      f.gulp = 1;
      f.hunger = Math.max(0, f.hunger - 1 / f.spec.appetite);
      return;
    }
  };

  const stepFood = (dt: number) => {
    for (const k of food) {
      k.age += dt;
      const floor = ground(k.pos[0], k.pos[2]) + 0.01;
      if (k.pos[1] <= floor) {
        k.pos[1] = floor;
        k.landed += dt;
        continue;
      }
      k.pos = madd(k.pos, k.drift, dt);
      if (k.age < k.float) {
        k.angle += k.spin * 0.2 * dt;
        k.pos[1] = water - 0.02;
      } else {
        const sunk = k.age - k.float;
        const wob = Math.sin(sunk * 2.1 + k.tone * 9) * 0.08;
        k.angle += k.spin * dt;
        k.pos[0] += Math.cos(k.angle) * wob * dt;
        k.pos[2] += Math.sin(k.angle) * wob * dt;
        k.pos[1] -= k.sink * Math.min(1, 0.35 + sunk * 0.2) * dt;
      }
      k.pos[2] = clamp(k.pos[2], box.back + 0.2, -0.08);
    }
    for (let i = food.length - 1; i >= 0; i--) {
      const k = food[i]!;
      if (k.eaten || k.landed > 30 || k.age > 120) food.splice(i, 1);
    }
  };

  /** Hungry fish go for the nearest food they can see, spread over the flakes. */
  const aimFood = () => {
    const claimed = new Set<Food>();
    for (const f of fish) {
      const t = f.task;
      const busy = t !== null && t.kind !== "feed" && t.kind !== "peek";
      if (busy || f.habit || f.puff > 0 || f.spec.roles.clinger) continue;
      if (f.hunger < 0.15 || f.fear > 0.4) {
        if (t?.kind === "feed") f.task = null;
        continue;
      }
      let target = t?.kind === "feed" ? t.target : null;
      if (target && (target.eaten || !food.includes(target))) target = null;
      if (!target) {
        let best: Food | null = null;
        let bestD = 6;
        for (const k of food) {
          if (k.eaten) continue;
          const onGround = k.landed > 0;
          if (onGround !== Boolean(f.spec.roles.bottom)) continue;
          const d = dist(f.pos, k.pos) + (claimed.has(k) ? 0.6 : 0);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        target = best;
      }
      if (target) {
        claimed.add(target);
        f.task = { kind: "feed", target };
      } else if (t?.kind === "feed") {
        f.task = null;
      }
    }
  };

  const stepFeeding = (h: Habit) => {
    const at = time - h.start;
    const spot = h.spot!;
    while ((h.spawned ?? 0) < Math.min(FEED_FOOD, Math.floor(at / 0.14))) {
      spawnFood(spot[0] + pick.range(-0.9, 0.9), -pick.range(0.3, 1.5));
      h.spawned = (h.spawned ?? 0) + 1;
    }
    const left = food.some((k) => !k.eaten && k.landed === 0);
    if (((h.spawned ?? 0) >= FEED_FOOD && !left && at > 8) || at > 50) {
      h.done = true;
      feeding = null;
    }
  };

  // ---- One fish, one step -------------------------------------------------------------------

  const stepFish = (f: TankFish, dt: number) => {
    const spec = f.spec;
    let wish: V3;
    let speed: number;
    let front = true;
    let reach = 0;
    let pitch = 0.45;
    let rate = spec.turn;
    let hold = false;
    let steer = true;
    let mouth = 0.12 + 0.08 * Math.sin(time * 2.4 + f.tint * 20);
    let feel = 0;
    const t = f.task;

    const base = wander(f, dt);
    wish = base.dir;
    speed = base.speed;

    switch (t?.kind) {
      case "kiss":
      case "peek": {
        t.t += dt;
        const holdAt: V3 = [t.at[0], t.at[1], -(f.len * 0.5 + 0.035)];
        if (t.phase === "approach") {
          const stage: V3 = [t.at[0], t.at[1], -(f.len * 0.5 + 0.55)];
          wish = sub(stage, f.pos);
          speed = Math.min(spec.burst * 0.6, Math.max(spec.cruise[1], len(wish) * 0.8));
          if (dist(stage, f.pos) < 0.18 + f.len * 0.1 || t.t > 12) {
            t.phase = "align";
            t.t = 0;
          }
        } else if (t.phase === "align") {
          front = false;
          pitch = 1.2;
          wish = OUT;
          speed = dot(f.fwd, OUT) > 0.9 ? 0.12 : 0.02;
          if (dist(f.pos, holdAt) < 0.05 || t.t > 6) {
            t.phase = "hold";
            t.t = 0;
          }
        } else if (t.phase === "hold") {
          front = false;
          pitch = 1.2;
          hold = true;
          wish = OUT;
          speed = 0;
          f.pos = madd(f.pos, sub(holdAt, f.pos), 1 - Math.exp(-dt * 3));
          if (t.kind === "kiss") {
            const smack = Math.sin(t.t * TAU * 1.6);
            mouth = 0.25 + 0.75 * Math.max(0, smack) * (Math.sin(t.t * 0.9) > -0.6 ? 1 : 0.2);
          } else {
            mouth = 0.2 + 0.2 * Math.sin(t.t * 5);
          }
          if (spec.roles.feelers) feel = 0.6 + 0.4 * Math.sin(t.t * 1.3);
          if (t.t > t.hold) {
            if (t.kind === "kiss") {
              t.phase = "back";
              t.t = 0;
            } else {
              f.way = pick.next() < 0.5 ? -1 : 1;
              f.goal.next = 0;
              f.fwd = norm(madd(f.fwd, [f.way, 0, -0.6], 1.5));
              done(f);
            }
          }
        } else {
          front = false;
          pitch = 1.2;
          hold = true;
          wish = OUT;
          speed = -0.12;
          if (t.t > 1.4) {
            f.way = pick.next() < 0.5 ? -1 : 1;
            f.goal.next = 0;
            f.fwd = norm(madd(f.fwd, [f.way, 0, -0.5], 1.5));
            done(f);
          }
        }
        break;
      }
      case "flee": {
        t.t += dt;
        const away = sub(f.pos, t.from.pos);
        wish = add(scale([f.way, 0, 0], 1.2), scale(norm(away), 0.9));
        wish[1] += Math.sin(t.t * 1.3) * 0.25;
        speed = spec.burst * 0.75;
        if (t.t > t.until) done(f);
        break;
      }
      case "pursue": {
        t.t += dt;
        wish = sub(madd(t.target.pos, t.target.fwd, 0.2), f.pos);
        speed = spec.burst * 0.85;
        t.nipped -= dt;
        if (dist(mouthOf(f), madd(t.target.pos, t.target.fwd, -t.target.len * 0.4)) < 0.15) {
          if (t.nipped <= 0) {
            f.gulp = 1;
            t.nipped = 1.4;
            t.target.fwd = norm(rotate(t.target.fwd, t.target.up, pick.range(-0.7, 0.7)));
          }
          speed = t.target.speed * 0.9;
        }
        if (t.t > t.until) done(f);
        break;
      }
      case "loop": {
        t.t += dt;
        if (t.phase === "approach") {
          wish = add(sub(t.at, f.pos), [f.way * 0.3, 0, 0]);
          speed = spec.cruise[1] * 1.2;
          if ((dist(f.pos, t.at) < 0.3 && Math.abs(f.fwd[1]) < 0.2) || t.t > 14) {
            if (t.t > 14 && dist(f.pos, t.at) > 0.8) {
              done(f);
              break;
            }
            t.phase = "loop";
            t.t = 0;
          }
        } else {
          steer = false;
          speed = spec.burst * 0.6;
          const spin = (TAU / 2.6) * dt;
          const side = norm(cross(f.fwd, f.up));
          f.fwd = norm(rotate(f.fwd, side, spin));
          f.up = norm(rotate(f.up, side, spin));
          t.turned += spin;
          if (t.turned >= TAU) done(f);
        }
        break;
      }
      case "dart": {
        t.t += dt;
        wish = t.dir;
        rate = spec.turn * 3;
        speed = t.speed * (t.t < t.until ? 1 : 0.4);
        if (t.t > t.until + 0.7) {
          f.task = rest(f);
          if (f.habit?.kind === "dart") done(f);
        }
        break;
      }
      case "puff": {
        t.t += dt;
        steer = false;
        speed = 0.01;
        if (t.phase === "inflate") {
          f.puff = Math.max(f.puff, ease(t.t / 1.1));
          mouth = 0.5;
          if (t.t >= 1.1) {
            t.phase = "hold";
            t.t = 0;
          }
        } else if (t.phase === "hold") {
          f.puff = 1;
          f.pos[1] += Math.sin(t.t * 1.7) * 0.01 * dt;
          if (t.t >= t.hold) {
            t.phase = "deflate";
            t.t = 0;
          }
        } else {
          f.puff = 1 - smooth(t.t / 5);
          if (t.t >= 5) {
            f.puff = 0;
            done(f);
          }
        }
        break;
      }
      case "nap": {
        t.t += dt;
        if (t.phase === "approach") {
          wish = sub(t.at, f.pos);
          speed = Math.max(0.12, spec.cruise[1]);
          if (Math.hypot(f.pos[0] - t.at[0], f.pos[2] - t.at[2]) < 0.15 || t.t > 25) {
            t.phase = "rest";
            t.t = 0;
          }
        } else if (t.phase === "rest") {
          hold = true;
          speed = 0;
          wish = horizontal(f.fwd);
          f.pos[1] += (floorOf(f, f.pos) - 0.01 - f.pos[1]) * (1 - Math.exp(-dt * 1.5));
          const k = (t.t % 9) / 0.7;
          f.wink = k < 1 ? Math.sin(k * Math.PI) : 0;
          if (t.t > t.rest) {
            t.phase = "wiggle";
            t.t = 0;
          }
        } else {
          speed = 0.1 + t.t * 0.15;
          f.wink = 0;
          f.amp = 1.6;
          if (t.t > 1) done(f);
        }
        break;
      }
      case "air": {
        t.t += dt;
        front = false;
        pitch = 1.35;
        rate = spec.turn * 2;
        if (t.phase === "up") {
          wish = [t.x - f.pos[0], 4, t.z - f.pos[2]];
          speed = spec.burst * 0.75;
          reach = half(f) + 0.04;
          if (f.pos[1] > ceilOf(f, reach) - 0.05 || t.t > 8) {
            t.phase = "gulp";
            t.t = 0;
            f.gulp = 1;
          }
        } else if (t.phase === "gulp") {
          reach = half(f) + 0.04;
          wish = [0, 1, 0];
          speed = 0.02;
          mouth = 1;
          if (t.t > 0.35) {
            t.phase = "down";
            t.t = 0;
          }
        } else {
          wish = [Math.sin(f.tint * 9) * 0.3, -3, 0];
          speed = spec.burst * 0.6;
          if (f.pos[1] < floorOf(f, f.pos) + 0.1 || t.t > 8) done(f);
        }
        break;
      }
      case "feed": {
        if (t.target) {
          const m = mouthOf(f);
          // Food on the surface is taken from just under it, never by pressing against it.
          const aim: V3 = [
            t.target.pos[0],
            Math.min(t.target.pos[1], water - 0.08),
            t.target.pos[2],
          ];
          wish = sub(aim, m);
          const d = len(wish);
          speed = Math.min(spec.burst * 0.8, spec.cruise[1] * 2.5, 0.06 + d * 1.4);
          rate = spec.turn * 1.6;
          pitch = 0.75;
          front = false;
          reach = 0.05;
          tryEat(f);
        }
        break;
      }
      case "cling": {
        // Stuck on with its mouth, creeping a little now and then, rasping.
        steer = false;
        hold = true;
        t.t += dt;
        f.pos = madd(f.pos, sub(t.at, f.pos), 1 - Math.exp(-dt * 2));
        const along = norm(cross(t.normal, cross(f.fwd, t.normal)), [0, 1, 0]);
        const target = norm(madd(along, t.normal, 0.0));
        f.fwd = norm(madd(f.fwd, sub(target, f.fwd), 1 - Math.exp(-dt * 2)));
        const back = norm(sub(t.normal, scale(f.fwd, dot(t.normal, f.fwd))), [0, 1, 0]);
        // Its belly is on the surface, so its back faces away from it.
        f.up = norm(madd(f.up, sub(back, f.up), 1 - Math.exp(-dt * 3)));
        f.speed = 0;
        mouth = 0.45 + 0.45 * Math.sin(time * 3.1 + f.tint * 7);
        if (Math.sin(t.t * 0.4 + f.tint * 5) > 0.92) {
          t.at = madd(t.at, f.fwd, 0.02 * dt);
        }
        if (t.t > t.stay) {
          const s = clingSpot(f);
          f.task = { kind: "move", to: s.at, normal: s.normal, t: 0 };
        }
        break;
      }
      case "move": {
        t.t += dt;
        const stage = madd(t.to, t.normal, 0.25 + f.len * 0.4);
        front = t.normal[2] > -0.5;
        if (dist(f.pos, t.to) < 0.9) {
          // The last stretch: settle onto the surface, belly first.
          steer = false;
          const step = Math.min(dist(f.pos, t.to), spec.cruise[1] * dt * 1.5);
          f.pos = madd(f.pos, norm(sub(t.to, f.pos)), step);
          const along = norm(sub(f.fwd, scale(t.normal, dot(f.fwd, t.normal))), [0, 1, 0]);
          f.fwd = norm(madd(f.fwd, sub(along, f.fwd), 1 - Math.exp(-dt * 3)));
          f.up = norm(madd(f.up, sub(t.normal, f.up), 1 - Math.exp(-dt * 3)));
          f.speed = spec.cruise[0];
        } else {
          wish = sub(dist(f.pos, stage) > 0.3 ? stage : t.to, f.pos);
          speed = Math.max(spec.cruise[1], Math.min(spec.burst * 0.5, len(wish)));
        }
        if (dist(f.pos, t.to) < 0.05 || t.t > 25) {
          f.task = { kind: "cling", at: t.to, normal: t.normal, t: 0, stay: pick.range(40, 120) };
        }
        break;
      }
      default:
        if (spec.roles.bottom) {
          // Bottom-dwellers keep to the ground in short scoots, nose down, picking.
          wish = [base.dir[0], (floorOf(f, f.pos) + 0.03 - f.pos[1]) * 3, base.dir[2]];
          if (f.goal.hover > 0) mouth = 0.4 + 0.4 * Math.sin(time * 9);
        }
        break;
    }

    // A resting fish holds its heading rather than turning on the spot.
    if (t === null && f.goal.hover > 0) rate *= 0.15;
    const atGlass = (t?.kind === "kiss" || t?.kind === "peek") && t.phase !== "approach";
    if (steer && atGlass) {
      // Placed at the glass on purpose: no clearances to argue with, just face the room.
      f.steer = norm(
        madd(f.steer, sub(norm(wish, f.steer), f.steer), 1 - Math.exp(-dt * 4)),
        f.fwd,
      );
      turnToward(f, f.steer, dt, pitch, rate * 0.6);
      level(f, dt, 1.2);
    } else if (steer) {
      if (hold) front = false;
      wish = keepClear(f, wish, { front, reach });
      // Wishes change from step to step; the way it means to go follows them smoothly.
      const quick = t?.kind === "dart" ? 12 : t?.kind === "feed" ? 7 : 4;
      f.steer = norm(
        madd(f.steer, sub(norm(wish, f.steer), f.steer), 1 - Math.exp(-dt * quick)),
        f.fwd,
      );
      turnToward(f, f.steer, dt, pitch, rate);
      level(f, dt);
    } else if (t?.kind === "puff") {
      level(f, dt, 0.6);
    }

    // Small tetras swim in kicks: a quick beat of the tail, then a glide.
    let kicking = true;
    if (spec.swim === "kick" && speed > 0 && speed < spec.burst * 0.7) {
      f.kick = (f.kick + dt * (1.6 + f.tint * 0.8)) % 1;
      kicking = f.kick < 0.28;
      speed *= kicking ? 1.5 : 0.8;
    }
    if (t?.kind !== "cling" && !(t?.kind === "move" && !steer)) {
      const accel = speed > f.speed ? (speed > spec.cruise[1] * 1.5 ? 5 : 2) : 2.5;
      f.speed += (speed - f.speed) * (1 - Math.exp(-dt * accel));
      f.pos = madd(f.pos, f.fwd, f.speed * dt);
      contain(f, reach, front ? frontOf(f) : -(sideHalf(f) * 0.5 + 0.02));
    }

    // Getting nowhere while meaning to swim: pick somewhere else to go.
    if (time >= f.checkAt) {
      const roaming =
        t === null || t.kind === "feed" || (t.kind === "peek" && t.phase === "approach");
      const stalled = dist(f.pos, f.moved) < Math.max(0.12, f.len * 0.3);
      if (roaming && stalled && f.goal.hover <= 0 && !spec.roles.clinger) {
        f.way = -f.way;
        f.goal.next = 0;
        f.steer = norm([f.way, pick.range(-0.3, 0.3), pick.range(-0.6, -0.1)]);
        if (t?.kind === "feed" || t?.kind === "peek") f.task = null;
        if (f.shoal >= 0) shoals[f.shoal]!.next = 0;
      }
      f.moved = copy(f.pos);
      f.checkAt = time + 2.5;
    }

    const sp = Math.abs(f.speed);
    const beat = spec.beat + (spec.beatPerSpeed * sp) / f.len;
    f.phase = (f.phase + TAU * beat * (kicking ? 1 : 0.4) * dt) % TAU;
    const rowing = spec.swim === "fins" && sp < spec.cruise[1] * 1.4;
    f.fin = (f.fin + TAU * (rowing ? 2.4 : sp < f.len * 0.1 ? 2.6 : 1.4) * dt) % TAU;
    const cruise = spec.cruise[1] * 1.4;
    let wantAmp =
      f.puff > 0 ? 0.08 : t?.kind === "cling" ? 0.05 : clamp(0.18 + (1.1 * sp) / cruise, 0.15, 1.3);
    if (rowing) wantAmp = 0.1 + 0.15 * (sp / cruise);
    if (!kicking) wantAmp *= 0.35;
    if (!(t?.kind === "nap" && t.phase === "wiggle"))
      f.amp += (wantAmp - f.amp) * (1 - Math.exp(-dt * 3));
    f.bend += (clamp(-f.yaw * 0.35, -0.7, 0.7) - f.bend) * (1 - Math.exp(-dt * 5));
    f.gulp = Math.max(0, f.gulp - dt * 2.2);
    f.mouth += (Math.max(mouth, f.gulp) - f.mouth) * (1 - Math.exp(-dt * 12));
    if (spec.roles.feelers) {
      // Threads reach out to feel about now and then, and at whatever it is looking at.
      const idle = Math.max(0, Math.sin(time * 0.37 + f.tint * 11)) ** 6;
      f.wink += (Math.max(feel, idle) - f.wink) * (1 - Math.exp(-dt * 3));
    }
    const lookRate = f.species === "puffer" ? 0.5 : 0.2;
    f.look = Math.sin(time * lookRate + f.tint * 31) * (f.species === "puffer" ? 0.8 : 0.35);
    f.fear = Math.max(0, f.fear - dt / 2.5);
    f.hunger = Math.min(1, f.hunger + dt / HUNGER_BACK);
  };

  const stepShoals = (dt: number) => {
    for (const s of shoals) {
      s.next -= dt;
      const c = shoalCentre(s);
      const lead = s.members[0]!;
      if (s.next <= 0 || dist(c, s.goal) < 1) {
        if (pick.next() < 0.25) s.way = -s.way;
        s.next = pick.range(6, 14);
        const z = -pick.range(lead.spec.near[0] + 0.3, lead.spec.near[1]);
        const [x0, x1] = seenX(z, 1.6);
        let x = c[0] + s.way * pick.range(3, 7);
        if (x < x0 || x > x1) {
          s.way = -s.way;
          x = c[0] + s.way * pick.range(3, 7);
        }
        x = clamp(x, x0, x1);
        const [y0, y1] = zoneY(lead, x, z);
        s.goal = [x, pick.range(y0 + 0.2, Math.max(y0 + 0.25, y1 - 0.2)), z];
        s.cruise = pick.range(lead.spec.cruise[0], lead.spec.cruise[1]);
      }
    }
  };

  const stepShrimp = (s: Shrimp, dt: number) => {
    s.t += dt;
    s.legs = (s.legs + dt * (s.state === "walk" ? 9 : 2)) % TAU;
    s.claws = (s.claws + dt * (s.state === "pick" ? 7 : 1.5)) % TAU;
    if (s.state === "flick") {
      // A flick of the tail sends it shooting backwards in a little arc.
      const k = s.t / s.until;
      s.hop = Math.sin(Math.PI * clamp(k, 0, 1)) * 0.35;
      s.pos = madd(s.pos, s.heading, 2.4 * (1 - k) * dt);
      if (s.t > s.until) {
        s.state = "pick";
        s.t = 0;
        s.until = pick.range(2, 5);
        s.hop = 0;
      }
    } else {
      if (s.target && (s.target.eaten || !food.includes(s.target))) s.target = null;
      if (!s.target) {
        let best: Food | null = null;
        let bestD = 2.5;
        for (const k of food) {
          if (k.eaten || k.landed <= 0) continue;
          const d = dist(k.pos, s.pos);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        s.target = best;
      }
      if (s.target) {
        const to = sub(s.target.pos, s.pos);
        const d = Math.hypot(to[0], to[2]);
        if (d > 0.12) {
          s.state = "walk";
          s.heading = norm([to[0], 0, to[2]], s.heading);
          s.speed = 0.22;
        } else {
          s.state = "pick";
          s.speed = 0;
          if (s.t > 2.5) {
            s.target.eaten = true;
            s.target = null;
            s.t = 0;
          }
        }
      } else if (s.t > s.until) {
        s.t = 0;
        if (s.state === "pick") {
          s.state = "walk";
          s.until = pick.range(1.5, 4);
          s.heading = norm(rotate(s.heading, UP, pick.range(-1.5, 1.5)));
          s.speed = pick.range(0.08, 0.18);
        } else {
          s.state = "pick";
          s.until = pick.range(3, 8);
          s.speed = 0;
        }
      }
      if (s.state === "walk") {
        s.heading = norm(rotate(s.heading, UP, Math.sin(time * 0.7 + s.size * 40) * 0.6 * dt));
        s.pos = madd(s.pos, s.heading, s.speed * dt);
      }
      s.hop = Math.max(0, s.hop - dt);
    }
    // Keep to the ground near the front, where people see them.
    const [x0, x1] = seenX(s.pos[2], 0.8);
    if (s.pos[0] < x0 || s.pos[0] > x1 || s.pos[2] > -0.3 || s.pos[2] < -2.4) {
      s.heading = norm([(x0 + x1) / 2 - s.pos[0], 0, -1.1 - s.pos[2]]);
    }
    s.pos[0] = clamp(s.pos[0], x0, x1);
    s.pos[2] = clamp(s.pos[2], -2.6, -0.25);
    s.pos[1] = ground(s.pos[0], s.pos[2]) + s.hop;
    // Round stones and wood, never through them.
    for (const sol of layout.solids) {
      const hit = intoSolid(sol, [s.pos[0], s.pos[1] + 0.06, s.pos[2]], 0.12);
      if (hit.depth <= 0) continue;
      const flat = norm([hit.out[0], 0, hit.out[2]], [1, 0, 0]);
      s.pos = madd(s.pos, flat, hit.depth);
      const into = dot(s.heading, flat);
      if (into < 0) s.heading = norm(madd(s.heading, flat, -into * 1.1), flat);
    }
    s.pos[1] = ground(s.pos[0], s.pos[2]) + s.hop;
  };

  const stepSnail = (s: Snail, dt: number) => {
    s.wave = (s.wave + dt * 0.9) % 1;
    if (s.tuck > 0) {
      s.tuck = Math.max(0, s.tuck - dt / 6);
      s.mouth = 0;
      if (s.tuck > 0.4) return;
    }
    if (s.pause > 0) {
      s.pause -= dt;
      s.mouth = 0.5 + 0.5 * Math.sin(time * 5);
      return;
    }
    s.mouth = 0.25 + 0.25 * Math.sin(time * 5);
    s.turn += (pick.range(-1, 1) * 0.5 - s.turn) * dt * 0.5;
    s.heading += s.turn * dt;
    const [y0, y1] = snailBand(s.x);
    const [x0, x1] = seenX(0, 1);
    // Head back in near the edges of where it likes to be.
    const wantUp = s.y < y0 + 0.3 ? 1 : s.y > y1 - 0.3 ? -1 : 0;
    const wantSide = s.x < x0 + 0.3 ? 1 : s.x > x1 - 0.3 ? -1 : 0;
    if (wantUp || wantSide) {
      const want = Math.atan2(wantUp, wantSide || Math.cos(s.heading));
      let d = want - s.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.heading += clamp(d, -0.6 * dt, 0.6 * dt);
    }
    s.x = clamp(s.x + Math.cos(s.heading) * s.speed * dt, x0, x1);
    s.y = clamp(s.y + Math.sin(s.heading) * s.speed * dt, y0, y1);
    if (pick.next() < dt / 40) s.pause = pick.range(6, 20);
  };

  const step = (dt: number) => {
    time += dt;
    stepShoals(dt);
    if (feeding) stepFeeding(feeding);
    for (const tp of taps) if (!tp.sent && time >= tp.look) sendLookers(tp);
    while (taps.length > 0 && time - taps[0]!.at > 12) taps.shift();
    aimFood();
    for (const f of fish) stepFish(f, dt);
    for (const s of shrimp) stepShrimp(s, dt);
    for (const s of snails) stepSnail(s, dt);
    stepFood(dt);
    for (let i = habits.length - 1; i >= 0; i--) {
      const h = habits[i]!;
      if (!h.done && h !== feeding && h.actors.every((f) => f.habit !== h)) h.done = true;
      if (h.done) habits.splice(i, 1);
    }
    const plan = scheduler.next(time, {
      active: habits.filter((h) => h.kind !== "feed").length,
      feeding: feeding !== null,
      where,
    });
    if (plan && !start(plan)) scheduler.skipped(time);
  };

  return {
    get time() {
      return time;
    },
    fish,
    food,
    shrimp,
    snails,
    habits,
    taps,
    get feeding() {
      return feeding !== null;
    },
    counts,
    sideCounts,
    log,
    scheduler,
    layout,
    step,
    tap,
    sprinkle,
    lift(finger) {
      held.delete(finger);
    },
    sideOf,
    trigger(kind, side) {
      const s = side ?? (scheduler.served.indexOf(Math.min(...scheduler.served)) || 0);
      if (kind === "feed") return startFeed(s);
      if (feeding) return false;
      if (start({ kind, side: s })) return true;
      // The puffer mid-puff puffs up again from where it is.
      if (kind === "puff") {
        const p = fish.find((f) => f.task?.kind === "puff");
        if (p?.task?.kind === "puff") {
          if (p.task.phase !== "inflate")
            p.task = { kind: "puff", phase: "inflate", t: 0, hold: pick.range(4, 6) };
          return true;
        }
      }
      for (const h of habits) if (!h.done && h.kind !== "feed") cancel(h);
      for (const f of fish) {
        if (f.puff > 0 || f.spec.roles.clinger) continue;
        f.habit = null;
        if (f.task && f.task.kind !== "puff") f.task = null;
      }
      return start({ kind, side: s });
    },
    calm() {
      taps.length = 0;
      held.clear();
      for (const f of fish) {
        f.fear = 0;
        if (f.task?.kind === "peek" || f.task?.kind === "feed") f.task = rest(f);
      }
    },
  };
};
