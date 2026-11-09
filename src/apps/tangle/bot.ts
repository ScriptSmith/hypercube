/**
 * Bot steering. Every so often (a reaction time) a bot probes three ways ahead in the occupancy
 * grid: straight on, and turning hard left or right. On open ground it holds its course with
 * the odd gentle swerve, or in `snake` heads for the nearest food. When something is in the way
 * it compares how much room each way leads to (a small flood fill, so it doesn't turn into a
 * pocket) and takes the roomiest. Slow reactions, a short look-ahead and the odd missed look
 * keep it beatable by a child.
 *
 * In `grid` a bot looks along the lane grid instead: from the centre where its next press
 * would take effect, how far each of the three ways it may go is clear and how much room it
 * leads to, and which way brings it nearer the closest food. On wrapping arenas every look
 * carries on across the edges.
 */
import type { Rng } from "../../core/types";
import { type Arena, DIR_X, DIR_Y, type Line, opposite } from "./arena";
import { HZ } from "./config";
import { cellAt } from "./grid";
import { wrapDelta, wrapInto } from "./wrap";

export interface Brain {
  /** Arena tick of the next decision. */
  next: number;
  dir: number;
  /** A swerve held for a while on open ground, so bot lines curve. */
  wander: number;
  wanderUntil: number;
}

export interface Skill {
  /** Seconds between decisions. */
  reaction: readonly [number, number];
  /** Chance of missing a decision and carrying on as before. */
  slip: number;
  /** Look-ahead, in turning radii. */
  sight: number;
}

export const SKILL: Skill = { reaction: [0.12, 0.26], slip: 0.08, sight: 5 };

/** Flood fills stop after this many cells (each a trail width square). */
const ROOM_LIMIT = 700;

export const createBrain = (): Brain => ({ next: 0, dir: 0, wander: 0, wanderUntil: 0 });

const blockedAt = (arena: Arena, line: Line, x: number, y: number) => {
  if (!arena.wrap) {
    const half = arena.params.trail / 2;
    if (x < half || y < half || x > arena.width - half || y > arena.height - half) return true;
  }
  return arena.blocks(cellAt(arena.grid, x, y), line.id);
};

const end = { x: 0, y: 0 };

/**
 * Free distance from the head when turning `dir` for `hold` units of travel and then running
 * straight, up to `max`. Leaves the last free point in `end`.
 */
export const probe = (arena: Arena, line: Line, dir: number, hold: number, max: number): number => {
  const step = arena.grid.cell;
  const turn = (dir * step) / arena.params.radius;
  let h = line.heading;
  let x = line.x;
  let y = line.y;
  end.x = x;
  end.y = y;
  for (let d = step; d <= max; d += step) {
    if (d <= hold) h += turn;
    x += Math.cos(h) * step;
    y += Math.sin(h) * step;
    // The first trail width ahead is the head's own fresh trail when turning hard.
    if (d > arena.params.trail && blockedAt(arena, line, x, y)) return d;
    end.x = x;
    end.y = y;
  }
  return max;
};

interface Scratch {
  cols: number;
  rows: number;
  seen: Uint32Array;
  queue: Int32Array;
  mark: number;
}
const scratches = new WeakMap<Arena, Scratch>();

/**
 * Cells about a trail wide reachable from (x, y), up to ROOM_LIMIT: lane cells on the grid or
 * a wrapping arena, otherwise trail-sized squares from the top left.
 */
