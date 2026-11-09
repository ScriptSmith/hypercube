import { describe, expect, it } from "vitest";
import { allLines, COMMON, sourcedLines, TEXT } from "../../../src/apps/xrd/captions";
import { CHAPTER_IDS } from "../../../src/apps/xrd/ids";

/** Sentences: ends of . ! ? followed by a space and a capital, or the end. */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.trim()).length;
/** Em and en dashes, written as escapes so this file has none itself. */
const DASH = new RegExp("[\\u2014\\u2013]");

const everyString = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) everyString(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) everyString(x, out);
  return out;
};

describe("the text rule", () => {
  it("has every chapter, in order", () => {
    expect(Object.keys(TEXT)).toEqual([...CHAPTER_IDS]);
    CHAPTER_IDS.forEach((id, i) => {
      expect(TEXT[id].id).toBe(id);
      expect(TEXT[id].number).toBe(i + 1);
    });
  });

  it("asks one short question per headline", () => {
    for (const id of CHAPTER_IDS) {
      const h = TEXT[id].headline;
      expect(h, id).toMatch(/^[A-Z][^?]*\?$/);
      expect(sentences(h), id).toBe(1);
      expect(h.length, id).toBeLessThanOrEqual(42);
    }
  });

  it("keeps captions and So lines to one sentence each", () => {
    for (const id of CHAPTER_IDS) {
      const t = TEXT[id];
      for (const l of [t.caption, t.so]) {
        expect(l.text.trim().length, id).toBeGreaterThan(0);
        expect(sentences(l.text), `${id}: ${l.text}`).toBe(1);
        expect(l.text, id).toMatch(/^[A-Z].*[.!?]$/);
      }
      expect(t.verb.length, id).toBeGreaterThan(0);
    }
    for (const l of allLines()) expect(sentences(l.text), l.text).toBe(1);
  });

  it("uses no em or en dashes anywhere a visitor reads", () => {
    for (const s of [...everyString(TEXT), ...everyString(COMMON)]) expect(s).not.toMatch(DASH);
  });

  it("puts date tags on eight chapters and seven use tiles in the last", () => {
    const tagged = CHAPTER_IDS.filter((id) => TEXT[id].tag);
    expect(tagged).toEqual([
      "spectrum",
      "crystal",
      "bragg",
      "goniometer",
      "patterns",
      "synthesis",
      "helix",
      "mystery",
    ]);
    expect(TEXT.mystery.uses?.length).toBe(7);
  });

  it("sources every history and use line", () => {
    for (const l of sourcedLines()) {
      expect(l.sources?.length ?? 0, l.text).toBeGreaterThan(0);
      for (const s of l.sources ?? []) {
        if (s.isbn) expect(s.isbn, l.text).toMatch(/^97[89]\d{10}$/);
        else expect(s.url, l.text).toMatch(/^https:\/\//);
        expect(s.cite.trim().length).toBeGreaterThan(2);
        expect(s.cite).not.toMatch(/universit|institute of technology|school of|faculty/i);
      }
    }
    for (const id of CHAPTER_IDS) {
      const tag = TEXT[id].tag;
      if (tag) expect(tag.sources?.length ?? 0, id).toBeGreaterThan(0);
      for (const u of TEXT[id].uses ?? [])
        expect(u.line.sources?.length ?? 0, u.id).toBeGreaterThan(0);
    }
  });

  it("cites a source for every factual sentence: captions, So lines, tags, notes and uses", () => {
    for (const l of allLines()) {
      expect(l.sources?.length ?? 0, l.text).toBeGreaterThan(0);
      for (const s of l.sources ?? []) {
        expect(s.cite).not.toMatch(/universit|institute of technology|school of|faculty/i);
        if (s.isbn) expect(s.isbn, l.text).toMatch(/^97[89]\d{10}$/);
        else expect(s.url, l.text).toMatch(/^https:\/\//);
        if (s.url?.includes("doi"))
          expect(s.url, s.cite).toMatch(/^https:\/\/doi\.org\/10\.\d{4,}\//);
      }
    }
  });

  it("links every formula part to a symbol line or the figure", () => {
    for (const id of CHAPTER_IDS) {
      const m = TEXT[id].maths;
      expect(m.formula.length, id).toBeGreaterThan(0);
      expect(
        m.formula.some((r) => r.part),
        id,
      ).toBe(true);
      for (const s of m.symbols) {
        if (s.part)
          expect(
            m.formula.some((r) => r.part === s.part),
            `${id} ${s.sym}`,
          ).toBe(true);
      }
    }
  });
});

describe("the manifest", () => {
  it("lists every chapter for the chapter option, in order, with its headline", async () => {
    const { default: manifest } = await import("../../../src/apps/xrd/manifest");
    const opt = manifest.options?.find((o) => o.key === "chapter");
    expect(opt?.type).toBe("enum");
    if (opt?.type !== "enum") return;
    expect(opt.values.map((v) => v.id)).toEqual(["tour", ...CHAPTER_IDS]);
    opt.values.slice(1).forEach((v, i) => {
      expect(v.title).toBe(`${i + 1} ${TEXT[CHAPTER_IDS[i]!].headline}`);
    });
  });
});
