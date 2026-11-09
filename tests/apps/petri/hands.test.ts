import { describe, expect, it } from "vitest";
import { createHands, createLimiter, type HandOptions } from "../../../src/apps/petri/hands";
import { createPieces, PIECE_DEFAULTS } from "../../../src/apps/petri/pieces";

const OPTS: HandOptions = {
  radius: 260,
  ttlMs: 60_000,
  max: 12,
  pickMs: 30_000,
  perHandMs: 800,
  perSecond: 6,
  fallback: "soup",
  colors: 8,
};

describe("petri hand memory", () => {
  it("places the side's default stamp before anyone picks one", () => {
    const h = createHands(OPTS);
    expect(h.bind(500, 500, 0, 0).stamp).toBe("soup");
  });

  it("gives a pick to the next tap on that side, wherever it lands", () => {
    const h = createHands(OPTS);
    const m = h.bind(500, 500, 0, 0);
    h.pick(0, "glider", 100);
    // Near the old memory: the pick still wins over what that spot placed before.
    expect(h.bind(510, 505, 0, 200)).toBe(m);
    expect(m.stamp).toBe("glider");
  });

  it("lets neighbours keep their own stamps", () => {
    const h = createHands(OPTS);
    h.pick(0, "glider", 0);
    const a = h.bind(200, 500, 0, 10);
    h.pick(0, "ship", 20);
    const b = h.bind(1400, 500, 0, 30);
    expect(a.stamp).toBe("glider");
    expect(b.stamp).toBe("ship");
    // Each finger remembers its own: tapping again near each repeats it.
    expect(h.bind(220, 520, 0, 2000).stamp).toBe("glider");
    expect(h.bind(1380, 480, 0, 2100).stamp).toBe("ship");
    expect(a.color).not.toBe(b.color);
  });

  it("keeps sides apart", () => {
    const h = createHands(OPTS);
    h.pick(1, "bloom", 0);
    expect(h.bind(100, 100, 0, 10).stamp).toBe("soup");
    expect(h.bind(5000, 100, 1, 20).stamp).toBe("bloom");
    expect(h.current(1)).toBe("bloom");
    expect(h.current(0)).toBe("soup");
  });

  it("lets a pick lapse after a while", () => {
    const h = createHands(OPTS);
    h.pick(0, "glider", 0);
    // The swatch still shows as selected, so a new tap takes it from `current`.
    expect(h.bind(500, 500, 0, 40_000).stamp).toBe("glider");
    h.pick(0, "ship", 50_000);
    const m = h.bind(500, 500, 0, 50_100);
    expect(m.stamp).toBe("ship");
    h.pick(0, "bloom", 60_000);
    // Long after the pick, the old memory near here keeps its stamp.
    expect(h.bind(500, 500, 0, 95_000).stamp).toBe("ship");
  });

  it("forgets the oldest memories past the cap", () => {
    const h = createHands({ ...OPTS, max: 3 });
    for (let i = 0; i < 6; i++) h.bind(i * 1000, 0, 0, i);
    expect(h.list.length).toBe(3);
    expect(h.list.map((m) => m.x)).toEqual([3000, 4000, 5000]);
  });

  it("lets one finger place a stamp at most every 0.8 s", () => {
    const h = createHands(OPTS);
    const m = h.bind(500, 500, 0, 0);
    expect(h.allow(m, 0)).toBe(true);
    expect(h.allow(m, 500)).toBe(false);
    expect(h.allow(m, 799)).toBe(false);
    expect(h.allow(m, 800)).toBe(true);
  });

  it("lets the whole frame place at most six stamps a second", () => {
    const h = createHands(OPTS);
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const m = h.bind(i * 1000, 0, 0, i * 10);
      if (h.allow(m, i * 10)) ok++;
    }
    expect(ok).toBe(6);
    const later = h.bind(20_000, 0, 0, 1000);
    expect(h.allow(later, 1000)).toBe(true);
  });

  it("refills a pad's pipette after 1.5 s", () => {
    const l = createLimiter(1500);
    expect(l.take(0)).toBe(true);
    expect(l.take(1000)).toBe(false);
    expect(l.fill(750)).toBeCloseTo(0.5);
    expect(l.ready(1500)).toBe(true);
    expect(l.take(1500)).toBe(true);
  });
});

describe("petri food and salt", () => {
  it("keeps at most six pieces, recycling the oldest", () => {
    const p = createPieces();
    for (let i = 0; i < 9; i++) p.add("food", i * 700, 0, 70, i);
    expect(p.list.length).toBe(PIECE_DEFAULTS.cap);
    expect(p.list[0]!.x).toBe(3 * 700);
  });

  it("keeps pieces at least 600 venue px apart by moving the near one", () => {
    const p = createPieces();
    p.add("food", 0, 0, 70, 0);
    p.add("food", 1000, 0, 70, 1);
    p.add("salt", 300, 200, 80, 2);
    expect(p.list.map((x) => [x.kind, x.x])).toEqual([
      ["food", 1000],
      ["salt", 300],
    ]);
    for (const a of p.list) {
      for (const b of p.list) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(600);
      }
    }
  });

  it("eats food over 90 s and dissolves salt over 30 s", () => {
    const p = createPieces();
    const food = p.add("food", 0, 0, 70, 0);
    const salt = p.add("salt", 2000, 0, 80, 0);
    expect(p.left(food, 45_000)).toBeCloseTo(0.5);
    expect(p.left(salt, 15_000)).toBeCloseTo(0.5);
    p.expire(30_000);
    expect(p.list).toEqual([food]);
    p.expire(90_000);
    expect(p.list).toEqual([]);
  });
});
