import { describe, expect, it } from "vitest";
import {
  EARTH_TILT,
  eclipseNear,
  elongation,
  hourAngle,
  isEclipse,
  meridianAngle,
  nearestSyzygy,
  norm180,
  sunLongitude,
  timeOf,
  timeOfMs,
  YEAR,
  CLOCK_LON,
} from "../../../src/apps/orrery/astro";
import { globalOf } from "../../../src/apps/orrery/sky";
import {
  createTour,
  HOLD_S,
  MOON_LOOP_S,
  moonAt,
  moonPlan,
  seasonsAt,
  seasonsPlan,
  TILT_S,
  YEAR_S,
} from "../../../src/apps/orrery/tour";

const moment = (f: { day: number; hour: number }) => f.day + f.hour / 24;

describe("the seasons tour", () => {
  const today = timeOf(2026, 9, 26);
  const plan = seasonsPlan(today, EARTH_TILT);

  it("passes a year in 90 s with stops at both solstices and a spell with no tilt", () => {
    expect(plan.length).toBeCloseTo(YEAR_S - (2 / YEAR) * YEAR_S + 2 * HOLD_S + 2 * TILT_S, 6);
    const kinds = plan.segs.map((s) => s.kind);
    expect(kinds.filter((k) => k === "hold")).toHaveLength(2);
    expect(kinds.filter((k) => k === "tilt")).toHaveLength(2);
    // It starts today at noon and a year later is today again.
    const first = seasonsAt(plan, 0);
    expect(moment(first)).toBeCloseTo(Math.floor(today) + 0.5, 6);
    const last = seasonsAt(plan, plan.length - 1e-6);
    expect(moment(last) - moment(first)).toBeCloseTo(YEAR, 3);
    // The captions name both solstices, and the tilt goes to 0 and comes back.
    const caps = new Set<string>();
    let minTilt = 90;
    for (let s = 0; s < plan.length; s += 0.25) {
      const f = seasonsAt(plan, s);
      if (f.caption) caps.add(f.caption);
      minTilt = Math.min(minTilt, f.tilt);
    }
    expect(caps).toContain("Summer in Brisbane: long days, Sun high");
    expect(caps).toContain("Winter in Brisbane: short days, Sun low");
    expect(caps).toContain("No tilt, no seasons");
    expect(caps).toContain("The axis always points the same way");
    expect(minTilt).toBe(0);
    expect(seasonsAt(plan, plan.length - 0.01).tilt).toBe(EARTH_TILT);
  });

  it("stops at the December solstice while the Earth turns through a day", () => {
    const hold = plan.segs.find((s) => s.kind === "hold" && s.which === "dec")!;
    const start = seasonsAt(plan, hold.start + 0.001);
    expect(Math.abs(norm180(sunLongitude(moment(start)) - 270))).toBeLessThan(1);
    expect(start.hour).toBeCloseTo(12, 1);
    const mid = seasonsAt(plan, hold.start + hold.dur / 2);
    expect(mid.hour).toBeLessThan(1.5);
    expect(seasonsAt(plan, hold.start + hold.dur - 0.001).hour).toBeCloseTo(12, 1);
    expect(mid.hand).toBe("dial");
  });

  it("moves without jumps, so frames agree from the clock alone", () => {
    let prev = seasonsAt(plan, 0);
    for (let s = 0.05; s < plan.length; s += 0.05) {
      const f = seasonsAt(plan, s);
      expect(Math.abs(moment(f) - moment(prev))).toBeLessThan(0.6);
      expect(Math.abs(f.tilt - prev.tilt)).toBeLessThan(1.5);
      prev = f;
    }
    const a = createTour("seasons", EARTH_TILT);
    const b = createTour("seasons", EARTH_TILT);
    const c = Date.UTC(2026, 9, 26, 3, 4, 5, 678);
    expect(a.at(c)).toEqual(b.at(c));
  });

  it("swaps the spells round when the starting tilt is 0", () => {
    const p = seasonsPlan(today, 0);
    let max = 0;
    for (let s = 0; s < p.length; s += 0.5) max = Math.max(max, seasonsAt(p, s).tilt);
    expect(max).toBeCloseTo(23.44, 6);
    const hold = p.segs.find((s) => s.kind === "hold")!;
    expect(seasonsAt(p, hold.start + 1).caption).toBe("No tilt, no seasons");
  });
});

describe("the moon tour", () => {
  const plan = moonPlan(timeOf(2026, 9, 26), EARTH_TILT);

  it("shows an eclipse in every loop", () => {
    for (let loop = 0; loop < 12; loop++) {
      let saw = false;
      for (let s = 0; s < MOON_LOOP_S; s += 0.25) {
        const f = moonAt(plan, loop, s);
        if (eclipseNear(moment(f), 5.145)) saw = true;
      }
      expect(saw, `loop ${loop}`).toBe(true);
    }
    // And the first loop's eclipse is captioned.
    const caps = new Set<string>();
    for (let s = 0; s < MOON_LOOP_S; s += 0.25) caps.add(moonAt(plan, 0, s).caption ?? "");
    expect([...caps].some((c) => c.includes("an eclipse of the"))).toBe(true);
    expect(caps).toContain("Half the Moon is always lit by the Sun");
    expect(caps).toContain("Months pass");
  });

  it("starts each loop where the last one ended", () => {
    for (let loop = 0; loop < 6; loop++) {
      const end = moment(moonAt(plan, loop, MOON_LOOP_S - 1e-6));
      const next = moment(moonAt(plan, loop + 1, 0));
      expect(Math.abs(end - next)).toBeLessThan(0.01);
    }
  });

  it("keeps the Moon on Brisbane's meridian, so the ground view shows it at its highest", () => {
    for (let s = 0; s < 59; s += 3) {
      const f = moonAt(plan, 1, s);
      const g = globalOf({ day: f.day, hour: f.hour, tilt: EARTH_TILT, flat: false, speed: 1 });
      expect(Math.abs(hourAngle(meridianAngle(g.t, f.hour), CLOCK_LON, g.moon.ra))).toBeLessThan(
        12,
      );
    }
  });

  it("gives every eclipse season's middle syzygy an eclipse", () => {
    for (let loop = 0; loop < 8; loop++) {
      const t = moment(moonAt(plan, loop, 4));
      const kind = Math.abs(norm180(elongation(t))) < 90 ? "solar" : "lunar";
      const s = nearestSyzygy(t, kind === "solar" ? "new" : "full");
      expect(isEclipse(s, kind)).toBe(true);
    }
    expect(timeOfMs(0)).toBeLessThan(0);
  });
});
