import { describe, expect, it } from "vitest";
import { createChart, type Chart, type TubeGeom } from "../../../src/apps/ballpit/chart";
import {
  createLattice,
  type Lattice,
  packedRects,
  type PackRect,
} from "../../../src/apps/ballpit/lattice";
import { createPile } from "../../../src/apps/ballpit/pile";
import { cornerRadius, insideTube, lowestY, shapeOf } from "../../../src/apps/ballpit/shape";

const DT = 1 / 60;
/** Floating point slack, venue px. Anything visibly outside is far more than this. */
const TOL = 1e-3;

/** Every ball centre a set of pattern rectangles shows. */
const ballsIn = (lat: Lattice, rects: readonly PackRect[], count: number, dx = 0, dy = 0) => {
  const out: { x: number; y: number }[] = [];
  const { r, rowH } = lat;
  for (const rect of rects.slice(0, count)) {
    const a = lat.anchor(rect.kind);
    const i0 = Math.ceil((rect.x + r - a.x) / (2 * r) - 1e-6);
    const i1 = Math.floor((rect.x + rect.w - r - a.x) / (2 * r) + 1e-6);
    const j0 = Math.ceil((a.y - (rect.y + rect.h - r)) / (2 * rowH) - 1e-6);
    const j1 = Math.floor((a.y - (rect.y + r)) / (2 * rowH) + 1e-6);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        out.push({ x: a.x + 2 * r * i + dx, y: a.y - 2 * rowH * j + dy });
  }
  return out;
};

describe("tube outline", () => {
  it("holds a ball against the round corners exactly", () => {
    const s = shapeOf({ x0: 0, x1: 400, bottom: 1000 });
    expect(s.rad).toBeCloseTo(cornerRadius(400));
    const r = 50;
    // In the flat middle a ball sits on the bottom.
    expect(lowestY(s, 200, r)).toBeCloseTo(950);
    // Against the wall it sits where the corner curve meets it, well above the bottom.
    const atWall = lowestY(s, r, r);
    expect(atWall).toBeCloseTo(1000 - s.rad);
    expect(insideTube(s, r, atWall, r)).toBe(true);
    expect(insideTube(s, r, atWall + 1, r)).toBe(false);
    // The point of the old bug: a ball resting on a flat floor in a corner pokes out.
    expect(insideTube(s, r, 1000 - r, r)).toBe(false);
  });

  it("packs whole balls inside the glass at every scale, without overlaps", () => {
    for (const w of [90, 130, 300, 434]) {
      for (let n = 3; n <= 64; n += n < 8 ? 1 : 7) {
        const s = shapeOf({ x0: 0, x1: w, bottom: 3000 });
        const lat = createLattice(s, n);
        const rows = lat.bowl + 6;
        const total = lat.below(rows);
        const rects: PackRect[] = [];
        const k = packedRects(lat, total, rects);
        const balls = ballsIn(lat, rects, k);
        expect(balls.length, `w ${w} n ${n}`).toBe(total);
        for (const b of balls)
          expect(insideTube(s, b.x, b.y, lat.r, TOL), `w ${w} n ${n}`).toBe(true);
        // Neighbours only: balls more than a row apart can't touch.
        const byY = balls.slice().sort((p, q) => p.y - q.y);
        let closest = Infinity;
        for (let i = 0; i < byY.length; i++)
          for (let j = i + 1; j < byY.length && byY[j]!.y - byY[i]!.y < 2 * lat.r; j++)
            closest = Math.min(closest, Math.hypot(byY[i]!.x - byY[j]!.x, byY[i]!.y - byY[j]!.y));
        expect(closest).toBeGreaterThan(2 * lat.r - TOL);
        // The lowest ball rests low in the bowl, not on a ledge above it.
        expect(Math.max(...balls.map((b) => b.y))).toBeGreaterThan(3000 - 1.6 * lat.r);
        // Counts, rows and floors agree, and a part-filled top row draws just its balls.
        const stride = Math.max(1, Math.floor(total / 150));
        for (let b = 0; b <= total; b += b < 3 * n ? 1 : stride) {
          const { j, m } = lat.rowOf(b);
          expect(lat.below(j) + m).toBe(b);
          expect(m).toBeLessThan(Math.max(1, lat.cap(j)));
          expect(lat.whole(b)).toBeLessThanOrEqual(b);
          if (b > 0) expect(lat.floor(b)).toBeLessThanOrEqual(lat.floor(b - 1) + 1e-9);
          const kk = packedRects(lat, b, rects);
          expect(ballsIn(lat, rects, kk).length).toBe(b);
        }
      }
    }
  });
});

