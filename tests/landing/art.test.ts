// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { appArt, kindGlyph } from "../../src/pages/landing/art";

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

describe("appArt", () => {
  it("is the same every time for an id", () => {
    expect(appArt("pucks", "game")).toBe(appArt("pucks", "game"));
  });

  it("differs between apps", () => {
    const ids = ["pucks", "sparks", "checks", "trails", "petri", "kites", "logic", "lander"];
    const arts = new Set(ids.map((id) => appArt(id, "visual")));
    expect(arts.size).toBe(ids.length);
  });

  it("is well-formed SVG with no ids that could clash between cards", () => {
    for (const id of ["a", "pucks", "sparks", "a-much-longer-app-id", "x1"]) {
      const svg = appArt(id, "tool");
      const doc = parse(svg);
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 320 200");
      expect(svg).not.toMatch(/\sid=/);
      expect(svg).not.toContain("NaN");
    }
  });
});

describe("kindGlyph", () => {
  it("draws each kind at its aspect, with a seam for pairs and dashes for screens", () => {
    const width = (svg: string) => Number(parse(svg).documentElement.getAttribute("width"));
    expect(width(kindGlyph("panel"))).toBeLessThan(width(kindGlyph("pair")));
    expect(width(kindGlyph("wall"))).toBeGreaterThan(width(kindGlyph("kiosk")));
    expect(kindGlyph("pair")).toContain("<line");
    expect(kindGlyph("screen")).toContain("stroke-dasharray");
  });
});
