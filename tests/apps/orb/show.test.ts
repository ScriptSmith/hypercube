import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import {
  CLOSE_S,
  createShow,
  FIRST_AT_S,
  HOLD_S,
  MIN_GAP_S,
  OPEN_S,
  openness,
  type Pace,
  parting,
  reveal,
  SCENES,
  SPACING,
  type Vision,
} from "../../../src/apps/orb/show";

/** The first `n` visions of a show, found by stepping time forwards as the page does. */
const visions = (pace: Pace, n: number, seed: string | number = "t"): Vision[] => {
  const show = createShow(createRng(seed), pace);
  const out: Vision[] = [];
  let t = 0;
  while (out.length < n) {
    const v = show.at(t) ?? show.next(t);
    if (out[out.length - 1]?.index !== v.index) out.push(v);
    t = v.end + 0.01;
  }
  return out;
};

describe("orb show", { timeout: 30_000 }, () => {
  it("opens the first vision a second after load, so previews show one", () => {
    const [first] = visions("often", 1);
    expect(first!.start).toBe(FIRST_AT_S);
    expect(first!.index).toBe(0);
    const show = createShow(createRng("t"), "often");
    expect(show.at(0)).toBeNull();
    expect(show.at(FIRST_AT_S + OPEN_S + 1)?.index).toBe(0);
  });

  it("spaces visions as the pace says, always with smoke alone between them", () => {
    for (const pace of ["often", "rarely"] as const) {
      const vs = visions(pace, 200, pace);
      for (let i = 1; i < vs.length; i++) {
        const a = vs[i - 1]!;
        const b = vs[i]!;
        expect(b.index).toBe(a.index + 1);
        const spacing = b.start - a.start;
        expect(spacing).toBeGreaterThanOrEqual(SPACING[pace][0] - 1e-9);
        expect(spacing).toBeLessThanOrEqual(
          Math.max(SPACING[pace][1], a.end - a.start + MIN_GAP_S) + 1e-9,
        );
        expect(b.start - a.end).toBeGreaterThanOrEqual(MIN_GAP_S - 1e-9);
      }
      const mean = (vs[vs.length - 1]!.start - vs[0]!.start) / (vs.length - 1);
      const [lo, hi] = SPACING[pace];
      expect(mean).toBeGreaterThan(lo);
      expect(mean).toBeLessThan(hi);
    }
  });

  it("holds each vision 10 to 20 s between a 5 s opening and a 6 s closing", () => {
    for (const v of visions("often", 100)) {
      expect(v.open).toBe(OPEN_S);
      expect(v.close).toBe(CLOSE_S);
      expect(v.hold).toBeGreaterThanOrEqual(HOLD_S[0]);
      expect(v.hold).toBeLessThanOrEqual(HOLD_S[1]);
      expect(v.end).toBeCloseTo(v.start + v.open + v.hold + v.close, 9);
      expect(v.seed).toBeGreaterThanOrEqual(0);
      expect(v.seed).toBeLessThan(1);
    }
  });

  it("never shows a scene twice running, and shows every scene in each round", () => {
    for (const seed of ["a", "b", "c", 7]) {
      const vs = visions("often", SCENES.length * 30, seed);
      for (let i = 1; i < vs.length; i++) expect(vs[i]!.scene).not.toBe(vs[i - 1]!.scene);
      for (let r = 0; r < 30; r++) {
        const round = vs.slice(r * SCENES.length, (r + 1) * SCENES.length).map((v) => v.scene);
        expect(new Set(round).size).toBe(SCENES.length);
      }
    }
  });

  it("is the same show for the same seed and a different one for another", () => {
    const a = visions("often", 40, "x");
    const b = visions("often", 40, "x");
    const c = visions("often", 40, "y");
    expect(b).toEqual(a);
    expect(c.map((v) => v.scene)).not.toEqual(a.map((v) => v.scene));
  });

  it("keeps no more than two visions however long it runs or however far it skips", () => {
    const show = createShow(createRng("long"), "often");
    let played = 0;
    let last = -1;
    for (let t = 0; t < 3 * 24 * 3600; t += 7) {
      const v = show.at(t);
      if (v && v.index !== last) {
        played++;
        last = v.index;
      }
      expect(show.kept).toBeLessThanOrEqual(2);
    }
    expect(played).toBeGreaterThan(3000);
    show.at(10 * 24 * 3600);
    expect(show.kept).toBeLessThanOrEqual(2);
  });

  it("opens a vision on demand only between visions, and carries on afterwards", () => {
    const show = createShow(createRng("force"), "often");
    const first = show.at(FIRST_AT_S + 2)!;
    expect(show.force(FIRST_AT_S + 2, "whale")).toBeNull();
    const t = first.end + 1;
    expect(show.at(t)).toBeNull();
    const forced = show.force(t, "whale")!;
    expect(forced.scene).toBe("whale");
    expect(forced.start).toBe(t);
    expect(forced.index).toBe(first.index + 1);
    expect(show.at(t + 1)).toBe(forced);
    const next = show.next(forced.end);
    expect(next.index).toBe(forced.index + 1);
    expect(next.scene).not.toBe("whale");
    expect(next.start - forced.end).toBeGreaterThanOrEqual(MIN_GAP_S - 1e-9);
    // With no scene asked for, the one due comes now.
    const due = show.next(next.end);
    const asked = show.force(next.end + 1);
    expect(asked?.scene).toBe(due.scene);
  });

  it("opens, holds and closes smoothly, the smoke leading the vision in and out", () => {
    const v = visions("often", 2)[1]!;
    expect(openness(v, v.start - 1)).toBe(0);
    expect(openness(v, v.start)).toBe(0);
    expect(openness(v, v.start + v.open)).toBe(1);
    expect(openness(v, v.start + v.open + v.hold)).toBe(1);
    expect(openness(v, v.end)).toBe(0);
    let prev = 0;
    for (let t = v.start; t <= v.start + v.open; t += 0.05) {
      const o = openness(v, t);
      expect(o).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(o - prev)).toBeLessThan(0.02);
      prev = o;
    }
    for (let t = v.start + v.open + v.hold; t <= v.end; t += 0.05) {
      const o = openness(v, t);
      expect(o).toBeLessThanOrEqual(prev + 1e-12);
      expect(Math.abs(o - prev)).toBeLessThan(0.02);
      prev = o;
    }
    for (let o = 0; o <= 1; o += 0.01) {
      expect(parting(o)).toBeGreaterThanOrEqual(reveal(o));
      expect(parting(o)).toBeGreaterThanOrEqual(0);
      expect(reveal(o)).toBeLessThanOrEqual(1);
    }
    expect(parting(0)).toBe(0);
    expect(reveal(0)).toBe(0);
    expect(parting(1)).toBe(1);
    expect(reveal(1)).toBe(1);
    // The vision is gone before the smoke has fully closed.
    expect(reveal(0.2)).toBe(0);
    expect(parting(0.2)).toBeGreaterThan(0.1);
  });
});
