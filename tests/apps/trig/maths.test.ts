import { describe, expect, it } from "vitest";
import { DEG, TAU } from "../../../src/apps/trig/config";
import {
  bankTourAngle,
  decimal,
  decimalIsExact,
  exactAt,
  exactText,
  exactValue,
  MINUS,
  nearestSpecial,
  nextSpecial,
  piFraction,
  quadrantOf,
  radText,
  shortest,
  SPECIAL_DEG,
  tanUndefined,
  TOUR_MOVE_MS,
  TOUR_MS,
  TOUR_PAUSE_MS,
  TOUR_STOP,
  tourAngle,
  valuesAt,
  wholeDeg,
  wrap,
} from "../../../src/apps/trig/maths";

describe("trig angles", () => {
  it("wraps into one turn and finds the short way round", () => {
    expect(wrap(-0.5)).toBeCloseTo(TAU - 0.5, 12);
    expect(wrap(TAU + 1)).toBeCloseTo(1, 12);
    expect(shortest(0.1, TAU - 0.1)).toBeCloseTo(-0.2, 12);
    expect(shortest(TAU - 0.1, 0.1)).toBeCloseTo(0.2, 12);
    expect(shortest(1, 2)).toBeCloseTo(1, 12);
    expect(Math.abs(shortest(0, Math.PI))).toBeCloseTo(Math.PI, 12);
  });

  it("rounds to whole degrees, with a full turn as 360", () => {
    expect(wholeDeg(30 * DEG)).toBe(30);
    expect(wholeDeg(29.6 * DEG)).toBe(30);
    expect(wholeDeg(0.4 * DEG)).toBe(0);
    expect(wholeDeg(TAU)).toBe(360);
    expect(wholeDeg(359.7 * DEG)).toBe(360);
    expect(wholeDeg(-10 * DEG)).toBe(350);
    expect(wholeDeg(TAU + 10 * DEG)).toBe(360);
  });

  it("finds the nearest special angle within a tolerance, and the next one either way", () => {
    expect(nearestSpecial(31 * DEG, 3 * DEG)! / DEG).toBeCloseTo(30, 9);
    expect(nearestSpecial(37 * DEG, 3 * DEG)).toBeNull();
    expect(nearestSpecial(-2 * DEG, 3 * DEG)! / DEG).toBeCloseTo(0, 9);
    expect(nearestSpecial(358 * DEG, 3 * DEG)! / DEG).toBeCloseTo(0, 9);
    expect(nextSpecial(31 * DEG, 1) / DEG).toBeCloseTo(45, 9);
    expect(nextSpecial(31 * DEG, -1) / DEG).toBeCloseTo(30, 9);
    expect(nextSpecial(30 * DEG, 1) / DEG).toBeCloseTo(45, 9);
    expect(nextSpecial(30 * DEG, -1) / DEG).toBeCloseTo(0, 9);
    // Across a full turn, keeping the turn count.
    expect(nextSpecial(TAU + 340 * DEG, 1) / DEG).toBeCloseTo(720, 9);
    expect(nextSpecial(TAU + 1 * DEG, -1) / DEG).toBeCloseTo(360, 9);
    expect(nextSpecial(-5 * DEG, -1) / DEG).toBeCloseTo(-30, 9);
  });
});

describe("trig exact values", () => {
  it("match sin, cos and tan at every special angle", () => {
    for (const d of SPECIAL_DEG) {
      const e = exactAt(d)!;
      expect(e, `${d}°`).not.toBeNull();
      const r = d * DEG;
      expect(exactValue(e.sin), `sin ${d}°`).toBeCloseTo(Math.sin(r), 12);
      expect(exactValue(e.cos), `cos ${d}°`).toBeCloseTo(Math.cos(r), 12);
      if (d % 180 === 90) expect(e.tan, `tan ${d}°`).toBeNull();
      else expect(exactValue(e.tan!), `tan ${d}°`).toBeCloseTo(Math.tan(r), 9);
    }
  });

  it("are written as the textbook writes them", () => {
    const at = (d: number) => {
      const e = exactAt(d)!;
      return [exactText(e.sin), exactText(e.cos), e.tan ? exactText(e.tan) : null];
    };
    expect(at(0)).toEqual(["0", "1", "0"]);
    expect(at(30)).toEqual(["1/2", "√3/2", "√3/3"]);
    expect(at(45)).toEqual(["√2/2", "√2/2", "1"]);
    expect(at(60)).toEqual(["√3/2", "1/2", "√3"]);
    expect(at(90)).toEqual(["1", "0", null]);
    expect(at(120)).toEqual(["√3/2", `${MINUS}1/2`, `${MINUS}√3`]);
    expect(at(135)).toEqual(["√2/2", `${MINUS}√2/2`, `${MINUS}1`]);
    expect(at(180)).toEqual(["0", `${MINUS}1`, "0"]);
    expect(at(210)).toEqual([`${MINUS}1/2`, `${MINUS}√3/2`, "√3/3"]);
    expect(at(270)).toEqual([`${MINUS}1`, "0", null]);
    expect(at(315)).toEqual([`${MINUS}√2/2`, "√2/2", `${MINUS}1`]);
    expect(at(330)).toEqual([`${MINUS}1/2`, "√3/2", `${MINUS}√3/3`]);
    expect(at(360)).toEqual(at(0));
  });

  it("are given only at special angles", () => {
    expect(exactAt(37)).toBeNull();
    expect(exactAt(100)).toBeNull();
    expect(valuesAt(37 * DEG).exact).toBeNull();
    expect(valuesAt(29.8 * DEG).exact?.sin).toEqual({ neg: false, num: "1", den: 2 });
  });

  it("say when the decimal is exact, so the readout writes = and not ≈", () => {
    expect(decimalIsExact(exactAt(30)!.sin)).toBe(true);
    expect(decimalIsExact(exactAt(30)!.cos)).toBe(false);
    expect(decimalIsExact(exactAt(45)!.tan!)).toBe(true);
    expect(decimalIsExact(exactAt(60)!.tan!)).toBe(false);
  });
});

