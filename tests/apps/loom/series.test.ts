import { describe, expect, it } from "vitest";
import { TAU } from "../../../src/apps/loom/config";
import {
  MATCH_TOL,
  matchStats,
  nextTarget,
  phaseDelta,
  TARGET_DEFS,
  TARGET_MAX,
  targetFor,
  targetsFor,
  termError,
  valueAt,
  wrapPhase,
} from "../../../src/apps/loom/series";

const wrap = (t: number) => ((((t + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/** The shapes themselves, written down directly, for checking the series against. */
const SHAPES: Record<string, (t: number) => number> = {
  square: (t) => Math.sign(Math.sin(t)),
  // Negated, so on the scrolling wave (which runs backwards in time) it ramps up left to right.
  sawtooth: (t) => -wrap(t) / 2,
  triangle: (t) => Math.asin(Math.sin(t)),
  pulse: (t) => (Math.abs(wrap(t)) < Math.PI * 0.2 ? 1 : 0),
  bumps: (t) => Math.abs(Math.sin(t)),
  sine: (t) => Math.sin(t),
};

/** b_k and psi_k of f = sum b_k sin(k t + psi_k), by the midpoint rule. */
const numeric = (f: (t: number) => number, k: number) => {
  const m = 40_000;
  let s = 0;
  let c = 0;
  for (let i = 0; i < m; i++) {
    const t = ((i + 0.5) / m) * TAU;
    const v = f(t);
    s += v * Math.sin(k * t);
    c += v * Math.cos(k * t);
  }
  s *= 2 / m;
  c *= 2 / m;
  return { b: Math.hypot(s, c), psi: Math.atan2(c, s) };
};

describe("loom series", () => {
  for (const def of TARGET_DEFS) {
    it(`gives the textbook coefficients of the ${def.id}, up to one scale`, () => {
      const f = SHAPES[def.id]!;
      const ref = Array.from({ length: 10 }, (_, i) => numeric(f, i + 1));
      const mine = Array.from({ length: 10 }, (_, i) => def.coef(i + 1));
      const top = ref.reduce((a, r, i) => (r.b > ref[a]!.b ? i : a), 0);
      const scale = ref[top]!.b / mine[top]!.b;
      for (let i = 0; i < 10; i++) {
        const want = ref[i]!;
        const got = mine[i]!;
        expect(got.b * scale, `${def.id} k=${i + 1}`).toBeCloseTo(want.b, 3);
        if (want.b > 1e-3) {
          expect(
            Math.abs(phaseDelta(got.psi, want.psi)),
            `${def.id} k=${i + 1} phase`,
          ).toBeLessThan(1e-3);
        }
      }
    });
  }

  it("scales every target so its largest slider value is TARGET_MAX", () => {
    for (let n = 1; n <= 12; n++) {
      for (const i of targetsFor(n)) {
        const t = targetFor(i, n)!;
        expect(t.terms).toHaveLength(n);
        expect(Math.max(...t.terms.map((x) => x.amp))).toBeCloseTo(TARGET_MAX, 9);
        for (const x of t.terms) {
          expect(x.amp).toBeGreaterThanOrEqual(0);
          expect(x.amp).toBeLessThanOrEqual(1);
          expect(x.phase).toBeGreaterThanOrEqual(0);
          expect(x.phase).toBeLessThan(TAU);
        }
      }
    }
  });

  it("uses only the harmonics the setup has, and drops targets they can't make", () => {
    expect(targetsFor(1).map((i) => TARGET_DEFS[i]!.id)).toEqual(["sine"]);
    // Two harmonics: a square or triangle would be a lone sine; bumps needs the 4th.
    expect(targetsFor(2).map((i) => TARGET_DEFS[i]!.id)).toEqual(["sawtooth", "sine"]);
    expect(targetsFor(5).map((i) => TARGET_DEFS[i]!.id)).toEqual([
      "square",
      "sawtooth",
      "triangle",
      "pulse",
      "bumps",
      "sine",
    ]);
    const sq5 = targetFor(0, 5)!;
    const sq10 = targetFor(0, 10)!;
    expect(sq5.terms.map((t) => t.amp > 0)).toEqual([true, false, true, false, true]);
    expect(sq10.terms.slice(5).map((t) => t.amp > 0)).toEqual([false, true, false, true, false]);
    // Bumps has no fundamental.
    expect(targetFor(4, 10)!.terms[0]!.amp).toBe(0);
  });

  it("cycles through the targets a setup can make", () => {
    const seen = [0];
    for (let i = 0; i < 6; i++) seen.push(nextTarget(seen[seen.length - 1]!, 10));
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 0]);
    expect(nextTarget(1, 2)).toBe(5);
    expect(nextTarget(5, 2)).toBe(1);
  });

  it("makes a full slider on harmonic k a k-th of the fundamental's size", () => {
    for (let k = 1; k <= 10; k++) {
      const terms = Array.from({ length: k }, (_, i) => ({ amp: i === k - 1 ? 1 : 0, phase: 0 }));
      let peak = 0;
      for (let i = 0; i < 2000; i++) peak = Math.max(peak, valueAt(terms, (i / 2000) * TAU));
      expect(peak).toBeCloseTo(1 / k, 4);
    }
  });

  it("matches a target's own series exactly, and silence against a square wave hardly at all", () => {
    const sq = targetFor(0, 10)!;
    const exact = matchStats(sq.terms, sq);
    expect(exact.closeness).toBeCloseTo(1, 9);
    expect(exact.fill).toBe(1);
    expect(exact.all).toBe(true);
    const silent = matchStats(
      sq.terms.map(() => ({ amp: 0, phase: 0 })),
      sq,
    );
    expect(silent.closeness).toBeCloseTo(0, 9);
    expect(silent.all).toBe(false);
    expect(silent.fill).toBeLessThan(0.6);
    // A square's series against a sawtooth's is far off.
    const saw = targetFor(1, 10)!;
    expect(matchStats(sq.terms, saw).closeness).toBeLessThan(0.5);
  });

  it("waits for every harmonic, even a small one", () => {
    const tri = targetFor(2, 10)!;
    const values = tri.terms.map((t) => ({ ...t }));
    values[2] = { amp: values[2]!.amp, phase: wrapPhase(values[2]!.phase + Math.PI) };
    const s = matchStats(values, tri);
    expect(s.ok[2]).toBe(false);
    expect(s.all).toBe(false);
    // The shape is nearly there, but not done.
    expect(s.closeness).toBeGreaterThan(0.6);
    expect(s.fill).toBeLessThan(1);
    expect(s.fill).toBeGreaterThan(0.85);
  });

  it("measures a harmonic's error in slider units, amplitude and phase together", () => {
    expect(termError({ amp: 0.5, phase: 1 }, { amp: 0.5, phase: 1 })).toBeCloseTo(0, 9);
    expect(termError({ amp: 0.2, phase: 0 }, { amp: 0.5, phase: 0 })).toBeCloseTo(0.3, 9);
    expect(termError({ amp: 0.5, phase: 0 }, { amp: 0.5, phase: Math.PI })).toBeCloseTo(1, 9);
    // At no amplitude the phase doesn't matter.
    expect(termError({ amp: 0, phase: 2 }, { amp: 0, phase: 0 })).toBe(0);
    expect(MATCH_TOL).toBeGreaterThan(0.05);
    expect(MATCH_TOL).toBeLessThan(0.2);
  });
});
