import { describe, expect, it } from "vitest";
import { createAngle } from "../../../src/apps/trig/angle";
import { DEG, TAU } from "../../../src/apps/trig/config";
import { createControls } from "../../../src/apps/trig/controls";
import { graphX, type Layout, pointAt } from "../../../src/apps/trig/layout";
import { nearestSpecial, shortest, tourAngle } from "../../../src/apps/trig/maths";
import type { FrameKind } from "../../../src/core/types";
import { layoutOf } from "./helpers";

const STEP = 1000 / 60;

const rig = (kind: FrameKind = "panel", snap = false, graphs = true) => {
  const layout: Layout = layoutOf(kind);
  let t = 1000;
  const angle = createAngle(
    { snap, tour: tourAngle, holdMs: 15_000, easeMs: 2500, gotoMs: 350 },
    t,
  );
  const taken: string[] = [];
  const controls = createControls({
    layout: () => layout,
    graphs: () => graphs,
    angle,
    onTake: (hit) => taken.push(hit),
  });
  const tick = (ms = STEP) => {
    t += ms;
    angle.step(t);
  };
  /** A finger along venue points, one move a frame, then up. */
  const drag = (id: number, pts: { x: number; y: number }[], lift = true) => {
    const ok = controls.down(id, pts[0]!.x, pts[0]!.y, t, true);
    for (const p of pts.slice(1)) {
      tick();
      controls.move(id, p.x, p.y, t);
    }
    if (lift) {
      tick();
      controls.up(id, t);
    }
    return ok;
  };
  return {
    layout,
    angle,
    controls,
    taken,
    tick,
    drag,
    get t() {
      return t;
    },
  };
};

const ring = (l: Layout, a: number, rr = l.pic.r) => ({
  x: l.pic.cx + rr * Math.cos(a),
  y: l.pic.cy - rr * Math.sin(a),
});

const arc = (l: Layout, a0: number, a1: number, rr = l.pic.r, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => ring(l, a0 + ((a1 - a0) * i) / n, rr));

