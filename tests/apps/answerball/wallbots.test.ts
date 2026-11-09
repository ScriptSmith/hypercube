// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWallBots } from "../../../src/apps/answerball/wallbots";
import { createRng } from "../../../src/core/rng";

describe("wall bots", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("touch only free balls, inside them and within reach", async () => {
    vi.useFakeTimers();
    const downs: { x: number; y: number }[] = [];
    let id = 0;
    const input = {
      inject: {
        down: (x: number, y: number) => {
          downs.push({ x, y });
          return ++id;
        },
        move: () => {},
        up: () => {},
      },
    };
    const balls = [
      { x: 1000, y: 1300, r: 900, free: true },
      { x: 3200, y: 1300, r: 900, free: false },
      { x: 5400, y: 1300, r: 900, free: true },
    ];
    const bots = createWallBots(
      input,
      createRng("b"),
      () => balls,
      () => ({
        top: 1336,
        floor: 2200,
        unit: 1,
      }),
    );
    for (let i = 0; i < 6000; i++) {
      bots.update(1 / 60, 2);
      await vi.advanceTimersByTimeAsync(1000 / 60);
    }
    expect(downs.length).toBeGreaterThan(10);
    for (const d of downs) {
      expect(d.y).toBeGreaterThanOrEqual(1336);
      expect(d.y).toBeLessThan(2200);
      const near = balls.map((b) => Math.hypot(d.x - b.x, d.y - b.y) / b.r);
      const i = near.indexOf(Math.min(...near));
      expect(near[i]).toBeLessThan(1);
      expect(balls[i]!.free).toBe(true);
    }
    bots.dispose();
  });
});
