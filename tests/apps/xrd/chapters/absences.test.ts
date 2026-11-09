import { describe, expect, it } from "vitest";
import {
  A,
  type AbsencesState,
  alRings,
  alSum,
  centred,
  CENTRE,
  checkered,
  chosenSum,
  decode,
  encode,
  flatSum,
  GRID,
  HEAVY,
  KCL_A,
  KCL_CELL,
  LIGHT,
  missingSpots,
  myCell,
  openingSpot,
  patternJob,
  playAt,
  siteUV,
  snap,
  SPOTS_2D,
  START,
  STATE_RANGES,
  vanishedSpot,
} from "../../../../src/apps/xrd/chapters/absences/model";
import { checkState } from "../../../../src/apps/xrd/chapter";
import { intensity } from "../../../../src/apps/xrd/engine/pattern";

const N = 256;
const withAtoms = (a: [number, boolean], b: [number, boolean] = [0, false]): AbsencesState => ({
  kase: "mine",
  atoms: [
    { site: a[0], heavy: a[1] },
    { site: b[0], heavy: b[1] },
  ],
  spot: 0,
});

/** The engine's intensity at spot (h k) of a cell with edge `a`: the brightest pixel near it. */
const spotIn = (I: Float64Array, span: number, a: number, h: number, k: number) => {
  const kx = Math.round((h / a) * span);
  const ky = Math.round((k / a) * span);
  let v = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) v = Math.max(v, I[(N / 2 - ky - dy) * N + (N / 2 + kx + dx)]!);
  return v;
};

