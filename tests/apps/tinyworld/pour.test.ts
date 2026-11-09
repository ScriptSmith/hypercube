import { describe, expect, it } from "vitest";
import { E } from "../../../src/apps/tinyworld/elements";
import {
  capsuleArea,
  createHands,
  fillChance,
  type HandOptions,
} from "../../../src/apps/tinyworld/pour";

const options = (over: Partial<HandOptions> = {}): HandOptions => ({
  radius: 500,
  ttlMs: 60_000,
  max: 6,
  pickMs: 30_000,
  placeMs: 15_000,
  burst: 6,
  refill: 0.35,
  fallback: E.SAND,
  side: (x) => (x < 3000 ? 0 : 1),
  ...over,
});

const water = { type: "element", element: E.WATER } as const;
const lava = { type: "element", element: E.LAVA } as const;

describe("tinyworld hand memory", () => {
  it("pours sand where nothing has been picked", () => {
    const hands = createHands(options());
    expect(hands.bind(1500, 2000, 0).hand.element).toBe(E.SAND);
  });

  it("gives a tapped swatch to the next touch on that side, wherever it lands", () => {
    const hands = createHands(options());
    hands.pick(0, water, 0);
    expect(hands.bind(2500, 2000, 100).hand.element).toBe(E.WATER);
  });

  // The round 2 bug: the next touch bound to the memory it had been pouring from, which still
  // held the old element, because the tap was stored in a memory beside the swatch.
  it("changes the element of a spot that was already pouring something else", () => {
    const hands = createHands(options());
    const first = hands.bind(1500, 2000, 0).hand;
    hands.follow(first, 1500, 2000, 500);
    hands.pick(0, water, 1000);
    const again = hands.bind(1500, 2000, 1100);
    expect(again.hand).toBe(first);
    expect(again.hand.element).toBe(E.WATER);
  });

  it("lets a neighbour who keeps pouring keep their element", () => {
    const hands = createHands(options());
    const a = hands.bind(1000, 2000, 0).hand;
    hands.pick(0, lava, 100);
    // A is still pouring when B picks lava.
    hands.follow(a, 1000, 2000, 150);
    const b = hands.bind(2200, 2000, 200).hand;
    expect(b.element).toBe(E.LAVA);
    hands.follow(b, 2200, 2000, 250);
    expect(hands.bind(1000, 2000, 300).hand.element).toBe(E.SAND);
    expect(hands.bind(2200, 2000, 400).hand.element).toBe(E.LAVA);
  });

  it("gives every touch after a pick the new element, once spots have gone quiet", () => {
    const hands = createHands(options());
    const w = hands.bind(1000, 2000, 0).hand;
    hands.follow(w, 1000, 2000, 50);
    hands.pick(0, { type: "element", element: E.EMPTY }, 1000);
    expect(hands.bind(2000, 1800, 1100).hand.element).toBe(E.EMPTY);
    // Near the old pour spot, which nobody has used since the pick: Remove too.
    expect(hands.bind(1050, 2000, 1200).hand.element).toBe(E.EMPTY);
  });

  it("uses a pick once, then remembers it as the side's current element", () => {
    const hands = createHands(options());
    hands.pick(0, water, 0);
    expect(hands.pending(0, 10)).toEqual(water);
    hands.bind(1000, 2000, 20);
    expect(hands.pending(0, 30)).toBeNull();
    expect(hands.current(0)).toBe(E.WATER);
    // A new spot far from the first starts with what this side picked last.
    expect(hands.bind(2900, 1500, 40).hand.element).toBe(E.WATER);
  });

  it("keeps sides apart", () => {
    const hands = createHands(options());
    hands.pick(0, water, 0);
    expect(hands.bind(4000, 2000, 10).hand.element).toBe(E.SAND);
    expect(hands.pending(0, 20)).toEqual(water);
  });

  it("hands a piece or tool pick to the next touch, once, and lets it expire", () => {
    const hands = createHands(options());
    hands.pick(0, { type: "place", place: "bowl" }, 0);
    expect(hands.bind(1500, 2000, 100).place).toBe("bowl");
    expect(hands.bind(1500, 2000, 200).place).toBeNull();
    hands.pick(0, { type: "place", place: "geyser" }, 300);
    expect(hands.bind(1500, 2000, 20_000).place).toBeNull();
  });

  it("forgets memories after a while and keeps only a few", () => {
    const hands = createHands(options({ max: 3 }));
    for (let i = 0; i < 10; i++) hands.bind(i * 600, 2000, i);
    expect(hands.list.length).toBeLessThanOrEqual(3);
    hands.clear();
    expect(hands.list).toHaveLength(0);
    expect(hands.current(0)).toBe(E.SAND);
  });
});

describe("tinyworld pour rate limit", () => {
  const pour = (fingers: number, seconds: number, gapAt = -1, gapFor = 0) => {
    const hands = createHands(options());
    const h = hands.bind(1000, 2000, 0).hand;
    const dt = 1 / 60;
    let total = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const t = i * dt * 1000;
      if (gapAt >= 0 && t >= gapAt * 1000 && t < (gapAt + gapFor) * 1000) continue;
      for (let f = 0; f < fingers; f++) total += hands.spend(h, dt, t) * dt;
    }
    return total;
  };

  it("never pours faster than full rate per finger", () => {
    const hands = createHands(options());
    const h = hands.bind(1000, 2000, 0).hand;
    for (let i = 0; i < 600; i++) expect(hands.spend(h, 1 / 60, i * 16.7)).toBeLessThanOrEqual(1);
  });

  it("slows a long pour to the sustained rate", () => {
    const minute = pour(1, 60);
    expect(minute).toBeLessThan(6 + 60 * 0.35 + 1);
    expect(minute).toBeGreaterThan(60 * 0.35);
  });

  it("gives five fingers on one hand no more than one finger's sustained rate", () => {
    const one = pour(1, 120) - pour(1, 60);
    const five = pour(5, 120) - pour(5, 60);
    expect(five).toBeLessThan(one * 1.1);
  });

  it("doesn't refill the budget when a finger lifts and lands again", () => {
    expect(pour(1, 60, 30, 1)).toBeLessThan(pour(1, 60) + 1);
  });

  it("turns cells wanted into a fill chance over the stroke", () => {
    expect(fillChance(10, 100)).toBeCloseTo(0.1);
    expect(fillChance(500, 100)).toBe(1);
    expect(fillChance(5, 0)).toBe(0);
    expect(capsuleArea(0, 2)).toBeCloseTo(Math.PI * 4);
    expect(capsuleArea(10, 2)).toBeCloseTo(Math.PI * 4 + 40);
  });
});
