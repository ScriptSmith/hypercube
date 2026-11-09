/**
 * Mazes, our own generator. A maze is a spanning tree of a grid of cells carved by a growing
 * tree (mostly the newest cell, sometimes a random one, for long corridors with some branches),
 * so there is exactly one way from any cell to any other. The start is a corner and the goal the
 * cell farthest from it. Levels grow the grid from a few wide corridors to about 8 by 10.
 *
 * Board space is metres with the board's centre at the origin, x to the right and z towards the
 * viewer; row 0 is the far side. The board is a fixed size whatever the level, so cells shrink as
 * levels rise, and the ball, walls and holes are sized from the cells.
 *
 * Holes (the `holes` variant, from level 2) go in straight corridor cells on the way, against one
 * wall, leaving a lane at least a ball wide beside them, or in the middle of dead ends, which
 * nothing has to pass.
 */
import type { Rng } from "../../core/types";

export type Orient = "portrait" | "landscape";

/** Playing area inside the rim, metres. */
export const BOARD: Record<Orient, { w: number; d: number }> = {
  portrait: { w: 0.4, d: 0.5 },
  landscape: { w: 0.5, d: 0.4 },
};
/** The rim around the playing area. */
export const RIM = 0.024;

/** Grid size by level, as (short side, long side) cells. */
const SIZES: readonly [number, number][] = [
  [3, 4],
  [4, 5],
  [5, 6],
  [5, 7],
  [6, 8],
  [7, 8],
  [7, 9],
  [8, 10],
];

export const dimsFor = (level: number, orient: Orient): { cols: number; rows: number } => {
  const i = Math.min(SIZES.length, Math.max(1, Math.round(level))) - 1;
  const [a, b] = SIZES[i] ?? [3, 4];
  return orient === "portrait" ? { cols: a, rows: b } : { cols: b, rows: a };
};

/** Open sides of a cell. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
const DIRS = [
  { bit: N, back: S, dc: 0, dr: -1 },
  { bit: E, back: W, dc: 1, dr: 0 },
  { bit: S, back: N, dc: 0, dr: 1 },
  { bit: W, back: E, dc: -1, dr: 0 },
] as const;

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Part of the outer rim rather than an inner wall. */
  rim: boolean;
}

export interface Hole {
  x: number;
  z: number;
  r: number;
  cell: number;
  /** On the way (beside a lane) rather than in a dead end. */
  onPath: boolean;
}

export interface Maze {
  level: number;
  orient: Orient;
  cols: number;
  rows: number;
  /** Playing area and cell size, metres. */
  w: number;
  d: number;
  sx: number;
  sz: number;
  /** Ball radius, wall thickness and wall height. */
  r: number;
  wall: number;
  wallH: number;
  /** Open sides per cell (N, E, S, W bits). */
  open: Uint8Array;
  start: number;
  goal: number;
  /** The next cell towards the goal from each cell, -1 at the goal. */
  next: Int16Array;
  /** Steps to the goal from each cell. */
  dist: Int16Array;
  /** Cells from the start to the goal. */
  path: number[];
  goalR: number;
  holes: Hole[];
  boxes: Box[];
  /** Box and hole indices that can touch a ball whose centre is in each cell. */
  cellBoxes: number[][];
  cellHoles: number[][];
  /**
   * Across-the-way offset of the clear lane beside a hole on the way, per cell (0 elsewhere),
   * along +x for a cell travelled along z and +z for one travelled along x.
   */
  lane: Float32Array;
}

export const cellCentre = (m: Pick<Maze, "cols" | "w" | "d" | "sx" | "sz">, cell: number) => {
  const c = cell % m.cols;
  const r = Math.floor(cell / m.cols);
  return { x: -m.w / 2 + (c + 0.5) * m.sx, z: -m.d / 2 + (r + 0.5) * m.sz };
};

export const cellAt = (
  m: Pick<Maze, "cols" | "rows" | "w" | "d" | "sx" | "sz">,
  x: number,
  z: number,
): number => {
  const c = Math.min(m.cols - 1, Math.max(0, Math.floor((x + m.w / 2) / m.sx)));
  const r = Math.min(m.rows - 1, Math.max(0, Math.floor((z + m.d / 2) / m.sz)));
  return r * m.cols + c;
};

/** Ball radius for a cell size; capped so the first levels' big corridors don't get a huge ball. */
export const ballRadius = (cell: number) => Math.min(0.15 * cell, 0.017);
export const HOLE_K = 1.25;
export const GOAL_K = 1.5;

