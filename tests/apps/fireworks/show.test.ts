import { describe, expect, it } from "vitest";
import { isPictogram, SHAPE } from "../../../src/apps/fireworks/recipe";
import {
  keeps,
  MAX_EVENTS,
  sectionAt,
  SHOW_PERIOD_MS,
  showIndex,
  showPlan,
} from "../../../src/apps/fireworks/show";
import { screenDirector, W } from "./helpers";

describe("fireworks scripted show", () => {
  it("is the same for the same seed and show number, and different otherwise", () => {
    const a = showPlan("room-1", 1234, { pictograms: true });
    const b = showPlan("room-1", 1234, { pictograms: true });
    expect(b).toEqual(a);
    expect(showPlan("room-1", 1235, { pictograms: true }).events).not.toEqual(a.events);
    expect(showPlan("room-2", 1234, { pictograms: true }).events).not.toEqual(a.events);
  });

  it("fills its clock period in order: openers, middle, finale, rest", () => {
    const n = 20_000;
    const p = showPlan("seed", n, { pictograms: true });
    expect(p.start).toBe(n * SHOW_PERIOD_MS);
    expect(p.end - p.start).toBeGreaterThanOrEqual(60_000);
    expect(p.end - p.start).toBeLessThanOrEqual(90_000);
    expect(p.sections.map((s) => s.name)).toEqual(["openers", "middle", "finale", "rest"]);
    for (let i = 1; i < p.sections.length; i++)
      expect(p.sections[i]!.start).toBe(p.sections[i - 1]!.end);
    expect(p.sections.at(-1)!.end).toBe(p.start + SHOW_PERIOD_MS);
    expect(p.events.length).toBeGreaterThan(30);
    expect(p.events.length).toBeLessThanOrEqual(MAX_EVENTS);
    for (let i = 1; i < p.events.length; i++)
      expect(p.events[i]!.t).toBeGreaterThanOrEqual(p.events[i - 1]!.t);
    for (const e of p.events) {
      expect(e.t).toBeGreaterThanOrEqual(p.start);
      // The last moments of a period stay empty, so playback loses nothing at the boundary.
      expect(e.t).toBeLessThan(p.start + SHOW_PERIOD_MS - 1000);
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(1);
    }
    expect(showIndex(p.start + 5)).toBe(n);
    expect(sectionAt(p, p.end + 1)?.name).toBe("rest");
    // The rest is never silent for long.
    const rest = p.events.filter((e) => e.t >= p.end);
    expect(rest.length).toBeGreaterThan(2);
  });

  it("uses pictograms only when allowed, and only a few per show", () => {
    for (let n = 0; n < 30; n++) {
      const off = showPlan("s", n, { pictograms: false });
      expect(off.events.some((e) => isPictogram(e.shape))).toBe(false);
      const on = showPlan("s", n, { pictograms: true });
      expect(on.events.filter((e) => isPictogram(e.shape)).length).toBeLessThanOrEqual(6);
    }
  });

  it("ends with a cascade and a line of large shells", () => {
    const p = showPlan("x", 7, { pictograms: true });
    const finale = p.events.filter((e) => e.t >= p.sections[2]!.start && e.t < p.end);
    expect(finale.some((e) => e.shape === SHAPE.cascade && e.y !== undefined)).toBe(true);
    expect(finale.filter((e) => e.size === 1).length).toBeGreaterThanOrEqual(8);
  });

  it("thins out for narrow skies", () => {
    const p = showPlan("x", 9, { pictograms: true });
    const panel = p.events.filter((e) => keeps(e, 0.55, 1)).length;
    const wall = p.events.filter((e) => keeps(e, 1, 99)).length;
    expect(wall).toBe(p.events.length);
    expect(panel).toBeLessThan(wall * 0.5);
  });

  it("starts at once on a fresh screen, already in full swing", () => {
    const { engine, director } = screenDirector(null, 0, { x0: 0, x1: W });
    director.update(50 * SHOW_PERIOD_MS + 20_000);
    expect(director.showing).toBe(true);
    // Shells from the last few seconds are already in the air.
    expect(engine.shells.live).toBeGreaterThan(0);
  });

  it("stops after the current section once someone launches, and comes back when it's quiet", () => {
    const { director } = screenDirector(null, 0, { x0: 0, x1: W }, { show: 10 });
    const start = 60 * SHOW_PERIOD_MS;
    const p = showPlan("test", 60, { pictograms: true });
    const mid = p.sections[1]!;
    const t = mid.start + 1000;
    director.update(t);
    expect(director.showing).toBe(true);
    director.launch({
      x: 500,
      y: -1500,
      angle: 0,
      v: 3000,
      g: 400,
      t0: t,
      color: 0,
      shape: SHAPE.peony,
      size: 0.5,
      seed: 1,
      frame: null,
      pad: 0,
      exitU: 0.5,
      key: "k",
    });
    director.update(mid.end - 10);
    expect(director.showing).toBe(true);
    director.update(mid.end + 10);
    expect(director.showing).toBe(false);
    // Ten seconds of quiet, then it joins again at the next section.
    director.update(t + 10_500);
    expect(director.showing).toBe(true);
    expect(start).toBe(p.start);
  });
});
