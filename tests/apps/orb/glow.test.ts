import { describe, expect, it } from "vitest";
import {
  createGlow,
  type GlowMode,
  LIGHTS,
  PALETTES,
  REACH,
  RARE_CHANCE,
  SEGMENT_S,
  segmentColour,
} from "../../../src/apps/orb/glow";

const same = (a: readonly number[], b: readonly number[]) => a.every((x, i) => x === b[i]);
const isRare = (mode: GlowMode, c: readonly number[]) => same(c, PALETTES[mode].rare);

describe("orb glow", { timeout: 30_000 }, () => {
  it("keeps its lights inside the orb, never flashing, for days", () => {
    const glow = createGlow("cool", 12345);
    const lights = glow.at(0);
    expect(lights).toHaveLength(LIGHTS);
    let prev = lights.map((l) => ({ ...l, colour: [...l.colour] }));
    // Smooth over an hour at a quarter of a second: nothing blinks.
    for (let t = 0; t < 3600; t += 1 / 4) {
      const now = glow.at(t, lights);
      expect(now).toBe(lights);
      now.forEach((l, k) => {
        const p = prev[k]!;
        expect(Math.abs(l.power - p.power)).toBeLessThan(0.035);
        for (let i = 0; i < 3; i++)
          expect(Math.abs(l.colour[i]! - p.colour[i]!)).toBeLessThan(0.05);
      });
      prev = now.map((l) => ({ ...l, colour: [...l.colour] }));
    }
    // Inside the orb and gently breathing for days.
    for (let t = 0; t < 3 * 24 * 3600; t += 61) {
      for (const l of glow.at(t, lights)) {
        expect(Math.hypot(...l.pos)).toBeLessThanOrEqual(REACH + 1e-9);
        expect(l.power).toBeGreaterThan(0.69);
        expect(l.power).toBeLessThan(1.01);
      }
    }
  });

  it("uses the cool palette's blues with now and then a gold, and the warm one's roses", () => {
    for (const mode of ["cool", "warm"] as const) {
      let rare = 0;
      let total = 0;
      for (let k = 0; k < LIGHTS; k++) {
        for (let j = 0; j < 2000; j++) {
          const c = segmentColour(mode, 99, k, j);
          total++;
          if (isRare(mode, c)) rare++;
          else expect(PALETTES[mode].main.some((m) => same(m, c))).toBe(true);
        }
      }
      expect(rare / total).toBeGreaterThan(RARE_CHANCE * 0.7);
      expect(rare / total).toBeLessThan(RARE_CHANCE * 1.3);
    }
    // Cool is blue-led; warm leans red but never a saturated red.
    for (const c of PALETTES.cool.main) expect(c[2]).toBeGreaterThan(c[0]);
    for (const c of [...PALETTES.warm.main, PALETTES.warm.rare, PALETTES.cool.rare]) {
      expect(c[0] / (c[0] + c[1] + c[2])).toBeLessThan(0.75);
    }
  });

  it("moves from colour to colour over the segment, and is the same for the same seed", () => {
    const a = createGlow("warm", 7);
    const b = createGlow("warm", 7);
    const c = createGlow("warm", 8);
    let differs = false;
    for (let t = 0; t < 20 * SEGMENT_S; t += 3.7) {
      const la = a.at(t).map((l) => [...l.pos, ...l.colour, l.power]);
      const lb = b.at(t).map((l) => [...l.pos, ...l.colour, l.power]);
      expect(lb).toEqual(la);
      const lc = c.at(t).map((l) => [...l.pos, ...l.colour, l.power]);
      if (JSON.stringify(lc) !== JSON.stringify(la)) differs = true;
    }
    expect(differs).toBe(true);
  });
});
