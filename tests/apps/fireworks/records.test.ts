import { describe, expect, it } from "vitest";
import { createEngine } from "../../../src/apps/fireworks/engine";
import { PICTOGRAMS, SHAPE, type ShapeId } from "../../../src/apps/fireworks/recipe";
import {
  burstDone,
  createPool,
  END_FADE_MS,
  enforceBudget,
  fillBurst,
  hash01,
  LOOKS,
  newBurst,
  newShell,
  starPhysics,
} from "../../../src/apps/fireworks/records";

const shellAt = (seed: number, shape: ShapeId = SHAPE.peony) => {
  const s = newShell();
  s.t0 = 1000;
  s.tb = 3000;
  s.path = { x: 100, y: -1500, vx: 50, vy: 3000, g: 400, k: 0 };
  s.shape = shape;
  s.seed = seed;
  s.radius = 900;
  s.star = 30;
  s.color = 4;
  return s;
};

describe("fireworks records", () => {
  it("recycles a fixed ring of slots, oldest first when every slot is taken", () => {
    const pool = createPool(4, newBurst);
    const made = Array.from({ length: 4 }, (_, i) => {
      const b = pool.alloc();
      b.t0 = 100 + i;
      return b;
    });
    expect(pool.live).toBe(4);
    const fifth = pool.alloc();
    expect(fifth).toBe(made[0]);
    expect(pool.slots).toHaveLength(4);
    expect(pool.live).toBe(4);
    pool.free(made[2]!);
    pool.free(made[2]!);
    expect(pool.live).toBe(3);
    expect(pool.alloc()).toBe(made[2]);
  });

  it("ends the oldest bursts early, with a short fade, when over budget", () => {
    const pool = createPool(10, newBurst);
    for (let i = 0; i < 8; i++) {
      const b = pool.alloc();
      b.t0 = i * 10;
      b.endAt = Infinity;
    }
    expect(enforceBudget(pool, 5, 1000)).toBe(3);
    const ending = pool.slots.filter((b) => b.live && b.endAt !== Infinity).map((b) => b.t0);
    expect(ending.sort((a, b) => a - b)).toEqual([0, 10, 20]);
    const first = pool.slots.find((b) => b.t0 === 0)!;
    expect(first.endAt).toBe(1000 + END_FADE_MS);
    expect(burstDone(first, 1000 + END_FADE_MS)).toBe(true);
  });

  it("keeps memory flat however many shells go up", () => {
    const engine = createEngine({ shells: 8, bursts: 12, budget: 10 });
    for (let i = 0; i < 2000; i++) {
      const src = shellAt(i);
      engine.addShell((s) => {
        s.path = src.path;
        s.shape = src.shape;
        s.seed = i;
        s.radius = src.radius;
        s.star = src.star;
        s.t0 = i * 50;
        s.tb = i * 50 + 1500;
      });
      engine.update(i * 50);
    }
    expect(engine.shells.slots).toHaveLength(8);
    expect(engine.bursts.slots).toHaveLength(12);
    expect(engine.bursts.live).toBeLessThanOrEqual(12);
    engine.update(1e9);
    expect(engine.shells.live).toBe(0);
    expect(engine.bursts.live).toBe(0);
  });

  it("makes the same burst from the same shell, wherever it is computed", () => {
    const a = fillBurst(newBurst(), shellAt(42));
    const b = fillBurst(newBurst(), shellAt(42));
    expect(b).toEqual(a);
    expect(a.t0).toBe(3000);
    // At the shell's position at its burst time.
    expect(a.y).toBeCloseTo(-1500 + 3000 * 2 - 0.5 * 400 * 4, 6);
    expect(fillBurst(newBurst(), shellAt(43)).color2).toBeDefined();
  });

  it("tilts pictograms by at most 20 degrees", () => {
    for (const shape of PICTOGRAMS) {
      for (let seed = 0; seed < 500; seed++) {
        const b = fillBurst(newBurst(), shellAt(seed, shape));
        expect(Math.abs(b.tilt)).toBeLessThanOrEqual((20 * Math.PI) / 180 + 1e-9);
      }
    }
  });

  it("keeps every burst within four seconds", () => {
    for (const look of Object.values(LOOKS)) expect(look.life).toBeLessThanOrEqual(4);
  });

  it("spreads stars to the burst radius and sags them by the look's droop", () => {
    const look = LOOKS[SHAPE.peony];
    const { speed, gravity } = starPhysics(1000, look);
    const k = look.drag;
    const t = look.life * 0.75;
    expect((speed * (1 - Math.exp(-k * t))) / k).toBeCloseTo(1000, 3);
    const L = look.life;
    const fall = (gravity * (L - (1 - Math.exp(-k * L)) / k)) / k;
    expect(fall).toBeCloseTo(look.droop * 1000, 3);
  });

  it("hashes stably", () => {
    expect(hash01(1, 2)).toBe(hash01(1, 2));
    expect(hash01(1, 2)).not.toBe(hash01(2, 1));
    expect(hash01(7, 3)).toBeGreaterThanOrEqual(0);
    expect(hash01(7, 3)).toBeLessThan(1);
  });
});
