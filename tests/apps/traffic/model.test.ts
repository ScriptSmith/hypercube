import { describe, expect, it } from "vitest";
import { SPACING } from "../../../src/apps/traffic/config";
import {
  brakeCar,
  CAR_LENGTH,
  createRing,
  equilibriumSpeed,
  gapAhead,
  hash3,
  jams,
  LIMITS,
  MIN_GAP,
  meanSpeed,
  type Ring,
  setCount,
  setSmartEvery,
  SMART_EVERY,
  speedSpread,
  STEP_HZ,
  stepRing,
} from "../../../src/apps/traffic/model";

const run = (ring: Ring, secs: number, each?: (r: Ring) => void) => {
  const steps = Math.round(secs * STEP_HZ);
  for (let i = 0; i < steps; i++) {
    stepRing(ring);
    each?.(ring);
  }
};

const minGap = (ring: Ring) => {
  let m = Infinity;
  for (let i = 0; i < ring.cars.length; i++) m = Math.min(m, gapAhead(ring, i));
  return m;
};

/** Signed distance from `a` forward to `b` round a ring of length L, in (-L/2, L/2]. */
const ahead = (a: number, b: number, L: number) => {
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
};

describe("ring model", () => {
  it("hashes are uniform in (0, 1) and deterministic", () => {
    let sum = 0;
    for (let i = 0; i < 4000; i++) {
      const u = hash3(7, i, 3);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      sum += u;
    }
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
  });

  it("starts evenly spread at the speed the spacing allows", () => {
    const ring = createRing({ length: 400, count: 25, seed: 1 });
    expect(ring.cars).toHaveLength(25);
    const v = equilibriumSpeed(16, LIMITS[1]);
    for (const c of ring.cars) expect(c.v).toBeCloseTo(v, 6);
    for (let i = 0; i < ring.cars.length; i++) {
      expect(gapAhead(ring, i)).toBeGreaterThan(16 - CAR_LENGTH - 1.1);
    }
  });

  it("never lets cars touch, at any density, limit, smart share and with hard brakes", () => {
    for (const spacing of [6.5, 8, 11, 15.5, 19, 24, 40]) {
      for (const limit of [0, 1, 2]) {
        for (const smart of SMART_EVERY) {
          const ring = createRing({
            length: 300,
            count: 300 / spacing,
            seed: spacing * 10 + limit,
            limit: LIMITS[limit],
            smartEvery: smart,
          });
          let worst = Infinity;
          let k = 0;
          run(ring, 90, (r) => {
            // Someone stamps on a brake every few seconds.
            if (++k % 170 === 0) brakeCar(r, r.cars[k % r.cars.length]!.id, r.t + 1 + (k % 3));
            worst = Math.min(worst, minGap(r));
          });
          expect(worst, `spacing ${spacing} limit ${limit} smart ${smart}`).toBeGreaterThanOrEqual(
            MIN_GAP - 1e-9,
          );
          for (const c of ring.cars) {
            expect(c.v).toBeGreaterThanOrEqual(0);
            expect(c.x).toBeGreaterThanOrEqual(0);
            expect(c.x).toBeLessThan(ring.length);
          }
        }
      }
    }
  });

  it("keeps cars in ring order", () => {
    const ring = createRing({ length: 250, count: 18, seed: 4 });
    const order = () => {
      const ids = ring.cars.map((c) => c.id);
      const i = ids.indexOf(0);
      return [...ids.slice(i), ...ids.slice(0, i)].join(",");
    };
    const before = order();
    run(ring, 120);
    expect(order()).toBe(before);
  });

  it("a single brake on a smooth ring sends a wave backwards, long after the car moved on", () => {
    const L = 405;
    const ring = createRing({ length: L, count: L / SPACING.many, seed: 2, noise: false });
    run(ring, 10);
    expect(speedSpread(ring)).toBeLessThan(0.05);
    const first = ring.cars[0]!;
    const x0 = first.x;
    brakeCar(ring, first.id, ring.t + 1);
    // Where the slowest car is, relative to where the brake happened, each second.
    const trail: { t: number; at: number; v: number }[] = [];
    let tapped = 0;
    for (let s = 1; s <= 30; s++) {
      run(ring, 1);
      let slow = ring.cars[0]!;
      for (const c of ring.cars) if (c.v < slow.v) slow = c;
      trail.push({ t: s, at: ahead(x0, slow.x, L), v: slow.v });
      if (s === 12) tapped = ahead(x0, ring.cars.find((c) => c.id === first.id)!.x, L);
    }
    // The tapped car has moved on: well ahead of where it braked.
    expect(tapped).toBeGreaterThan(40);
    // The slowdown is behind the brake and moving backwards, at a few metres a second.
    const at10 = trail[9]!.at;
    const at25 = trail[24]!.at;
    expect(at10).toBeLessThan(0);
    expect(at25).toBeLessThan(at10 - 30);
    const speed = (at10 - at25) / 15;
    expect(speed).toBeGreaterThan(2.5);
    expect(speed).toBeLessThan(9);
    // And it is a real jam, not a ripple: cars in it crawl.
    expect(Math.min(...trail.slice(5).map((p) => p.v))).toBeLessThan(2);
  });

  it("jams by itself above a critical density with noisy drivers, not below it", () => {
    const jammedSecs = (spacing: number, noise: boolean) => {
      const ring = createRing({ length: 405, count: 405 / spacing, seed: 9, noise });
      let n = 0;
      let k = 0;
      run(ring, 360, (r) => {
        if (++k % STEP_HZ === 0 && jams(r) > 0) n++;
      });
      return n;
    };
    expect(jammedSecs(SPACING.many, true)).toBeGreaterThan(60);
    expect(jammedSecs(SPACING.few, true)).toBe(0);
    // Without noise a smooth ring stays smooth: jams come only from touches.
    expect(jammedSecs(SPACING.many, false)).toBe(0);
  });

  it("smart cars reduce the spread of speeds and clear the jams", () => {
    const measure = (every: number) => {
      const ring = createRing({
        length: 405,
        count: 405 / SPACING.many,
        seed: 5,
        smartEvery: every,
      });
      let spread = 0;
      let jammed = 0;
      let k = 0;
      run(ring, 480, (r) => {
        if (++k % STEP_HZ !== 0 || r.t < 120) return;
        spread += speedSpread(r);
        if (jams(r) > 0) jammed++;
      });
      return { spread: spread / 360, jammed, mean: meanSpeed(ring) };
    };
    const none = measure(0);
    const tenth = measure(10);
    const quarter = measure(4);
    expect(none.spread).toBeGreaterThan(2.5);
    expect(tenth.spread).toBeLessThan(none.spread * 0.5);
    expect(quarter.spread).toBeLessThan(none.spread * 0.4);
    expect(tenth.jammed).toBeLessThan(none.jammed / 4);
  });

  it("is deterministic: same seed, same steps, same cars", () => {
    const a = createRing({ length: 300, count: 20, seed: 11 });
    const b = createRing({ length: 300, count: 20, seed: 11 });
    run(a, 60);
    run(b, 60);
    expect(a.cars.map((c) => [c.id, c.x, c.v])).toEqual(b.cars.map((c) => [c.id, c.x, c.v]));
    const c = createRing({ length: 300, count: 20, seed: 12 });
    run(c, 60);
    expect(c.cars.map((x) => x.x)).not.toEqual(a.cars.map((x) => x.x));
  });

  it("adds cars into the biggest gap and removes them without touching", () => {
    const ring = createRing({ length: 300, count: 15, seed: 3 });
    run(ring, 20);
    setCount(ring, 30);
    expect(ring.cars).toHaveLength(30);
    expect(new Set(ring.cars.map((c) => c.id)).size).toBe(30);
    expect(minGap(ring)).toBeGreaterThanOrEqual(MIN_GAP);
    run(ring, 30);
    expect(minGap(ring)).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    setCount(ring, 8);
    expect(ring.cars).toHaveLength(8);
    run(ring, 10);
    // A full ring stops adding where nothing fits.
    setCount(ring, 1000);
    expect(ring.cars.length).toBeLessThanOrEqual(Math.floor(300 / (CAR_LENGTH + 2 * MIN_GAP)));
    expect(minGap(ring)).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
  });

  it("spreads smart cars evenly", () => {
    const ring = createRing({ length: 400, count: 24, seed: 1 });
    setSmartEvery(ring, 4);
    expect(ring.cars.filter((c) => c.smart)).toHaveLength(6);
    setSmartEvery(ring, 0);
    expect(ring.cars.some((c) => c.smart)).toBe(false);
  });

  it("counts cars past the line", () => {
    const ring = createRing({ length: 200, count: 8, seed: 1, noise: false, line: 100 });
    const v = ring.cars[0]!.v;
    run(ring, 60);
    // Each car goes round v * 60 / 200 times.
    expect(ring.passed).toBeGreaterThanOrEqual(Math.floor((8 * v * 60) / 200) - 8);
    expect(ring.passed).toBeLessThanOrEqual(Math.ceil((8 * v * 60) / 200) + 8);
  });
});
