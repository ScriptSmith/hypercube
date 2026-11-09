import { describe, expect, it } from "vitest";
import { MAIN_SEQUENCE } from "../../../src/apps/gaze/physiology";
import {
  peakTime,
  peakVelocity,
  saccadeDuration,
  saccadeProfile,
} from "../../../src/apps/gaze/saccade";

const AMPS = [0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 40, 50];

/** Fastest speed and when it comes, as a fraction of the duration, sampled finely. */
const top = (amp: number) => {
  const p = saccadeProfile(amp);
  let best = 0;
  let at = 0;
  for (let i = 0; i < 2000; i++) {
    const t = (p.duration * (i + 0.5)) / 2000;
    if (p.speed(t) > best) {
      best = p.speed(t);
      at = t / p.duration;
    }
  }
  return { best, at };
};

describe("main sequence", () => {
  it("matches the measured main sequence", () => {
    // 1 degree in 28 ms at 73 deg/s, 10 in 50 ms at 400, 40 in 160 ms.
    expect(saccadeDuration(1) * 1000).toBeCloseTo(27.5, 6);
    expect(peakVelocity(1)).toBeCloseTo(72.7, 1);
    expect(saccadeDuration(10) * 1000).toBeCloseTo(50, 6);
    expect(peakVelocity(10)).toBeCloseTo(400, 6);
    expect(saccadeDuration(40) * 1000).toBeCloseTo(160, 6);
  });

  it("is linear in duration until peak speed reaches its ceiling", () => {
    for (const a of AMPS) {
      const linear = MAIN_SEQUENCE.intercept + MAIN_SEQUENCE.slope * a;
      expect(saccadeDuration(a) * 1000).toBeGreaterThanOrEqual(linear - 1e-9);
      expect(peakVelocity(a)).toBeLessThanOrEqual(MAIN_SEQUENCE.vmax + 1e-9);
    }
    expect(peakVelocity(60)).toBeCloseTo(MAIN_SEQUENCE.vmax, 6);
  });

  it("slows a tired eye", () => {
    expect(saccadeDuration(20, 0.88)).toBeGreaterThan(saccadeDuration(20));
    expect(peakVelocity(20, 0.88)).toBeLessThan(peakVelocity(20));
  });
});

describe("velocity profile", () => {
  it("starts and ends at rest and lands on target", () => {
    for (const a of AMPS) {
      const p = saccadeProfile(a);
      expect(p.at(0)).toBe(0);
      expect(p.at(p.duration)).toBe(1);
      expect(p.at(p.duration * (1 - 1e-12))).toBeCloseTo(1, 9);
      expect(p.speed(0)).toBe(0);
      expect(p.speed(p.duration)).toBe(0);
      // Gentle at both ends: under a twentieth of peak speed in the first and last 1 %.
      expect(p.speed(p.duration * 0.01)).toBeLessThan(p.peak * 0.05);
      expect(p.speed(p.duration * 0.99)).toBeLessThan(p.peak * 0.05);
    }
  });

  it("moves one way only, and its speed is the slope of its position", () => {
    for (const a of AMPS) {
      const p = saccadeProfile(a);
      let last = 0;
      for (let i = 1; i < 200; i++) {
        const t = (p.duration * i) / 200;
        const x = p.at(t);
        expect(x).toBeGreaterThanOrEqual(last);
        const h = p.duration * 1e-6;
        expect(((p.at(t + h) - p.at(t - h)) * a) / (2 * h)).toBeCloseTo(p.speed(t), 1);
        last = x;
      }
    }
  });

  it("reaches the main sequence's peak speed", () => {
    for (const a of [1, 2, 5, 10, 20, 40]) {
      expect(top(a).best / peakVelocity(a)).toBeCloseTo(1, 3);
    }
  });

  it("peaks earlier in big saccades, which slow down for longer", () => {
    expect(top(5).at).toBeCloseTo(0.45, 2);
    expect(top(30).at).toBeCloseTo(peakTime(30), 2);
    expect(top(60).at).toBeCloseTo(0.2, 2);
    expect(peakTime(30)).toBeLessThan(peakTime(10));
  });
});
