import { describe, expect, it } from "vitest";
import {
  CONDITION_ORDER,
  correctionsFor,
  defaultState,
  derive,
  lensText,
  lightFor,
  luminanceOf,
  readingAdd,
  bankStart,
} from "../../../src/apps/eye/model";
import { amplitude, ocularPower } from "../../../src/apps/eye/optics";

const residual = (s: ReturnType<typeof defaultState>) => {
  const d = derive(s);
  return Math.max(Math.abs(d.residual.h), Math.abs(d.residual.v));
};

describe("an eye's state", () => {
  it("starts each condition at its default refraction and focus", () => {
    expect(derive(defaultState("typical")).se).toBeCloseTo(0, 6);
    expect(derive(defaultState("myopia")).se).toBeCloseTo(-3, 3);
    expect(derive(defaultState("hyperopia")).se).toBeCloseTo(3, 3);
    const a = derive(defaultState("astigmatism"));
    expect(a.refraction.h - a.refraction.v).toBeGreaterThan(1.5);
    expect(defaultState("presbyopia").looking).toBe("near");
    expect(CONDITION_ORDER).toHaveLength(11);
  });

  it("maps the light slider onto luminance and back", () => {
    expect(luminanceOf(0)).toBeCloseTo(0.01, 6);
    expect(luminanceOf(1)).toBeCloseTo(3000, 3);
    expect(luminanceOf(lightFor(300))).toBeCloseTo(300, 6);
    expect(derive({ ...defaultState("typical"), light: 0 }).night).toBe(true);
    expect(derive({ ...defaultState("typical"), light: 1 }).night).toBe(false);
  });

  it("focuses on what the eye looks at, within the age's accommodation", () => {
    const young = derive({ ...defaultState("typical"), looking: "near" });
    expect(young.accommodation).toBeCloseTo(1 / 0.3, 2);
    expect(Math.abs(young.layers.near.defocus.h)).toBeLessThan(0.01);
    // Looking far, the book is a full 3.3 D out for any eye.
    const far = derive(defaultState("typical"));
    expect(Math.abs(far.layers.near.defocus.h)).toBeCloseTo(1 / 0.3, 1);
    // At 60 the lens has about 0.1 D left: the book stays blurred looking near.
    const old = derive(defaultState("presbyopia"));
    expect(old.accommodation).toBeCloseTo(amplitude(60), 6);
    expect(Math.abs(old.layers.near.defocus.h)).toBeGreaterThan(3);
  });

  it("leaves a short-sighted eye's far view out of focus, in front of the retina", () => {
    const d = derive(defaultState("myopia"));
    expect(d.accommodation).toBe(0);
    expect(d.layers.far.defocus.h).toBeLessThan(-2.9);
    expect(Math.abs(d.layers.near.defocus.h)).toBeLessThan(0.5);
  });

  it("lets a young long-sighted eye clear far by focusing, leaving little for near", () => {
    const d = derive({ ...defaultState("hyperopia"), looking: "far" });
    expect(d.accommodation).toBeCloseTo(3, 1);
    expect(Math.abs(d.layers.far.defocus.h)).toBeLessThan(0.05);
    const near = derive(defaultState("hyperopia"));
    expect(Math.abs(near.layers.near.defocus.h)).toBeGreaterThan(1);
  });

  it("corrects with glasses and contact lenses to within a quarter dioptre", () => {
    for (const c of ["myopia", "hyperopia", "astigmatism", "typical"] as const) {
      for (const fix of correctionsFor(c)) {
        expect(residual({ ...defaultState(c), correction: fix }), `${c} ${fix}`).toBeLessThan(0.13);
      }
    }
    const g = derive({ ...defaultState("myopia"), correction: "glasses" });
    const k = derive({ ...defaultState("myopia"), correction: "contact" });
    // Glasses for short sight are minus lenses and a little stronger than contact lenses.
    expect(g.lens!.power.h).toBeLessThan(0);
    expect(g.lens!.power.h).toBeLessThanOrEqual(k.lens!.power.h);
    expect(ocularPower(g.lens!.power.h)).toBeCloseTo(k.lens!.power.h, 0);
  });

  it("gives reading glasses that clear the book", () => {
    const d = derive({ ...defaultState("presbyopia"), correction: "reading" });
    expect(d.lens!.power.h).toBeGreaterThanOrEqual(1);
    expect(d.lens!.power.h).toBeLessThanOrEqual(3.5);
    expect(Math.abs(d.layers.near.defocus.h)).toBeLessThan(0.3);
    // With no accommodation the book at 30 cm (28.8 cm from the lens) needs +3.47 D: +3.50.
    expect(readingAdd(0, 0, 0)).toBeCloseTo(3.5, 6);
  });

  it("keeps a tenth of a cone's astigmatism under a hard lens, and reverses its coma", () => {
    const bare = derive(defaultState("keratoconus"));
    const hard = derive({ ...defaultState("keratoconus"), correction: "hardLens" });
    const cyl = (d: typeof bare) => Math.abs(d.refraction.h - d.refraction.v);
    expect(cyl(hard)).toBeCloseTo(cyl(bare) * 0.1, 6);
    expect(Math.sign(hard.coma)).toBe(-Math.sign(bare.coma));
    expect(Math.abs(hard.coma)).toBeCloseTo(Math.abs(bare.coma) * 0.35, 9);
  });

  it("ignores corrections a condition doesn't offer", () => {
    expect(derive({ ...defaultState("glaucoma"), correction: "glasses" }).lens).toBeNull();
    expect(derive({ ...defaultState("cataract"), correction: "newLens" }).se).toBe(0);
  });

  it("starts a bank as a gallery: a typical eye first, then each condition", () => {
    const starts = Array.from({ length: 10 }, (_, i) => bankStart(i));
    expect(starts[0]).toBe("typical");
    expect(new Set(starts).size).toBe(10);
  });

  it("writes lens powers with signs and both meridians", () => {
    expect(lensText({ h: -2.75, v: -2.75 })).toBe("−2.75 D");
    expect(lensText({ h: 0.5, v: -1.25 })).toBe("+0.50 / −1.25 D");
  });
});
