import { describe, expect, it } from "vitest";
import {
  arrival,
  climbMs,
  decodeCond,
  decodeDish,
  decodeDrop,
  decodeLanded,
  flightMs,
  MIN_FLIGHT_MS,
} from "../../../src/apps/petri/net";

const DROP = {
  id: 9,
  fam: "life",
  s: 1,
  pos: 3,
  pad: 0,
  u: 0.5,
  f: 0.7,
  r: 5,
  seed: 1234,
  t: 1_700_000_000_000,
  c: 2,
  a: false,
};

describe("petri bank messages", () => {
  it("accepts a well-formed drop", () => {
    expect(decodeDrop(DROP)).toEqual(DROP);
  });

  it("rejects drops with anything out of range", () => {
    const bad: Record<string, unknown>[] = [
      { s: 99 },
      { s: 4, fam: "slime" },
      { fam: "lenia" },
      { u: 1.5 },
      { f: -0.1 },
      { r: 8 },
      { pos: 16 },
      { pad: 4 },
      { t: Number.NaN },
      { a: "yes" },
      { c: 3.5 },
      { id: -1 },
    ];
    for (const b of bad) expect(decodeDrop({ ...DROP, ...b }), JSON.stringify(b)).toBeNull();
    expect(decodeDrop(null)).toBeNull();
    expect(decodeDrop([DROP])).toBeNull();
  });

  it("checks conditions against the frame's pad count", () => {
    expect(decodeCond({ fam: "slime", pos: 2, pad: 1, pads: 2, v: 3 })).toEqual({
      fam: "slime",
      pos: 2,
      pad: 1,
      pads: 2,
      v: 3,
    });
    expect(decodeCond({ fam: "slime", pos: 2, pad: 2, pads: 2, v: 3 })).toBeNull();
    expect(decodeCond({ fam: "slime", pos: 2, pad: 0, pads: 2, v: 9 })).toBeNull();
  });

  it("checks the dish's slice table", () => {
    expect(decodeDish({ fam: "turing", s: [[0], [1, 2]], one: false })).toEqual({
      fam: "turing",
      s: [[0], [1, 2]],
      one: false,
    });
    expect(decodeDish({ fam: "turing", s: [[0, 1, 2, 3, 0]], one: false })).toBeNull();
    expect(
      decodeDish({ fam: "turing", s: Array.from({ length: 17 }, () => [0]), one: false }),
    ).toBeNull();
    expect(decodeDish({ fam: "turing", s: [["0"]], one: false })).toBeNull();
    expect(decodeLanded({ id: 12 })).toBe(12);
    expect(decodeLanded({ id: "12" })).toBeNull();
  });
});

describe("petri drop timing", () => {
  it("lands a drop one climb and one flight after its release", () => {
    const t = 10_000;
    const a = arrival(t, 0.5, t + 50);
    expect(a.start).toBe(t + climbMs(0.5));
    expect(a.land).toBe(t + climbMs(0.5) + flightMs(0.5));
  });

  it("hides network delay in the flight, keeping the landing time", () => {
    const t = 10_000;
    const onTime = arrival(t, 0.5, t + 50).land;
    const late = arrival(t, 0.5, t + climbMs(0.5) + 400);
    expect(late.land).toBe(onTime);
    expect(late.start).toBe(t + climbMs(0.5) + 400);
  });

  it("still shows a short flight when the delay eats the whole flight", () => {
    const t = 10_000;
    const now = t + 5000;
    const a = arrival(t, 0.5, now);
    expect(a.start).toBe(now);
    expect(a.land - a.start).toBe(MIN_FLIGHT_MS);
  });

  it("climbs faster for a faster flick", () => {
    expect(climbMs(1)).toBeLessThan(climbMs(0));
    expect(flightMs(1)).toBeGreaterThan(flightMs(0));
  });
});
