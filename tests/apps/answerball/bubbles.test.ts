import { describe, expect, it } from "vitest";
import { BUBBLES, clinging, createBubbles } from "../../../src/apps/answerball/bubbles";
import { createRng } from "../../../src/core/rng";
import { DEG } from "../../../src/core/sphere";

/** The room's up in the window's frame, for a window facing `lat` below or above level. */
const upFor = (lat: number): [number, number, number] => [0, Math.cos(lat), -Math.sin(lat)];

const run = (seconds: number, up: [number, number, number], b = createBubbles(createRng("b"))) => {
  for (let i = 0; i < seconds * 60; i++) b.step(1 / 60, up);
  return b;
};

describe("bubbles", () => {
  it("float up a side-facing window and gather under its upper rim", () => {
    const b = run(30, upFor(-20 * DEG));
    expect(b.list.length).toBe(BUBBLES);
    for (const x of b.list) {
      expect(x.y).toBeGreaterThan(0.5);
      expect(Math.hypot(x.x, x.y) + x.r).toBeLessThanOrEqual(1);
      expect(x.alpha).toBeGreaterThan(0.9);
    }
    // They don't sit on top of each other.
    for (let i = 0; i < b.list.length; i++) {
      for (let j = i + 1; j < b.list.length; j++) {
        const p = b.list[i]!;
        const q = b.list[j]!;
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan((p.r + q.r) * 0.9);
      }
    }
  });

  it("leave a down-facing window clear, and come back when it faces the side again", () => {
    expect(clinging(upFor(-90 * DEG))).toBe(0);
    expect(clinging(upFor(-20 * DEG))).toBe(1);
    const b = run(10, upFor(-20 * DEG));
    run(10, upFor(-90 * DEG), b);
    for (const x of b.list) expect(x.alpha).toBeLessThan(0.01);
    run(10, upFor(-10 * DEG), b);
    for (const x of b.list) expect(x.alpha).toBeGreaterThan(0.9);
  });

  it("swirl when shaken, then settle again, staying in the window for days", () => {
    const b = run(20, upFor(-15 * DEG));
    const before = b.list.map((x) => [x.x, x.y]);
    b.swirl(1.3);
    run(0.5, upFor(-15 * DEG), b);
    const moved = b.list.reduce(
      (m, x, i) => Math.max(m, Math.hypot(x.x - before[i]![0]!, x.y - before[i]![1]!)),
      0,
    );
    expect(moved).toBeGreaterThan(0.05);
    for (let k = 0; k < 2000; k++) {
      if (k % 7 === 0) b.swirl(1.3);
      run(1, upFor((-10 - (k % 25)) * DEG), b);
      for (const x of b.list) {
        expect(Number.isFinite(x.x) && Number.isFinite(x.y)).toBe(true);
        expect(Math.hypot(x.x, x.y) + x.r).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
