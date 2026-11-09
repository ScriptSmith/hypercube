import { describe, expect, it } from "vitest";
import {
  cleanSnapshot,
  createTally,
  MAX_ORIGINS,
  originOf,
  validOrigin,
} from "../../../src/apps/ballpit/tally";

const Q = "season";

describe("tally", () => {
  it("counts a vote once however often it arrives", () => {
    const a = createTally("2026-10-18");
    const b = createTally("2026-10-18");
    const v1 = a.vote(Q, "p1", 2)!;
    const v2 = a.vote(Q, "p1", 2)!;
    expect(v2.n).toBe(2);
    expect(b.apply(Q, v1.g, "p1", 2, v1.n)).toBe(1);
    expect(b.apply(Q, v1.g, "p1", 2, v1.n)).toBe(0);
    expect(b.apply(Q, v2.g, "p1", 2, v2.n)).toBe(1);
    expect(b.apply(Q, v2.g, "p1", 2, v2.n)).toBe(0);
    expect(b.sums(Q)).toEqual([0, 0, 2, 0]);
  });

  it("catches up when a vote is lost and a later one arrives first", () => {
    const b = createTally("d");
    expect(b.apply(Q, 0, "p1", 0, 3)).toBe(3);
    expect(b.apply(Q, 0, "p1", 0, 2)).toBe(0);
    expect(b.sums(Q)).toEqual([3, 0, 0, 0]);
  });

  it("merges copies in any order to the same totals", () => {
    const a = createTally("d");
    const b = createTally("d");
    const c = createTally("d");
    for (let i = 0; i < 5; i++) a.vote(Q, "p1", i % 4);
    for (let i = 0; i < 3; i++) b.vote(Q, "p2", 1);
    c.merge(Q, a.snapshot(Q)!);
    c.merge(Q, b.snapshot(Q)!);
    c.merge(Q, a.snapshot(Q)!);
    const d = createTally("d");
    d.merge(Q, b.snapshot(Q)!);
    d.merge(Q, a.snapshot(Q)!);
    expect(c.sums(Q)).toEqual(d.sums(Q));
    expect(c.total(Q)).toBe(8);
    expect(c.merge(Q, a.snapshot(Q)!)).toEqual({ changed: false, replaced: false, stale: true });
  });

  it("knows when it has something another copy lacks", () => {
    const a = createTally("d");
    const b = createTally("d");
    a.vote(Q, "p1", 0);
    b.merge(Q, a.snapshot(Q)!);
    expect(a.ahead(Q, b.snapshot(Q)!)).toBe(false);
    a.vote(Q, "p1", 3);
    expect(a.ahead(Q, b.snapshot(Q)!)).toBe(true);
  });

  it("lets a clear win over older counts, and ignores votes from before it", () => {
    const a = createTally("d");
    const b = createTally("d");
    const old = a.vote(Q, "p1", 0)!;
    b.apply(Q, old.g, "p1", 0, old.n);
    const g = b.clear(Q, 5000);
    expect(b.total(Q)).toBe(0);
    const res = a.merge(Q, b.snapshot(Q)!);
    expect(res.replaced).toBe(true);
    expect(a.total(Q)).toBe(0);
    expect(a.gen(Q)).toBe(g);
    // A late copy of the cleared vote changes nothing.
    expect(b.apply(Q, old.g, "p1", 0, old.n)).toBe(0);
    expect(b.merge(Q, { g: 0, r: { p1: [9, 9, 9, 9] } }).stale).toBe(true);
    // New votes count from one again.
    expect(a.vote(Q, "p1", 1)).toEqual({ g, n: 1 });
  });

  it("bounds the number of frames per question", () => {
    const t = createTally("d");
    for (let i = 0; i < MAX_ORIGINS + 20; i++) t.apply(Q, 0, `f${i}`, 0, 1);
    expect(t.total(Q)).toBe(MAX_ORIGINS);
    expect(Object.keys(t.snapshot(Q)!.r).length).toBe(MAX_ORIGINS);
  });

  it("keys rows by any frame id the host gives", () => {
    for (const id of ["a-p1", "Panel 3 (left)", "ü".repeat(80), "", "x/y\\z"]) {
      expect(validOrigin(originOf(id)), id).toBe(true);
    }
    const t = createTally("d");
    expect(t.vote(Q, originOf("Panel 3 (left)"), 0)).toEqual({ g: 0, n: 1 });
  });

  it("rejects bad input", () => {
    const t = createTally("d");
    expect(t.vote("nope", "p1", 0)).toBeNull();
    expect(t.vote(Q, "p1", 9)).toBeNull();
    expect(t.vote(Q, "bad id!", 0)).toBeNull();
    expect(t.apply(Q, 0, "p1", 0, -1)).toBe(0);
    expect(t.apply(Q, 0, "p1", 0, 1.5)).toBe(0);
    expect(t.apply(Q, Number.NaN, "p1", 0, 1)).toBe(0);
    expect(cleanSnapshot(Q, { g: 0, r: { p1: [1, 2, 3] } })).toBeNull();
    expect(cleanSnapshot(Q, { g: 0, r: { p1: [1, 2, 3, -4] } })).toBeNull();
    expect(cleanSnapshot(Q, { g: 0, r: { p1: [1, 2, 3, 4] } })).toEqual({
      g: 0,
      r: { p1: [1, 2, 3, 4] },
    });
    expect(cleanSnapshot("nope", { g: 0, r: {} })).toBeNull();
  });
});
