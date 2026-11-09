import { describe, expect, it } from "vitest";
import { RESET_SIZE, SEAM_CLEAR, slotsOf } from "../../../src/apps/manyhands/layout";
import { createHold } from "../../../src/apps/manyhands/tasks/hold";
import { createRng } from "../../../src/core/rng";
import { inputFor, layoutOf } from "./helpers";

const inside = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  a.x >= b.x - 1e-6 &&
  a.y >= b.y - 1e-6 &&
  a.x + a.w <= b.x + b.w + 1e-6 &&
  a.y + a.h <= b.y + b.h + 1e-6;
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layout", () => {
  it("a panel is one workstation: child slot in the child band, adult slot above, strip on top", () => {
    const l = layoutOf("panel");
    const i = inputFor("panel");
    expect(l.stations).toHaveLength(1);
    const st = l.stations[0]!;
    expect(st.low.rect.y).toBeGreaterThanOrEqual(i.reachTop.child);
    expect(st.low.rect.y + st.low.rect.h).toBeLessThanOrEqual(1920);
    expect(st.high).not.toBeNull();
    expect(st.high!.rect.y + st.high!.rect.h).toBeLessThanOrEqual(i.reachTop.child);
    expect(st.high!.rect.y).toBeGreaterThanOrEqual(l.top.y + l.top.h);
    expect(st.low.target).toBeGreaterThanOrEqual(180);
    expect(st.high!.target).toBeGreaterThanOrEqual(120);
  });

  it("a pair is two workstations, nothing of a task within 120 px of the seam, rails away from it", () => {
    const l = layoutOf("pair");
    expect(l.stations).toHaveLength(2);
    for (const { spec } of slotsOf(l)) {
      const t = spec.task;
      expect(t.x + t.w <= 1080 - SEAM_CLEAR || t.x >= 1080 + SEAM_CLEAR, "task clear of seam").toBe(
        true,
      );
      expect(Math.abs(spec.reset.x - 1080)).toBeGreaterThan(SEAM_CLEAR + 200);
    }
    const [left, right] = l.stations;
    expect(left!.low.rail.x).toBeLessThan(left!.low.task.x);
    expect(right!.low.rail.x).toBeGreaterThan(right!.low.task.x);
  });

  it("the wall puts child slots in the child band and adult slots in the narrow band above", () => {
    for (const stations of [4, 6, 8]) {
      const i = inputFor("wall", { stations });
      const l = layoutOf("wall", { stations });
      expect(l.stations).toHaveLength(stations);
      for (const st of l.stations) {
        expect(st.low.rect.y).toBeGreaterThanOrEqual(i.reachTop.child);
        expect(st.high!.rect.y).toBeGreaterThanOrEqual(i.reachTop.adult);
        expect(st.high!.rect.y + st.high!.rect.h).toBeLessThanOrEqual(i.reachTop.child);
        expect(st.high!.task.w / st.high!.task.h, "wide, short adult tasks").toBeGreaterThan(1.5);
        expect(st.low.coarse).toBe(true);
      }
      // The build fills everything above adult reach.
      expect(l.top.y + l.top.h).toBeLessThanOrEqual(i.reachTop.adult);
    }
  });

  it("slots, rails and resets stay inside the frame and apart", () => {
    for (const [kind, over] of [
      ["panel", {}],
      ["pair", {}],
      ["wall", { stations: 4 }],
      ["wall", { stations: 8 }],
      ["panel", { slots: "low" }],
      ["wall", { slots: "low" }],
    ] as const) {
      const l = layoutOf(kind, over);
      const frame = { x: 0, y: 0, w: l.width, h: l.height };
      const specs = slotsOf(l).map((s) => s.spec);
      for (const s of specs) {
        expect(inside(s.rect, frame)).toBe(true);
        expect(inside(s.task, s.rect)).toBe(true);
        expect(inside(s.rail, s.rect)).toBe(true);
        expect(overlaps(s.task, s.rail)).toBe(false);
        const r = {
          x: s.reset.x - s.reset.r,
          y: s.reset.y - s.reset.r,
          w: 2 * s.reset.r,
          h: 2 * s.reset.r,
        };
        expect(inside(r, s.rail)).toBe(true);
        expect(s.reset.r * 2).toBeGreaterThanOrEqual(RESET_SIZE);
      }
      for (let a = 0; a < specs.length; a++) {
        for (let b = a + 1; b < specs.length; b++) {
          expect(overlaps(specs[a]!.rect, specs[b]!.rect)).toBe(false);
        }
      }
      // Home is free of every task and reset control.
      for (const s of specs) {
        expect(overlaps(l.home, s.task)).toBe(false);
        const r = {
          x: s.reset.x - s.reset.r,
          y: s.reset.y - s.reset.r,
          w: 2 * s.reset.r,
          h: 2 * s.reset.r,
        };
        expect(overlaps(l.home, r)).toBe(false);
      }
      if (over.slots === "low") {
        expect(l.stations.every((s) => s.high === null)).toBe(true);
        expect(l.scene).not.toBeNull();
      }
    }
  });

  it("the Home spot is within reach", () => {
    const i = inputFor("wall");
    const l = layoutOf("wall");
    expect(l.home.y).toBeGreaterThanOrEqual(i.reachTop.adult);
    expect(l.home.y + l.home.h).toBeLessThanOrEqual(i.reachTop.child);
  });

  it("hold pads on a panel are at most 500 px apart, so one child can span them", () => {
    for (const kind of ["panel", "pair"] as const) {
      for (const { spec } of slotsOf(layoutOf(kind))) {
        const task = createHold({
          w: spec.task.w,
          h: spec.task.h,
          rng: createRng("x"),
          color: "#fff",
          target: spec.target,
          coarse: false,
        });
        const bot = task.bot(1)!;
        const fingers = bot.at(0)!;
        const [a, b] = fingers as { x: number; y: number }[];
        expect(Math.abs(a!.x - b!.x)).toBeLessThanOrEqual(500);
      }
    }
  });

  it("drops the adult slot when the adult band is too short for one", () => {
    const l = layoutOf("panel", { reachTop: { adult: 850, child: 1047 } });
    expect(l.stations[0]!.high).toBeNull();
    expect(l.top.h).toBeGreaterThanOrEqual(780);
  });
});
