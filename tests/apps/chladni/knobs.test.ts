import { describe, expect, it } from "vitest";
import {
  approach,
  type Claim,
  clampPoint,
  clean,
  createArbiter,
  DAMPING_HOME,
  dampingOf,
  KNOB_GRACE_MS,
  knobHome,
  MAX_CLAIMS,
  Q_HEAVY,
  Q_LIGHT,
  qOf,
} from "../../../src/apps/chladni/knobs";
import { HOME, Q } from "../../../src/apps/chladni/modes";

const claim = (over: Partial<Claim>): Claim => ({
  from: "a",
  x: 0,
  y: 0,
  held: true,
  since: 0,
  at: 0,
  human: true,
  ...over,
});

describe("the knobs", () => {
  it("run the damping slider evenly in log Q, from light to heavy", () => {
    expect(qOf(0)).toBeCloseTo(Q_LIGHT, 9);
    expect(qOf(1)).toBeCloseTo(Q_HEAVY, 9);
    expect(qOf(DAMPING_HOME)).toBeCloseTo(Q, 9);
    expect(dampingOf(qOf(0.37))).toBeCloseTo(0.37, 9);
    expect(qOf(0.5) / qOf(0.75)).toBeCloseTo(qOf(0.25) / qOf(0.5), 9);
  });

  it("start square, at the default damping, driven from home", () => {
    for (const shape of ["square", "round"] as const) {
      expect(knobHome(shape)).toEqual({ stretch: 0, damping: DAMPING_HOME, at: HOME[shape] });
    }
  });

  it("clean what arrives: no stretch on a disc, values in range, the drive point on the plate", () => {
    expect(clean("round", { stretch: 0.7, damping: 2, at: { u: 3, v: 0 } })).toEqual({
      stretch: 0,
      damping: 1,
      at: { u: 0.97, v: 0 },
    });
    expect(clean("square", { stretch: -1, damping: Number.NaN, at: { u: 3, v: -3 } })).toEqual({
      stretch: 0,
      damping: DAMPING_HOME,
      at: { u: 0.98, v: -0.98 },
    });
    expect(clampPoint("square", { u: Number.NaN, v: 0.5 })).toEqual({ u: 0, v: 0.5 });
  });

  it("ease towards a target and settle on it", () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = approach(v, 1, 1 / 60, 0.18);
    expect(v).toBeGreaterThan(0.99);
    for (let i = 0; i < 60; i++) v = approach(v, 1, 1 / 60, 0.18);
    expect(v).toBe(1);
  });
});

describe("last touch wins", () => {
  it("prefers the touch that began latest, among holds and recent releases", () => {
    const arb = createArbiter();
    arb.hear("stretch", claim({ from: "a", x: 0.1, since: 0, at: 0 }));
    arb.hear("stretch", claim({ from: "b", x: 0.9, since: 200, at: 200 }));
    expect(arb.winner("stretch", 300)?.from).toBe("b");
    arb.hear("stretch", claim({ from: "b", x: 0.9, since: 200, at: 400, held: false }));
    arb.hear("stretch", claim({ from: "a", x: 0.1, since: 0, at: 500 }));
    expect(arb.winner("stretch", 600)?.from).toBe("b");
    expect(arb.winner("stretch", 400 + KNOB_GRACE_MS + 1)?.from).toBe("a");
  });

  it("keeps a bounded number of claims", () => {
    const arb = createArbiter();
    for (let i = 0; i < 500; i++) arb.hear("at", claim({ from: `f${i}`, since: i, at: i }));
    expect(arb.winner("at", 500)?.from).toBe("f499");
    let n = 0;
    for (let i = 0; i < 500; i++) {
      arb.forget(`f${499 - i}`);
      if (arb.winner("at", 500)) n++;
    }
    expect(n).toBeLessThanOrEqual(MAX_CLAIMS);
  });
});