const tubesOf = (k: number, w: number, h: number): TubeGeom[] =>
  Array.from({ length: k }, (_, i) => ({
    answer: i,
    x0: 100 + i * (w + 200),
    x1: 100 + i * (w + 200) + w,
    top: 300,
    bottom: 300 + h,
  }));

/** Checks every live and every packed ball of every tube against the drawn outline. */
const checkInside = (chart: Chart) => {
  const rects: PackRect[] = [];
  for (const t of chart.tubes) {
    const p = t.pile;
    for (let i = 0; i < p.n; i++) {
      if (!insideTube(t.shape, p.x[i]!, p.y[i]!, p.r, TOL)) {
        throw new Error(
          `live ball at ${p.x[i]!.toFixed(2)},${p.y[i]!.toFixed(2)} r ${p.r.toFixed(2)} is outside tube ${t.geom.answer}`,
        );
      }
    }
    if (chart.state === "drain") continue;
    const lat = chart.lattice;
    const k = packedRects(lat, t.shown, rects);
    for (const b of ballsIn(lat, rects, k, t.geom.x0)) {
      if (!insideTube(t.shape, b.x, b.y, lat.r, TOL))
        throw new Error(`packed ball at ${b.x},${b.y} is outside tube ${t.geom.answer}`);
    }
  }
};

describe("balls in the tube", () => {
  it("stay inside the outline when dropped in at speed, through scale changes", () => {
    const chart = createChart({ tubes: tubesOf(3, 300, 1100), n0: 4, liveCap: 48, gravity: 4800 });
    const votes = [0, 0, 0];
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let floorInBowl = 0;
    const ks = new Set<number>();
    for (let step = 0; step < 60 * 40; step++) {
      // Up to three balls a step, mostly into the first tube, flung hard and sideways.
      for (let v = 0; v < 3; v++) {
        if (rand() > 0.55) continue;
        const a = rand() < 0.6 ? 0 : rand() < 0.5 ? 1 : 2;
        const g = chart.tubes[a]!.geom;
        if (!chart.flightOut(a)) continue;
        votes[a]!++;
        chart.setCounts(votes);
        chart.land(
          a,
          g.x0 + rand() * (g.x1 - g.x0),
          g.top - 40,
          (rand() - 0.5) * 2400,
          1500 + rand() * 2500,
        );
      }
      chart.step(DT);
      checkInside(chart);
      ks.add(chart.k);
      for (const t of chart.tubes) {
        const fl = chart.lattice.floor(t.shown);
        if (t.shown > 0 && t.pile.n > 0 && fl > t.shape.bottom - t.shape.rad) floorInBowl++;
      }
    }
    for (let s = 0; s < 60 * 6; s++) {
      chart.step(DT);
      checkInside(chart);
    }
    // The run went through at least two scale halvings and rested balls on packed rows that
    // were still inside the round bottom.
    expect(ks.size).toBeGreaterThanOrEqual(3);
    expect(floorInBowl).toBeGreaterThan(30);
    expect(chart.tubes[0]!.packed + chart.tubes[0]!.pile.n + chart.tubes[0]!.drops).toBe(votes[0]);
  }, 30_000);

  it("keep to the round bottom of a narrow tube on a crowded day", () => {
    // A panel's narrow tube, poured full, then hammered with fast balls.
    const chart = createChart({ tubes: tubesOf(2, 90, 400), n0: 3, liveCap: 40, gravity: 9000 });
    chart.pour([200, 3]);
    for (let s = 0; s < 60 * 4; s++) {
      chart.step(DT);
      checkInside(chart);
    }
    const votes = [200, 3];
    for (let s = 0; s < 60 * 12; s++) {
      const a = s % 2;
      const g = chart.tubes[a]!.geom;
      if (chart.flightOut(a)) {
        votes[a]!++;
        chart.setCounts(votes);
        chart.land(a, g.x0 + ((s * 37) % 90), g.top - 20, s % 4 < 2 ? 900 : -900, 3000);
      }
      chart.step(DT);
      checkInside(chart);
    }
    expect(chart.grown).toBeGreaterThan(0);
  }, 30_000);

  it("never let a lone pile out of the corners", () => {
    const s = shapeOf({ x0: 0, x1: 240, bottom: 800 });
    const p = createPile(60, 30, s);
    for (let step = 0; step < 60 * 10; step++) {
      if (step % 4 === 0 && p.n < 50)
        p.add(step % 8 === 0 ? 31 : 209, 100, step % 8 ? 900 : -900, 2500, 0);
      p.step(DT, 6000);
      for (let i = 0; i < p.n; i++) expect(insideTube(s, p.x[i]!, p.y[i]!, p.r, TOL)).toBe(true);
    }
  });
});
