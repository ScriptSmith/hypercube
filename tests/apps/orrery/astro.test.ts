import { describe, expect, it } from "vitest";
import {
  dayLength,
  declination,
  EARTH_TILT,
  elongation,
  enu,
  horizontal,
  isEclipse,
  limbAngle,
  litFraction,
  MOON_INCL,
  moonLatitude,
  nearestSyzygy,
  nextSeason,
  nextSunAt,
  nodeLongitude,
  noonAltitude,
  norm180,
  phaseOf,
  riseAzimuth,
  seasonAt,
  setAzimuth,
  SYNODIC,
  sunDistanceKm,
  sunLongitude,
  timeOf,
  timeOfMs,
  dateOf,
  YEAR,
} from "../../../src/apps/orrery/astro";
import { BRISBANE } from "../../../src/apps/orrery/config";
import { globalOf, localOf, type Sky } from "../../../src/apps/orrery/sky";

const BNE = BRISBANE.lat;

describe("the Sun through the year", () => {
  it("has the declination of its tilt at the solstices and none at the equinoxes", () => {
    for (const tilt of [0, 10, EARTH_TILT, 45, 66.5, 90]) {
      expect(declination(90, tilt)).toBeCloseTo(tilt, 9);
      expect(declination(270, tilt)).toBeCloseTo(-tilt, 9);
      expect(declination(0, tilt)).toBeCloseTo(0, 9);
      expect(declination(180, tilt)).toBeCloseTo(0, 9);
      // In between it follows sin δ = sin ε sin λ.
      expect(Math.sin((declination(30, tilt) * Math.PI) / 180)).toBeCloseTo(
        Math.sin((tilt * Math.PI) / 180) * 0.5,
        9,
      );
    }
  });

  it("reaches the solstices and equinoxes on their dates", () => {
    const at = (m: number, d: number) => sunLongitude(timeOf(2026, m, d) + 0.5);
    // Each within a day (a degree) of its date.
    expect(Math.abs(norm180(at(2, 20) - 0))).toBeLessThan(1);
    expect(Math.abs(at(5, 21) - 90)).toBeLessThan(1);
    expect(Math.abs(norm180(at(8, 23) - 180))).toBeLessThan(1);
    expect(Math.abs(at(11, 21) - 270)).toBeLessThan(1);
    // Searching for the June solstice lands on 21 June.
    const june = dateOf(nextSunAt(timeOf(2026, 0, 1), 90));
    expect([june.month, june.day]).toEqual([5, 21]);
  });

  it("is nearest in early January and farthest in early July", () => {
    let near = { t: 0, d: Infinity };
    let far = { t: 0, d: 0 };
    for (let t = timeOf(2026, 0, 1); t < timeOf(2027, 0, 1); t += 0.25) {
      const d = sunDistanceKm(t);
      if (d < near.d) near = { t, d };
      if (d > far.d) far = { t, d };
    }
    const n = dateOf(near.t);
    const f = dateOf(far.t);
    expect(n.month).toBe(0);
    expect(n.day).toBeGreaterThanOrEqual(2);
    expect(n.day).toBeLessThanOrEqual(5);
    expect(f.month).toBe(6);
    expect(near.d / 1e6).toBeCloseTo(147.1, 0);
    expect(far.d / 1e6).toBeCloseTo(152.1, 0);
  });

  it("makes the model's clock agree with Brisbane's dates", () => {
    // Midday in Brisbane on 21 December 2026 (02:00 universal time).
    const t = timeOfMs(Date.UTC(2026, 11, 21, 2, 0));
    expect(dateOf(t)).toEqual({ year: 2026, month: 11, day: 21 });
    expect((t % 1) * 24).toBeCloseTo(12.2, 1);
  });
});

describe("day length", () => {
  it("is 12 h every day on the equator, and every day everywhere with no tilt", () => {
    for (let l = 0; l < 360; l += 15) {
      expect(dayLength(0, declination(l, EARTH_TILT))).toBeCloseTo(12, 9);
      for (const lat of [-80, -27.5, 0, 51.5, 80]) {
        expect(dayLength(lat, declination(l, 0))).toBeCloseTo(12, 9);
      }
    }
  });

  it("is about 13.7 h in Brisbane in December and 10.3 h in June", () => {
    expect(dayLength(BNE, -EARTH_TILT)).toBeCloseTo(13.74, 1);
    expect(dayLength(BNE, EARTH_TILT)).toBeCloseTo(10.26, 1);
    expect(dayLength(BNE, -EARTH_TILT) + dayLength(BNE, EARTH_TILT)).toBeCloseTo(24, 9);
  });

  it("has polar day and polar night at 75°", () => {
    expect(dayLength(75, EARTH_TILT)).toBe(24);
    expect(dayLength(75, -EARTH_TILT)).toBe(0);
    expect(dayLength(-75, -EARTH_TILT)).toBe(24);
    expect(dayLength(-75, EARTH_TILT)).toBe(0);
    // Tipped on its side, even Brisbane gets a day without sunset.
    expect(dayLength(BNE, -90)).toBe(24);
    expect(dayLength(BNE, 90)).toBe(0);
    // At the equinox the pole's Sun runs round the horizon.
    expect(dayLength(90, 0)).toBe(12);
  });
});

