import { describe, expect, it } from "vitest";
import {
  AUX_RIGHT,
  BL,
  BR,
  type Cell,
  type Grid,
  makeGrid,
  moveBlock,
  PASS_OFFSETS,
  sinks,
  stepGrid,
  TL,
  TR,
} from "../../../src/apps/tinyworld/blocks";
import { E } from "../../../src/apps/tinyworld/elements";
import { createRng } from "../../../src/core/rng";

const cell = (id: number, aux = 0): Cell => ({ id, shade: 0, life: 0, aux });
const at = (g: Grid, x: number, y: number) => g.cells[y * g.width + x]!;
const put = (g: Grid, x: number, y: number, id: number, aux = 0) => {
  g.cells[y * g.width + x] = cell(id, aux);
};
const count = (g: Grid, id: number) => g.cells.filter((c) => c.id === id).length;
const run = (g: Grid, passes: number, seed = "blocks") => {
  const rng = createRng(seed);
  for (let i = 0; i < passes; i++)
    stepGrid(g, PASS_OFFSETS[i % PASS_OFFSETS.length]!, () => rng.next());
};
/** Height of the top non-empty cell in each column (0 when empty). */
const heights = (g: Grid, id: number) =>
  Array.from({ length: g.width }, (_, x) => {
    let h = 0;
    for (let y = 0; y < g.height; y++) if (at(g, x, y).id === id) h = y + 1;
    return h;
  });

