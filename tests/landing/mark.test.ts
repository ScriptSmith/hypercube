// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createMark, projectTesseract } from "../../src/pages/landing/mark";

const PLANES = [
  [0, 3],
  [1, 3],
  [2, 3],
] as const;

/** Every drawn point, rounded, as a sorted set, so drawings compare regardless of labels. */
const points = (plane: readonly [number, number], angle: number): string[] =>
  [
    ...new Set(projectTesseract(plane, angle).map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)),
  ].sort();

describe("brand mark", () => {
  it("rests as the static mark: a 17-unit square around a 7-unit one", () => {
    const xs = projectTesseract(PLANES[0], 0).map((p) => p.x);
    expect([...new Set(xs.map((x) => x.toFixed(3)))].sort()).toEqual(
      ["1.500", "18.500", "13.500", "6.500"].sort(),
    );
  });

  it("ends each quarter turn where it began", () => {
    const rest = points(PLANES[0], 0);
    for (const plane of PLANES) expect(points(plane, Math.PI / 2)).toEqual(rest);
  });

  it("stays inside its box while turning", () => {
    for (const plane of PLANES) {
      for (let i = 0; i <= 20; i++) {
        for (const p of projectTesseract(plane, (i / 20) * (Math.PI / 2))) {
          expect(p.x).toBeGreaterThanOrEqual(1.5 - 1e-9);
          expect(p.x).toBeLessThanOrEqual(18.5 + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(1.5 - 1e-9);
          expect(p.y).toBeLessThanOrEqual(18.5 + 1e-9);
        }
      }
    }
  });

  it("draws all 32 edges", () => {
    const svg = createMark();
    expect(svg.querySelectorAll("line")).toHaveLength(32);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});
