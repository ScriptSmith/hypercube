import { describe, expect, it } from "vitest";
import {
  advance,
  apexTime,
  type Ballistic,
  climbPhysics,
  positionAt,
  timeToHeight,
  timeToX,
  velocityAt,
} from "../../../src/apps/fireworks/path";

/** Small-step integration of the same motion, to check the closed form against. */
const integrate = (b: Ballistic, t: number) => {
  const dt = 1e-4;
  let { x, y, vx, vy } = b;
  for (let s = 0; s < t; s += dt) {
    vx += -b.k * vx * dt;
    vy += (-b.g - b.k * vy) * dt;
    x += vx * dt;
    y += vy * dt;
  }
  return { x, y };
};

describe("fireworks closed-form paths", () => {
  it("matches step-by-step integration, with and without drag", () => {
    for (const b of [
      { x: 10, y: -1500, vx: 300, vy: 3400, g: 420, k: 0 },
      { x: 0, y: 0, vx: -800, vy: 1200, g: 900, k: 3.4 },
    ]) {
      for (const t of [0.1, 0.7, 1.9]) {
        const p = positionAt(b, t);
        const q = integrate(b, t);
        expect(p.x).toBeCloseTo(q.x, -1);
        expect(p.y).toBeCloseTo(q.y, -1);
      }
    }
  });

  it("finds the apex, a height on the way up, and an edge", () => {
    const b = { x: 0, y: 0, vx: 200, vy: 1000, g: 500, k: 0 };
    expect(apexTime(b)).toBeCloseTo(2, 6);
    const t = timeToHeight(b, 750)!;
    expect(positionAt(b, t).y).toBeCloseTo(750, 3);
    expect(t).toBeLessThan(2);
    // Higher than the apex: never.
    expect(timeToHeight(b, 1001)).toBeNull();
    expect(timeToX(b, 300)).toBeCloseTo(1.5, 6);
    expect(timeToX(b, -1)).toBeNull();
    const dragged = { ...b, k: 2 };
    // Drag stops it short of 200 / 2 = 100 units across.
    expect(timeToX(dragged, 120)).toBeNull();
    expect(positionAt(dragged, timeToX(dragged, 80)!).x).toBeCloseTo(80, 6);
  });

  it("continues seamlessly from any point along it", () => {
    const b = { x: 5, y: -10, vx: -120, vy: 900, g: 300, k: 1.2 };
    const later = advance(b, 0.8);
    for (const dt of [0, 0.25, 1.1]) {
      const p = positionAt(b, 0.8 + dt);
      const q = positionAt(later, dt);
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
    }
    expect(velocityAt(later, 0).y).toBeCloseTo(velocityAt(b, 0.8).y, 6);
  });

  it("gives a climb that leaves the frame on time and keeps rising", () => {
    const { v, g } = climbPhysics(1500, 0.47, 14_000);
    const b = { x: 0, y: -1500, vx: 0, vy: v, g, k: 0 };
    expect(timeToHeight(b, 0)).toBeCloseTo(0.47, 3);
    expect(apexTime(b) * v - (g * apexTime(b) ** 2) / 2).toBeCloseTo(14_000, -1);
  });
});
