/**
 * One pond: its fish, their swimming, and the life of the population (a Moran model). The pond
 * holds a steady number of fish. Every death (a heron's catch, old age, or a fish swimming away
 * to another pond) is replaced a second or two later by the young of a random survivor, whose
 * genes are its parent's with small random changes. Herons, people's taps and the floor decide
 * who dies early; nothing else favours anyone, so with herons off the pond only drifts.
 *
 * Positions are venue px of the frame. Time here is the pond's own seconds (`step` dt); births
 * and deaths are also stamped with `stamp()`, the room's shared clock in ms, for the family tree.
 * No DOM, so it runs headless in tests and on the screen.
 */
import type { Rng } from "../../core/types";
import {
  ATTRACT_FLOOR_S,
  BIRTH_MAX_S,
  BIRTH_MIN_S,
  HERON_AIM_S,
  HERON_EVERY,
  HERON_LOOKS,
  HERON_YIELD_S,
  type Herons,
  LIFE_MAX_S,
  LIFE_MIN_S,
  MIGRATE_EVERY_S,
  MIN_SHARE,
  MUTATION_SD,
  type Mutation,
  OVERFLOW,
  PANEL_FISH,
  PEOPLE_S,
  SEEK_AT,
  SEEK_MAX,
  SEEK_MIN,
  SNAP,
  SWEEP_S,
} from "./config";
import {
  FLOOR_GENES,
  FLOORS,
  type FloorId,
  type Genes,
  type Look,
  lookOf,
  mutate,
  randomGenes,
  standout,
} from "./genes";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PondSpec {
  /** Island index, unique across a bank (it prefixes fish ids). */
  island: number;
  /** Where fish swim, venue px. */
  box: Box;
  /** Fish the pond keeps. */
  target: number;
  /** Fish length, venue px. */
  fish: number;
  floor: FloorId;
}

export type FishState = "swim" | "leaving" | "dying";

export interface Fish {
  id: number;
  parent: number;
  /** Shared-clock ms. */
  born: number;
  genes: number[];
  look: Look;
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  ph: number;
  speed: number;
  /** Personal wander phase and pace. */
  w: number;
  pace: number;
  /** Seconds lived and the lifespan, pond time. */
  age: number;
  life: number;
  state: FishState;
  /** Leaving: -1 left, 1 right. Dying: seconds of fading left. */
  edge: -1 | 1;
  fade: number;
  /** Seconds left of coming in from an edge (edges don't push it back meanwhile). */
  arriving: number;
  /** Seconds before a migrant that just arrived may move on again. */
  stay: number;
  /** How much it stands out from the floor beneath it. */
  standout: number;
  /** Fleeing a strike: seconds left and where from. */
  flee: number;
  fx: number;
  fy: number;
}

export type Catcher = "person" | "bot" | "heron";

export type PondEvent =
  | { kind: "catch"; fish: Fish; by: Catcher }
  | { kind: "birth"; fish: Fish; parent: Fish | null }
  | { kind: "death"; fish: Fish }
  | { kind: "leave"; fish: Fish; edge: -1 | 1 }
  | { kind: "arrive"; fish: Fish; edge: -1 | 1 }
  | { kind: "floor"; floor: FloorId; x: number; ghost: boolean }
  | { kind: "miss"; x: number; y: number };

export interface Counts {
  caught: number;
  byHeron: number;
  born: number;
  died: number;
  left: number;
  arrived: number;
}

export interface Pond {
  spec: PondSpec;
  fish: Fish[];
  floor: FloorId;
  /** A floor change in progress: the old floor, where it started and its age in s. */
  sweep: { from: FloorId; x: number; t: number } | null;
  mutation: Mutation;
  herons: Herons;
  /** Seconds until each pending hatching. */
  births: number[];
  /** The fish an automatic heron has its eye on, and seconds until it strikes. */
  aim: Fish | null;
  aimT: number;
  heronT: number;
  /** Seconds since a person last caught here and last touched anything here. */
  peopleT: number;
  touchT: number;
  floorT: number;
  /** Seconds until a migrant leaves by each edge, and whether each edge leads anywhere. */
  migrateT: [number, number];
  open: [boolean, boolean];
  counts: Counts;
  events: PondEvent[];
  t: number;
}

