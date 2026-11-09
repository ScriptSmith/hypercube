import { describe, expect, it } from "vitest";
import {
  ballsAcross,
  type Chart,
  createChart,
  type TubeGeom,
} from "../../../src/apps/ballpit/chart";
import { MAX_LIVE } from "../../../src/apps/ballpit/config";
import { createPile } from "../../../src/apps/ballpit/pile";

const DT = 1 / 60;

const tubes = (k: number, w = 400, h = 1400): TubeGeom[] =>
  Array.from({ length: k }, (_, i) => ({
    answer: i,
    x0: i * 800,
    x1: i * 800 + w,
    top: 400,
    bottom: 400 + h,
  }));

const run = (chart: Chart, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) chart.step(DT);
};

/** The highest point of a column: the live pile's top, or the packed rows' top. */
const columnTop = (chart: Chart, i: number) =>
  Math.min(chart.packedTop(i), chart.tubes[i]!.pile.top());

describe("ball chart", () => {
  it("halves the scale before any column leaves its tube", () => {
    const chart = createChart({ tubes: tubes(4), n0: 4, liveCap: 48, gravity: 4800 });
    run(chart, 1.5);
    const votes = [0, 0, 0, 0];
    let lastK = chart.k;
    const ks: number[] = [];
    for (let step = 0; step < 900; step++) {
      // A popular answer, a middling one, a rare one and one nobody picks.
      votes[0]! += 3;
      votes[1]! += 1;
      if (step % 4 === 0) votes[2]!++;
      chart.setCounts(votes);
      chart.step(DT);
      for (let i = 0; i < 4; i++) {
        expect(columnTop(chart, i)).toBeGreaterThanOrEqual(chart.tubes[i]!.geom.top - chart.r * 2);
      }
      if (chart.k !== lastK) {
        ks.push(chart.k);
        lastK = chart.k;
      }
    }
    run(chart, 12);
    expect(ks.length).toBeGreaterThanOrEqual(3);
    // Each step roughly doubles what a tube holds.
    const cap = (k: number) => ballsAcross(4, k) ** 2;
    expect(cap(1) / cap(0)).toBeGreaterThan(1.7);
    expect(cap(1) / cap(0)).toBeLessThan(2.4);
    // Every column's height follows its count at the shared scale.
    const h = (i: number) => chart.tubes[i]!.geom.bottom - columnTop(chart, i);
    expect(h(0) / h(1)).toBeGreaterThan(2.2);
    expect(h(0) / h(1)).toBeLessThan(3.8);
    expect(h(3)).toBe(0);
    for (const t of chart.tubes)
      expect(t.packed + t.pile.n + t.drops + t.flights).toBeGreaterThan(-1);
    expect(chart.tubes[0]!.packed + chart.tubes[0]!.pile.n + chart.tubes[0]!.drops).toBe(votes[0]);
  }, 20_000);

  it("keeps live balls within each tube's budget", () => {
    const liveCap = Math.floor(MAX_LIVE / 6);
    const chart = createChart({ tubes: tubes(6), n0: 4, liveCap, gravity: 4800 });
    let most = 0;
    const votes = [0, 0, 0, 0, 0, 0];
    for (let step = 0; step < 1000; step++) {
      for (let i = 0; i < 6; i++) votes[i]! += step % (i + 1) === 0 ? 1 : 0;
      chart.setCounts(votes);
      chart.step(DT);
      for (const t of chart.tubes) {
        expect(t.pile.n).toBeLessThanOrEqual(t.pile.cap);
        most = Math.max(most, t.pile.n);
      }
      expect(chart.bodies).toBeLessThanOrEqual(MAX_LIVE + 6 * 8);
    }
    run(chart, 3);
    for (const t of chart.tubes) expect(t.pile.n).toBeLessThanOrEqual(liveCap + 1);
    expect(chart.bodies).toBeLessThanOrEqual(MAX_LIVE);
    expect(most).toBeGreaterThan(liveCap / 2);
  }, 20_000);

  it("drains and pours a new question's totals so far", () => {
    const chart = createChart({ tubes: tubes(3), n0: 4, liveCap: 40, gravity: 4800 });
    chart.pour([12, 30, 5]);
    run(chart, 4);
    const held = chart.tubes.map((t) => t.packed + t.pile.n + t.drops);
    expect(held).toEqual([12, 30, 5]);
    expect(chart.state).toBe("show");
    // A clear: the counts go down, so the chart drains and pours afresh.
    chart.setCounts([0, 0, 0]);
    expect(chart.state).toBe("drain");
    run(chart, 3);
    expect(chart.tubes.map((t) => t.packed + t.pile.n)).toEqual([0, 0, 0]);
    expect(chart.busy).toBe(false);
  });

  it("pours big totals mostly as packed rows", () => {
    const chart = createChart({ tubes: tubes(2), n0: 4, liveCap: 40, gravity: 4800 });
    chart.pour([2000, 300]);
    run(chart, 5);
    expect(chart.bodies).toBeLessThanOrEqual(80);
    expect(chart.lattice.whole(chart.tubes[0]!.packed)).toBe(chart.tubes[0]!.packed);
    expect(chart.tubes[0]!.packed + chart.tubes[0]!.pile.n + chart.tubes[0]!.drops).toBe(2000);
    expect(columnTop(chart, 0)).toBeGreaterThan(chart.tubes[0]!.geom.top);
  });

  it("stops shrinking balls past kMax and counts several votes per ball", () => {
    const chart = createChart({
      tubes: tubes(2, 200, 600),
      n0: 3,
      kMax: 2,
      liveCap: 30,
      gravity: 4800,
    });
    chart.pour([50_000, 10]);
    run(chart, 4);
    expect(chart.k).toBeGreaterThan(2);
    expect(chart.m).toBeGreaterThan(1);
    expect(columnTop(chart, 0)).toBeGreaterThan(chart.tubes[0]!.geom.top - chart.r * 2);
  });

  it("lands a flight as a ball, and lets one over the target vanish", () => {
    const chart = createChart({ tubes: tubes(2), n0: 4, liveCap: 40, gravity: 4800 });
    run(chart, 0.2);
    expect(chart.flightOut(0)).toBe(true);
    chart.setCounts([1, 0]);
    expect(chart.tubes[0]!.drops).toBe(0);
    chart.land(0, 200, 420, 0, 300);
    expect(chart.tubes[0]!.pile.n).toBe(1);
    expect(chart.flightOut(1)).toBe(true);
    chart.land(1, 1000, 420, 0, 300);
    expect(chart.tubes[1]!.pile.n).toBe(0);
  });
});

