import { describe, expect, it } from "vitest";
import { lightPupil, PUPIL, pupilOffset } from "../../../src/apps/gaze/physiology";
import { createPupil, type PupilInput } from "../../../src/apps/gaze/pupil";
import { createRng } from "../../../src/core/rng";

const STEP = 1 / 60;
const STILL: PupilInput = { luminance: 10, effort: 0, near: 0, drowsy: 0 };

/** A pupil with no unrest, settled at `input`. */
const settled = (input: PupilInput) => {
  const p = createPupil(createRng("pupil"), input);
  for (let i = 0; i < 600; i++) p.step(STEP, input);
  return p;
};

/** Seconds until the pupil has covered `share` of the way from `from` to `to`. */
const timeTo = (from: PupilInput, to: PupilInput, share: number) => {
  const p = settled(from);
  const start = p.size;
  const end = lightPupil(to.luminance) + to.effort - to.near;
  for (let i = 1; i < 60 * 20; i++) {
    p.step(STEP, to);
    if (Math.abs(p.size - start) >= share * Math.abs(end - start)) return i * STEP;
  }
  return Infinity;
};

describe("pupil", () => {
  it("is narrower in brighter light, over the published range", () => {
    let last = 9;
    for (const cd of [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000]) {
      const d = lightPupil(cd);
      expect(d).toBeLessThan(last);
      last = d;
    }
    // About 2.9 mm at 100 cd/m² and 5.1 mm at 1 cd/m² for a 60° field.
    expect(lightPupil(100)).toBeCloseTo(2.9, 1);
    expect(lightPupil(1)).toBeCloseTo(5.1, 1);
  });

  it("answers light after the reflex's latency, narrowing faster than it widens", () => {
    const dim = { ...STILL, luminance: 2 };
    const bright = { ...STILL, luminance: 200 };
    // A twin left in the dim light has the same unrest, so the gap between them is the reflex.
    const p = settled(dim);
    const twin = settled(dim);
    let moved = Infinity;
    for (let i = 1; i < 120; i++) {
      p.step(STEP, bright);
      twin.step(STEP, dim);
      if (moved === Infinity && twin.size - p.size > 0.05) moved = i * STEP;
    }
    expect(moved).toBeGreaterThanOrEqual(PUPIL.latency - STEP);
    expect(moved).toBeLessThan(PUPIL.latency + 0.25);
    const narrow = timeTo(dim, bright, 0.5);
    const widen = timeTo(bright, dim, 0.5);
    expect(narrow).toBeLessThan(widen);
    expect(narrow).toBeLessThan(1.2);
    expect(widen).toBeLessThan(6);
  });

  it("widens a little with interest and narrows for a near look", () => {
    const base = settled(STILL).target;
    expect(settled({ ...STILL, effort: 0.4 }).target).toBeCloseTo(base + 0.4, 1);
    expect(settled({ ...STILL, near: 0.4 }).target).toBeCloseTo(base - 0.4, 1);
  });

  it("never sits quite still, and swings more when drowsy", () => {
    const spread = (drowsy: number) => {
      const input = { ...STILL, drowsy };
      const p = createPupil(createRng("unrest"), input);
      let lo = 99;
      let hi = 0;
      for (let i = 0; i < 60 * 120; i++) {
        p.step(STEP, input);
        lo = Math.min(lo, p.size);
        hi = Math.max(hi, p.size);
      }
      return hi - lo;
    };
    expect(spread(0)).toBeGreaterThan(0.05);
    expect(spread(1)).toBeGreaterThan(spread(0));
  });

  it("stays between 2 and 8 mm whatever it is asked", () => {
    const p = createPupil(createRng("range"), STILL);
    for (let i = 0; i < 6000; i++) {
      const input = {
        luminance: i % 1200 < 600 ? 1e-4 : 1e5,
        effort: 2,
        near: i % 300 < 150 ? 0 : 3,
        drowsy: 1,
      };
      p.step(STEP, input);
      expect(p.size).toBeGreaterThanOrEqual(2);
      expect(p.size).toBeLessThanOrEqual(8);
    }
  });

  it("widens briefly after something sudden, peaking about a second later", () => {
    // Against a twin with the same unrest, the difference is the response alone.
    const p = settled(STILL);
    const twin = settled(STILL);
    p.pulse(0.4);
    let peak = 0;
    let peakAt = 0;
    let after2 = 0;
    for (let i = 1; i <= 60 * 4; i++) {
      p.step(STEP, STILL);
      twin.step(STEP, STILL);
      const gap = p.size - twin.size;
      if (gap > peak) {
        peak = gap;
        peakAt = i * STEP;
      }
      if (i === 60 * 2.5) after2 = gap;
    }
    expect(peak).toBeCloseTo(0.4, 1);
    expect(peakAt).toBeGreaterThan(PUPIL.pulsePeak - 0.15);
    expect(peakAt).toBeLessThan(PUPIL.pulsePeak + 0.15);
    expect(after2).toBeLessThan(0.1 * peak);
  });

  it("narrows past its new size after the light steps up, then eases back", () => {
    const bright = { ...STILL, luminance: 300 };
    const p = settled({ ...STILL, luminance: 1 });
    const settledSize = lightPupil(300);
    let least = 99;
    for (let i = 0; i < 60 * 3; i++) {
      p.step(STEP, bright);
      least = Math.min(least, p.size);
    }
    let late = 0;
    for (let i = 0; i < 60 * 15; i++) {
      p.step(STEP, bright);
      if (i >= 60 * 10) late += p.size / (60 * 5);
    }
    expect(least).toBeLessThan(settledSize - 0.3);
    expect(Math.abs(late - settledSize)).toBeLessThan(0.15);
  });

  it("swings more at middling sizes than when narrowed in bright light", () => {
    const spread = (luminance: number) => {
      const input = { ...STILL, luminance };
      const p = settled(input);
      let lo = 99;
      let hi = 0;
      for (let i = 0; i < 60 * 120; i++) {
        p.step(STEP, input);
        lo = Math.min(lo, p.size);
        hi = Math.max(hi, p.size);
      }
      return hi - lo;
    };
    expect(spread(0.5)).toBeGreaterThan(spread(500) * 1.3);
  });

  it("sits a little nasal of the iris's centre and drops as it widens", () => {
    // Bhogal-Bhamra 2015: 0.37 mm nasal and 0.07 mm up, moving down with dilation.
    const [x3, y3] = pupilOffset(3);
    const [x7, y7] = pupilOffset(7);
    expect(x3).toBeCloseTo(0.37, 5);
    expect(x7).toBeCloseTo(0.37, 5);
    expect(y3).toBeCloseTo(0.07, 5);
    expect(y7).toBeLessThan(y3);
    expect(y3 - y7).toBeLessThan(0.3);
  });
});
