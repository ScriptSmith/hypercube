import { describe, expect, it } from "vitest";
import { TIME_SCALE } from "../../../src/apps/traffic/config";
import { createFeed, EXTRAPOLATE_MS } from "../../../src/apps/traffic/feed";
import type { SnapMsg, WireCar } from "../../../src/apps/traffic/wire";

const snap = (t: number, cars: [number, number, number][], length = 100): SnapMsg => ({
  t,
  length,
  delay: { d0: 100, d1: 100, t0: 0 },
  count: cars.length,
  limit: 1,
  smart: 0,
  attract: false,
  cars: cars.map(([id, x, v]) => ({ id, x, v, flags: 0 })),
});

describe("feed", () => {
  it("interpolates cars between snapshots by id, across the ring's wrap", () => {
    const f = createFeed(() => 0);
    f.push(
      snap(1000, [
        [1, 10, 5],
        [2, 98, 6],
      ]),
      "h",
    );
    f.push(
      snap(1100, [
        [1, 12, 7],
        [2, 2, 6],
      ]),
      "h",
    );
    const out: WireCar[] = [];
    expect(f.at(1050, out)).toBe(true);
    expect(out.find((c) => c.id === 1)!.x).toBeCloseTo(11);
    expect(out.find((c) => c.id === 1)!.v).toBeCloseTo(6);
    // 98 to 2 is 4 m forward, not 96 back.
    expect(out.find((c) => c.id === 2)!.x).toBeCloseTo(0);
  });

  it("carries cars on past the newest snapshot at their speed, for a while", () => {
    const f = createFeed(() => 0);
    f.push(snap(1000, [[1, 10, 4]]), "h");
    const out: WireCar[] = [];
    f.at(1250, out);
    expect(out[0]!.x).toBeCloseTo(10 + 4 * 0.25 * TIME_SCALE);
    f.at(1000 + EXTRAPOLATE_MS + 5000, out);
    expect(out[0]!.x).toBeCloseTo(10 + 4 * (EXTRAPOLATE_MS / 1000) * TIME_SCALE);
  });

  it("shows new cars at once and drops removed ones", () => {
    const f = createFeed(() => 0);
    f.push(
      snap(1000, [
        [1, 10, 0],
        [2, 50, 0],
      ]),
      "h",
    );
    f.push(
      snap(1100, [
        [1, 10, 0],
        [3, 80, 0],
      ]),
      "h",
    );
    const out: WireCar[] = [];
    f.at(1020, out);
    expect(out.map((c) => c.id).sort()).toEqual([1, 3]);
  });

  it("ignores repeats from the same host, and lets a new host replace the future", () => {
    const f = createFeed(() => 0);
    f.push(snap(1000, [[1, 10, 0]]), "a");
    f.push(snap(1100, [[1, 11, 0]]), "a");
    f.push(snap(1100, [[1, 50, 0]]), "a");
    expect(f.size).toBe(2);
    f.push(snap(1050, [[1, 20, 0]]), "b");
    expect(f.size).toBe(2);
    expect(f.latest!.t).toBe(1050);
    expect(f.from).toBe("b");
  });

  it("holds a bounded number of snapshots", () => {
    const f = createFeed(() => 0);
    for (let i = 0; i < 500; i++) f.push(snap(i * 50, [[1, i % 100, 1]]), "h");
    expect(f.size).toBeLessThanOrEqual(48);
    const out: WireCar[] = [];
    // Older than anything held: the oldest held.
    expect(f.at(0, out)).toBe(true);
  });
});
