import { describe, expect, it } from "vitest";
import { FALL_TAU, FLY_TAU, GRAVITY_D } from "../../../src/apps/recycling/config";
import { createPace, STREAK_FULL } from "../../../src/apps/recycling/pace";
import { createPark, MAX_PARK, productOf } from "../../../src/apps/recycling/park";
import {
  arcAt,
  arcTo,
  assistThrow,
  type Fall,
  fallAt,
  fallTimeTo,
  predictCrossing,
} from "../../../src/apps/recycling/physics";
import { planCarry } from "../../../src/apps/recycling/plan";
import { chooseBin, WRONG_SHARE } from "../../../src/apps/recycling/bots";
import { kindOf, layoutOf, TOUCH_KINDS } from "./helpers";
import { createRng } from "../../../src/core/rng";

const fall: Fall = {
  t0: 0,
  x0: 100,
  y0: -1400,
  vx0: 0,
  vy0: 90,
  g: GRAVITY_D * 150,
  tau: FALL_TAU,
};

describe("recycling physics", () => {
  it("a fall is smooth, speeds up towards a terminal speed and never goes back up", () => {
    let prev = fallAt(fall, 0);
    expect(prev.y).toBe(-1400);
    for (let t = 0.01; t < 4; t += 0.01) {
      const m = fallAt(fall, t);
      expect(m.y).toBeGreaterThan(prev.y);
      expect(m.vy).toBeGreaterThanOrEqual(prev.vy - 1e-9);
      expect(m.vy).toBeLessThanOrEqual(fall.g * fall.tau + 1e-6);
      expect(m.y - prev.y).toBeLessThan(m.vy * 0.0101 + 1e-6);
      prev = m;
    }
  });

  it("finds when a fall crosses a height, so both sides agree on the moment", () => {
    const t = fallTimeTo(fall, 0)!;
    expect(t).toBeGreaterThan(1.2);
    expect(t).toBeLessThan(2.5);
    expect(fallAt(fall, t).y).toBeCloseTo(0, 3);
    // Lead time well over 300 ms of network delay.
    expect(t * 1000).toBeGreaterThan(900);
    const up: Fall = { ...fall, y0: 0, vy0: -800 };
    const tu = fallTimeTo(up, 100)!;
    expect(fallAt(up, tu).y).toBeCloseTo(100, 3);
    expect(fallTimeTo({ ...fall, g: 0.001, vy0: 0 }, 0, 2)).toBeNull();
  });

  it("an arc lands where it was aimed", () => {
    const g = 2400;
    const a = arcTo(100, 1400, 700, 1200, g, 150);
    const end = arcAt(100, 1400, a.vx, a.vy, g, a.time);
    expect(end.x).toBeCloseTo(700, 6);
    expect(end.y).toBeCloseTo(1200, 6);
    expect(a.vy).toBeLessThan(0);
  });

  it("aim assist bends a throw part of the way towards the middle of the bin it heads for", () => {
    const g = 2400;
    const mouths = [
      { x0: 0, x1: 300, y: 1000 },
      { x0: 330, x1: 630, y: 1000 },
    ];
    const start = { x: 200, y: 700, vx: 300, vy: -500 };
    const free = predictCrossing(start, mouths, g, FLY_TAU, 100)!;
    const aimed = assistThrow(start, mouths, g, FLY_TAU, 100, 0.5);
    expect(aimed.target).toBe(free.index);
    const after = predictCrossing(
      { ...start, vx: aimed.vx, vy: aimed.vy },
      mouths,
      g,
      FLY_TAU,
      100,
    )!;
    const mid = (mouths[free.index]!.x0 + mouths[free.index]!.x1) / 2;
    expect(Math.abs(after.x - mid)).toBeCloseTo(Math.abs(free.x - mid) * 0.5, -1);
    // Nothing nearby: left alone.
    const away = assistThrow({ x: 2000, y: 700, vx: 0, vy: 0 }, mouths, g, FLY_TAU, 100, 0.5);
    expect(away.vx).toBe(0);
    expect(away.target).toBeNull();
  });
});

