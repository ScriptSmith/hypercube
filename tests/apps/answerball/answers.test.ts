import { describe, expect, it } from "vitest";
import { ANSWERS, PROMPT } from "../../../src/apps/answerball/answers";
import { FACE_LAYOUT, halfWidth, layoutFace } from "../../../src/apps/answerball/layout";

/** A rough width for a bold sans serif at size 1: narrow letters, wide letters, the rest. */
const measure = (s: string) =>
  [...s].reduce(
    (w, ch) => w + (/[il.,'!]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.9 : ch === " " ? 0.27 : 0.6),
    0,
  );

describe("answers", () => {
  it("has one answer per face, all different", () => {
    expect(ANSWERS.length).toBe(20);
    expect(new Set(ANSWERS.map((a) => a.text.toLowerCase())).size).toBe(20);
  });

  it("keeps each answer short, plain and in sentence case", () => {
    for (const { text } of ANSWERS) {
      const words = text.split(" ");
      expect(words.length, text).toBeGreaterThanOrEqual(1);
      expect(words.length, text).toBeLessThanOrEqual(3);
      expect(text.length, text).toBeLessThanOrEqual(16);
      expect(text[0], text).toBe(text[0]!.toUpperCase());
      for (const w of words.slice(1)) expect(w === "I" || w === w.toLowerCase(), text).toBe(true);
      expect(text, text).toMatch(/^[A-Za-z ,?]+$/);
    }
    expect(PROMPT).toBe("Ask a question");
  });

  it("says yes about half the time, isn't sure a quarter and says no a quarter", () => {
    const count = (k: string) => ANSWERS.filter((a) => a.kind === k).length;
    expect(count("yes")).toBe(10);
    expect(count("unsure")).toBe(5);
    expect(count("no")).toBe(5);
  });
});

describe("text on a face", () => {
  it("fits every answer inside its triangle, at a size that reads", () => {
    for (const { text } of ANSWERS) {
      const lay = layoutFace(text, measure);
      expect(lay.lines.map((l) => l.text).join(" "), text).toBe(text);
      expect(lay.size, text).toBeGreaterThan(0.15);
      expect(lay.size, text).toBeLessThanOrEqual(FACE_LAYOUT.maxSize);
      for (const line of lay.lines) {
        const top = line.y + (FACE_LAYOUT.box * lay.size) / 2;
        const bottom = line.y - (FACE_LAYOUT.box * lay.size) / 2;
        expect(halfWidth(bottom, FACE_LAYOUT.margin), text).toBeGreaterThan(0);
        expect((measure(line.text) * lay.size) / 2, text).toBeLessThanOrEqual(
          halfWidth(top, FACE_LAYOUT.margin) + 1e-9,
        );
      }
    }
  });

  it("breaks a phrase only when that makes it larger", () => {
    const short = layoutFace("Nope", measure);
    expect(short.lines.length).toBe(1);
    expect(short.size).toBe(FACE_LAYOUT.maxSize);
    const long = layoutFace("The stars agree", measure);
    expect(long.lines.length).toBeGreaterThan(1);
  });
});

describe("line breaks", () => {
  it("never leaves a single letter on a line", () => {
    for (const { text } of ANSWERS) {
      for (const line of layoutFace(text, measure).lines)
        expect(line.text.length, text).toBeGreaterThan(1);
    }
  });
});
