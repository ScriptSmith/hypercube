import { describe, expect, it } from "vitest";
import {
  ADULT_BAND,
  CHILD_BAND,
  SEAM_MARGIN,
  TABLE_H,
  TABLE_W,
} from "../../../src/apps/pinball/config";
import { buildTable, mirroredAt } from "../../../src/apps/pinball/layout";
import { centreOf, controlAt, padsFor, tablesIn } from "../../../src/apps/pinball/pads";

const MIN_TARGET = 120;

const frameTables = (n: number) =>
  Array.from({ length: n }, (_, h) =>
    padsFor(h * TABLE_W, mirroredAt(h, n), { left: h > 0, right: h < n - 1 }),
  );

describe("pinball pads", () => {
  it("are big enough to hit", () => {
    for (const p of frameTables(2)) {
      for (const b of [p.left, p.right, p.upLeft, p.upRight, p.plunger]) {
        expect(b.w).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(b.h).toBeGreaterThanOrEqual(MIN_TARGET);
      }
      expect(p.plunger.w).toBeGreaterThanOrEqual(200);
      expect(p.plunger.h).toBeGreaterThanOrEqual(300);
      for (const b of [p.upLeft, p.upRight]) {
        expect(b.w).toBeGreaterThanOrEqual(200);
        expect(b.h).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("keep the main flippers and plunger in the child band and the upper flippers in the adult band", () => {
    for (const p of frameTables(1)) {
      for (const b of [p.left, p.right, p.plunger]) {
        expect(b.y).toBeGreaterThanOrEqual(TABLE_H * (1 - CHILD_BAND) - 0.5);
        expect(b.y + b.h).toBeLessThanOrEqual(TABLE_H);
      }
      for (const b of [p.upLeft, p.upRight]) {
        expect(b.y + b.h).toBeLessThanOrEqual(TABLE_H * ADULT_BAND + 0.5);
      }
    }
  });

  it("keep every pad clear of the seam on a pair, with the plungers at the outer edges", () => {
    const [a, b] = frameTables(2);
    const seam = TABLE_W;
    for (const p of [a!, b!]) {
      for (const box of [p.left, p.right, p.upLeft, p.upRight, p.plunger]) {
        const gap = box.x + box.w <= seam ? seam - (box.x + box.w) : box.x - seam;
        expect(gap).toBeGreaterThanOrEqual(SEAM_MARGIN);
      }
    }
    expect(a!.plunger.x).toBe(0);
    expect(b!.plunger.x + b!.plunger.w).toBe(2 * TABLE_W);
    // The plunger lane is on the same side as its pad.
    const left = buildTable({ mirror: true });
    expect(left.plunger.ball.x).toBeLessThan(TABLE_W / 2);
  });

  it("map touches to controls, with the plunger carved out only while a ball waits", () => {
    const [p] = frameTables(1);
    expect(controlAt(p!, 200, 1500, false)).toBe("left");
    expect(controlAt(p!, 800, 1500, false)).toBe("right");
    expect(controlAt(p!, 1000, 1800, false)).toBe("right");
    expect(controlAt(p!, 1000, 1800, true)).toBe("plunger");
    expect(controlAt(p!, 60, 600, false)).toBe("upLeft");
    expect(controlAt(p!, 1020, 600, false)).toBe("upRight");
    expect(controlAt(p!, 540, 400, false)).toBeNull();
    expect(controlAt(p!, 540, 960, false)).toBeNull();
    for (const c of ["left", "right", "upLeft", "upRight", "plunger"] as const) {
      const at = centreOf(p!, c);
      expect(controlAt(p!, at.x, at.y, true)).toBe(c);
    }
  });

  it("puts one table on each merged panel", () => {
    expect(tablesIn("panel", undefined)).toBe(1);
    expect(tablesIn("pair", undefined)).toBe(2);
    expect(tablesIn("pair", 3)).toBe(3);
  });
});
