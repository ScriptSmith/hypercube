import { describe, expect, it } from "vitest";
import manifest from "../../../src/apps/eye/manifest";
import { needsOpen, sliderOf, withSlider } from "../../../src/apps/eye/frame";
import { defaultState, derive, type EyeState } from "../../../src/apps/eye/model";

const open = (s: EyeState, part: Parameters<typeof needsOpen>[2] = null) =>
  needsOpen(s, derive(s), part);

describe("the two looks", () => {
  it("offers the realistic look first, so it is the default, and the diagram second", () => {
    expect(manifest.variants?.map((v) => v.id)).toEqual(["real", "diagram"]);
    expect(manifest.variants?.map((v) => v.title)).toEqual(["Realistic", "Diagram"]);
  });

  it("keeps the realistic eye whole for a typical eye and for parts seen from outside", () => {
    expect(open(defaultState("typical"))).toBe(false);
    for (const p of ["whole", "cornea", "iris", "pupil", "sclera", "muscles"] as const) {
      expect(open(defaultState("typical"), p), p).toBe(false);
    }
    // Keratoconus shows on the cornea, colour vision deficiency not in the eyeball at all.
    expect(open(defaultState("keratoconus"))).toBe(false);
    expect(open(defaultState("cvd"))).toBe(false);
  });

  it("opens it for a part inside, a condition inside, a correction or a focus off the retina", () => {
    for (const p of ["lens", "retina", "disc", "vitreous", "angle"] as const) {
      expect(open(defaultState("typical"), p), p).toBe(true);
    }
    for (const c of ["myopia", "cataract", "glaucoma", "amd", "diabetic", "presbyopia"] as const) {
      expect(open(defaultState(c)), c).toBe(true);
    }
    expect(open({ ...defaultState("keratoconus"), correction: "hardLens" })).toBe(true);
    expect(open({ ...defaultState("typical"), length: 26 })).toBe(true);
  });
});

describe("sliders", () => {
  it("map the state to positions and back", () => {
    const s = defaultState("myopia");
    for (const id of ["length", "radius", "age", "light", "strength"] as const) {
      const v = sliderOf(s, id);
      const back = withSlider(s, id, v);
      expect(sliderOf(back, id)).toBeCloseTo(v, 1);
    }
    expect(withSlider(s, "length", 1).length).toBe(27);
    expect(withSlider(s, "age", 0).age).toBe(5);
  });
});
