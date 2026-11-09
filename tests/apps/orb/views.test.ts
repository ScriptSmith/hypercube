import { describe, expect, it } from "vitest";
import { DEG, direction, sphereInfo, type Vec3 } from "../../../src/core/sphere";
import {
  AROUND,
  BEARING_RATE,
  bearingAt,
  DISTANCE_R,
  facing,
  hasBelow,
  VIEWERS,
  viewersFor,
  viewWeights,
  windowPoint,
} from "../../../src/apps/orb/views";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Directions over the whole orb, every few degrees. */
const directions = (step = 3): Vec3[] => {
  const out: Vec3[] = [];
  for (let lat = -89; lat <= 89; lat += step) {
    for (let lon = -180; lon < 180; lon += step) out.push(direction(lat * DEG, lon * DEG));
  }
  return out;
};

describe("orb viewers", () => {
  const ball = sphereInfo();

  it("stands six round the orb, windows on every other one, one underneath and one overhead", () => {
    const vs = viewersFor(ball, 0.3);
    expect(vs).toHaveLength(VIEWERS);
    expect(vs.map((v) => v.window)).toEqual([true, true, true, true, false, false, false, false]);
    const ring = [0, 4, 1, 5, 2, 6];
    ring.forEach((index, k) => {
      const e = vs[index]!.eye;
      expect(Math.hypot(e[0], e[2])).toBeCloseTo(DISTANCE_R, 9);
      const a = 0.3 + (k * Math.PI) / AROUND;
      expect(Math.atan2(e[0], e[2])).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 9);
      // Eye height 1.6 m, below the centre of the default orb.
      expect(e[1]).toBeCloseTo((1.6 - ball.centreY) / ball.radius, 9);
    });
    expect(vs[3]!.eye[1]).toBeLessThan(-1);
    expect(vs[7]!.eye[1]).toBeGreaterThan(1);
    for (const v of vs) {
      expect(len(v.normal)).toBeCloseTo(1, 9);
      expect(len(v.right)).toBeCloseTo(1, 9);
      expect(len(v.up)).toBeCloseTo(1, 9);
      expect(dot(v.normal, v.right)).toBeCloseTo(0, 9);
      expect(dot(v.normal, v.up)).toBeCloseTo(0, 9);
      expect(dot(v.right, v.up)).toBeCloseTo(0, 9);
      // Every eye is outside the glass.
      expect(len(v.eye)).toBeGreaterThan(1.1);
    }
    // Pictures round the orb stand upright.
    for (const i of ring) expect(vs[i]!.up[1]).toBeGreaterThan(0.9);
  });

  it("gives the picture underneath to nobody when the orb hangs too low to stand under", () => {
    const low = sphereInfo(undefined, { diameter: 5, bottom: 1.2 });
    expect(hasBelow(low)).toBe(false);
    const vs = viewersFor(low, 0);
    expect(vs.map((v) => v.window).slice(0, 4)).toEqual([true, true, true, false]);
    expect(len(vs[3]!.eye)).toBeGreaterThan(1.1);
    expect(vs[3]!.eye[1]).toBeLessThan(0);
  });

  it("sees every point of the glass squarely enough from someone", () => {
    const vs = viewersFor(ball, 1.1);
    for (const n of directions()) {
      const best = Math.max(...vs.map((v) => facing(n, v.eye)));
      expect(best).toBeGreaterThan(0.29);
      const w = viewWeights(vs, n);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      // Two views at most share a point, and one of them always leads.
      expect(w.filter((x) => x > 0).length).toBeLessThanOrEqual(4);
      expect(Math.max(...w)).toBeGreaterThan(0.33);
    }
  });

  it("shows each vision square on in front of its viewer, well clear of the joins", () => {
    const vs = viewersFor(ball, -0.7);
    vs.forEach((v, i) => {
      if (!v.window) return;
      // The point of the glass that faces the viewer is the middle of the picture.
      const toward = v.normal;
      const p = windowPoint(v, toward)!;
      expect(Math.hypot(p[0], p[1])).toBeLessThan(0.05);
      expect(viewWeights(vs, toward, 1)[i]).toBeGreaterThan(0.99);
    });
    let inside = 0;
    for (const n of directions(2)) {
      // While a vision is fully open.
      const w = viewWeights(vs, n, 1);
      vs.forEach((v, i) => {
        if (!v.window) return;
        const p = windowPoint(v, n);
        if (!p || Math.hypot(p[0], p[1]) > 0.8) return;
        inside++;
        expect(w[i]).toBeGreaterThan(0.9);
      });
    }
    expect(inside).toBeGreaterThan(500);
  });

  it("puts the picture's right on the right and its top at the top", () => {
    const vs = viewersFor(ball, 0);
    const v = vs[0]!;
    const centre = Math.atan2(v.eye[0], v.eye[2]);
    const lat = Math.asin(v.normal[1]);
    const right = windowPoint(v, direction(lat, centre + 10 * DEG))!;
    const up = windowPoint(v, direction(lat + 10 * DEG, centre))!;
    expect(right[0]).toBeGreaterThan(0.1);
    expect(Math.abs(right[1])).toBeLessThan(0.05);
    expect(up[1]).toBeGreaterThan(0.1);
    // A point round the back is not in this viewer's window.
    expect(windowPoint(v, direction(0, centre + Math.PI))).toBeNull();
  });

  it("drifts round slowly and evenly, turning the picture underneath without a jump", () => {
    expect(bearingAt(0)).toBe(0);
    expect(bearingAt(100)).toBeCloseTo(100 * BEARING_RATE, 9);
    let prevRight: Vec3 | null = null;
    for (let t = 0; t < 4 * 3600; t += 5) {
      const b = bearingAt(t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(2 * Math.PI);
      const right = viewersFor(ball, b)[3]!.right;
      if (prevRight) expect(dot(right, prevRight)).toBeGreaterThan(Math.cos(0.15));
      prevRight = right;
    }
  });
});
