import { describe, expect, it } from "vitest";
import { isKidRow, regionCount, regionOf } from "../../../src/apps/bluebottle/board";
import { DENSITY } from "../../../src/apps/bluebottle/config";
import { generate, type GenStats } from "../../../src/apps/bluebottle/generate";
import { createSolver } from "../../../src/apps/bluebottle/solver";
import { DENSITIES, SIZES, specOf } from "./helpers";

describe("generator", () => {
  for (const size of SIZES) {
    for (const dens of DENSITIES) {
      it(`gives ${size.name} patches on ${dens} that clear from their openings without guessing`, () => {
        const seeds = size.cols >= 48 ? 40 : 120;
        const solver = createSolver(size.cols, size.rows);
        for (let n = 1; n <= seeds; n++) {
          const spec = specOf(size.cols, size.rows, size.kid, dens, n, 1000 + n);
          const board = generate(spec);
          const r = solver.solve(board);
          expect(r.cleared, `${size.name} ${dens} n=${n}`).toBe(true);
          expect(solver.errors).toBe(0);
          // Openings are safe and empty, so each one digs open a patch of sand.
          for (const o of board.openings) {
            expect(board.bottle[o]).toBe(0);
          }
          const regions = regionCount(spec.cols, spec.rw);
          const seen = new Set(board.openings.map((o) => regionOf(spec.cols, spec.rw, o)));
          expect(seen.size, "an opening in every region").toBe(regions);
        }
      });
    }
  }

  it("is deterministic from the spec", () => {
    for (const size of SIZES) {
      const spec = specOf(size.cols, size.rows, size.kid, "normal", 5, 99);
      const a = generate(spec);
      const b = generate({ ...spec });
      expect([...a.bottle]).toEqual([...b.bottle]);
      expect(a.openings).toEqual(b.openings);
      const c = generate({ ...spec, n: 6 });
      expect([...c.bottle]).not.toEqual([...a.bottle]);
    }
  });

  it("keeps the child rows sparse and the rows above denser", () => {
    for (const dens of DENSITIES) {
      let low = 0;
      let lowCells = 0;
      let high = 0;
      let highCells = 0;
      for (let n = 1; n <= 30; n++) {
        const spec = specOf(80, 11, 6, dens, n, 4);
        const b = generate(spec);
        for (let i = 0; i < b.size; i++) {
          if (isKidRow(spec, Math.floor(i / b.cols))) {
            lowCells++;
            low += b.bottle[i]!;
          } else {
            highCells++;
            high += b.bottle[i]!;
          }
        }
      }
      const d = DENSITY[dens];
      expect(low / lowCells).toBeGreaterThan(d.low * 0.75);
      expect(low / lowCells).toBeLessThanOrEqual(d.low + 0.005);
      expect(high / highCells).toBeGreaterThan(d.high * 0.75);
      expect(high / highCells).toBeLessThanOrEqual(d.high + 0.005);
      expect(high / highCells).toBeGreaterThan(low / lowCells);
    }
  });

  it("puts each region's first opening in the child rows", () => {
    for (let n = 1; n <= 50; n++) {
      const spec = specOf(48, 7, 5, "normal", n, 3);
      const b = generate(spec);
      const firsts = new Map<number, number>();
      for (const o of b.openings) {
        const g = regionOf(spec.cols, spec.rw, o);
        if (!firsts.has(g)) firsts.set(g, o);
      }
      for (const o of firsts.values()) expect(isKidRow(spec, Math.floor(o / spec.cols))).toBe(true);
    }
  });

  it("generates a long bank's patch of 80 columns well inside 100 ms", () => {
    let worst = 0;
    let total = 0;
    const N = 40;
    for (let n = 1; n <= N; n++) {
      const stats: GenStats = { rounds: 0, moved: 0, removed: 0, added: 0 };
      const t0 = performance.now();
      generate(specOf(80, 11, 6, "hard", n, 77), stats);
      const dt = performance.now() - t0;
      worst = Math.max(worst, dt);
      total += dt;
    }
    expect(total / N).toBeLessThan(30);
    expect(worst).toBeLessThan(150);
  });
});
