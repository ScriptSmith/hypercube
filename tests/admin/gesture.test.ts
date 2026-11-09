import { describe, expect, it } from "vitest";
import {
  CORNER_VENUE_PX,
  createUnlockGesture,
  HOLD_MS,
  inCorner,
  type UnlockGesture,
} from "../../src/core/admin/gesture";

/** Taps in the corner, `gap` ms apart and 80 ms long, starting at `t`. Returns the end time. */
const taps = (g: UnlockGesture, n: number, t = 0, gap = 300, firstId = 1): number => {
  let now = t;
  for (let i = 0; i < n; i++) {
    g.down(firstId + i, now, true);
    g.up(firstId + i, now + 80);
    now += gap;
  }
  return now - gap + 80;
};

describe("unlock gesture", () => {
  it("unlocks after five taps and a two second hold, not before", () => {
    const g = createUnlockGesture();
    const end = taps(g, 5);
    g.down(99, end + 200, true);
    expect(g.deadline()).toBe(end + 200 + HOLD_MS);
    expect(g.check(end + 200 + HOLD_MS - 1)).toBe(false);
    expect(g.check(end + 200 + HOLD_MS)).toBe(true);
    // It starts over afterwards.
    expect(g.deadline()).toBeNull();
    expect(g.check(end + 10_000)).toBe(false);
  });

  it("fails when the hold is released early", () => {
    const g = createUnlockGesture();
    const end = taps(g, 5);
    g.down(99, end + 100, true);
    g.up(99, end + 1500);
    expect(g.deadline()).toBeNull();
    expect(g.check(end + 5000)).toBe(false);
    g.down(100, end + 1600, true);
    expect(g.deadline()).toBeNull();
  });

  it("needs all five taps within three seconds", () => {
    const g = createUnlockGesture();
    const end = taps(g, 5, 0, 800);
    g.down(99, end + 100, true);
    expect(g.deadline()).toBeNull();
  });

  it("needs the hold to follow the fifth tap promptly", () => {
    const g = createUnlockGesture();
    const end = taps(g, 5);
    g.down(99, end + 1500, true);
    expect(g.deadline()).toBeNull();
  });

  it("ignores touches outside the corner without losing count", () => {
    const g = createUnlockGesture();
    let t = 0;
    for (let i = 0; i < 5; i++) {
      g.down(50 + i, t + 10, false);
      g.down(i, t, true);
      g.up(i, t + 80);
      g.up(50 + i, t + 90);
      t += 300;
    }
    g.down(99, t, true);
    expect(g.deadline()).toBe(t + HOLD_MS);
  });

  it("does not count a long press as a tap", () => {
    const g = createUnlockGesture();
    let end = taps(g, 3);
    g.down(10, end + 100, true);
    g.up(10, end + 1200);
    end = taps(g, 1, end + 1300, 300, 20);
    g.down(99, end + 100, true);
    expect(g.deadline()).toBeNull();
  });

  it("is spoilt by a cancel or a second finger in the corner", () => {
    const g = createUnlockGesture();
    let end = taps(g, 5);
    g.down(99, end + 100, true);
    g.cancel(99);
    expect(g.deadline()).toBeNull();

    end = taps(g, 5, end + 5000, 300, 30);
    g.down(98, end + 100, true);
    g.down(97, end + 200, true);
    expect(g.deadline()).toBeNull();
    expect(g.check(end + 5000)).toBe(false);
  });

  it("works again after a failed try", () => {
    const g = createUnlockGesture();
    const first = taps(g, 2);
    const end = taps(g, 5, first + 4000, 300, 10);
    g.down(99, end + 100, true);
    expect(g.check(end + 100 + HOLD_MS)).toBe(true);
  });
});

describe("inCorner", () => {
  it("is a square of CORNER_VENUE_PX venue px at the bottom left, scaled by unit", () => {
    const frame = { height: 960, unit: 0.5 };
    const size = CORNER_VENUE_PX * 0.5;
    expect(inCorner(0, 960, frame)).toBe(true);
    expect(inCorner(size, 960 - size, frame)).toBe(true);
    expect(inCorner(size + 1, 950, frame)).toBe(false);
    expect(inCorner(10, 960 - size - 1, frame)).toBe(false);
    expect(inCorner(-1, 950, frame)).toBe(false);
  });
});
