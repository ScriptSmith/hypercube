import { describe, expect, it } from "vitest";
import {
  E,
  elementDef,
  elementPropsData,
  ELEMENTS,
  glslElementTable,
  isFlowing,
  KIND_CODE,
  PROPS_ROWS,
} from "../../../src/apps/tinyworld/elements";
import { allSwatches, paletteFor, SWATCHES } from "../../../src/apps/tinyworld/swatches";

describe("tinyworld element table", () => {
  it("lists every element at the index of its id", () => {
    expect(ELEMENTS).toHaveLength(Object.keys(E).length);
    for (const [key, id] of Object.entries(E)) expect(ELEMENTS[id]?.key).toBe(key);
  });

  it("keeps probabilities in range and colours well formed", () => {
    for (const e of ELEMENTS) {
      for (const p of [e.fall, e.slide, e.spread, e.rise, e.flammable, e.dissolves, e.alpha]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      for (const c of e.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("orders densities so things float and sink as they should", () => {
    const d = (id: number) => elementDef(id as never).density;
    expect(d(E.OIL)).toBeLessThan(d(E.WATER));
    expect(d(E.SNOW)).toBeLessThan(d(E.WATER));
    expect(d(E.WATER)).toBeLessThan(d(E.SAND));
    expect(d(E.SEED)).toBeGreaterThan(d(E.WATER));
    for (const gas of [E.STEAM, E.SMOKE, E.FIRE]) expect(d(gas)).toBeLessThan(d(E.EMPTY));
  });

  it("only gives movement properties to things that move", () => {
    for (const e of ELEMENTS) {
      if (e.kind === "static") expect(e.fall + e.slide + e.spread + e.rise).toBe(0);
      if (e.kind === "gas") expect(e.rise).toBeGreaterThan(0);
      if (e.kind === "liquid") expect(e.spread).toBeGreaterThan(0);
    }
  });

  it("keeps scenery out of the drain and out of the pour list", () => {
    expect(elementDef(E.BEDROCK).scenery).toBe(true);
    expect(elementDef(E.CABINET).scenery).toBe(true);
    for (const e of ELEMENTS) if (e.pour) expect(e.scenery).toBe(false);
  });

  it("packs the property texture row by row", () => {
    const t = elementPropsData();
    expect(t.width).toBe(ELEMENTS.length);
    expect(t.height).toBe(PROPS_ROWS);
    const at = (row: number, id: number) =>
      t.data.slice((row * t.width + id) * 4, (row * t.width + id) * 4 + 4);
    expect(at(0, E.WATER)[0]).toBe(KIND_CODE.liquid);
    expect(at(0, E.WATER)[1]).toBe(2);
    expect(at(2, E.BEDROCK)[2]).toBe(1);
  });

  it("generates a define for every element and kind", () => {
    const glsl = glslElementTable();
    for (const [key, id] of Object.entries(E)) expect(glsl).toContain(`#define E_${key} ${id}u`);
    for (const kind of Object.keys(KIND_CODE))
      expect(glsl).toContain(`#define K_${kind.toUpperCase()}`);
    expect(glsl).not.toContain("`");
  });
});

describe("rule 4: fingers pour only flowing media", () => {
  it("never offers a static element as a pour", () => {
    for (const s of Object.values(SWATCHES)) {
      // Remove pours nothing.
      if (s.choice.type !== "element" || s.choice.element === E.EMPTY) continue;
      expect(isFlowing(s.choice.element), s.id).toBe(true);
      expect(elementDef(s.choice.element).pour, s.id).toBeDefined();
    }
  });

  it("marks every element with a pour definition as flowing", () => {
    for (const e of ELEMENTS) if (e.pour) expect(isFlowing(E[e.key])).toBe(true);
  });
});

describe("palette sets", () => {
  const all = (p: ReturnType<typeof paletteFor>) => allSwatches(p);

  it("keeps fire, lava and acid out of the child set and the delta, and out of the pages", () => {
    const danger = new Set(["fire", "lava", "acid"]);
    for (const p of [
      paletteFor("sandbox", "child"),
      paletteFor("delta", "full"),
      paletteFor("delta", "child"),
    ]) {
      for (const s of all(p)) expect(danger.has(s.id)).toBe(false);
    }
    const full = paletteFor("sandbox", "full");
    for (const page of full.pages) for (const s of page.swatches) expect(s.danger).toBe(false);
    expect(full.danger.map((s) => s.id)).toEqual(["fire", "lava", "acid"]);
  });

  it("opens on a first page that starts with sand, water and seeds", () => {
    for (const p of [
      paletteFor("sandbox", "full"),
      paletteFor("sandbox", "child"),
      paletteFor("delta", "full"),
    ]) {
      expect(p.pages[0]!.swatches.slice(0, 3).map((s) => s.id)).toEqual(["sand", "water", "seed"]);
    }
  });

  it("labels every swatch and page with a short fixed name", () => {
    for (const p of [paletteFor("sandbox", "full"), paletteFor("delta", "full")]) {
      for (const s of all(p)) {
        expect(s.label).toMatch(/^[A-Z][a-z]+$/);
        expect(s.label.length).toBeLessThanOrEqual(8);
        expect(s.glyph).toContain("currentColor");
      }
      for (const page of p.pages) expect(page.label).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("keeps the palette manageable: a few pages of at most eight", () => {
    const full = paletteFor("sandbox", "full");
    expect(full.pages.length).toBeLessThanOrEqual(3);
    for (const page of full.pages) expect(page.swatches.length).toBeLessThanOrEqual(8);
    expect(
      all(full).filter((s) => s.choice.type === "element" && s.choice.element !== E.EMPTY),
    ).toHaveLength(11);
    expect(all(full).some((s) => s.id === "remove")).toBe(true);
    expect(new Set(all(full).map((s) => s.id)).size).toBe(all(full).length);
  });
});
