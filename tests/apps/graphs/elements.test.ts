import { describe, expect, test } from "vitest";
import elements from "../../../src/apps/graphs/data/elements";

const FORMULAS: Record<string, string> = {
  water: "H2O",
  salt: "NaCl",
  co2: "CO2",
  methane: "CH4",
  ammonia: "NH3",
  soda: "NaHCO3",
  limestone: "CaCO3",
  rust: "Fe2O3",
  sand: "SiO2",
  sugar: "C12H22O11",
  vinegar: "C2H4O2",
  peroxide: "H2O2",
  laughing: "N2O",
  epsom: "MgSO4",
  sapphire: "Al2O3",
  stomach: "HCl",
  potash: "KCl",
};

const SYMBOLS: Record<string, string> = {
  h: "H",
  c: "C",
  n: "N",
  o: "O",
  na: "Na",
  cl: "Cl",
  ca: "Ca",
  fe: "Fe",
  si: "Si",
  s: "S",
  al: "Al",
  mg: "Mg",
  k: "K",
};

describe("elements graph", () => {
  test("each compound links to exactly the elements in its formula", () => {
    for (const [id, formula] of Object.entries(FORMULAS)) {
      const expected = [...formula.matchAll(/[A-Z][a-z]?/g)].map((m) => m[0]).sort();
      const linked = elements.edges
        .filter(([a]) => a === id)
        .map(([, e]) => SYMBOLS[e]!)
        .sort();
      expect(linked, id).toEqual([...new Set(expected)].sort());
    }
  });

  test("notes are short and have no em-dashes", () => {
    for (const n of elements.nodes) {
      expect(n.note.length, n.id).toBeLessThanOrEqual(85);
      expect(n.note).not.toContain("—");
    }
  });

  test("every element is used", () => {
    for (const id of Object.keys(SYMBOLS))
      expect(
        elements.edges.some(([, e]) => e === id),
        id,
      ).toBe(true);
  });
});
