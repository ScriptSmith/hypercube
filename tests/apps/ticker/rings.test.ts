import { describe, expect, it } from "vitest";
import { emblemRadius } from "../../../src/apps/ticker/index";
import { BAND_OVER_LETTER, layoutRings, SPEEDS } from "../../../src/apps/ticker/rings";
import { DEG, sphereInfo } from "../../../src/core/sphere";

const deg = (r: number) => r / DEG;

describe("ticker rings", () => {
  it("put the rings at their set latitudes and sizes on the default 4 m ball", () => {
    const s = sphereInfo();
    const [main, lower, pole] = layoutRings(s, 3);
    expect(main!.role).toBe("main");
    expect(deg(main!.centre)).toBeCloseTo(-8, 5);
    expect(main!.letterM).toBeCloseTo(0.4);
    expect(main!.speedM).toBeCloseTo(0.32);
    // The lower ring spans about 35° to 50° below the equator.
    expect(deg(lower!.top)).toBeGreaterThan(-36);
    expect(deg(lower!.bottom)).toBeLessThan(-48);
    expect(lower!.letterM).toBeCloseTo(0.32);
    expect(deg(pole!.centre)).toBeCloseTo(-70, 5);
    expect(pole!.letterM).toBeCloseTo(0.24);
    expect(layoutRings(s, 1).map((r) => r.role)).toEqual(["main"]);
    expect(layoutRings(s, 2).map((r) => r.role)).toEqual(["main", "lower"]);
  });

  it("keep every ring inside the band people see, in order and apart, on any ball", () => {
    const views: ({ top: number; bottom: number } | undefined)[] = [
      undefined,
      { top: 30, bottom: -30 },
      { top: 10, bottom: -10 },
      { top: -20, bottom: -90 },
      { top: 60, bottom: 0 },
    ];
    for (const diameter of [1, 2, 3, 5, 8, 12, 20]) {
      for (const bottom of [0.3, 1, 2.5, 4, 8]) {
        for (const view of views) {
          const s = sphereInfo(undefined, { diameter, bottom, view });
          for (const count of [1, 2, 3]) {
            const rings = layoutRings(s, count);
            const where = `d=${diameter} b=${bottom} view=${JSON.stringify(view)} n=${count}`;
            expect(rings, where).toHaveLength(count);
            let above = Math.min(s.view.top, 84 * DEG) + 1e-9;
            for (const r of rings) {
              expect(r.top, where).toBeLessThanOrEqual(above);
              expect(r.bottom, where).toBeGreaterThanOrEqual(
                Math.max(s.view.bottom, -84 * DEG) - 1e-9,
              );
              expect(r.top - r.bottom, where).toBeGreaterThan(0);
              expect(r.letterM, where).toBeGreaterThan(0);
              // Band height on the surface matches its letters.
              expect((r.top - r.bottom) * s.radius, where).toBeCloseTo(
                r.letterM * BAND_OVER_LETTER,
                6,
              );
              above = r.bottom;
            }
          }
        }
      }
    }
  });

  it("shrink the rings together only when they don't fit", () => {
    const roomy = layoutRings(sphereInfo(), 3);
    const tight = layoutRings(sphereInfo(undefined, { view: { top: 10, bottom: -10 } }), 3);
    expect(tight[0]!.letterM / roomy[0]!.letterM).toBeCloseTo(
      tight[2]!.letterM / roomy[2]!.letterM,
      9,
    );
    expect(tight[0]!.letterM).toBeLessThan(roomy[0]!.letterM);
  });

  it("scale sizes and speeds with the ball, and speeds with the option", () => {
    const small = layoutRings(sphereInfo(undefined, { diameter: 2.5 }), 2);
    const big = layoutRings(sphereInfo(undefined, { diameter: 10 }), 2);
    expect(big[0]!.letterM / small[0]!.letterM).toBeCloseTo(4);
    expect(big[1]!.speedM / small[1]!.speedM).toBeCloseTo(4);
    const fast = layoutRings(sphereInfo(), 2, SPEEDS.fast);
    const slow = layoutRings(sphereInfo(), 2, SPEEDS.slow);
    expect(fast[0]!.speedM).toBeGreaterThan(0.32);
    expect(slow[0]!.speedM).toBeLessThan(0.32);
    // The rings never crawl as one.
    expect(small[0]!.speedM).not.toBeCloseTo(small[1]!.speedM);
  });

  it("fit the medallion under the lowest ring, or leave it out", () => {
    const s = sphereInfo();
    expect(deg(emblemRadius(layoutRings(s, 2)))).toBeCloseTo(15);
    const three = layoutRings(s, 3);
    const e = emblemRadius(three);
    expect(e).toBeGreaterThan(4 * DEG);
    expect(e + 4 * DEG - 1e-9).toBeLessThanOrEqual(three[2]!.bottom + Math.PI / 2);
    expect(emblemRadius([{ bottom: -87 * DEG }])).toBe(0);
  });
});
