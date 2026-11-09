import { describe, expect, it } from "vitest";
import {
  AIR_LAT,
  candleState,
  DRAWDOWN,
  EMBRYO_SIZE,
  PIP_IN,
  read,
  twitch,
  VEIN_REACH,
  veinDay,
} from "../../../src/apps/hatch/candling";
import { DAY_LINES, dayLine, STEP_LINES } from "../../../src/apps/hatch/captions";
import { DEG } from "../../../src/core/sphere";

const at = (day: number) => candleState(day, 0, 0);

describe("the candling days follow the published timeline", () => {
  it("shows only the yolk on day 1, a faint spot on day 2", () => {
    expect(at(1.2).embryo).toBe(0);
    expect(at(1.2).yolk).toBeGreaterThan(0.2);
    expect(read(VEIN_REACH, 1.5)).toBe(0);
    expect(at(2.6).embryo).toBeGreaterThan(0.2);
    expect(at(2.6).embryo).toBeLessThan(0.45);
  });

  it("beats the heart from day 2 and loses it after day 5", () => {
    const most = (day: number) =>
      Math.max(...[0, 0.1, 0.2, 0.3].map((s) => candleState(day, s, 0).heart));
    expect(most(1.5)).toBe(0);
    expect(most(2.5)).toBeGreaterThan(0.2);
    expect(most(6)).toBe(0);
  });

  it("spreads the veins over the yolk on days 3 to 5 and round the whole shell by day 12", () => {
    expect(read(VEIN_REACH, 3)).toBeGreaterThan(0);
    expect(read(VEIN_REACH, 3)).toBeLessThan(0.5);
    expect(read(VEIN_REACH, 5)).toBeGreaterThan(read(VEIN_REACH, 3));
    expect(read(VEIN_REACH, 12)).toBeGreaterThan(3.1);
    for (let rho = 0.05; rho < 3.1; rho += 0.1) {
      expect(veinDay(rho)).toBeGreaterThanOrEqual(2);
      expect(veinDay(rho)).toBeLessThanOrEqual(12);
      expect(veinDay(rho + 0.05)).toBeGreaterThanOrEqual(veinDay(rho));
    }
    expect(at(17).vein).toBeLessThan(at(8).vein);
  });

  it("shows the dark eye from day 4", () => {
    expect(at(3.2).eye).toBe(0);
    expect(at(4.5).eye).toBeGreaterThan(0.7);
  });

  it("twitches now and then from day 6, never before, and is often still", () => {
    for (let s = 0; s < 20; s += 0.1) expect(Math.abs(candleState(5, s, 1).turn)).toBe(0);
    let still = 0;
    let moving = 0;
    for (let s = 0; s < 60; s += 0.05) {
      if (Math.abs(twitch(s, 2)) < 1e-9) still++;
      else moving++;
    }
    expect(moving).toBeGreaterThan(0);
    expect(still).toBeGreaterThan(moving * 2);
    let most = 0;
    for (let s = 0; s < 60; s += 0.05) most = Math.max(most, Math.abs(candleState(9, s, 2).turn));
    expect(most).toBeGreaterThan(0.05);
    expect(most).toBeLessThan(0.25);
  });

  it("grows the shadow to about a third of the egg by day 9", () => {
    expect(read(EMBRYO_SIZE, 2)).toBeLessThan(0.1);
    expect(read(EMBRYO_SIZE, 9)).toBeCloseTo(Math.PI / 3, 1);
    for (let d = 1; d < 21; d += 0.5) {
      expect(read(EMBRYO_SIZE, d + 0.5)).toBeGreaterThanOrEqual(read(EMBRYO_SIZE, d));
    }
  });

  it("darkens from day 6, leaves the small end till last, and is dark but for the air cell by day 18", () => {
    expect(at(5).dark).toBe(0);
    expect(at(12).dark).toBeGreaterThan(0.5);
    expect(at(12).smallEnd).toBeGreaterThan(0.3);
    expect(at(18).dark).toBeGreaterThan(0.9);
    expect(at(18).smallEnd).toBe(0);
    expect(at(18).darkReach).toBeGreaterThan(Math.PI);
  });

  it("grows the air cell down from about 60° to about 27° by day 18, then tips it on day 19", () => {
    expect(read(AIR_LAT, 1) / DEG).toBeCloseTo(60, 6);
    expect(read(AIR_LAT, 12) / DEG).toBeCloseTo(34, 6);
    expect(read(AIR_LAT, 18) / DEG).toBeCloseTo(27, 6);
    for (let d = 1; d < 21; d += 0.25)
      expect(read(AIR_LAT, d + 0.25)).toBeLessThanOrEqual(read(AIR_LAT, d));
    expect(read(DRAWDOWN, 18)).toBe(0);
    expect(read(DRAWDOWN, 19.5)).toBeGreaterThan(10 * DEG);
  });

  it("breaks into the air cell (internal pip) on day 20", () => {
    expect(read(PIP_IN, 19.5)).toBe(0);
    expect(read(PIP_IN, 20.6)).toBe(1);
  });

  it("draws the yolk in by day 20", () => {
    expect(at(10).yolk).toBeGreaterThan(0);
    expect(at(20).yolk).toBe(0);
  });
});

describe("the captions", () => {
  const all = [...DAY_LINES, ...Object.values(STEP_LINES)];
  const banned = [
    /\bdie[sd]?\b/i,
    /\bdead\b/i,
    /\bkill/i,
    /\bstruggl/i,
    /\bfight/i,
    /blood ring/i,
    // Em and en dashes, written as escapes so this file has none itself.
    new RegExp("[\\u2014\\u2013]"),
  ];

  it("has one line for each of the 21 days, none shared", () => {
    expect(DAY_LINES).toHaveLength(21);
    expect(new Set(DAY_LINES.map((l) => l.text)).size).toBe(21);
    expect(dayLine(1).text).toBe(DAY_LINES[0]!.text);
    expect(dayLine(21.9).text).toBe(DAY_LINES[20]!.text);
    expect(dayLine(25).text).toBe(DAY_LINES[20]!.text);
  });

  it("keeps every line short, plain and in sentence case, with no full stop", () => {
    for (const l of all) {
      expect(l.text.length, l.text).toBeLessThanOrEqual(40);
      expect(l.text[0], l.text).toBe(l.text[0]!.toUpperCase());
      expect(l.text.slice(1), l.text).not.toMatch(/\b[A-Z]{2,}\b/);
      expect(l.text, l.text).not.toMatch(/[.!?]$/);
      for (const b of banned) expect(l.text, l.text).not.toMatch(b);
    }
  });

  it("gives every line a source, with a link where there is one", () => {
    for (const l of all) {
      expect(l.sources.length, l.text).toBeGreaterThan(0);
      for (const s of l.sources) {
        expect(s.cite.length).toBeGreaterThan(5);
        if (s.url) expect(s.url).toMatch(/^https:\/\//);
      }
    }
  });
});
