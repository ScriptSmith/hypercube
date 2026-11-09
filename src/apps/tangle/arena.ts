/**
 * The arena simulation: lines moving at constant speed with a minimum turning circle, trails
 * laid into the occupancy grid, gaps, crashes, the late-round speed-up, and in `snake` and
 * `grid` the moving bodies and food. One `step()` is one tick at HZ. No DOM, and nothing
 * allocates per step.
 *
 * Edges either stop a line (`solid`) or wrap (`wrap`): a line leaving by one edge comes back at
 * the opposite one, and every distance and look-up goes the short way round.
 *
 * In `grid` a line runs along the rows and columns of a lane grid of cells two snake widths
 * across and only changes direction at a cell centre. A press waits for the next centre, and one
 * more press can wait behind it, so two quick taps make two turns.
 *
 * Collisions: after every line has moved, each head tests the cells within half a trail width
 * of it (half a lane on the grid). A cell blocks unless it is the line's own, laid in the last
 * few ticks (the head always overlaps the trail it has just laid), a fading trail older than
 * FADE_S, or behind a snake's tail. Two heads closer than a trail width both stop. Only then do
 * the survivors lay their new cells, so the order lines are stepped in never decides who crashed.
 */
import type { Rng } from "../../core/types";
import {
  EAT_REACH,
  type Edges,
  FADE_S,
  GAP_EVERY_S,
  GRID,
  GAP_WIDTHS,
  HZ,
  MAX_LINES,
  SNAKE,
  snakeRules,
  snakeSize,
  SPEEDUP_AFTER_S,
  SPEEDUP_PER_S,
  type TrailMode,
  type Variant,
} from "./config";
import { cellAt, createGrid, type Grid, someCell } from "./grid";
import { MAX_PIECES, PIECE_FLOATS, splitSegment, wrapDelta, wrapInto } from "./wrap";

export interface ArenaParams {
  /** Trail width in arena units. */
  trail: number;
  /** Speed at the normal setting, in units per second. */
  speed: number;
  /** Tightest turning radius. */
  radius: number;
  /** Lane cell size `grid` lines run on; the trail width otherwise. */
  lane: number;
}

/**
 * Line sizes for an arena. Full size (16 wide, 320 per second, a 200 across turning circle) on a
 * wall or screen; smaller arenas scale down so there is still room to manoeuvre, down to the
 * low band between two stacked stations on a panel. `grid` snakes are thicker, on wider lanes.
 */
export const arenaParams = (width: number, height: number, variant?: Variant): ArenaParams => {
  const s = Math.min(1, Math.max(0.45, Math.min(width, height) / 1700));
  const trail = 16 * Math.max(0.8, s);
  const sized = { trail, speed: 320 * s, radius: 100 * s, lane: trail };
  if (variant !== "grid") return sized;
  // At least ten lanes across the short side, for the low band between two stations on a panel.
  const lane = Math.min(trail * GRID.thick * GRID.lane, Math.min(width, height) / 10);
  return { ...sized, trail: lane / GRID.lane, lane };
};

/** Speed multiplier `t` seconds into a round. */
export const speedUp = (variant: Variant, t: number): number =>
  variant === "trails" ? 1 + SPEEDUP_PER_S * Math.max(0, t - SPEEDUP_AFTER_S) : 1;

export interface Start {
  x: number;
  y: number;
  heading: number;
}

/** Grid directions: right, down, left, up. Direction `d` heads at d quarter turns (y is down). */
export const DIR_X = [1, 0, -1, 0] as const;
export const DIR_Y = [0, 1, 0, -1] as const;
export const opposite = (d: number) => (d + 2) & 3;
/** The grid direction nearest a heading. */
export const dirOf = (heading: number) => ((Math.round(heading / (Math.PI / 2)) % 4) + 4) % 4;

/** The grid lines run along: `cols` x `rows` cells of `w` x `h`, about `ArenaParams.lane`. */
export interface Lane {
  cols: number;
  rows: number;
  w: number;
  h: number;
}

/**
 * The lane grid for an arena. Cells fit the arena exactly: on a wrapping arena so the rows meet
 * up across the edges, and on a solid one rounded down so the outermost centres are clear of it.
 */
