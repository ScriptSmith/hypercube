import { describe, expect, it } from "vitest";
import { LIMIT } from "../../../src/apps/ballpit/config";
import { createLimiter } from "../../../src/apps/ballpit/limiter";

describe("touch limiter", () => {
  it("gives a whole hand of fingers landing together one ball", () => {
    const lim = createLimiter();
    const ok = [0, 12, 25, 40, 60].filter((t) => lim.offer(0, t).ok);
    expect(ok).toEqual([0]);
  });

  it("gives one ball per button per window, however fast it is tapped", () => {
    const lim = createLimiter();
    const ok: number[] = [];
    for (let t = 0; t < 6000; t += 70) if (lim.offer(1, t).ok) ok.push(t);
    expect(ok.length).toBe(Math.ceil(6000 / LIMIT.buttonMs));
    for (let i = 1; i < ok.length; i++)
      expect(ok[i]! - ok[i - 1]!).toBeGreaterThanOrEqual(LIMIT.buttonMs);
  });

  it("says how long a refused touch should wait, and keeps buttons apart", () => {
    const lim = createLimiter();
    expect(lim.offer(0, 1000).ok).toBe(true);
    expect(lim.offer(0, 1600)).toEqual({ ok: false, wait: LIMIT.buttonMs - 600 });
    expect(lim.offer(3, 1600).ok).toBe(true);
    expect(lim.offer(0, 1000 + LIMIT.buttonMs).ok).toBe(true);
  });

  it("forgets everything on reset", () => {
    const lim = createLimiter();
    lim.offer(0, 0);
    expect(lim.offer(0, 100).ok).toBe(false);
    lim.reset();
    expect(lim.offer(0, 100).ok).toBe(true);
  });
});