describe("the Sun from the ground", () => {
  it("is 86° high at noon in Brisbane in December, just north of overhead", () => {
    expect(noonAltitude(BNE, -EARTH_TILT)).toBeCloseTo(85.94, 2);
    const h = horizontal(BNE, -EARTH_TILT, 0);
    expect(h.alt).toBeCloseTo(85.94, 6);
    expect(h.az).toBeCloseTo(0, 6);
    // In June it is 39° high in the north; in London in December, 15° in the south.
    expect(noonAltitude(BNE, EARTH_TILT)).toBeCloseTo(39.06, 2);
    expect(horizontal(51.5, -EARTH_TILT, 0).az).toBeCloseTo(180, 6);
    expect(noonAltitude(51.5, -EARTH_TILT)).toBeCloseTo(15.06, 2);
    expect(noonAltitude(80, -EARTH_TILT)).toBeLessThan(0);
  });

  it("rises south of east and sets south of west in a Brisbane summer", () => {
    const rise = riseAzimuth(BNE, -EARTH_TILT)!;
    expect(rise).toBeCloseTo(116.6, 0);
    expect(setAzimuth(BNE, -EARTH_TILT)).toBeCloseTo(360 - rise, 9);
    // In winter it rises north of east.
    expect(riseAzimuth(BNE, EARTH_TILT)!).toBeCloseTo(63.4, 0);
    // At the equinoxes it rises due east and sets due west everywhere.
    for (const lat of [-60, BNE, 0, 51.5]) {
      expect(riseAzimuth(lat, 0)).toBeCloseTo(90, 9);
      expect(setAzimuth(lat, 0)).toBeCloseTo(270, 9);
    }
    // The rising point is where the Sun's centre crosses the horizon.
    const dec = -EARTH_TILT;
    const h0 = (dayLength(BNE, dec) * 15) / 2;
    const atRise = horizontal(BNE, dec, -h0);
    expect(atRise.alt).toBeCloseTo(0, 6);
    expect(atRise.az).toBeCloseTo(rise, 6);
    expect(riseAzimuth(75, EARTH_TILT)).toBeNull();
  });

  it("names the seasons the right way round in each hemisphere", () => {
    const dec = sunLongitude(timeOf(2026, 11, 25));
    expect(seasonAt(BNE, dec, EARTH_TILT)).toBe("summer");
    expect(seasonAt(51.5, dec, EARTH_TILT)).toBe("winter");
    const jul = sunLongitude(timeOf(2026, 6, 10));
    expect(seasonAt(BNE, jul, EARTH_TILT)).toBe("winter");
    expect(seasonAt(51.5, jul, EARTH_TILT)).toBe("summer");
    expect(seasonAt(BNE, jul, 0)).toBeNull();
    expect(seasonAt(1.3, jul, EARTH_TILT)).toBeNull();
  });
});

