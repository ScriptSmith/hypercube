import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { createCosmos } from "../../../src/apps/gravity/cosmos";
import { layoutFor } from "../../../src/apps/gravity/layout";
import { type Launch, step, takeEvents } from "../../../src/apps/gravity/physics";
import { createPrediction, predict, scoreLaunch } from "../../../src/apps/gravity/predict";
import { SCENES } from "../../../src/apps/gravity/scenes";

const wall = layoutFor("wall", VENUE_SIZE.wall.width, VENUE_SIZE.wall.height);

const cosmos = (scene: number, seconds = 3) => {
  const c = createCosmos({
    sky: wall.sky,
    maxBodies: wall.maxBodies,
    dustCap: wall.dustCap,
    seed: 5,
    scene,
    clockMs: 0,
    dot: wall.dot,
  });
  for (let t = 50; t <= seconds * 1000; t += 50) c.advance(t, t);
  return c;
};

const throwFrom = (pad: number, vx: number, vy: number, kind: Launch["kind"]): Launch => ({
  kind,
  x: wall.pads[pad]!.x,
  y: wall.pads[pad]!.y,
  vx,
  vy,
  owner: "t",
  pad,
  color: pad,
  human: true,
});

describe("the ribbon", () => {
  for (let s = 0; s < SCENES.length; s++) {
    it(`matches the flight point for point while every body moves (${SCENES[s]})`, () => {
      const c = cosmos(s);
      const p = wall.pads[2]!;
      const l = throwFrom(2, p.vmax * 0.35, -p.vmax * 0.7, s % 2 ? "giant" : "planet");
      const pred = predict(c.u, l, { steps: 600, every: 3 });
      expect(pred.n).toBeGreaterThan(20);
      const b = c.launch(l);
      let n = 1;
      for (let i = 1; i <= pred.steps; i++) {
        step(c.u);
        takeEvents(c.u);
        if (i % 3 !== 0 || n >= pred.n || !c.u.bodies.includes(b)) continue;
        expect(Math.fround(b.x)).toBe(pred.pts[n * 2]);
        expect(Math.fround(b.y)).toBe(pred.pts[n * 2 + 1]);
        n++;
      }
      expect(n).toBeGreaterThan(15);
    });
  }

  it("ends where the body would fall into the sun", () => {
    const c = cosmos(0, 0.1);
    const sun = c.u.bodies.find((b) => b.kind === "star")!;
    const p = wall.pads[2]!;
    const dx = sun.x - p.x;
    const dy = sun.y - p.y;
    const d = Math.hypot(dx, dy);
    const l = throwFrom(2, (dx / d) * p.vmin * 1.2, (dy / d) * p.vmin * 1.2, "rock");
    const pred = predict(c.u, l, { steps: 1500, every: 3 }, createPrediction(1500, 3));
    expect(pred.stop).toBe("star");
    expect(Math.hypot(pred.x - sun.x, pred.y - sun.y)).toBeLessThan(sun.r * 1.6);
  });

  it("scores a throw that goes round above one that falls in or flies off", () => {
    const c = cosmos(0, 0.1);
    const sun = c.u.bodies.find((b) => b.kind === "star")!;
    const p = wall.pads[2]!;
    const dx = sun.x - p.x;
    const dy = sun.y - p.y;
    const d = Math.hypot(dx, dy);
    const into = throwFrom(2, (dx / d) * p.vmin, (dy / d) * p.vmin, "planet");
    const away = throwFrom(2, 0, -p.vmax * 3, "planet");
    // Sideways past the sun at about the speed of a circular orbit there.
    const v = Math.sqrt(sun.gm / (d * 0.5)) * 0.9;
    const round = throwFrom(2, v * 0.95, -v * 0.3, "planet");
    const view = wall.sky.view;
    const good = scoreLaunch(c.u, round, 600, view);
    expect(good).toBeGreaterThan(scoreLaunch(c.u, into, 600, view));
    expect(good).toBeGreaterThan(scoreLaunch(c.u, away, 600, view));
  });
});
