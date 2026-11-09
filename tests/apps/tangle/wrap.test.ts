import { describe, expect, it } from "vitest";
import { cellAt, createGrid, someCell } from "../../../src/apps/tangle/grid";
import {
  MAX_PIECES,
  PIECE_FLOATS,
  splitSegment,
  wrapDelta,
  wrapInto,
} from "../../../src/apps/tangle/wrap";

const W = 1000;
const H = 600;

const split = (x0: number, y0: number, x1: number, y1: number) => {
  const out = new Float32Array(MAX_PIECES * PIECE_FLOATS);
  const n = splitSegment(x0, y0, x1, y1, W, H, out);
  return Array.from({ length: n }, (_, k) => Array.from(out.slice(k * 4, k * 4 + 4)));
};

const length = (p: number[]) => Math.hypot(p[2]! - p[0]!, p[3]! - p[1]!);

const expectInside = (pieces: number[][]) => {
  for (const p of pieces) {
    for (const x of [p[0]!, p[2]!]) {
      expect(x).toBeGreaterThanOrEqual(-1e-3);
      expect(x).toBeLessThanOrEqual(W + 1e-3);
    }
    for (const y of [p[1]!, p[3]!]) {
      expect(y).toBeGreaterThanOrEqual(-1e-3);
      expect(y).toBeLessThanOrEqual(H + 1e-3);
    }
  }
};

describe("wrap geometry", () => {
  it("brings positions into the arena and finds the short way round", () => {
    expect(wrapInto(1005, W)).toBeCloseTo(5);
    expect(wrapInto(-5, W)).toBeCloseTo(995);
    expect(wrapInto(W, W)).toBe(0);
    expect(wrapInto(-1e-12, W)).toBeLessThan(W);
    expect(wrapDelta(990, W)).toBeCloseTo(-10);
    expect(wrapDelta(-990, W)).toBeCloseTo(10);
    expect(wrapDelta(30, W)).toBeCloseTo(30);
  });

  it("leaves a segment inside the arena whole", () => {
    expect(split(100, 100, 104, 103)).toEqual([[100, 100, 104, 103]]);
  });

  it("cuts a segment off the right edge into two pieces, one each side", () => {
    const pieces = split(996, 300, 1006, 310);
    expect(pieces).toHaveLength(2);
    const [a, b] = pieces as [number[], number[]];
    expect(a[0]).toBeCloseTo(996);
    expect(a[2]).toBeCloseTo(W);
    expect(a[3]).toBeCloseTo(304);
    expect(b[0]).toBeCloseTo(0);
    expect(b[1]).toBeCloseTo(304);
    expect(b[2]).toBeCloseTo(6);
    expect(b[3]).toBeCloseTo(310);
    expectInside(pieces);
    // Nothing is drawn across the arena: the pieces add up to the segment.
    expect(length(a) + length(b)).toBeCloseTo(Math.hypot(10, 10));
  });

  it("cuts segments off the left, top and bottom edges", () => {
    for (const [x0, y0, x1, y1] of [
      [3, 200, -5, 200],
      [500, 2, 500, -6],
      [500, 597, 500, 603],
    ] as const) {
      const pieces = split(x0, y0, x1, y1);
      expect(pieces).toHaveLength(2);
      expectInside(pieces);
      const total = pieces.reduce((n, p) => n + length(p), 0);
      expect(total).toBeCloseTo(Math.hypot(x1 - x0, y1 - y0));
      for (const p of pieces) expect(length(p)).toBeLessThanOrEqual(8 + 1e-3);
    }
  });

  it("cuts a segment through a corner into three pieces", () => {
    const pieces = split(998, 597, 1004, 605);
    expect(pieces).toHaveLength(3);
    expectInside(pieces);
    const total = pieces.reduce((n, p) => n + length(p), 0);
    expect(total).toBeCloseTo(10);
    // The last piece ends where the segment ends, moved back in through the corner.
    expect(pieces[2]![2]).toBeCloseTo(4);
    expect(pieces[2]![3]).toBeCloseTo(5);
  });
});

describe("wrapping grid", () => {
  it("fits whole cells across the arena", () => {
    const g = createGrid(1003, 597, 8, { wrap: true });
    expect(g.cols).toBe(125);
    expect(g.cw * g.cols).toBeCloseTo(1003);
    expect(g.ch * g.rows).toBeCloseTo(597);
    expect(g.cw).toBeCloseTo(8, 0);
  });

  it("finds the cells across an edge", () => {
    const g = createGrid(80, 80, 8, { wrap: true });
    const seen: number[] = [];
    someCell(g, 2, 40, 8, (i) => {
      seen.push(i);
      return false;
    });
    // Columns 9 (across the left edge), 0 and 1, in the rows either side of y = 40.
    const cols = new Set(seen.map((i) => i % 10));
    expect([...cols].sort((a, b) => a - b)).toEqual([0, 9]);
    expect(cellAt(g, -3, 40)).toBe(5 * 10 + 9);
    expect(cellAt(g, 83, -1)).toBe(9 * 10 + 0);
  });

  it("keeps a solid grid's edges", () => {
    const g = createGrid(80, 80, 8);
    const seen: number[] = [];
    someCell(g, 2, 40, 8, (i) => {
      seen.push(i);
      return false;
    });
    expect(seen.every((i) => i % 10 <= 1)).toBe(true);
    expect(cellAt(g, -3, 40)).toBe(-1);
  });
});
