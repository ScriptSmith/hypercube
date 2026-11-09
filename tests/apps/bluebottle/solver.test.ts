import { describe, expect, it } from "vitest";
import { type Board, neighbours } from "../../../src/apps/bluebottle/board";
import { createSolver, type Visible } from "../../../src/apps/bluebottle/solver";
import { boardOf, randomBoard, rngOf } from "./helpers";

/** Cells forced safe or forced bluebottle in every layout that agrees with what is visible. */
const bruteForce = (b: Board, v: Visible) => {
  const nb = neighbours(b.cols, b.rows);
  const unknown: number[] = [];
  for (let i = 0; i < b.size; i++) if (!v.dug[i] && !v.found[i]) unknown.push(i);
  const lay = new Uint8Array(b.size);
  const always1 = new Uint8Array(b.size).fill(1);
  const always0 = new Uint8Array(b.size).fill(1);
  let solutions = 0;
  for (let mask = 0; mask < 1 << unknown.length; mask++) {
    lay.fill(0);
    for (let i = 0; i < b.size; i++) if (v.found[i]) lay[i] = 1;
    unknown.forEach((c, k) => {
      if (mask & (1 << k)) lay[c] = 1;
    });
    let ok = true;
    for (let i = 0; i < b.size && ok; i++) {
      if (!v.dug[i]) continue;
      let s = 0;
      for (let k = 0; k < nb.n[i]!; k++) s += lay[nb.list[i * 8 + k]!]!;
      if (s !== v.count[i]) ok = false;
    }
    if (!ok) continue;
    solutions++;
    for (const c of unknown) {
      if (lay[c]) always0[c] = 0;
      else always1[c] = 0;
    }
  }
  const safe = unknown.filter((c) => always0[c]);
  const bottles = unknown.filter((c) => always1[c]);
  return { solutions, safe, bottles };
};

/** A visible state: some safe cells dug, some bluebottles found. */
const randomVisible = (rng: ReturnType<typeof rngOf>, b: Board, dig: number): Visible => {
  const dug = new Uint8Array(b.size);
  const found = new Uint8Array(b.size);
  for (let i = 0; i < b.size; i++) {
    if (b.bottle[i]) {
      if (rng.next() < 0.2) found[i] = 1;
    } else if (rng.next() < dig) dug[i] = 1;
  }
  return { dug, count: b.count, found };
};

describe("solver", () => {
  it("only ever deduces what every agreeing layout has, and finds all of it on small boards", () => {
    const rng = rngOf("solver-brute");
    let deduced = 0;
    for (let trial = 0; trial < 400; trial++) {
      const cols = 3 + rng.int(3);
      const rows = 3 + rng.int(2);
      const board = randomBoard(rng, cols, rows, 1 + rng.int(Math.floor(cols * rows * 0.3)));
      const v = randomVisible(rng, board, 0.3 + rng.next() * 0.4);
      let unknown = 0;
      for (let i = 0; i < board.size; i++) if (!v.dug[i] && !v.found[i]) unknown++;
      if (unknown > 16) continue;
      const truth = bruteForce(board, v);
      expect(truth.solutions).toBeGreaterThan(0);
      const got = createSolver(cols, rows).deduce(v);
      deduced += got.safe.length + got.bottles.length;
      for (const c of got.safe) expect(truth.safe, `trial ${trial} safe ${c}`).toContain(c);
      for (const c of got.bottles) expect(truth.bottles, `trial ${trial} bottle ${c}`).toContain(c);
      // Each frontier group of a small board fits in one exact search, so nothing is missed.
      expect([...got.safe].sort((a, b) => a - b)).toEqual(truth.safe);
      expect([...got.bottles].sort((a, b) => a - b)).toEqual(truth.bottles);
    }
    expect(deduced).toBeGreaterThan(200);
  });

  it("is sound in windowed search on wide frontiers", () => {
    const rng = rngOf("solver-wide");
    const solver = createSolver(40, 6, { exact: 4, window: 6, nodes: 5000, budget: 200_000 });
    for (let trial = 0; trial < 40; trial++) {
      const board = randomBoard(rng, 40, 6, 30 + rng.int(20));
      const v = randomVisible(rng, board, 0.5);
      const got = solver.deduce(v);
      for (const c of got.safe) expect(board.bottle[c], `safe ${c}`).toBe(0);
      for (const c of got.bottles) expect(board.bottle[c], `bottle ${c}`).toBe(1);
    }
  });

  it("decides with the pair rule what single cells cannot", () => {
    // Bluebottle top left; the middle row and bottom row are dug except the middle row's right end.
    const b = boardOf(["*..", "...", "..."]);
    const dug = new Uint8Array(9);
    for (const i of [3, 4, 6, 7, 8]) dug[i] = 1;
    const v = { dug, count: b.count, found: new Uint8Array(9) };
    const noSearch = createSolver(3, 3, { exact: 0, window: 0, nodes: 0, budget: 0 });
    const got = noSearch.deduce(v);
    // Cell 5 by a single count of 0, then cell 2 because both 1s share {0, 1}.
    expect(got.safe.sort()).toEqual([2, 5]);
    expect(got.bottles).toEqual([]);
  });

  it("clears the classic 1-2-1 along an edge", () => {
    const wall = boardOf(["*.*..", "ooooo"]);
    expect(createSolver(wall.cols, wall.rows).solve(wall).cleared).toBe(true);
  });

  it("does not clear a board that needs a guess", () => {
    // Two cells, one bluebottle, and nothing to tell them apart.
    const b = boardOf(["o.", "o*"]);
    const r = createSolver(b.cols, b.rows).solve(b);
    expect(r.cleared).toBe(false);
    expect(r.left).toBe(1);
  });

  it("never digs a bluebottle when solving whole boards", () => {
    const rng = rngOf("solver-solve");
    for (let trial = 0; trial < 60; trial++) {
      const board = randomBoard(rng, 20, 8, 15 + rng.int(20));
      const zero = [...board.count.keys()].filter((i) => !board.bottle[i] && board.count[i] === 0);
      if (zero.length === 0) continue;
      const solver = createSolver(20, 8);
      const withOpenings = { ...board, openings: [zero[rng.int(zero.length)]!] };
      const r = solver.solve(withOpenings);
      for (let i = 0; i < board.size; i++) if (r.open[i]) expect(board.bottle[i]).toBe(0);
      expect(solver.errors).toBe(0);
    }
  });
});