describe("pile", () => {
  it("settles, sleeps and never overlaps", () => {
    const r = 30;
    // A flat-bottomed box: the corners are too small to matter here.
    const p = createPile(80, r, { x0: 0, x1: 300, bottom: 1200, rad: 1 });
    for (let step = 0; step < 60 * 12; step++) {
      if (step % 5 === 0 && p.n < 60) p.add(150 + ((step * 37) % 100) - 50, 0, 0, 200, step % 3);
      p.step(DT, 4800);
    }
    expect(p.n).toBe(60);
    expect(p.awake).toBe(0);
    for (let i = 0; i < p.n; i++) {
      expect(p.x[i]!).toBeGreaterThanOrEqual(r - 0.5);
      expect(p.x[i]!).toBeLessThanOrEqual(300 - r + 0.5);
      expect(p.y[i]!).toBeLessThanOrEqual(1200 - r + 0.5);
      for (let j = i + 1; j < p.n; j++) {
        const d = Math.hypot(p.x[i]! - p.x[j]!, p.y[i]! - p.y[j]!);
        expect(d).toBeGreaterThan(2 * r * 0.95);
      }
    }
  });

  it("rides a rising floor without being flung, and leaves through an open one", () => {
    const p = createPile(20, 20, { x0: 0, x1: 200, bottom: 1000, rad: 1 });
    for (let i = 0; i < 10; i++) p.add(40 + i * 15, 900 - i * 45, 0, 0, 0);
    for (let s = 0; s < 240; s++) p.step(DT, 4800);
    const before = p.top();
    let highest = before;
    for (let s = 0; s < 120; s++) {
      if (s < 20) p.floor -= 5;
      p.step(DT, 4800);
      highest = Math.min(highest, p.top());
    }
    expect(highest).toBeGreaterThan(before - 130);
    expect(p.top()).toBeGreaterThan(before - 110);
    expect(p.top()).toBeLessThan(before - 90);
    p.open = true;
    p.exitY = 1100;
    p.wake();
    for (let s = 0; s < 240; s++) p.step(DT, 4800);
    expect(p.n).toBe(0);
  });
});