export const laneFor = (width: number, height: number, trail: number, wrap: boolean): Lane => {
  const fit = (size: number) =>
    Math.max(1, wrap ? Math.round(size / trail) : Math.floor(size / trail));
  const cols = fit(width);
  const rows = fit(height);
  return { cols, rows, w: width / cols, h: height / rows };
};

/** Floats per stamp: x0, y0, x1, y1, line id, time laid (s). */
export const STAMP_FLOATS = 6;
const STAMP_CAP = 8192;
const BODY_CAP = Math.max(SNAKE.max, GRID.max) + 1;
export const MAX_FOOD = 16;
/** A ring of trail segments laid since the renderer last took them. */
export interface Stamps {
  readonly data: Float32Array;
  readonly cap: number;
  start: number;
  count: number;
  /** Segments were dropped unseen; the picture has to be rebuilt from the grid. */
  lost: boolean;
}

export interface Line {
  readonly id: number;
  start: Start;
  x: number;
  y: number;
  heading: number;
  /** Position before the latest step. */
  px: number;
  py: number;
  alive: boolean;
  /** Steering: -1 left, 0 straight, 1 right. */
  dir: number;
  /**
   * Grid: the direction now (see DIR_X), the press waiting for the next centre and one behind
   * it (-1 for none), and the distance to the next centre.
   */
  aim: number;
  next: number;
  queued: number;
  toCentre: number;
  /** Tick of the latest crash, or -1. */
  outTick: number;
  /** Distance left in the current gap. */
  gapLeft: number;
  nextGap: number;
  /** Laid trail on the latest step. */
  laying: boolean;
  hit: boolean;
  /** No collisions before this tick (a snake just respawned). */
  ghostUntil: number;
  /** Snake: target body length in segments, longest reached, food eaten, crashes. */
  len: number;
  best: number;
  eaten: number;
  deaths: number;
  respawnAt: number;
  /** Snake: cells laid before this tick are behind the tail. */
  tailTick: number;
  /** Snake body points, oldest first from `bodyStart`, one per trail width travelled. */
  readonly bodyX: Float32Array;
  readonly bodyY: Float32Array;
  readonly bodyT: Uint32Array;
  bodyStart: number;
  bodyCount: number;
  sinceBody: number;
}

export interface Food {
  x: number;
  y: number;
  live: boolean;
  /** Tick it appeared, or when it may next appear. */
  born: number;
}

export interface ArenaHooks {
  out?(line: Line): void;
  eat?(line: Line, x: number, y: number): void;
  respawn?(line: Line): void;
}

export interface ArenaOptions {
  width: number;
  height: number;
  params: ArenaParams;
  variant: Variant;
  gaps: boolean;
  trail: TrailMode;
  edges: Edges;
  rng: Rng;
}

export interface Arena {
  readonly width: number;
  readonly height: number;
  readonly params: ArenaParams;
  readonly variant: Variant;
  /** Trails fade (and stop blocking) FADE_S after they are laid. */
  readonly fade: boolean;
  /** Edges wrap round to the opposite side. */
  readonly wrap: boolean;
  readonly grid: Grid;
  /** The lane grid that `grid` lines run along, and that bots measure room on. */
  readonly lane: Lane;
  readonly lines: readonly Line[];
  readonly food: readonly Food[];
  readonly tick: number;
  /** Seconds since start(). */
  readonly time: number;
  readonly stamps: Stamps;
  /** Changes whenever the arena is started or cleared, so views know to wipe their picture. */
  readonly generation: number;
  hooks: ArenaHooks;
  /** Current speed in units per second. */
  speed(): number;
  start(starts: readonly Start[], speedFactor: number): void;
  step(): void;
  /** Grid: someone pressed direction `d` (0 to 3) for this line. */
  press(line: Line, d: number): void;
  alive(): number;
  /** Trails: one line left, or none when the round began with one. Never in snake. */
  finished(): boolean;
  /** Whether a cell blocks line `self` now (any line, for self -1). */
  blocks(index: number, self: number): boolean;
  /** Body point `k` (0 is the oldest) of a snake. */
  bodyPoint(line: Line, k: number): { x: number; y: number };
  clear(): void;
}

