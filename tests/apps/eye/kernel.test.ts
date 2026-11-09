import { describe, expect, it } from "vitest";
import { kernelFor, pupilPattern, tapsFor } from "../../../src/apps/eye/kernel";
import { blurDeg, discDeg } from "../../../src/apps/eye/optics";

const radii = (taps: Float32Array) => {
  const out: number[] = [];
  for (let i = 0; i < taps.length / 2; i++) out.push(Math.hypot(taps[i * 2]!, taps[i * 2 + 1]!));
  return out;
};

describe("blur kernels as spot diagrams", () => {
  it("spread the pupil pattern evenly over the unit disc", () => {
    const p = pupilPattern(64);
    const r = radii(p);
    expect(Math.max(...r)).toBeLessThanOrEqual(1);
    // An even spread: half the points inside radius 1/√2.
    expect(r.filter((v) => v < Math.SQRT1_2).length).toBeCloseTo(32, -1);
  });

  it("give defocus a uniform disc of diameter 0.057 x pupil x defocus degrees", () => {
    const k = kernelFor(-2, -2, 3);
    const d = Math.max(...radii(k.taps)) * 2;
    // The outermost spot sits just inside the disc's edge.
    expect(d).toBeGreaterThan(discDeg(2, 3) * 0.95);
    expect(d).toBeLessThanOrEqual(discDeg(2, 3) + 1e-6);
    expect(k.rx).toBeCloseTo(k.ry, 2);
  });

  it("keep a small best-focus spot at zero defocus", () => {
    const k = kernelFor(0, 0, 3);
    expect(k.rx * 2).toBeLessThanOrEqual(blurDeg(0, 3) + 1e-9);
    expect(k.rx).toBeGreaterThan(0);
  });

  it("give astigmatism an ellipse: a line at a focal line, a circle midway", () => {
    const line = kernelFor(0, -2, 4);
    expect(line.ry).toBeGreaterThan(line.rx * 8);
    const mid = kernelFor(-1, 1, 4);
    expect(Math.abs(mid.rx / mid.ry - 1)).toBeLessThan(0.02);
    const ell = kernelFor(-0.5, -2, 4);
    expect(ell.ry / ell.rx).toBeCloseTo(4, 0);
  });

  it("give keratoconus coma a comet whose tail trails downward, reversed by a rigid lens", () => {
    const tailDown = (comaUm: number) => {
      const k = kernelFor(0, 0, 5, comaUm);
      const ys: number[] = [];
      for (let i = 0; i < k.count; i++) ys.push(k.taps[i * 2 + 1]!);
      const below = Math.max(...ys);
      const above = -Math.min(...ys);
      return below / above;
    };
    // Image y grows downward: the far end of the spots is below the core.
    expect(tailDown(1)).toBeGreaterThan(1.5);
    expect(tailDown(-1)).toBeLessThan(1 / 1.5);
  });

  it("never shift the picture: taps are centred", () => {
    for (const k of [kernelFor(-3, -1, 6, 0.8), kernelFor(2, 2, 3)]) {
      let mx = 0;
      let my = 0;
      for (let i = 0; i < k.count; i++) {
        mx += k.taps[i * 2]!;
        my += k.taps[i * 2 + 1]!;
      }
      expect(Math.abs(mx / k.count)).toBeLessThan(1e-6);
      expect(Math.abs(my / k.count)).toBeLessThan(1e-6);
    }
  });

  it("use fewer taps for small kernels", () => {
    expect(tapsFor(0.2)).toBe(1);
    expect(tapsFor(2)).toBe(16);
    expect(tapsFor(10)).toBe(64);
  });
});
