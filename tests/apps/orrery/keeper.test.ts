import { describe, expect, it } from "vitest";
import { EARTH_TILT, SYNODIC, timeOf, timeOfMs, YEAR } from "../../../src/apps/orrery/astro";
import { MOON_SPEEDS, TIMING } from "../../../src/apps/orrery/config";
import {
  blendSky,
  CLAIM_GRACE_MS,
  CLAIM_TTL_MS,
  type Claim,
  createKeeper,
} from "../../../src/apps/orrery/keeper";
import { createTour } from "../../../src/apps/orrery/tour";

const CLOCK0 = Date.UTC(2026, 9, 26, 2, 0);

const claim = (over: Partial<Claim>): Claim => ({
  from: "a",
  knob: "tilt",
  a: 10,
  b: 0,
  held: true,
  since: CLOCK0,
  at: 0,
  human: true,
  ...over,
});

/** Run a keeper for `ms` in 60 Hz steps from local time `t0`. */
const run = (k: ReturnType<typeof createKeeper>, t0: number, ms: number, clock0 = CLOCK0) => {
  for (let t = t0; t <= t0 + ms; t += 1000 / 60) k.step(t, clock0 + t, 1 / 60);
  return t0 + ms;
};

describe("the keeper", () => {
  it("follows the tour on the clock until someone moves a control", () => {
    const k = createKeeper({ variant: "seasons", tilt: EARTH_TILT, speed: 1 });
    const tour = createTour("seasons", EARTH_TILT);
    run(k, 0, 500);
    expect(k.mode).toBe("tour");
    const c = CLOCK0 + 500;
    expect(k.sky(c).day).toBeCloseTo(tour.at(c).day, 9);
    expect(k.tour(c)?.caption).toBeTruthy();
    k.hear(claim({ knob: "tilt", a: 40, at: 600 }));
    k.step(600, CLOCK0 + 600, 1 / 60);
    expect(k.mode).toBe("manual");
    expect(k.sky(CLOCK0 + 600).tilt).toBe(40);
    // It took the tour's date and time, so nothing else jumped.
    expect(k.sky(CLOCK0 + 600).day).toBeCloseTo(tour.at(CLOCK0 + 600).day, 1);
    expect(k.tour(CLOCK0 + 600)).toBeNull();
  });

  it("lets the latest touch win, and a person beat a bot", () => {
    const k = createKeeper({ variant: "seasons", tilt: EARTH_TILT, speed: 1 });
    k.hear(claim({ from: "a", a: 10, since: CLOCK0, at: 0 }));
    k.hear(claim({ from: "b", a: 20, since: CLOCK0 + 50, at: 10 }));
    k.step(20, CLOCK0 + 20, 1 / 60);
    expect(k.sky(CLOCK0).tilt).toBe(20);
    // A bot touching later still loses to a person.
    k.hear(claim({ from: "c", a: 70, since: CLOCK0 + 900, at: 30, human: false }));
    k.step(40, CLOCK0 + 40, 1 / 60);
    expect(k.sky(CLOCK0).tilt).toBe(20);
    expect(k.winner("tilt", 40)?.from).toBe("b");
    // When b lets go its say lasts a little, then a's older hold (still repeating) wins again.
    k.hear(claim({ from: "b", a: 20, held: false, since: CLOCK0 + 50, at: 100 }));
    k.hear(claim({ from: "a", a: 12, since: CLOCK0, at: 100 + CLAIM_GRACE_MS }));
    k.step(101 + CLAIM_GRACE_MS, CLOCK0, 1 / 60);
    expect(k.sky(CLOCK0).tilt).toBe(12);
    // A hold whose repeats stop runs out; with only the bot left, the bot has its way.
    k.forget("a");
    k.hear(claim({ from: "c", a: 70, since: CLOCK0 + 900, at: 2 * CLAIM_GRACE_MS, human: false }));
    k.step(2 * CLAIM_GRACE_MS + 1, CLOCK0, 1 / 60);
    expect(k.sky(CLOCK0).tilt).toBe(70);
    const t = 2 * CLAIM_GRACE_MS + CLAIM_TTL_MS + CLAIM_GRACE_MS + 50;
    k.step(t, CLOCK0, 1 / 60);
    expect(k.winner("tilt", t)).toBeNull();
    expect(k.sky(CLOCK0).tilt).toBe(70);
  });

  it("holds a visitor's state, then eases back onto the tour", () => {
    const k = createKeeper({ variant: "seasons", tilt: EARTH_TILT, speed: 1 });
    const day = timeOf(2026, 5, 21);
    k.hear(claim({ knob: "time", a: day, b: 9, held: false, at: 0 }));
    k.step(0, CLOCK0, 1 / 60);
    expect(k.sky(CLOCK0)).toMatchObject({ day, hour: 9 });
    expect(k.lastHuman).toBe(0);
    let t = run(k, 1, TIMING.hold - 100);
    expect(k.mode).toBe("manual");
    // Time doesn't pass by itself in the Seasons variant.
    expect(k.sky(CLOCK0 + t).day).toBe(day);
    t = run(k, t, 300);
    expect(k.mode).toBe("ease");
    t = run(k, t, TIMING.ease + 100);
    expect(k.mode).toBe("tour");
  });

  it("lets time pass at the chosen speed in the Moon variant, except while held", () => {
    const k = createKeeper({ variant: "moon", tilt: EARTH_TILT, speed: 1 });
    const day = 10_000;
    k.hear(claim({ knob: "time", a: day, b: 21, held: false, at: 0 }));
    k.hear(claim({ knob: "speed", a: 2, held: false, at: 0 }));
    k.step(0, CLOCK0, 1 / 60);
    // While the released claim keeps its say, the date stays put.
    run(k, 1, CLAIM_GRACE_MS);
    const start = k.sky(CLOCK0).day;
    run(k, CLAIM_GRACE_MS + 2, 1000);
    expect(k.sky(CLOCK0).day - start).toBeCloseTo(MOON_SPEEDS[2], 1);
    expect(k.sky(CLOCK0).speed).toBe(2);
    k.hear(claim({ knob: "speed", a: 0, held: false, at: 5000 }));
    run(k, 5000, 1000);
    const still = k.sky(CLOCK0).day;
    run(k, 6001, 1000);
    expect(k.sky(CLOCK0).day).toBe(still);
  });

  it("eases the short way round the year or the month", () => {
    const a = { day: 100, hour: 23, tilt: 0, flat: true, speed: 1 };
    const b = { day: 100 + YEAR * 3 + 10, hour: 1, tilt: 40, flat: false, speed: 1 };
    const mid = blendSky(a, b, 0.5, "seasons");
    expect(mid.day).toBeCloseTo(105, 6);
    expect(mid.hour).toBeCloseTo(0, 6);
    expect(mid.tilt).toBeCloseTo(20, 6);
    const end = blendSky(a, b, 1, "seasons");
    expect(end.flat).toBe(false);
    const m = blendSky(a, { ...b, day: 100 + SYNODIC * 5 - 2 }, 1, "moon");
    expect(m.day).toBeCloseTo(98, 6);
  });

  it("goes back to the tour on reset, and copies what a leader says", () => {
    const k = createKeeper({ variant: "seasons", tilt: EARTH_TILT, speed: 1 });
    k.hear(claim({ a: 80, held: false, at: 0 }));
    k.step(0, CLOCK0, 1 / 60);
    k.reset(10, CLOCK0 + 10);
    expect(k.mode).toBe("ease");
    run(k, 11, TIMING.ease + 50);
    expect(k.mode).toBe("tour");
    const f = createKeeper({ variant: "seasons", tilt: EARTH_TILT, speed: 1 });
    f.adopt(
      { mode: "manual", sky: { day: 9000, hour: 7, tilt: 33, flat: false, speed: 1 }, quiet: 4000 },
      100,
    );
    expect(f.mode).toBe("manual");
    expect(f.sky(CLOCK0)).toMatchObject({ day: 9000, hour: 7, tilt: 33 });
    expect(f.lastInput).toBe(100 - 4000);
    // Taking over, it eases back to the tour on the same schedule the leader would have.
    run(f, 101, TIMING.hold - 4000 + 50);
    expect(f.mode).toBe("ease");
    f.adopt({ mode: "tour", sky: f.sky(CLOCK0), quiet: 0 }, 200_000);
    expect(f.mode).toBe("tour");
    // What it says round-trips.
    const s = k.shared(5000, CLOCK0 + 5000);
    expect(s.mode).toBe("tour");
    expect(s.sky.day).toBeCloseTo(createTour("seasons", EARTH_TILT).at(CLOCK0 + 5000).day, 9);
    expect(timeOfMs(CLOCK0)).toBeGreaterThan(0);
  });
});
