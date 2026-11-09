import { describe, expect, it } from "vitest";
import { tuningFor } from "../../../src/apps/kaleido/config";
import {
  createEmitters,
  createPourSet,
  MAX_EMITTERS,
  type PourLook,
  splatOf,
} from "../../../src/apps/kaleido/pours";
import { testRng } from "./helpers";

const GOLD = [1, 0.8, 0.2] as const;

const lookOf = (kind: "wall" | "panel" | "screen"): PourLook => {
  const t = tuningFor(kind);
  return {
    radius: t.radius,
    warm: t.warm,
    hot: t.hot,
    jetWarm: t.jetWarm,
    jetHot: t.jetHot,
    follow: t.follow,
    maxSpeed: t.physics.maxSpeed,
    inkRate: t.inkRate,
    inkStrength: t.inkStrength,
  };
};

describe("pours", () => {
  it("give each live pour its own small id and stop at the limit", () => {
    const set = createPourSet(4);
    for (let i = 0; i < 6; i++) set.start(100 + i, 10 * i, 50, GOLD, true, i);
    expect(set.size).toBe(4);
    expect(new Set(set.list.map((p) => p.wire)).size).toBe(4);
    set.end(101);
    const p = set.start(200, 0, 0, GOLD, false, 9);
    expect(p).not.toBeNull();
    expect(p!.wire).toBe(1);
    expect(set.start(200, 5, 5, GOLD, false, 10)).toBe(p);
    set.clear();
    expect(set.size).toBe(0);
  });

  it("splat along the path moved since the last step, then start from there", () => {
    const set = createPourSet();
    const p = set.start(1, 100, 900, GOLD, true, 0)!;
    set.move(1, 160, 880, 600, -200);
    const s = splatOf(p, lookOf("panel"), 1 / 60, 0);
    expect([s.x0, s.y0, s.x1, s.y1]).toEqual([100, 900, 160, 880]);
    const s2 = splatOf(p, lookOf("panel"), 1 / 60, 0);
    expect([s2.x0, s2.y0]).toEqual([160, 880]);
  });

  it("jet upwards from a still finger, hot faster than warm, and follow a moving one", () => {
    const look = lookOf("wall");
    const set = createPourSet();
    const p = set.start(1, 500, 2000, GOLD, true, 0)!;
    const warm = splatOf(p, look, 1 / 60, 0);
    p.hot = true;
    const hot = splatOf(p, look, 1 / 60, 0);
    expect(warm.vy).toBeLessThan(0);
    expect(hot.vy).toBeLessThan(warm.vy);
    expect(hot.temp).toBeGreaterThan(warm.temp);
    set.move(1, 520, 2000, 1500, 0);
    const moving = splatOf(p, look, 1 / 60, 0);
    expect(moving.vx).toBeGreaterThan(400);
    // Never faster than the fluid allows.
    set.move(1, 520, 2000, 1e6, 1e6);
    const wild = splatOf(p, look, 1 / 60, 0);
    expect(Math.hypot(wild.vx, wild.vy)).toBeLessThanOrEqual(look.maxSpeed);
  });

  it("blend in ink, heat and push by the step's length, never past full", () => {
    const set = createPourSet();
    const p = set.start(1, 0, 0, GOLD, true, 0)!;
    const short = splatOf(p, lookOf("panel"), 1 / 120, 0);
    const long = splatOf(p, lookOf("panel"), 1 / 30, 0);
    for (const k of ["ink", "heat", "push"] as const) {
      expect(long[k]).toBeGreaterThan(short[k]);
      expect(long[k]).toBeLessThan(1);
      expect(short[k]).toBeGreaterThan(0);
    }
    for (const v of long.rgb) expect(v).toBeLessThanOrEqual(1);
  });
});

describe("attract emitters", () => {
  const make = (count: number) =>
    createEmitters({
      count,
      x0: 100,
      x1: 6000,
      y: 2000,
      hotShare: 0.4,
      pour: [3, 6],
      rest: [2, 5],
      colour: () => GOLD,
      rng: testRng(7),
    });

  it("pour for a few seconds, rest for a few, and wander along the bottom", () => {
    const e = make(3);
    let onTime = 0;
    const xs: number[] = [];
    for (let i = 0; i < 60 * 120; i++) {
      e.update(1 / 60, true, i);
      onTime += e.pours.length / 60;
      for (const p of e.pours) {
        xs.push(p.x);
        expect(p.y).toBeGreaterThan(1900);
        expect(p.human).toBe(false);
      }
    }
    // Three emitters, each on about half the time.
    expect(onTime / 120).toBeGreaterThan(0.9);
    expect(onTime / 120).toBeLessThan(2.4);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...xs)).toBeLessThanOrEqual(6000);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3000);
  });

  it("stop when switched off and stay bounded", () => {
    const e = make(99);
    for (let i = 0; i < 600; i++) e.update(1 / 60, true, i);
    expect(e.pours.length).toBeLessThanOrEqual(MAX_EMITTERS);
    for (let i = 0; i < 60 * 8; i++) e.update(1 / 60, false, i);
    expect(e.pours).toHaveLength(0);
    e.update(1 / 60, true, 0);
    e.clear();
    expect(e.pours).toHaveLength(0);
  });
});