describe("trig controls", () => {
  it("drags the point round the circle through every quadrant, wrapping at a full turn", () => {
    const r = rig();
    r.angle.setTo(30 * DEG, r.t, false);
    r.angle.release(r.t);
    for (const [a0, a1] of [
      [30, 120],
      [120, 200],
      [200, 300],
      [300, 400],
    ]) {
      const path = arc(r.layout, a0! * DEG, a1! * DEG);
      expect(r.drag(1, path)).toBe(true);
      expect(r.taken.at(-1)).toBe("point");
      expect(shortest(r.angle.theta, (a1! % 360) * DEG)).toBeCloseTo(0, 6);
    }
  });

  it("turns by the ring relative to the finger, so the lower half alone goes all the way round", () => {
    const r = rig("wall");
    r.angle.setTo(90 * DEG, r.t, false);
    r.angle.release(r.t);
    let total = 0;
    // Sweep along the bottom of the ring, from 200° to 340°, three times.
    for (let i = 0; i < 3; i++) {
      const before = r.angle.theta;
      expect(r.drag(1, arc(r.layout, 200 * DEG, 340 * DEG, r.layout.pic.r * 0.95))).toBe(true);
      expect(r.taken.at(-1)).toBe("ring");
      const d = (((r.angle.theta - before) % TAU) + TAU) % TAU;
      expect(d / DEG).toBeCloseTo(140, 4);
      total += d;
    }
    expect(total / DEG).toBeCloseTo(420, 3);
    expect(r.angle.theta / DEG).toBeCloseTo(150, 4);
  });

  it("turns with the wheel one to one, and a flick coasts", () => {
    const r = rig();
    const w = r.layout.wheel!;
    r.angle.setTo(0, r.t, false);
    r.angle.release(r.t);
    const pt = (a: number) => ({
      x: w.x + w.r * 0.7 * Math.cos(a),
      y: w.y - w.r * 0.7 * Math.sin(a),
    });
    const slow = Array.from({ length: 61 }, (_, i) => pt((i / 60) * 1.5));
    expect(r.drag(1, slow)).toBe(true);
    expect(r.taken.at(-1)).toBe("wheel");
    expect(r.angle.theta).toBeCloseTo(1.5, 6);
    expect(r.angle.mode).toBe("hold");
    // A quarter turn in a tenth of a second, let go at once: it carries on.
    const fast = Array.from({ length: 7 }, (_, i) => pt(1.5 + (i / 6) * (Math.PI / 2)));
    r.drag(2, fast);
    expect(r.angle.mode).toBe("coast");
    let moved = 0;
    for (let i = 0; i < 30; i++) {
      const at = r.angle.theta;
      r.tick();
      moved += shortest(at, r.angle.theta);
    }
    expect(moved).toBeGreaterThan(1);
  });

  it("scrubs along the graph: the finger's position sets the angle", () => {
    const r = rig();
    const p = r.layout.pic;
    const y = p.cy + p.r * 0.3;
    expect(
      r.drag(
        1,
        [
          { x: graphX(p, 1), y },
          { x: graphX(p, 2.5), y },
          { x: graphX(p, 4), y },
        ],
        false,
      ),
    ).toBe(true);
    expect(r.taken.at(-1)).toBe("graph");
    expect(r.angle.theta).toBeCloseTo(4, 6);
    r.tick();
    r.controls.move(1, graphX(p, 7) + 30, y, r.t);
    expect(r.angle.theta).toBeCloseTo(TAU, 6);
    r.controls.up(1, r.t);
  });

  it("doesn't scrub a graph that isn't shown", () => {
    const r = rig("panel", false, false);
    const p = r.layout.pic;
    expect(r.controls.down(1, graphX(p, 3), p.cy, r.t, true)).toBe(false);
  });

  it("goes to the tick mark a tap on the ring or the graph is near", () => {
    const r = rig("kiosk", false);
    const tapAt = (x: number, y: number) => {
      r.controls.down(1, x, y, r.t, true);
      r.tick(80);
      r.controls.up(1, r.t);
      for (let i = 0; i < 40; i++) r.tick();
    };
    tapAt(ring(r.layout, 133 * DEG).x, ring(r.layout, 133 * DEG).y);
    expect(r.angle.theta / DEG).toBeCloseTo(135, 6);
    // Away from any tick, it goes where tapped.
    tapAt(ring(r.layout, 160 * DEG).x, ring(r.layout, 160 * DEG).y);
    expect(r.angle.theta / DEG).toBeCloseTo(160, 4);
    const p = r.layout.pic;
    tapAt(graphX(p, 268 * DEG), p.cy + 20);
    expect(r.angle.theta / DEG).toBeCloseTo(270, 6);
    tapAt(graphX(p, 357 * DEG), p.cy + 20);
    expect(r.angle.theta / DEG).toBeCloseTo(360, 6);
  });

  it("lets the latest finger lead, and an earlier one lead again when it lifts", () => {
    const r = rig();
    const l = r.layout;
    r.angle.setTo(0, r.t, false);
    r.angle.release(r.t);
    // Finger 1 on the graph at 1 rad, held.
    r.controls.down(1, graphX(l.pic, 1), l.pic.cy, r.t, true);
    expect(r.angle.theta).toBeCloseTo(1, 6);
    // Finger 2 on the graph at 3 rad: it leads; finger 1's moves are ignored.
    r.tick();
    r.controls.down(2, graphX(l.pic, 3), l.pic.cy, r.t, true);
    expect(r.angle.theta).toBeCloseTo(3, 6);
    r.tick();
    r.controls.move(1, graphX(l.pic, 1.5), l.pic.cy, r.t);
    expect(r.angle.theta).toBeCloseTo(3, 6);
    expect(r.controls.count).toBe(2);
    // Finger 2 lifts after a while (not a tap): finger 1 leads from where it is.
    r.tick(500);
    r.controls.up(2, r.t);
    expect(r.angle.theta).toBeCloseTo(1.5, 6);
    r.tick();
    r.controls.move(1, graphX(l.pic, 2), l.pic.cy, r.t);
    expect(r.angle.theta).toBeCloseTo(2, 6);
    r.controls.up(1, r.t);
    expect(r.controls.count).toBe(0);
  });

  it("sticks at special angles while dragging slowly with snap on", () => {
    const r = rig("wall", true);
    r.angle.setTo(20 * DEG, r.t, false);
    r.angle.release(r.t);
    for (let i = 0; i < 30; i++) r.tick();
    const p0 = pointAt(r.layout.pic, r.angle.theta);
    const path = [p0, ...arc(r.layout, 20 * DEG, 31 * DEG, r.layout.pic.r, 66)];
    r.drag(1, path, false);
    expect(r.angle.theta / DEG).toBeCloseTo(30, 9);
    expect(nearestSpecial(r.angle.theta, 1e-9)).not.toBeNull();
    r.controls.up(1, r.t);
  });

  it("ignores touches off every control, and on the screen", () => {
    const r = rig();
    expect(r.controls.down(1, 1070, 40, r.t, true)).toBe(false);
    const s = rig("screen");
    expect(s.controls.down(1, s.layout.pic.cx, s.layout.pic.cy - s.layout.pic.r, s.t, true)).toBe(
      false,
    );
  });
});