describe("the Moon", () => {
  it("names its phase from its angle from the Sun", () => {
    expect(phaseOf(0)).toBe("new");
    expect(phaseOf(359)).toBe("new");
    expect(phaseOf(45)).toBe("waxing crescent");
    expect(phaseOf(90)).toBe("first quarter");
    expect(phaseOf(135)).toBe("waxing gibbous");
    expect(phaseOf(180)).toBe("full");
    expect(phaseOf(225)).toBe("waning gibbous");
    expect(phaseOf(270)).toBe("last quarter");
    expect(phaseOf(315)).toBe("waning crescent");
    expect(litFraction(0)).toBeCloseTo(0, 9);
    expect(litFraction(90)).toBeCloseTo(0.5, 9);
    expect(litFraction(180)).toBeCloseTo(1, 9);
    // A month later it is back where it was.
    expect(elongation(1234.5 + SYNODIC)).toBeCloseTo(elongation(1234.5), 6);
  });

  it("is new and full on real dates", () => {
    // New Moon 17 February 2026, full Moon 3 March 2026 (Brisbane dates).
    expect(dateOf(nearestSyzygy(timeOf(2026, 1, 15), "new"))).toMatchObject({ month: 1 });
    expect(dateOf(nearestSyzygy(timeOf(2026, 1, 15), "new")).day).toBeGreaterThanOrEqual(17);
    expect(dateOf(nearestSyzygy(timeOf(2026, 1, 15), "new")).day).toBeLessThanOrEqual(18);
    const full = dateOf(nearestSyzygy(timeOf(2026, 2, 1), "full"));
    expect(full.month).toBe(2);
    expect(full.day).toBeGreaterThanOrEqual(3);
    expect(full.day).toBeLessThanOrEqual(4);
  });

  it("is lit on its left from Brisbane and its right from London as it grows", () => {
    // A crescent four days old, an hour after sunset.
    const t0 = nearestSyzygy(timeOf(2026, 3, 20), "new") + 4;
    const sky: Sky = { day: Math.floor(t0), hour: 0, tilt: EARTH_TILT, flat: false, speed: 0 };
    const check = (lat: number, lon: number) => {
      // Find the hour an hour after sunset at the place, by stepping the clock.
      let best: { hour: number; alt: number; limb: number; moonAlt: number } | null = null;
      for (let h = 12; h < 24; h += 0.05) {
        const s = { ...sky, hour: h };
        const g = globalOf(s);
        const l = localOf(s, g, { name: "", lat, lon });
        if (l.sun.alt < -8 && l.sun.alt > -14 && l.sun.az > 180 && !best) {
          best = { hour: h, alt: l.sun.alt, limb: l.moon.limb, moonAlt: l.moon.alt };
        }
      }
      return best;
    };
    // Brisbane's evening crescent: the Moon is up and its lit side faces left.
    const bne = check(BNE, BRISBANE.lon)!;
    expect(bne.moonAlt).toBeGreaterThan(0);
    expect(Math.cos((bne.limb * Math.PI) / 180)).toBeLessThan(-0.2);
    // London's (on Brisbane's meridian, so the same clock) faces right.
    const lon = check(51.5, BRISBANE.lon)!;
    expect(lon.moonAlt).toBeGreaterThan(0);
    expect(Math.cos((lon.limb * Math.PI) / 180)).toBeGreaterThan(0.2);
    // Waning, in the morning with the Sun rising in the east, its lit side faces right.
    const sun = enu(BNE, -10, -80);
    const moon = enu(BNE, -10, 0);
    expect(Math.cos((limbAngle(sun, moon) * Math.PI) / 180)).toBeGreaterThan(0.5);
  });

  it("makes eclipses only near a node, and at every new and full Moon with a flat orbit", () => {
    let syzygies = 0;
    let eclipses = 0;
    const years = 30;
    const start = timeOf(2026, 0, 1);
    for (let t = nearestSyzygy(start, "new"); t < start + years * YEAR; t += SYNODIC / 2) {
      const kind = Math.abs(norm180(elongation(t))) < 90 ? "solar" : "lunar";
      syzygies++;
      expect(isEclipse(t, kind, 0)).toBe(true);
      if (!isEclipse(t, kind, MOON_INCL)) continue;
      eclipses++;
      // The Sun is within about 17° of one of the Moon's nodes.
      const gap = norm180(sunLongitude(t) - nodeLongitude(t));
      const off = Math.abs(gap) > 90 ? Math.abs(norm180(gap - 180)) : Math.abs(gap);
      expect(off).toBeLessThan(kind === "solar" ? 18 : 12.5);
      expect(Math.abs(moonLatitude(t))).toBeLessThan(1.5);
    }
    // Most months have none: between two and five a year.
    expect(eclipses / years).toBeGreaterThan(2.5);
    expect(eclipses / years).toBeLessThan(5);
    expect(eclipses / syzygies).toBeLessThan(0.25);
  });

  it("finds 2026's eclipses and misses the months between", () => {
    const at = (m: number, d: number) => timeOf(2026, m, d) + 0.5;
    expect(isEclipse(at(1, 17), "solar")).toBe(true);
    expect(isEclipse(at(2, 3), "lunar")).toBe(true);
    expect(isEclipse(at(7, 12), "solar")).toBe(true);
    expect(isEclipse(at(7, 28), "lunar")).toBe(true);
    expect(isEclipse(at(4, 31), "lunar")).toBe(false);
    expect(isEclipse(at(5, 15), "solar")).toBe(false);
    expect(isEclipse(at(10, 9), "solar")).toBe(false);
    // The seasons fall when the Sun is lined up with a node.
    const s = nextSeason(timeOf(2026, 3, 1));
    expect(dateOf(s).month).toBe(7);
  });
});
