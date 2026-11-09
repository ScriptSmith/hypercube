import { describe, expect, it } from "vitest";
import helix from "../../../../src/apps/xrd/chapters/helix";
import {
  A_PER_PX,
  armAngle,
  decode,
  DNA,
  encode,
  type HelixState,
  innerSpot,
  keyMove,
  layerLine,
  missingLines,
  patternJob,
  START,
  STATE_RANGES,
  strandFactor,
  visibleArm,
} from "../../../../src/apps/xrd/chapters/helix/physics";
import type { ChapterEnv } from "../../../../src/apps/xrd/chapter";
import { readConfig } from "../../../../src/apps/xrd/config";
import { intensity } from "../../../../src/apps/xrd/engine/pattern";
import { createLink } from "../../../../src/apps/xrd/formula";
import { layoutFrame, withSplit } from "../../../../src/apps/xrd/layout";
import type { Rng } from "../../../../src/core/types";

/**
 * The engine's own tests check a helix's layer lines and DNA's missing fourth with its default
 * model; these check the chapter's model as the chapter draws it (its grid, span and atom width)
 * and the X's angle following the helix's steepness.
 */

const N = 256;
const pattern = (s: HelixState) => {
  const job = patternJob(s, N);
  return { I: intensity(job.source, N, job.span, new Float64Array(N * N)), span: job.span };
};
/** Value at (kx, ky) pixels from the centre, ky up. */
const at = (I: Float64Array, kx: number, ky: number) => I[(N / 2 - ky) * N + (N / 2 + kx)]!;

/**
 * Layer line l's innermost strong spot: the first peak out from the meridian at least half as
 * bright as the line's brightest, and where it is across (pixels).
 */
const onLine = (I: Float64Array, span: number, pitch: number, l: number) => {
  const ky = Math.round(layerLine(l, pitch) * span);
  const v = (x: number) => Math.max(at(I, x, ky), at(I, x, ky + 1), at(I, x, ky - 1));
  let top = 0;
  for (let x = 2; x <= 60; x++) top = Math.max(top, v(x));
  for (let x = 3; x < 60; x++) {
    if (v(x) >= top * 0.5 && v(x) >= v(x - 1) && v(x) >= v(x + 1)) return { v: top, kx: x, ky };
  }
  return { v: top, kx: 0, ky };
};

const between = (I: Float64Array, span: number, pitch: number, l: number) => {
  const ky = Math.round(layerLine(l + 0.5, pitch) * span);
  let m = 0;
  for (let x = 2; x <= 60; x++) m = Math.max(m, at(I, x, ky));
  return m;
};

/** The X's arm: the angle from upright of a line through the middle and rows 1 to 3's spots. */
const armFromRows = (s: HelixState) => {
  const { I, span } = pattern(s);
  let sxx = 0;
  let sxy = 0;
  for (let l = 1; l <= 3; l++) {
    const p = onLine(I, span, s.pitch, l);
    sxx += p.ky * p.ky;
    sxy += p.ky * p.kx;
  }
  // kx = t·ky through the middle: the arm's tangent from upright.
  return (Math.atan(sxy / sxx) * 180) / Math.PI;
};

