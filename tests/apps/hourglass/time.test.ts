import { describe, expect, it } from "vitest";
import {
  type Calendar,
  clockText,
  countdownTemplate,
  countdownText,
  inkAt,
  LOCAL,
  phaseAt,
  SAME_TIME_REST_MS,
  type Schedule,
  scheduleOf,
  SHORTEST_RUN_MS,
  TURN_MS,
} from "../../../src/apps/hourglass/time";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY: Schedule = { start: 9 * 60, end: 17 * 60 };

/** A local time on 12 November 2026, in the zone the tests run in. */
const at = (h: number, m = 0, s = 0, ms = 0, day = 12) =>
  new Date(2026, 10, day, h, m, s, ms).getTime();

/**
 * A zone ten hours ahead of UTC whose clocks go forward an hour at 02:00 on 4 October 2026 and
 * back at 03:00 on 4 April 2027, as a calendar the model can be given.
 */
const FORWARD = Date.UTC(2026, 9, 3, 16);
const BACK = Date.UTC(2027, 3, 3, 16);
const offsetAt = (ms: number) => (ms >= FORWARD && ms < BACK ? 11 : 10) * HOUR;
const ZONE: Calendar = {
  dayOf(ms) {
    const d = new Date(ms + offsetAt(ms));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
  },
  at(year, month, day, minutes) {
    const wall = Date.UTC(year, month, day, 0, minutes);
    // The earlier reading of a time that comes twice; a time the clocks skip moves on an hour.
    for (const offset of [11 * HOUR, 10 * HOUR]) {
      if (offsetAt(wall - offset) === offset) return wall - offset;
    }
    return wall - 10 * HOUR;
  },
};
const zoned = (month: number, day: number, h: number, m = 0, year = 2026) =>
  ZONE.at(year, month, day, h * 60 + m);

