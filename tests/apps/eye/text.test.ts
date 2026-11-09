import { describe, expect, it } from "vitest";
import {
  conditionCaption,
  CORRECTIONS,
  LONG_EYE,
  partCaption,
} from "../../../src/apps/eye/captions";
import { defaultState, derive, type EyeState } from "../../../src/apps/eye/model";
import { pages, viewLine, viewTag } from "../../../src/apps/eye/text";

const view = (s: EyeState) => viewLine(s, derive(s));
const card = (s: EyeState, o: Partial<Parameters<typeof pages>[2]> = {}) =>
  pages(s, derive(s), { part: null, extras: false, paired: false, ...o });

describe("which captions show", () => {
  it("shows no view caption for a typical or corrected eye", () => {
    expect(view(defaultState("typical"))).toBeNull();
    expect(view({ ...defaultState("myopia"), correction: "glasses" })).toBeNull();
    expect(view({ ...defaultState("cataract"), correction: "newLens" })).toBeNull();
  });

  it("follows the optics, not the tile", () => {
    const myopia = conditionCaption("myopia").view!.main;
    expect(view(defaultState("myopia"))).toBe(myopia);
    // A typical eye made long by its slider is short-sighted.
    expect(view({ ...defaultState("typical"), length: 25.5 })).toBe(myopia);
    expect(view({ ...defaultState("typical"), length: 22.5 })).toBe(
      conditionCaption("hyperopia").view!.main,
    );
    // Ageing focus: only while the book is blurred.
    expect(view(defaultState("presbyopia"))).toBe(conditionCaption("presbyopia").view!.main);
    expect(view({ ...defaultState("presbyopia"), correction: "reading" })).toBeNull();
    expect(view({ ...defaultState("astigmatism"), correction: "glasses" })).toBeNull();
  });

  it("swaps keratoconus's view line under a hard lens, whose tails turn the other way", () => {
    expect(view(defaultState("keratoconus"))).toBe(conditionCaption("keratoconus").view!.main);
    expect(view({ ...defaultState("keratoconus"), correction: "hardLens" })).toBe(
      conditionCaption("keratoconus").view!.more[0],
    );
  });

  it("puts a correction's caption first", () => {
    expect(card({ ...defaultState("myopia"), correction: "glasses" })[0]!.line).toBe(
      CORRECTIONS.glasses,
    );
    expect(card({ ...defaultState("myopia"), correction: "contact" })[0]!.line).toBe(
      CORRECTIONS.contact,
    );
    expect(card({ ...defaultState("astigmatism"), correction: "glasses" })[0]!.line).toBe(
      CORRECTIONS.astigmatism,
    );
    expect(card({ ...defaultState("cataract"), correction: "newLens" })[0]!.line.text).toBe(
      "Doctors can swap the cloudy lens for a clear artificial one.",
    );
  });

  it("starts the card on the main caption and keeps extras behind the option", () => {
    const m = card(defaultState("myopia"));
    expect(m[0]!.line).toBe(conditionCaption("myopia").main);
    expect(m.some((p) => /eye doctors/i.test(p.line.text))).toBe(false);
    expect(
      card(defaultState("myopia"), { extras: true }).some((p) => /eye doctors/i.test(p.line.text)),
    ).toBe(true);
    expect(card({ ...defaultState("myopia"), length: 26.8 }).some((p) => p.line === LONG_EYE)).toBe(
      true,
    );
  });

  it("shows the two-pictures line only beside two pictures", () => {
    const has = (o: { paired: boolean }) =>
      card(defaultState("cvd"), o).some((p) => /two pictures/.test(p.line.text));
    expect(has({ paired: false })).toBe(false);
    expect(has({ paired: true })).toBe(true);
  });

  it("shows a part's caption, then its extra line and the current condition's lines", () => {
    const p = card(defaultState("glaucoma"), { part: "disc" });
    expect(p[0]!.line).toBe(partCaption("disc").main);
    expect(p.map((x) => x.line)).toEqual([
      partCaption("disc").main,
      ...partCaption("disc").more,
      ...partCaption("disc").condition.glaucoma!,
    ]);
    expect(card(defaultState("typical"), { part: "disc" })).toHaveLength(2);
  });

  it("labels condition views as one example", () => {
    const tag = (s: EyeState) => viewTag(s, derive(s), 1);
    expect(tag(defaultState("typical"))).toBeNull();
    expect(tag(defaultState("myopia"))).toBe("One example");
    expect(tag(defaultState("amd"))).toBe("One example: wavy");
    expect(tag({ ...defaultState("myopia"), correction: "glasses" })).toBe("With glasses");
  });
});
