/**
 * Conway's Game of Life (B3/S23, after Gardner 1970) as a CPU reference. The GPU step in
 * `gpu/life.ts` follows exactly these rules, including the cosmetic colour of births and the
 * one departure from the rules: debris that has sat unchanged for about two minutes fades away.
 *
 * Per cell: `alive`, `color` (whose stamp it came from), `persist` (how long the cell has been
 * alive or nearly so, counted every `every` generations) and `since` (generations since it was
 * last alive). A cell that dies and stays dead for more than three generations resets `persist`,
 * so gliders passing over it never build any up; still lifes and short-period oscillators do.
 */

/** Pattern cells as [x, y] with y pointing down, as written in the usual pictures. */
export type Cells = readonly (readonly [number, number])[];

export interface Pattern {
  readonly cells: Cells;
  readonly width: number;
  readonly height: number;
}

/** Parse rows of `O` (alive) and `.` (dead). */
export const parse = (rows: readonly string[]): Pattern => {
  const cells: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "O") cells.push([x, y]);
  });
  return {
    cells,
    width: Math.max(...rows.map((r) => r.length)),
    height: rows.length,
  };
};

/** Moves one cell diagonally every four generations. */
export const GLIDER = parse([".O.", "..O", "OOO"]);
/** Lightweight spaceship: moves two cells every four generations. */
export const LWSS = parse([".O..O", "O....", "O...O", "OOOO."]);
/** The R-pentomino: a methuselah that blooms for 1103 generations. */
export const R_PENTOMINO = parse([".OO", "OO.", ".O."]);
/** Diehard: burns for 130 generations and vanishes. */
export const DIEHARD = parse(["......O.", "OO......", ".O...OOO"]);

/** Generations a debris cell must persist before it fades, at the default 12 generations a second. */
export const FADE_GENERATIONS = 1440;
/** `persist` saturates well above the fade threshold, so a byte holds it. */
export const FADE_AT = 180;
/** A cell dead for more than this many generations no longer counts as persisting. */
export const QUIET_GAP = 3;

/** How often (in generations) `persist` counts up, so debris fades after about two minutes. */
export const persistEvery = (gensPerSecond: number): number =>
  Math.max(1, Math.round((gensPerSecond * 120) / FADE_AT));

/** 32-bit integer hash shared with the shaders (all arithmetic wraps at 2^32). */
export const hash3 = (x: number, y: number, z: number): number => {
  let h = (Math.imul(x | 0, 0x165667b1) + Math.imul(y | 0, 0x27d4eb2f)) >>> 0;
  h = (h + Math.imul(z | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * Majority colour of a birth's three parents, in neighbour scan order. When all three differ the
 * pick comes from a hash of the cell and generation, so no direction is favoured.
 */
export const majority = (a: number, b: number, c: number, x: number, y: number, gen: number) => {
  if (a === b || a === c) return a;
  if (b === c) return b;
  const k = hash3(x, y, gen) % 3;
  return k === 0 ? a : k === 1 ? b : c;
};

/** Neighbour order used for colours, on the CPU and the GPU alike. */
export const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export interface LifeGrid {
  readonly width: number;
  readonly height: number;
  alive: Uint8Array;
  color: Uint8Array;
  persist: Uint8Array;
  /** The generation each cell was last alive (very negative if never), so `since` needs no updates. */
  lastAlive: Float64Array;
  /** Generations stepped so far. */
  gen: number;
  /**
   * Per row, the span of cells that can change (alive or with `persist` running), so a step
   * visits only those. Null means unknown; the next step scans for it.
   */
  rows: { lo: Int32Array; hi: Int32Array } | null;
}

const NEVER = -1e9;

export const createGrid = (width: number, height: number): LifeGrid => ({
  width,
  height,
  alive: new Uint8Array(width * height),
  color: new Uint8Array(width * height),
  persist: new Uint8Array(width * height),
  lastAlive: new Float64Array(width * height).fill(NEVER),
  gen: 0,
  rows: null,
});

/** Generations since cell `i` was last alive, as the GPU's byte holds it. */
export const sinceOf = (g: LifeGrid, i: number): number =>
  Math.min(255, g.gen - (g.lastAlive[i] ?? NEVER));

/** Make one cell alive with a colour, as a stamp does. */
export const setCell = (g: LifeGrid, x: number, y: number, color: number): void => {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return;
  const i = y * g.width + x;
  g.alive[i] = 1;
  g.color[i] = color;
  g.persist[i] = 0;
  g.lastAlive[i] = g.gen;
  g.rows = null;
};

export interface Transform {
  /** Quarter turns clockwise (with y down). */
  rot: number;
  mirror: boolean;
}

/** Where pattern cell (px, py) lands relative to the stamp's origin. */
export const transformCell = (
  p: Pattern,
  px: number,
  py: number,
  t: Transform,
): [number, number] => {
  let x = px - Math.floor(p.width / 2);
  let y = py - Math.floor(p.height / 2);
  if (t.mirror) x = -x;
  for (let i = 0; i < ((t.rot % 4) + 4) % 4; i++) [x, y] = [-y, x];
  return [x, y];
};

/** Set a pattern's cells alive at (ox, oy) with a colour. Cells off the grid are dropped. */
export const place = (
  g: LifeGrid,
  p: Pattern,
  ox: number,
  oy: number,
  color: number,
  t: Transform = { rot: 0, mirror: false },
): void => {
  for (const [px, py] of p.cells) {
    const [dx, dy] = transformCell(p, px, py, t);
    setCell(g, ox + dx, oy + dy, color);
  }
};

/**
 * Cells of a random soup blob: a disc of `radius` cells, each alive with probability `density`,
 * decided by the shared hash so the GPU places exactly the same cells.
 */
export const soupCells = (radius: number, density: number, seed: number): [number, number][] => {
  const out: [number, number][] = [];
  const r = Math.ceil(radius);
  const threshold = Math.floor(density * 65536);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > radius * radius) continue;
      if ((hash3(x + 4096, y + 4096, seed) & 0xffff) < threshold) out.push([x, y]);
    }
  }
  return out;
};