describe("chapter 10's helix", () => {
  it("puts its layer lines 1/P apart in the chapter's own picture", () => {
    for (const pitch of [24, 34, 50]) {
      const s = { pitch, radius: 10, strands: 1 as const };
      const { I, span } = pattern(s);
      expect(span).toBe(N * A_PER_PX);
      for (const l of [1, 2, 3]) {
        expect(onLine(I, span, pitch, l).v).toBeGreaterThan(between(I, span, pitch, l) * 4);
      }
    }
  });

  it("loses the fourth row with two strands offset as in DNA, and keeps the third and fifth", () => {
    const one = pattern(START);
    const two = pattern({ ...START, strands: 2 });
    const ratio = (l: number) =>
      onLine(two.I, two.span, START.pitch, l).v / onLine(one.I, one.span, START.pitch, l).v;
    expect(ratio(4)).toBeLessThan(ratio(3) * 0.15);
    expect(ratio(4)).toBeLessThan(ratio(5) * 0.15);
    expect(missingLines(12)).toEqual([4, 12]);
    expect(strandFactor(1)).toBeCloseTo(0.383, 3);
    expect(strandFactor(4)).toBeCloseTo(0, 12);
  });

  it("makes an X whose arms lean as the helix is steep", () => {
    // DNA: tan α = 34 / 2π·10, α = 28.4°.
    expect(armAngle(DNA.pitch, DNA.radius)).toBeCloseTo(28.4, 1);
    // Rows' brightest spots move out from the meridian as the rows go up: an X.
    const { I, span } = pattern(START);
    const xs = [1, 2, 3].map((l) => onLine(I, span, START.pitch, l).kx);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    // A steeper helix turns the arms away from upright; a wider one turns them back.
    const dna = armFromRows(START);
    const stretched = armFromRows({ ...START, pitch: 50 });
    const wide = armFromRows({ ...START, radius: 14 });
    expect(stretched).toBeGreaterThan(dna + 8);
    expect(wide).toBeLessThan(dna - 5);
    // Near the middle the spots sit wider than α (36.0° for DNA).
    expect(dna).toBeGreaterThan(armAngle(DNA.pitch, DNA.radius));
    expect(dna).toBeLessThan(armAngle(DNA.pitch, DNA.radius) + 15);
  });

  it("draws the X along the bright inner spots, which lean 5 to 9 degrees wider than α", () => {
    // A line through the middle fitted to rows 1 to 5's first maxima leans 36.0° for DNA, 45.7°
    // at P = 48 Å.
    expect(visibleArm(START)).toBeCloseTo(36.0, 0);
    expect(visibleArm({ ...START, pitch: 48 })).toBeCloseTo(45.7, 0);
    for (const pitch of [20, 30, 40, 50, 60])
      for (const radius of [6, 10, 14]) {
        const s = { pitch, radius, strands: 1 as const };
        const wider = visibleArm(s) - armAngle(pitch, radius);
        expect(wider, `${pitch} ${radius}`).toBeGreaterThan(4);
        expect(wider, `${pitch} ${radius}`).toBeLessThan(10);
      }
    // The first maxima of J_l are where the engine's picture puts each row's inner spot.
    const { I, span } = pattern(START);
    for (const l of [1, 2, 3]) {
      const kx = onLine(I, span, START.pitch, l).kx;
      expect(Math.abs(kx - innerSpot(l, START.radius) * span), `row ${l}`).toBeLessThan(1.6);
    }
    // And the line drawn agrees with the arm measured from that picture's rows 1 to 3.
    for (const s of [START, { ...START, pitch: 50 }, { ...START, radius: 14 }])
      expect(Math.abs(armFromRows(s) - visibleArm(s)), `${s.pitch} ${s.radius}`).toBeLessThan(4);
    // Two strands leave the cancelled fourth row out of the fit.
    expect(visibleArm({ ...START, strands: 2 })).toBeGreaterThan(armAngle(DNA.pitch, DNA.radius));
  });

  it("counts the key move as a changed angle or two strands", () => {
    expect(keyMove(START)).toBe(false);
    expect(keyMove({ ...START, strands: 2 })).toBe(true);
    expect(keyMove({ ...START, pitch: 36 })).toBe(false);
    expect(keyMove({ ...START, pitch: 42 })).toBe(true);
    expect(keyMove({ ...START, radius: 7 })).toBe(true);
  });

  it("shows its So line when a child switches to two strands", () => {
    let earned = 0;
    let caption: string | null = null;
    const env: ChapterEnv = {
      id: "helix",
      kind: "panel",
      config: readConfig({}),
      rng: {} as Rng,
      engine: () => {
        throw new Error("no engine here");
      },
      layer3d: () => {
        throw new Error("no 3D here");
      },
      maps: { canvas: () => null, ready: () => false, draw: () => null, dispose() {} },
      link: createLink(),
      earn: () => earned++,
      say: (l) => {
        caption = l.caption?.text ?? null;
      },
      now: () => 0,
    };
    const ch = helix.create(env);
    const l = layoutFrame({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: { adult: 0, child: 960 },
      cards: [{ bottom: "tabs", tabs: 11 }],
      maths: true,
    }).cards[0]!;
    ch.layout(withSplit(l, helix.split ?? 0.5));
    ch.update(1 / 60, 0);
    expect(earned).toBe(0);
    const strands = ch.controls.find((c) => c.id === "strands")!;
    const strandsBand = strands.band;
    expect(strandsBand).toBe("child");
    const g = strands.gesture(1)!;
    strands.begin({ id: 1, x: g.path[0]!.x, y: g.path[0]!.y, synthetic: false, time: 0 });
    ch.update(1 / 60, 16);
    expect(earned).toBeGreaterThan(0);
    expect(decode(ch.state()).strands).toBe(2);
    // The two-strand line takes the caption slot while two strands show.
    expect(caption).toMatch(/fourth row cancels out/);
    ch.reset();
    expect(ch.state()).toEqual(encode(START));
  });

  it("swaps a fibre into the machine, and packs its state within its ranges", () => {
    expect(helix.drive!(encode(START)).sample?.form).toBe("fibre");
    for (let t = 0; t < 80; t += 0.9) {
      const v = helix.play!(t);
      v.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(STATE_RANGES[i]![0]);
        expect(x).toBeLessThanOrEqual(STATE_RANGES[i]![1]);
      });
    }
    expect(decode(encode({ pitch: 47.3, radius: 12.1, strands: 2 }))).toEqual({
      pitch: 47.3,
      radius: 12.1,
      strands: 2,
    });
  });
});
