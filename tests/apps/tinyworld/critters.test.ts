import { describe, expect, it } from "vitest";
import {
  createCritters,
  type Ground,
  groundFromHeights,
} from "../../../src/apps/tinyworld/critters";

const flat = (
  y: number,
  extra: (x: number) => Partial<{ y: number; depth: number; liquid: number }> = () => ({}),
): Ground => ({
  sample: (x) => ({ y, depth: 0, liquid: 0, ...extra(x) }),
});
const make = (cap = 4) =>
  createCritters({ cap, lifeMs: 120_000, speed: 80, step: 30, drop: 60, width: 5760 });
const run = (c: ReturnType<typeof make>, ground: Ground, seconds: number, t0 = 0) => {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60, t0 + (i * 1000) / 60, ground, () => 0.5);
};

describe("tinyworld beetles", () => {
  it("drop onto the ground and walk along it", () => {
    const c = make();
    c.spawn(3000, 1500, 0);
    run(c, flat(2200), 3);
    const b = c.list[0]!;
    expect(b.y).toBeCloseTo(2200, 0);
    expect(b.state).toBe("walk");
    expect(Math.abs(b.x - 3000)).toBeGreaterThan(100);
  });

  it("turn back at a wall too tall to climb, and climb a small step", () => {
    const c = make();
    c.spawn(3000, 2200, 0);
    const wall: Ground = flat(2200, (x) => (Math.abs(x - 3000) > 150 ? { y: 2000 } : {}));
    run(c, wall, 20);
    expect(Math.abs(c.list[0]!.x - 3000)).toBeLessThan(200);
    const d = make();
    d.spawn(3000, 2200, 0);
    run(
      d,
      flat(2200, (x) => (Math.abs(x - 3000) > 150 ? { y: 2180 } : {})),
      10,
    );
    expect(Math.abs(d.list[0]!.x - 3000)).toBeGreaterThan(150);
  });

  it("paddle on water and hop away from lava", () => {
    const c = make();
    c.spawn(3000, 2000, 0);
    run(
      c,
      flat(2200, () => ({ depth: 50, liquid: 1 })),
      2,
    );
    expect(c.list[0]!.state).toBe("swim");
    expect(c.list[0]!.y).toBeCloseTo(2150, 0);
    const d = make();
    d.spawn(3000, 2200, 0);
    run(
      d,
      flat(2200, (x) => (Math.abs(x - 3000) > 100 ? { depth: 20, liquid: 2 } : {})),
      15,
    );
    expect(Math.abs(d.list[0]!.x - 3000)).toBeLessThan(160);
  });

  it("fly away when shooed", () => {
    const c = make();
    c.spawn(3000, 2200, 0);
    c.spawn(4000, 2200, 0);
    c.shoo(3020, 2200, 90);
    expect(c.list.map((b) => b.state)).toEqual(["leave", "fall"]);
  });

  it("keep to a cap, fly off after their lifetime, and stay bounded", () => {
    const c = make(3);
    for (let i = 0; i < 20; i++) c.spawn(1000 + i * 200, 2200, 0);
    expect(c.list.filter((b) => b.state !== "leave").length).toBeLessThanOrEqual(3);
    expect(c.list.length).toBeLessThanOrEqual(6);
    run(c, flat(2200), 5, 125_000);
    expect(c.list).toHaveLength(0);
  });

  it("read the ground from the heightmap bytes", () => {
    const bytes = new Uint8Array([10, 1, 4, 1, 0, 0, 0, 0]);
    const g = groundFromHeights(bytes, 2, 3, 2160);
    expect(g.sample(0)).toEqual({ y: 2160 - 266 * 3, depth: 12, liquid: 1 });
    expect(g.sample(1000).y).toBe(2160);
  });
});