describe("tinyworld block rule (CPU reference)", () => {
  it("drops a grain into empty space below it", () => {
    const c = [cell(E.EMPTY), cell(E.EMPTY), cell(E.SAND), cell(E.EMPTY)];
    moveBlock(c, () => 0);
    expect(c[BL]!.id).toBe(E.SAND);
    expect(c[TL]!.id).toBe(E.EMPTY);
  });

  it("slides a blocked grain to the open lower corner", () => {
    const c = [cell(E.SAND), cell(E.EMPTY), cell(E.SAND), cell(E.EMPTY)];
    moveBlock(c, () => 0);
    expect(c[BR]!.id).toBe(E.SAND);
    expect(c[TL]!.id).toBe(E.EMPTY);
  });

  it("doesn't squeeze a grain past a wall corner", () => {
    const c = [cell(E.SAND), cell(E.EMPTY), cell(E.SAND), cell(E.STONE)];
    moveBlock(c, () => 0);
    expect(c[TL]!.id).toBe(E.SAND);
    expect(c[BR]!.id).toBe(E.EMPTY);
  });

  it("never moves static cells", () => {
    const c = [cell(E.EMPTY), cell(E.EMPTY), cell(E.STONE), cell(E.PLANT)];
    moveBlock(c, () => 0);
    expect(c[TL]!.id).toBe(E.STONE);
    expect(c[TR]!.id).toBe(E.PLANT);
  });

  it("flows a liquid the way it remembers, and turns it round at a wall", () => {
    const c = [cell(E.WATER, AUX_RIGHT), cell(E.EMPTY), cell(E.STONE), cell(E.STONE)];
    moveBlock(c, () => 0);
    expect(c[BR]!.id).toBe(E.WATER);
    const d = [cell(E.WATER, AUX_RIGHT), cell(E.STONE), cell(E.STONE), cell(E.STONE)];
    moveBlock(d, () => 0);
    expect(d[BL]!.aux & AUX_RIGHT).toBe(0);
  });

  it("lets gas rise and heavier things sink through lighter ones", () => {
    expect(sinks(cell(E.EMPTY), cell(E.STEAM))).toBe(true);
    expect(sinks(cell(E.WATER), cell(E.OIL))).toBe(true);
    expect(sinks(cell(E.SAND), cell(E.WATER))).toBe(true);
    expect(sinks(cell(E.OIL), cell(E.WATER))).toBe(false);
    expect(sinks(cell(E.SAND), cell(E.SAND))).toBe(false);
    expect(sinks(cell(E.STONE), cell(E.EMPTY))).toBe(false);
  });

  it("conserves every element over many passes", () => {
    const g = makeGrid(24, 24);
    const rng = createRng("mix");
    const ids = [E.EMPTY, E.EMPTY, E.SAND, E.WATER, E.OIL, E.STEAM, E.STONE, E.SEED];
    for (let i = 0; i < g.cells.length; i++)
      g.cells[i] = cell(rng.pick(ids), rng.next() < 0.5 ? AUX_RIGHT : 0);
    const before = ids.map((id) => count(g, id));
    const stone = g.cells.map((c, i) => (c.id === E.STONE ? i : -1)).filter((i) => i >= 0);
    run(g, 400);
    expect(ids.map((id) => count(g, id))).toEqual(before);
    for (const i of stone) expect(g.cells[i]!.id).toBe(E.STONE);
  });

  it("piles sand with no overhangs and slopes no steeper than the grains allow", () => {
    const g = makeGrid(40, 30);
    for (let y = 10; y < 30; y++) for (let x = 18; x < 22; x++) put(g, x, y, E.SAND);
    run(g, 800);
    for (let x = 0; x < g.width; x++) {
      for (let y = 1; y < g.height; y++) {
        if (at(g, x, y).id === E.SAND)
          expect(at(g, x, y - 1).id, `overhang at ${x},${y}`).toBe(E.SAND);
      }
    }
    const h = heights(g, E.SAND);
    // A pile, not a tower: it spread out and neighbouring columns differ by a few cells at most.
    expect(Math.max(...h)).toBeLessThan(20);
    for (let x = 1; x < g.width; x++) expect(Math.abs(h[x]! - h[x - 1]!)).toBeLessThanOrEqual(3);
  });

  it("levels a block of water into a flat pool", () => {
    const g = makeGrid(40, 20);
    for (let y = 2; y < 18; y++)
      for (let x = 0; x < 6; x++) put(g, x, y, E.WATER, y % 2 ? AUX_RIGHT : 0);
    run(g, 3000);
    const h = heights(g, E.WATER);
    expect(Math.max(...h) - Math.min(...h)).toBeLessThanOrEqual(1);
  });

  it("floats oil on water", () => {
    const g = makeGrid(16, 20);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) put(g, x, y, E.OIL);
    for (let y = 6; y < 12; y++) for (let x = 0; x < 16; x++) put(g, x, y, E.WATER);
    run(g, 2000);
    for (let x = 0; x < g.width; x++) {
      let seenOil = false;
      for (let y = 0; y < g.height; y++) {
        const id = at(g, x, y).id;
        if (id === E.OIL) seenOil = true;
        if (id === E.WATER) expect(seenOil, `water above oil at column ${x}`).toBe(false);
      }
    }
  });

  it("lets steam rise to the top", () => {
    const g = makeGrid(10, 30);
    for (let x = 0; x < 10; x++) put(g, x, 0, E.STEAM);
    run(g, 600);
    for (let x = 0; x < 10; x++) expect(heights(g, E.STEAM)[x]).toBeGreaterThan(25);
  });

  it("speeds falling grains up", () => {
    const fall = (passes: number) => {
      const h = makeGrid(2, 200);
      put(h, 0, 199, E.SAND);
      run(h, passes);
      return 199 - Math.floor(h.cells.findIndex((c) => c.id === E.SAND) / 2);
    };
    // The second 40 passes cover more ground than the first 40.
    const first = fall(40);
    expect(fall(80) - first).toBeGreaterThan(first);
  });

  it("lifts everything up a geyser column, conserving it", () => {
    const g = makeGrid(12, 60);
    for (let y = 0; y < 10; y++) for (let x = 4; x < 8; x++) put(g, x, y, E.SAND);
    const zone = { x0: 3, y0: 0, x1: 9, y1: 59, kind: "lift" as const, strength: 0.95 };
    const rng = createRng("lift");
    for (let i = 0; i < 120; i++) stepGrid(g, PASS_OFFSETS[i % 4]!, () => rng.next(), [zone]);
    expect(count(g, E.SAND)).toBe(40);
    expect(Math.max(...heights(g, E.SAND))).toBeGreaterThan(50);
  });

  it("blows grains downwind in a fan zone", () => {
    const g = makeGrid(60, 10);
    for (let x = 0; x < 6; x++) put(g, x, 0, E.SAND);
    const zone = { x0: 0, y0: 0, x1: 59, y1: 9, kind: "right" as const, strength: 0.6 };
    const rng = createRng("fan");
    for (let i = 0; i < 200; i++) stepGrid(g, PASS_OFFSETS[i % 4]!, () => rng.next(), [zone]);
    expect(count(g, E.SAND)).toBe(6);
    const xs = g.cells.map((c, i) => (c.id === E.SAND ? i % g.width : -1)).filter((x) => x >= 0);
    expect(Math.min(...xs)).toBeGreaterThan(20);
  });
});
