/**
 * The ball must stay within the flash rule for public displays: individual tiles sparkle, but
 * no area larger than a small patch flashes more than three times a second, the whole ball
 * never flashes, and no flash is a saturated red. Each run is a minute of the show that takes
 * in a change of scene, measured in places 3 and 4 tiles square (and those grids shifted by half
 * a place), 8 tiles square, and over the whole ball.
 */
import { describe, expect, it } from "vitest";
import { planScene } from "../../../src/apps/discoball/show";
import { maxFlashesPerSecond, simulate } from "./flashes";

const GRIDS = [
  { rows: 3, cols: 3, shift: 0 },
  { rows: 3, cols: 3, shift: 1.5 },
  { rows: 4, cols: 4, shift: 2 },
  { rows: 8, cols: 8, shift: 0 },
];

describe("discoball flashing", () => {
  for (const [lights, spin, seed] of [
    ["party", "medium", "flash-a"],
    ["party", "slow", "flash-b"],
    ["white", "medium", "flash-c"],
  ] as const) {
    it(`stays within the flash rule with ${lights} lights at ${spin} spin`, () => {
      const from = Math.max(0, planScene(seed, lights, 0, 0, null).end - 30);
      const run = simulate({ seed, lights, spin, from, seconds: 60, grids: GRIDS });
      expect(run.scenes.size).toBe(2);
      run.series.forEach((areas, g) => {
        let worst = 0;
        for (const s of areas) worst = Math.max(worst, maxFlashesPerSecond(s, run.hz));
        expect(worst, `grid ${JSON.stringify(GRIDS[g])}`).toBeLessThanOrEqual(3);
      });
      // The whole ball doesn't even change by a fiftieth of full brightness back and forth.
      expect(maxFlashesPerSecond(run.whole, run.hz, 0.02)).toBe(0);
      expect(Math.max(...run.whole)).toBeLessThan(0.08);
      expect(run.reddest).toBeLessThan(0.8);
      expect(run.maxLit).toBeLessThan(run.layout.count * 0.04);
    }, 180_000);
  }
});
