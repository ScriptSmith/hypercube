import { describe, expect, it } from "vitest";
import { buildConditions, mixHue } from "../../../src/apps/petri/conditions";
import {
  bankSlices,
  conditionAt,
  dishFor,
  evenSlices,
  landing,
  localLanding,
} from "../../../src/apps/petri/dish";
import { CONDITION_COLUMNS } from "../../../src/apps/petri/gpu/culture";
import { SLIME_PRESETS, TURING_PRESETS } from "../../../src/apps/petri/stamps";
import { VENUE_SIZE } from "../../../src/core/frame";

const SCREEN = VENUE_SIZE.screen;
const DISH = dishFor(SCREEN.width, SCREEN.height);

describe("petri dish geometry", () => {
  it("makes the dish as large as the screen allows, with room for slice marks below", () => {
    expect(DISH.x).toBeCloseTo(SCREEN.width / 2);
    expect(DISH.y - DISH.r).toBeGreaterThan(0);
    expect(DISH.y + DISH.r).toBeLessThan(SCREEN.height - 200);
    expect(DISH.r * 2).toBeGreaterThan(SCREEN.height * 0.85);
  });

  it("lands a drop directly above where it left its panel", () => {
    // Middle of the fourth of six panels.
    const p = landing(3, 0.5, 6, 0.5, SCREEN, DISH, 100);
    expect(p.x).toBeCloseTo((3.5 / 6) * SCREEN.width);
    // The middle of a bank lands in the middle across.
    expect(landing(3, 0, 6, 0.5, SCREEN, DISH, 100).x).toBeCloseTo(SCREEN.width / 2);
  });

  it("lands a stronger flick higher", () => {
    const weak = landing(4, 0.5, 6, 0, SCREEN, DISH, 100);
    const mid = landing(4, 0.5, 6, 0.5, SCREEN, DISH, 100);
    const strong = landing(4, 0.5, 6, 1, SCREEN, DISH, 100);
    expect(weak.y).toBeGreaterThan(mid.y);
    expect(mid.y).toBeGreaterThan(strong.y);
  });

  it("keeps every landing inside the dish with room for the stamp", () => {
    const inset = 150;
    for (let pos = 0; pos < 6; pos++) {
      for (const u of [0, 0.3, 1]) {
        for (const f of [0, 0.5, 1]) {
          const p = landing(pos, u, 6, f, SCREEN, DISH, inset);
          expect(Math.hypot(p.x - DISH.x, p.y - DISH.y)).toBeLessThanOrEqual(DISH.r - inset + 1e-6);
        }
      }
    }
  });

  it("maps a pair's halves onto their own parts of the dish", () => {
    // Three pairs: the left half of the third pair is the fifth sixth of the bank.
    const p = landing(2, 0.25, 3, 0.5, SCREEN, DISH, 100);
    expect(p.x).toBeCloseTo((2.25 / 3) * SCREEN.width);
  });

  it("lands a drop in a panel's own culture when there is no screen", () => {
    const area = { x: 0, y: 0, width: 1080, height: 1000 };
    const low = localLanding(300, 0, area, 50);
    const high = localLanding(300, 1, area, 50);
    expect(low.x).toBe(300);
    expect(high.y).toBeLessThan(low.y);
    expect(high.y).toBeGreaterThanOrEqual(50);
    expect(localLanding(-100, 0.5, area, 50).x).toBe(50);
  });
});

describe("petri slices and regions", () => {
  it("gives each panel its share of the bank, and each half of a pair half of that", () => {
    const s = bankSlices(3, [1, 2, 1], (pos, pad) => pos * 10 + pad);
    expect(s.map((x) => [x.from, x.to, x.value])).toEqual([
      [0, 1 / 3, 0],
      [1 / 3, 0.5, 10],
      [0.5, 2 / 3, 11],
      [2 / 3, 1, 20],
    ]);
  });

  it("is a single condition inside a slice and blends smoothly across a border", () => {
    const slices = evenSlices([0, 3]);
    const blend = 0.04;
    expect(conditionAt(0.25, slices, blend, 1)).toEqual({ a: 0, b: 0, t: 0 });
    expect(conditionAt(0.75, slices, blend, 1)).toEqual({ a: 3, b: 3, t: 0 });
    const mid = conditionAt(0.5, slices, blend, 1);
    expect([mid.a, mid.b]).toEqual([0, 3]);
    expect(mid.t).toBeCloseTo(0.5);
    // Continuous through the border: the mix rises steadily from one side to the other.
    let last = -1;
    for (let f = 0.47; f <= 0.53; f += 0.002) {
      const c = conditionAt(f, slices, blend, 1);
      const amount = c.a === c.b ? (c.a === 3 ? 1 : 0) : c.t;
      expect(amount).toBeGreaterThanOrEqual(last - 1e-9);
      last = amount;
    }
    expect(last).toBe(1);
  });

  it("falls back to the default with no slices", () => {
    expect(conditionAt(0.3, [], 0.1, 2)).toEqual({ a: 2, b: 2, t: 0 });
  });

  it("writes slime sensor settings and reaction rates per column", () => {
    const slime = buildConditions("slime", evenSlices([0, 3]), 0.02);
    const first = SLIME_PRESETS[0]!.params;
    const last = SLIME_PRESETS[3]!.params;
    expect(slime[0]).toBeCloseTo(first.sensorAngle);
    expect(slime[2]).toBeCloseTo(first.sensorDist);
    const end = (CONDITION_COLUMNS - 1) * 4;
    expect(slime[end + 2]).toBeCloseTo(last.sensorDist);
    // Row two: deposit and decay.
    expect(slime[CONDITION_COLUMNS * 4 + 1]).toBeCloseTo(first.decay);
    const rd = buildConditions("turing", evenSlices([1]), 0.02);
    expect(rd[0]).toBeCloseTo(TURING_PRESETS[1]!.params.feed);
    expect(rd[1]).toBeCloseTo(TURING_PRESETS[1]!.params.kill);
  });

  it("lays the dish's slices out by where the dish sits under the bank", () => {
    // The dish is narrower than the bank: its left edge is already inside the second slice.
    const slices = bankSlices(6, [], (pos) => (pos < 3 ? 0 : 2));
    const world = { x: DISH.x - DISH.r, width: 2 * DISH.r };
    const cols = buildConditions(
      "turing",
      slices,
      100 / SCREEN.width,
      (f) => (world.x + f * world.width) / SCREEN.width,
    );
    const at = (venueX: number) => {
      const i = Math.floor(((venueX - world.x) / world.width) * CONDITION_COLUMNS);
      return cols[i * 4]!;
    };
    expect(at(SCREEN.width * 0.3)).toBeCloseTo(TURING_PRESETS[0]!.params.feed);
    expect(at(SCREEN.width * 0.7)).toBeCloseTo(TURING_PRESETS[2]!.params.feed);
  });

  it("mixes hues the short way round", () => {
    expect(mixHue(0.9, 0.1, 0.5)).toBeCloseTo(0);
    expect(mixHue(0.2, 0.4, 0.5)).toBeCloseTo(0.3);
  });
});