describe("chapter 8", () => {
  it("round-trips its state and keeps it in range", () => {
    const s: AbsencesState = {
      kase: "kcl",
      atoms: [
        { site: CENTRE, heavy: true },
        { site: 3, heavy: false },
      ],
      spot: 4,
    };
    expect(decode(encode(s))).toEqual(s);
    expect(checkState({ state: STATE_RANGES }, encode(START))).not.toBeNull();
    for (let t = 0; t < 30; t += 0.9)
      expect(checkState({ state: STATE_RANGES }, encode(playAt(t)))).not.toBeNull();
    // Two atoms never share a site, whatever arrives.
    expect(decode([0, 5, 1, 5, 0, 0]).atoms[1].site).toBe(0);
  });

  it("snaps a dropped atom to the nearest free quarter, never the corner", () => {
    expect(siteUV(CENTRE)).toEqual([0.5, 0.5]);
    expect(snap(0.47, 0.55)).toBe(CENTRE);
    expect(snap(0.47, 0.55, [CENTRE])).not.toBe(CENTRE);
    // Near a corner, the corner's taken: the next quarter along.
    const s = snap(0.03, 0.02);
    expect(s).toBeGreaterThan(0);
    expect(Math.max(...siteUV(s))).toBeCloseTo(1 / GRID, 9);
    // The cell repeats: just past the right edge is the left edge.
    expect(snap(1.02, 0.5)).toBe(snap(0.02, 0.5));
  });

  it("cancels every spot with h + k odd when a heavy atom sits in the middle", () => {
    const s = withAtoms([CENTRE, true]);
    expect(centred(s)).toBe(true);
    const atoms = myCell(s);
    for (let h = -3; h <= 3; h++)
      for (let k = -3; k <= 3; k++) {
        if (h === 0 && k === 0) continue;
        const sum = flatSum(atoms, A, h, k);
        if ((h + k) % 2 !== 0) expect(sum.F2, `(${h} ${k})`).toBeLessThan(1e-9);
        else expect(Math.sqrt(sum.F2), `(${h} ${k})`).toBeCloseTo(sum.inStep, 6);
      }
    // The engine's pattern agrees: the odd spots are dark, the even ones bright.
    const job = patternJob(s, N)!;
    const I = intensity(job.source, N, job.span, new Float64Array(N * N));
    const even = spotIn(I, job.span, A, 1, 1);
    for (const [h, k] of [
      [1, 0],
      [0, 1],
      [2, 1],
    ] as const)
      expect(spotIn(I, job.span, A, h, k), `(${h} ${k})`).toBeLessThan(even * 1e-3);
    // The ringed missing spots are exactly those.
    const gone = missingSpots(atoms, A, 0.62);
    expect(gone.length).toBeGreaterThan(4);
    for (const [h, k] of gone) expect(Math.abs(h + k) % 2).toBe(1);
  });

  it("only dims the odd spots when the middle atom is light, and loses nothing with the corner alone", () => {
    expect(centred(withAtoms([CENTRE, false]))).toBe(false);
    const light = flatSum(myCell(withAtoms([CENTRE, false])), A, 1, 0);
    expect(Math.sqrt(light.F2)).toBeGreaterThan(0.3 * light.inStep);
    expect(light.arrows.map((a) => a.f / light.arrows[0]!.f)).toEqual([1, LIGHT / HEAVY]);
    expect(missingSpots(myCell(START), A, 0.62)).toEqual([]);
  });

  it("nearly loses potassium chloride's odd spots, both ions having 18 electrons", () => {
    expect(KCL_CELL.every((a) => a.z === 18)).toBe(true);
    const odd = flatSum(KCL_CELL, KCL_A, 1, 1);
    const even = flatSum(KCL_CELL, KCL_A, 2, 0);
    const mixed = flatSum(KCL_CELL, KCL_A, 1, 0);
    expect(mixed.F2).toBeLessThan(1e-9);
    expect(odd.F2).toBeGreaterThan(0);
    expect(odd.F2 / even.F2).toBeLessThan(0.01);
    // So it looks like a cell half as wide: its spots sit where that one's would, 2/a apart.
    const gone = missingSpots(KCL_CELL, KCL_A, 0.62);
    for (const [h, k] of gone) expect(h % 2 !== 0 || k % 2 !== 0).toBe(true);
    expect(gone.some(([h, k]) => h === 1 && k === 1)).toBe(true);
  });

  it("gives aluminium four arrows that line up only when h, k and l are all odd or all even", () => {
    for (const [h, k, l] of [
      [1, 0, 0],
      [1, 1, 0],
      [2, 1, 0],
    ] as const)
      expect(alSum(h, k, l).F2, `(${h} ${k} ${l})`).toBeLessThan(1e-9);
    for (const [h, k, l] of [
      [1, 1, 1],
      [2, 0, 0],
      [2, 2, 0],
    ] as const) {
      const s = alSum(h, k, l);
      expect(Math.sqrt(s.F2)).toBeCloseTo(s.inStep, 9);
      expect(s.arrows).toHaveLength(4);
    }
  });

  it("draws aluminium's rings at 3, 4, 8, 11, 12 and 16 and leaves the rest of a simple cell's out", () => {
    const rings = alRings();
    const present = rings.filter((r) => r.height > 0).map((r) => r.N);
    expect(present).toEqual([3, 4, 8, 11, 12, 16]);
    expect(rings.find((r) => r.N === 3)!.S).toBeCloseTo(1 / 2.338, 3);
    expect(Math.max(...rings.map((r) => r.height))).toBeCloseTo(100, 6);
  });

  it("points the arrow sum at a spot that vanished once the heavy atom is in the middle", () => {
    // Nothing has vanished in the empty cell, or with a light atom in the middle.
    expect(vanishedSpot(START)).toBe(-1);
    expect(vanishedSpot(withAtoms([CENTRE, false]))).toBe(-1);
    const s = withAtoms([CENTRE, true]);
    const i = vanishedSpot(s);
    expect(SPOTS_2D[i]).toEqual([1, 0]);
    const sum = chosenSum({ ...s, spot: i });
    expect(sum.F2).toBeLessThan(1e-9);
    // Its two arrows point opposite ways.
    expect(Math.cos(sum.arrows[1]!.phase - sum.arrows[0]!.phase)).toBeCloseTo(-1, 9);
  });

  it("says the So line holds only while every spot with h + k odd has gone", () => {
    expect(checkered(START)).toBe(false);
    expect(checkered(withAtoms([CENTRE, true]))).toBe(true);
    expect(checkered(withAtoms([CENTRE, false]))).toBe(false);
    // A second atom off the middle spoils it, though a heavy atom still sits there.
    const spoilt = withAtoms([CENTRE, true], [2 * GRID, false]);
    expect(centred(spoilt)).toBe(true);
    expect(checkered(spoilt)).toBe(false);
    expect(checkered({ ...withAtoms([CENTRE, true]), kase: "kcl" })).toBe(false);
  });

  it("opens potassium chloride on (1 1), where its two ions cancel, not on (1 0)", () => {
    expect(SPOTS_2D[openingSpot("kcl")]).toEqual([1, 1]);
    expect(openingSpot("mine")).toBe(0);
    expect(openingSpot("aluminium")).toBe(0);
    // (1 0) cancels for any cell of that shape: the two potassium arrows cancel each other, and
    // so do the two chlorine arrows, whatever their sizes.
    const unequal = KCL_CELL.map((a) => ({ ...a, z: a.kind === "K" ? 10 : 30 }));
    expect(flatSum(unequal, KCL_A, 1, 0).F2).toBeLessThan(1e-9);
    // (1 1) cancels only because the two kinds match: potassium against chlorine.
    expect(flatSum(unequal, KCL_A, 1, 1).F2).toBeGreaterThan(100);
    const kcl = flatSum(KCL_CELL, KCL_A, 1, 1);
    expect(Math.sqrt(kcl.F2)).toBeLessThan(0.05 * kcl.inStep);
  });

  it("shows the chosen spot's sum in every case", () => {
    expect(chosenSum({ ...START, kase: "aluminium", spot: 2 }).arrows).toHaveLength(4);
    expect(chosenSum({ ...START, kase: "kcl", spot: 1 }).arrows).toHaveLength(4);
    expect(chosenSum(withAtoms([CENTRE, true], [4, false])).arrows).toHaveLength(3);
    expect(patternJob({ ...START, kase: "aluminium" }, N)).toBeNull();
  });
});