describe("trig values", () => {
  it("have no tan at 90° and 270° only", () => {
    for (let d = 0; d <= 360; d++) {
      expect(tanUndefined(d), `${d}°`).toBe(d === 90 || d === 270);
      const v = valuesAt(d * DEG);
      expect(v.tan === null, `${d}°`).toBe(d === 90 || d === 270);
    }
  });

  it("change sign by quadrant", () => {
    const signs = (d: number) => {
      const v = valuesAt(d * DEG);
      return [Math.sign(v.sin), Math.sign(v.cos), Math.sign(v.tan ?? Number.NaN)];
    };
    expect(signs(40)).toEqual([1, 1, 1]);
    expect(signs(130)).toEqual([1, -1, -1]);
    expect(signs(220)).toEqual([-1, -1, 1]);
    expect(signs(310)).toEqual([-1, 1, -1]);
    expect([40, 130, 220, 310, 0, 90, 180, 270].map(quadrantOf)).toEqual([
      1,
      2,
      3,
      4,
      null,
      null,
      null,
      null,
    ]);
  });

  it("are read at the whole degree the readout shows", () => {
    const v = valuesAt(37.4 * DEG);
    expect(v.deg).toBe(37);
    expect(v.sin).toBeCloseTo(Math.sin(37 * DEG), 12);
    expect(v.tan).toBeCloseTo(Math.tan(37 * DEG), 12);
  });
});

describe("trig formatting", () => {
  it("writes decimals to two places with a real minus and no negative zero", () => {
    expect(decimal(0.5)).toBe("0.50");
    expect(decimal(-0.866)).toBe(`${MINUS}0.87`);
    expect(decimal(-0.001)).toBe("0.00");
    expect(decimal(57.28996)).toBe("57.29");
  });

  it("writes special angles as fractions of π, others in radians", () => {
    const want: Record<number, string> = {
      0: "0",
      30: "π/6",
      45: "π/4",
      60: "π/3",
      90: "π/2",
      120: "2π/3",
      135: "3π/4",
      150: "5π/6",
      180: "π",
      210: "7π/6",
      225: "5π/4",
      240: "4π/3",
      270: "3π/2",
      300: "5π/3",
      315: "7π/4",
      330: "11π/6",
      360: "2π",
    };
    for (const d of SPECIAL_DEG) expect(radText(d), `${d}°`).toBe(want[d]);
    expect(radText(37)).toBe("0.65");
    expect(radText(100)).toBe("1.75");
    expect(piFraction(37)).toBeNull();
  });
});

describe("trig slow turn", () => {
  it("turns a full turn every TOUR_MS, never backwards, pausing at multiples of 45°", () => {
    expect(tourAngle(TOUR_MS) - tourAngle(0)).toBeCloseTo(TAU, 9);
    let prev = tourAngle(0);
    for (let t = 0; t <= TOUR_MS * 2; t += 7) {
      const a = tourAngle(t);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = a;
    }
    // Still through each pause, on a multiple of 45°.
    for (let k = 1; k < 8; k++) {
      const start = k * (TOUR_MOVE_MS + TOUR_PAUSE_MS) - TOUR_PAUSE_MS;
      const a = tourAngle(start + 10);
      const b = tourAngle(start + TOUR_PAUSE_MS - 10);
      expect(a).toBeCloseTo(b, 12);
      expect(a / TOUR_STOP).toBeCloseTo(k, 9);
    }
  });

  it("puts each frame of a bank of six a sixth of a turn's time behind the one to its left", () => {
    const t = 123_456;
    for (let pos = 0; pos < 6; pos++) {
      expect(bankTourAngle(t, pos, 6)).toBeCloseTo(tourAngle(t - (pos * TOUR_MS) / 6), 12);
    }
    // So frame k is where frame 0 was k sixths of a turn's time ago.
    expect(bankTourAngle(t + TOUR_MS / 6, 1, 6)).toBeCloseTo(bankTourAngle(t, 0, 6), 12);
    // A bank of five spaces its frames a fifth apart.
    expect(bankTourAngle(t, 1, 5)).toBeCloseTo(tourAngle(t - TOUR_MS / 5), 12);
  });
});