const newLine = (id: number): Line => ({
  id,
  start: { x: 0, y: 0, heading: 0 },
  x: 0,
  y: 0,
  heading: 0,
  px: 0,
  py: 0,
  alive: false,
  dir: 0,
  aim: 3,
  next: -1,
  queued: -1,
  toCentre: 0,
  outTick: -1,
  gapLeft: 0,
  nextGap: 0,
  laying: false,
  hit: false,
  ghostUntil: 0,
  len: SNAKE.start,
  best: SNAKE.start,
  eaten: 0,
  deaths: 0,
  respawnAt: -1,
  tailTick: 0,
  bodyX: new Float32Array(BODY_CAP),
  bodyY: new Float32Array(BODY_CAP),
  bodyT: new Uint32Array(BODY_CAP),
  bodyStart: 0,
  bodyCount: 0,
  sinceBody: 0,
});

export const createArena = (opts: ArenaOptions): Arena => {
  const { width: W, height: H, params, variant, rng } = opts;
  const snake = snakeRules(variant);
  const onGrid = variant === "grid";
  const wrap = opts.edges === "wrap";
  const fadeTicks = !snake && opts.trail === "fade" ? FADE_S * HZ : 0;
  const gapsOn = !snake && opts.gaps;
  const size = snakeSize(variant);
  const lane = laneFor(W, H, params.lane, wrap);
  // On the grid, two occupancy cells to a lane cell, so neighbouring rows never touch.
  const grid = createGrid(
    W,
    H,
    params.trail / 2,
    onGrid ? { wrap, cols: lane.cols * 2, rows: lane.rows * 2 } : { wrap },
  );
  const { owner, stamp } = grid;
  const pool: Line[] = Array.from({ length: MAX_LINES }, (_, i) => newLine(i));
  const food: Food[] = Array.from({ length: MAX_FOOD }, () => ({
    x: 0,
    y: 0,
    live: false,
    born: 0,
  }));
  const stamps: Stamps = {
    data: new Float32Array(STAMP_CAP * STAMP_FLOATS),
    cap: STAMP_CAP,
    start: 0,
    count: 0,
    lost: false,
  };
  const pieces = new Float32Array(MAX_PIECES * PIECE_FLOATS);
  let lines: Line[] = [];
  let tick = 0;
  let generation = 0;
  let factor = 1;
  let foodCount = 0;
  /** Own cells laid this many ticks ago or less never block their own head. */
  let skip = 0;
  let probeSelf = -1;
  let markOwner = 0;
  const point = { x: 0, y: 0 };

  const speedNow = () => params.speed * factor * speedUp(variant, tick / HZ);
  const gapTicks = () => Math.round(rng.range(GAP_EVERY_S[0], GAP_EVERY_S[1]) * HZ);
  /** Offsets the short way round on a wrapping arena. */
  const offX = (d: number) => (wrap ? wrapDelta(d, W) : d);
  const offY = (d: number) => (wrap ? wrapDelta(d, H) : d);
  const dist2 = (ax: number, ay: number, bx: number, by: number) => {
    const dx = offX(bx - ax);
    const dy = offY(by - ay);
    return dx * dx + dy * dy;
  };

  const live = (i: number, self: number, window: number): boolean => {
    const o = owner[i]!;
    if (o === 0) return false;
    const id = o - 1;
    const s = stamp[i]!;
    if (snake && s < pool[id]!.tailTick) return false;
    if (fadeTicks > 0 && tick - s >= fadeTicks) return false;
    return !(id === self && tick - s <= window);
  };
  const probe = (i: number) => live(i, probeSelf, skip);
  const mark = (i: number) => {
    owner[i] = markOwner;
    stamp[i] = tick;
    return false;
  };

  const putStamp = (x0: number, y0: number, x1: number, y1: number, id: number) => {
    if (stamps.count === stamps.cap) {
      stamps.start = (stamps.start + 1) % stamps.cap;
      stamps.count--;
      stamps.lost = true;
    }
    const k = ((stamps.start + stamps.count) % stamps.cap) * STAMP_FLOATS;
    const d = stamps.data;
    d[k] = x0;
    d[k + 1] = y0;
    d[k + 2] = x1;
    d[k + 3] = y1;
    d[k + 4] = id;
    d[k + 5] = tick / HZ;
    stamps.count++;
  };

  /** The segment just travelled, cut into pieces where it crosses an edge. */
  const pushStamp = (l: Line) => {
    if (!wrap) {
      putStamp(l.px, l.py, l.x, l.y, l.id);
      return;
    }
    const n = splitSegment(
      l.px,
      l.py,
      l.px + wrapDelta(l.x - l.px, W),
      l.py + wrapDelta(l.y - l.py, H),
      W,
      H,
      pieces,
    );
    for (let k = 0; k < n; k++) {
      const o = k * PIECE_FLOATS;
      putStamp(pieces[o]!, pieces[o + 1]!, pieces[o + 2]!, pieces[o + 3]!, l.id);
    }
  };

  const resetBody = (l: Line) => {
    l.bodyStart = 0;
    l.bodyCount = 0;
    l.sinceBody = Infinity;
    l.tailTick = tick;
  };

  /** Add the head as a body point and drop points past the snake's length. */
  const addBody = (l: Line) => {
    const idx = (l.bodyStart + l.bodyCount) % BODY_CAP;
    l.bodyX[idx] = l.x;
    l.bodyY[idx] = l.y;
    l.bodyT[idx] = tick;
    l.bodyCount++;
    while (l.bodyCount > l.len) {
      l.bodyStart = (l.bodyStart + 1) % BODY_CAP;
      l.bodyCount--;
    }
    l.tailTick = l.bodyT[l.bodyStart]!;
  };

  /** The lane cell centre nearest a point, in `point`. */
  const snapToLane = (x: number, y: number) => {
    const i = Math.min(lane.cols - 1, Math.max(0, Math.floor(x / lane.w)));
    const j = Math.min(lane.rows - 1, Math.max(0, Math.floor(y / lane.h)));
    point.x = (i + 0.5) * lane.w;
    point.y = (j + 0.5) * lane.h;
    return point;
  };

  const place = (l: Line, s: Start) => {
    l.start = s;
    l.x = l.px = s.x;
    l.y = l.py = s.y;
    l.heading = s.heading;
    if (onGrid) {
      const c = snapToLane(s.x, s.y);
      l.x = l.px = c.x;
      l.y = l.py = c.y;
      l.aim = dirOf(s.heading);
      l.heading = (l.aim * Math.PI) / 2;
    }
    l.next = -1;
    l.queued = -1;
    l.toCentre = 0;
    l.dir = 0;
    l.alive = true;
    l.hit = false;
    l.laying = false;
    l.gapLeft = 0;
  };

  const respawn = (l: Line) => {
    place(l, l.start);
    l.len = size.start;
    l.respawnAt = -1;
    l.ghostUntil = tick + Math.round((SNAKE.ghostMs / 1000) * HZ);
    resetBody(l);
    arena.hooks.respawn?.(l);
  };

  const kill = (l: Line) => {
    l.alive = false;
    l.laying = false;
    l.outTick = tick;
    if (snake) {
      l.deaths++;
      l.respawnAt = tick + Math.round((SNAKE.respawnMs / 1000) * HZ);
      // Its body stops blocking at once; the renderer fades it out.
      l.tailTick = tick + 1;
    }
    arena.hooks.out?.(l);
  };

  const grow = (l: Line, d: number) => {
    l.sinceBody += d;
    if (l.sinceBody < params.trail) return;
    l.sinceBody = 0;
    addBody(l);
  };

  const steer = (l: Line, d: number) => {
    l.heading += Math.max(-1, Math.min(1, l.dir)) * (d / params.radius);
    l.x += Math.cos(l.heading) * d;
    l.y += Math.sin(l.heading) * d;
  };

  /**
   * Along the lane grid. At each centre passed the head snaps to it exactly, takes the press
   * waiting for it, and lays a body point there.
   */
  const run = (l: Line, d: number) => {
    let left = d;
    for (let guard = 0; guard < 8 && left > 0; guard++) {
      if (l.toCentre > left) {
        l.x += DIR_X[l.aim]! * left;
        l.y += DIR_Y[l.aim]! * left;
        l.toCentre -= left;
        break;
      }
      left -= l.toCentre;
      l.x += DIR_X[l.aim]! * l.toCentre;
      l.y += DIR_Y[l.aim]! * l.toCentre;
      l.x = (Math.round(l.x / lane.w - 0.5) + 0.5) * lane.w;
      l.y = (Math.round(l.y / lane.h - 0.5) + 0.5) * lane.h;
      if (wrap) {
        l.x = wrapInto(l.x, W);
        l.y = wrapInto(l.y, H);
      }
      if (l.next >= 0) {
        l.aim = l.next;
        l.heading = (l.aim * Math.PI) / 2;
        const q = l.queued;
        l.next = q >= 0 && q !== l.aim && q !== opposite(l.aim) ? q : -1;
        l.queued = -1;
      }
      l.toCentre = l.aim % 2 === 0 ? lane.w : lane.h;
      addBody(l);
    }
  };

  /** How close a head comes to food to eat it. */
  const eatReach = EAT_REACH * params.trail;
  const occupied = (i: number) => live(i, -1, 0);

  const eat = (l: Line) => {
    for (let k = 0; k < foodCount; k++) {
      const f = food[k]!;
      if (!f.live) continue;
      if (dist2(l.x, l.y, f.x, f.y) > eatReach * eatReach) continue;
      f.live = false;
      f.born = tick + Math.round(0.4 * HZ);
      l.len = Math.min(size.max, l.len + size.grow);
      l.best = Math.max(l.best, l.len);
      l.eaten++;
      arena.hooks.eat?.(l, f.x, f.y);
    }
  };

  const placeFood = (f: Food) => {
    // Away from solid edges; on wrapping ones just clear of the seam so a dot is never cut in two.
    const margin = params.trail * (wrap ? 1.5 : 3);
    const clear = params.radius * 1.5;
    // Dots never overlap, and no head can take two at once.
    const apart = eatReach * 2;
    for (let attempt = 0; attempt < 10; attempt++) {
      let x = rng.range(margin, W - margin);
      // Keep food out of the strip where lines (re)spawn.
      let y = rng.range(margin, H - params.radius * 2.5);
      if (onGrid) {
        const c = snapToLane(x, y);
        x = c.x;
        y = c.y;
      }
      // Never where a body would already lie across the ring: only heads eat.
      if (cellAt(grid, x, y) < 0 || someCell(grid, x, y, eatReach, occupied)) continue;
      let near = false;
      for (const l of lines) {
        if (l.alive && dist2(l.x, l.y, x, y) < clear * clear) near = true;
      }
      for (let k = 0; k < foodCount; k++) {
        const g = food[k]!;
        if (g !== f && g.live && dist2(g.x, g.y, x, y) < apart * apart) near = true;
      }
      if (near) continue;
      f.x = x;
      f.y = y;
      f.live = true;
      f.born = tick;
      return;
    }
    f.born = tick + Math.round(0.25 * HZ);
  };

  const arena: Arena = {
    width: W,
    height: H,
    params,
    variant,
    fade: fadeTicks > 0,
    wrap,
    grid,
    lane,
    get lines() {
      return lines;
    },
    food,
    get tick() {
      return tick;
    },
    get time() {
      return tick / HZ;
    },
    stamps,
    get generation() {
      return generation;
    },
    hooks: {},
    speed: speedNow,

    start(starts, speedFactor) {
      generation++;
      tick = 0;
      factor = speedFactor;
      grid.clear();
      stamps.start = 0;
      stamps.count = 0;
      stamps.lost = false;
      lines = starts.slice(0, MAX_LINES).map((s, i) => {
        const l = pool[i]!;
        place(l, s);
        l.outTick = -1;
        // Stagger the first gaps so the lines don't all open together.
        l.nextGap = Math.round(rng.range(1.2, GAP_EVERY_S[1]) * HZ);
        l.ghostUntil = 0;
        l.len = size.start;
        l.best = size.start;
        l.eaten = 0;
        l.deaths = 0;
        l.respawnAt = -1;
        resetBody(l);
        return l;
      });
      // More food on a bigger floor, and a little more with more snakes.
      const spread = Math.round((W * H) / 900_000 + lines.length / 2);
      foodCount = snake ? Math.min(MAX_FOOD, Math.max(4, spread)) : 0;
      for (const f of food) {
        f.live = false;
        f.born = 0;
      }
    },

    step() {
      tick++;
      const v = speedNow();
      const d = v / HZ;
      const half = params.trail / 2;
      // Heads lay and test the cells this close. On the grid that is half a lane, so a lane is
      // filled from side to side and neighbouring lanes stay apart.
      const near = onGrid ? Math.min(lane.w, lane.h) / 2 : half;
      skip = Math.ceil((near * 3.2) / Math.max(1e-6, d)) + 1;

      for (const l of lines) {
        if (!l.alive) {
          if (snake && l.respawnAt >= 0 && tick >= l.respawnAt) respawn(l);
          continue;
        }
        l.px = l.x;
        l.py = l.y;
        if (onGrid) run(l, d);
        else steer(l, d);
        if (wrap) {
          l.x = wrapInto(l.x, W);
          l.y = wrapInto(l.y, H);
        }
        if (gapsOn) {
          if (l.gapLeft > 0) l.gapLeft -= d;
          else if (tick >= l.nextGap) {
            l.gapLeft = GAP_WIDTHS * params.trail;
            l.nextGap = tick + gapTicks();
          }
        }
        l.laying = l.gapLeft <= 0 && tick >= l.ghostUntil;
        l.hit = false;
      }

      for (const l of lines) {
        if (!l.alive || tick < l.ghostUntil) continue;
        if (!wrap && (l.x < half || l.y < half || l.x > W - half || l.y > H - half)) {
          l.hit = true;
          continue;
        }
        probeSelf = l.id;
        l.hit = someCell(grid, l.x, l.y, near, probe);
      }
      // Grid heads side by side in neighbouring rows are a lane apart, which must not count.
      const reach = onGrid ? Math.min(params.trail, 0.9 * Math.min(lane.w, lane.h)) : params.trail;
      const touch = reach * reach;
      for (let a = 0; a < lines.length; a++) {
        const la = lines[a]!;
        if (!la.alive || tick < la.ghostUntil) continue;
        for (let b = a + 1; b < lines.length; b++) {
          const lb = lines[b]!;
          if (!lb.alive || tick < lb.ghostUntil) continue;
          if (dist2(la.x, la.y, lb.x, lb.y) < touch) {
            la.hit = true;
            lb.hit = true;
          }
        }
      }
      for (const l of lines) if (l.alive && l.hit) kill(l);

      for (const l of lines) {
        if (!l.alive) continue;
        if (l.laying) {
          markOwner = l.id + 1;
          someCell(grid, l.x, l.y, near, mark);
          if (!snake) pushStamp(l);
        }
        if (snake) {
          if (!onGrid) grow(l, d);
          eat(l);
        }
      }
      if (snake) {
        for (let k = 0; k < foodCount; k++) {
          const f = food[k]!;
          if (!f.live && tick >= f.born) placeFood(f);
        }
      }
    },

    press(l, d) {
      if (!onGrid || !l.alive || !Number.isInteger(d) || d < 0 || d > 3) return;
      const base = l.next >= 0 ? l.next : l.aim;
      // The way it is already going, or straight back into its own body.
      if (d === base || d === opposite(base)) return;
      if (l.next < 0) l.next = d;
      else l.queued = d;
    },

    alive() {
      let n = 0;
      for (const l of lines) if (l.alive) n++;
      return n;
    },

    finished() {
      if (snake || lines.length === 0) return false;
      return arena.alive() <= (lines.length > 1 ? 1 : 0);
    },

    blocks(index, self) {
      return index >= 0 && live(index, self, skip);
    },

    bodyPoint(line, k) {
      const idx = (line.bodyStart + k) % BODY_CAP;
      point.x = line.bodyX[idx]!;
      point.y = line.bodyY[idx]!;
      return point;
    },

    clear() {
      generation++;
      lines = [];
      tick = 0;
      grid.clear();
      stamps.start = 0;
      stamps.count = 0;
      stamps.lost = false;
      for (const f of food) f.live = false;
      foodCount = 0;
    },
  };
  return arena;
};

/** Standard competition placings (1 is best; ties share) for the lines of a finished round. */
export const placings = (lines: readonly Line[], variant: Variant): number[] => {
  const score = (l: Line) => (snakeRules(variant) ? l.len : l.alive ? Infinity : l.outTick);
  return lines.map((l) => 1 + lines.filter((m) => score(m) > score(l)).length);
};