export const room = (arena: Arena, line: Line, x: number, y: number): number => {
  const wrap = arena.wrap;
  const lanes = wrap || arena.variant === "grid";
  const size = arena.params.trail;
  const w = lanes ? arena.lane.w : size;
  const h = lanes ? arena.lane.h : size;
  const cols = lanes ? arena.lane.cols : Math.ceil(arena.width / size);
  const rows = lanes ? arena.lane.rows : Math.ceil(arena.height / size);
  let s = scratches.get(arena);
  if (!s) {
    s = {
      cols,
      rows,
      seen: new Uint32Array(cols * rows),
      queue: new Int32Array(ROOM_LIMIT + 8),
      mark: 0,
    };
    scratches.set(arena, s);
  }
  s.mark = (s.mark + 1) >>> 0 || 1;
  const { seen, queue } = s;
  const i0 = Math.floor((wrap ? wrapInto(x, arena.width) : x) / w);
  const j0 = Math.floor((wrap ? wrapInto(y, arena.height) : y) / h);
  if (i0 < 0 || j0 < 0 || i0 >= cols || j0 >= rows) return 0;
  let head = 0;
  let tail = 0;
  queue[tail++] = j0 * cols + i0;
  seen[j0 * cols + i0] = s.mark;
  while (head < tail && tail < ROOM_LIMIT) {
    const c = queue[head++]!;
    const ci = c % cols;
    const cj = (c - ci) / cols;
    for (let k = 0; k < 4; k++) {
      let ni = ci + DIR_X[k]!;
      let nj = cj + DIR_Y[k]!;
      if (wrap) {
        ni = (ni + cols) % cols;
        nj = (nj + rows) % rows;
      } else if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (seen[n] === s.mark) continue;
      seen[n] = s.mark;
      if (blockedAt(arena, line, (ni + 0.5) * w, (nj + 0.5) * h)) continue;
      queue[tail++] = n;
      if (tail >= ROOM_LIMIT) break;
    }
  }
  return tail;
};

const wrap = (a: number) => {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
};

const toFood = { dx: 0, dy: 0 };

/** The offset from (x, y) to the nearest live food, the short way round, in `toFood`; or null. */
const nearestFood = (arena: Arena, x: number, y: number) => {
  let bestD = Infinity;
  for (const f of arena.food) {
    if (!f.live) continue;
    const dx = arena.wrap ? wrapDelta(f.x - x, arena.width) : f.x - x;
    const dy = arena.wrap ? wrapDelta(f.y - y, arena.height) : f.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      toFood.dx = dx;
      toFood.dy = dy;
    }
  }
  return bestD < Infinity ? toFood : null;
};

/** The steering a bot wants now. */
export const think = (arena: Arena, line: Line, brain: Brain, rng: Rng, skill = SKILL): number => {
  if (arena.tick < brain.next) return brain.dir;
  brain.next =
    arena.tick + Math.max(1, Math.round(rng.range(skill.reaction[0], skill.reaction[1]) * HZ));
  const r = arena.params.radius;
  const max = skill.sight * r;
  const quarter = (Math.PI / 2) * r;
  const options = [-1, 0, 1] as const;
  const reach = options.map((d) =>
    d === 0
      ? probe(arena, line, 0, 0, max)
      : Math.max(probe(arena, line, d, quarter, max), probe(arena, line, d, quarter * 2, max)),
  );
  const [left, straight, right] = reach as [number, number, number];

  let dir: number;
  if (rng.next() < skill.slip) {
    // A moment's inattention: carry on as before until the next look.
    dir = brain.dir;
  } else if (straight >= max && left >= max * 0.8 && right >= max * 0.8) {
    const food = arena.variant === "snake" ? nearestFood(arena, line.x, line.y) : null;
    if (food) {
      const diff = wrap(Math.atan2(food.dy, food.dx) - line.heading);
      dir = Math.abs(diff) < 0.15 ? 0 : Math.sign(diff);
    } else {
      if (arena.tick >= brain.wanderUntil) {
        // A swerve is always followed by a straight run, so the bot never circles into itself.
        const roll = rng.next();
        brain.wander = brain.wander !== 0 || roll < 0.6 ? 0 : roll < 0.8 ? -1 : 1;
        brain.wanderUntil =
          arena.tick +
          Math.round(rng.range(brain.wander ? 0.15 : 0.6, brain.wander ? 0.45 : 1.6) * HZ);
      }
      dir = brain.wander !== 0 && reach[brain.wander + 1]! >= max ? brain.wander : 0;
    }
  } else {
    // How much room each way leads to, measured a little way along it, then how far it is clear.
    // A way clear for less than `safe` leaves no room to turn later, so it only wins if
    // nothing else is better.
    const lead = r * 1.4;
    const safe = r * 2.5;
    const scores = options.map((d, i) => {
      if (reach[i]! < lead) return reach[i]!;
      probe(arena, line, d, d === 0 ? 0 : lead, lead);
      const viable = reach[i]! >= safe ? ROOM_LIMIT * max * 2 : 0;
      return viable + room(arena, line, end.x, end.y) * max + reach[i]!;
    });
    const best = Math.max(...scores);
    const good = (i: number) => scores[i]! >= best * 0.97;
    // Among ways nearly as good as the best: straight on, else the turn already under way, so
    // the bot neither circles for no reason nor dithers.
    const current = options.indexOf(brain.dir as -1 | 0 | 1);
    if (good(1)) dir = 0;
    else if (current >= 0 && good(current)) dir = brain.dir;
    else dir = options[scores.indexOf(best)]!;
  }
  brain.dir = dir;
  return dir;
};

