import { describe, expect, it } from "vitest";
import manifest from "../../../src/apps/ballpit/manifest";
import { PICTURE_IDS, pictureBody } from "../../../src/apps/ballpit/pictures";
import {
  CHILD_MAX_ANSWERS,
  MAX_ANSWERS,
  QUESTIONS,
  SETS,
  suitsAdults,
  suitsChildren,
} from "../../../src/apps/ballpit/questions";

describe("question list", () => {
  it("has about twenty questions across three sets", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(18);
    expect(QUESTIONS.length).toBeLessThanOrEqual(24);
    expect(SETS.map((s) => s.id)).toEqual(["everyday", "animals", "science"]);
    for (const s of SETS) {
      const qs = QUESTIONS.filter((q) => q.set === s.id);
      expect(qs.length).toBeGreaterThanOrEqual(5);
      // Every set can fill both slots of the two-question variant.
      expect(qs.some(suitsChildren)).toBe(true);
      expect(qs.some(suitsAdults)).toBe(true);
    }
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });

  it("keeps questions short, plain and in sentence case", () => {
    for (const q of QUESTIONS) {
      expect(q.text.length, q.id).toBeLessThanOrEqual(46);
      expect(q.text[0], q.id).toBe(q.text[0]!.toUpperCase());
      expect(q.text.endsWith("?"), q.id).toBe(true);
      expect(q.id).toMatch(/^[a-z]+$/);
      // Sentence case: no capitals after the first letter, except units.
      expect(q.text.slice(1).replace(/\bkg\b/, ""), q.id).toBe(
        q.text
          .slice(1)
          .replace(/\bkg\b/, "")
          .toLowerCase(),
      );
      expect(q.text.includes(String.fromCharCode(0x2014))).toBe(false);
    }
  });

  it("gives each answer a picture of ours and one or two words", () => {
    for (const q of QUESTIONS) {
      expect(q.answers.length).toBeGreaterThanOrEqual(2);
      expect(q.answers.length).toBeLessThanOrEqual(MAX_ANSWERS);
      if (q.audience === "children")
        expect(q.answers.length).toBeLessThanOrEqual(CHILD_MAX_ANSWERS);
      for (const a of q.answers) {
        expect(PICTURE_IDS).toContain(a.pic);
        expect(a.label.split(" ").length, `${q.id} ${a.label}`).toBeLessThanOrEqual(2);
        expect(a.label[0]).toBe(a.label[0]!.toUpperCase());
        expect(a.bot).toBeGreaterThan(0);
      }
      if (q.correct !== undefined) expect(q.answers[q.correct]).toBeDefined();
      expect(new Set(q.answers.map((a) => a.pic)).size, `${q.id} pictures`).toBe(q.answers.length);
    }
  });

  it("draws every picture as SVG made only of our own shapes", () => {
    for (const id of PICTURE_IDS) {
      const body = pictureBody(id);
      expect(body.length, id).toBeGreaterThan(40);
      expect(body).not.toMatch(/<(image|text|use|script|foreignObject)/);
      expect(body).not.toMatch(/NaN|undefined/);
    }
  });

  it("offers every set and question in the options, word for word", () => {
    const opt = (key: string) => {
      const o = manifest.options!.find((x) => x.key === key)!;
      return o.type === "enum" ? o.values : [];
    };
    expect(opt("question")).toEqual([
      { id: "rotate", title: "Change on a timer" },
      { id: "custom", title: "Your own (set in admin)" },
      ...QUESTIONS.map((q) => ({ id: q.id, title: q.text })),
    ]);
    expect(opt("set")).toEqual(SETS.map((s) => ({ id: s.id, title: s.title })));
  });
});
