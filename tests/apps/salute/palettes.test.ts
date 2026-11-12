import { describe, expect, it } from "vitest";
import manifest from "../../../src/apps/salute/manifest";
import { COLOUR_IDS, colourOf, luminance, PALETTES } from "../../../src/apps/salute/palettes";

describe("the ball's colours", () => {
  it("measures luminance", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 9);
    expect(luminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("offers every colour as an option, yellow by default", () => {
    const opt = manifest.options?.find((o) => o.key === "colour");
    expect(opt?.type).toBe("enum");
    if (opt?.type === "enum") {
      expect(opt.values.map((v) => v.id).sort()).toEqual([...COLOUR_IDS].sort());
      expect(opt.default).toBe("yellow");
      expect(opt.visitor).toBe(true);
    }
    expect(colourOf("blue")).toBe("blue");
    expect(colourOf("nonsense")).toBe("yellow");
    expect(colourOf(undefined)).toBe("yellow");
  });

  it("keeps the skin well short of white, so a whole ball of it doesn't dazzle", () => {
    for (const id of COLOUR_IDS) {
      const p = PALETTES[id];
      expect(luminance(p.skin), id).toBeLessThan(0.6);
      expect(luminance(p.hand), id).toBeLessThan(0.75);
      expect(luminance(p.glow), id).toBeLessThan(0.85);
    }
  });

  it("shades the skin darker, lifts the hand off it and draws the features in a dark ink", () => {
    for (const id of COLOUR_IDS) {
      const p = PALETTES[id];
      expect(luminance(p.deep), id).toBeLessThan(luminance(p.skin) * 0.8);
      expect(luminance(p.hand), id).toBeGreaterThan(luminance(p.skin) * 1.15);
      // Contrast as text contrast is measured: brows and mouth must read from across a room.
      const contrast = (luminance(p.skin) + 0.05) / (luminance(p.ink) + 0.05);
      expect(contrast, id).toBeGreaterThan(4.5);
    }
  });

  it("lets the operator hold the salute, and visitors choose the pace", () => {
    const hold = manifest.options?.find((o) => o.key === "hold");
    expect(hold?.type).toBe("boolean");
    expect(hold?.default).toBe(false);
    expect(hold?.visitor).toBeUndefined();
    const pace = manifest.options?.find((o) => o.key === "pace");
    expect(pace?.default).toBe("formal");
    expect(pace?.visitor).toBe(true);
    expect(manifest.setups).toEqual([{ setup: "solo", kinds: ["sphere"] }]);
    expect(manifest.network).toBe("none");
  });
});
