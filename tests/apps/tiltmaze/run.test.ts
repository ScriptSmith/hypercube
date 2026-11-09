import { describe, expect, it } from "vitest";
import {
  CLOSE_S,
  createRun,
  FULL_S,
  OPEN_S,
  reachTime,
  type Run,
  TUBE_A,
  TUBE_V,
  tubeY,
} from "../../../src/apps/tiltmaze/run";
import {
  buildPlan,
  entryOn,
  fitCapacity,
  jarRows,
  type PlanInput,
  pointAt,
  type RunPlan,
  TUBE_HEAD,
} from "../../../src/apps/tiltmaze/runplan";

const DT = 1 / 60;

/** A screen-sized run: rails across, jar in the middle. */
const screenInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  rb: 0.045,
  rbMax: 1,
  capacity: 20,
  x0: -3.3,
  x1: 3.3,
  top: 8.2,
  railBottom: 5.4,
  jar: { cx: 0, floor: 3.0, maxW: 2 },
  maxDrop: 26,
  ...over,
});

/** A panel's small run: one tube in the middle, the jar at the right. */
const panelInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  rb: null,
  rbMax: 0.015,
  capacity: 20,
  x0: -0.31,
  x1: 0.31,
  top: 2.14,
  railBottom: 2.0,
  jar: { cx: 0.22, floor: 1.77, maxW: 0.19 },
  ...over,
});

const rig = (plan: RunPlan, tubes: { x: number; yBase: number }[], maxBalls = 90) => {
  let ms = 0;
  const run = createRun(() => ms, maxBalls);
  run.setPlan(plan);
  run.setTubes(tubes);
  return {
    run,
    step(seconds: number, each?: (run: Run) => void) {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        ms += DT * 1000;
        run.step(DT);
        each?.(run);
      }
    },
    now: () => ms,
  };
};

describe("tiltmaze run plan", () => {
  it("fits the jar to its balls, every slot inside it and none overlapping", () => {
    for (const capacity of [10, 20, 33, 40]) {
      for (const input of [screenInput({ capacity }), panelInput({ capacity })]) {
        const p = buildPlan(input);
        const j = p.jar;
        expect(j.slots).toHaveLength(capacity);
        for (const s of j.slots) {
          expect(s.x - p.rb).toBeGreaterThanOrEqual(j.cx - j.w / 2 - 1e-9);
          expect(s.x + p.rb).toBeLessThanOrEqual(j.cx + j.w / 2 + 1e-9);
          expect(s.y - p.rb).toBeGreaterThanOrEqual(j.bottom - 1e-9);
          expect(s.y + p.rb).toBeLessThanOrEqual(j.mouth + 1e-9);
        }
        for (let a = 0; a < j.slots.length; a++) {
          for (let b = a + 1; b < j.slots.length; b++) {
            const d = Math.hypot(j.slots[a]!.x - j.slots[b]!.x, j.slots[a]!.y - j.slots[b]!.y);
            expect(d).toBeGreaterThanOrEqual(2 * p.rb - 1e-9);
          }
        }
        // Filled from the bottom row up.
        for (let i = 1; i < j.slots.length; i++) {
          expect(j.slots[i]!.y).toBeGreaterThanOrEqual(j.slots[i - 1]!.y - 1e-9);
        }
        expect(jarRows(capacity, j.perRow)).toBeGreaterThan(0);
      }
    }
  });

  it("zigzags across a tall screen and runs one rail on a short panel", () => {
    const tall = buildPlan(screenInput());
    expect(tall.rails).toBe(3);
    expect(tall.paths.map((p) => p.side).sort()).toEqual([-1, 1]);
    const short = buildPlan(panelInput());
    expect(short.rails).toBe(1);
    // The panel's jar is at the right, so only the left side has a rail.
    expect(short.paths.map((p) => p.side)).toEqual([-1]);
    expect(short.rb).toBeLessThanOrEqual(0.015);
  });

  it("keeps rails inside their area, under the tubes' heads, ending over the jar's mouth", () => {
    for (const input of [screenInput(), panelInput(), screenInput({ capacity: 40 })]) {
      const p = buildPlan(input);
      for (const path of p.paths) {
        for (const pt of path.pts) {
          expect(pt.x).toBeGreaterThanOrEqual(input.x0);
          expect(pt.x).toBeLessThanOrEqual(input.x1);
          expect(pt.y).toBeLessThanOrEqual(input.top - TUBE_HEAD * p.rb);
        }
        const end = path.pts[path.pts.length - 1]!;
        expect(Math.abs(end.x - p.jar.cx)).toBeLessThan(p.jar.w / 2 - p.rb);
        expect(end.y).toBeGreaterThan(p.jar.mouth + p.rb);
        // Downhill all the way.
        for (let i = 1; i < path.pts.length; i++) {
          expect(path.pts[i]!.y).toBeLessThanOrEqual(path.pts[i - 1]!.y + 1e-9);
        }
      }
      // The lowest rail stays above the line it was given, when there's room.
      if (p.rails === 3) {
        for (const path of p.paths) {
          expect(path.pts[path.pts.length - 1]!.y).toBeGreaterThanOrEqual(input.railBottom - 1e-9);
        }
      }
    }
  });

  it("finds how many big balls fit a small jar", () => {
    expect(fitCapacity(0.045, 0.2, 0.4, 20)).toBeLessThan(20);
    expect(fitCapacity(0.045, 0.2, 0.4, 20)).toBeGreaterThanOrEqual(3);
    expect(fitCapacity(0.01, 2, 2, 20)).toBe(20);
  });
});

