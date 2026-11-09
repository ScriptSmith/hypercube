import { describe, expect, it } from "vitest";
import {
  decodeGust,
  decodeKites,
  decodeRing,
  decodeSky,
  decodeTangle,
  decodeWind,
  encodeGust,
  encodeKites,
  encodeRing,
  encodeSky,
  encodeTangle,
  encodeWind,
  FLAG,
  type KiteMsg,
  MAX_KITES,
} from "../../../src/apps/kites/wire";

const pairMsg = (): KiteMsg => ({
  t: 1_760_000_000_123,
  pos: 2,
  count: 3,
  kites: [0, 1, 2, 3].map((slot) => ({
    slot,
    u: 0.123456 + slot * 0.2,
    u2: 0.15 + slot * 0.2,
    x: 0.31234567 + slot * 0.05,
    y: 0.7654321 - slot * 0.1,
    spin: -0.4321 + slot,
    tension: 0.876,
    flags: FLAG.tangled | FLAG.human,
    color: slot + 2,
    shape: slot % 5,
  })),
});

describe("kite messages", () => {
  it("survive quantisation", () => {
    const m = pairMsg();
    const back = decodeKites(JSON.parse(JSON.stringify(encodeKites(m))));
    expect(back).not.toBeNull();
    expect(back!.t).toBe(m.t);
    expect(back!.pos).toBe(2);
    expect(back!.count).toBe(3);
    expect(back!.kites).toHaveLength(4);
    m.kites.forEach((k, i) => {
      const b = back!.kites[i]!;
      expect(b.slot).toBe(k.slot);
      expect(Math.abs(b.u - k.u)).toBeLessThan(0.0006);
      expect(Math.abs(b.u2 - k.u2)).toBeLessThan(0.0006);
      expect(Math.abs(b.x - k.x)).toBeLessThan(0.0001);
      expect(Math.abs(b.y - k.y)).toBeLessThan(0.0001);
      expect(Math.abs(b.spin - k.spin)).toBeLessThan(0.001);
      expect(Math.abs(b.tension - k.tension)).toBeLessThan(0.006);
      expect(b.flags).toBe(k.flags);
      expect(b.color).toBe(k.color);
      expect(b.shape).toBe(k.shape);
    });
  });

  it("stay small", () => {
    const panel = { ...pairMsg(), kites: pairMsg().kites.slice(0, 2) };
    expect(JSON.stringify(encodeKites(panel)).length).toBeLessThan(200);
    expect(JSON.stringify(encodeKites(pairMsg())).length).toBeLessThan(330);
  });

  it("clamp wild values instead of failing", () => {
    const m = pairMsg();
    m.kites[0]!.x = Number.NaN;
    m.kites[0]!.y = 99;
    m.kites[0]!.spin = 50;
    m.kites[0]!.tension = -3;
    const back = decodeKites(encodeKites(m));
    expect(back).not.toBeNull();
    expect(back!.kites[0]!.x).toBe(0);
    expect(back!.kites[0]!.y).toBeLessThanOrEqual(1.5);
    expect(Math.abs(back!.kites[0]!.spin)).toBeLessThanOrEqual(Math.PI + 0.001);
    expect(back!.kites[0]!.tension).toBe(0);
  });

  it("drop anything malformed", () => {
    const good = encodeKites(pairMsg()) as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      "kite",
      [],
      { ...good, t: -1 },
      { ...good, p: 5 },
      { ...good, n: 0 },
      { ...good, p: 1.5 },
      { ...good, k: "x" },
      { ...good, k: [[0, 1, 2]] },
      { ...good, k: [[0, 0, 0, 0, 0, 0, 0, 0, 9, 0]] },
      { ...good, k: [[99, 0, 0, 0, 0, 0, 0, 0, 0, 0]] },
      { ...good, k: [[0, 0, 0, 1e9, 0, 0, 0, 0, 0, 0]] },
      {
        ...good,
        k: [
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ],
      },
      {
        ...good,
        k: Array.from({ length: MAX_KITES + 1 }, (_, i) => [i, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      },
    ];
    for (const b of bad) expect(decodeKites(b)).toBeNull();
  });
});

describe("other messages", () => {
  it("round trip", () => {
    expect(decodeSky(encodeSky({ side: 1, delay: 412.6 }))).toEqual({ side: 1, delay: 413 });
    expect(decodeSky({ s: 2, d: 10 })).toBeNull();
    expect(decodeSky({ s: 0, d: 99999 })).toBeNull();
    const t = decodeTangle(encodeTangle({ slot: 3, on: true, x: 0.4567, y: 0.6543 }))!;
    expect(t.slot).toBe(3);
    expect(t.on).toBe(true);
    expect(Math.abs(t.x - 0.4567)).toBeLessThan(0.0001);
    expect(decodeTangle({ k: 99, o: 1, x: 0, y: 0 })).toBeNull();
    expect(decodeRing(encodeRing({ ring: 251_428_571, color: 5, t: 1_760_000_000_000 }))).toEqual({
      ring: 251_428_571,
      color: 5,
      t: 1_760_000_000_000,
    });
    expect(decodeRing({ r: -1, c: 0, t: 0 })).toBeNull();
    expect(decodeWind(encodeWind({ speed: 5.36, gusts: 9.1, from: 271.4 }))).toEqual({
      speed: 5.4,
      gusts: 9.1,
      from: 271,
    });
    expect(decodeWind({ v: 9999, g: 0, d: 0 })).toBeNull();
    expect(decodeGust(encodeGust({ t: 1234.4, dir: -3 }))).toEqual({ t: 1234, dir: -1 });
    expect(decodeGust({ t: 1, d: 0 })).toBeNull();
  });
});
