import { describe, expect, it } from "vitest";
import {
  accepts,
  fittingShapes,
  makeBlueprint,
  MAX_SLOTS,
  MIN_SLOTS,
  pickBlueprint,
  SHAPES,
  supported,
} from "../../../src/apps/skyline/blueprints";
import { createRng } from "../../../src/core/rng";

const all = () => {
  const out = [];
  for (const shape of SHAPES) {
    for (let rows = 2; rows <= 14; rows++) {
      for (const cols of [2, 3, 4]) {
        const bp = makeBlueprint(shape, rows, cols);
        if (bp) out.push({ shape, rows, cols, bp });
      }
    }
  }
  return out;
};

describe("skyline blueprints", () => {
  it("are well formed: 4 to 12 slots, no overlaps, each slot resting on the one below", () => {
    const list = all();
    expect(list.length).toBeGreaterThan(40);
    for (const { shape, rows, cols, bp } of list) {
      const name = `${shape} ${rows}x${cols}`;
      expect(bp.slots.length, name).toBeGreaterThanOrEqual(MIN_SLOTS);
      expect(bp.slots.length, name).toBeLessThanOrEqual(MAX_SLOTS);
      expect(bp.cols, name).toBeLessThanOrEqual(cols);
      expect(bp.rows, name).toBeLessThanOrEqual(rows);
      const minX = Math.min(...bp.slots.map((s) => s.x));
      expect(minX, name).toBe(0);
      for (let i = 0; i < bp.slots.length; i++) {
        const s = bp.slots[i]!;
        if (s.r > 0) expect(s.below.length, `${name} slot ${i}`).toBeGreaterThan(0);
        else expect(s.below).toEqual([]);
        for (const j of s.below) expect(bp.slots[j]!.r).toBe(s.r - 1);
        for (let j = i + 1; j < bp.slots.length; j++) {
          const o = bp.slots[j]!;
          const overlap = o.r === s.r && Math.min(o.x, s.x) + 1 - Math.max(o.x, s.x) > 0.01;
          expect(overlap, `${name} ${i},${j}`).toBe(false);
        }
      }
      // Build order (row, then x) is the stored order.
      for (let i = 1; i < bp.slots.length; i++) {
        const a = bp.slots[i - 1]!;
        const b = bp.slots[i]!;
        expect(a.r < b.r || (a.r === b.r && a.x < b.x), name).toBe(true);
      }
      // Every top slot has nothing on it; every other slot does.
      for (const s of bp.slots) {
        const covered = bp.slots.some(
          (o) => o.r === s.r + 1 && Math.min(o.x, s.x) + 1 - Math.max(o.x, s.x) > 0.01,
        );
        expect(s.top, name).toBe(!covered);
      }
    }
  });

  it("make every shape somewhere, and refuse what doesn't fit", () => {
    for (const shape of SHAPES) expect(all().some((b) => b.shape === shape)).toBe(true);
    expect(makeBlueprint("twin", 5, 2)).toBeNull();
    expect(makeBlueprint("long", 3, 2)).toBeNull();
    expect(makeBlueprint("spire", 3, 3)).toBeNull();
    expect(fittingShapes(3, 2)).toEqual(["slab", "round"]);
  });

  it("pick within the lot's rows and width, and avoid the neighbours' shapes", () => {
    const rng = createRng("bp");
    for (let i = 0; i < 300; i++) {
      const rows = 2 + rng.int(6);
      const cols = 2 + rng.int(3);
      const avoid = [rng.pick(SHAPES)];
      const bp = pickBlueprint(rng, rows, cols, avoid);
      expect(bp.rows).toBeLessThanOrEqual(Math.max(rows, 2));
      expect(bp.cols).toBeLessThanOrEqual(cols);
      if (fittingShapes(rows, cols).filter((s) => !avoid.includes(s)).length > 0) {
        expect(avoid).not.toContain(bp.shape);
      }
    }
  });

  it("only accept supported slots, and roofs only on top", () => {
    const bp = makeBlueprint("stepped", 5, 3)!;
    const filled: (number | null)[] = bp.slots.map(() => null);
    const upper = bp.slots.findIndex((s) => s.r === 1);
    const ground = bp.slots.findIndex((s) => s.r === 0);
    expect(supported(bp, filled, ground)).toBe(true);
    expect(supported(bp, filled, upper)).toBe(false);
    expect(accepts(bp, filled, upper, 0)).toBe(false);
    expect(accepts(bp, filled, ground, 0)).toBe(true);
    // A roof fits no ground slot of a tall building.
    expect(accepts(bp, filled, ground, 3)).toBe(false);
    for (const j of bp.slots[upper]!.below) filled[j] = 0;
    expect(accepts(bp, filled, upper, 1)).toBe(true);
    filled[upper] = 2;
    expect(accepts(bp, filled, upper, 1)).toBe(false);
    // The single top slot takes a roof once everything under it is in.
    const top = bp.slots.findIndex((s) => s.r === bp.rows - 1);
    bp.slots.forEach((_, i) => {
      if (i !== top) filled[i] = 0;
    });
    expect(accepts(bp, filled, top, 3)).toBe(true);
    // A setback (half-offset) slot needs both slots under it.
    const half = bp.slots.findIndex((s) => s.x % 1 !== 0);
    expect(bp.slots[half]!.below.length).toBe(2);
  });
});