const MAX_EVENTS = 128;
/** Swimming, venue px per s and rad per s. */
const CRUISE = 30;
const FLEE_SPEED = 170;
const TURN = 1.7;
const FLEE_S = 1.1;
const FLEE_PX = 300;
const YOUNG_S = 14;
/** Hatchlings are this big at first. */
export const HATCH_SIZE = 0.5;
const DYING_S = 1.6;
/** A migrant stays at least this long in the pond it reached, seconds. */
const STAY_S = 40;

const TWO_PI = Math.PI * 2;
const wrapAngle = (a: number) => {
  let x = a;
  while (x > Math.PI) x -= TWO_PI;
  while (x < -Math.PI) x += TWO_PI;
  return x;
};

export interface PondDeps {
  rng: Rng;
  /** Shared-clock ms, for birth and death stamps. */
  stamp(): number;
  /** A new fish id for this pond. */
  nextId(): number;
}

const push = (p: Pond, e: PondEvent) => {
  if (p.events.length >= MAX_EVENTS) p.events.shift();
  p.events.push(e);
};

/** Growth of a fish, 0.5 at hatching to 1. */
export const sizeOf = (f: Fish): number =>
  f.age >= YOUNG_S ? 1 : HATCH_SIZE + (1 - HATCH_SIZE) * (f.age / YOUNG_S);

export const createFish = (
  deps: PondDeps,
  rec: { id: number; parent: number; born: number; genes: number[] },
  at: { x: number; y: number; heading: number },
  age: number,
): Fish => {
  const rng = deps.rng;
  return {
    id: rec.id,
    parent: rec.parent,
    born: rec.born,
    genes: rec.genes,
    look: lookOf(rec.genes),
    x: at.x,
    y: at.y,
    px: at.x,
    py: at.y,
    heading: at.heading,
    ph: at.heading,
    speed: CRUISE,
    w: rng.next() * 100,
    pace: 0.8 + rng.next() * 0.45,
    age,
    life: LIFE_MIN_S + rng.next() * (LIFE_MAX_S - LIFE_MIN_S),
    state: "swim",
    edge: 1,
    fade: 0,
    arriving: 0,
    stay: 0,
    standout: 0,
    flee: 0,
    fx: 0,
    fy: 0,
  };
};

/** The floor at x: the new one where the sweep has reached, the old one elsewhere. */
export const floorAt = (p: Pond, x: number): FloorId => {
  const s = p.sweep;
  if (!s) return p.floor;
  const b = p.spec.box;
  const reach = Math.max(s.x - b.x, b.x + b.w - s.x);
  return Math.abs(x - s.x) <= (s.t / SWEEP_S) * reach ? p.floor : s.from;
};

const updateStandout = (p: Pond, f: Fish) => {
  f.standout = standout(f.genes, FLOOR_GENES[floorAt(p, f.x)]);
};

const randomSpot = (p: Pond, rng: Rng) => {
  const b = p.spec.box;
  const m = p.spec.fish * 0.6;
  return {
    x: b.x + m + rng.next() * Math.max(1, b.w - 2 * m),
    y: b.y + m + rng.next() * Math.max(1, b.h - 2 * m),
    heading: rng.next() * TWO_PI - Math.PI,
  };
};

/** A fresh, mixed population: every gene anywhere in its range, ages spread out. */
export const populate = (p: Pond, deps: PondDeps): void => {
  p.fish.length = 0;
  p.births.length = 0;
  p.aim = null;
  const now = deps.stamp();
  for (let i = 0; i < p.spec.target; i++) {
    const age = YOUNG_S + deps.rng.next() * (LIFE_MIN_S - YOUNG_S);
    const f = createFish(
      deps,
      { id: deps.nextId(), parent: 0, born: now - age * 1000, genes: randomGenes(deps.rng) },
      randomSpot(p, deps.rng),
      age,
    );
    updateStandout(p, f);
    p.fish.push(f);
    push(p, { kind: "birth", fish: f, parent: null });
  }
};