const carve = (cols: number, rows: number, rng: Rng): Uint8Array => {
  const n = cols * rows;
  const open = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const first = rng.int(n);
  const active = [first];
  seen[first] = 1;
  while (active.length > 0) {
    // Mostly the newest cell (long corridors), sometimes a random one (branches).
    const k = rng.next() < 0.7 ? active.length - 1 : rng.int(active.length);
    const cell = active[k]!;
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    const options = DIRS.filter((d) => {
      const nc = c + d.dc;
      const nr = r + d.dr;
      return nc >= 0 && nc < cols && nr >= 0 && nr < rows && !seen[nr * cols + nc];
    });
    if (options.length === 0) {
      active.splice(k, 1);
      continue;
    }
    const d = rng.pick(options);
    const nb = (r + d.dr) * cols + c + d.dc;
    open[cell]! |= d.bit;
    open[nb]! |= d.back;
    seen[nb] = 1;
    active.push(nb);
  }
  return open;
};

/** Steps from `from` to every cell through open sides, and the step back towards `from`. */
const flood = (cols: number, rows: number, open: Uint8Array, from: number) => {
  const n = cols * rows;
  const dist = new Int16Array(n).fill(-1);
  const toward = new Int16Array(n).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q]!;
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    for (const d of DIRS) {
      if (!(open[cell]! & d.bit)) continue;
      const nb = (r + d.dr) * cols + c + d.dc;
      if (dist[nb] !== -1) continue;
      dist[nb] = dist[cell]! + 1;
      toward[nb] = cell;
      queue.push(nb);
    }
  }
  return { dist, toward };
};

/** Build the wall boxes: runs of walled cell edges merged along each grid line. */
const buildBoxes = (m: Pick<Maze, "cols" | "rows" | "w" | "d" | "sx" | "sz" | "wall" | "open">) => {
  const { cols, rows, w, d, sx, sz, wall, open } = m;
  const half = wall / 2;
  const boxes: Box[] = [];
  const x0 = -w / 2;
  const z0 = -d / 2;
  // Lines across (constant z), j = 0 (far rim) to rows (near rim).
  for (let j = 0; j <= rows; j++) {
    const z = z0 + j * sz;
    const rim = j === 0 || j === rows;
    let run = -1;
    for (let c = 0; c <= cols; c++) {
      const walled = c < cols && (rim || !(open[j * cols + c]! & N));
      if (walled && run < 0) run = c;
      if (!walled && run >= 0) {
        boxes.push({
          x0: x0 + run * sx - half - (rim ? RIM : 0),
          x1: x0 + c * sx + half + (rim ? RIM : 0),
          z0: j === 0 ? z - RIM : z - half,
          z1: j === rows ? z + RIM : z + half,
          rim,
        });
        run = -1;
      }
    }
  }
  // Lines along (constant x), i = 0 (left rim) to cols (right rim).
  for (let i = 0; i <= cols; i++) {
    const x = x0 + i * sx;
    const rim = i === 0 || i === cols;
    let run = -1;
    for (let r = 0; r <= rows; r++) {
      const walled = r < rows && (rim || !(open[r * cols + i]! & W));
      if (walled && run < 0) run = r;
      if (!walled && run >= 0) {
        boxes.push({
          x0: i === 0 ? x - RIM : x - half,
          x1: i === cols ? x + RIM : x + half,
          z0: z0 + run * sz - half,
          z1: z0 + r * sz + half,
          rim,
        });
        run = -1;
      }
    }
  }
  return boxes;
};

const near = (b: Box, x0: number, x1: number, z0: number, z1: number) =>
  b.x1 >= x0 && b.x0 <= x1 && b.z1 >= z0 && b.z0 <= z1;

export interface MazeOptions {
  level: number;
  orient: Orient;
  holes: boolean;
  rng: Rng;
}

