import { describe, expect, it } from "vitest";
import {
  makeShapeLine,
  MAX_PATH_POINTS,
  pathBetween,
  project,
  shapeHeading,
  SNAP_M,
} from "../../../src/apps/transit/match";

/** An L-shaped route: 1 km east, then 1 km north. */
const ell = makeShapeLine(Float32Array.from([0, 0, 500, 0, 1000, 0, 1000, 500, 1000, 1000]));

describe("shape matching", () => {
  it("measures distances along the shape", () => {
    expect(Array.from(ell.cum)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(ell.box).toEqual([0, 0, 1000, 1000]);
    const p = project(ell, 1020, 700);
    expect(p.d).toBeCloseTo(20);
    expect(p.s).toBeCloseTo(1700);
    expect(p.seg).toBe(3);
  });

  it("follows the shape round the corner between two fixes near it", () => {
    const path = pathBetween([ell], 800, 10, 990, 300);
    expect(path.slice(0, 2)).toEqual([800, 10]);
    expect(path.slice(-2)).toEqual([990, 300]);
    // Through the corner rather than across it.
    const xs = path.filter((_, i) => i % 2 === 0);
    const ys = path.filter((_, i) => i % 2 === 1);
    expect(xs).toContain(1000);
    expect(ys).toContain(0);
  });

  it("goes straight when a fix is too far from the shape", () => {
    expect(pathBetween([ell], 800, 10, 990 - SNAP_M - 50, 300)).toEqual([800, 10, 840, 300]);
  });

  it("never runs backwards along the shape", () => {
    expect(pathBetween([ell], 990, 300, 800, 10)).toEqual([990, 300, 800, 10]);
  });

  it("goes straight when the shape would be a long way round", () => {
    // A hairpin: out 2 km and back on a line 80 m away.
    const hairpin = makeShapeLine(Float32Array.from([0, 0, 2000, 0, 2000, 80, 0, 80]));
    expect(pathBetween([hairpin], 100, 0, 100, 80)).toEqual([100, 0, 100, 80]);
  });

  it("picks the closer of two candidate shapes", () => {
    const parallel = makeShapeLine(Float32Array.from([0, 60, 1000, 60]));
    const path = pathBetween([parallel, ell], 100, 5, 400, 5);
    expect(path).toEqual([100, 5, 100, 0, 400, 0, 400, 5]);
  });

  it("keeps paths short enough", () => {
    const many: number[] = [];
    for (let i = 0; i <= 400; i++) many.push(i * 10, 0);
    const line = makeShapeLine(Float32Array.from(many));
    expect(pathBetween([line], 0, 5, 3990, 5)).toEqual([0, 5, 3990, 5]);
    expect(pathBetween([line], 0, 5, 500, 5).length / 2).toBeLessThanOrEqual(MAX_PATH_POINTS + 4);
  });

  it("gives the direction of travel along the nearest shape", () => {
    expect(shapeHeading([ell], 300, 20)).toBeCloseTo(Math.PI / 2);
    expect(shapeHeading([ell], 1010, 600)).toBeCloseTo(0);
    expect(shapeHeading([ell], 300, 400)).toBeNull();
  });
});
