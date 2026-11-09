import { describe, expect, it } from "vitest";
import { PLUME_RANGE } from "../../../src/apps/airflow/config";
import {
  byteOf,
  decodePlume,
  encodePlume,
  encodeValues,
  fresh,
  MAX_SAMPLES,
  speedOfByte,
} from "../../../src/apps/airflow/wire";

describe("plume messages", () => {
  it("survive quantisation: speeds within half a step, smoke within half a byte", () => {
    const n = 40;
    const up = Array.from({ length: n }, (_, k) => 1 + Math.sin(k / 3) * 0.8);
    const right = Array.from({ length: n }, (_, k) => Math.cos(k / 5) * 0.6);
    const smoke = Array.from({ length: n * 3 }, (_, k) => (k % 7) / 6);
    const msg = encodeValues(4, up, right, smoke, 123_456.7, false);
    const p = decodePlume(JSON.parse(JSON.stringify(msg)))!;
    expect(p.pos).toBe(4);
    expect(p.n).toBe(n);
    expect(p.t).toBe(123_457);
    const step = PLUME_RANGE / 127;
    for (let k = 0; k < n; k++) {
      expect(Math.abs(p.up[k]! - up[k]!)).toBeLessThanOrEqual(step / 2 + 1e-6);
      expect(Math.abs(p.right[k]! - right[k]!)).toBeLessThanOrEqual(step / 2 + 1e-6);
    }
    for (let k = 0; k < n * 3; k++)
      expect(Math.abs(p.smoke[k]! - smoke[k]!)).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
  });

  it("keeps still air exactly still and clamps speeds beyond the range", () => {
    expect(byteOf(0)).toBe(128);
    expect(speedOfByte(128)).toBe(0);
    expect(speedOfByte(byteOf(PLUME_RANGE * 5))).toBeCloseTo(PLUME_RANGE, 9);
    expect(speedOfByte(byteOf(-PLUME_RANGE * 5))).toBeCloseTo(-PLUME_RANGE, 9);
    expect(byteOf(Number.NaN)).toBe(128);
  });

  it("packs the GPU's readback rows: (up, right) then (r, g, b)", () => {
    const n = 3;
    const read = new Uint8Array(n * 2 * 4);
    for (let k = 0; k < n; k++) {
      read.set([128 + k, 120 - k, 128, 255], k * 4);
      read.set([10 * k, 20 * k, 30 * k, 255], (n + k) * 4);
    }
    const p = decodePlume(encodePlume(2, read, n, 5000, true))!;
    expect(p.auto).toBe(true);
    expect(p.up[2]).toBeCloseTo(speedOfByte(130), 6);
    expect(p.right[1]).toBeCloseTo(speedOfByte(119), 6);
    expect(p.smoke[2 * 3 + 2]).toBeCloseTo(60 / 255, 6);
  });

  it("refuses anything malformed", () => {
    const good = encodeValues(1, [0.5], [0], [0, 0, 0], 1000, false);
    expect(decodePlume(good)).not.toBeNull();
    for (const bad of [
      null,
      "x",
      [],
      { ...good, p: -1 },
      { ...good, p: 1.5 },
      { ...good, p: 999 },
      { ...good, n: 0 },
      { ...good, n: MAX_SAMPLES + 1 },
      { ...good, n: 2 },
      { ...good, d: 5 },
      { ...good, d: "!!!" },
      { ...good, d: "A".repeat(10_000) },
      { ...good, t: Number.NaN },
      { ...good, t: "1" },
      { ...good, a: 1 },
    ]) {
      expect(decodePlume(bad)).toBeNull();
    }
  });

  it("accepts only messages stamped near the receiver's clock", () => {
    expect(fresh(10_000, 12_000)).toBe(true);
    expect(fresh(10_000, 30_000)).toBe(false);
  });
});
