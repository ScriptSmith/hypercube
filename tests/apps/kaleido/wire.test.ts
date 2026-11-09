import { describe, expect, it } from "vitest";
import {
  decodeInk,
  decodeSky,
  encodeInk,
  encodeSky,
  type InkMsg,
  MAX_FINGERS,
  type WireFinger,
} from "../../../src/apps/kaleido/wire";

const finger = (id: number, over: Partial<WireFinger> = {}): WireFinger => ({
  id,
  x: 0.1234567,
  y: 0.87654,
  vx: 1.234,
  vy: -0.567,
  rgb: 0x33aaff,
  hot: id % 2 === 0,
  human: true,
  ...over,
});

describe("ink messages", () => {
  it("survive quantisation within a pixel of a bank's screen", () => {
    const m: InkMsg = { pos: 3, count: 6, fingers: [finger(0), finger(5, { human: false })] };
    const back = decodeInk(JSON.parse(JSON.stringify(encodeInk(m))));
    expect(back).not.toBeNull();
    expect(back!.pos).toBe(3);
    expect(back!.count).toBe(6);
    back!.fingers.forEach((f, i) => {
      const g = m.fingers[i]!;
      expect(f.id).toBe(g.id);
      // 1/4095 of a 4000 px screen is about one pixel.
      expect(Math.abs(f.x - g.x)).toBeLessThanOrEqual(0.5 / 4095);
      expect(Math.abs(f.y - g.y)).toBeLessThanOrEqual(0.5 / 1023);
      expect(Math.abs(f.vx - g.vx)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(f.vy - g.vy)).toBeLessThanOrEqual(0.005);
      expect(f.rgb).toBe(g.rgb);
      expect(f.hot).toBe(g.hot);
      expect(f.human).toBe(g.human);
    });
  });

  it("are small: ten fingers in under 360 bytes of JSON", () => {
    const m: InkMsg = {
      pos: 5,
      count: 6,
      fingers: Array.from({ length: 10 }, (_, i) => finger(i)),
    };
    expect(JSON.stringify(encodeInk(m)).length).toBeLessThan(360);
    expect(JSON.stringify(encodeInk({ pos: 0, count: 1, fingers: [] })).length).toBeLessThan(30);
  });

  it("clip wild values instead of failing", () => {
    const m: InkMsg = {
      pos: 99,
      count: 99,
      fingers: [finger(99, { x: 2, y: -1, vx: 50, vy: Number.NaN, rgb: -5 })],
    };
    const back = decodeInk(encodeInk(m))!;
    expect(back.pos).toBe(15);
    expect(back.count).toBe(16);
    const f = back.fingers[0]!;
    expect([f.id, f.x, f.y, f.vx, f.vy, f.rgb]).toEqual([63, 1, 0, 4, 0, 0]);
  });

  it("carry at most MAX_FINGERS fingers", () => {
    const m: InkMsg = {
      pos: 0,
      count: 1,
      fingers: Array.from({ length: 30 }, (_, i) => finger(i)),
    };
    expect(decodeInk(encodeInk(m))!.fingers).toHaveLength(MAX_FINGERS);
  });

  it("drop anything malformed", () => {
    const good = encodeInk({ pos: 1, count: 4, fingers: [finger(1)] });
    const bad: unknown[] = [
      null,
      [],
      "ink",
      { ...good, p: 4 },
      { ...good, n: 0 },
      { ...good, n: 17 },
      { ...good, f: "x" },
      { ...good, f: good.f.slice(0, 6) },
      { ...good, f: [...good.f, ...good.f] },
      { ...good, f: good.f.map((v, i) => (i === 1 ? 5000 : v)) },
      { ...good, f: good.f.map((v, i) => (i === 3 ? 0.5 : v)) },
      { ...good, f: good.f.map((v, i) => (i === 5 ? 0x1000000 : v)) },
      { ...good, f: good.f.map((v, i) => (i === 6 ? 4 : v)) },
      { ...good, f: Array(MAX_FINGERS * 7 + 7).fill(0) },
    ];
    for (const b of bad) expect(decodeInk(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
  });
});

describe("screen beacons", () => {
  it("round-trip the kaleidoscope's parameters", () => {
    const k = { cx: -0.7234, cy: 0.2512, rot: -2.5, zoom: 1.33, mirrors: 8 };
    const back = decodeSky(
      JSON.parse(JSON.stringify(encodeSky({ side: 1, variant: "kaleido", k }))),
    )!;
    expect(back.side).toBe(1);
    expect(back.variant).toBe("kaleido");
    expect(back.k!.cx).toBeCloseTo(k.cx, 3);
    expect(back.k!.cy).toBeCloseTo(k.cy, 3);
    expect(back.k!.rot).toBeCloseTo(k.rot, 2);
    expect(back.k!.zoom).toBeCloseTo(k.zoom, 2);
    expect(back.k!.mirrors).toBe(8);
  });

  it("carry no parameters for the ink mural, and wrap turns", () => {
    expect(decodeSky(encodeSky({ side: 0, variant: "strata", k: null }))).toEqual({
      side: 0,
      variant: "strata",
      k: null,
    });
    const back = decodeSky(
      encodeSky({ side: 0, variant: "kaleido", k: { cx: 0, cy: 0, rot: 7, zoom: 1, mirrors: 7 } }),
    )!;
    expect(back.k!.rot).toBeCloseTo(7 - 2 * Math.PI, 2);
    expect(back.k!.mirrors).toBe(6);
  });

  it("drop anything malformed", () => {
    const good = encodeSky({
      side: 0,
      variant: "kaleido",
      k: { cx: 0, cy: 0, rot: 0, zoom: 1, mirrors: 6 },
    });
    const k = good.k as number[];
    const bad: unknown[] = [
      null,
      { ...good, s: 2 },
      { ...good, v: "kaleido" },
      { ...good, k: k.slice(0, 4) },
      { ...good, k: [k[0], k[1], k[2], k[3], 7] },
      { ...good, k: [50000, k[1], k[2], k[3], 6] },
      { ...good, k: [k[0], k[1], k[2], 10, 6] },
      { ...good, k: [k[0], k[1], 0.5, k[3], 6] },
    ];
    for (const b of bad) expect(decodeSky(b), JSON.stringify(b)).toBeNull();
  });
});
