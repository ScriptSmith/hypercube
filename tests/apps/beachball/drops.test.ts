import { describe, expect, it } from "vitest";
import {
  createDrops,
  DROP_LIFE,
  DROP_SIZE,
  dropBands,
  MAX_DROPS,
} from "../../../src/apps/beachball/drops";
import { createMotion } from "../../../src/apps/beachball/motion";
import { createRng } from "../../../src/core/rng";
import { DEG, direction, IDENTITY3, latLonOf, type Vec3 } from "../../../src/core/sphere";

const VIEW = { top: 40 * DEG, bottom: -90 * DEG };

describe("water drops", () => {
  it("start in the band people see and form where nobody does", () => {
    const bands = dropBands(VIEW);
    expect(bands.form.bottom).toBeGreaterThan(VIEW.top);
    expect(bands.form.top).toBeGreaterThan(bands.form.bottom);
    expect(bands.start.top).toBeLessThan(VIEW.top);
    expect(bands.start.bottom).toBeGreaterThan(VIEW.bottom);

    const drops = createDrops(createRng("start"), bands, IDENTITY3);
    expect(drops.list.length).toBe(2);
    for (const d of drops.list) {
      const lat = latLonOf(d.p).lat;
      expect(lat).toBeGreaterThanOrEqual(bands.start.bottom - 1e-9);
      expect(lat).toBeLessThanOrEqual(bands.start.top + 1e-9);
    }
  });

  it("slide downhill when big, hold on when small", () => {
    const bands = dropBands(VIEW);
    const drops = createDrops(createRng("slide"), bands, IDENTITY3);
    const [big, small] = drops.list as [(typeof drops.list)[0], (typeof drops.list)[0]];
    big.p = direction(10 * DEG, 0);
    big.size = DROP_SIZE[1];
    big.age = 5;
    big.life = 1000;
    small.p = direction(10 * DEG, 2);
    small.size = 0.008;
    small.age = 5;
    small.life = 1000;
    const bigStart = latLonOf(big.p).lat;
    const smallStart: Vec3 = [...small.p];
    for (let i = 0; i < 60 * 30; i++) drops.step(1 / 60, IDENTITY3, [0, 0, 0]);
    expect(latLonOf(big.p).lat).toBeLessThan(bigStart - 0.1);
    expect(Math.abs(latLonOf(big.p).lon)).toBeLessThan(1e-6);
    expect(small.p).toEqual(smallStart);
  });

  it("dry up, are bounded in number, stay on the ball and keep coming back", () => {
    const motion = createMotion(createRng("wet"), { pace: "lively", toss: true });
    const drops = createDrops(createRng("wet-drops"), dropBands(VIEW), motion.rotation);
    let empty = 0;
    let n = 0;
    let formed = 0;
    let crowded = 0;
    let offBall = 0;
    let overdue = 0;
    let swollen = 0;
    let known = new Set(drops.list);
    for (let i = 0; i < 6 * 3600 * 10; i++) {
      motion.step(0.1);
      drops.step(0.1, motion.rotation, motion.omega);
      if (drops.list.length > MAX_DROPS) crowded++;
      for (const d of drops.list) {
        if (Math.abs(Math.hypot(...d.p) - 1) > 1e-9) offBall++;
        if (d.age >= d.life || d.life > DROP_LIFE[1]) overdue++;
        if (drops.radius(d) > d.size) swollen++;
        if (!known.has(d)) formed++;
      }
      known = new Set(drops.list);
      if (drops.list.length === 0) empty++;
      n++;
    }
    expect({ crowded, offBall, overdue, swollen }).toEqual({
      crowded: 0,
      offBall: 0,
      overdue: 0,
      swollen: 0,
    });
    expect(formed).toBeGreaterThan(100);
    expect(empty / n).toBeLessThan(0.25);
  });

  it("shrink to nothing as they dry", () => {
    const drops = createDrops(createRng("dry"), dropBands(VIEW), IDENTITY3);
    const d = drops.list[0]!;
    d.age = d.life * 0.5;
    const half = drops.radius(d);
    d.age = d.life * 0.99;
    expect(drops.radius(d)).toBeLessThan(half * 0.2);
    d.age = d.life;
    expect(drops.radius(d)).toBe(0);
  });

  it("give the shader a unit tangent and a stretch for each drop", () => {
    const drops = createDrops(createRng("shape"), dropBands(VIEW), IDENTITY3);
    for (let i = 0; i < 600; i++) drops.step(1 / 60, IDENTITY3, [0, 0, 0]);
    for (const d of drops.list) {
      const { along, stretch } = drops.shape(d);
      expect(Math.hypot(...along)).toBeCloseTo(1, 9);
      expect(Math.abs(along[0] * d.p[0] + along[1] * d.p[1] + along[2] * d.p[2])).toBeLessThan(
        1e-6,
      );
      expect(stretch).toBeGreaterThanOrEqual(1);
      expect(stretch).toBeLessThanOrEqual(1.8);
    }
  });
});
