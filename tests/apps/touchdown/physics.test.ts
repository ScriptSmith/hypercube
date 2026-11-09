import { describe, expect, it } from "vitest";
import type { Assist } from "../../../src/apps/touchdown/config";
import {
  type Craft,
  NO_THRUST,
  type Physics,
  physicsFor,
  stepCraft,
  type Thrust,
  wrap,
} from "../../../src/apps/touchdown/craft";
import { DT, layoutOf } from "./helpers";

const physics = (assist: Assist = "gentle", variant: "duo" | "crew" = "duo"): Physics => {
  const layout = layoutOf("pair", variant);
  return physicsFor(layout, layout.crews[0]!.lane, assist);
};

/** A craft hovering mid-frame, upright and still. */
const still = (p: Physics, a = 0): Craft => ({
  x: (p.x0 + p.x1) / 2,
  y: 900,
  vx: 0,
  vy: 0,
  a,
  w: 0,
});

const fly = (c: Craft, p: Physics, th: Partial<Thrust>, seconds: number, wind = 0) => {
  const thrust = { ...NO_THRUST, ...th };
  for (let i = 0; i < Math.round(seconds / DT); i++) stepCraft(c, thrust, p, wind, DT);
  return c;
};

describe("touchdown craft", () => {
  it("turns clockwise and lifts on the left engine alone", () => {
    const p = physics("off");
    const free = fly(still(p), p, {}, 1);
    const c = fly(still(p), p, { left: true }, 1);
    expect(c.a).toBeGreaterThan(0.2);
    expect(c.w).toBeGreaterThan(0);
    expect(c.vy).toBeLessThan(free.vy * 0.3);
    // Tilted right and pushed inward, it drifts right.
    expect(c.vx).toBeGreaterThan(0);
  });

  it("turns anticlockwise on the right engine alone", () => {
    const p = physics("off");
    const c = fly(still(p), p, { right: true }, 1);
    expect(c.a).toBeLessThan(-0.2);
    expect(c.vx).toBeLessThan(0);
  });

  it("lifts straight up on both engines", () => {
    for (const assist of ["off", "gentle", "strong"] as const) {
      const p = physics(assist);
      const c = fly(still(p), p, { left: true, right: true }, 4);
      expect(Math.abs(c.a)).toBeLessThan(1e-9);
      expect(Math.abs(c.vx)).toBeLessThan(1e-9);
      expect(c.vy).toBeLessThan(-10 * p.q);
      expect(c.y).toBeLessThan(900);
    }
  });

  it("falls at a steady, gentle speed with no engines", () => {
    const p = physics();
    const c = fly(still(p), p, {}, 30);
    expect(c.vy).toBeCloseTo(p.g / p.drag, 0);
  });

  it("runs the crew variant's main engine and turn thrusters", () => {
    const p = physics("off", "crew");
    const up = fly(still(p), p, { main: true }, 3);
    expect(up.vy).toBeLessThan(0);
    expect(Math.abs(up.a)).toBeLessThan(1e-9);
    expect(fly(still(p), p, { turnRight: true }, 1).a).toBeGreaterThan(0.2);
    expect(fly(still(p), p, { turnLeft: true }, 1).a).toBeLessThan(-0.2);
    // Duo pads do nothing to a crew craft, and the reverse.
    expect(fly(still(p), p, { left: true }, 1).a).toBe(0);
    const duo = physics("off");
    expect(fly(still(duo), duo, { main: true, turnLeft: true }, 1).a).toBe(0);
  });

  it("levels the craft when no engine fires, with the assist on", () => {
    for (const assist of ["gentle", "strong"] as const) {
      const p = physics(assist);
      const c = fly(still(p, 0.6), p, {}, 4);
      expect(Math.abs(wrap(c.a))).toBeLessThan(0.05);
    }
    const off = physics("off");
    const c = fly(still(off, 0.6), off, {}, 4);
    expect(c.a).toBeGreaterThan(0.55);
  });

  it("levels faster with the strong assist than the gentle one", () => {
    const gentle = physics("gentle");
    const strong = physics("strong");
    const g = fly(still(gentle, 0.6), gentle, {}, 1);
    const s = fly(still(strong, 0.6), strong, {}, 1);
    expect(Math.abs(s.a)).toBeLessThan(Math.abs(g.a));
  });

  it("also levels while both engines fire, but not while one turns it", () => {
    const p = physics("gentle");
    expect(Math.abs(fly(still(p, 0.5), p, { left: true, right: true }, 4).a)).toBeLessThan(0.05);
    expect(fly(still(p, 0.5), p, { left: true }, 1).a).toBeGreaterThan(0.5);
  });

  it("damps spin more with more assist", () => {
    const spin = (assist: Assist) => {
      const p = physics(assist);
      const c = still(p);
      c.w = 2;
      return fly(c, p, { left: true, right: true }, 1).w;
    };
    expect(spin("strong")).toBeLessThan(spin("gentle"));
    expect(spin("gentle")).toBeLessThan(spin("off"));
  });

  it("never lets one engine turn the craft upside down with the assist on", () => {
    const strong = physics("strong");
    const s = fly(still(strong), strong, { left: true }, 6);
    expect(Math.abs(wrap(s.a))).toBeLessThan((47 * Math.PI) / 180);
    const gentle = physics("gentle");
    const g = fly(still(gentle), gentle, { right: true }, 6);
    expect(Math.abs(wrap(g.a))).toBeLessThan((80 * Math.PI) / 180);
    const off = physics("off");
    expect(fly(still(off), off, { left: true }, 6).a).toBeGreaterThan(Math.PI);
  });

  it("does nothing on an empty tank", () => {
    const p = physics("off");
    const c = fly(still(p), p, { left: true, power: 0 }, 2);
    const free = fly(still(p), p, {}, 2);
    expect(c.vy).toBeCloseTo(free.vy, 6);
    expect(c.a).toBe(0);
  });

  it("drifts with the wind and stays inside its lane and below the ceiling", () => {
    const p = physics();
    const c = fly(still(p), p, {}, 10, 20 * p.q);
    expect(c.vx).toBeGreaterThan(15 * p.q);
    const up = fly(still(p), p, { left: true, right: true }, 60);
    expect(up.y).toBeGreaterThanOrEqual(p.ceiling);
    const side = still(p);
    side.vx = 400;
    fly(side, p, {}, 20);
    expect(side.x).toBeLessThanOrEqual(p.x1);
    expect(side.x).toBeGreaterThanOrEqual(p.x0);
  });
});
