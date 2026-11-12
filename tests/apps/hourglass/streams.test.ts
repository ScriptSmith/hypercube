import { describe, expect, it } from "vitest";
import {
  flowingCount,
  RUN_SPEED,
  SETTLE_S,
  STOP_GAP_S,
  stopsBefore,
  STREAMS,
  streamsAt,
} from "../../../src/apps/hourglass/streams";
import { phaseAt, type Schedule, TURN_MS } from "../../../src/apps/hourglass/time";

const DAY: Schedule = { start: 9 * 60, end: 17 * 60 };
const START = new Date(2026, 10, 12, 9).getTime();
const END = new Date(2026, 10, 12, 17).getTime();
const at = (ms: number) => streamsAt(ms, phaseAt(ms, DAY));
/** Streams some of which is on the glass. */
const drawn = (ms: number) => at(ms).filter((s) => s.head > s.tail).length;

describe("hourglass streams", () => {
  it("run full from the collar to the heap through the day, at uneven places round the ball", () => {
    const streams = at(START + 4 * 3_600_000);
    expect(streams).toHaveLength(STREAMS);
    expect(flowingCount(streams)).toBe(STREAMS);
    for (const s of streams) {
      expect(s.strength).toBe(1);
      expect(s.tail).toBe(0);
      expect(s.head).toBeGreaterThan(Math.PI);
      expect(s.mound).toBeGreaterThan(0.5);
      expect(s.mound).toBeLessThanOrEqual(1);
    }
    const lons = streams.map((s) => s.lon).sort((a, b) => a - b);
    const gaps = lons.map((l, i) => (i ? l - lons[i - 1]! : l + 2 * Math.PI - lons.at(-1)!));
    for (const g of gaps) expect(g).toBeGreaterThan(0.6);
    // Not evenly spaced.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.2);
  });

  it("wander a little, slowly, and are the same whenever the same moment is asked for", () => {
    const t = START + 2 * 3_600_000;
    expect(at(t)).toEqual(at(t));
    let moved = 0;
    for (let i = 0; i < 600; i++) {
      const a = at(t + i * 1000);
      const b = at(t + (i + 1) * 1000);
      a.forEach((s, k) => {
        const d = Math.abs(b[k]!.lon - s.lon);
        expect(d).toBeLessThan(0.02);
        moved = Math.max(moved, Math.abs(s.lon - at(t)[k]!.lon));
      });
    }
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThan(0.4);
  });

  it("stop one by one in the last minute, the last at the set time", () => {
    expect(flowingCount(at(END - 61_000))).toBe(STREAMS);
    for (let k = 1; k < STREAMS; k++) {
      // Just after the k-th stop, counting back from the end.
      const ms = END - (STREAMS - k) * STOP_GAP_S * 1000 + 100;
      expect(flowingCount(at(ms)), `after stop ${k}`).toBe(STREAMS - k);
    }
    const last = at(END - 500);
    expect(flowingCount(last)).toBe(1);
    expect(last.find((s) => s.strength > 0)!.strength).toBeLessThan(0.05);
    expect(flowingCount(at(END))).toBe(0);
    expect(new Set(Array.from({ length: STREAMS }, (_, i) => stopsBefore(i))).size).toBe(STREAMS);
    expect(Math.min(...Array.from({ length: STREAMS }, (_, i) => stopsBefore(i)))).toBe(0);
  });

  it("thin before they stop, and what is already on the glass runs on down", () => {
    const i = Array.from({ length: STREAMS }, (_, k) => k).find((k) => stopsBefore(k) === 24)!;
    const strength = (ms: number) => at(ms)[i]!.strength;
    expect(strength(END - 40_000)).toBe(1);
    expect(strength(END - 28_000)).toBeLessThan(1);
    expect(strength(END - 28_000)).toBeGreaterThan(strength(END - 25_000));
    expect(strength(END - 24_000)).toBe(0);
    const tail = at(END - 22_000)[i]!;
    expect(tail.tail).toBeCloseTo(2 * RUN_SPEED, 6);
    expect(tail.head).toBeGreaterThan(tail.tail);
    // The last one's tail is followed down after the end, and then nothing is left.
    const last = Array.from({ length: STREAMS }, (_, k) => k).find((k) => stopsBefore(k) === 0)!;
    const ended = at(END + 1000)[last]!;
    expect(ended.strength).toBe(0);
    expect(ended.tail).toBeCloseTo(RUN_SPEED, 6);
    expect(ended.head).toBeGreaterThan(ended.tail);
    expect(drawn(END + 1000)).toBeGreaterThanOrEqual(1);
    expect(drawn(END + 20_000)).toBe(0);
  });

  it("set off down the glass once it has turned over", () => {
    expect(drawn(START + TURN_MS / 2)).toBe(0);
    expect(flowingCount(at(START + TURN_MS / 2))).toBe(0);
    expect(drawn(START + TURN_MS)).toBe(0);
    const soon = at(START + TURN_MS + 800);
    expect(soon.some((s) => s.head > 0)).toBe(true);
    expect(Math.max(...soon.map((s) => s.head))).toBeCloseTo(0.8 * RUN_SPEED, 6);
    const later = at(START + TURN_MS + 30_000);
    expect(later.every((s) => s.head > Math.PI && s.tail === 0)).toBe(true);
  });

  it("build mounds that slip now and then, and settle flat once the sand has stopped", () => {
    const heights: number[] = [];
    for (let i = 0; i < 240; i++) heights.push(at(START + 3_600_000 + i * 500)[0]!.mound);
    expect(Math.max(...heights)).toBeGreaterThan(0.95);
    expect(Math.min(...heights)).toBeLessThan(0.62);
    // A slip is quick; building back up is slow.
    const drops = heights.slice(1).map((h, i) => h - heights[i]!);
    expect(Math.min(...drops)).toBeLessThan(-0.15);
    expect(Math.max(...drops)).toBeLessThan(0.03);
    // No jump as the run ends, flat a little later, and nothing when the glass next turns.
    const before = at(END - 1);
    const after = at(END);
    before.forEach((s, i) => expect(after[i]!.mound).toBeCloseTo(s.mound, 3));
    before.forEach((s, i) => expect(after[i]!.lon).toBeCloseTo(s.lon, 4));
    expect(at(END + SETTLE_S * 1000).every((s) => s.mound === 0)).toBe(true);
    expect(at(END + 3_600_000).every((s) => s.mound === 0)).toBe(true);
    expect(at(START + 100).every((s) => s.mound === 0)).toBe(true);
  });
});
