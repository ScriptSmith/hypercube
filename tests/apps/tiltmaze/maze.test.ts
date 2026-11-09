import { describe, expect, it } from "vitest";
import {
  BOARD,
  cellAt,
  cellCentre,
  dimsFor,
  E,
  generateMaze,
  type Maze,
  N,
  type Orient,
  S,
  W,
} from "../../../src/apps/tiltmaze/maze";
import { MAX_LEVEL } from "../../../src/apps/tiltmaze/config";
import { createRng } from "../../../src/core/rng";

const STEPS = [
  { bit: N, dc: 0, dr: -1, back: S },
  { bit: E, dc: 1, dr: 0, back: W },
  { bit: S, dc: 0, dr: 1, back: N },
  { bit: W, dc: -1, dr: 0, back: E },
];

/** Cells reachable from `from` through open sides. */
const reach = (m: Maze, from: number) => {
  const seen = new Set([from]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q]!;
    for (const d of STEPS) {
      if (!(m.open[cell]! & d.bit)) continue;
      const nb = cell + d.dc + d.dr * m.cols;
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
};

const ORIENTS: Orient[] = ["portrait", "landscape"];

describe("tiltmaze mazes", () => {
  it("grow from a few wide corridors to about 8 by 10", () => {
    expect(dimsFor(1, "portrait")).toEqual({ cols: 3, rows: 4 });
    expect(dimsFor(MAX_LEVEL, "portrait")).toEqual({ cols: 8, rows: 10 });
    expect(dimsFor(MAX_LEVEL, "landscape")).toEqual({ cols: 10, rows: 8 });
    for (let l = 2; l <= MAX_LEVEL; l++) {
      const a = dimsFor(l - 1, "portrait");
      const b = dimsFor(l, "portrait");
      expect(b.cols * b.rows).toBeGreaterThan(a.cols * a.rows);
    }
  });

  it("are perfect mazes, solvable from the start, at every level and many seeds", () => {
    for (const orient of ORIENTS) {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        for (let seed = 0; seed < 25; seed++) {
          const m = generateMaze({
            level,
            orient,
            holes: true,
            rng: createRng(`m:${orient}:${level}:${seed}`),
          });
          const n = m.cols * m.rows;
          // Open sides agree on both cells and never open onto the rim.
          let edges = 0;
          for (let cell = 0; cell < n; cell++) {
            const c = cell % m.cols;
            const r = Math.floor(cell / m.cols);
            for (const d of STEPS) {
              if (!(m.open[cell]! & d.bit)) continue;
              const nc = c + d.dc;
              const nr = r + d.dr;
              expect(nc >= 0 && nc < m.cols && nr >= 0 && nr < m.rows).toBe(true);
              expect(m.open[nr * m.cols + nc]! & d.back).toBeTruthy();
              edges++;
            }
          }
          // A spanning tree: every cell reachable, one edge fewer than cells.
          expect(edges / 2).toBe(n - 1);
          expect(reach(m, m.start).size).toBe(n);
          expect(m.path[0]).toBe(m.start);
          expect(m.path[m.path.length - 1]).toBe(m.goal);
          expect(m.goal).not.toBe(m.start);
          // The next-cell field leads to the goal from everywhere.
          for (let cell = 0; cell < n; cell++) {
            let at = cell;
            for (let k = 0; k < n && at !== m.goal; k++) at = m.next[at]!;
            expect(at).toBe(m.goal);
          }
        }
      }
    }
  });

  it("start in a corner and put the goal as far as it can be", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = generateMaze({ level: 4, orient: "portrait", holes: false, rng: createRng(seed) });
      expect([0, m.cols - 1, (m.rows - 1) * m.cols, m.rows * m.cols - 1]).toContain(m.start);
      // No cell is farther from the start than the goal.
      const far = new Map([[m.start, 0]]);
      const queue = [m.start];
      for (let q = 0; q < queue.length; q++) {
        const cell = queue[q]!;
        for (const d of STEPS) {
          const nb = cell + d.dc + d.dr * m.cols;
          if (m.open[cell]! & d.bit && !far.has(nb)) {
            far.set(nb, far.get(cell)! + 1);
            queue.push(nb);
          }
        }
      }
      expect(far.get(m.goal)).toBe(Math.max(...far.values()));
      expect(m.path.length - 1).toBe(far.get(m.goal));
    }
  });

  it("fill the board whatever the level, with the ball and walls sized from the cells", () => {
    for (const orient of ORIENTS) {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const m = generateMaze({ level, orient, holes: false, rng: createRng(level) });
        expect(m.w).toBe(BOARD[orient].w);
        expect(m.cols * m.sx).toBeCloseTo(m.w);
        expect(m.rows * m.sz).toBeCloseTo(m.d);
        const s = Math.min(m.sx, m.sz);
        // The ball fits a corridor with room to spare.
        expect(2 * m.r).toBeLessThan((s - m.wall) * 0.5);
        expect(m.r).toBeGreaterThan(0.005);
        expect(cellAt(m, cellCentre(m, 5).x, cellCentre(m, 5).z)).toBe(5);
      }
    }
  });

  it("have no holes in the plain variant or at level 1", () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(
        generateMaze({ level: 6, orient: "portrait", holes: false, rng: createRng(seed) }).holes,
      ).toHaveLength(0);
      expect(
        generateMaze({ level: 1, orient: "portrait", holes: true, rng: createRng(seed) }).holes,
      ).toHaveLength(0);
    }
  });

  it("leave a clear lane at least a ball wide beside every hole on the way", () => {
    let onWay = 0;
    let deadEnds = 0;
    for (const orient of ORIENTS) {
      for (let level = 2; level <= MAX_LEVEL; level++) {
        for (let seed = 0; seed < 20; seed++) {
          const m = generateMaze({ level, orient, holes: true, rng: createRng(`h${seed}`) });
          expect(m.holes.length).toBeGreaterThan(0);
          expect(m.holes.length).toBeLessThanOrEqual(Math.min(6, level - 1));
          const cells = m.holes.map((h) => h.cell);
          for (const h of m.holes) {
            expect(h.cell).not.toBe(m.start);
            expect(h.cell).not.toBe(m.goal);
            // Never next to another hole.
            for (const other of cells) {
              if (other === h.cell) continue;
              const dc = Math.abs((other % m.cols) - (h.cell % m.cols));
              const dr = Math.abs(Math.floor(other / m.cols) - Math.floor(h.cell / m.cols));
              expect(dc + dr).toBeGreaterThanOrEqual(2);
            }
            const ctr = cellCentre(m, h.cell);
            if (!h.onPath) {
              deadEnds++;
              expect(m.path).not.toContain(h.cell);
              continue;
            }
            onWay++;
            const i = m.path.indexOf(h.cell);
            expect(i).toBeGreaterThan(1);
            expect(i).toBeLessThan(m.path.length - 2);
            const alongX = Math.abs(m.path[i + 1]! - h.cell) === 1;
            // Across the corridor: where the ball's centre may go, and where the hole takes it.
            const across = alongX ? m.sz : m.sx;
            const half = (across - m.wall) / 2;
            const hole = alongX ? h.z - ctr.z : h.x - ctr.x;
            const free = [-half + m.r, half - m.r];
            const lane = hole < 0 ? [hole + h.r, free[1]!] : [free[0]!, hole - h.r];
            expect(lane[1]! - lane[0]!).toBeGreaterThanOrEqual(2 * m.r - 1e-9);
            // The hole sits against a wall, not in front of a side opening.
            const bit = alongX ? (hole < 0 ? N : S) : hole < 0 ? W : E;
            expect(m.open[h.cell]! & bit).toBe(0);
            // The pilot's lane is inside the clear lane.
            const l = m.lane[h.cell]!;
            expect(l).toBeGreaterThan(lane[0]!);
            expect(l).toBeLessThan(lane[1]!);
          }
        }
      }
    }
    expect(onWay).toBeGreaterThan(50);
    expect(deadEnds).toBeGreaterThan(20);
  });

  it("build wall boxes that close every walled side and the rim", () => {
    const m = generateMaze({ level: 5, orient: "portrait", holes: false, rng: createRng("b") });
    const inside = (x: number, z: number) =>
      m.boxes.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
    for (let cell = 0; cell < m.cols * m.rows; cell++) {
      const c = cellCentre(m, cell);
      expect(inside(c.x, c.z)).toBe(false);
      for (const d of STEPS) {
        const x = c.x + (d.dc * m.sx) / 2;
        const z = c.z + (d.dr * m.sz) / 2;
        expect(inside(x, z)).toBe(!(m.open[cell]! & d.bit));
      }
    }
    expect(m.boxes.filter((b) => b.rim).length).toBe(4);
  });
});
