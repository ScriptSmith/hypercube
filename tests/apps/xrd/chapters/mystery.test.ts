import { describe, expect, it } from "vitest";
import {
  alIndexing,
  apart,
  APART,
  curve,
  decode,
  encode,
  fingerprint,
  MAX_ROUND,
  nextRound,
  ORDER,
  peaks,
  pick,
  playAt,
  roundOf,
  SAMPLE,
  SAMPLES,
  START,
  STATE_RANGES,
} from "../../../../src/apps/xrd/chapters/mystery/model";
import { checkState } from "../../../../src/apps/xrd/chapter";

describe("chapter 11", () => {
  it("never puts look-alike samples in one round", () => {
    expect(apart("corundum", "zircon")).toBe(true);
    expect(apart("zircon", "corundum")).toBe(true);
    const seen = new Set<string>();
    for (let r = 0; r <= MAX_ROUND; r++) {
      const round = roundOf(r);
      expect(new Set(round.choices).size, `round ${r}`).toBe(3);
      expect(round.choices[round.answer]).toBe(round.mystery);
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++)
          expect(apart(round.choices[i]!, round.choices[j]!), `round ${r}: ${round.choices}`).toBe(
            false,
          );
      seen.add(round.mystery);
    }
    // Every sample is the mystery in turn, and the answer moves between the cards.
    expect([...seen].sort()).toEqual([...SAMPLES].sort());
    expect(new Set(Array.from({ length: 30 }, (_, r) => roundOf(r).answer)).size).toBe(3);
    expect(ORDER).toHaveLength(SAMPLES.length);
    expect(APART.length).toBeGreaterThan(0);
  });

  it("round-trips its state and plays a round through", () => {
    const s = { round: 17, wrong: 5, solved: false, use: 3 };
    expect(decode(encode(s))).toEqual(s);
    expect(checkState({ state: STATE_RANGES }, encode(START))).not.toBeNull();
    for (let t = 0; t < 120; t += 1.3)
      expect(checkState({ state: STATE_RANGES }, encode(playAt(t)))).not.toBeNull();
    const r = roundOf(0);
    const wrong = (r.answer + 1) % 3;
    let st = pick(START, wrong);
    expect(st.solved).toBe(false);
    expect(st.wrong).toBe(1 << wrong);
    st = pick(st, r.answer);
    expect(st.solved).toBe(true);
    expect(pick(st, wrong)).toBe(st);
    expect(nextRound(st)).toEqual({ ...START, round: 1 });
  });

  it("puts every map's strongest rings on its own card", () => {
    for (const id of SAMPLES) {
      const rings = fingerprint(id);
      expect(rings.length, id).toBeGreaterThan(1);
      const top = peaks(id, 3, 0.2);
      expect(top.length, id).toBeGreaterThan(0);
      for (const S of top) {
        const near = Math.min(...rings.map((r) => Math.abs(r.S - S)));
        expect(near, `${id} peak at ${S.toFixed(3)}`).toBeLessThan(0.01);
      }
    }
  });

  it("tells every pair in a round apart by their first strong rings", () => {
    // The innermost rings differ for every pair.
    const first = (id: (typeof SAMPLES)[number]) => fingerprint(id).find((r) => r.height >= 10)!.S;
    for (let r = 0; r < 60; r++) {
      const c = roundOf(r).choices;
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++)
          expect(Math.abs(first(c[i]!) - first(c[j]!)), `${c[i]} and ${c[j]}`).toBeGreaterThan(
            0.012,
          );
    }
  });

  it("works out table salt's, diamond's, zircon's and silicon's curves from their crystals", () => {
    for (const id of ["salt", "diamond", "zircon", "silicon"] as const)
      expect(SAMPLE[id].map, id).toBeNull();
    expect(peaks("salt", 1)[0]).toBeCloseTo(1 / 2.82, 2);
    expect(peaks("diamond", 1)[0]).toBeCloseTo(1 / 2.06, 2);
    // Zircon's strongest ring is (2 0 0) at 3.30 Å, silicon's (1 1 1) at 3.14 Å.
    expect(peaks("zircon", 1)[0]).toBeCloseTo(0.303, 2);
    expect(peaks("silicon", 1)[0]).toBeCloseTo(0.319, 2);
    expect(Math.max(...curve("salt"))).toBeCloseTo(1, 6);
  });

  it("never shows a single crystal's spots as a fingerprint of rings, and opens on a powder", () => {
    // A still single crystal shows only the layers its scan crossed, in other proportions, so
    // its simulated map stays in chapter 6.
    for (const id of SAMPLES) expect(["powder", "foil"], id).toContain(SAMPLE[id].form);
    expect(SAMPLES.filter((id) => SAMPLE[id].map).sort()).toEqual(["corundum", "foil"]);
    expect(SAMPLE[ORDER[0]!].form).toBe("powder");
    expect(SAMPLE[ORDER[0]!].map).not.toBeNull();
    // Every curve's strongest peaks are its own card's strongest rings, in the same order of
    // strength where the curve is worked out.
    for (const id of SAMPLES) {
      const strong = [...fingerprint(id)].sort((a, b) => b.height - a.height);
      const top = peaks(id, 2, 0.2);
      for (const S of top)
        expect(
          Math.min(...strong.slice(0, 6).map((r) => Math.abs(r.S - S))),
          `${id} ${S.toFixed(3)}`,
        ).toBeLessThan(0.01);
      if (!SAMPLE[id].map) expect(Math.abs(top[0]! - strong[0]!.S), id).toBeLessThan(0.006);
    }
  });

  it("indexes aluminium: |S|² in the ratio 3 : 4 : 8 : 11 : 12 : 16, giving a = 4.05 Å", () => {
    const ix = alIndexing();
    expect(ix.rings.map((r) => Math.round(r.ratio))).toEqual([3, 4, 8, 11, 12, 16]);
    for (const r of ix.rings) expect(Math.abs(r.ratio - Math.round(r.ratio))).toBeLessThan(0.01);
    expect(ix.rings.map((r) => r.hkl.join(""))).toEqual(["111", "200", "220", "311", "222", "400"]);
    expect(ix.a).toBeCloseTo(4.05, 2);
  });
});