/** Free lane cells from (x, y) going `d`, not counting the cell it starts in, up to `max`. */
export const runway = (
  arena: Arena,
  line: Line,
  x: number,
  y: number,
  d: number,
  max: number,
): number => {
  const sx = DIR_X[d]! * arena.lane.w;
  const sy = DIR_Y[d]! * arena.lane.h;
  for (let k = 1; k <= max; k++) {
    if (blockedAt(arena, line, x + sx * k, y + sy * k)) return k - 1;
  }
  return max;
};

/**
 * The direction a `grid` bot wants to press now, or -1 to carry on. It decides at most once per
 * reaction time and only when no press of its own is still waiting for a centre.
 */
export const thinkGrid = (
  arena: Arena,
  line: Line,
  brain: Brain,
  rng: Rng,
  skill = SKILL,
): number => {
  if (arena.tick < brain.next || line.next >= 0) return -1;
  brain.next =
    arena.tick + Math.max(1, Math.round(rng.range(skill.reaction[0], skill.reaction[1]) * HZ));
  if (rng.next() < skill.slip) return -1;
  const { w, h } = arena.lane;
  // The centre the head is making for: a press now takes effect there.
  const cx = line.x + DIR_X[line.aim]! * line.toCentre;
  const cy = line.y + DIR_Y[line.aim]! * line.toCentre;
  const max = Math.max(4, Math.round((skill.sight * arena.params.radius) / Math.min(w, h)));
  // Less clear road than this leaves no room to turn again.
  const safe = Math.min(6, max);
  const food = nearestFood(arena, cx, cy);
  let best = -1;
  let bestScore = -Infinity;
  for (let k = 0; k < 4; k++) {
    const d = (line.aim + k) & 3;
    if (d === opposite(line.aim)) continue;
    const reach = runway(arena, line, cx, cy, d, max);
    let score = reach;
    if (reach > 0) {
      const space = room(arena, line, cx + DIR_X[d]! * w, cy + DIR_Y[d]! * h);
      score += (reach >= safe ? 1e6 : 0) + space * 100;
      if (food) {
        const cell = Math.min(w, h) * 0.5;
        const ahead = DIR_X[line.aim]! * food.dx + DIR_Y[line.aim]! * food.dy;
        // Food this way; or behind, so either turn is a start.
        if (DIR_X[d]! * food.dx + DIR_Y[d]! * food.dy > cell) score += 30_000;
        else if (d !== line.aim && ahead < -cell) score += 10_000;
      }
      // Going on as before wins a near tie, so bots don't zigzag.
      if (d === line.aim) score += 500;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best === line.aim ? -1 : best;
};
