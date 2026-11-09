import { describe, expect, it } from "vitest";
import {
  hueChroma,
  isRed,
  isYellow,
  PALETTE_IDS,
  PALETTES,
  paletteOf,
} from "../../../src/apps/beachball/palettes";
import manifest from "../../../src/apps/beachball/manifest";

describe("beach ball colours", () => {
  it("tells red and yellow from their neighbours", () => {
    expect(isRed("#ff0000")).toBe(true);
    expect(isRed("#d7261e")).toBe(true);
    expect(isYellow("#ffd700")).toBe(true);
    expect(isYellow("#f5c400")).toBe(true);
    expect(isRed("#f2861f")).toBe(false);
    expect(isYellow("#f2861f")).toBe(false);
    expect(isYellow("#ece8de")).toBe(false);
    expect(hueChroma("#0000ff").hue).toBeCloseTo(240);
  });

  it("never uses red or yellow on the ball, so red can never sit beside yellow", () => {
    for (const id of PALETTE_IDS) {
      const p = PALETTES[id];
      for (const c of [...p.gores, p.cap, p.valve]) {
        expect(isRed(c), `${id} ${c} is red`).toBe(false);
        expect(isYellow(c), `${id} ${c} is yellow`).toBe(false);
      }
    }
  });

  it("has six gores, no two neighbours alike, with white among them", () => {
    for (const id of PALETTE_IDS) {
      const g = PALETTES[id].gores;
      expect(g).toHaveLength(6);
      for (let i = 0; i < g.length; i++) expect(g[i]).not.toBe(g[(i + 1) % g.length]);
      expect(g.filter((c) => hueChroma(c).chroma < 0.1).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("offers every palette as an option, and falls back to classic", () => {
    const opt = manifest.options?.find((o) => o.key === "colours");
    expect(opt?.type).toBe("enum");
    if (opt?.type === "enum")
      expect(opt.values.map((v) => v.id).sort()).toEqual([...PALETTE_IDS].sort());
    expect(paletteOf("nonsense")).toBe(PALETTES.classic);
    expect(paletteOf("ocean")).toBe(PALETTES.ocean);
  });
});