describe("hourglass time", () => {
  it("reads the two times of day from the options", () => {
    expect(scheduleOf({})).toEqual({ start: 540, end: 1020 });
    expect(scheduleOf({ starthour: 8, startminute: 30, endhour: 16, endminute: 45 })).toEqual({
      start: 510,
      end: 1005,
    });
    expect(scheduleOf({ starthour: 99, startminute: -4, endhour: "5", endminute: 12.4 })).toEqual({
      start: 23 * 60,
      end: 17 * 60 + 12,
    });
    expect(clockText(1020)).toBe("17:00");
    expect(clockText(5)).toBe("0:05");
  });

  it("runs from the start to the end, with the sand left matching the time left", () => {
    const p = phaseAt(at(13), DAY);
    expect(p.running).toBe(true);
    expect(p.startMs).toBe(at(9));
    expect(p.endMs).toBe(at(17));
    expect(p.remainingMs).toBe(4 * HOUR);
    expect(p.turn).toBe(1);
    expect(p.left).toBeCloseTo((4 * HOUR) / (8 * HOUR - TURN_MS), 9);
    expect(p.left).toBeGreaterThan(0.5);
    expect(p.left).toBeLessThan(0.5002);
    // It only ever falls.
    let last = 2;
    for (let t = at(9); t < at(17); t += 7 * MIN) {
      const left = phaseAt(t, DAY).left;
      expect(left).toBeLessThanOrEqual(last);
      last = left;
    }
  });

  it("rests with all the sand below from the end until the next start", () => {
    const evening = phaseAt(at(18), DAY);
    expect(evening.running).toBe(false);
    expect(evening.left).toBe(0);
    expect(evening.remainingMs).toBe(0);
    expect(evening.endMs).toBe(at(17));
    expect(evening.nextStartMs).toBe(at(9, 0, 0, 0, 13));
    const early = phaseAt(at(8), DAY);
    expect(early.running).toBe(false);
    expect(early.endMs).toBe(at(17, 0, 0, 0, 11));
    expect(early.nextStartMs).toBe(at(9));
  });

  it("ends exactly at the set time", () => {
    const before = phaseAt(at(17) - 1, DAY);
    expect(before.running).toBe(true);
    expect(before.remainingMs).toBe(1);
    expect(before.left).toBeGreaterThan(0);
    expect(before.left).toBeLessThan(1e-6);
    const after = phaseAt(at(17), DAY);
    expect(after.running).toBe(false);
    expect(after.left).toBe(0);
  });

  it("turns the glass over for the first seconds of a run, with nothing falling yet", () => {
    expect(phaseAt(at(9) - 1, DAY).running).toBe(false);
    const begun = phaseAt(at(9), DAY);
    expect(begun.running).toBe(true);
    expect(begun.turn).toBe(0);
    expect(begun.left).toBe(1);
    const half = phaseAt(at(9) + TURN_MS / 2, DAY);
    expect(half.turn).toBeCloseTo(0.5, 9);
    expect(half.left).toBe(1);
    const done = phaseAt(at(9) + TURN_MS, DAY);
    expect(done.turn).toBe(1);
    expect(done.left).toBe(1);
    expect(phaseAt(at(9) + TURN_MS + MIN, DAY).left).toBeLessThan(1);
  });

  it("carries a run over midnight when the end is earlier in the day than the start", () => {
    const night: Schedule = { start: 22 * 60, end: 2 * 60 };
    const late = phaseAt(at(23, 30), night);
    expect(late.running).toBe(true);
    expect(late.startMs).toBe(at(22));
    expect(late.endMs).toBe(at(2, 0, 0, 0, 13));
    expect(late.remainingMs).toBe(2.5 * HOUR);
    const small = phaseAt(at(1), night);
    expect(small.running).toBe(true);
    expect(small.startMs).toBe(at(22, 0, 0, 0, 11));
    expect(small.endMs).toBe(at(2));
    expect(small.left).toBeCloseTo(0.25, 3);
    const day = phaseAt(at(3), night);
    expect(day.running).toBe(false);
    expect(day.nextStartMs).toBe(at(22));
  });

  it("with the same start and end, runs nearly all day and rests a few minutes", () => {
    const noon: Schedule = { start: 12 * 60, end: 12 * 60 };
    const resting = phaseAt(at(12, 2), noon);
    expect(resting.running).toBe(false);
    expect(resting.endMs).toBe(at(12));
    expect(resting.nextStartMs).toBe(at(12) + SAME_TIME_REST_MS);
    const running = phaseAt(at(12, 6), noon);
    expect(running.running).toBe(true);
    expect(running.startMs).toBe(at(12) + SAME_TIME_REST_MS);
    expect(running.endMs).toBe(at(12, 0, 0, 0, 13));
    const ending = phaseAt(at(11, 59), noon);
    expect(ending.running).toBe(true);
    expect(ending.endMs).toBe(at(12));
    expect(ending.remainingMs).toBe(MIN);
  });

  it("is sound at every minute of the day for any pair of times", () => {
    for (const [start, end] of [
      [540, 1020],
      [1380, 60],
      [0, 1439],
      [1439, 0],
      [720, 720],
      [0, 0],
      [61, 60],
    ] as const) {
      for (let m = 0; m < 1440; m += 13) {
        const now = at(0, m);
        const p = phaseAt(now, { start, end });
        expect(p.startMs).toBeLessThanOrEqual(now);
        expect(p.endMs).toBeGreaterThan(p.startMs);
        expect(p.nextStartMs).toBeGreaterThan(now);
        expect(p.nextStartMs).toBeGreaterThanOrEqual(p.endMs);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.left).toBeLessThanOrEqual(1);
        expect(p.running).toBe(now < p.endMs);
        expect(p.remainingMs).toBe(p.running ? p.endMs - now : 0);
      }
    }
  });

  it("uses the display's own calendar by default", () => {
    const { year, month, day } = LOCAL.dayOf(at(15, 30));
    expect([year, month, day]).toEqual([2026, 10, 12]);
    expect(LOCAL.at(2026, 10, 12, 15 * 60 + 30)).toBe(at(15, 30));
    // A day past the end of the month is the next month's.
    expect(LOCAL.at(2026, 10, 31, 0)).toBe(new Date(2026, 11, 1).getTime());
  });

  it("keeps to the clock on the day the clocks go forward", () => {
    // A daytime run is as long as ever.
    const noon = phaseAt(zoned(9, 4, 13), DAY, ZONE);
    expect(noon.running).toBe(true);
    expect(noon.endMs - noon.startMs).toBe(8 * HOUR);
    expect(noon.remainingMs).toBe(4 * HOUR);
    // A run across the change loses the hour, and still ends when the clock says.
    const across: Schedule = { start: 60, end: 5 * 60 };
    const p = phaseAt(zoned(9, 4, 4), across, ZONE);
    expect(p.running).toBe(true);
    expect(p.endMs - p.startMs).toBe(3 * HOUR);
    expect(p.endMs).toBe(zoned(9, 4, 5));
    expect(p.remainingMs).toBe(HOUR);
    // The night before, the run over midnight is not thrown by the day being short.
    const night = phaseAt(zoned(9, 3, 23), { start: 22 * 60, end: 6 * 60 }, ZONE);
    expect(night.endMs - night.startMs).toBe(7 * HOUR);
  });

  it("copes with a start the clocks skip", () => {
    const skipped: Schedule = { start: 2 * 60 + 30, end: 3 * 60 };
    // 02:30 doesn't happen; the calendar gives 03:30, which is after the end.
    const p = phaseAt(zoned(9, 4, 3, 45), skipped, ZONE);
    expect(p.startMs).toBe(zoned(9, 4, 3, 30));
    expect(p.endMs - p.startMs).toBe(SHORTEST_RUN_MS);
    expect(p.running).toBe(false);
    expect(p.nextStartMs).toBe(zoned(9, 5, 2, 30));
    // The next day is ordinary.
    const next = phaseAt(zoned(9, 5, 2, 45), skipped, ZONE);
    expect(next.running).toBe(true);
    expect(next.endMs - next.startMs).toBe(30 * MIN);
  });

  it("keeps to the clock on the day the clocks go back", () => {
    const across: Schedule = { start: 60, end: 5 * 60 };
    const p = phaseAt(zoned(3, 4, 4, 0, 2027), across, ZONE);
    expect(p.running).toBe(true);
    expect(p.endMs - p.startMs).toBe(5 * HOUR);
    expect(p.endMs).toBe(zoned(3, 4, 5, 0, 2027));
    const noon = phaseAt(zoned(3, 4, 13, 0, 2027), DAY, ZONE);
    expect(noon.endMs - noon.startMs).toBe(8 * HOUR);
  });

  it("words the time left in hours and minutes, then minutes and seconds, then seconds", () => {
    expect(countdownText(7 * HOUR + 12 * MIN + 30_000)).toBe("7 h 12 min");
    expect(countdownText(7 * HOUR + 12 * MIN)).toBe("7 h 12 min");
    expect(countdownText(2 * HOUR)).toBe("2 h");
    expect(countdownText(HOUR)).toBe("1 h");
    expect(countdownText(HOUR - 1)).toBe("1 h");
    expect(countdownText(HOUR - 1000)).toBe("59:59");
    expect(countdownText(12 * MIN + 7000)).toBe("12:07");
    expect(countdownText(MIN)).toBe("1:00");
    expect(countdownText(59_000)).toBe("59");
    expect(countdownText(8_400)).toBe("9");
    expect(countdownText(1)).toBe("1");
    expect(countdownText(0)).toBe("1");
  });

  it("has a template at least as long as the text for every moment", () => {
    for (const ms of [1, 30_000, 59_000, MIN, 9 * MIN, HOUR - 1000, HOUR, 9 * HOUR, 23 * HOUR]) {
      expect(countdownTemplate(ms).length).toBeGreaterThanOrEqual(countdownText(ms).length);
    }
    expect(countdownTemplate(10 * HOUR + MIN)).toBe("88 h 88 min");
    expect(countdownTemplate(5 * MIN)).toBe("88:88");
    expect(countdownTemplate(5000)).toBe("88");
  });

  it("fades the lettering round the turn and at the end, with nothing sudden", () => {
    const ink = (ms: number) => inkAt(ms, phaseAt(ms, DAY));
    expect(ink(at(13))).toEqual({ time: 1, message: 1 });
    expect(ink(at(22))).toEqual({ time: 1, message: 1 });
    // Gone while the glass turns, back soon after.
    expect(ink(at(9) - 1).message).toBeLessThan(0.001);
    expect(ink(at(9) + TURN_MS / 2)).toEqual({ time: 0, message: 0 });
    expect(ink(at(9) + TURN_MS + 2000)).toEqual({ time: 1, message: 1 });
    // The count gives way to the closing line; the message stays.
    expect(ink(at(17) - 1).time).toBeLessThan(0.001);
    expect(ink(at(17) - 1).message).toBe(1);
    expect(ink(at(17) + 100)).toEqual({ time: 0, message: 1 });
    expect(ink(at(17) + 2000)).toEqual({ time: 1, message: 1 });
    // No step bigger than a fade allows from one frame to the next.
    for (const around of [at(9), at(9) + TURN_MS, at(17)]) {
      let last = ink(around - 3000);
      for (let t = around - 3000; t < around + 4000; t += 16) {
        const next = ink(t);
        expect(Math.abs(next.time - last.time)).toBeLessThan(0.08);
        expect(Math.abs(next.message - last.message)).toBeLessThan(0.08);
        last = next;
      }
    }
  });
});
