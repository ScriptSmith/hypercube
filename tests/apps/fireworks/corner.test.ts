import { describe, expect, it } from "vitest";
import type { CornerSide, Director, LaunchRequest } from "../../../src/apps/fireworks/director";
import type { Engine } from "../../../src/apps/fireworks/engine";
import { positionAt } from "../../../src/apps/fireworks/path";
import { SHAPE } from "../../../src/apps/fireworks/recipe";
import { bankSky } from "../../../src/apps/fireworks/sky";
import { SHOW_PERIOD_MS } from "../../../src/apps/fireworks/show";
import {
  decodeBurst,
  decodeShell,
  encodeBurst,
  encodeShell,
} from "../../../src/apps/fireworks/wire";
import { screenDirector, W } from "./helpers";

interface Screen {
  engine: Engine;
  director: Director;
  sent: string[];
}

/**
 * Side a (x from -W to 0) and side b (0 to W) wired to each other directly, with every message
 * going through its encoding as it would on the network.
 */
const corner = (opts: { show?: boolean; options?: Record<string, boolean> } = {}) => {
  const present = { a: true, b: true };
  const screens = {} as { a: Screen; b: Screen };
  const link = (me: "a" | "b", other: "a" | "b"): CornerSide => ({
    side: me === "a" ? 0 : 1,
    partner: () => present[other],
    sendCross(s) {
      screens[me].sent.push(`cross:${s.seed}`);
      const wire = JSON.parse(JSON.stringify(encodeShell(s)));
      if (present[other]) screens[other].director.addRemoteShell((x) => decodeShell(wire, x));
    },
    sendSpill(b) {
      screens[me].sent.push(`spill:${b.seed}`);
      const wire = JSON.parse(JSON.stringify(encodeBurst(b)));
      if (present[other]) screens[other].director.addRemoteBurst((x) => decodeBurst(wire, x));
    },
    sendVolley(c, t) {
      screens[me].sent.push(`volley:${c}`);
      if (present[other]) screens[other].director.partnerVolley(c, t);
    },
  });
  const span = opts.show ? { x0: -W, x1: W } : null;
  screens.a = { ...screenDirector(link("a", "b"), -W, span, opts.options), sent: [] };
  screens.b = { ...screenDirector(link("b", "a"), 0, span, opts.options), sent: [] };
  return { screens, present };
};

const sky = bankSky(W, 0);
const shell = (x: number, angle: number, t0: number, seed: number, size = 0.8): LaunchRequest => ({
  x,
  y: -1530,
  angle,
  v: sky.v,
  g: sky.g,
  t0,
  color: 3,
  shape: SHAPE.peony,
  size,
  seed,
  frame: "p",
  pad: 0,
  exitU: 0.5,
  key: `p${seed}`,
});

const liveBursts = (e: Engine, seed: number) =>
  e.bursts.slots.filter((b) => b.live && b.seed === seed);

