import { describe, expect, it } from "vitest";
import {
  createGrid,
  DIEHARD,
  FADE_GENERATIONS,
  GLIDER,
  hash3,
  LWSS,
  majority,
  type Pattern,
  persistEvery,
  place,
  population,
  R_PENTOMINO,
  setCell,
  shapeOf,
  step,
} from "../../../src/apps/petri/life";

const RULES_ONLY = { every: persistEvery(12), fade: false };

const run = (p: Pattern, size: number, gens: number, at = size / 2) => {
  const g = createGrid(size, size);
  place(g, p, Math.floor(at), Math.floor(at), 0);
  for (let i = 0; i < gens; i++) step(g, RULES_ONLY);
  return g;
};

describe("petri life (B3/S23)", () => {
  it("moves a glider one cell diagonally every four generations", () => {
    const g = createGrid(40, 40);
    place(g, GLIDER, 10, 10, 0);
    const start = shapeOf(g);
    for (let i = 0; i < 4; i++) step(g, RULES_ONLY);
    const after = shapeOf(g);
    expect(after.key).toBe(start.key);
    expect([after.x - start.x, after.y - start.y]).toEqual([1, 1]);
    // In between it changes shape: it is not a still life.
    for (let i = 0; i < 2; i++) step(g, RULES_ONLY);
    expect(shapeOf(g).key).not.toBe(start.key);
    expect(population(g)).toBe(5);
  });

  it("moves a lightweight spaceship two cells every four generations", () => {
    const g = createGrid(60, 30);
    place(g, LWSS, 40, 15, 0);
    const start = shapeOf(g);
    for (let i = 0; i < 4; i++) step(g, RULES_ONLY);
    const after = shapeOf(g);
    expect(after.key).toBe(start.key);
    expect(Math.abs(after.x - start.x) + Math.abs(after.y - start.y)).toBe(2);
    expect(population(g)).toBe(9);
  });

  it("keeps a glider's shape and speed under any turn or reflection", () => {
    for (let rot = 0; rot < 4; rot++) {
      for (const mirror of [false, true]) {
        const g = createGrid(40, 40);
        place(g, GLIDER, 20, 20, 0, { rot, mirror });
        const start = shapeOf(g);
        for (let i = 0; i < 4; i++) step(g, RULES_ONLY);
        const after = shapeOf(g);
        expect(after.key).toBe(start.key);
        expect(Math.abs(after.x - start.x)).toBe(1);
        expect(Math.abs(after.y - start.y)).toBe(1);
      }
    }
  });

  it("burns a diehard out at generation 130", () => {
    const g = run(DIEHARD, 60, 129);
    expect(population(g)).toBeGreaterThan(0);
    step(g, RULES_ONLY);
    expect(population(g)).toBe(0);
  });

  it(
    "blooms an R-pentomino into its known final census of 116 cells at generation 1103",
    { timeout: 30_000 },
    () => {
      // Big enough that the six gliders it sends out never reach an edge.
      const g = run(R_PENTOMINO, 720, 1103, 360);
      expect(population(g)).toBe(116);
      const settled = population(g);
      for (let i = 0; i < 4; i++) step(g, RULES_ONLY);
      // Blinkers flip and gliders fly, but the count stays.
      expect(population(g)).toBe(settled);
    },
  );

  it("starts the R-pentomino on its published early populations", () => {
    const g = createGrid(80, 80);
    place(g, R_PENTOMINO, 40, 40, 0);
    const pops = [population(g)];
    for (let i = 0; i < 4; i++) {
      step(g, RULES_ONLY);
      pops.push(population(g));
    }
    expect(pops).toEqual([5, 6, 7, 9, 8]);
  });
});

describe("petri life colours", () => {
  it("gives a birth the colour two of its three parents share", () => {
    expect(majority(2, 2, 5, 0, 0, 1)).toBe(2);
    expect(majority(2, 5, 2, 0, 0, 1)).toBe(2);
    expect(majority(5, 2, 2, 0, 0, 1)).toBe(2);
  });

  it("splits three-way ties by a hash, so no neighbour position is favoured", () => {
    const counts = [0, 0, 0];
    for (let x = 0; x < 300; x++) {
      const c = majority(10, 11, 12, x, 7, 3);
      counts[c - 10]!++;
    }
    for (const n of counts) expect(n).toBeGreaterThan(60);
  });

  it("colours newborn cells from their parents, never changing which cells live", () => {
    const a = createGrid(20, 20);
    const b = createGrid(20, 20);
    // A vertical blinker made of three colours flips to horizontal.
    for (const [g, cs] of [
      [a, [1, 1, 3]],
      [b, [4, 4, 4]],
    ] as const) {
      cs.forEach((c, i) => setCell(g, 10, 9 + i, c));
    }
    step(a, RULES_ONLY);
    step(b, RULES_ONLY);
    expect(Array.from(a.alive)).toEqual(Array.from(b.alive));
    // The two new end cells each had all three as parents: two of them colour 1.
    expect(a.color[10 * 20 + 9]).toBe(1);
    expect(a.color[10 * 20 + 11]).toBe(1);
  });

  it("hashes the same way as the shader's unsigned arithmetic", () => {
    expect(hash3(0, 0, 0)).toBe(0);
    expect(hash3(1, 2, 3)).toBeGreaterThan(0);
    expect(hash3(1, 2, 3)).toBeLessThan(2 ** 32);
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(2, 1, 3));
  });
});

describe("petri life debris fade", () => {
  it("fades a still life after about two minutes", () => {
    const g = createGrid(20, 20);
    for (const [x, y] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ] as const) {
      setCell(g, x, y, 0);
    }
    const opts = { every: persistEvery(12), fade: true };
    for (let i = 0; i < FADE_GENERATIONS - 40; i++) step(g, opts);
    expect(population(g)).toBe(4);
    for (let i = 0; i < 120; i++) step(g, opts);
    expect(population(g)).toBe(0);
  });

  it("fades an oscillator too", () => {
    const g = createGrid(20, 20);
    for (const y of [9, 10, 11]) setCell(g, 10, y, 0);
    const opts = { every: persistEvery(12), fade: true };
    for (let i = 0; i < FADE_GENERATIONS + 100; i++) step(g, opts);
    expect(population(g)).toBe(0);
  });

  it("never fades a glider in flight", () => {
    const g = createGrid(500, 500);
    place(g, GLIDER, 10, 10, 0);
    const opts = { every: persistEvery(12), fade: true };
    for (let i = 0; i < FADE_GENERATIONS + 100; i++) step(g, opts);
    expect(population(g)).toBe(5);
  });

  it("keeps the two-minute fade whatever the speed", () => {
    for (const rate of [6, 12, 24]) {
      expect(persistEvery(rate) * 180).toBeCloseTo(rate * 120, -1);
    }
  });

  it("keeps cells outside the dish dead", () => {
    const g = createGrid(30, 30);
    place(g, GLIDER, 15, 15, 0);
    const mask = { x: 15, y: 15, r: 8 };
    for (let i = 0; i < 200; i++) step(g, { every: 8, fade: true, mask });
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        if ((x + 0.5 - 15) ** 2 + (y + 0.5 - 15) ** 2 > 64) expect(g.alive[y * 30 + x]).toBe(0);
      }
    }
  });
});
