import { describe, expect, it } from "vitest";
import { createDriver } from "../../../src/apps/traffic/driver";
import { brakeCar } from "../../../src/apps/traffic/model";
import {
  BREAK_MS,
  type Meter,
  meterScore,
  PERIOD_MS,
  ROUND_MS,
  roundAt,
  roundSeed,
  sampleMeter,
} from "../../../src/apps/traffic/versus";

describe("versus rounds", () => {
  it("rounds follow the shared clock: 90 s of play, then a break", () => {
    expect(PERIOD_MS).toBe(ROUND_MS + BREAK_MS);
    const t = 1_792_000_000_000;
    const r = roundAt(t);
    expect(r.start).toBeLessThanOrEqual(t);
    expect(r.next).toBeGreaterThan(t);
    expect(r.end - r.start).toBe(ROUND_MS);
    expect(roundAt(r.next).k).toBe(r.k + 1);
    expect(roundAt(r.next - 1).k).toBe(r.k);
  });

  it("both walls build the same ring for a round, and a different one next round", () => {
    const ring = (k: number) =>
      createDriver({
        length: 224,
        baseCount: 14,
        settings: { count: 14, limit: 1, smart: 0 },
        noise: true,
        seed: roundSeed(42, k),
        start: 0,
      });
    const a = ring(5);
    const b = ring(5);
    a.fastForward(60_000);
    b.fastForward(60_000);
    expect(a.ring.cars.map((c) => c.x)).toEqual(b.ring.cars.map((c) => c.x));
    expect(a.ring.passed).toBe(b.ring.passed);
    expect(a.ring.passed).toBeGreaterThan(20);
    const c = ring(6);
    c.fastForward(60_000);
    expect(c.ring.cars.map((x) => x.x)).not.toEqual(a.ring.cars.map((x) => x.x));
  });

  it("slowdowns cost a road some flow", () => {
    const ring = () =>
      createDriver({
        length: 224,
        baseCount: 14,
        settings: { count: 14, limit: 1, smart: 0 },
        noise: true,
        seed: roundSeed(1, 1),
        start: 0,
        line: 112,
      });
    const calm = ring();
    const hit = ring();
    for (let t = 0; t <= 90_000; t += 100) {
      calm.advance(t);
      hit.advance(t);
      // A slowdown lands every 4 s.
      if (t % 4000 === 0) {
        const car = hit.ring.cars[(t / 4000) % hit.ring.cars.length]!;
        brakeCar(hit.ring, car.id, hit.ring.t + 2, 1);
      }
    }
    expect(hit.ring.passed).toBeLessThan(calm.ring.passed);
  });
});

describe("versus score", () => {
  /** A round with a gentle slowdown every 5 s, scored as the share of car time moving. */
  const play = (limit: number, smart: number, seed: number) => {
    const d = createDriver({
      length: 224,
      baseCount: 14,
      settings: { count: 14, limit, smart },
      noise: true,
      seed: roundSeed(seed, 9),
      start: 0,
    });
    const m: Meter = { moving: 0, total: 0 };
    for (let t = 0; t <= 90_000; t += 50) {
      d.advance(t);
      if (t % 5000 === 0 && t > 0) {
        const car = d.ring.cars[(t / 5000) % d.ring.cars.length]!;
        d.brake(car.id, 800, 1, 3);
      }
      if (t % 250 === 0) sampleMeter(m, d);
    }
    return meterScore(m);
  };
  const mean = (limit: number, smart: number) => {
    let sum = 0;
    for (let seed = 1; seed <= 6; seed++) sum += play(limit, smart, seed);
    return sum / 6;
  };

  it("scores in thousandths, full before any sample", () => {
    expect(meterScore({ moving: 0, total: 0 })).toBe(1000);
    expect(meterScore({ moving: 3, total: 4 })).toBe(750);
  });

  it("gives the adults something to do: smart cars keep more cars moving, and so does slow", () => {
    const none = mean(1, 0);
    expect(none).toBeLessThan(900);
    expect(mean(1, 2)).toBeGreaterThan(none + 40);
    expect(mean(1, 3)).toBeGreaterThan(none + 80);
    expect(mean(0, 0)).toBeGreaterThan(mean(2, 0));
  });
});
