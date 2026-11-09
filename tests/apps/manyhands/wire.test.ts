import { describe, expect, it } from "vitest";
import {
  createSeen,
  createSequence,
  decodeBeat,
  decodeBuild,
  decodePart,
  encodeBeat,
  encodeBuild,
  encodePart,
  type PartMsg,
} from "../../../src/apps/manyhands/wire";

const part: PartMsg = {
  i: 1_800_000_000_123,
  p: 3,
  w: 1,
  l: 0,
  k: 2,
  b: 7,
  c: 5,
  u: 0.4321,
  t: 1_800_000_001_000.4,
};

describe("wire", () => {
  it("round-trips a part, rounding where it should", () => {
    const back = decodePart(JSON.parse(JSON.stringify(encodePart(part))));
    expect(back).toEqual({ ...part, u: 0.432, t: 1_800_000_001_000 });
    expect(decodePart(encodePart({ ...part, c: -1 }))?.c).toBe(-1);
  });

  it("drops malformed or out-of-range parts whole", () => {
    const good = encodePart(part) as Record<string, unknown>;
    for (const bad of [
      null,
      [],
      "x",
      { ...good, p: 64 },
      { ...good, w: -1 },
      { ...good, l: 2 },
      { ...good, k: 9 },
      { ...good, c: 8 },
      { ...good, u: 1.2 },
      { ...good, t: Number.NaN },
      { ...good, i: 1.5 },
      { ...good, b: "1" },
    ]) {
      expect(decodePart(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("round-trips a build and checks its fields", () => {
    const msg = {
      id: 4,
      theme: "robot" as const,
      total: 24,
      made: 10,
      start: 1000,
      end: 151_000,
      phase: "finishing" as const,
      orders: [0, 1, 2, 3, -1],
      trophies: 2,
    };
    expect(decodeBuild(JSON.parse(JSON.stringify(encodeBuild(msg))))).toEqual(msg);
    const enc = encodeBuild(msg) as Record<string, unknown>;
    expect(decodeBuild({ ...enc, f: 30 })).toBeNull();
    expect(decodeBuild({ ...enc, th: 9 })).toBeNull();
    expect(decodeBuild({ ...enc, o: [0, 12] })).toBeNull();
    expect(decodeBuild({ ...enc, o: Array.from({ length: 65 }, () => 0) })).toBeNull();
    expect(decodeBuild({ ...enc, e: 0 })).toBeNull();
  });

  it("round-trips a heartbeat", () => {
    const beat = { p: 9, s: 2, a: 3, g: 2 };
    expect(decodeBeat(encodeBeat(beat))).toEqual(beat);
    expect(decodeBeat({ ...beat, s: 0 })).toBeNull();
    expect(decodeBeat({ ...beat, g: 2 ** 16 })).toBeNull();
  });
});

describe("part ids", () => {
  it("only rise, and carry on above the old ones after a reload", () => {
    let wall = 1000;
    const a = createSequence(() => wall);
    const ids = [a(), a(), a()];
    expect(ids).toEqual([1000, 1001, 1002]);
    wall = 1001;
    const reloaded = createSequence(() => wall + 5);
    expect(reloaded()).toBeGreaterThan(ids[2]!);
  });

  it("deduplicate per frame with a high-water mark", () => {
    const seen = createSeen();
    expect(seen.fresh("a", 5)).toBe(true);
    expect(seen.fresh("a", 5)).toBe(false);
    expect(seen.fresh("a", 4)).toBe(false);
    expect(seen.fresh("b", 5)).toBe(true);
    expect(seen.fresh("a", 6)).toBe(true);
    expect(seen.size).toBe(2);
  });

  it("stay bounded however many frames send", () => {
    const seen = createSeen(16);
    for (let i = 0; i < 1000; i++) seen.fresh(`f${i}`, 1);
    expect(seen.size).toBe(16);
  });
});
