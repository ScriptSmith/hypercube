import { describe, expect, it } from "vitest";
import { decodeShip, encodeShip, type Ship, SHIP_FLAG } from "../../../src/apps/touchdown/wire";

const ship = (over: Partial<Ship> = {}): Ship => ({
  t: 123456.7,
  pos: 3,
  count: 6,
  seed: 0xdeadbeef,
  terrain: 4,
  geo: {
    kind: "panel",
    span: 1,
    width: 1080,
    height: 1920,
    adult: 0,
    child: 913.6363636363636,
    variant: "duo",
  },
  x: 512.34,
  y: 801.77,
  a: -0.4321,
  vx: 12.6,
  vy: -33.4,
  flags: SHIP_FLAG.left | SHIP_FLAG.faintRight,
  phase: "flying",
  phaseT: 7.26,
  stars: 0,
  attract: false,
  run: 17,
  wind: -9.7,
  ghost: { x: 498.2, y: 790.1, a: 0.1234, flags: 3, alpha: 0.634 },
  ...over,
});

const roundTrip = (s: Ship) => decodeShip(JSON.parse(JSON.stringify(encodeShip(s))));

describe("touchdown ship message", () => {
  it("restores a ship within its quantisation", () => {
    const s = ship();
    const d = roundTrip(s)!;
    expect(d).not.toBeNull();
    expect(Math.abs(d.x - s.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.y - s.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.a - s.a)).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(d.vx - s.vx)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.vy - s.vy)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.phaseT - s.phaseT)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(d.wind - s.wind)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.t - s.t)).toBeLessThanOrEqual(0.5);
    expect(d).toMatchObject({
      pos: 3,
      count: 6,
      seed: 0xdeadbeef,
      terrain: 4,
      flags: s.flags,
      phase: "flying",
      stars: 0,
      attract: false,
      run: 17,
    });
    // The layout inputs go unrounded, so the screen's terrain matches the frame's exactly.
    expect(d.geo).toEqual(s.geo);
    const g = d.ghost!;
    expect(Math.abs(g.x - 498.2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.a - 0.1234)).toBeLessThanOrEqual(0.0005);
    expect(g.flags).toBe(3);
    expect(Math.abs(g.alpha - 0.634)).toBeLessThanOrEqual(0.005);
  });

  it("carries landings, attract and a pair's geometry", () => {
    const d = roundTrip(
      ship({
        phase: "landed",
        stars: 3,
        attract: true,
        ghost: null,
        flags: 0,
        geo: { ...ship().geo, kind: "pair", span: 2, width: 2160, variant: "crew" },
      }),
    )!;
    expect(d).toMatchObject({ phase: "landed", stars: 3, attract: true, ghost: null });
    expect(d.geo).toMatchObject({ kind: "pair", span: 2, width: 2160, variant: "crew" });
  });

  it("wraps the angle and keeps it on the shortest side", () => {
    const d = roundTrip(ship({ a: 2 * Math.PI + 0.3 }))!;
    expect(d.a).toBeCloseTo(0.3, 3);
    const e = roundTrip(ship({ a: -Math.PI - 0.2 }))!;
    expect(e.a).toBeCloseTo(Math.PI - 0.2, 3);
  });

  it("stays small, whatever the values", () => {
    const typical = JSON.stringify(encodeShip(ship()));
    expect(typical.length).toBeLessThan(200);
    const extreme = ship({
      t: 9e12,
      pos: 63,
      count: 64,
      seed: 0xffffffff,
      terrain: 1e12,
      x: 1e9,
      y: -1e9,
      a: 1e9,
      vx: Number.POSITIVE_INFINITY,
      vy: Number.NaN,
      flags: 0xffff,
      phaseT: 1e9,
      stars: 99,
      run: 1e15,
      wind: 1e9,
      ghost: { x: 1e9, y: 1e9, a: -1e9, flags: 999, alpha: 99 },
      geo: { ...ship().geo, width: 19999.123456789, height: 19999.123456789 },
    });
    const text = JSON.stringify(encodeShip(extreme));
    expect(text.length).toBeLessThan(260);
    // Clamped values still decode.
    expect(decodeShip(JSON.parse(text))).not.toBeNull();
  });

  it("drops anything malformed or out of range", () => {
    const good = encodeShip(ship()) as Record<string, unknown>;
    const s = good.s as number[];
    const g = good.g as number[];
    const bad: unknown[] = [
      null,
      "ship",
      [],
      { ...good, p: 10 },
      { ...good, p: -1 },
      { ...good, n: 65 },
      { ...good, k: -1 },
      { ...good, k: 2 ** 33 },
      { ...good, tr: 1.5 },
      { ...good, t: "now" },
      { ...good, g: [...g, 0] },
      { ...good, g: [2, ...g.slice(1)] },
      { ...good, g: [0, 2, ...g.slice(2)] },
      { ...good, g: [g[0], g[1], 50, ...g.slice(3)] },
      { ...good, g: [...g.slice(0, 5), 99999, g[6]] },
      { ...good, s: s.slice(0, 11) },
      { ...good, s: [...s, 0] },
      { ...good, s: [Number.NaN, ...s.slice(1)] },
      { ...good, s: [s[0], 30_000, ...s.slice(2)] },
      { ...good, s: [s[0], s[1], 4000, ...s.slice(3)] },
      { ...good, s: [...s.slice(0, 5), 256, ...s.slice(6)] },
      { ...good, s: [...s.slice(0, 6), 3, ...s.slice(7)] },
      { ...good, s: [...s.slice(0, 8), 4, ...s.slice(9)] },
      { ...good, s: [...s.slice(0, 9), 2, ...s.slice(10)] },
      { ...good, h: [1, 2, 3] },
      { ...good, h: [1, 2, 3, 4, 0] },
      { ...good, h: [1, 2, 3, 40, 50] },
    ];
    for (const b of bad) expect(decodeShip(b), JSON.stringify(b)).toBeNull();
    expect(decodeShip(good)).not.toBeNull();
  });
});
