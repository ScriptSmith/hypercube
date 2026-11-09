import { describe, expect, it } from "vitest";
import {
  angle,
  dot,
  eyeFrame,
  fromAngles,
  nudge,
  PRIMARY,
  slerp,
  towards,
} from "../../../src/apps/gaze/geom";
import type { Mat3, Vec3 } from "../../../src/core/sphere";
import { DEG } from "../../../src/core/sphere";

const rows = (m: Mat3): [Vec3, Vec3, Vec3] => [
  [m[0], m[1], m[2]],
  [m[3], m[4], m[5]],
  [m[6], m[7], m[8]],
];

describe("directions", () => {
  it("measures angles, including tiny and nearly opposite ones", () => {
    const a = fromAngles(0, 0);
    expect(angle(a, fromAngles(0, 1e-7))).toBeCloseTo(1e-7, 12);
    expect(angle(a, fromAngles(0, Math.PI - 1e-6))).toBeCloseTo(Math.PI - 1e-6, 9);
  });

  it("moves along great circles", () => {
    const a = fromAngles(-30 * DEG, 0);
    const b = fromAngles(-50 * DEG, 80 * DEG);
    const total = angle(a, b);
    expect(angle(slerp(a, b, 0), a)).toBeLessThan(1e-9);
    expect(angle(slerp(a, b, 1), b)).toBeLessThan(1e-9);
    expect(angle(a, slerp(a, b, 0.3))).toBeCloseTo(total * 0.3, 9);
    expect(angle(a, slerp(a, b, 1.1))).toBeCloseTo(total * 1.1, 9);
    expect(angle(towards(a, b, 5 * DEG), a)).toBeCloseTo(5 * DEG, 9);
    expect(towards(a, b, 4)).toBe(b);
  });

  it("nudges by small angles", () => {
    const d = fromAngles(-40 * DEG, 1);
    expect(angle(d, nudge(d, 0.01, 0))).toBeCloseTo(0.01, 5);
    expect(angle(d, nudge(d, 0, 0.01))).toBeCloseTo(0.01, 5);
  });
});

describe("the eye's frame", () => {
  it("is a rotation with z along the gaze", () => {
    for (const [e, b, tw] of [
      [-90, 0, 0],
      [-40, 30, 0.02],
      [0, -170, -0.01],
      [35, 100, 0],
    ] as const) {
      const g = fromAngles(e * DEG, b * DEG);
      const [x, y, z] = rows(eyeFrame(g, tw));
      expect(angle(z, g)).toBeLessThan(1e-9);
      expect(dot(x, x)).toBeCloseTo(1, 9);
      expect(dot(y, y)).toBeCloseTo(1, 9);
      expect(dot(x, y)).toBeCloseTo(0, 9);
      expect(dot(x, z)).toBeCloseTo(0, 9);
      // Right-handed: x × y = z.
      const c: Vec3 = [
        x[1] * y[2] - x[2] * y[1],
        x[2] * y[0] - x[0] * y[2],
        x[0] * y[1] - x[1] * y[0],
      ];
      expect(angle(c, z)).toBeLessThan(1e-9);
    }
  });

  it("follows Listing's law, so the iris never winds up a twist", () => {
    // Round a loop of gazes and back: the frame is the same as it started.
    const start = eyeFrame(fromAngles(-50 * DEG, 0));
    for (let i = 0; i < 200; i++) eyeFrame(fromAngles(-20 * DEG, i));
    const again = eyeFrame(fromAngles(-50 * DEG, 0));
    for (let k = 0; k < 9; k++) expect(again[k]).toBeCloseTo(start[k]!, 12);
    // Straight down is the primary position: the frame there is the reference one.
    const [, , z] = rows(eyeFrame(PRIMARY));
    expect(angle(z, PRIMARY)).toBeLessThan(1e-12);
  });

  it("twists about the gaze by the torsion given", () => {
    const g = fromAngles(-30 * DEG, 0.4);
    const [x0] = rows(eyeFrame(g, 0));
    const [x1] = rows(eyeFrame(g, 2 * DEG));
    expect(angle(x0, x1)).toBeCloseTo(2 * DEG, 9);
  });
});