describe("recycling pace", () => {
  it("rises with a streak of right sorts, falls back after a miss, and stays within bounds", () => {
    const p = createPace();
    for (let i = 0; i < STREAK_FULL * 3; i++) p.right();
    for (let i = 0; i < 600; i++) p.step(0.1);
    expect(p.value).toBe(1);
    p.wrong();
    for (let i = 0; i < 100; i++) p.step(0.1);
    expect(p.value).toBeLessThan(1);
    expect(p.value).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) p.wrong();
    for (let i = 0; i < 600; i++) p.step(0.1);
    expect(p.value).toBe(0);
    expect(p.streak).toBe(0);
  });

  it("eases rather than jumping, and can follow a screen's pace", () => {
    const p = createPace();
    for (let i = 0; i < STREAK_FULL; i++) p.right();
    p.step(1 / 60);
    expect(p.value).toBeLessThan(0.01);
    p.follow(0.4);
    for (let i = 0; i < 600; i++) p.step(0.1);
    expect(p.value).toBeCloseTo(0.4, 6);
    p.follow(Number.NaN);
    p.follow(9);
    for (let i = 0; i < 600; i++) p.step(0.1);
    expect(p.value).toBe(1);
  });
});

describe("recycling park", () => {
  it("makes a thing from what filled a bin", () => {
    expect(productOf("recycle", { metal: 6, plastic: 3 }, 0)).toBe("bike");
    expect(productOf("recycle", { plastic: 6, metal: 3 }, 0)).toBe("bench");
    expect(productOf("recycle", { glass: 5, paper: 4 }, 0)).toBe("jar");
    expect(productOf("recycle", { paper: 8 }, 0)).toBe("book");
    expect(productOf("compost", {}, 0)).toBe("tree");
    expect(productOf("compost", {}, 1)).toBe("flowers");
    expect(productOf("dropoff", { battery: 10 }, 3)).toBe("lamp");
    expect(productOf("rubbish", { mixed: 10 }, 0)).toBeNull();
  });

  it("holds at most its capacity; the oldest moves on", () => {
    const park = createPark();
    for (let i = 0; i < 40; i++) {
      park.add(i % 2 ? "tree" : "bike");
      park.step(0.1);
    }
    expect(park.things.length).toBe(MAX_PARK);
    expect(park.leavers.length).toBeLessThanOrEqual(MAX_PARK);
    expect(park.things.map((t) => t.slot)).toEqual([...Array(MAX_PARK).keys()]);
    for (let i = 0; i < 40; i++) park.step(0.1);
    expect(park.leavers.length).toBe(0);
    const small = createPark(4);
    for (let i = 0; i < 9; i++) small.add("lamp");
    expect(small.things.length).toBe(4);
    small.setCapacity(2);
    expect(small.things.length).toBe(2);
    small.clear();
    expect(small.things.length).toBe(0);
  });
});

describe("recycling carrying", () => {
  it("a carry path never passes down through another bin's mouth", () => {
    for (const kind of TOUCH_KINDS) {
      const L = layoutOf(kind);
      for (const target of L.bins) {
        for (const b of L.belts) {
          for (const f of [0.1, 0.5, 0.9]) {
            const from = { x: b.start + (b.end - b.start) * f, y: b.y - L.r };
            const pts = planCarry(L, from, target);
            const last = pts[pts.length - 1]!;
            expect(last.x).toBeCloseTo(target.x, 6);
            expect(last.y).toBeGreaterThan(target.top);
            for (let i = 1; i < pts.length; i++) {
              const a = pts[i - 1]!;
              const c = pts[i]!;
              for (const other of L.bins) {
                if (other === target) continue;
                const m = other.mouth;
                if (!(a.y < m.y && c.y >= m.y)) continue;
                const x = a.x + ((c.x - a.x) * (m.y - a.y)) / (c.y - a.y);
                expect(
                  x < m.x0 - L.d * 0.12 || x > m.x1 + L.d * 0.12,
                  `${kind} ${target.kind} via ${other.kind}`,
                ).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it("bots pick the right bin about nine times in ten", () => {
    const L = layoutOf("panel");
    const rng = createRng(11);
    const item = { kind: kindOf("can") } as Parameters<typeof chooseBin>[1];
    let right = 0;
    for (let i = 0; i < 2000; i++) {
      const bin = chooseBin(L, item, 0, rng.next(), rng.next());
      if (bin?.kind === "recycle") right++;
    }
    expect(right / 2000).toBeGreaterThan(1 - WRONG_SHARE - 0.03);
    expect(right / 2000).toBeLessThan(1 - WRONG_SHARE + 0.03);
  });
});