describe("fireworks across the corner", () => {
  it("hands a crossing shell to the other screen, and both burst it in the same place", () => {
    const { screens } = corner();
    // The corner panel on side a, tilted towards the corner.
    const s = screens.a.director.launch(shell(-540, 0.36, 50_000, 77));
    expect(s.shared).toBe(true);
    expect(screens.a.sent).toContain("cross:77");
    const copy = screens.b.engine.shells.slots.find((x) => x.live && x.seed === 77)!;
    expect(copy).toBeDefined();
    expect(copy.tb).toBe(Math.round(s.tb));
    for (const t of [0.5, 1.5]) {
      const p = positionAt(s.path, t);
      const q = positionAt(copy.path, t - (copy.t0 - s.t0) / 1000);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(5);
    }
    // Past the edge it is on side b's screen.
    expect(positionAt(s.path, (s.tb - s.t0) / 1000).x).toBeGreaterThan(0);
    screens.a.director.update(s.tb + 100);
    screens.b.director.update(s.tb + 100);
    const [ba] = liveBursts(screens.a.engine, 77);
    const [bb] = liveBursts(screens.b.engine, 77);
    expect(ba && bb).toBeTruthy();
    expect(Math.abs(ba!.x - bb!.x)).toBeLessThan(5);
    expect(Math.abs(ba!.y - bb!.y)).toBeLessThan(5);
    expect(Math.abs(ba!.t0 - bb!.t0)).toBeLessThanOrEqual(1);
    expect(bb!.count).toBe(ba!.count);
  });

  it("spills a burst near the edge, and keeps the rest to itself", () => {
    const { screens } = corner();
    // Straight up, close enough to the corner that its burst reaches over.
    screens.a.director.launch(shell(-600, 0, 60_000, 88));
    expect(screens.a.sent).toEqual(["spill:88"]);
    expect(screens.b.engine.bursts.slots.filter((b) => b.live && b.seed === 88)).toHaveLength(1);
    // Far from the corner: nothing goes across.
    screens.a.director.launch(shell(-8000, 0, 62_000, 89));
    expect(screens.a.sent).toEqual(["spill:88"]);
  });

  it("makes the edge hard when the other screen is gone: the shell bursts at the edge", () => {
    const { screens, present } = corner();
    present.b = false;
    const s = screens.a.director.launch(shell(-540, 0.36, 70_000, 99));
    expect(s.shared).toBe(false);
    expect(screens.a.sent).toEqual([]);
    const at = positionAt(s.path, (s.tb - s.t0) / 1000);
    expect(at.x).toBeCloseTo(0, 0);
  });

  it("bursts a shell it already shared at the edge if the other screen leaves before it crosses", () => {
    const { screens, present } = corner();
    const s = screens.a.director.launch(shell(-4000, 0.5, 80_000, 55, 1));
    expect(s.shared).toBe(true);
    const crossAt = s.tb;
    present.b = false;
    screens.a.director.update(80_100);
    expect(s.tb).toBeLessThan(crossAt);
    expect(positionAt(s.path, (s.tb - s.t0) / 1000).x).toBeCloseTo(0, 0);
  });

  it("makes one corner volley when both sides launch together, decided by side a", () => {
    const { screens } = corner();
    const t = 90_000;
    screens.a.director.launch(shell(-3000, 0, t, 1));
    screens.a.director.launch(shell(-6000, 0, t + 200, 2));
    screens.b.director.launch(shell(3000, 0, t + 300, 3));
    screens.b.director.launch(shell(6000, 0, t + 500, 4));
    // Side a makes the burst at the corner and spills it to b.
    const atCorner = (e: Engine) => e.bursts.slots.filter((b) => b.live && b.x === 0);
    expect(atCorner(screens.a.engine).length).toBeGreaterThan(0);
    expect(atCorner(screens.b.engine).length).toBe(atCorner(screens.a.engine).length);
    expect(screens.b.sent.filter((m) => m.startsWith("spill")).length).toBe(0);
  });

  it("needs two on each side for a corner volley", () => {
    const { screens } = corner();
    const t = 95_000;
    screens.a.director.launch(shell(-3000, 0, t, 1));
    screens.b.director.launch(shell(3000, 0, t + 300, 3));
    screens.b.director.launch(shell(6000, 0, t + 500, 4));
    expect(screens.a.engine.bursts.slots.some((b) => b.live && b.x === 0)).toBe(false);
  });

  it("plays the same show on both screens, each drawing its own side", () => {
    const { screens } = corner({ show: true });
    const key = (s: { seed: number; t0: number }) => `${s.seed}@${Math.round(s.t0)}`;
    const seen = { a: new Set<string>(), b: new Set<string>() };
    const bursts = { a: new Set<string>(), b: new Set<string>() };
    let farA = 0;
    let farB = 0;
    // Most of one show period, sampled as a frame would.
    const start = 40 * SHOW_PERIOD_MS;
    for (let t = start; t <= start + 70_000; t += 200) {
      for (const side of ["a", "b"] as const) {
        const e = screens[side].engine;
        screens[side].director.update(t);
        for (const s of e.shells.slots) {
          if (!s.live) continue;
          if (Math.abs(s.path.x) < 1500) seen[side].add(key(s));
          if (side === "a" && s.path.x > 4000) farA++;
          if (side === "b" && s.path.x < -4000) farB++;
        }
        for (const b of e.bursts.slots) if (b.live && Math.abs(b.x) < 800) bursts[side].add(key(b));
      }
    }
    // Near the corner both hold the same shells and bursts, at the same moments.
    expect(seen.a.size).toBeGreaterThan(3);
    expect([...seen.a].sort()).toEqual([...seen.b].sort());
    expect(bursts.a.size).toBeGreaterThan(3);
    expect([...bursts.a].sort()).toEqual([...bursts.b].sort());
    // Far out, each holds only its own side's.
    expect(farA).toBe(0);
    expect(farB).toBe(0);
  });
});