export interface StepOptions {
  /** Count `persist` up every this many generations. */
  every: number;
  /** Debris fade. Off for checks against published Life results. */
  fade: boolean;
  /** Cells outside this disc (centre and radius in cells) stay dead. */
  mask?: { x: number; y: number; r: number };
}

const DEFAULT_STEP: StepOptions = { every: persistEvery(12), fade: true };

/**
 * One generation. Cells outside the grid are dead. Rows are updated in place from copies of the
 * row above and the row itself, and only across the spans where something can change, so sparse
 * patterns on big grids are cheap.
 */
export const step = (g: LifeGrid, opts: StepOptions = DEFAULT_STEP): void => {
  const { width: W, height: H } = g;
  const gen = g.gen + 1;
  const tick = gen % opts.every === 0;
  g.rows ??= scanRows(g);
  const { lo, hi } = g.rows;
  const nextLo = new Int32Array(H).fill(W);
  const nextHi = new Int32Array(H).fill(-1);
  const prevAlive = new Uint8Array(W + 2);
  const prevColor = new Uint8Array(W + 2);
  const prevFade = new Uint8Array(W + 2);
  const curAlive = new Uint8Array(W + 2);
  const curColor = new Uint8Array(W + 2);
  const curFade = new Uint8Array(W + 2);
  const m = opts.mask;
  // Copies are offset by one so x - 1 and x + 1 never leave them.
  let prevLo = 0;
  let prevHi = -1;
  for (let y = 0; y < H; y++) {
    let a =
      Math.min(lo[y] ?? W, y > 0 ? (lo[y - 1] ?? W) : W, y < H - 1 ? (lo[y + 1] ?? W) : W) - 1;
    let b =
      Math.max(hi[y] ?? -1, y > 0 ? (hi[y - 1] ?? -1) : -1, y < H - 1 ? (hi[y + 1] ?? -1) : -1) + 1;
    a = Math.max(0, a);
    b = Math.min(W - 1, b);
    curAlive.fill(0);
    curColor.fill(0);
    curFade.fill(0);
    if (a > b) {
      prevAlive.set(curAlive);
      prevColor.set(curColor);
      prevFade.set(curFade);
      prevLo = 0;
      prevHi = -1;
      continue;
    }
    // The original row, a cell either side of the span.
    const ca = Math.max(0, a - 1);
    const cb = Math.min(W - 1, b + 1);
    for (let x = ca; x <= cb; x++) {
      const i = y * W + x;
      curAlive[x + 1] = g.alive[i] ?? 0;
      curColor[x + 1] = g.color[i] ?? 0;
      curFade[x + 1] = (g.persist[i] ?? 0) >= FADE_AT ? 1 : 0;
    }
    const below = y + 1 < H ? (y + 1) * W : -1;
    for (let x = a; x <= b; x++) {
      const i = y * W + x;
      let n = 0;
      let c0 = 0;
      let c1 = 0;
      let c2 = 0;
      let nearFade = false;
      const look = (alive: number, color: number, fade: number) => {
        if (!alive) return;
        if (n === 0) c0 = color;
        else if (n === 1) c1 = color;
        else if (n === 2) c2 = color;
        n++;
        if (fade) nearFade = true;
      };
      const inPrev = (k: number) => y > 0 && k >= prevLo && k <= prevHi;
      for (const dx of [-1, 0, 1]) {
        const k = x + dx;
        if (k < 0 || k >= W) continue;
        if (inPrev(k)) look(prevAlive[k + 1]!, prevColor[k + 1]!, prevFade[k + 1]!);
      }
      if (x > 0) look(curAlive[x]!, curColor[x]!, curFade[x]!);
      if (x < W - 1) look(curAlive[x + 2]!, curColor[x + 2]!, curFade[x + 2]!);
      if (below >= 0) {
        for (const dx of [-1, 0, 1]) {
          const k = x + dx;
          if (k < 0 || k >= W) continue;
          const j = below + k;
          look(g.alive[j] ?? 0, g.color[j] ?? 0, (g.persist[j] ?? 0) >= FADE_AT ? 1 : 0);
        }
      }
      const was = curAlive[x + 1] === 1;
      let live = was ? n === 2 || n === 3 : n === 3;
      if (m) {
        const ddx = x + 0.5 - m.x;
        const ddy = y + 0.5 - m.y;
        if (ddx * ddx + ddy * ddy > m.r * m.r) live = false;
      }
      const p = g.persist[i] ?? 0;
      if (opts.fade && was && live && (p >= FADE_AT || (p >= FADE_AT / 2 && nearFade))) {
        live = false;
      }
      if (!was && live) g.color[i] = majority(c0, c1, c2, x, y, gen);
      g.alive[i] = live ? 1 : 0;
      if (live) g.lastAlive[i] = gen;
      const s = live ? 0 : Math.min(255, gen - (g.lastAlive[i] ?? NEVER));
      const q = s > QUIET_GAP ? 0 : tick ? Math.min(255, p + 1) : p;
      g.persist[i] = q;
      if (live || q > 0) {
        if (x < (nextLo[y] ?? W)) nextLo[y] = x;
        if (x > (nextHi[y] ?? -1)) nextHi[y] = x;
      }
    }
    prevAlive.set(curAlive);
    prevColor.set(curColor);
    prevFade.set(curFade);
    prevLo = ca;
    prevHi = cb;
  }
  g.rows = { lo: nextLo, hi: nextHi };
  g.gen = gen;
};

const scanRows = (g: LifeGrid) => {
  const lo = new Int32Array(g.height).fill(g.width);
  const hi = new Int32Array(g.height).fill(-1);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x;
      if (g.alive[i] || g.persist[i]) {
        if (x < (lo[y] ?? 0)) lo[y] = x;
        if (x > (hi[y] ?? 0)) hi[y] = x;
      }
    }
  }
  return { lo, hi };
};

export const population = (g: LifeGrid): number => {
  let n = 0;
  for (const v of g.alive) n += v;
  return n;
};

/** Live cells as sorted "x,y" keys relative to their bounding box, plus the box's corner. */
export const shapeOf = (g: LifeGrid): { key: string; x: number; y: number } => {
  let x0 = Infinity;
  let y0 = Infinity;
  const cells: [number, number][] = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (!g.alive[y * g.width + x]) continue;
      cells.push([x, y]);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
    }
  }
  const key = cells
    .map(([x, y]) => `${x - x0},${y - y0}`)
    .sort()
    .join(";");
  return { key, x: x0, y: y0 };
};