export const createPond = (
  spec: PondSpec,
  opts: { mutation: Mutation; herons: Herons },
  deps: PondDeps,
): Pond => {
  const rng = deps.rng;
  const p: Pond = {
    spec,
    fish: [],
    floor: spec.floor,
    sweep: null,
    mutation: opts.mutation,
    herons: opts.herons,
    births: [],
    aim: null,
    aimT: 0,
    heronT: HERON_EVERY[opts.herons] * (0.5 + rng.next()),
    peopleT: Infinity,
    touchT: Infinity,
    floorT: ATTRACT_FLOOR_S * (0.6 + rng.next() * 0.8),
    migrateT: [MIGRATE_EVERY_S * rng.range(0.5, 1.5), MIGRATE_EVERY_S * rng.range(0.5, 1.5)],
    open: [false, false],
    counts: { caught: 0, byHeron: 0, born: 0, died: 0, left: 0, arrived: 0 },
    events: [],
    t: 0,
  };
  populate(p, deps);
  return p;
};

/** Fish that count for the pond's population (not fading or swimming away). */
export const resident = (p: Pond): number => {
  let n = 0;
  for (const f of p.fish) if (f.state === "swim") n++;
  return n;
};

const catchable = (f: Fish) => f.state === "swim" && f.arriving <= 0;

const remove = (p: Pond, f: Fish) => {
  const i = p.fish.indexOf(f);
  if (i >= 0) p.fish.splice(i, 1);
  if (p.aim === f) p.aim = null;
};

/** Startle fish near a strike so they dart away. */
const scatter = (p: Pond, x: number, y: number) => {
  for (const f of p.fish) {
    if (Math.hypot(f.x - x, f.y - y) < FLEE_PX) {
      f.flee = FLEE_S;
      f.fx = x;
      f.fy = y;
    }
  }
};

export const take = (p: Pond, f: Fish, by: Catcher): void => {
  remove(p, f);
  p.counts.caught++;
  if (by === "heron") p.counts.byHeron++;
  push(p, { kind: "catch", fish: f, by });
  scatter(p, f.x, f.y);
};

/**
 * A tap at (x, y): catch the nearest catchable fish within the snap distance. Refused (a splash)
 * while the pond is low on fish, so a crowd can't empty it.
 */
