import { describe, expect, it } from "vitest";
import {
  bankFraction,
  cornerFraction,
  fromBankFraction,
  fromCornerFraction,
} from "../src/core/layout";

describe("bank geometry", () => {
  it("maps a point in a frame onto the whole bank", () => {
    expect(bankFraction(0, 0, 10)).toBe(0);
    expect(bankFraction(9, 1, 10)).toBe(1);
    expect(bankFraction(3, 0.5, 10)).toBeCloseTo(0.35);
  });

  it("round-trips and clamps", () => {
    const { pos, u } = fromBankFraction(bankFraction(6, 0.25, 10), 10);
    expect(pos).toBe(6);
    expect(u).toBeCloseTo(0.25);
    expect(fromBankFraction(1, 10)).toEqual({ pos: 9, u: 1 });
    expect(bankFraction(12, 2, 10)).toBe(1);
  });
});

describe("corner geometry", () => {
  it("puts side 0 on the left half and side 1 on the right half", () => {
    expect(cornerFraction(0, 9, 1, 10)).toBe(0.5);
    expect(cornerFraction(1, 0, 0, 10)).toBe(0.5);
    expect(cornerFraction(1, 9, 1, 10)).toBe(1);
  });

  it("round-trips", () => {
    const f = cornerFraction(1, 4, 0.5, 10);
    const back = fromCornerFraction(f);
    expect(back.side).toBe(1);
    expect(fromBankFraction(back.f, 10).pos).toBe(4);
  });
});
