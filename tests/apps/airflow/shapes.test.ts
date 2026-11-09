import { describe, expect, it } from "vitest";
import {
  inside,
  isShapeId,
  outlinePath,
  place,
  SHAPE_IDS,
  SHAPES,
  signedArea2,
  triangulate,
  trianglesOf,
} from "../../../src/apps/airflow/shapes";

const area = (tri: number[], poly: readonly (readonly [number, number])[]) => {
  let a = 0;
  for (let k = 0; k < tri.length; k += 3) {
    const p = poly[tri[k]!]!;
    const q = poly[tri[k + 1]!]!;
    const r = poly[tri[k + 2]!]!;
    a += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
  }
  return a;
};

/** Do segments ab and cd cross (not counting shared ends)? */
const crosses = (
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
) => {
  const o = (p: readonly number[], q: readonly number[], r: readonly number[]) =>
    Math.sign((q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

describe("shapes", () => {
  it("has seven pre-made shapes, each a simple outline within the 100-unit box", () => {
    expect(SHAPE_IDS).toHaveLength(7);
    for (const id of SHAPE_IDS) {
      const poly = SHAPES[id].outline;
      expect(poly.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of poly) {
        expect(Math.abs(x)).toBeLessThanOrEqual(50.01);
        expect(Math.abs(y)).toBeLessThanOrEqual(50.01);
      }
      for (let i = 0; i < poly.length; i++) {
        for (let j = i + 2; j < poly.length; j++) {
          if (i === 0 && j === poly.length - 1) continue;
          const a = poly[i]!;
          const b = poly[(i + 1) % poly.length]!;
          const c = poly[j]!;
          const d = poly[(j + 1) % poly.length]!;
          expect(crosses(a, b, c, d), `${id} edges ${i} and ${j}`).toBe(false);
        }
      }
    }
  });

  it("triangulates every outline into triangles covering exactly its area", () => {
    for (const id of SHAPE_IDS) {
      const poly = SHAPES[id].outline;
      const tri = trianglesOf(id);
      expect(tri.length).toBe((poly.length - 2) * 3);
      expect(area(tri, poly)).toBeCloseTo(Math.abs(signedArea2(poly)) / 2, 6);
    }
  });

  it("triangulates either winding and a concave outline", () => {
    const l = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ] as const;
    expect(area(triangulate(l), l)).toBeCloseTo(64, 9);
    const r = [...l].reverse();
    expect(area(triangulate(r), r)).toBeCloseTo(64, 9);
  });

  it("is large enough for the flow to see: no shape thinner than a few lattice cells", () => {
    // The thinnest outline (the plate) at the smallest size (the kiosk, 250 px) and the
    // coarsest panel cell is still two cells thick.
    let thinnest = Number.POSITIVE_INFINITY;
    for (const id of SHAPE_IDS) {
      const ys = SHAPES[id].outline.map((p) => p[1]);
      thinnest = Math.min(thinnest, Math.max(...ys) - Math.min(...ys));
    }
    expect((thinnest / 100) * 250).toBeGreaterThan(20);
  });

  it("places outline points turned anticlockwise as drawn", () => {
    // A point to the right of centre turned a quarter anticlockwise ends up above it (y down).
    const [x, y] = place([10, 0], 100, 100, 90, 100);
    expect(x).toBeCloseTo(100, 9);
    expect(y).toBeCloseTo(90, 9);
    const [sx, sy] = place([10, 0], 0, 0, 0, 200);
    expect(sx).toBeCloseTo(20, 9);
    expect(sy).toBeCloseTo(0, 9);
  });

  it("tests points inside an outline", () => {
    expect(inside(SHAPES.disc.outline, 0, 0)).toBe(true);
    expect(inside(SHAPES.disc.outline, 40, 0)).toBe(false);
    expect(inside(SHAPES.block.outline, 30, 30)).toBe(true);
    expect(inside(SHAPES.block.outline, 32, 0)).toBe(false);
    // The building is tall and narrow.
    expect(inside(SHAPES.building.outline, 0, 40)).toBe(true);
    expect(inside(SHAPES.building.outline, 30, 0)).toBe(false);
  });

  it("draws outlines as closed paths and knows its own ids", () => {
    expect(outlinePath(SHAPES.block.outline)).toMatch(/^M.*Z$/);
    expect(isShapeId("wing")).toBe(true);
    expect(isShapeId("plane")).toBe(false);
    expect(isShapeId(3)).toBe(false);
  });
});
