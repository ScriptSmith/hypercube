import { describe, expect, it } from "vitest";
import { TIME_SCALE } from "../../../src/apps/traffic/config";
import {
  adoptDriver,
  applyCtl,
  createDriver,
  STEP_MS,
  startCount,
} from "../../../src/apps/traffic/driver";
import { LIMITS, SMART_EVERY, stepRing } from "../../../src/apps/traffic/model";
import { decodeSnap, encodeSnap } from "../../../src/apps/traffic/wire";

const PLAN = { d0: 100, d1: 100, t0: 0 };

const make = (start = 10_000) =>
  createDriver({
    length: 405,
    baseCount: 26,
    settings: { count: 26, limit: 1, smart: 0 },
    noise: true,
    seed: 3,
    start,
  });

describe("driver", () => {
  it("steps the ring in time with the clock, TIME_SCALE ring seconds a second", () => {
    const d = make();
    // At most a second's steps per call, so a long gap takes a few frames to catch up.
    expect(d.advance(10_000 + 2000)).toBe(Math.round(1000 / STEP_MS));
    d.advance(10_000 + 2000);
    expect(d.t).toBeGreaterThan(12_000 - STEP_MS);
    expect(d.t).toBeLessThanOrEqual(12_000);
    expect(d.ring.t).toBeCloseTo(2 * TIME_SCALE, 1);
  });

  it("skips ahead after a clock jump rather than racing", () => {
    const d = make();
    d.advance(10_000 + 600_000);
    expect(d.ring.step).toBe(0);
    d.advance(10_000 + 600_500);
    expect(d.ring.step).toBeGreaterThan(30);
    // A clock that steps back a little just waits.
    const step = d.ring.step;
    d.advance(10_000 + 600_400);
    expect(d.ring.step).toBe(step);
  });

  it("says when a brake starts and when it is only held", () => {
    const d = make();
    const id = d.ring.cars[3]!.id;
    expect(d.brake(id, 1000)).toBe("started");
    expect(d.brake(id, 800)).toBe("held");
    expect(d.brake(999, 800)).toBeNull();
    d.advance(10_000 + 2000);
    expect(d.brake(id, 800)).toBe("started");
  });

  it("applies the adults' controls within their range", () => {
    const d = make();
    applyCtl(d, 0, 1);
    expect(d.ring.cars.length).toBeGreaterThan(26);
    for (let i = 0; i < 40; i++) applyCtl(d, 0, 1);
    expect(d.settings.count).toBeLessThanOrEqual(52);
    for (let i = 0; i < 80; i++) applyCtl(d, 0, -1);
    expect(d.settings.count).toBe(13);
    expect(d.ring.cars).toHaveLength(13);
    applyCtl(d, 1, 2);
    expect(d.ring.limit).toBe(LIMITS[2]);
    applyCtl(d, 2, 3);
    expect(d.ring.smartEvery).toBe(SMART_EVERY[3]);
    expect(d.ring.cars.filter((c) => c.smart).length).toBe(Math.ceil(13 / 2));
  });

  it("a new host continues the same cars from a snapshot", () => {
    const old = make();
    for (let t = 10_000; t <= 40_000; t += 500) old.advance(t);
    applyCtl(old, 2, 2);
    const wire = decodeSnap(JSON.parse(JSON.stringify(encodeSnap(old.snapshot(PLAN, false)))))!;
    const next = adoptDriver(wire, { baseCount: 26, noise: true, seed: 3 });
    expect(next.t).toBe(wire.t);
    expect(next.settings).toEqual(old.settings);
    expect(next.ring.cars.map((c) => c.id)).toEqual(old.ring.cars.map((c) => c.id));
    expect(next.ring.cars.map((c) => c.smart)).toEqual(old.ring.cars.map((c) => c.smart));
    // A second later both rings still agree closely: same cars, same places within a metre.
    old.advance(41_000);
    next.advance(41_000);
    old.ring.cars.forEach((c, i) => {
      const o = next.ring.cars[i]!;
      expect(o.id).toBe(c.id);
      let dx = Math.abs(o.x - c.x);
      dx = Math.min(dx, 405 - dx);
      expect(dx).toBeLessThan(1);
    });
  });

  it("frames that adopt the same snapshot predict exactly the same ring", () => {
    const host = make();
    for (let t = 10_000; t <= 30_000; t += 500) host.advance(t);
    const wire = decodeSnap(encodeSnap(host.snapshot(PLAN, false)))!;
    const a = adoptDriver(wire, { baseCount: 26, noise: true, seed: 3 });
    const b = adoptDriver(wire, { baseCount: 26, noise: true, seed: 3 });
    for (let t = 30_000; t <= 36_000; t += 500) a.advance(t);
    for (let t = 30_000; t <= 36_000; t += 37) b.advance(t);
    b.advance(36_000);
    expect(a.ring.cars.map((c) => [c.x, c.v])).toEqual(b.ring.cars.map((c) => [c.x, c.v]));
  });

  it("resizes the ring keeping cars at their fractions", () => {
    const d = make();
    const f = d.ring.cars.map((c) => c.x / 405);
    d.resize(810);
    d.ring.cars.forEach((c, i) => expect(c.x / 810).toBeCloseTo(f[i]!, 9));
    stepRing(d.ring);
  });

  it("starts with about one car per spacing", () => {
    expect(startCount(405, 15.5)).toBe(26);
    expect(startCount(10, 15.5)).toBe(3);
  });
});

describe("driver flow", () => {
  it("counts the cars past the line over the last minute", () => {
    const d = createDriver({
      length: 200,
      baseCount: 10,
      settings: { count: 10, limit: 1, smart: 0 },
      noise: false,
      seed: 1,
      start: 0,
    });
    for (let t = 0; t <= 120_000; t += 100) d.advance(t);
    const v = d.ring.cars[0]!.v;
    // Ten cars each going round v * 60 * TIME_SCALE / 200 times a minute.
    const want = (10 * v * 60 * TIME_SCALE) / 200;
    expect(d.flow()).toBeGreaterThan(want - 3);
    expect(d.flow()).toBeLessThan(want + 3);
  });
});
