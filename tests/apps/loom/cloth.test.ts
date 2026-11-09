import { describe, expect, it } from "vitest";
import {
  BAND_SAMPLES,
  bandFrom,
  createCloth,
  inside,
  MAX_BANDS,
  shapeAt,
  warpColours,
} from "../../../src/apps/loom/cloth";
import { targetFor } from "../../../src/apps/loom/series";

describe("loom cloth", () => {
  it("keeps one period of the matched shape, scaled to a peak of one", () => {
    const sq = targetFor(0, 10)!;
    const b = bandFrom(1, sq.terms, "Square", true);
    expect(b.shape).toHaveLength(BAND_SAMPLES);
    expect(Math.max(...b.shape.map(Math.abs))).toBeCloseTo(1, 9);
    // A square wave: the first half up, the second down.
    expect(b.shape[BAND_SAMPLES / 4]!).toBeGreaterThan(0.5);
    expect(b.shape[(3 * BAND_SAMPLES) / 4]!).toBeLessThan(-0.5);
    // Silence makes a flat band rather than dividing by nothing.
    const flat = bandFrom(
      2,
      sq.terms.map(() => ({ amp: 0, phase: 0 })),
      null,
      false,
    );
    expect(flat.shape.every((v) => v === 0)).toBe(true);
    expect(flat.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 9);
  });

  it("shares the warp between harmonics by their amplitudes", () => {
    const sq = targetFor(0, 6)!;
    const b = bandFrom(1, sq.terms, "Square", true);
    // The square uses harmonics 1, 3 and 5 equally.
    const warp = warpColours(b.weights, 30);
    expect(warp).toHaveLength(30);
    expect(warp.filter((h) => h === 0)).toHaveLength(10);
    expect(warp.filter((h) => h === 2)).toHaveLength(10);
    expect(warp.filter((h) => h === 4)).toHaveLength(10);
    expect(warp.filter((h) => h === 1)).toHaveLength(0);
    // Stripes in order.
    expect([...warp].sort((a, b2) => a - b2)).toEqual(warp);
    expect(warpColours([0.5, 0.25, 0.25], 7)).toHaveLength(7);
  });

  it("weaves the silhouette between the curve and its middle", () => {
    const sq = targetFor(0, 10)!;
    const b = bandFrom(1, sq.terms, "Square", true);
    const ends = 40;
    const picks = 10;
    // One period across: the left half's upper rows are in, its lower rows out, and so on.
    expect(inside(b, 5, 1, ends, picks, 1)).toBe(true);
    expect(inside(b, 5, 8, ends, picks, 1)).toBe(false);
    expect(inside(b, 30, 8, ends, picks, 1)).toBe(true);
    expect(inside(b, 30, 1, ends, picks, 1)).toBe(false);
    expect(shapeAt(b.shape, 0.25)).toBeCloseTo(shapeAt(b.shape, 1.25), 9);
  });

  it("holds at most MAX_BANDS bands", () => {
    const c = createCloth();
    const sq = targetFor(0, 10)!;
    for (let i = 0; i < 50; i++) c.add({ values: sq.terms, title: "Square", people: i % 2 === 0 });
    expect(c.bands).toHaveLength(MAX_BANDS);
    expect(c.woven).toBe(50);
    expect(c.bands.map((b) => b.id)).toEqual(Array.from({ length: MAX_BANDS }, (_, i) => 43 + i));
  });
});
