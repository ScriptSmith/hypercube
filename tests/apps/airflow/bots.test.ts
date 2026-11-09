// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type BotScene, createBots } from "../../../src/apps/airflow/bots";
import { KINDS } from "../../../src/apps/airflow/config";
import { createRng } from "../../../src/core/rng";

const box = (x: number, y: number, size = 150) => ({ x, y, width: size, height: size });

describe("airflow bots", () => {
  it("visit the large sizes now and then without leaving a shape there", () => {
    // One sting on the wall, so every size tap lands on it: the hardest case.
    const steps = KINDS.wall.sizes;
    const home = steps.indexOf(1);
    let step = home;
    const smaller = box(1000, 1500);
    const bigger = box(1000, 1340);
    const inBox = (
      b: { x: number; y: number; width: number; height: number },
      x: number,
      y: number,
    ) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
    let ids = 0;
    const scene = (): BotScene => ({
      handles: [{ x: 1300, y: 2000, travel: { x0: 1130, x1: 3000, y0: 1880, y1: 2250 } }],
      knobs: [{ x: 1300, y: 1580, r: 85 }],
      tiles: [box(840, 1780), box(840, 1950), box(840, 2120)],
      sizes: [{ smaller, bigger, size: steps[step]! }],
      sliders: [{ from: { x: 150, y: 1500 }, to: { x: 650, y: 1500 } }],
      views: [box(60, 1600), box(315, 1600), box(570, 1600)],
      stream: box(1500, 400, 2000),
    });
    const bots = createBots({
      input: {
        inject: {
          down(x, y) {
            if (inBox(bigger, x, y)) step = Math.min(steps.length - 1, step + 1);
            else if (inBox(smaller, x, y)) step = Math.max(0, step - 1);
            return ids++;
          },
          move() {},
          up() {},
        },
      },
      rng: createRng("sizes"),
      count: 2,
      unit: () => 1,
      scene,
    });
    const dt = 0.1;
    let atTop = 0;
    let large = 0;
    let longest = 0;
    let visits = 0;
    let was = false;
    const total = 30 * 60;
    for (let t = 0; t < total; t += dt) {
      bots.update(dt, 2);
      const size = steps[step]!;
      if (step === steps.length - 1) atTop += dt;
      const big = size > 1.5;
      if (big) {
        large += dt;
        longest = Math.max(longest, large);
        if (!was) visits++;
      } else large = 0;
      was = big;
    }
    bots.dispose();
    // They do grow it large, more than once, but never leave it there for long.
    expect(visits).toBeGreaterThan(2);
    expect(atTop / total).toBeLessThan(0.05);
    expect(longest).toBeLessThan(90);
  });
});