export const generateMaze = (o: MazeOptions): Maze => {
  const level = Math.max(1, Math.round(o.level));
  const { cols, rows } = dimsFor(level, o.orient);
  const { w, d } = BOARD[o.orient];
  const sx = w / cols;
  const sz = d / rows;
  const small = Math.min(sx, sz);
  const r = ballRadius(small);
  const wall = Math.min(0.012, Math.max(0.004, 0.12 * small));
  const open = carve(cols, rows, o.rng);
  const corners = [0, cols - 1, (rows - 1) * cols, rows * cols - 1];
  const start = o.rng.pick(corners);
  const fromStart = flood(cols, rows, open, start);
  let far = 0;
  const best: number[] = [];
  fromStart.dist.forEach((v, i) => {
    if (v > far) {
      far = v;
      best.length = 0;
    }
    if (v === far) best.push(i);
  });
  const goal = o.rng.pick(best.length > 0 ? best : [rows * cols - 1]);
  const toGoal = flood(cols, rows, open, goal);
  const path: number[] = [];
  for (let c = start; c !== -1 && path.length <= cols * rows; c = toGoal.toward[c]!) path.push(c);

  const base = { cols, rows, w, d, sx, sz, wall, open };
  const boxes = buildBoxes(base);
  const lane = new Float32Array(cols * rows);
  const holes: Hole[] = [];
  const holeR = HOLE_K * r;
  if (o.holes && level >= 2) {
    const want = Math.min(6, level - 1);
    const onWay: { cell: number; alongX: boolean }[] = [];
    for (let i = 2; i < path.length - 2; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const c = path[i + 1]!;
      if (b - a === c - b) onWay.push({ cell: b, alongX: Math.abs(b - a) === 1 });
    }
    const ends: number[] = [];
    const onPath = new Set(path);
    for (let i = 0; i < cols * rows; i++) {
      const bits = open[i]!;
      if (onPath.has(i) || (bits & (bits - 1)) !== 0) continue;
      ends.push(i);
    }
    const taken: number[] = [];
    const clear = (cell: number) =>
      taken.every((t) => {
        const dc = Math.abs((t % cols) - (cell % cols));
        const dr = Math.abs(Math.floor(t / cols) - Math.floor(cell / cols));
        return dc + dr >= 2;
      });
    const ways = [...onWay];
    const deads = [...ends];
    for (let k = 0; holes.length < want && (ways.length > 0 || deads.length > 0); k++) {
      // Alternate between the way and dead ends, so holes are both obstacles and traps.
      const fromWay = (k % 3 !== 2 && ways.length > 0) || deads.length === 0;
      if (fromWay) {
        const { cell, alongX } = ways.splice(o.rng.int(ways.length), 1)[0]!;
        if (!clear(cell)) continue;
        // Only against a wall: in front of a side opening, a ball coming out of it couldn't pass.
        const bits = open[cell]!;
        const sides = (alongX ? [N, S] : [W, E]).filter((bit) => !(bits & bit));
        if (sides.length === 0) continue;
        const bit = sides.length === 1 ? sides[0]! : o.rng.pick(sides);
        const side = bit === N || bit === W ? -1 : 1;
        const ctr = cellCentre(base, cell);
        // Across the way: z for a cell travelled along x, else x.
        const across = alongX ? sz : sx;
        const clearW = across - wall;
        const off = side * (clearW / 2 - holeR);
        holes.push({
          x: alongX ? ctr.x : ctr.x + off,
          z: alongX ? ctr.z + off : ctr.z,
          r: holeR,
          cell,
          onPath: true,
        });
        lane[cell] = -side * (holeR - r / 2);
        taken.push(cell);
      } else {
        const cell = deads.splice(o.rng.int(deads.length), 1)[0]!;
        if (!clear(cell) || cell === start || cell === goal) continue;
        const ctr = cellCentre(base, cell);
        holes.push({ x: ctr.x, z: ctr.z, r: holeR, cell, onPath: false });
        taken.push(cell);
      }
    }
  }

  const cellBoxes: number[][] = [];
  const cellHoles: number[][] = [];
  const pad = r + wall;
  for (let i = 0; i < cols * rows; i++) {
    const c = i % cols;
    const row = Math.floor(i / cols);
    const x0 = -w / 2 + c * sx - pad;
    const x1 = -w / 2 + (c + 1) * sx + pad;
    const z0 = -d / 2 + row * sz - pad;
    const z1 = -d / 2 + (row + 1) * sz + pad;
    const list: number[] = [];
    boxes.forEach((b, k) => {
      if (near(b, x0, x1, z0, z1)) list.push(k);
    });
    cellBoxes.push(list);
    const hs: number[] = [];
    holes.forEach((h, k) => {
      if (h.x + h.r >= x0 && h.x - h.r <= x1 && h.z + h.r >= z0 && h.z - h.r <= z1) hs.push(k);
    });
    cellHoles.push(hs);
  }

  return {
    level,
    orient: o.orient,
    cols,
    rows,
    w,
    d,
    sx,
    sz,
    r,
    wall,
    wallH: Math.max(0.012, 1.5 * r),
    open,
    start,
    goal,
    next: toGoal.toward,
    dist: toGoal.dist,
    path,
    goalR: GOAL_K * r,
    holes,
    boxes,
    cellBoxes,
    cellHoles,
    lane,
  };
};
