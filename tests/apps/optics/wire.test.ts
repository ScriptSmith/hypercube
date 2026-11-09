import { describe, expect, it } from "vitest";
import { MAX_HOPS } from "../../../src/apps/optics/config";
import {
  MAX_BEAMS,
  decodeCheer,
  decodeEdge,
  decodeRound,
  decodeSky,
  decodeState,
  encodeCheer,
  encodeEdge,
  encodeRound,
  encodeSky,
  encodeState,
  hopOn,
} from "../../../src/apps/optics/wire";

const json = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe("beam messages", () => {
  it("round-trip edge beams, rounded", () => {
    const beams = [
      { y: 0.123456, a: -0.523598, bits: 127, level: 0.5, hops: 0 },
      { y: 0.9, a: Math.PI, bits: 1, level: 0.06251, hops: 11 },
    ];
    const back = decodeEdge(json(encodeEdge(beams)))!;
    expect(back.length).toBe(2);
    expect(back[0]!.y).toBeCloseTo(0.1235, 4);
    expect(back[0]!.a).toBeCloseTo(-0.5236, 4);
    expect(back[1]!.bits).toBe(1);
    expect(back[1]!.hops).toBe(11);
    expect(back[1]!.level).toBeCloseTo(0.063, 3);
  });

  it("keeps at most the beam limit", () => {
    const many = Array.from({ length: 40 }, () => ({ y: 0.5, a: 0, bits: 127, level: 1, hops: 0 }));
    expect(decodeEdge(json(encodeEdge(many)))!.length).toBe(MAX_BEAMS);
  });

  it("drops anything malformed", () => {
    for (const bad of [
      null,
      [],
      { b: "x" },
      { b: [[0.5, 0, 127, 1]] },
      { b: [[1.5, 0, 127, 1, 0]] },
      { b: [[0.5, 9, 127, 1, 0]] },
      { b: [[0.5, 0, 0, 1, 0]] },
      { b: [[0.5, 0, 128, 1, 0]] },
      { b: [[0.5, 0, 127, 2, 0]] },
      { b: [[0.5, 0, 127, 1, MAX_HOPS + 1]] },
      { b: [[0.5, 0, 127, 1, 0.5]] },
      { b: Array.from({ length: MAX_BEAMS + 1 }, () => [0.5, 0, 127, 1, 0]) },
    ]) {
      expect(decodeEdge(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("round-trips sky beams with the guide mark", () => {
    const m = decodeSky(
      json(encodeSky(3, [{ x: 0.35, a: -1.4, bits: 127, level: 0.5, guide: true }], 9)),
    )!;
    expect(m.pos).toBe(3);
    expect(m.serial).toBe(9);
    expect(m.beams[0]!.guide).toBe(true);
    expect(m.beams[0]!.x).toBeCloseTo(0.35, 4);
    expect(decodeSky({ p: -1, b: [] })).toBeNull();
    expect(decodeSky({ p: 1, b: [[2, 0, 1, 1, 0]] })).toBeNull();
  });

  it("round-trips rounds, states and cheers", () => {
    expect(
      decodeRound(json(encodeRound({ serial: 12, level: 3, solved: 0b101, real: 1 }))),
    ).toEqual({
      serial: 12,
      level: 3,
      solved: 5,
      real: 1,
    });
    expect(
      decodeState(
        json(encodeState({ serial: 2, level: 1, solved: true, real: false, idle: true })),
      ),
    ).toEqual({ serial: 2, level: 1, solved: true, real: false, idle: true });
    expect(decodeCheer(json(encodeCheer({ serial: 4, finale: true })))).toEqual({
      serial: 4,
      finale: true,
    });
    expect(decodeRound({ s: -1, l: 0, f: 0, r: 0 })).toBeNull();
    expect(decodeState({ s: 1, l: 1, v: 2, r: 0, i: 0 })).toBeNull();
    expect(decodeCheer({ s: "1", f: 0 })).toBeNull();
  });
});

describe("hops", () => {
  it("counts up as light crosses a frame edge", () => {
    expect(hopOn([{ y: 0.5, a: 0, bits: 1, level: 1, hops: 0 }])[0]!.hops).toBe(1);
  });

  it("stops light bouncing between two frames", () => {
    // Two frames that each send back whatever reaches them.
    let beams = [{ y: 0.5, a: 0, bits: 127, level: 1, hops: 0 }];
    let crossings = 0;
    while (beams.length > 0 && crossings < 100) {
      beams = hopOn(decodeEdge(json(encodeEdge(beams)))!);
      crossings++;
    }
    expect(crossings).toBe(MAX_HOPS + 1);
  });
});
