import { describe, expect, it } from "vitest";
import { createRng } from "../src/core/rng";

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = createRng("course:42");
    const b = createRng("course:42");
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("gives different sequences for different seeds and forks", () => {
    const a = createRng("x");
    expect(createRng("y").next()).not.toBe(createRng("x").next());
    expect(a.fork("one").next()).not.toBe(a.fork("two").next());
    expect(createRng("x").fork("one").next()).toBe(createRng("x").fork("one").next());
  });

  it("stays in range", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r.int(6)).toBeLessThan(6);
    }
  });
});
