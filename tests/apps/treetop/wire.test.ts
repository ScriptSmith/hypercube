import { describe, expect, it } from "vitest";
import type { Heat } from "../../../src/apps/treetop/lobby";
import {
  decodeFin,
  decodeFly,
  decodeHeat,
  decodePack,
  decodeRes,
  encodeFin,
  encodeFly,
  encodeHeat,
  encodePack,
  encodeRes,
  type Fly,
  joinedSlot,
  laneId,
  lanePos,
  laneSlot,
} from "../../../src/apps/treetop/wire";

const fly: Fly = {
  k: 29_871_192,
  pos: 3,
  count: 6,
  n: 2,
  t: 1_792_271_525_123,
  lanes: [
    {
      slot: 0,
      d: 1234.4,
      h: 812.6,
      mode: "flying",
      flap: true,
      ctrl: "human",
      adult: false,
      gates: 3,
      fin: null,
    },
    {
      slot: 1,
      d: 16_200,
      h: 900,
      mode: "finished",
      flap: false,
      ctrl: "attract",
      adult: true,
      gates: 20,
      fin: 35_120,
    },
  ],
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("wire", () => {
  it("round-trips fly reports in whole course px", () => {
    const back = decodeFly(json(encodeFly(fly)));
    expect(back).toEqual({
      ...fly,
      lanes: [{ ...fly.lanes[0], d: 1234, h: 813 }, { ...fly.lanes[1] }],
    });
  });

  it("drops bad fly reports whole", () => {
    const good = json(encodeFly(fly));
    expect(decodeFly(null)).toBe(null);
    expect(decodeFly({ ...good, p: 64 })).toBe(null);
    expect(decodeFly({ ...good, n: 9 })).toBe(null);
    expect(decodeFly({ ...good, t: "soon" })).toBe(null);
    expect(decodeFly({ ...good, L: [...good.L, [1, 0, 0, 0, 0, -1], [1, 0, 0, 0, 0, -1]] })).toBe(
      null,
    );
    expect(decodeFly({ ...good, L: [[5, 0, 0, 0, 0, -1]] })).toBe(null);
    expect(decodeFly({ ...good, L: [[0, -5, 0, 0, 0, -1]] })).toBe(null);
    expect(decodeFly({ ...good, L: [[0, 0, 0, 7, 0, -1]] })).toBe(null);
    expect(decodeFly({ ...good, L: [[0, 0, 0, 0, 0, 1.5]] })).toBe(null);
  });

  it("round-trips finishes, packs and results", () => {
    expect(decodeFin(json(encodeFin({ k: 4, lane: 13, t: 35_000.4 })))).toEqual({
      k: 4,
      lane: 13,
      t: 35_000,
    });
    const pack = {
      k: 9,
      ended: true,
      lanes: [
        { lane: 0, d: 400, mode: "out" as const, ctrl: "bot" as const, fin: null },
        { lane: 5, d: 16_200, mode: "finished" as const, ctrl: "human" as const, fin: 34_000 },
      ],
    };
    expect(decodePack(json(encodePack(pack)))).toEqual(pack);
    const res = {
      k: 9,
      places: [
        [5, 1],
        [0, 2],
      ] as [number, number][],
    };
    expect(decodeRes(json(encodeRes(res)))).toEqual(res);
    expect(decodeRes({ k: 9, r: [[5, 0]] })).toBe(null);
    expect(decodePack({ k: 9, e: 2, L: [] })).toBe(null);
    expect(decodeFin({ k: 9, l: 999, t: 1 })).toBe(null);
  });

  it("packs frame position and slot into one lane id", () => {
    expect(lanePos(laneId(7, 3))).toBe(7);
    expect(laneSlot(laneId(7, 3))).toBe(3);
    expect(laneId(1, 0)).not.toBe(laneId(0, 1));
  });

  it("carries the heat, and which lanes have joined, and checks both", () => {
    const json = (v: unknown) => JSON.parse(JSON.stringify(v));
    const heat: Heat = {
      k: 1_792_000_050,
      phase: "racing",
      since: 1_792_000_055_983,
      until: 1_792_000_085_983,
      opened: 1_792_000_044_975,
      lanes: [4, 12],
    };
    expect(decodeHeat(json(encodeHeat(heat)))).toEqual(heat);
    expect(decodeHeat({ ...json(encodeHeat(heat)), p: 9 })).toBe(null);
    expect(decodeHeat({ ...json(encodeHeat(heat)), L: [-1] })).toBe(null);
    expect(decodeHeat({ ...json(encodeHeat(heat)), s: 1.5 })).toBe(null);
    const withJoin: Fly = { ...fly, joined: 0b10, heat };
    const back = decodeFly(json(encodeFly(withJoin)))!;
    expect(back.joined).toBe(2);
    expect(joinedSlot(back.joined!, 1)).toBe(true);
    expect(joinedSlot(back.joined!, 0)).toBe(false);
    expect(back.heat).toEqual(heat);
    // Two lanes on the frame: a mask with a third bit is a bad message.
    expect(decodeFly({ ...json(encodeFly(fly)), j: 4 })).toBe(null);
    expect(decodeFly({ ...json(encodeFly(fly)), v: { k: -1 } })).toBe(null);
    expect(decodeFly(json(encodeFly(fly)))!.joined).toBeUndefined();
  });
});
