import { describe, expect, it } from "vitest";
import {
  coastLever,
  createControls,
  type ControlHandlers,
  releaseLever,
} from "../../../src/apps/fourd/controls";
import { defaultLever, dialTurn, dimsFor } from "../../../src/apps/fourd/frame";
import { leverX } from "../../../src/apps/fourd/layout";
import { createOrbit, ORBIT } from "../../../src/apps/fourd/orbit";
import { restRot } from "../../../src/apps/fourd/orient";
import { shapeOf } from "../../../src/apps/fourd/shapes";
import { readConfig } from "../../../src/apps/fourd/config";
import { SHOW_S, showAt } from "../../../src/apps/fourd/show";
import { cutOf, extent } from "../../../src/apps/fourd/slice";
import { layoutOf } from "./helpers";

const recorder = () => {
  const calls: string[] = [];
  const turns: number[] = [];
  const h: ControlHandlers = {
    lever: (s, t, who) => calls.push(`lever ${s} ${t.toFixed(2)} ${who}`),
    leverUp: (s, vt) => calls.push(`up ${s} ${vt.toFixed(1)}`),
    turn: (s, d, delta, who) => {
      if (delta !== 0) turns.push(delta);
      calls.push(`turn ${s} ${d} ${who}`);
    },
    orient: (s, k, who) => calls.push(`orient ${s} ${k} ${who}`),
    shape: (s, f, who) => calls.push(`shape ${s} ${f} ${who}`),
    viewDown: (s, v) => calls.push(`view ${s} ${v}`),
    viewMove: () => undefined,
    viewUp: (s) => calls.push(`viewup ${s}`),
  };
  return { calls, turns, h };
};

describe("controls", () => {
  const layout = layoutOf("panel", [4]);
  const st = layout.stages[0]!;

  it("the lever jumps to the finger and follows it", () => {
    const { calls, h } = recorder();
    const c = createControls(layout, h);
    const lv = st.lever!;
    c.down(1, leverX(lv, -0.5), lv.y, "person");
    c.move(1, leverX(lv, 0.25), lv.y + 30);
    c.up(1, 400);
    expect(calls).toEqual([
      "lever 0 -0.50 person",
      "lever 0 0.25 person",
      expect.stringMatching(/^up 0 /),
    ]);
  });

  it("a dial turns one to one with the finger's angle, clockwise positive", () => {
    const { turns, h } = recorder();
    const c = createControls(layout, h);
    const d = st.dials[1]!;
    const at = (a: number) =>
      [d.x + Math.cos(a) * d.r * 0.7, d.y + Math.sin(a) * d.r * 0.7] as const;
    c.down(2, ...at(0), "bot");
    for (let i = 1; i <= 10; i++) c.move(2, ...at((i / 10) * (Math.PI / 2)));
    c.up(2, 0);
    expect(turns.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.PI / 2, 9);
    // The dead centre gives no angle.
    c.down(3, d.x, d.y, "person");
    c.move(3, d.x + 1, d.y);
    expect(turns.length).toBe(10);
  });

  it("buttons act as the finger lands; the view elsewhere", () => {
    const { calls, h } = recorder();
    const c = createControls(layout, h);
    const o = st.orients.find((x) => x.k === 0)!;
    c.down(4, o.rect.x + 10, o.rect.y + 10, "person");
    const s = st.shapes[3]!;
    c.down(5, s.rect.x + 5, s.rect.y + 5, "bot");
    const v = st.views[0]!.focus;
    c.down(6, v.x + v.width / 2, v.y + 50, "person");
    c.up(6, 0);
    expect(calls).toEqual(["orient 0 0 person", "shape 0 3 bot", "view 0 0", "viewup 0"]);
    expect(c.holder(0, "lever")).toBeNull();
  });

  it("a second finger takes a dial over", () => {
    const { h } = recorder();
    const c = createControls(layout, h);
    const d = st.dials[0]!;
    c.down(7, d.x + d.r * 0.5, d.y, "person");
    c.down(8, d.x, d.y + d.r * 0.5, "person");
    expect(c.holder(0, "dial", 0)).toBe(8);
    expect(c.fingers.size).toBe(1);
  });

  it("a flicked lever coasts and stops at its ends", () => {
    const s = { t: 0, v: 0 };
    releaseLever(s, 3);
    let moved = 0;
    for (let i = 0; i < 120; i++) if (coastLever(s, 1 / 60)) moved++;
    expect(moved).toBeGreaterThan(5);
    expect(s.t).toBeLessThanOrEqual(1);
    expect(s.v).toBe(0);
    const slow = { t: 0.2, v: 0 };
    releaseLever(slow, 0.1);
    expect(coastLever(slow, 1 / 60)).toBe(false);
  });
});

