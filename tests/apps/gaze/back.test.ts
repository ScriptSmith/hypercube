import { describe, expect, it } from "vitest";
import { growBack, throughSclera } from "../../../src/apps/gaze/back";
import { IRIS_ANGLE } from "../../../src/apps/gaze/physiology";
import { createRng } from "../../../src/core/rng";

const DEG = Math.PI / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe("the back's vessels", () => {
  const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("are bounded, behind the limbus and short of the back pole", () => {
    for (const seed of seeds) {
      const paths = growBack(createRng(seed));
      expect(paths.length).toBeLessThan(60);
      for (const p of paths) {
        expect(p.length).toBeLessThanOrEqual(41);
        for (const q of p) {
          expect(q.th).toBeGreaterThan(IRIS_ANGLE + 10 * DEG);
          expect(q.th).toBeLessThan(170 * DEG);
          expect(q.width).toBeGreaterThan(0);
          expect(q.depth).toBeGreaterThanOrEqual(0);
          expect(q.depth).toBeLessThan(0.3);
        }
      }
    }
  });

  it("have a vortex vein in every quarter and none on the horizontal meridian", () => {
    for (const seed of seeds) {
      // The trunks: the paths that run straight back from just behind the equator.
      const trunks = growBack(createRng(seed)).filter(
        (p) => p.length === 15 && p[0]!.th > 90 * DEG && p[p.length - 1]!.th > p[0]!.th,
      );
      expect(trunks.length).toBeGreaterThanOrEqual(4);
      expect(trunks.length).toBeLessThanOrEqual(8);
      const quarters = new Set(
        trunks.map((t) => Math.floor((wrap(t[0]!.phi) + Math.PI) / (Math.PI / 2))),
      );
      expect(quarters.size).toBe(4);
      for (const t of trunks) {
        const off = Math.abs(Math.sin(t[0]!.phi));
        expect(off).toBeGreaterThan(Math.sin(15 * DEG));
      }
    }
  });

  it("show through most where the sclera is thinnest", () => {
    expect(throughSclera(Math.PI / 2)).toBeCloseTo(1, 5);
    expect(throughSclera(30 * DEG)).toBeLessThan(0.6);
    expect(throughSclera(160 * DEG)).toBeLessThan(0.3);
    expect(throughSclera(110 * DEG)).toBeLessThan(throughSclera(95 * DEG));
  });
});
