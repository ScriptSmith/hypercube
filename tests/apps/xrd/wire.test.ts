import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../../../src/apps/xrd/chapters";
import { checkState } from "../../../src/apps/xrd/chapter";
import { CHAPTER_IDS } from "../../../src/apps/xrd/ids";
import { checkChapter } from "../../../src/apps/xrd/link";
import {
  ageOf,
  decodeBeacon,
  decodeState,
  encodeBeacon,
  encodeState,
  type CardMsg,
} from "../../../src/apps/xrd/wire";

const card = (over: Partial<CardMsg> = {}): CardMsg => ({
  s: 3,
  k: CHAPTER_IDS.indexOf("bragg"),
  v: [...CHAPTERS.bragg.start],
  a: 1200,
  h: 1,
  d: 0,
  e: 0,
  ...over,
});

describe("messages", () => {
  it("round-trips a state and a beacon", () => {
    const m = encodeState(4, [
      card(),
      card({ s: 4, k: 5, v: [...CHAPTERS.patterns.start], a: -1, h: 0, e: 1 }),
    ]);
    const back = decodeState(JSON.parse(JSON.stringify(m)), checkChapter);
    expect(back).toEqual(m);
    expect(decodeBeacon(JSON.parse(JSON.stringify(encodeBeacon(1))))).toEqual({ s: 1 });
  });

  it("reads a frame that sends no earned bit as not yet earned", () => {
    const { e: _, ...old } = card();
    const back = decodeState({ p: 1, c: [old] }, checkChapter);
    expect(back?.c[0]?.e).toBe(0);
  });

  it("drops malformed messages whole", () => {
    const good = encodeState(1, [card()]);
    const bad: unknown[] = [
      null,
      "x",
      [],
      { ...good, p: -1 },
      { ...good, p: 1.5 },
      { ...good, c: [] },
      { ...good, c: [card(), card(), card()] },
      { ...good, c: [{ ...card(), k: 99 }] },
      { ...good, c: [{ ...card(), v: [1, 2] }] },
      { ...good, c: [{ ...card(), v: [99999, 234, 0, 1] }] },
      { ...good, c: [{ ...card(), v: ["80", 234, 0, 1] }] },
      { ...good, c: [{ ...card(), h: 2 }] },
      { ...good, c: [{ ...card(), e: 2 }] },
      { ...good, c: [{ ...card(), e: "1" }] },
      { ...good, c: [{ ...card(), a: -5 }] },
      { ...good, c: [{ ...card(), a: 1e12 }] },
      { ...good, c: [{ ...card(), s: 500 }] },
      { ...good, c: [{ ...card(), v: Array.from({ length: 20 }, () => 0) }] },
    ];
    for (const b of bad) expect(decodeState(b, checkChapter), JSON.stringify(b)).toBeNull();
    expect(decodeBeacon({ s: 2 })).toBeNull();
    expect(decodeBeacon({})).toBeNull();
  });

  it("checks every chapter's start state against its own ranges", () => {
    for (const id of CHAPTER_IDS) {
      const def = CHAPTERS[id];
      expect(checkState(def, [...def.start]), id).not.toBeNull();
      expect(def.state.length, id).toBeLessThanOrEqual(8);
      if (def.play)
        for (const t of [0, 3.3, 17, 400])
          expect(checkState(def, [...def.play(t)]), `${id} ${t}`).not.toBeNull();
    }
  });

  it("sends ages in steps of 100 ms", () => {
    expect(ageOf(1249)).toBe(1200);
    expect(ageOf(Number.POSITIVE_INFINITY)).toBe(-1);
    expect(ageOf(1e9)).toBe(600_000);
  });
});
