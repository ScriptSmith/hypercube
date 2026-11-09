import { describe, expect, it } from "vitest";
import {
  accommodationOf,
  amplitude,
  blurDeg,
  BEST_FOCUS_DEG,
  discDeg,
  emmetropicLength,
  eyePower,
  farPoint,
  focusAt,
  lengthFor,
  lensPower,
  LE_GRAND,
  nearPoint,
  ocularPower,
  paramFor,
  pupilDiameter,
  refraction,
  spectaclePower,
  traceRay,
} from "../../../src/apps/eye/optics";

/** Figures worked out by hand from the published models, checked against the model. */
describe("the schematic eye", () => {
  it("has Le Grand's power and focuses distant light at 24.2 mm", () => {
    expect(eyePower(LE_GRAND.r1)).toBeCloseTo(59.94, 2);
    expect(emmetropicLength()).toBeCloseTo(24.197, 3);
    expect(lensPower(0)).toBeCloseTo(21.78, 2);
    expect(refraction(emmetropicLength(), LE_GRAND.r1)).toBeCloseTo(0, 6);
  });

  it("changes about 2.6 D per mm of axial length", () => {
    const L = emmetropicLength();
    const cases: [number, number][] = [
      [1, -2.58],
      [2, -4.98],
      [3, -7.19],
      [-1, 2.8],
      [-2, 5.85],
    ];
    for (const [d, r] of cases) expect(refraction(L + d, LE_GRAND.r1)).toBeCloseTo(r, 1);
    // The slider's ends span about +7 to -7 D.
    expect(refraction(21, LE_GRAND.r1)).toBeGreaterThan(6.5);
    expect(refraction(27, LE_GRAND.r1)).toBeLessThan(-6.5);
  });

  it("changes about 0.6 D per 0.1 mm of corneal radius, steeper more short-sighted", () => {
    const L = emmetropicLength();
    const cases: [number, number][] = [
      [7.4, -2.61],
      [7.6, -1.27],
      [8.0, 1.21],
      [8.2, 2.36],
    ];
    for (const [r, v] of cases) expect(refraction(L, r)).toBeCloseTo(v, 1);
    const per = (refraction(L, 7.9) - refraction(L, 7.7)) / 2;
    expect(per).toBeGreaterThan(0.55);
    expect(per).toBeLessThan(0.65);
  });

  it("accommodates with Navarro's equations about as worked out by hand", () => {
    const L = emmetropicLength();
    const cases: [number, number][] = [
      [1, 1.23],
      [2, 2.2],
      [4, 3.94],
      [7, 6.58],
      [10, 9.55],
    ];
    for (const [a, d] of cases) expect(accommodationOf(a, L, LE_GRAND.r1)).toBeCloseTo(d, 1);
    expect(lensPower(10)).toBeCloseTo(34.6, 0);
    // The inverse finds the parameter for a wanted accommodation.
    expect(accommodationOf(paramFor(3, L, LE_GRAND.r1), L, LE_GRAND.r1)).toBeCloseTo(3, 3);
  });

  it("finds the length for a refraction", () => {
    expect(refraction(lengthFor(-3), LE_GRAND.r1)).toBeCloseTo(-3, 4);
    expect(refraction(lengthFor(3), LE_GRAND.r1)).toBeCloseTo(3, 4);
  });
});

describe("accommodation by age (Anderson 2008)", () => {
  it("matches values worked out from the curve", () => {
    const cases: [number, number][] = [
      [10, 7.1],
      [25, 6.7],
      [35, 4.97],
      [40, 3.3],
      [45, 1.7],
      [50, 0.7],
      [60, 0.1],
    ];
    for (const [age, a] of cases) expect(amplitude(age)).toBeCloseTo(a, 1);
  });
});

describe("far and near points", () => {
  it("follow -1/R and 1/(A - R)", () => {
    expect(farPoint(-2)).toBeCloseTo(0.5, 6);
    expect(nearPoint(-2, 7)).toBeCloseTo(1 / 9, 6);
    expect(nearPoint(3, 7)).toBeCloseTo(0.25, 6);
    expect(farPoint(1)).toBe(Number.POSITIVE_INFINITY);
    // A +3 D eye at 45 (1.7 D) cannot clear even distance.
    expect(amplitude(45)).toBeLessThan(3);
  });
});

describe("corrections", () => {
  it("convert spectacles to contact lenses at 12 mm", () => {
    expect(ocularPower(-8)).toBeCloseTo(-7.3, 2);
    expect(ocularPower(8)).toBeCloseTo(8.85, 2);
    expect(spectaclePower(ocularPower(-8))).toBeCloseTo(-8, 6);
    // Below about 4 D the difference is under 0.25 D.
    expect(Math.abs(ocularPower(-4) - -4)).toBeLessThan(0.25);
  });
});

describe("pupil size (Watson and Yellott, as restated by Zandi 2020)", () => {
  it("matches worked examples for a 60 degree field, both eyes, age 30", () => {
    const cases: [number, number][] = [
      [3000, 2.3],
      [100, 2.9],
      [10, 3.8],
      [1, 5.1],
      [0.01, 7.1],
    ];
    // The examples are rounded to a tenth of a millimetre (7.05 is printed as 7.1).
    for (const [lum, d] of cases)
      expect(Math.abs(pupilDiameter(lum, 30) - d)).toBeLessThanOrEqual(0.06);
    expect(pupilDiameter(1, 70)).toBeCloseTo(4.0, 1);
  });

  it("uses the 20-year value for children", () => {
    expect(pupilDiameter(10, 8)).toBeCloseTo(pupilDiameter(10, 20), 9);
  });
});

describe("blur", () => {
  it("is a disc 0.057 x pupil x defocus degrees wide", () => {
    expect(discDeg(-2, 3)).toBeCloseTo(0.34, 2);
    expect(discDeg(-2, 6)).toBeCloseTo(0.68, 2);
    expect(blurDeg(-2, 3)).toBeCloseTo(0.342, 3);
  });

  it("blends to a small best-focus kernel below about 0.3 D", () => {
    expect(blurDeg(0, 3)).toBeCloseTo(BEST_FOCUS_DEG, 9);
    const at = blurDeg(0.3, 3);
    expect(blurDeg(0.15, 3)).toBeGreaterThan(BEST_FOCUS_DEG);
    expect(blurDeg(0.15, 3)).toBeLessThan(at);
    // Continuous at the blend point.
    expect(blurDeg(0.2999, 3)).toBeCloseTo(at, 3);
  });
});

describe("paraxial rays", () => {
  it("meet at the computed focus", () => {
    const L = emmetropicLength();
    for (const y of [-1.2, -0.5, 0.5, 1.2]) {
      const p = traceRay(y, 0, -15, L, LE_GRAND.r1, 0).points;
      expect(Math.abs(p[p.length - 1]![1])).toBeLessThan(1e-6);
    }
    // Through a -3 D spectacle lens, a -3 D eye's rays meet near the retina.
    const L3 = lengthFor(-3);
    const f = focusAt(-3, LE_GRAND.r1);
    expect(f).toBeCloseTo(L3, 3);
    const lens = [{ at: -12, power: spectaclePower(-3) }];
    const p = traceRay(1, 0, -20, L3, LE_GRAND.r1, 0, lens).points;
    expect(Math.abs(p[p.length - 1]![1])).toBeLessThan(0.01);
  });
});
