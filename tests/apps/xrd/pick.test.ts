import { describe, expect, it } from "vitest";
import type { Heard } from "../../../src/apps/xrd/link";
import { createPicker, MIN_SHOW_MS } from "../../../src/apps/xrd/pick";

const heard = (slot: number, touchedAt: number, o: { person?: boolean; held?: boolean } = {}) =>
  ({
    frame: `f${slot}`,
    pos: slot,
    card: { s: slot, k: 3, v: [], a: 0, h: o.person ? 1 : 0, d: o.held ? 1 : 0, e: 0 },
    at: touchedAt,
    touchedAt,
  }) satisfies Heard;

const map = (...hs: Heard[]) => new Map(hs.map((h) => [h.card.s, h]));

describe("the big picture's pick", () => {
  it("runs the screen's own show when nothing has been touched", () => {
    const p = createPicker();
    expect(p.pick(map(heard(0, Number.NEGATIVE_INFINITY)), 1000)).toBeNull();
  });

  it("keeps a chapter at least 8 s while bots touch other frames", () => {
    const p = createPicker();
    let t = 10_000;
    expect(p.pick(map(heard(0, t)), t)?.card.s).toBe(0);
    // A bot touches another frame every second; the pick stays until 8 s have passed.
    let switched = -1;
    for (let k = 1; k <= 12 && switched < 0; k++) {
      t += 1000;
      const got = p.pick(map(heard(0, 10_000), heard(1 + (k % 3), t)), t);
      if (got?.card.s !== 0) switched = t - 10_000;
    }
    expect(switched).toBeGreaterThanOrEqual(MIN_SHOW_MS);
  });

  it("prefers the frame touched longest without a break over the latest touch", () => {
    const p = createPicker();
    let t = 0;
    // A visitor works frame 2 continuously from t = 0.
    for (; t <= 12_000; t += 500) p.pick(map(heard(2, t, { person: true, held: true })), t);
    // Another visitor taps frame 5 now and then; frame 2's long run keeps the picture.
    for (let k = 0; k < 10; k++, t += 700) {
      const got = p.pick(
        map(heard(2, t, { person: true, held: true }), heard(5, t, { person: true })),
        t,
      );
      expect(got?.card.s).toBe(2);
    }
  });

  it("lets a person take over at once from a bot's pick", () => {
    const p = createPicker();
    expect(p.pick(map(heard(0, 1000)), 1000)?.card.s).toBe(0);
    const got = p.pick(map(heard(0, 1000), heard(4, 1500, { person: true })), 1500);
    expect(got?.card.s).toBe(4);
  });
});
