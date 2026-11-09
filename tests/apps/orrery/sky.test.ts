import { describe, expect, it } from "vitest";
import { EARTH_TILT, timeOf, YEAR } from "../../../src/apps/orrery/astro";
import { bankLatitude, bankLatitudes, isBrisbane } from "../../../src/apps/orrery/bank";
import { BRISBANE, readConfig } from "../../../src/apps/orrery/config";
import { decodeLand, isLand, LAND_H, LAND_RLE, LAND_W } from "../../../src/apps/orrery/land";
import {
  addHours,
  dateText,
  dayText,
  globalOf,
  latText,
  localOf,
  momentOf,
  noonText,
  setHour,
  type Sky,
  sunPath,
} from "../../../src/apps/orrery/sky";

const sky = (over: Partial<Sky> = {}): Sky => ({
  day: timeOf(2026, 11, 21),
  hour: 12,
  tilt: EARTH_TILT,
  flat: false,
  speed: 1,
  ...over,
});

describe("the bank's latitudes", () => {
  it("run from 75° N to 75° S with Brisbane on the nearest frame, for every bank size", () => {
    for (let n = 1; n <= 12; n++) {
      const lats = bankLatitudes(n);
      expect(lats).toHaveLength(n);
      expect(lats.filter(isBrisbane)).toHaveLength(1);
      for (let i = 1; i < n; i++) expect(lats[i]!).toBeLessThan(lats[i - 1]!);
      if (n >= 3) {
        expect(lats[0]).toBe(75);
        expect(lats[n - 1]).toBe(-75);
      }
      // Brisbane replaced the latitude closest to its own.
      const even = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : 75 - (150 * i) / (n - 1)));
      const at = lats.findIndex(isBrisbane);
      const nearest = even.reduce(
        (b, v, i) => (Math.abs(v - BRISBANE.lat) < Math.abs(even[b]! - BRISBANE.lat) ? i : b),
        0,
      );
      if (n > 1) expect(at).toBe(nearest);
    }
    expect(bankLatitudes(6)).toEqual([75, 45, 15, -27.5, -45, -75]);
    expect(bankLatitudes(3)).toEqual([75, -27.5, -75]);
    expect(bankLatitude(3, 6)).toBe(BRISBANE.lat);
    // A position past the count still gets a place.
    expect(bankLatitude(3, 2)).toBeLessThan(0);
  });
});

describe("the state", () => {
  it("carries whole days when the clock passes midnight", () => {
    expect(addHours({ day: 100, hour: 22 }, 3)).toEqual({ day: 101, hour: 1 });
    expect(addHours({ day: 100, hour: 1 }, -3)).toEqual({ day: 99, hour: 22 });
    expect(addHours({ day: 100.25, hour: 12 }, 48)).toEqual({ day: 102.25, hour: 12 });
    // Setting the hour goes the short way round.
    expect(setHour({ day: 100, hour: 23 }, 1)).toEqual({ day: 101, hour: 1 });
    expect(setHour({ day: 100, hour: 1 }, 23)).toEqual({ day: 99, hour: 23 });
    // The moment moves smoothly through midnight.
    const a = momentOf(addHours({ day: 100, hour: 23.9 }, 0));
    const b = momentOf(addHours({ day: 100, hour: 23.9 }, 0.2));
    expect(b - a).toBeCloseTo(0.2 / 24, 9);
  });

  it("gives 12 h days everywhere all year with no tilt", () => {
    for (let d = 0; d < YEAR; d += 7) {
      const s = sky({ day: timeOf(2026, 0, 1) + d, tilt: 0 });
      const g = globalOf(s);
      for (const lat of [75, 51.5, 0, BRISBANE.lat, -75]) {
        expect(localOf(s, g, { name: "", lat, lon: BRISBANE.lon }).dayLength).toBeCloseTo(12, 9);
      }
    }
  });

  it("puts Brisbane's noon Sun high and to the north in December", () => {
    const s = sky({ day: timeOf(2026, 11, 21), hour: 12 });
    const l = localOf(s, globalOf(s), BRISBANE);
    expect(l.dayLength).toBeCloseTo(13.74, 1);
    // Mean solar noon is within a few minutes of the Sun crossing the meridian.
    expect(l.sun.alt).toBeGreaterThan(84);
    expect(Math.min(l.sun.az, 360 - l.sun.az)).toBeLessThan(15);
    expect(l.season).toBe("summer");
    // At midnight it is far below.
    const m = sky({ hour: 0 });
    expect(localOf(m, globalOf(m), BRISBANE).sun.alt).toBeLessThan(-30);
  });

  it("traces today's path through the rising and setting points", () => {
    const pts = sunPath(BRISBANE.lat, -EARTH_TILT, 96);
    expect(pts).toHaveLength(97);
    expect(pts[48]!.alt).toBeCloseTo(85.94, 1);
    expect(pts[0]!.alt).toBeLessThan(0);
  });

  it("says things briefly", () => {
    expect(dayText(13.74)).toBe("14 h");
    expect(dayText(24)).toBe("24 h");
    expect(noonText(85.94)).toBe("Sun 86° high");
    expect(noonText(-3)).toBe("Sun stays down");
    expect(latText(-27.5)).toBe("28° S");
    expect(latText(0.2)).toBe("Equator");
    expect(latText(90)).toBe("North Pole");
    expect(dateText(timeOf(2026, 11, 21) + 0.5)).toBe("21 December");
  });

  it("reads the options, with 23.4 standing for the Earth's tilt", () => {
    expect(readConfig("seasons", { tilt: 23.4 }).tilt).toBe(EARTH_TILT);
    expect(readConfig("moon", { tilt: 45, compare: "tromso" })).toMatchObject({
      variant: "moon",
      tilt: 45,
      compare: "tromso",
    });
    expect(readConfig("x", { tilt: 900, compare: "mars" })).toMatchObject({
      variant: "seasons",
      tilt: 90,
      compare: "london",
      labels: true,
    });
  });
});

describe("the land map", () => {
  it("decodes to a full grid with the continents in their places", () => {
    expect(LAND_RLE.split("|")).toHaveLength(LAND_H);
    for (const row of LAND_RLE.split("|")) {
      expect(row.split(".").reduce((n, r) => n + Number.parseInt(r, 36), 0)).toBe(LAND_W);
    }
    const grid = decodeLand();
    const share = grid.reduce((n, v) => n + v, 0) / grid.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.4);
    // Brisbane is on the coast: land just inland, sea just offshore.
    expect(isLand(grid, -27.5, 152.0)).toBe(true);
    expect(isLand(grid, -27.5, 155.5)).toBe(false);
    expect(isLand(grid, 51.5, -0.5)).toBe(true);
    expect(isLand(grid, 0, -150)).toBe(false);
    expect(isLand(grid, -85, 0)).toBe(true);
    expect(isLand(grid, 23, 10)).toBe(true);
  });
});