export const catchNear = (p: Pond, x: number, y: number, by: Catcher): Fish | null => {
  let best: Fish | null = null;
  let bestD = SNAP;
  for (const f of p.fish) {
    if (!catchable(f)) continue;
    const d = Math.hypot(f.x - x, f.y - y);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  if (by !== "heron") {
    p.touchT = 0;
    if (by === "person") p.peopleT = 0;
  }
  if (!best) return null;
  if (resident(p) <= Math.ceil(p.spec.target * MIN_SHARE)) {
    scatter(p, x, y);
    push(p, { kind: "miss", x, y });
    return null;
  }
  take(p, best, by);
  return best;
};

/**
 * Start sweeping a new floor across the pond from `x`. A change during a sweep finishes the
 * earlier sweep at once and starts the new one from there.
 */
export const setFloor = (p: Pond, floor: FloorId, x: number, ghost = false): boolean => {
  if (floor === p.floor) return false;
  const b = p.spec.box;
  p.sweep = { from: p.floor, x: Math.min(b.x + b.w, Math.max(b.x, x)), t: 0 };
  p.floor = floor;
  push(p, { kind: "floor", floor, x, ghost });
  return true;
};

/** A migrant arrives at an edge: placed just outside it, heading in. */
export const arrive = (p: Pond, f: Fish, edge: -1 | 1, yFrac: number): void => {
  const b = p.spec.box;
  f.x = edge < 0 ? b.x - p.spec.fish * 0.4 : b.x + b.w + p.spec.fish * 0.4;
  f.y =
    b.y +
    p.spec.fish * 0.6 +
    Math.min(1, Math.max(0, yFrac)) * Math.max(1, b.h - p.spec.fish * 1.2);
  f.px = f.x;
  f.py = f.y;
  f.heading = edge < 0 ? 0 : Math.PI;
  f.ph = f.heading;
  f.state = "swim";
  f.arriving = 2;
  f.stay = STAY_S;
  f.flee = 0;
  updateStandout(p, f);
  p.fish.push(f);
  p.counts.arrived++;
  push(p, { kind: "arrive", fish: f, edge });
};

/** Turn a leaving fish back (nobody there to receive it). */
export const turnBack = (p: Pond, f: Fish): void => {
  const b = p.spec.box;
  f.state = "swim";
  f.x = Math.min(b.x + b.w, Math.max(b.x, f.x));
  f.px = f.x;
  f.heading = wrapAngle(f.heading + Math.PI);
  f.arriving = 1.5;
  if (!p.fish.includes(f)) p.fish.push(f);
};

const hatch = (p: Pond, deps: PondDeps) => {
  const rng = deps.rng;
  const parents = p.fish.filter((f) => f.state === "swim" && f.arriving <= 0);
  const parent = parents.length > 0 ? rng.pick(parents) : null;
  const genes = parent ? mutate(parent.genes, MUTATION_SD[p.mutation], rng) : randomGenes(rng);
  const b = p.spec.box;
  const m = p.spec.fish * 0.5;
  const at = parent
    ? {
        x: Math.min(b.x + b.w - m, Math.max(b.x + m, parent.x - Math.cos(parent.heading) * m)),
        y: Math.min(b.y + b.h - m, Math.max(b.y + m, parent.y - Math.sin(parent.heading) * m)),
        heading: parent.heading + rng.range(-1.2, 1.2),
      }
    : randomSpot(p, rng);
  const f = createFish(
    deps,
    { id: deps.nextId(), parent: parent?.id ?? 0, born: deps.stamp(), genes },
    at,
    0,
  );
  updateStandout(p, f);
  p.fish.push(f);
  p.counts.born++;
  push(p, { kind: "birth", fish: f, parent });
};

/** An automatic heron picks the fish that stands out most among a few it looks at. */
export const heronChoice = (p: Pond, rng: Rng): Fish | null => {
  const pool = p.fish.filter(catchable);
  if (pool.length === 0) return null;
  let best: Fish | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(HERON_LOOKS, pool.length); i++) {
    const f = rng.pick(pool);
    const score = f.standout + rng.next() * 0.15;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
};

const stepHeron = (p: Pond, dt: number, deps: PondDeps) => {
  if (p.aim) {
    p.aimT -= dt;
    if (!p.fish.includes(p.aim) || !catchable(p.aim)) {
      p.aim = null;
    } else if (p.aimT <= 0) {
      const f = p.aim;
      p.aim = null;
      if (resident(p) > Math.ceil(p.spec.target * MIN_SHARE)) take(p, f, "heron");
    }
    return;
  }
  if (p.herons === "off" || p.peopleT < HERON_YIELD_S) return;
  p.heronT -= dt;
  if (p.heronT > 0) return;
  const f = heronChoice(p, deps.rng);
  // A heron finds a fish that stands out quickly and a hidden one slowly.
  const seen = f
    ? Math.min(SEEK_MAX, Math.max(SEEK_MIN, (SEEK_AT / Math.max(0.05, f.standout)) ** 2))
    : 1;
  const crowd = PANEL_FISH / Math.max(1, p.spec.target);
  p.heronT = HERON_EVERY[p.herons] * seen * crowd * deps.rng.range(0.6, 1.4);
  if (f) {
    p.aim = f;
    p.aimT = HERON_AIM_S;
  }
};

const stepLife = (p: Pond, dt: number, deps: PondDeps) => {
  for (let i = p.fish.length - 1; i >= 0; i--) {
    const f = p.fish[i]!;
    f.age += dt;
    if (f.stay > 0) f.stay -= dt;
    if (f.state === "dying") {
      f.fade -= dt;
      if (f.fade <= 0) {
        p.fish.splice(i, 1);
        push(p, { kind: "death", fish: f });
      }
    } else if (f.state === "swim" && f.age >= f.life) {
      f.state = "dying";
      f.fade = DYING_S;
      p.counts.died++;
      if (p.aim === f) p.aim = null;
    }
  }
  for (let i = p.births.length - 1; i >= 0; i--) {
    p.births[i]! -= dt;
    if (p.births[i]! <= 0) {
      p.births.splice(i, 1);
      if (resident(p) < p.spec.target + OVERFLOW) hatch(p, deps);
    }
  }
  while (resident(p) + p.births.length < p.spec.target) {
    p.births.push(deps.rng.range(BIRTH_MIN_S, BIRTH_MAX_S));
  }
};

const stepMigration = (p: Pond, dt: number, deps: PondDeps) => {
  for (const side of [0, 1] as const) {
    if (!p.open[side]) continue;
    p.migrateT[side] -= dt;
    if (p.migrateT[side] > 0) continue;
    p.migrateT[side] = MIGRATE_EVERY_S * deps.rng.range(0.5, 1.5);
    const edge = side === 0 ? -1 : 1;
    const pool = p.fish.filter(
      (f) => catchable(f) && f !== p.aim && f.age > YOUNG_S && f.stay <= 0,
    );
    if (pool.length < p.spec.target * 0.6) continue;
    // Prefer one already near that edge, so it doesn't cross the whole pond.
    const b = p.spec.box;
    const edgeX = edge < 0 ? b.x : b.x + b.w;
    pool.sort((a, c) => Math.abs(a.x - edgeX) - Math.abs(c.x - edgeX));
    const f = pool[deps.rng.int(Math.min(4, pool.length))]!;
    f.state = "leaving";
    f.edge = edge;
  }
};

const stepFloor = (p: Pond, dt: number, deps: PondDeps) => {
  if (p.sweep) {
    p.sweep.t += dt;
    if (p.sweep.t >= SWEEP_S) p.sweep = null;
  }
  if (p.touchT < PEOPLE_S) return;
  p.floorT -= dt;
  if (p.floorT > 0) return;
  p.floorT = ATTRACT_FLOOR_S * deps.rng.range(0.75, 1.25);
  const others = FLOORS.filter((f) => f !== p.floor);
  const b = p.spec.box;
  setFloor(p, deps.rng.pick(others), b.x + b.w * deps.rng.range(0.2, 0.8), true);
};

/** Steering: wander, keep apart, school loosely, keep off the edges, dart from strikes. */
const steer = (p: Pond, dt: number) => {
  const b = p.spec.box;
  const len = p.spec.fish;
  const sep = len * 0.95;
  const school = len * 2.6;
  const margin = len * 0.8;
  const t = p.t;
  for (const f of p.fish) {
    f.px = f.x;
    f.py = f.y;
    f.ph = f.heading;
    if (f.state === "dying") continue;
    let dx = Math.cos(f.heading);
    let dy = Math.sin(f.heading);
    // Wander: a slow, personal sway left and right.
    const wob = Math.sin(t * 0.37 * f.pace + f.w) + 0.6 * Math.sin(t * 0.91 * f.pace + f.w * 1.7);
    dx += -Math.sin(f.heading) * wob * 0.55;
    dy += Math.cos(f.heading) * wob * 0.55;
    let ax = 0;
    let ay = 0;
    let n = 0;
    let cx = 0;
    let cy = 0;
    for (const o of p.fish) {
      if (o === f || o.state === "dying") continue;
      const ox = f.x - o.x;
      const oy = f.y - o.y;
      const d2 = ox * ox + oy * oy;
      if (d2 > school * school) continue;
      const d = Math.sqrt(d2) || 1;
      if (d < sep) {
        const k = (sep - d) / sep;
        dx += (ox / d) * k * 2.2;
        dy += (oy / d) * k * 2.2;
      }
      ax += Math.cos(o.heading);
      ay += Math.sin(o.heading);
      cx += o.x;
      cy += o.y;
      n++;
    }
    if (n > 0) {
      dx += (ax / n) * 0.3;
      dy += (ay / n) * 0.3;
      const tx = cx / n - f.x;
      const ty = cy / n - f.y;
      const td = Math.hypot(tx, ty) || 1;
      dx += (tx / td) * 0.12;
      dy += (ty / td) * 0.12;
    }
    if (f.state === "leaving") {
      dx += f.edge * 3;
    } else {
      const inX = f.arriving > 0;
      if (!inX && f.x < b.x + margin) dx += ((b.x + margin - f.x) / margin) * 2.5;
      if (!inX && f.x > b.x + b.w - margin) dx -= ((f.x - (b.x + b.w - margin)) / margin) * 2.5;
      if (f.y < b.y + margin) dy += ((b.y + margin - f.y) / margin) * 2.5;
      if (f.y > b.y + b.h - margin) dy -= ((f.y - (b.y + b.h - margin)) / margin) * 2.5;
    }
    let speed = CRUISE * f.pace;
    if (f.flee > 0) {
      f.flee -= dt;
      const ox = f.x - f.fx;
      const oy = f.y - f.fy;
      const d = Math.hypot(ox, oy) || 1;
      dx += (ox / d) * 3;
      dy += (oy / d) * 3;
      speed = FLEE_SPEED * Math.max(0.3, f.flee / FLEE_S);
    }
    if (f.state === "leaving") speed = Math.max(speed, CRUISE * 1.6);
    if (f.arriving > 0) f.arriving -= dt;
    const want = Math.atan2(dy, dx);
    const turn = wrapAngle(want - f.heading);
    const max = (f.flee > 0 ? TURN * 2.5 : TURN) * dt;
    f.heading = wrapAngle(f.heading + Math.max(-max, Math.min(max, turn)));
    f.speed += (speed - f.speed) * Math.min(1, dt * 3);
    const s = sizeOf(f);
    f.x += Math.cos(f.heading) * f.speed * dt * (0.6 + 0.4 * s);
    f.y += Math.sin(f.heading) * f.speed * dt * (0.6 + 0.4 * s);
    const m = len * 0.3;
    f.y = Math.min(b.y + b.h - m, Math.max(b.y + m, f.y));
    if (f.state !== "leaving" && f.arriving <= 0) {
      f.x = Math.min(b.x + b.w - m, Math.max(b.x + m, f.x));
    }
  }
};

/** Headless ponds skip swimming, but migrants still cross the edge and arrivals still come in. */
const drift = (p: Pond, dt: number) => {
  const b = p.spec.box;
  for (const f of p.fish) {
    if (f.state === "leaving") {
      f.x += f.edge * CRUISE * 2 * dt;
    } else if (f.arriving > 0) {
      f.arriving -= dt;
      const m = p.spec.fish * 0.6;
      f.x = Math.min(
        b.x + b.w - m,
        Math.max(b.x + m, f.x + (f.x < b.x + b.w / 2 ? 1 : -1) * CRUISE * 2 * dt),
      );
    }
  }
};

/** Fish swimming past an edge as migrants: taken out of the pond, for the caller to hand on. */
const stepLeaving = (p: Pond) => {
  const b = p.spec.box;
  const out = p.spec.fish * 0.6;
  for (let i = p.fish.length - 1; i >= 0; i--) {
    const f = p.fish[i]!;
    if (f.state !== "leaving") continue;
    if (f.edge < 0 ? f.x < b.x - out : f.x > b.x + b.w + out) {
      p.fish.splice(i, 1);
      p.counts.left++;
      push(p, { kind: "leave", fish: f, edge: f.edge });
    } else if (!p.open[f.edge < 0 ? 0 : 1]) {
      turnBack(p, f);
    }
  }
};

export interface StepOpts {
  /** Move the fish (off for headless ponds that nobody sees). */
  swim?: boolean;
}

export const stepPond = (p: Pond, dt: number, deps: PondDeps, opts: StepOpts = {}): void => {
  p.t += dt;
  p.peopleT += dt;
  p.touchT += dt;
  stepFloor(p, dt, deps);
  if (opts.swim !== false) steer(p, dt);
  else drift(p, dt);
  for (const f of p.fish) if (f.state !== "dying") updateStandout(p, f);
  stepLeaving(p);
  stepLife(p, dt, deps);
  stepHeron(p, dt, deps);
  stepMigration(p, dt, deps);
};

/** Mean standout of the pond's swimming fish (0 is perfectly hidden). */
export const meanStandout = (p: Pond): number => {
  let s = 0;
  let n = 0;
  for (const f of p.fish) {
    if (f.state !== "swim") continue;
    s += f.standout;
    n++;
  }
  return n > 0 ? s / n : 0;
};

export const genesOf = (p: Pond): Genes[] =>
  p.fish.filter((f) => f.state === "swim").map((f) => f.genes);
