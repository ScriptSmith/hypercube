import { describe, expect, it } from "vitest";
import { createCaught, inRing, type Ring, ringsAt } from "../../../src/apps/kites/rings";
import { createWindField, WIND_PRESETS, windDir } from "../../../src/apps/kites/wind";

const T0 = 1_760_000_000;

describe("rings", () => {
  it("are the same on every frame at the same moment", () => {
    const a = createWindField(99, WIND_PRESETS.breezy);
    const b = createWindField(99, WIND_PRESETS.breezy);
    const ra: Ring[] = [];
    const rb: Ring[] = [];
    for (let i = 0; i < 100; i++) {
      ringsAt(a, T0 + i * 2.3, ra);
      ringsAt(b, T0 + i * 2.3, rb);
      expect(rb).toEqual(ra);
    }
  });

  it("drift downwind, a few at a time, inside the sky", () => {
    const w = createWindField(4, WIND_PRESETS.breezy);
    const out: Ring[] = [];
    let total = 0;
    let moved = 0;
    for (let s = 0; s < 1200; s += 3) {
      const t = T0 + s;
      ringsAt(w, t, out);
      total += out.length;
      expect(out.length).toBeLessThanOrEqual(8);
      const before = new Map(out.map((r) => [r.id, r.f]));
      for (const r of out) {
        expect(r.h).toBeGreaterThan(0.25);
        expect(r.h).toBeLessThan(0.9);
      }
      ringsAt(w, t + 1, out);
      const dir = Math.sign(windDir(w, t));
      for (const r of out) {
        const f0 = before.get(r.id);
        if (f0 === undefined || Math.abs(windDir(w, t)) < 0.95) continue;
        expect(Math.sign(r.f - f0)).toBe(dir);
        moved++;
      }
    }
    const mean = total / 400;
    expect(mean).toBeGreaterThan(1);
    expect(mean).toBeLessThan(6);
    expect(moved).toBeGreaterThan(50);
  });

  it("are caught by a kite inside them", () => {
    const r: Ring = { id: 1, f: 0.5, h: 0.5 };
    expect(inRing(r, 0.55, 0.5, 1.1, 0.07)).toBe(true);
    expect(inRing(r, 0.55, 0.62, 1.1, 0.07)).toBe(false);
  });

  it("remember a bounded number of catches", () => {
    const c = createCaught(4);
    for (let i = 0; i < 10; i++) c.add(i);
    expect(c.size).toBe(4);
    expect(c.has(9)).toBe(true);
    expect(c.has(0)).toBe(false);
  });
});
