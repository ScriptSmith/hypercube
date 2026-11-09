import { describe, expect, it } from "vitest";
import {
  decodeDown,
  decodePts,
  decodeScore,
  decodeUp,
  encodeDown,
  encodeUp,
  type UpMsg,
} from "../../../src/apps/pinball/wire";

const up: UpMsg = {
  i: 7,
  p: 3,
  h: 1,
  n: 2,
  u: 0.29814,
  vx: 812.345,
  vy: -2210.6,
  c: 5,
  t: 1.7e12 + 0.4,
};

describe("pinball messages", () => {
  it("round-trips an up message, rounded", () => {
    const m = decodeUp(structuredClone(encodeUp(up)));
    expect(m).not.toBeNull();
    expect(m!.u).toBeCloseTo(up.u, 4);
    expect(m!.vx).toBe(812.3);
    expect(Number.isInteger(m!.t)).toBe(true);
  });

  it("drops an up message with anything out of range", () => {
    const bad: Record<string, unknown>[] = [
      { ...up, h: 2 },
      { ...up, n: 0 },
      { ...up, u: 1.2 },
      { ...up, p: -1 },
      { ...up, vx: Number.NaN },
      { ...up, i: 1.5 },
      { ...up, t: "now" },
    ];
    for (const b of bad) expect(decodeUp(b)).toBeNull();
    expect(decodeUp(null)).toBeNull();
    expect(decodeUp([up])).toBeNull();
  });

  it("checks down, points and score messages", () => {
    expect(decodeDown(encodeDown({ i: 3, h: 0, c: 2, t: 99.6 }))).toEqual({
      i: 3,
      h: 0,
      c: 2,
      t: 100,
    });
    expect(decodeDown({ i: 3, h: 9, c: 2, t: 1 })).toBeNull();
    expect(
      decodePts({
        p: [
          [0, 100],
          [1, 250],
        ],
      }),
    ).toEqual({
      p: [
        [0, 100],
        [1, 250],
      ],
    });
    expect(decodePts({ p: [[0, -5]] })).toBeNull();
    expect(decodePts({ p: Array.from({ length: 9 }, () => [0, 1]) })).toBeNull();
    expect(decodeScore({ h: 0, n: 1, s: 1234, b: 3, g: 1, q: 1, c: 0 })).not.toBeNull();
    expect(decodeScore({ h: 1, n: 1, s: 1234, b: 3, g: 1, q: 1, c: 0 })).toBeNull();
    expect(decodeScore({ h: 0, n: 1, s: 1234, b: 3, g: 2, q: 1, c: 0 })).toBeNull();
    // Whether the table takes deck balls follows `g` when a sender leaves it out.
    expect(decodeScore({ h: 0, n: 1, s: 1, b: 3, g: 1, q: 1, c: 0 })?.a).toBe(1);
    expect(decodeScore({ h: 0, n: 1, s: 1, b: 3, g: 0, q: 1, c: 0 })?.a).toBe(0);
    expect(decodeScore({ h: 0, n: 1, s: 1, b: 3, g: 0, q: 1, c: 0, a: 1 })?.a).toBe(1);
    expect(decodeScore({ h: 0, n: 1, s: 1, b: 3, g: 0, q: 1, c: 0, a: 3 })).toBeNull();
  });
});