describe("the bank's flip-book", () => {
  it("spreads the default slices evenly through the shape at rest", () => {
    const s = shapeOf("cube", 4);
    const e = extent(s, restRot(s), 3);
    const cuts = Array.from({ length: 6 }, (_, p) => cutOf(4, defaultLever(s, p, 6)));
    cuts.forEach((c, p) => expect(c).toBeCloseTo(e.lo + ((e.hi - e.lo) * (p + 0.5)) / 6, 9));
    // All inside the shape, all different.
    for (const c of cuts) expect(c > e.lo && c < e.hi).toBe(true);
    expect(new Set(cuts.map((c) => c.toFixed(6))).size).toBe(6);
    // A pyramid's extent is lopsided; the spread follows it.
    const p = shapeOf("pyramid", 4);
    const ep = extent(p, restRot(p), 3);
    expect(cutOf(4, defaultLever(p, 0, 5))).toBeCloseTo(ep.lo + (ep.hi - ep.lo) * 0.1, 9);
  });

  it("picks the stages each frame shows", () => {
    const hyper = readConfig("hyper", {});
    const flat = readConfig("flat", {});
    expect(dimsFor("wall", hyper, false)).toEqual([2, 3, 4]);
    expect(dimsFor("wall", readConfig("hyper", { ladder: false }), false)).toEqual([4, 4, 4]);
    expect(dimsFor("wall", flat, false)).toEqual([2, 3, 4]);
    expect(dimsFor("pair", hyper, false)).toEqual([3, 4]);
    expect(dimsFor("pair", flat, false)).toEqual([3, 3]);
    expect(dimsFor("pair", hyper, true)).toEqual([4]);
    expect(dimsFor("panel", flat, true)).toEqual([3]);
    expect(dimsFor("screen", hyper, false)).toEqual([2, 3, 4]);
    expect(dialTurn(2, 0.3)).toBe(-0.3);
    expect(dialTurn(4, 0.3)).toBe(0.3);
  });
});

describe("show", () => {
  it("loops, sweeps the lever, turns corner first and back, and turns a whole way round", () => {
    const at = (s: number) => showAt(s, 4, "cube");
    expect(at(0).lever).toBe(-1);
    expect(at(0).caption).toBe("We see only a slice of a 4D shape");
    expect(at(5).ghost?.kind).toBe("lever");
    expect(at(8.5).lever).toBeCloseTo(1, 9);
    expect(at(9.2).ghost).toEqual({ kind: "orient", k: 0 });
    expect(at(11.1).corner).toBeCloseTo(1, 9);
    expect(at(12).caption).toBe("Corner first");
    expect(at(20.3).corner).toBeCloseTo(0, 9);
    expect(at(26).turn).toBeGreaterThan(0);
    expect(at(26).caption).toBe("Turn it through w");
    expect(at(26).ghost?.kind).toBe("dial");
    expect(at(33).turn).toBeCloseTo(Math.PI * 2, 9);
    expect(at(SHOW_S + 1).loop).toBe(1);
    expect(showAt(12, 4, "ball").caption).toBe("Every slice of a 4D ball is a ball");
    expect(showAt(1, 3, "cube").caption).toBe("A flat world sees only a slice");
    expect(showAt(26, 2, "cube").caption).toBe("Turn it");
    // The show is continuous: no jumps between neighbouring moments.
    for (let s = 0; s < SHOW_S * 2; s += 0.05) {
      const a = at(s);
      const b = at(s + 0.05);
      if (a.loop !== b.loop) continue;
      expect(Math.abs(a.lever - b.lever)).toBeLessThan(0.1);
      expect(Math.abs(a.corner - b.corner)).toBeLessThan(0.1);
      expect(Math.abs(a.turn - b.turn)).toBeLessThan(0.1);
    }
    // Each loop ends where the next begins.
    const end = at(SHOW_S - 1e-6);
    const start = at(SHOW_S);
    expect(Math.abs(end.lever - start.lever)).toBeLessThanOrEqual(1);
    expect(end.corner).toBe(start.corner);
  });
});

describe("orbit", () => {
  it("a drag swings the view, elevation stays in range, and it drifts home", () => {
    const o = createOrbit(1400);
    o.begin(1, 0, 0, 0);
    o.move(1, 300, 2000, 16);
    expect(o.offset).not.toBe(0);
    expect(o.elevation).toBe(ORBIT.maxElevation);
    expect(o.end(1, 0, 32)).toBe(false);
    for (let t = 0; t < (ORBIT.returnAfter + 6) * 1000; t += 50) o.step(0.05, t + 32);
    expect(o.offset).toBe(0);
    expect(o.elevation).toBe(ORBIT.elevation);
    // A tap is not a drag.
    o.begin(2, 10, 10, 0);
    expect(o.end(2, 0, 100)).toBe(true);
  });
});