describe("tiltmaze run", () => {
  it("rises up a tube at the same height for the same shared time on both sides of an edge", () => {
    const plan = buildPlan(screenInput());
    const frame = rig(plan, [{ x: -3, yBase: 1.7 }]);
    const out = frame.run.launchOut(0, 3, true, 2.16)!;
    expect(out).not.toBeNull();
    const rb = plan.rb;
    // Its kinematics reach the edge at the time and speed it says.
    const hit = reachTime(1.7, TUBE_A * rb, TUBE_V * rb, 2.16);
    expect(out.t).toBeCloseTo(hit.t, 6);
    expect(out.v).toBeCloseTo(hit.v, 6);
    // The screen carries it on from the edge; both agree just above the edge.
    const screen = rig(plan, [{ x: -3, yBase: 2.06 }]);
    screen.run.arrive(0, 3, true, out.t, 2.16, out.v);
    frame.step(out.t / 1000 + 0.01);
    screen.step(out.t / 1000 + 0.01);
    const a = frame.run.balls[0];
    const b = screen.run.balls[0]!;
    expect(a?.y ?? Infinity).toBeCloseTo(b.y, 6);
    // On the frame it leaves past the edge; on the screen it goes on up.
    frame.step(0.5);
    expect(frame.run.balls.filter((x) => x.state !== "out")).toHaveLength(0);
    expect(screen.run.balls[0]!.state).toBe("tube");
  });

  it("puts a late ball where it would be by now, not at the bottom", () => {
    const plan = buildPlan(screenInput());
    const r = rig(plan, [{ x: -3, yBase: 2.06 }]);
    r.step(1);
    r.run.arrive(0, 0, false, r.now() - 300, 2.16, 2.6);
    r.step(DT);
    expect(r.run.balls[0]!.y).toBeCloseTo(2.16 + 2.6 * (0.3 + DT), 3);
    expect(tubeY(r.run.balls[0]!, r.now())).toBeCloseTo(2.16 + 2.6 * (0.3 + DT), 3);
  });

  it("never lets balls overlap on the rails, and fills, empties and refills the jar", () => {
    const plan = buildPlan(screenInput({ capacity: 12 }));
    const tubes = [-3, -2.2, -1.4, -0.6, 0.6, 1.4, 2.2, 3].map((x) => ({ x, yBase: 2.06 }));
    const r = rig(plan, tubes);
    const events: string[] = [];
    let launched = 0;
    let minGap = Infinity;
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    r.step(120, (run) => {
      if (random() < 0.06) {
        const t = Math.floor(random() * tubes.length);
        if (run.arrive(t, launched % 8, false, r.now() + 50, 2.06, 2.6)) launched++;
      }
      for (const path of [0, 1]) {
        const on = run.balls.filter((b) => b.path === path && b.state === "rail");
        for (let a = 0; a < on.length; a++) {
          for (let b = a + 1; b < on.length; b++) {
            minGap = Math.min(minGap, Math.hypot(on[a]!.x - on[b]!.x, on[a]!.y - on[b]!.y));
          }
        }
      }
      for (const e of run.events) events.push(e.type);
      run.events.length = 0;
      expect(run.balls.length).toBeLessThanOrEqual(90);
      expect(run.jar.count).toBeLessThanOrEqual(12);
    });
    expect(launched).toBeGreaterThan(30);
    expect(minGap).toBeGreaterThanOrEqual(2 * plan.rb - 1e-6);
    expect(events.filter((e) => e === "full").length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e === "emptied").length).toBeGreaterThanOrEqual(2);
    expect(r.run.counts.jarred).toBeGreaterThanOrEqual(24);
  });

  it("goes through full, open and close in order, holding new balls at the end of the rail", () => {
    const plan = buildPlan(screenInput({ capacity: 10 }));
    const r = rig(plan, [{ x: -2, yBase: 2.06 }]);
    const feed = (n: number) => {
      for (let i = 0; i < n; i++) {
        r.run.arrive(0, i % 8, false, r.now(), 2.06, 2.6);
        r.step(0.5);
      }
    };
    const phases: string[] = [];
    let held = false;
    const watch = (run: Run) => {
      if (phases[phases.length - 1] !== run.jar.phase) phases.push(run.jar.phase);
      if (run.jar.phase === "full") expect(run.jar.count).toBe(10);
      if (run.jar.phase !== "fill" && run.balls.some((b) => b.state === "rail")) held = true;
    };
    feed(10);
    // One more on its way while the jar fills, empties and closes: it waits, then drops in.
    r.step(10, watch);
    feed(1);
    r.step(30, watch);
    expect(phases.slice(0, 5)).toEqual(["fill", "full", "open", "close", "fill"]);
    expect(r.run.counts.emptied).toBe(1);
    expect(FULL_S + OPEN_S + CLOSE_S).toBeLessThan(6);
    expect(r.run.jar.count).toBe(1);
    expect(held || r.run.counts.jarred === 11).toBe(true);
  });

  it("refuses balls beyond its bounds", () => {
    const plan = buildPlan(screenInput());
    const r = rig(plan, [{ x: -2, yBase: 2.06 }], 8);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (r.run.arrive(0, 0, false, r.now() + 1e6, 2.06, 2.6)) ok++;
    expect(ok).toBeLessThanOrEqual(8);
    expect(r.run.counts.refused).toBeGreaterThan(0);
  });

  it("delivers a tube's ball onto the top rail where the tube stands", () => {
    const plan = buildPlan(screenInput());
    const path = plan.paths.find((p) => p.side === -1)!;
    const e = entryOn(path, -1.5);
    expect(e.p.x).toBeCloseTo(-1.5, 9);
    const at = pointAt(path, e.s, { x: 0, y: 0 });
    expect(at.x).toBeCloseTo(-1.5, 9);
    expect(at.y).toBeCloseTo(e.p.y, 9);
  });

  it("keeps its jar's balls through a new plan", () => {
    const plan = buildPlan(screenInput({ capacity: 10 }));
    const r = rig(plan, [{ x: -2, yBase: 2.06 }]);
    for (let i = 0; i < 3; i++) r.run.arrive(0, 0, false, r.now() + i * 500, 2.06, 2.6);
    r.step(25);
    expect(r.run.jar.count).toBe(3);
    r.run.setPlan(buildPlan(screenInput({ capacity: 10, x0: -3, x1: 3 })));
    expect(r.run.jar.count).toBe(3);
    r.run.empty();
    r.step(6);
    expect(r.run.jar.count).toBe(0);
  });
});
