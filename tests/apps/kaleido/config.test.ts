import { describe, expect, it } from "vitest";
import {
  CROWD_INK,
  crowdClear,
  crowdFactor,
  gridFor,
  readConfig,
  tuningFor,
} from "../../../src/apps/kaleido/config";
import { hourLabel } from "../../../src/apps/kaleido/labels";
import { VENUE_SIZE } from "../../../src/core/frame";

const WALL = VENUE_SIZE.wall;
const PANEL = VENUE_SIZE.panel;
const SCREEN = VENUE_SIZE.screen;

describe("options", () => {
  it("default to the ink mural, time-of-day colours, layers on and six mirrors", () => {
    expect(readConfig("", {})).toEqual({
      variant: "strata",
      colours: "time",
      strata: true,
      mirrors: 6,
    });
    expect(readConfig("kaleido", { colours: "rainbow", strata: false, mirrors: "12" })).toEqual({
      variant: "kaleido",
      colours: "rainbow",
      strata: false,
      mirrors: 12,
    });
    expect(readConfig("nope", { mirrors: "7", colours: "plaid" }).mirrors).toBe(6);
  });
});

describe("fluid grid", () => {
  it("uses about a sixth of the venue's resolution on venue hardware", () => {
    const g = gridFor(WALL, WALL, false);
    expect(g.cell).toBe(6);
    expect(WALL.width / g.cell).toBeLessThanOrEqual(1100);
    const s = gridFor(SCREEN, SCREEN, false);
    expect(s.cell).toBe(6);
    expect(g.dyeScale).toBe(2);
  });

  it("follows res and is coarser on a software rasteriser", () => {
    const full = gridFor(PANEL, PANEL, false);
    const half = gridFor(PANEL, { width: 540, height: 960 }, false);
    expect(half.cell).toBeCloseTo(full.cell * 2);
    const soft = gridFor(PANEL, PANEL, true);
    expect(soft.cell).toBeGreaterThan(full.cell);
    expect(soft.iterations).toBeLessThan(full.iterations);
  });

  it("keeps at least 40 cells across the short side however small the canvas", () => {
    for (const v of [WALL, PANEL, SCREEN]) {
      const g = gridFor(v, { width: 40, height: 40 }, true);
      expect(Math.min(v.width, v.height) / g.cell).toBeGreaterThanOrEqual(40 - 1e-9);
    }
  });
});

describe("tuning", () => {
  it("makes adult-band ink hotter and faster than child-band ink everywhere", () => {
    for (const k of ["wall", "panel", "pair", "screen"] as const) {
      const t = tuningFor(k);
      expect(t.hot).toBeGreaterThan(t.warm);
      expect(t.jetHot).toBeGreaterThan(t.jetWarm);
      expect(t.layerZone).toBeGreaterThan(0.1);
      expect(t.layerZone).toBeLessThanOrEqual(0.25);
    }
  });

  it("returns a fresh copy each time, so debugging one frame can't change another", () => {
    expect(tuningFor("wall").physics).not.toBe(tuningFor("wall").physics);
  });
});

describe("crowd governor", () => {
  it("leaves ink alone until the frame is busy, then shortens its life", () => {
    expect(crowdFactor(0)).toBe(1);
    expect(crowdFactor(CROWD_INK)).toBe(1);
    expect(crowdFactor(CROWD_INK * 2)).toBeCloseTo(0.25);
    expect(crowdFactor(CROWD_INK * 4)).toBeLessThan(crowdFactor(CROWD_INK * 2));
    expect(crowdFactor(100)).toBeGreaterThan(0);
    expect(crowdFactor(Number.NaN)).toBe(1);
  });

  it("clears faint ink only once the frame gets busy", () => {
    expect(crowdClear(0)).toBe(0);
    expect(crowdClear(CROWD_INK * 0.3)).toBe(0);
    expect(crowdClear(CROWD_INK * 0.7)).toBeCloseTo(0.5);
    expect(crowdClear(CROWD_INK)).toBe(1);
    expect(crowdClear(CROWD_INK * 5)).toBe(1);
    expect(crowdClear(Number.NaN)).toBe(0);
  });
});

describe("hour marks", () => {
  it("read as plain 12-hour times", () => {
    expect([0, 9, 12, 15, 23, 24].map(hourLabel)).toEqual([
      "12 am",
      "9 am",
      "12 pm",
      "3 pm",
      "11 pm",
      "12 am",
    ]);
  });
});
