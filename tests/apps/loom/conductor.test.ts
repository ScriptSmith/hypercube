import { describe, expect, it } from "vitest";
import { MAX_BANDS } from "../../../src/apps/loom/cloth";
import {
  ATTRACT_REST_S,
  createConductor,
  DRIFT_S,
  easeTerm,
  FREE_WEAVE_S,
  HOLD_S,
  INTRO_S,
  REST_S,
  WEAVE_S,
} from "../../../src/apps/loom/conductor";
import { matchStats, targetFor, TARGET_DEFS } from "../../../src/apps/loom/series";
import { createRng } from "../../../src/core/rng";
import { DT } from "./helpers";

const make = (n = 10, variant: "match" | "free" = "match") =>
  createConductor({ n, variant, rng: createRng("conductor") });

const run = (c: ReturnType<typeof make>, seconds: number, each?: (t: number) => void) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    each?.(i * DT);
    c.step(DT);
  }
};

describe("loom conductor", () => {
  it("eases auto harmonics to the target after the intro, and the match weaves a band", () => {
    const c = make();
    expect(c.target()!.id).toBe("square");
    run(c, INTRO_S * 0.9);
    expect(c.values.every((v) => v.amp === 0)).toBe(true);
    let matchedAt = -1;
    run(c, 30, (t) => {
      if (matchedAt < 0 && c.mode === "weave") matchedAt = t;
    });
    expect(matchedAt).toBeGreaterThan(0);
    expect(c.matches).toBeGreaterThanOrEqual(1);
    expect(c.cloth.bands.length).toBeGreaterThanOrEqual(1);
    expect(c.cloth.bands[0]!.title).toBe("Square");
    // Nobody took part: an attract band, and no people's match.
    expect(c.cloth.bands[0]!.people).toBe(false);
    expect(c.peopleMatches).toBe(0);
  });

  it("moves to the next target after the weave and the rest, and cycles about every 20 s alone", () => {
    const c = make();
    const changes: number[] = [];
    let last = c.targetIndex;
    run(c, 125, (t) => {
      if (c.targetIndex !== last) {
        changes.push(t);
        last = c.targetIndex;
      }
    });
    expect(changes.length).toBeGreaterThanOrEqual(5);
    const gaps = changes.slice(1).map((t, i) => t - changes[i]!);
    for (const g of gaps) {
      expect(g).toBeGreaterThan(14);
      expect(g).toBeLessThan(26);
    }
  });

  it("waits for a live harmonic that is wrong, then matches once it is right", () => {
    const c = make(10);
    const sq = targetFor(0, 10)!;
    // Someone holds harmonic 3 at nothing.
    run(c, 20, () => c.setLive(2, 0, 0));
    expect(c.matches).toBe(0);
    expect(c.ok[2]).toBe(false);
    expect(c.ok.filter(Boolean).length).toBe(9);
    expect(c.fill).toBeLessThan(1);
    expect(c.fill).toBeGreaterThan(0.85);
    // They set it right.
    run(c, HOLD_S + 0.5, () => c.setLive(2, sq.terms[2]!.amp, sq.terms[2]!.phase));
    expect(c.matches).toBe(1);
    expect(c.peopleMatches).toBe(1);
    expect(c.cloth.bands.at(-1)!.people).toBe(true);
  });

  it("needs every harmonic right for a whole second", () => {
    const c = make(5);
    const t = targetFor(0, 5)!;
    run(c, 20, () => {
      for (let i = 0; i < 5; i++) c.setLive(i, 0, 0);
    });
    // Right for half a second, then wrong: no match.
    run(c, HOLD_S * 0.5, () => t.terms.forEach((x, i) => c.setLive(i, x.amp, x.phase)));
    run(c, 0.5, () => c.setLive(0, 0, 0));
    expect(c.matches).toBe(0);
    run(c, HOLD_S + 0.1, () => t.terms.forEach((x, i) => c.setLive(i, x.amp, x.phase)));
    expect(c.matches).toBe(1);
  });

  it("rests briefly after a people's match and longer in attract", () => {
    expect(ATTRACT_REST_S).toBeGreaterThan(REST_S * 3);
    const timeToNext = (people: boolean) => {
      const c = make(3);
      let matchedAt = -1;
      let nextAt = -1;
      run(c, 60, (t) => {
        if (people && c.round === 0) {
          c.target()!.terms.forEach((x, i) => c.setLive(i, x.amp, x.phase));
        }
        if (matchedAt < 0 && c.mode === "weave") matchedAt = t;
        if (nextAt < 0 && c.round === 1) nextAt = t;
      });
      return nextAt - matchedAt;
    };
    expect(timeToNext(true)).toBeCloseTo(WEAVE_S + REST_S, 1);
    expect(timeToNext(false)).toBeCloseTo(WEAVE_S + ATTRACT_REST_S, 1);
  });

  it("keeps at most MAX_BANDS bands, the oldest going first", () => {
    const c = make(4);
    for (let i = 0; i < MAX_BANDS + 4; i++) {
      c.cloth.add({ values: c.values, title: "x", people: true });
    }
    expect(c.cloth.bands).toHaveLength(MAX_BANDS);
    expect(c.cloth.bands[0]!.id).toBe(5);
    expect(c.cloth.woven).toBe(MAX_BANDS + 4);
    c.cloth.clear();
    expect(c.cloth.bands).toHaveLength(0);
  });

  it("skips to the next target on admin's word, and fits a new number of harmonics", () => {
    const c = make(10);
    c.next();
    expect(c.target()!.id).toBe("sawtooth");
    expect(c.round).toBe(1);
    c.resize(2);
    expect(c.values).toHaveLength(2);
    expect(c.target()!.id).toBe("sawtooth");
    c.next();
    expect(c.target()!.id).toBe("sine");
    c.resize(1);
    expect(c.target()!.id).toBe("sine");
  });

  it("carries on from another conductor's round, target and values", () => {
    const c = make(10);
    const tri = targetFor(2, 10)!;
    c.adopt({ round: 7, target: 2, values: tri.terms });
    expect(c.round).toBe(7);
    expect(c.target()!.id).toBe("triangle");
    expect(c.values[0]!.amp).toBeCloseTo(tri.terms[0]!.amp, 9);
    run(c, HOLD_S + 0.2);
    expect(c.matches).toBe(1);
  });

  it("eases amplitude and phase separately, the short way round, at bounded speeds", () => {
    let t = { amp: 0.1, phase: 0.2 };
    const goal = { amp: 0.9, phase: 6.0 };
    let maxStep = 0;
    for (let i = 0; i < 600; i++) {
      const next = easeTerm(t, goal, DT, false);
      maxStep = Math.max(maxStep, Math.abs(next.amp - t.amp));
      t = next;
    }
    expect(t.amp).toBeCloseTo(0.9, 6);
    expect(t.phase).toBeCloseTo(6.0, 6);
    expect(maxStep).toBeLessThanOrEqual(0.3 * DT + 1e-9);
    // A goal with no amplitude leaves the phase alone.
    expect(easeTerm({ amp: 0.5, phase: 1 }, { amp: 0, phase: 3 }, DT, false).phase).toBe(1);
  });

  it("free: no target; untouched harmonics fade while someone plays, and play weaves a band", () => {
    const c = make(5, "free");
    expect(c.target()).toBeNull();
    // Nobody plays: the harmonics drift through shapes.
    run(c, DRIFT_S + 3);
    expect(c.values.some((v) => v.amp > 0.05)).toBe(true);
    const before = c.values[1]!.amp;
    run(c, 4, () => c.setLive(0, 0.7, 1));
    expect(c.values[1]!.amp).toBeLessThan(before);
    expect(c.ok.every((x) => !x)).toBe(true);
    run(c, FREE_WEAVE_S, () => c.setLive(0, 0.7, 1));
    expect(c.cloth.bands.length).toBe(1);
    expect(c.cloth.bands[0]!.people).toBe(true);
    expect(c.cloth.bands[0]!.title).toBeNull();
    run(c, WEAVE_S + 0.1, () => c.setLive(0, 0.7, 1));
    expect(c.mode).toBe("play");
  });

  it("every target can be matched by auto easing alone, for every bank size", () => {
    for (const n of [1, 2, 3, 5, 6, 8, 10]) {
      const c = make(n);
      const seen = new Set<string>();
      run(c, 200, () => {
        if (c.mode === "weave") seen.add(c.target()!.id);
      });
      const want = TARGET_DEFS.filter((_, i) => targetFor(i, n)).map((d) => d.id);
      expect([...seen].sort(), `n=${n}`).toEqual([...want].sort());
      const t = c.target()!;
      expect(matchStats(c.values, t).fill).toBeGreaterThan(0);
    }
  });
});
