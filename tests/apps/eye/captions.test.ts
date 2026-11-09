import { describe, expect, it } from "vitest";
import {
  allLines,
  CONDITIONS,
  CORRECTIONS,
  type Line,
  LONG_EYE,
  PARTS,
} from "../../../src/apps/eye/captions";

/** Sentences: ends of . ! ? followed by a space and a capital, or the end. */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.trim()).length;

const PART_COUNT = 21;
const CONDITION_IDS = [
  "typical",
  "myopia",
  "hyperopia",
  "astigmatism",
  "presbyopia",
  "cataract",
  "glaucoma",
  "amd",
  "diabetic",
  "keratoconus",
  "cvd",
];

/** Words the text rule keeps out: blindness, advice, drug names, "what they see". */
const BANNED = [
  /\bblindness\b/i,
  /\bblind\b(?! spot)/i,
  /\bshould\b/i,
  /\bmust\b/i,
  /\batropine\b/i,
  /\bpilocarpine\b/i,
  /\bwhat they see\b/i,
  // Em and en dashes, written as escapes so this file has none itself.
  new RegExp("[\\u2014\\u2013]"),
];

describe("the text rule: every factual sentence is sourced", () => {
  it("has every part and condition", () => {
    expect(PARTS).toHaveLength(PART_COUNT);
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PART_COUNT);
    expect(CONDITIONS.map((c) => c.id)).toEqual(CONDITION_IDS);
    for (const c of CONDITIONS) {
      if (c.id === "typical") continue;
      expect(c.main, c.id).not.toBeNull();
      expect(c.view, c.id).not.toBeNull();
    }
  });

  it("keeps main captions to one or two sentences", () => {
    const mains: Line[] = [
      ...PARTS.map((p) => p.main),
      ...CONDITIONS.flatMap((c) => (c.main ? [c.main] : [])),
      ...CONDITIONS.flatMap((c) => (c.view ? [c.view.main] : [])),
      ...Object.values(CORRECTIONS),
    ];
    for (const l of mains) {
      const n = sentences(l.text);
      expect(n, l.text).toBeGreaterThanOrEqual(1);
      expect(n, l.text).toBeLessThanOrEqual(2);
    }
    for (const l of allLines()) expect(sentences(l.text), l.text).toBeLessThanOrEqual(2);
  });

  it("uses no banned words, no em-dashes and calm wording", () => {
    for (const l of allLines()) for (const re of BANNED) expect(l.text, String(re)).not.toMatch(re);
  });

  it("gives every line at least one source, as a DOI or URL, never an affiliation", () => {
    for (const l of allLines()) {
      expect(l.sources.length, l.text).toBeGreaterThan(0);
      for (const s of l.sources) {
        expect(s.url, l.text).toMatch(/^https:\/\//);
        expect(s.cite.trim().length).toBeGreaterThan(2);
        expect(s.cite).not.toMatch(/universit|institute of technology|school of|faculty/i);
      }
    }
  });

  it("keeps the advice-like myopia lines out of the default set", () => {
    const m = CONDITIONS.find((c) => c.id === "myopia")!;
    expect(m.extras.map((l) => l.text)).toEqual([
      "Eye doctors have ways to slow short sight in children, such as special glasses, contact lenses or eye drops.",
      "People with high short sight need regular eye checks.",
    ]);
    expect(m.more.some((l) => /eye doctors|eye checks/i.test(l.text))).toBe(false);
    expect(LONG_EYE.text).toBe("A very long eye stretches the layers at the back.");
  });

  it("uses NEI's line for astigmatism glasses, not an unsourced textbook line", () => {
    expect(CORRECTIONS.astigmatism.text).toBe("Glasses or contact lenses can correct astigmatism.");
    expect(allLines().some((l) => /more focusing power in one direction/.test(l.text))).toBe(false);
  });

  it("uses the everyday names", () => {
    const names = Object.fromEntries(CONDITIONS.map((c) => [c.id, c.name]));
    expect(names.myopia).toBe("Short sight (myopia)");
    expect(names.hyperopia).toBe("Long sight (hyperopia)");
    expect(names.cvd).toBe("Colour vision deficiency");
  });

  it("never puts a line in twice", () => {
    const texts = allLines().map((l) => l.text);
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
    expect(dupes).toEqual([]);
  });
});
