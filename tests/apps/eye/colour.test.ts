import { describe, expect, it } from "vitest";
import {
  applyMat3,
  cvdMatrix,
  IDENTITY,
  simulateHex,
  toLinear,
  toSrgb,
  VIENOT,
} from "../../../src/apps/eye/colour";

describe("colour vision deficiency filter", () => {
  it("is the identity at severity 0 and Viénot's dichromat matrix at 1", () => {
    for (const t of ["protan", "deutan"] as const) {
      expect([...cvdMatrix(t, 0)]).toEqual([...IDENTITY]);
      const m = cvdMatrix(t, 1);
      VIENOT[t].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 9));
    }
  });

  it("keeps white, blue and yellow at every severity", () => {
    for (const t of ["protan", "deutan"] as const) {
      for (const s of [0, 0.3, 0.7, 1]) {
        const m = cvdMatrix(t, s);
        for (const c of [
          [1, 1, 1],
          [0, 0, 1],
          [1, 1, 0],
        ] as const) {
          const out = applyMat3(m, c);
          out.forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 2));
        }
      }
    }
  });

  it("makes red and green alike without turning the picture grey", () => {
    const red = simulateHex("#d23b30", "deutan", 1);
    const green = simulateHex("#7fb24a", "deutan", 1);
    const hue = (h: string) => {
      const n = Number.parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [r1, g1, b1] = hue(red);
    const [r2, g2] = hue(green);
    // Both land on the yellow-blue plane: red and green channels equal within each colour.
    expect(Math.abs(r1! - g1!)).toBeLessThan(4);
    expect(Math.abs(r2! - g2!)).toBeLessThan(4);
    // Not grey: blue differs from the others.
    expect(Math.abs(r1! - b1!)).toBeGreaterThan(20);
  });

  it("decodes and encodes sRGB (W3C CSS Color 4)", () => {
    for (const v of [0, 0.02, 0.04045, 0.2, 0.5, 1]) expect(toSrgb(toLinear(v))).toBeCloseTo(v, 6);
    expect(toLinear(0.5)).toBeCloseTo(0.214, 3);
  });
});
