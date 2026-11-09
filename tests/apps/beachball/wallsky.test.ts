import { describe, expect, it } from "vitest";
import { ballShadow, wallLayout } from "../../../src/apps/beachball/walllayout";
import { SUN } from "../../../src/apps/beachball/wallshade";
import {
  blankLook,
  CYCLE,
  CYCLE_S,
  cycleAt,
  type Look,
  lookAt,
  LOOKS,
  shadowSun,
  SKY_MODES,
} from "../../../src/apps/beachball/wallsky";
import { REACH, WALL } from "./beach";

const values = (l: Look) =>
  Object.values(l).flatMap((v) => (typeof v === "number" ? [v] : [...(v as number[])]));

describe("the time of day", () => {
  it("by day is the look the wall had before", () => {
    const d = LOOKS.day;
    for (let i = 0; i < 3; i++) expect(d.sun[i]).toBeCloseTo(SUN[i]!, 6);
    expect(d.sunLight[1]).toBeCloseTo(0.95 * 0.55, 6);
    expect(d.skyLight[2]).toBeCloseTo(0.68 * 0.75, 6);
    expect(d.envHorizon[0]).toBeCloseTo(0.62 * 0.9, 6);
    expect(d.skyTop).toEqual([0.09, 0.27, 0.62]);
    expect(d.seaTint).toEqual([1, 1, 1]);
    expect(d.sunDisc[3]).toBe(0);
    expect(d.moonDisc[3]).toBe(0);
    expect(d.stars).toBe(0);
  });

  it("goes from day to sunset, evening and sunrise and back, round about every 18 minutes", () => {
    expect(CYCLE.map((c) => c.look)).toEqual(["day", "sunset", "evening", "sunrise"]);
    expect(CYCLE_S).toBeGreaterThan(15 * 60);
    expect(CYCLE_S).toBeLessThan(25 * 60);
    expect(cycleAt(0)).toEqual({ from: "day", to: "day", fade: 0 });
    expect(cycleAt(CYCLE[0]!.hold + 30)).toMatchObject({ from: "day", to: "sunset" });
    expect(cycleAt(CYCLE_S - 30)).toMatchObject({ from: "sunrise", to: "day" });
    expect(cycleAt(CYCLE_S + 5)).toEqual(cycleAt(5));
    const seen = new Set<string>();
    for (let t = 0; t < CYCLE_S; t += 10) seen.add(cycleAt(t).from);
    expect(seen.size).toBe(4);
  });

  it("fades slowly, never jumping, and wraps round seamlessly", () => {
    const a = blankLook();
    const b = blankLook();
    let worst = 0;
    for (let t = 0; t <= CYCLE_S + 1; t += 0.5) {
      lookAt("cycle", t, a);
      lookAt("cycle", t + 0.5, b);
      const va = values(a);
      const vb = values(b);
      for (let i = 0; i < va.length; i++) worst = Math.max(worst, Math.abs(va[i]! - vb[i]!));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("holds one look in each fixed mode, every value finite and the light from above", () => {
    const l = blankLook();
    for (const mode of SKY_MODES) {
      for (const t of [0, 100, 700, 1000]) {
        lookAt(mode, t, l);
        for (const v of values(l)) expect(Number.isFinite(v)).toBe(true);
        expect(l.sun[1]).toBeGreaterThan(0.2);
        expect(Math.hypot(...l.sun)).toBeCloseTo(1, 6);
        if (mode !== "cycle") expect(l.skyTop).toEqual(LOOKS[mode].skyTop);
      }
    }
  });

  it("keeps every shadow on the beach, longer for a low sun", () => {
    const layout = wallLayout(WALL.width, WALL.height, REACH, 2);
    const reach = (sun: readonly [number, number, number]) => {
      const sh = ballShadow(5, layout.floor + 1.5, 0.45, layout.floor, layout.horizon, sun);
      expect(sh.y).toBeGreaterThan(0);
      expect(sh.y).toBeLessThan(layout.horizon);
      return Math.hypot(sh.x - 5, sh.y - layout.floor);
    };
    for (const name of ["day", "sunset", "evening", "sunrise"] as const) {
      expect(shadowSun(LOOKS[name].sun)[1]).toBeGreaterThanOrEqual(0.62 - 1e-9);
      reach(shadowSun(LOOKS[name].sun));
    }
    expect(reach(shadowSun(LOOKS.sunset.sun))).toBeGreaterThan(reach(shadowSun(LOOKS.day.sun)));
  });
});
