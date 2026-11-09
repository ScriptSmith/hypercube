import { describe, expect, it } from "vitest";
import { MAX_PARTS, MIN_PARTS, THEME_IDS } from "../../../src/apps/manyhands/config";
import { slotsFor, spread, THEMES } from "../../../src/apps/manyhands/themes";

const overlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  a.x < b.x + b.w - 1e-6 &&
  b.x < a.x + a.w - 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  b.y < a.y + a.h - 1e-6;

describe("themes", () => {
  it("splits totals evenly with the shortfall at the top", () => {
    expect(spread(8, 4)).toEqual([2, 2, 2, 2]);
    expect(spread(13, 7)).toEqual([1, 2, 2, 2, 2, 2, 2]);
    expect(spread(17, 6).reduce((a, b) => a + b, 0)).toBe(17);
  });

  for (const id of THEME_IDS) {
    it(`${id}: exactly n slots for every size, inside the box, none overlapping`, () => {
      const t = THEMES[id];
      for (let n = MIN_PARTS; n <= MAX_PARTS; n++) {
        const slots = slotsFor(id, n);
        expect(slots, `${id} ${n}`).toHaveLength(n);
        const kinds = new Set(slots.map((s) => s.kind));
        // Every kind shows in every build, so orders always have all of them to spread.
        expect(kinds.size, `${id} ${n} kinds`).toBe(t.kinds.length);
        const orders = slots.map((s) => s.order).sort((a, b) => a - b);
        expect(orders).toEqual(slots.map((_, i) => i));
        for (const s of slots) {
          expect(s.kind).toBeGreaterThanOrEqual(0);
          expect(s.kind).toBeLessThan(t.kinds.length);
          expect(s.w).toBeGreaterThan(0.01);
          expect(s.h).toBeGreaterThan(0.01);
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w).toBeLessThanOrEqual(t.aspect + 1e-9);
          expect(s.y + s.h).toBeLessThanOrEqual(1 + 1e-9);
        }
        for (let i = 0; i < slots.length; i++) {
          for (let j = i + 1; j < slots.length; j++) {
            expect(overlap(slots[i]!, slots[j]!), `${id} ${n}: ${i} and ${j}`).toBe(false);
          }
        }
      }
    });
  }

  it("holds sizes to 12 to 48", () => {
    expect(slotsFor("rocket", 3)).toHaveLength(MIN_PARTS);
    expect(slotsFor("robot", 400)).toHaveLength(MAX_PARTS);
  });

  it("builds from the ground up", () => {
    for (const id of THEME_IDS) {
      const slots = slotsFor(id, 30);
      const first = slots.find((s) => s.order === 0)!;
      const last = slots.find((s) => s.order === slots.length - 1)!;
      expect(first.y + first.h, id).toBeGreaterThan(last.y + last.h);
    }
  });
});
