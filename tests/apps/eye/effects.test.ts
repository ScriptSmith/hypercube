import { describe, expect, it } from "vitest";
import {
  amdExample,
  cataractStraylight,
  drBlur,
  effectsFor,
  kernelKey,
  kernelsFor,
  straylightNorm,
  veilShare,
} from "../../../src/apps/eye/effects";
import { defaultState, derive } from "../../../src/apps/eye/model";
import { NO_EFFECTS } from "../../../src/apps/eye/sight";

describe("cataract straylight (Gholami 2017)", () => {
  it("follows the age norm, doubling by 65 and tripling by 77", () => {
    expect(straylightNorm(30)).toBeCloseTo(0.9 + Math.log10(1 + (30 / 65) ** 4), 9);
    expect(10 ** (straylightNorm(65) - 0.9)).toBeCloseTo(2, 6);
    expect(10 ** (straylightNorm(77) - 0.9)).toBeCloseTo(2.97, 1);
  });

  it("adds no veil at strength 0 and more as the cataract grows", () => {
    expect(veilShare(70, 0)).toBe(0);
    expect(veilShare(70, 0.5)).toBeGreaterThan(0);
    expect(veilShare(70, 1)).toBeGreaterThan(veilShare(70, 0.5));
    expect(veilShare(70, 1)).toBeLessThanOrEqual(0.45);
    expect(cataractStraylight(63, 1)).toBeCloseTo(1.48 + 0.34, 6);
  });

  it("tints at most slightly and goes away with a new lens", () => {
    const s = { ...defaultState("cataract"), strength: 1 };
    const e = effectsFor(s, 0, { floaters: false });
    expect(Math.min(...e.tint)).toBeGreaterThan(0.9);
    expect(e.fade).toBeLessThan(0.3);
    expect(effectsFor({ ...s, correction: "newLens" }, 0, { floaters: false })).toEqual(NO_EFFECTS);
  });
});

describe("other conditions", () => {
  it("leave a typical eye and the comparison view untouched", () => {
    expect(effectsFor(defaultState("typical"), 3, { floaters: false })).toEqual(NO_EFFECTS);
    expect(effectsFor(defaultState("glaucoma"), 3, { floaters: false, typical: true })).toEqual(
      NO_EFFECTS,
    );
  });

  it("let diabetic blur come and go, with floaters only when asked", () => {
    const values = Array.from({ length: 90 }, (_, i) => drBlur(1, i / 10));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.8);
    expect(Math.min(...values)).toBeGreaterThan(0);
    const s = defaultState("diabetic");
    expect(effectsFor(s, 1, { floaters: false }).floaters).toBe(0);
    expect(effectsFor(s, 1, { floaters: true }).floaters).toBeGreaterThan(0);
  });

  it("cycle macular degeneration through three examples", () => {
    expect([0, 6, 12, 18].map(amdExample)).toEqual([0, 1, 2, 0]);
  });

  it("pass the toggles and colour matrix through", () => {
    const g = effectsFor({ ...defaultState("glaucoma"), toggle: 1 }, 0, { floaters: false });
    expect(g.glaucoma).toBeGreaterThan(0);
    expect(g.glaucomaMap).toBe(1);
    const c = effectsFor({ ...defaultState("cvd"), strength: 0 }, 0, { floaters: false });
    expect(c.cvd).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe("kernels for a view", () => {
  it("blur the far layer for short sight and the book for a typical eye looking far", () => {
    const fov = 40;
    const w = 1000;
    const px = (k: { rx: number; ry: number }) => (Math.max(k.rx, k.ry) * 2 * w) / fov;
    const myope = kernelsFor(derive(defaultState("myopia")), w, fov);
    expect(px(myope[0])).toBeGreaterThan(5);
    // A -3 D eye's far point is 33 cm: the book at 30 cm is only 0.33 D out.
    expect(px(myope[2])).toBeLessThan(2);
    const typical = kernelsFor(derive(defaultState("typical")), w, fov);
    expect(px(typical[0])).toBeLessThan(1);
    expect(px(typical[2])).toBeGreaterThan(5);
  });

  it("key on visible changes only", () => {
    const d = derive(defaultState("myopia"));
    const a = kernelsFor(d, 1000, 40);
    expect(kernelKey(a, 1000, 40)).toBe(kernelKey(kernelsFor(d, 1000, 40), 1000, 40));
    const b = kernelsFor(derive({ ...defaultState("myopia"), length: 26 }), 1000, 40);
    expect(kernelKey(b, 1000, 40)).not.toBe(kernelKey(a, 1000, 40));
  });
});
