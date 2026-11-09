import { describe, expect, it } from "vitest";
import { createBots, MAX_BOTS } from "../../../src/apps/kaleido/bots";
import type { Input } from "../../../src/core/types";
import { testRng } from "./helpers";

/** Records injected touches the way the input module would see them. */
const fakeInput = () => {
  let next = 1;
  const down = new Map<number, { x: number; y: number; path: number }>();
  const lifted: number[] = [];
  const input: Pick<Input, "inject"> = {
    inject: {
      down(x, y) {
        const id = next++;
        down.set(id, { x, y, path: 0 });
        return id;
      },
      move(id, x, y) {
        const t = down.get(id);
        if (!t) return;
        t.path += Math.hypot(x - t.x, y - t.y);
        t.x = x;
        t.y = y;
      },
      up(id) {
        down.delete(id);
        lifted.push(id);
      },
    },
  };
  return { input, down, lifted };
};

describe("bot pourers", () => {
  const area = { x0: 120, x1: 6360, y0: 1470, y1: 2360 };

  it("touch inside the reach band and swirl", () => {
    const { input, down, lifted } = fakeInput();
    const unit = 0.2;
    const bots = createBots(
      input,
      testRng(3),
      () => area,
      () => unit,
    );
    let moved = 0;
    for (let i = 0; i < 60 * 30; i++) {
      bots.update(1 / 60, 4);
      for (const t of down.values()) {
        expect(t.x / unit).toBeGreaterThanOrEqual(area.x0 - 400);
        expect(t.x / unit).toBeLessThanOrEqual(area.x1 + 400);
        expect(t.y / unit).toBeGreaterThanOrEqual(area.y0 - 250);
        expect(t.y / unit).toBeLessThanOrEqual(area.y1 + 250);
        moved = Math.max(moved, t.path / unit);
      }
      expect(down.size).toBeLessThanOrEqual(4);
    }
    expect(lifted.length).toBeGreaterThan(10);
    expect(moved).toBeGreaterThan(300);
    bots.dispose();
    expect(down.size).toBe(0);
  });

  it("lift every finger when told to stand down", () => {
    const { input, down } = fakeInput();
    const bots = createBots(
      input,
      testRng(5),
      () => area,
      () => 1,
    );
    for (let i = 0; i < 600; i++) bots.update(1 / 60, MAX_BOTS);
    expect(down.size).toBeGreaterThan(0);
    bots.update(1 / 60, 0);
    expect(down.size).toBe(0);
    for (let i = 0; i < 300; i++) bots.update(1 / 60, 2);
    bots.release();
    expect(down.size).toBe(0);
    expect(bots.touching).toBe(0);
  });
});
