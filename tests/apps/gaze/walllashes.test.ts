import { describe, expect, it } from "vitest";
import { LIDS, marginPlane } from "../../../src/apps/gaze/lids";
import {
  growLashes,
  type Lash,
  LASHES,
  lashPoint,
  lashRoot,
  lowerLift,
} from "../../../src/apps/gaze/walllashes";
import { LID_CORNER, lidCorners, PUNCTUM } from "../../../src/apps/gaze/wallscene";
import { createRng } from "../../../src/core/rng";
import type { Vec3 } from "../../../src/core/sphere";

const DEG = Math.PI / 180;
const C = [6.65, 2.6, 0] as const;
const R = 1;
const SHELL = [C[0], C[1], C[2], R * LIDS.shell] as const;

/** The lids' margins at elevations `upper` and `lower` in front, degrees. */
const planes = (upper: number, lower: number) => ({
  upper: marginPlane(C, R, upper * DEG),
  lower: marginPlane(C, R, lower * DEG),
  lift: lowerLift(lower * DEG),
});

/** Each lash's root and tip, and the points along it, with the lids as given. */
const grow = (lashes: readonly Lash[], lids: ReturnType<typeof planes>) =>
  lashes.flatMap((l) => {
    const at = lashRoot(l.lower ? lids.lower : lids.upper, SHELL, l.phi, l.lower);
    if (!at) return [];
    const points: Vec3[] = [];
    for (let i = 0; i <= 10; i++) points.push(lashPoint(l, at, R, i / 10, lids.lift));
    return [{ lash: l, root: points[0]!, tip: points[10]!, points }];
  });

const dist = (p: Vec3) => Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]);
const share = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length / xs.length;

describe("gaze lashes", () => {
  const lashes = growLashes(createRng("lashes"));
  const upper = lashes.filter((l) => !l.lower);
  const lower = lashes.filter((l) => l.lower);

  it("has about as many as a real eye on the upper lid, and sparser ones below", () => {
    expect(upper.length).toBeGreaterThanOrEqual(90);
    expect(upper.length).toBeLessThanOrEqual(160);
    expect(lower.length).toBeGreaterThan(20);
    expect(lower.length).toBeLessThan(upper.length / 2);
    // The same seed grows the same lashes.
    expect(growLashes(createRng("lashes"))).toEqual(lashes);
  });

  it("are drawn lower lid first, back rows before front", () => {
    const firstUpper = lashes.findIndex((l) => !l.lower);
    expect(lashes.slice(firstUpper).every((l) => !l.lower)).toBe(true);
    for (const lid of [upper, lower]) {
      for (let i = 1; i < lid.length; i++) expect(lid[i]!.row).toBeLessThanOrEqual(lid[i - 1]!.row);
    }
  });

  it("are longest in the middle and outer part of the upper lid, shorter below and inside", () => {
    const mean = (xs: Lash[]) => xs.reduce((s, l) => s + l.length, 0) / xs.length;
    const middle = upper.filter((l) => Math.abs(Math.sin(l.phi) + 0.2) < 0.3);
    const inner = upper.filter((l) => Math.sin(l.phi) > 0.5);
    expect(mean(middle)).toBeGreaterThan(0.28);
    expect(mean(middle)).toBeLessThan(0.6);
    expect(mean(inner)).toBeLessThan(0.8 * mean(middle));
    expect(mean(lower)).toBeLessThan(0.65 * mean(upper));
    expect(Math.max(...lashes.map((l) => l.length))).toBeLessThan(LASHES.upper.length * 1.3);
    // None grow past the tear ducts' openings, towards the inner corner.
    expect(Math.max(...lashes.map((l) => Math.sin(l.phi)))).toBeLessThan(PUNCTUM);
    expect(PUNCTUM).toBeLessThan(LID_CORNER.inner);
    // Thinner towards the inner corner.
    const width = (xs: Lash[]) => xs.reduce((s, l) => s + l.width, 0) / xs.length;
    expect(width(inner)).toBeLessThan(width(middle));
  });

  it("gather in clumps whose tips meet", () => {
    for (const lid of [upper, lower]) {
      const sorted = [...lid].sort((a, b) => a.phi - b.phi);
      let pairs = 0;
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]!;
        const b = sorted[i]!;
        // Neighbours in one clump are pulled towards each other: their tips turn aside along
        // the margin by most of the distance between their roots.
        if (!(a.pull > 0 && b.pull < 0)) continue;
        pairs++;
        const closed = a.pull * a.length - b.pull * b.length;
        const apart = (b.phi - a.phi) * LIDS.shell;
        expect(closed).toBeGreaterThan(0.75 * apart);
        expect(closed).toBeLessThan(1.05 * apart);
      }
      expect(pairs).toBeGreaterThan(lid === upper ? 15 : 3);
    }
    for (const l of lashes) expect(Math.abs(l.pull)).toBeLessThan(0.6);
  });

  it("curl up and out from the upper lid and down from the lower, outside the eye", () => {
    const grown = grow(lashes, planes(20, -27));
    expect(grown.length).toBe(lashes.length);
    for (const g of grown) {
      for (const p of g.points) expect(dist(p)).toBeGreaterThan(R * 0.999);
    }
    const up = grown.filter((g) => !g.lash.lower);
    const down = grown.filter((g) => g.lash.lower);
    const rise = (gs: typeof grown) => gs.reduce((s, g) => s + g.tip[1] - g.root[1], 0) / gs.length;
    expect(share(up, (g) => g.tip[1] > g.root[1])).toBeGreaterThan(0.95);
    expect(rise(up)).toBeGreaterThan(0.1 * R);
    expect(share(down, (g) => g.tip[1] < g.root[1])).toBeGreaterThan(0.95);
    expect(rise(down)).toBeLessThan(-0.05 * R);
    // Towards the viewer, so they stand out from the lids.
    expect(share(grown, (g) => g.tip[2] > g.root[2])).toBeGreaterThan(0.95);
    // The outer ones fan out towards the outer corner.
    const outer = up.filter((g) => Math.sin(g.lash.phi) < -0.6);
    expect(share(outer, (g) => g.tip[0] < g.root[0])).toBeGreaterThan(0.9);
  });

  it("move with the lids: hang down over a shut eye, ride up with a lid looking up", () => {
    const open = grow(upper, planes(20, -27));
    const shut = grow(upper, planes(-25, -27));
    const raised = grow(upper, planes(45, -12));
    const meanTip = (gs: typeof open) =>
      gs.reduce((s, g) => s + g.tip[1] - g.root[1], 0) / gs.length;
    expect(meanTip(shut)).toBeLessThan(meanTip(open) - 0.15 * R);
    expect(meanTip(raised)).toBeGreaterThan(meanTip(open));
    for (const g of [...shut, ...raised]) {
      for (const p of g.points) expect(dist(p)).toBeGreaterThan(R * 0.999);
    }
  });

  it("keep the lower lashes pointing down when the lower lid rises in a smile", () => {
    const content = grow(lower, planes(1, -3));
    expect(content.length).toBeGreaterThan(0.9 * lower.length);
    expect(share(content, (g) => g.tip[1] < g.root[1])).toBeGreaterThan(0.9);
    for (const g of content) {
      for (const p of g.points) expect(dist(p)).toBeGreaterThan(R * 0.999);
    }
  });
});

