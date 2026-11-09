import { describe, expect, it } from "vitest";
import {
  createColourCycle,
  HOUR_HUES,
  hueDistance,
  hueOf,
  luma,
  packRgb,
  paletteFor,
  unpackRgb,
} from "../../../src/apps/kaleido/palette";

const centreOf = (hour: number) => {
  // Mean hue on the circle.
  let x = 0;
  let y = 0;
  for (const c of paletteFor(hour)) {
    const a = (hueOf(c) * Math.PI) / 180;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

describe("hour palettes", () => {
  it("give every hour four related hues", () => {
    for (let h = 0; h < 24; h++) {
      const p = paletteFor(h);
      expect(p).toHaveLength(4);
      const hues = p.map(hueOf);
      for (const a of hues)
        for (const b of hues) expect(hueDistance(a, b), `hour ${h}`).toBeLessThanOrEqual(40);
      expect(new Set(p.map(packRgb)).size, `hour ${h} distinct`).toBe(4);
    }
  });

  it("are cool in the morning, gold at midday and violet in the evening", () => {
    for (const h of [7, 8, 9, 10]) {
      const c = centreOf(h);
      expect(c, `hour ${h}`).toBeGreaterThan(150);
      expect(c, `hour ${h}`).toBeLessThan(230);
    }
    for (const h of [12, 13]) {
      const c = centreOf(h);
      expect(c, `hour ${h}`).toBeGreaterThan(30);
      expect(c, `hour ${h}`).toBeLessThan(55);
    }
    for (const h of [19, 20, 21]) {
      const c = centreOf(h);
      expect(c, `hour ${h}`).toBeGreaterThan(255);
      expect(c, `hour ${h}`).toBeLessThan(300);
    }
  });

  it("change gently from hour to hour, so the day's layers read as one gradient", () => {
    for (let h = 0; h < 24; h++) {
      const step = hueDistance(HOUR_HUES[h]!, HOUR_HUES[(h + 1) % 24]!);
      expect(step, `hour ${h} to ${h + 1}`).toBeLessThanOrEqual(60);
    }
  });

  it("glow on dark water: no colour is dim, and blues are lifted", () => {
    for (let h = 0; h < 24; h++) {
      for (const c of paletteFor(h)) {
        expect(luma(c), `hour ${h}`).toBeGreaterThanOrEqual(0.36);
        expect(Math.max(...c), `hour ${h}`).toBeGreaterThan(0.85);
      }
    }
  });

  it("offers eight spread rainbow colours", () => {
    const p = paletteFor(9, "rainbow");
    expect(p).toHaveLength(8);
    expect(paletteFor(21, "rainbow")).toBe(p);
    const hues = p.map(hueOf).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i++) expect(hues[i]! - hues[i - 1]!).toBeGreaterThan(15);
  });

  it("wraps hours and caches palettes", () => {
    expect(paletteFor(25)).toBe(paletteFor(1));
    expect(paletteFor(-1)).toBe(paletteFor(23));
    expect(paletteFor(7.9)).toBe(paletteFor(7));
  });

  it("packs colours into 24 bits and back", () => {
    for (const c of [...paletteFor(3), ...paletteFor(14, "rainbow")]) {
      const back = unpackRgb(packRgb(c));
      for (let k = 0; k < 3; k++) expect(Math.abs(back[k]! - c[k]!)).toBeLessThanOrEqual(1 / 255);
    }
    expect(packRgb([2, -1, 0.5])).toBe((255 << 16) | 128);
  });
});

describe("colour cycle", () => {
  it("hands each new touch the next colour of the hour's palette", () => {
    const cycle = createColourCycle("time");
    const p = paletteFor(12);
    const got = Array.from({ length: 8 }, () => cycle.next(12));
    expect(got.slice(0, 4)).toEqual([...p]);
    expect(got.slice(4)).toEqual([...p]);
  });

  it("follows the hour as it changes", () => {
    const cycle = createColourCycle("time", 1);
    expect(cycle.next(8)).toBe(paletteFor(8)[1]);
    expect(cycle.next(9)).toBe(paletteFor(9)[2]);
    expect(createColourCycle("rainbow").next(8)).toBe(paletteFor(8, "rainbow")[0]);
  });
});
