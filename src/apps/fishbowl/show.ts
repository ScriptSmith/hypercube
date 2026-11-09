/**
 * Everything that moves in the bowl, as plain data stepped at a fixed rate: the fish and their
 * steering, their habits, the snails on the glass and the food at feeding time. Deterministic
 * from its random stream, so a run can be replayed and tested without drawing anything.
 *
 * Fish steer by adding up wishes (wander round the bowl near the glass, keep inside the water,
 * keep apart, school, keep clear of the plants) into one direction they turn towards at their
 * own pace. A habit takes a fish over for a while with wishes of its own. Hard limits after
 * each step keep every fish inside the water whatever the wishes said.
 */
import { DEG, direction, latLonOf } from "../../core/sphere";
import type { Rng } from "../../core/types";
import { GRAVEL_TOP, gravelHeight, sideCentre, sideOf, surfaceRadius } from "./bowl";
import { createScheduler, type HabitKind, HABITS, type Plan, type Scheduler } from "./habits";
import { obstaclesOf, type Scenery } from "./scenery";
import {
  castOf,
  FAUNA,
  SPECIES,
  snailsOf,
  type Species,
  type SpeciesId,
  type Stock,
} from "./species";
import {
  across,
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
/** Inner edge of the shell the fish keep to, so they stay where every viewer sees them right. */
export const INNER = 0.55;
/** Most flakes in the water at once. */
export const MAX_FLAKES = 24;
/** Flakes a feeding drops. */
const FEED_FLAKES = 20;
/** Flakes each kind eats before it has had enough; the rest sink for the catfish. */
const APPETITE: Record<SpeciesId, number> = {
  goldfish: 3,
  fancy: 3,
  tetra: 1,
  cory: 4,
  puffer: 2,
  harlequin: 1,
  angel: 3,
  gourami: 3,
  pleco: 3,
};
/** Most habits remembered for the debug log. */
const LOG = 64;

type Task =
  | {
      kind: "kiss";
      phase: "approach" | "align" | "hold" | "back";
      t: number;
      dir: V3;
      hold: number;
    }
  | { kind: "flee"; from: Fish; t: number; until: number; round: number }
  | { kind: "pursue"; target: Fish; t: number; until: number; nipped: number }
  | { kind: "loop"; phase: "approach" | "loop"; t: number; at: V3; turned: number; round: number }
  | { kind: "dart"; dir: V3; t: number; until: number; speed: number }
  | { kind: "startle"; target: Fish; t: number }
  | { kind: "puff"; phase: "wait" | "inflate" | "hold" | "deflate"; t: number; hold: number }
  | { kind: "nap"; phase: "approach" | "rest" | "wiggle"; t: number; at: V3; rest: number }
  | { kind: "feed"; target: Flake | null }
  | { kind: "graze" };

export interface Fish {
  readonly id: number;
  readonly species: SpeciesId;
  readonly spec: Species;
  /** Nose to tail tip, bowl radii. */
  readonly len: number;
  pos: V3;
  /** Unit heading and the unit up of its back, always square to each other. */
  fwd: V3;
  up: V3;
  speed: number;
  /** Turning rate about its own up, radians a second, smoothed. */
  yaw: number;
  /** Swimming wave's phase, its strength, and the body's bend into a turn. */
  phase: number;
  amp: number;
  bend: number;
  /** Fin flutter phase. */
  fin: number;
  /** 0 closed to 1 wide. */
  mouth: number;
  /** 0 slim to 1 a ball (the puffer). */
  puff: number;
  /** 0 to 1, eyes rolled down (the cory's wink). */
  wink: number;
  /** Where the eyes look, -1 back to 1 forward. */
  look: number;
  /** A fixed per-fish number for small differences in look. */
  readonly tint: number;
  task: Task | null;
  /** Going round the bowl one way (1) or the other (-1). */
  round: number;
  wander: { yaw: number; depth: number; next: number; hover: number; cruise: number };
  /** The habit it is part of, if any. */
  habit: Habit | null;
  gulp: number;
  /** Flakes eaten this feeding. */
  ate: number;
}

export interface Snail {
  /** Unit direction of the sole on the glass, and the unit heading along the glass. */
  u: V3;
  heading: V3;
  speed: number;
  pause: number;
  turn: number;
  /** The radula rasping on the glass, 0 to 1. */
  mouth: number;
  /** Phase of the waves running along its foot. */
  wave: number;
  size: number;
}

export interface Flake {
  pos: V3;
  drift: V3;
  /** Seconds it floats on the surface before it soaks and sinks. */
  float: number;
  sink: number;
  spin: number;
  angle: number;
  age: number;
  /** Seconds lying on the gravel. */
  landed: number;
  tone: number;
  eaten: boolean;
}

export interface Habit {
  readonly kind: HabitKind;
  readonly side: number;
  readonly start: number;
  readonly actors: Fish[];
  /** Where it happens, for the side check. */
  where: V3;
  done: boolean;
  /** Feeding only. */
  spot?: V3;
  spawned?: number;
  ate?: number;
}

export interface ShowOptions {
  stock: Stock;
  /** "bowl" for the goldfish bowl's cast, "community" for tropical fish. */
  variant?: string;
  feeding: boolean;
  /** Height of the water's surface. */
  water: number;
  /** Band people see well, latitudes in radians. */
  view: { top: number; bottom: number };
}

export interface LogEntry {
  kind: HabitKind;
  side: number;
  t: number;
}

export interface Show {
  readonly time: number;
  readonly fish: readonly Fish[];
  readonly snails: readonly Snail[];
  readonly flakes: readonly Flake[];
  readonly habits: readonly Habit[];
  readonly feeding: boolean;
  readonly water: number;
  readonly counts: Record<HabitKind, number>;
  readonly sideCounts: number[];
  readonly log: readonly LogEntry[];
  readonly scheduler: Scheduler;
  step(dt: number): void;
  /** Start a habit now, ending whatever its actors were doing. False when it can't. */
  trigger(kind: HabitKind, side?: number): boolean;
  setView(water: number, view: { top: number; bottom: number }): void;
}

const ease = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

/** Unit direction round the bowl's axis at `p`, going one way or the other. */
const roundDir = (p: V3, way: number): V3 => norm(scale(cross(UP, p), way), [1, 0, 0]);

const horizontal = (v: V3): V3 => norm([v[0], 0, v[2]], [1, 0, 0]);

export const createShow = (rng: Rng, scenery: Scenery, opts: ShowOptions): Show => {
  let water = opts.water;
  let view = { ...opts.view };
  const obstacles = obstaclesOf(scenery);
  const scheduler = createScheduler(rng.fork("habits"), { feeding: opts.feeding });
  const pick = rng.fork("choices");
  const counts = Object.fromEntries(HABITS.map((k) => [k, 0])) as Record<HabitKind, number>;
  const sideCounts = [0, 0, 0];
  const log: LogEntry[] = [];
  const habits: Habit[] = [];
  const flakes: Flake[] = [];
  let time = 0;
  let feeding: Habit | null = null;

  // Lowest and highest a fish's centre may be, for its height above and below it.
  const topOf = (f: Fish, reach = 0) => water - 0.05 + reach - f.spec.halfHeight * f.len;
  const bottomOf = (f: Fish, p: V3) =>
    gravelHeight(Math.hypot(p[0], p[2])) + 0.03 + f.spec.halfHeight * f.len * (f.puff > 0 ? 2 : 1);
  /** Farthest from the centre a fish's middle may be when swimming along the glass. */
  const outerOf = (f: Fish) => 0.935 - f.spec.halfWidth * f.len * (1 + f.puff);

  const placeFish = (spec: Species, i: number): V3 => {
    const place = rng.fork(`place-${i}`);
    for (let k = 0; k < 40; k++) {
      const lon = place.range(-Math.PI, Math.PI);
      const y = place.range(spec.depth[0], Math.min(spec.depth[1], water - 0.2));
      const r = Math.min(spec.radius, 0.92 - spec.halfWidth * spec.length);
      const h = Math.sqrt(Math.max(0.01, r * r - y * y));
      const p: V3 = [h * Math.sin(lon), y, h * Math.cos(lon)];
      if (fish.every((g) => dist(g.pos, p) > (g.len + spec.length) * 0.6)) return p;
    }
    return [0, 0, spec.radius];
  };

  const fish: Fish[] = [];
  castOf(opts.stock, opts.variant).forEach((id, i) => {
    const spec = SPECIES[id];
    const own = rng.fork(`fish-${i}`);
    const size = own.range(0.92, 1.08);
    const pos = placeFish(spec, i);
    const way = own.next() < 0.5 ? -1 : 1;
    fish.push({
      id: i,
      species: id,
      spec,
      len: spec.length * size,
      pos,
      fwd: roundDir(pos, way),
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
      task: FAUNA[id].roles.bottom ? { kind: "graze" } : null,
      round: way,
      wander: {
        yaw: 0,
        depth: own.range(spec.depth[0], spec.depth[1]),
        next: own.range(2, 8),
        hover: 0,
        cruise: own.range(spec.cruise[0], spec.cruise[1]),
      },
      habit: null,
      gulp: 0,
      ate: 0,
    });
  });
  // Shoals: one for each kind that shoals in open water (tetras, harlequins).
  const schools = [...new Set(fish.map((f) => f.species))]
    .filter((id) => FAUNA[id].shoal && !FAUNA[id].roles.bottom)
    .map((id) => ({
      species: id,
      members: fish.filter((f) => f.species === id),
      way: 1,
      depth: -0.1,
      next: 10,
      cruise: 0.13,
    }));
  type School = (typeof schools)[number];
  const schoolOf = (f: Fish): School | undefined => schools.find((sc) => sc.species === f.species);
  const bottom = (f: Fish) => Boolean(FAUNA[f.species].roles.bottom);
  const rest = (f: Fish): Task | null => (bottom(f) ? { kind: "graze" } : null);

  const snails: Snail[] = Array.from({ length: snailsOf(opts.stock) }, (_, i) => {
    const own = rng.fork(`snail-${i}`);
    const u = copy(direction(own.range(-30, 10) * DEG, own.range(-Math.PI, Math.PI)) as V3);
    return {
      u,
      heading: norm(across(own.next() < 0.5 ? UP : [0, -1, 0], u)),
      speed: 0.008,
      pause: own.range(5, 20),
      turn: 0,
      mouth: 0,
      wave: 0,
      size: own.range(0.13, 0.15),
    };
  });

  const free = (f: Fish) => f.habit === null && f.task?.kind !== "kiss" && f.puff === 0;

  // ---- Steering --------------------------------------------------------------------------

  /** The ordinary wishes: go round near the glass at a chosen height, meandering. */
  const wander = (f: Fish, dt: number): { dir: V3; speed: number } => {
    const w = f.wander;
    w.next -= dt;
    if (w.next <= 0) {
      w.next = pick.range(3, 9);
      w.yaw = pick.range(-0.65, 0.65);
      w.depth = pick.range(f.spec.depth[0], Math.min(f.spec.depth[1], topOf(f) - 0.05));
      w.cruise = pick.range(f.spec.cruise[0], f.spec.cruise[1]);
      // Now and then turn round and go the other way.
      if (pick.next() < 0.12) f.round = -f.round;
      // The puffer hangs in the water and looks about; others pause now and then too.
      const hover =
        f.species === "puffer"
          ? 0.45
          : f.species === "fancy"
            ? 0.15
            : FAUNA[f.species].swim === "fins"
              ? 0.25
              : 0.06;
      w.hover = pick.next() < hover ? pick.range(1.5, 4) : 0;
    }
    let way = f.round;
    let depth = w.depth;
    const school = schoolOf(f);
    if (school) {
      way = school.way;
      depth = school.depth + (f.tint - 0.5) * 0.12;
      w.cruise = school.cruise * (0.95 + f.tint * 0.1);
    }
    const round = rotate(roundDir(f.pos, way), UP, w.yaw);
    const r = len(f.pos);
    const dir: V3 = [round[0], clamp((depth - f.pos[1]) * 1.6, -0.35, 0.35), round[2]];
    // Keep to the liked distance from the centre, so they patrol near the glass.
    const out = norm(f.pos);
    const toward = madd(dir, out, -(r - f.spec.radius) * 2.5);
    let speed = w.cruise;
    if (w.hover > 0) {
      w.hover -= dt;
      speed = 0.012;
    }
    return { dir: toward, speed };
  };

  /** Keep the fish inside the water, off the gravel, clear of the plants and of each other. */
  const keepClear = (f: Fish, wish: V3, opts: { glass: boolean; reach: number }): V3 => {
    let w = wish;
    const ahead = madd(f.pos, f.fwd, 0.08 + f.speed * 0.9 + f.len * 0.4);
    if (opts.glass) {
      const lim = outerOf(f);
      const ra = len(ahead);
      if (ra > lim) w = madd(w, norm(ahead), -(ra - lim) * 14);
      const r = len(f.pos);
      if (r < INNER) w = madd(w, norm(f.pos), (INNER - r) * 4);
    }
    const top = topOf(f, opts.reach);
    if (ahead[1] > top) w = madd(w, UP, -(ahead[1] - top) * 12);
    const bottom = bottomOf(f, ahead);
    if (ahead[1] < bottom) w = madd(w, UP, (bottom - ahead[1]) * 12);
    for (const o of obstacles) {
      if (f.pos[1] > o.top + 0.04) continue;
      const dx = ahead[0] - o.x;
      const dz = ahead[2] - o.z;
      const d = Math.hypot(dx, dz);
      // Clumps spread out above narrow bases, so low fish can nose between them.
      const base = gravelHeight(Math.hypot(o.x, o.z));
      const spread = 0.4 + 0.6 * clamp((f.pos[1] - base) / Math.max(0.05, o.top - base), 0, 1);
      const room = o.radius * spread + f.len * 0.4 + 0.03;
      if (d < room && d > 1e-6) {
        w = madd(w, [dx / d, 0, dz / d], ((room - d) / room) * 3);
        w = madd(w, UP, ((room - d) / room) * 1.2);
      }
    }
    for (const g of fish) {
      if (g === f) continue;
      const d = sub(f.pos, g.pos);
      const dd = len(d);
      const tetraPair = f.species === g.species && schoolOf(f) !== undefined;
      const room = (f.len + g.len) * (tetraPair ? 0.42 : 0.62);
      if (dd < room && dd > 1e-6) {
        // Small fish give way to big ones more than the other way round.
        const shy = g.len > f.len * 1.5 ? 2 : g.len * 1.5 < f.len ? 0.5 : 1;
        w = madd(w, d, ((room - dd) / (room * dd)) * 2.4 * shy);
      }
    }
    return w;
  };

  const schoolWish = (f: Fish): V3 => {
    let centre = v3();
    let heading = v3();
    let n = 0;
    for (const g of schoolOf(f)?.members ?? []) {
      if (g === f || g.habit) continue;
      centre = add(centre, g.pos);
      heading = add(heading, g.fwd);
      n++;
    }
    if (n === 0) return v3();
    centre = scale(centre, 1 / n);
    const toCentre = sub(centre, f.pos);
    const d = len(toCentre);
    return add(scale(norm(heading), 0.9), scale(norm(toCentre), clamp((d - 0.12) * 4, 0, 2)));
  };

  const turnToward = (f: Fish, wish: V3, dt: number, pitch: number, rate: number) => {
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

  /** Bring the back upright again, leaning a little into turns. */
  const level = (f: Fish, dt: number, rate = 2.5) => {
    let want = across(UP, f.fwd);
    want = len(want) > 1e-4 ? norm(want) : copy(f.up);
    want = rotate(want, f.fwd, clamp(-f.yaw * 0.2, -0.35, 0.35));
    f.up = norm(across(norm(madd(f.up, want, 1 - Math.exp(-dt * rate))), f.fwd), want);
  };

  /** Hard limits: whatever the wishes, the fish stays in the water and off the glass. */
  const contain = (f: Fish, reach: number) => {
    const nose = madd(f.pos, f.fwd, f.len * 0.5);
    const tail = madd(f.pos, f.fwd, -f.len * 0.5);
    for (const tip of [nose, tail]) {
      const r = len(tip);
      if (r > 0.97) f.pos = madd(f.pos, norm(tip), -(r - 0.97));
    }
    const hard = outerOf(f) + 0.03;
    const r = len(f.pos);
    if (r > hard) f.pos = scale(f.pos, hard / r);
    const top = topOf(f, reach) + 0.02;
    if (f.pos[1] > top) f.pos[1] = top;
    const bottom = bottomOf(f, f.pos) - 0.015;
    if (f.pos[1] < bottom) f.pos[1] = bottom;
  };

  // ---- Habits ------------------------------------------------------------------------------

  const begin = (plan: Plan, actors: Fish[], where: V3): Habit => {
    const h: Habit = { kind: plan.kind, side: plan.side, start: time, actors, where, done: false };
    for (const f of actors) f.habit = h;
    habits.push(h);
    counts[plan.kind]++;
    sideCounts[plan.side] = (sideCounts[plan.side] ?? 0) + 1;
    log.push({ kind: plan.kind, side: plan.side, t: time });
    if (log.length > LOG) log.shift();
    scheduler.started(plan, time);
    return h;
  };

  const finish = (h: Habit) => {
    h.done = true;
    for (const f of h.actors) {
      // Fish that have moved on to something else (feeding) keep what they are doing.
      if (f.habit !== h) continue;
      f.habit = null;
      if (f.task && f.task.kind !== "puff") f.task = rest(f);
    }
  };

  /** End a fish's part in a habit of `kind`, and the habit with it. */
  const done = (f: Fish, kind: HabitKind) => {
    f.task = rest(f);
    if (f.habit?.kind === kind) finish(f.habit);
  };

  /** Stop a habit now, letting a puffed fish go down slowly and a kissing one back off. */
  const cancel = (h: Habit) => {
    for (const f of h.actors) {
      if (f.task?.kind === "kiss" && f.task.phase !== "back") {
        f.task = { ...f.task, phase: "back", t: 0 };
        continue;
      }
      if (f.task?.kind === "puff" && f.puff > 0) {
        f.task = { kind: "puff", phase: "deflate", t: 0, hold: 0 };
        continue;
      }
      if (f.task?.kind === "nap" && f.task.phase !== "wiggle") {
        f.task = { ...f.task, phase: "wiggle", t: 0 };
        continue;
      }
      f.task = rest(f);
      if (f.habit === h) f.habit = null;
    }
    h.done = true;
  };

  const lonOf = (p: V3) => latLonOf(p).lon;
  const sideAt = (p: V3) => sideOf(lonOf(p));

  /** The fish that come to the glass and chase each other (goldfish, angelfish, gouramis). */
  const goldfish = () => fish.filter((f) => FAUNA[f.species].roles.kiss);
  const freeOf = (list: Fish[]) => list.filter(free);
  const nearestTo = (list: Fish[], p: V3) =>
    list.reduce<Fish | null>((b, f) => (!b || dist(f.pos, p) < dist(b.pos, p) ? f : b), null);

  /** A latitude in the band people see best, for things to happen at the glass. */
  const glassLat = (lo: number, hi: number) => {
    const top = Math.min(hi, view.top - 12 * DEG, Math.asin(water) - 14 * DEG);
    const bottom = Math.max(lo, view.bottom + 20 * DEG, Math.asin(GRAVEL_TOP) + 25 * DEG);
    return top > bottom ? pick.range(bottom, top) : (top + bottom) / 2;
  };

  const startKiss = (side: number): boolean => {
    const options = freeOf(goldfish());
    const lat = glassLat(-22 * DEG, 8 * DEG);
    const lon = sideCentre(side) + pick.range(-38, 38) * DEG;
    const dir = copy(direction(lat, lon) as V3);
    const f = nearestTo(options, dir);
    if (!f) return false;
    begin({ kind: "kiss", side }, [f], dir);
    f.task = { kind: "kiss", phase: "approach", t: 0, dir, hold: pick.range(5, 7.5) };
    return true;
  };

  const startChase = (): boolean => {
    const options = freeOf(goldfish());
    if (options.length < 2) return false;
    const a = options[pick.int(options.length)]!;
    const rest = options.filter((f) => f !== a);
    const b = nearestTo(rest, a.pos)!;
    // The quicker one gives chase.
    const [chaser, chased] = a.spec.burst >= b.spec.burst ? [a, b] : [b, a];
    const until = pick.range(9, 12);
    begin({ kind: "chase", side: sideAt(chased.pos) }, [chaser, chased], copy(chased.pos));
    chased.task = { kind: "flee", from: chaser, t: 0, until, round: chased.round };
    chaser.task = { kind: "pursue", target: chased, t: 0, until, nipped: 0 };
    return true;
  };

  const startLoop = (side: number): boolean => {
    const options = freeOf(goldfish()).filter((f) => FAUNA[f.species].roles.loop);
    const lat = pick.range(-6, 4) * DEG;
    const lon = sideCentre(side) + pick.range(-30, 30) * DEG;
    const at = scale(copy(direction(lat, lon) as V3), 0.7);
    const f = nearestTo(options, at);
    if (!f) return false;
    begin({ kind: "loop", side }, [f], at);
    f.task = { kind: "loop", phase: "approach", t: 0, at, turned: 0, round: f.round };
    return true;
  };

  const schoolCentre = (school: School) => {
    let c = v3();
    for (const f of school.members) c = add(c, f.pos);
    return scale(c, 1 / Math.max(1, school.members.length));
  };
  /** The shoal with most fish free to dart, if any has three. */
  const darting = (): School | undefined =>
    schools
      .filter((sc) => freeOf(sc.members).length >= 3)
      .sort((a, b) => freeOf(b.members).length - freeOf(a.members).length)[0];

  const startDart = (): boolean => {
    const school = darting();
    if (!school) return false;
    const options = freeOf(school.members);
    const c = schoolCentre(school);
    school.way = -school.way;
    const base = roundDir(c, school.way);
    const lift = pick.range(-0.25, 0.25);
    begin({ kind: "dart", side: sideAt(c) }, options, c);
    options.forEach((f, i) => {
      const jitter = rotate(base, UP, ((i % 5) - 2) * 0.08);
      f.task = {
        kind: "dart",
        dir: norm([jitter[0], lift, jitter[2]]),
        t: 0,
        until: pick.range(0.7, 1.1),
        speed: f.spec.burst,
      };
    });
    return true;
  };

  const startPuff = (): boolean => {
    const puffer = fish.find((f) => FAUNA[f.species].roles.puff && free(f));
    if (!puffer) return false;
    const startler = nearestTo(
      freeOf(fish).filter((f) => f !== puffer && !bottom(f)),
      puffer.pos,
    );
    const actors = startler ? [puffer, startler] : [puffer];
    begin({ kind: "puff", side: sideAt(puffer.pos) }, actors, copy(puffer.pos));
    puffer.task = { kind: "puff", phase: "wait", t: 0, hold: pick.range(4, 6) };
    if (startler) startler.task = { kind: "startle", target: puffer, t: 0 };
    return true;
  };

  const startNap = (side: number): boolean => {
    const options = freeOf(
      fish.filter((f) => f.species === "cory" || (bottom(f) && f.species !== "pleco")),
    );
    const lon = sideCentre(side) + pick.range(-30, 30) * DEG;
    const r = 0.38;
    const y = gravelHeight(r) + 0.05;
    const at: V3 = [r * Math.sin(lon), y, r * Math.cos(lon)];
    const f = nearestTo(options, at);
    if (!f) return false;
    begin({ kind: "nap", side }, [f], at);
    f.task = { kind: "nap", phase: "approach", t: 0, at, rest: pick.range(25, 45) };
    return true;
  };

  const startFeed = (side: number): boolean => {
    for (const h of habits) if (!h.done) cancel(h);
    const lon = sideCentre(side) + pick.range(-25, 25) * DEG;
    // Near the glass, so the flakes sink past people's eyes as the fish take them.
    const r = surfaceRadius(water) - 0.08;
    const spot: V3 = [r * Math.sin(lon), water - 0.012, r * Math.cos(lon)];
    const eaters = fish.filter((f) => f.puff === 0 || f.task?.kind !== "puff");
    const h = begin({ kind: "feed", side }, eaters, spot);
    h.spot = spot;
    h.spawned = 0;
    h.ate = 0;
    feeding = h;
    for (const f of eaters) {
      f.ate = 0;
      if (f.task?.kind === "nap") continue;
      f.task = bottom(f) ? { kind: "graze" } : { kind: "feed", target: null };
    }
    return true;
  };

  const start = (plan: Plan): boolean => {
    switch (plan.kind) {
      case "kiss":
        return startKiss(plan.side);
      case "chase":
        return startChase();
      case "loop":
        return startLoop(plan.side);
      case "dart":
        return startDart();
      case "puff":
        return startPuff();
      case "nap":
        return startNap(plan.side);
      case "feed":
        return startFeed(plan.side);
    }
  };

  const where = (kind: Exclude<HabitKind, "feed">): number | null | false => {
    switch (kind) {
      case "kiss":
        return freeOf(goldfish()).length > 0 ? null : false;
      case "loop":
        return freeOf(goldfish()).some((f) => FAUNA[f.species].roles.loop) ? null : false;
      case "nap":
        return freeOf(fish.filter((f) => f.species === "cory")).length > 0 ? null : false;
      case "chase": {
        const options = freeOf(goldfish());
        return options.length >= 2 ? sideAt(options[0]!.pos) : false;
      }
      case "dart": {
        const school = darting();
        return school ? sideAt(schoolCentre(school)) : false;
      }
      case "puff": {
        const p = fish.find((f) => FAUNA[f.species].roles.puff && free(f));
        return p ? sideAt(p.pos) : false;
      }
    }
  };

  // ---- Feeding -----------------------------------------------------------------------------

  const spawnFlake = (spot: V3) => {
    if (flakes.length >= MAX_FLAKES) return;
    const a = pick.range(0, TAU);
    const r = pick.range(0, 0.06);
    const out = norm([spot[0], 0, spot[2]]);
    flakes.push({
      pos: [spot[0] + r * Math.cos(a), spot[1], spot[2] + r * Math.sin(a)],
      drift: madd([pick.range(-0.01, 0.01), 0, pick.range(-0.01, 0.01)], out, 0.003),
      float: pick.range(1.5, 6),
      sink: pick.range(0.03, 0.05),
      spin: pick.range(-2, 2),
      angle: pick.range(0, TAU),
      age: 0,
      landed: 0,
      tone: pick.next(),
      eaten: false,
    });
  };

  const stepFlakes = (dt: number) => {
    for (const k of flakes) {
      k.age += dt;
      const floor = gravelHeight(Math.hypot(k.pos[0], k.pos[2])) + 0.008;
      if (k.pos[1] <= floor) {
        k.pos[1] = floor;
        k.landed += dt;
        continue;
      }
      k.pos = madd(k.pos, k.drift, dt);
      if (k.age < k.float) {
        // Floating: spreading slowly on the surface.
        k.angle += k.spin * 0.2 * dt;
        k.pos[1] = water - 0.012;
      } else {
        // Flakes flutter as they sink, faster once soaked.
        const sunk = k.age - k.float;
        const wob = Math.sin(sunk * 2.3 + k.tone * 9) * 0.02;
        k.angle += k.spin * dt;
        k.pos[0] += Math.cos(k.angle) * wob * dt;
        k.pos[2] += Math.sin(k.angle) * wob * dt;
        k.pos[1] -= k.sink * Math.min(1, 0.4 + sunk * 0.15) * dt;
      }
      // Kept a little off the glass, where fish can still take them.
      const r = len(k.pos);
      if (r > 0.9) k.pos = scale(k.pos, 0.9 / r);
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const k = flakes[i]!;
      if (k.eaten || k.landed > 25 || k.age > 90) flakes.splice(i, 1);
    }
  };

  const mouthOf = (f: Fish) => madd(f.pos, f.fwd, f.len * 0.48);

  const tryEat = (f: Fish) => {
    const m = mouthOf(f);
    const reach = 0.035 + f.len * 0.16;
    for (const k of flakes) {
      if (k.eaten || dist(m, k.pos) > reach) continue;
      k.eaten = true;
      f.gulp = 1;
      f.ate++;
      if (feeding) feeding.ate = (feeding.ate ?? 0) + 1;
      return;
    }
  };

  const stepFeeding = (h: Habit) => {
    const at = time - h.start;
    const spot = h.spot!;
    const total = FEED_FLAKES;
    while ((h.spawned ?? 0) < Math.min(total, Math.floor(at / 0.18))) {
      spawnFlake(spot);
      h.spawned = (h.spawned ?? 0) + 1;
    }
    // Spread the fish over the flakes rather than all on one.
    const claimed = new Set<Flake>();
    for (const f of h.actors) {
      const t = f.task;
      if (t?.kind !== "feed") continue;
      if (f.ate >= APPETITE[f.species]) {
        // Had enough: back to swimming about.
        f.task = null;
        f.habit = null;
        continue;
      }
      if (t.target && (t.target.eaten || !flakes.includes(t.target))) t.target = null;
      if (t.target && claimed.has(t.target) && pick.next() < 0.02) t.target = null;
      if (!t.target) {
        let best: Flake | null = null;
        let bestD = Infinity;
        for (const k of flakes) {
          if (k.landed > 0 && !bottom(f)) continue;
          const d = dist(f.pos, k.pos) + (claimed.has(k) ? 0.25 : 0);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        t.target = best;
      }
      if (t.target) claimed.add(t.target);
    }
    const left = flakes.some((k) => !k.eaten && k.landed === 0);
    if (((h.spawned ?? 0) >= total && !left && at > 6) || at > 45) {
      // Scatter: everyone darts away from where the food was.
      for (const f of h.actors) {
        if (f.task?.kind !== "feed") continue;
        const away = norm(sub(f.pos, spot), f.fwd);
        f.task = {
          kind: "dart",
          dir: norm([away[0], -0.2, away[2]]),
          t: 0,
          until: pick.range(0.9, 1.5),
          speed: f.spec.burst * 0.9,
        };
      }
      h.done = true;
      for (const f of h.actors) if (f.habit === h) f.habit = null;
      feeding = null;
    }
  };

  // ---- One fish, one step ------------------------------------------------------------------

  const stepFish = (f: Fish, dt: number) => {
    const spec = f.spec;
    let wish: V3;
    let speed: number;
    let glass = true;
    let reach = 0;
    let pitch = 0.42;
    let rate = spec.turn;
    let hold = false;
    let mouth = 0.12 + 0.08 * Math.sin(time * 2.4 + f.tint * 20);
    const t = f.task;

    const base = wander(f, dt);
    wish = base.dir;
    speed = base.speed;
    if (schoolOf(f) && !f.habit) wish = add(scale(wish, 0.5), schoolWish(f));

    switch (t?.kind) {
      case "kiss": {
        t.t += dt;
        const holdAt = scale(t.dir, 0.966 - f.len * 0.5);
        if (t.phase === "approach") {
          const stage = scale(t.dir, 0.966 - f.len * 0.5 - 0.17);
          wish = sub(stage, f.pos);
          speed = Math.min(spec.burst, spec.cruise[1] * 1.3);
          if (dist(stage, f.pos) < 0.07 || t.t > 12) t.phase = "align";
          if (t.t > 12) t.t = 0;
          if (t.phase === "align") t.t = 0;
        } else if (t.phase === "align") {
          glass = false;
          pitch = 1.2;
          wish = t.dir;
          const facing = dot(f.fwd, t.dir);
          speed = facing > 0.9 ? 0.05 : 0.01;
          if (dist(f.pos, holdAt) < 0.02 || t.t > 7) {
            t.phase = "hold";
            t.t = 0;
          }
        } else if (t.phase === "hold") {
          glass = false;
          pitch = 1.2;
          hold = true;
          wish = t.dir;
          speed = 0;
          f.pos = madd(f.pos, sub(holdAt, f.pos), 1 - Math.exp(-dt * 3));
          // Lips working on the glass, with a pause now and then.
          const smack = Math.sin(t.t * TAU * 1.6);
          mouth = 0.25 + 0.75 * Math.max(0, smack) * (Math.sin(t.t * 0.9) > -0.6 ? 1 : 0.2);
          if (t.t > t.hold) {
            t.phase = "back";
            t.t = 0;
          }
        } else {
          glass = false;
          pitch = 1.2;
          hold = true;
          wish = t.dir;
          speed = -0.045;
          if (t.t > 1.6) {
            f.round = pick.next() < 0.5 ? -1 : 1;
            f.wander.next = 0;
            f.fwd = norm(madd(f.fwd, roundDir(f.pos, f.round), 0.4));
            done(f, "kiss");
          }
        }
        break;
      }
      case "flee": {
        t.t += dt;
        const away = sub(f.pos, t.from.pos);
        wish = add(scale(roundDir(f.pos, t.round), 1.3), scale(norm(away), 0.9));
        wish[1] += Math.sin(t.t * 1.3) * 0.25;
        speed = spec.burst * 0.85;
        if (t.t > t.until) f.task = null;
        break;
      }
      case "pursue": {
        t.t += dt;
        const target = madd(t.target.pos, t.target.fwd, 0.08);
        wish = sub(target, f.pos);
        speed = spec.burst;
        t.nipped -= dt;
        if (dist(mouthOf(f), madd(t.target.pos, t.target.fwd, -t.target.len * 0.4)) < 0.06) {
          if (t.nipped <= 0) {
            f.gulp = 1;
            t.nipped = 1.4;
            // A nip makes the chased fish jink.
            t.target.fwd = norm(rotate(t.target.fwd, t.target.up, pick.range(-0.7, 0.7)));
          }
          speed = t.target.speed * 0.9;
        }
        if (t.t > t.until) done(f, "chase");
        break;
      }
      case "loop": {
        t.t += dt;
        if (t.phase === "approach") {
          const round = roundDir(t.at, t.round);
          wish = add(sub(t.at, f.pos), scale(round, 0.25));
          speed = spec.cruise[1] * 1.2;
          const level = Math.abs(f.fwd[1]) < 0.2;
          if ((dist(f.pos, t.at) < 0.09 && level) || t.t > 14) {
            if (t.t > 14 && dist(f.pos, t.at) > 0.25) {
              done(f, "loop");
              break;
            }
            t.phase = "loop";
            t.t = 0;
          }
        } else {
          glass = false;
          speed = 0.3;
          const spin = (TAU / 2.6) * dt;
          const side = norm(cross(f.fwd, f.up));
          f.fwd = norm(rotate(f.fwd, side, spin));
          f.up = norm(rotate(f.up, side, spin));
          t.turned += spin;
          wish = f.fwd;
          pitch = Math.PI;
          if (t.turned >= TAU) done(f, "loop");
        }
        break;
      }
      case "dart": {
        t.t += dt;
        wish = t.dir;
        rate = spec.turn * 3;
        speed = t.speed * (t.t < t.until ? 1 : 0.4);
        if (t.t > t.until + 0.8) {
          f.task = rest(f);
          // The habit ends once no fish holds it.
          if (f.habit?.kind === "dart") f.habit = null;
        }
        break;
      }
      case "startle": {
        t.t += dt;
        wish = sub(madd(t.target.pos, t.target.up, 0.06), f.pos);
        speed = spec.burst;
        const near = dist(f.pos, t.target.pos) < 0.13 + f.len * 0.5;
        if (near || t.t > 4.5) {
          const p = t.target.task;
          if (p?.kind === "puff" && p.phase === "wait") {
            p.phase = "inflate";
            p.t = 0;
          }
          const away = norm(sub(f.pos, t.target.pos), f.fwd);
          f.task = { kind: "dart", dir: away, t: 0, until: 0.9, speed: spec.burst };
          f.habit = null;
        }
        break;
      }
      case "puff": {
        t.t += dt;
        if (t.phase === "wait") {
          speed = spec.cruise[0];
          if (t.t > 6) {
            t.phase = "inflate";
            t.t = 0;
          }
        } else {
          rate = spec.turn * 0.3;
          speed = 0.004;
          wish = f.fwd;
          if (t.phase === "inflate") {
            f.puff = Math.max(f.puff, ease(t.t / 1.1));
            mouth = 0.5;
            if (t.t >= 1.1) {
              t.phase = "hold";
              t.t = 0;
            }
          } else if (t.phase === "hold") {
            f.puff = 1;
            // Bobs a little, as though it floats.
            f.pos[1] += Math.sin(t.t * 1.7) * 0.004 * dt;
            if (t.t >= t.hold) {
              t.phase = "deflate";
              t.t = 0;
            }
          } else {
            f.puff = 1 - smooth(t.t / 5);
            if (t.t >= 5) {
              f.puff = 0;
              done(f, "puff");
            }
          }
        }
        break;
      }
      case "nap": {
        t.t += dt;
        if (t.phase === "approach") {
          wish = sub(t.at, f.pos);
          speed = Math.max(0.05, spec.cruise[1]);
          if (dist(f.pos, t.at) < 0.05 || t.t > 25) {
            t.phase = "rest";
            t.t = 0;
          }
        } else if (t.phase === "rest") {
          hold = true;
          speed = 0;
          wish = add(f.fwd, scale(horizontal(roundDir(f.pos, f.round)), 0.3));
          f.pos[1] += (bottomOf(f, f.pos) + 0.002 - f.pos[1]) * (1 - Math.exp(-dt * 1.5));
          // A wink or two while resting: eyes roll down and back.
          const k = (t.t % 11) / 0.7;
          f.wink = k < 1 ? Math.sin(k * Math.PI) : 0;
          if (t.t > t.rest) {
            t.phase = "wiggle";
            t.t = 0;
          }
        } else {
          speed = 0.03 + t.t * 0.05;
          f.wink = 0;
          f.amp = 1.6;
          if (t.t > 1) done(f, "nap");
        }
        break;
      }
      case "feed": {
        // Bodies stay in the band people see; mouths reach up to the surface.
        reach = Math.min(0.04, Math.sin(view.top) - water + 0.05);
        pitch = 0.9;
        if (t.target) {
          wish = sub(t.target.pos, mouthOf(f));
          // Rush in, then slow to take it.
          const d = len(wish);
          speed = Math.min(spec.burst, spec.cruise[1] * 2.4, 0.03 + d * 1.6);
          rate = spec.turn * 1.6;
          tryEat(f);
        }
        break;
      }
      case "graze": {
        // A cory keeps to the gravel near the glass, nose down, in short scoots.
        const food = flakes.find((k) => !k.eaten && (k.landed > 0 || k.pos[1] < -0.55));
        if (food) {
          wish = sub(food.pos, mouthOf(f));
          speed = spec.cruise[1] * 1.5;
          tryEat(f);
          pitch = 0.7;
        } else {
          const w = f.wander;
          wish = [base.dir[0], (bottomOf(f, f.pos) + 0.02 - f.pos[1]) * 3, base.dir[2]];
          speed = w.hover > 0 ? 0 : base.speed;
          if (w.hover > 0) mouth = 0.4 + 0.4 * Math.sin(time * 9);
        }
        break;
      }
      default:
        break;
    }

    if (hold) glass = false;
    wish = keepClear(f, wish, { glass, reach });

    if (t?.kind === "loop" && t.phase === "loop") {
      // The loop turns the fish itself.
    } else if (!(t?.kind === "puff" && t.phase !== "wait")) {
      turnToward(f, wish, dt, pitch, rate);
      if (!(t?.kind === "kiss" && t.phase !== "approach")) level(f, dt);
    } else {
      level(f, dt, 0.6);
    }

    const accel = speed > f.speed ? (speed > spec.cruise[1] * 1.5 ? 5 : 2) : 2.5;
    f.speed += (speed - f.speed) * (1 - Math.exp(-dt * accel));
    f.pos = madd(f.pos, f.fwd, f.speed * dt);
    contain(f, reach);

    // The body: tail beats with speed, the fins keep going even when still.
    const sp = Math.abs(f.speed);
    const beat = spec.beat + (spec.beatPerSpeed * sp) / f.len;
    f.phase = (f.phase + TAU * beat * dt) % TAU;
    f.fin = (f.fin + TAU * (sp < 0.03 ? 2.6 : 1.4) * dt) % TAU;
    const wantAmp =
      f.puff > 0 ? 0.08 : clamp(0.18 + (1.1 * sp) / (spec.cruise[1] * 1.4), 0.15, 1.3);
    if (!(t?.kind === "nap" && t.phase === "wiggle"))
      f.amp += (wantAmp - f.amp) * (1 - Math.exp(-dt * 3));
    // A positive turn swings the nose towards the fish's -z, so the body bends that way.
    f.bend += (clamp(-f.yaw * 0.35, -0.7, 0.7) - f.bend) * (1 - Math.exp(-dt * 5));
    f.gulp = Math.max(0, f.gulp - dt * 2.2);
    const wantMouth = Math.max(mouth, f.gulp);
    f.mouth += (wantMouth - f.mouth) * (1 - Math.exp(-dt * 12));
    // Eyes wander, more for the puffer, which looks about a lot.
    const lookRate = f.species === "puffer" ? 0.5 : 0.2;
    f.look = Math.sin(time * lookRate + f.tint * 31) * (f.species === "puffer" ? 0.8 : 0.35);
  };

  const stepSchool = (dt: number) => {
    for (const school of schools) {
      const spec = SPECIES[school.species];
      school.next -= dt;
      if (school.next <= 0) {
        school.next = pick.range(8, 20);
        if (pick.next() < 0.3) school.way = -school.way;
        school.depth = pick.range(spec.depth[0], Math.min(spec.depth[1], water - 0.3));
        school.cruise = pick.range(spec.cruise[0], spec.cruise[1]);
      }
    }
  };

  const stepSnail = (s: Snail, dt: number) => {
    s.wave = (s.wave + dt * 0.9) % 1;
    if (s.pause > 0) {
      s.pause -= dt;
      s.mouth = 0.5 + 0.5 * Math.sin(time * 5);
      return;
    }
    s.mouth = 0.25 + 0.25 * Math.sin(time * 5);
    s.turn += (pick.range(-1, 1) * 0.4 - s.turn) * dt * 0.5;
    const { lat } = latLonOf(s.u);
    const top = Math.asin(water) - 7 * DEG;
    const bottom = Math.asin(GRAVEL_TOP) + 10 * DEG;
    // Head back towards the middle of the band near its edges.
    const north = norm(across(UP, s.u), s.heading);
    let want = rotate(s.heading, s.u, s.turn * dt);
    if (lat > top - 6 * DEG) want = madd(want, north, -0.5 * dt);
    if (lat < bottom + 6 * DEG) want = madd(want, north, 0.5 * dt);
    s.heading = norm(across(want, s.u), s.heading);
    s.u = norm(madd(s.u, s.heading, s.speed * dt));
    s.heading = norm(across(s.heading, s.u));
    const now = latLonOf(s.u);
    if (now.lat > top || now.lat < bottom) {
      s.u = copy(direction(clamp(now.lat, bottom, top), now.lon) as V3);
      s.heading = norm(across(s.heading, s.u));
    }
    if (pick.next() < dt / 40) s.pause = pick.range(6, 20);
  };

  const step = (dt: number) => {
    time += dt;
    stepSchool(dt);
    if (feeding) stepFeeding(feeding);
    for (const f of fish) stepFish(f, dt);
    for (const s of snails) stepSnail(s, dt);
    stepFlakes(dt);
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
    snails,
    flakes,
    habits,
    get feeding() {
      return feeding !== null;
    },
    get water() {
      return water;
    },
    counts,
    sideCounts,
    log,
    scheduler,
    step,
    trigger(kind, side) {
      const s = side ?? (scheduler.served.indexOf(Math.min(...scheduler.served)) || 0);
      if (kind === "feed") return startFeed(s);
      if (feeding) return false;
      // Make room: end whatever the actors this habit needs are doing.
      const busy = habits.filter((h) => !h.done && h.kind !== "feed");
      const ok = start({ kind, side: s });
      if (ok) return true;
      // The puffer mid-puff puffs up again from where it is.
      if (kind === "puff") {
        const p = fish.find((f) => f.task?.kind === "puff");
        if (p?.task?.kind === "puff") {
          if (p.task.phase === "hold" || p.task.phase === "deflate") {
            p.task = { kind: "puff", phase: "inflate", t: 0, hold: pick.range(4, 6) };
          }
          return true;
        }
      }
      for (const h of busy) cancel(h);
      for (const f of fish) {
        if (f.task?.kind === "puff" && kind !== "puff") continue;
        if (f.puff > 0) continue;
        f.habit = null;
        if (f.task && f.task.kind !== "graze") f.task = rest(f);
      }
      return start({ kind, side: s });
    },
    setView(w, v) {
      water = w;
      view = { ...v };
    },
  };
};