describe("gaze lid opening", () => {
  /** The margin's height across the eye, ball radii above the centre. */
  const height = (plane: ReturnType<typeof marginPlane>, x: number, lower = false) =>
    (lashRoot(plane, SHELL, Math.asin(x), lower)!.root[1] - C[1]) / R;

  it("tilts up towards the outer corner, the upper lid highest towards it", () => {
    const up = marginPlane(C, R, LIDS.upper);
    const low = marginPlane(C, R, LIDS.lower);
    expect(height(up, -0.7)).toBeGreaterThan(height(up, 0.7));
    expect(height(low, -0.7, true)).toBeGreaterThan(height(low, 0.7, true));
    let best = { x: 0, y: -Infinity };
    for (let x = -0.6; x <= 0.6; x += 0.01) {
      const y = height(up, x);
      if (y > best.y) best = { x, y };
    }
    expect(best.x).toBeLessThan(-0.01);
    expect(best.x).toBeGreaterThan(-0.3);
    // The inner corner ends sooner than the outer, round the caruncle.
    expect(LID_CORNER.inner).toBeLessThan(LID_CORNER.outer);
  });

  it("is symmetric with the options off, as before", () => {
    for (const a of [LIDS.upper, LIDS.lower, 0]) {
      const plane = marginPlane(C, R, a, 0);
      expect(plane[0]).toBe(0);
      const lower = a < 0;
      for (const x of [0.3, 0.6, 0.8]) {
        expect(height(plane, x, lower)).toBeCloseTo(height(plane, -x, lower), 9);
      }
    }
    expect(lidCorners(false, false)).toEqual({ inner: LID_CORNER.plain, outer: LID_CORNER.plain });
    expect(lidCorners(true, true)).toEqual({ inner: LID_CORNER.inner, outer: LID_CORNER.outer });
  });
});
