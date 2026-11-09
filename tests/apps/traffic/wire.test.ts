import { describe, expect, it } from "vitest";
import { MAX_CARS } from "../../../src/apps/traffic/model";
import {
  decodeBeat,
  decodeBrake,
  decodeCtl,
  decodeScore,
  decodeSlow,
  decodeSnap,
  delayAt,
  encodeBeat,
  encodeBrake,
  encodeCtl,
  encodeScore,
  encodeSlow,
  encodeSnap,
  FLAG,
  fromBase64,
  type SnapMsg,
  toBase64,
} from "../../../src/apps/traffic/wire";

const snap = (n: number, length = 405): SnapMsg => ({
  t: 1_792_000_000_123,
  length,
  delay: { d0: 120, d1: 400, t0: 1_792_000_000_500 },
  count: n,
  limit: 2,
  smart: 1,
  attract: true,
  cars: Array.from({ length: n }, (_, i) => ({
    id: (i * 37) % 256,
    x: (i * length) / n + 0.123,
    v: (i % 17) * 0.9,
    flags: i % 3 === 0 ? FLAG.brake | FLAG.smart : i % 5 === 0 ? FLAG.ghost : 0,
  })),
});

describe("traffic wire", () => {
  it("base64 round trips any bytes", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 99, 100, 101]) {
      const b = new Uint8Array(n).map((_, i) => (i * 97 + 13) & 255);
      expect([...fromBase64(toBase64(b))!]).toEqual([...b]);
    }
    expect(fromBase64("ab$d")).toBeNull();
    expect(fromBase64("a")).toBeNull();
  });

  it("snapshots survive quantisation: positions within 1 cm, speeds within 0.05 m/s", () => {
    const m = snap(60);
    const back = decodeSnap(JSON.parse(JSON.stringify(encodeSnap(m))))!;
    expect(back).not.toBeNull();
    expect(back.t).toBe(m.t);
    expect(back.length).toBeCloseTo(405, 1);
    expect(back.delay).toEqual(m.delay);
    expect([back.count, back.limit, back.smart, back.attract]).toEqual([60, 2, 1, true]);
    back.cars.forEach((c, i) => {
      const o = m.cars[i]!;
      expect(c.id).toBe(o.id);
      expect(Math.abs(c.x - o.x)).toBeLessThan(0.01);
      expect(Math.abs(c.v - o.v)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(c.flags).toBe(o.flags);
    });
  });

  it("a full ring fits comfortably in one message", () => {
    const text = JSON.stringify(encodeSnap(snap(MAX_CARS, 1000)));
    expect(text.length).toBeLessThan(2000);
    expect(decodeSnap(JSON.parse(text))!.cars).toHaveLength(MAX_CARS);
  });

  it("drops snapshots with anything out of range", () => {
    const good = encodeSnap(snap(10)) as Record<string, unknown>;
    expect(decodeSnap(good)).not.toBeNull();
    for (const bad of [
      { ...good, t: -1 },
      { ...good, t: 1.5 },
      { ...good, l: 0 },
      { ...good, d: [1, 2] },
      { ...good, d: [1, 2, 1e9] },
      { ...good, s: [1, 9, 0] },
      { ...good, s: [1, 0, 9] },
      { ...good, c: "!!!!" },
      { ...good, c: "AAAA" },
      { ...good, c: "A".repeat(5000) },
      null,
      [],
      "x",
    ]) {
      expect(decodeSnap(bad)).toBeNull();
    }
    // Two cars with one id.
    const dup = encodeSnap({ ...snap(2), cars: snap(2).cars.map((c) => ({ ...c, id: 4 })) });
    expect(decodeSnap(dup)).toBeNull();
  });

  it("round trips the small messages and rejects nonsense", () => {
    expect(decodeBrake(encodeBrake({ car: 7, ms: 800, person: true }))).toEqual({
      car: 7,
      ms: 800,
      person: true,
    });
    expect(decodeBrake({ c: 300, d: 1 })).toBeNull();
    expect(decodeBrake({ c: 3, d: 99999 })).toBeNull();
    expect(decodeCtl(encodeCtl({ key: 0, value: -1, person: false }))).toEqual({
      key: 0,
      value: -1,
      person: false,
    });
    expect(decodeCtl({ k: 0, v: 3 })).toBeNull();
    expect(decodeCtl({ k: 1, v: 3 })).toBeNull();
    expect(decodeCtl({ k: 2, v: 3 })).not.toBeNull();
    expect(decodeCtl({ k: 2, v: 4 })).toBeNull();
    expect(decodeBeat(encodeBeat({ late: 312.4, person: true }))).toEqual({
      late: 312,
      person: true,
    });
    expect(decodeSlow(encodeSlow({ round: 4, t: 1000, f: 0.25 }))).toEqual({
      round: 4,
      t: 1000,
      f: 0.25,
    });
    expect(decodeSlow({ r: 1, t: 1, f: 2000 })).toBeNull();
    expect(decodeScore(encodeScore({ round: 2, n: 931, done: true }))).toEqual({
      round: 2,
      n: 931,
      done: true,
    });
    expect(decodeScore({ r: 2, n: 1001 })).toBeNull();
  });

  it("delay plans hold, then ease at a fixed rate, so drawing time never runs backwards", () => {
    const up = { d0: 100, d1: 400, t0: 1000 };
    expect(delayAt(up, 500)).toBe(100);
    expect(delayAt(up, 1000)).toBe(100);
    expect(delayAt(up, 1400)).toBeCloseTo(200);
    expect(delayAt(up, 9000)).toBe(400);
    const down = { d0: 400, d1: 100, t0: 0 };
    expect(delayAt(down, 1000)).toBeCloseTo(360);
    let last = -Infinity;
    for (let t = 0; t < 12_000; t += 7) {
      const drawn = t - delayAt(up, t);
      expect(drawn).toBeGreaterThan(last);
      last = drawn;
    }
  });
});
