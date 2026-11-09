import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { holeRadiusKm, MASS, solidRadiusKm, starRadiusKm } from "../../../src/apps/gravity/bodies";
import { createCosmos, SIZE_EASE_MS } from "../../../src/apps/gravity/cosmos";
import { layoutFor, screenScale, screenSize, screenSky } from "../../../src/apps/gravity/layout";
import {
  addBody,
  type Launch,
  setSizes,
  step,
  takeEvents,
} from "../../../src/apps/gravity/physics";
import { predict } from "../../../src/apps/gravity/predict";
import { SCALE_KM, SCENES } from "../../../src/apps/gravity/scenes";
import { predictClimb } from "../../../src/apps/gravity/screen";
import { createPrediction } from "../../../src/apps/gravity/predict";
import { launchOf } from "../../../src/apps/gravity/screen";
import {
  createClimber,
  stepClimber,
  takeOver,
  TRUE_STRIP_R,
  STRIP_R,
} from "../../../src/apps/gravity/strip";
import { decodeSky, encodeSky, snapshotOf } from "../../../src/apps/gravity/wire";
import { STEP_MS, type Body } from "../../../src/apps/gravity/physics";
import { run, universe } from "./helpers";

const EARTH_SUNS = 3.003e-6;

describe("true sizes", () => {
  it("give real radii for a body's mass and density", () => {
    expect(solidRadiusKm(EARTH_SUNS, 5.51)).toBeCloseTo(6371, -1);
    expect(starRadiusKm(1)).toBeCloseTo(696_000, -3);
    expect(holeRadiusKm(10)).toBeCloseTo(29.5, 1);
    // Our squeezed gas giant (3 Jupiter masses) at Jupiter's density: about 1.4 of its radius.
    expect(solidRadiusKm(MASS.giant, 1.3) / 71_492).toBeGreaterThan(1.3);
    expect(solidRadiusKm(MASS.giant, 1.3) / 71_492).toBeLessThan(1.6);
  });

  it("put each scene at a real length scale, so most bodies are far below a pixel", () => {
    const wall = layoutFor("wall", VENUE_SIZE.wall.width, VENUE_SIZE.wall.height);
    for (const id of SCENES) {
      const c = createCosmos({
        sky: wall.sky,
        maxBodies: 48,
        dustCap: 3000,
        seed: 2,
        scene: SCENES.indexOf(id),
        clockMs: 0,
        dot: wall.dot,
      });
      for (const b of c.u.bodies) {
        expect(b.r).toBe(b.re);
        if (b.kind === "star") {
          expect(b.rt * (SCALE_KM[id] / wall.sky.L)).toBeCloseTo(starRadiusKm(b.m), -3);
        }
        if (id !== "rings") {
          expect(b.rt, `${id} ${b.kind}`).toBeLessThan(b.kind === "star" ? 3 : 0.5);
        }
      }
    }
    // The ringed giant is seen close: on a wall its true size is the size it is drawn.
    const rings = createCosmos({
      sky: wall.sky,
      maxBodies: 48,
      dustCap: 3000,
      seed: 2,
      scene: 2,
      clockMs: 0,
      dot: wall.dot,
    });
    const giant = rings.u.bodies.find((b) => b.kind === "giant")!;
    expect(giant.rt / giant.re).toBeGreaterThan(0.95);
    expect(giant.rt / giant.re).toBeLessThan(1.05);
  });

  it("switch contacts to true radii, and never collide bodies that overlapped at the switch", () => {
    const u = universe({ units: { gmUnit: 1e7, lenUnit: 1000, minR: 2, kmPx: 1e5 } });
    const a = addBody(u, { kind: "planet", m: MASS.planet, x: 0, y: 0 });
    // Overlapping at drawn sizes, apart at true sizes, drifting apart.
    const b = addBody(u, { kind: "planet", m: MASS.planet, x: a.re * 1.5, y: 0, vx: 30 });
    setSizes(u, true);
    expect(a.r).toBe(a.rt);
    expect(a.rt).toBeLessThan(a.re / 10);
    run(u, 5);
    setSizes(u, false);
    expect(a.r).toBe(a.re);
    // Back to drawn sizes while overlapping: no contact while they part.
    expect(run(u, 120).some((e) => e.type === "merge" || e.type === "shatter")).toBe(false);
    expect(u.bodies).toHaveLength(2);
    // Once apart, a fresh meeting counts.
    b.vx = -60;
    b.x = a.x + a.re * 4;
    b.px = b.x;
    expect(run(u, 240).some((e) => e.type === "merge" || e.type === "shatter")).toBe(true);
  });

  it("let close passes at true sizes be slingshots where drawn sizes would collide", () => {
    const pass = (trueSizes: boolean) => {
      const u = universe({ units: { gmUnit: 1e7, lenUnit: 1000, minR: 2, kmPx: 1e5 } });
      setSizes(u, trueSizes);
      const sun = addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
      // Aimed to pass about one drawn radius from the sun's centre.
      addBody(u, { kind: "planet", m: MASS.planet, x: -1500, y: sun.re * 3, vx: 150 });
      return run(u, 2400).filter((e) => e.type === "swallow").length;
    };
    expect(pass(false)).toBe(1);
    expect(pass(true)).toBe(0);
  });

  it("keep the ribbon exact with true sizes on", () => {
    const wall = layoutFor("wall", VENUE_SIZE.wall.width, VENUE_SIZE.wall.height);
    for (const scene of [0, 2]) {
      const c = createCosmos({
        sky: wall.sky,
        maxBodies: 48,
        dustCap: 3000,
        seed: 4,
        scene,
        clockMs: 0,
        dot: wall.dot,
        trueSizes: true,
      });
      for (let t = 50; t <= 2000; t += 50) c.advance(t, t);
      const pad = wall.pads[3]!;
      const l: Launch = {
        kind: "planet",
        x: pad.x,
        y: pad.y,
        vx: -pad.vmax * 0.3,
        vy: -pad.vmax * 0.7,
        owner: "t",
        pad: 3,
        color: 3,
        human: true,
      };
      const pred = predict(c.u, l, { steps: 600, every: 3 });
      const b = c.launch(l);
      expect(b.r).toBe(b.rt);
      let n = 1;
      for (let i = 1; i <= pred.steps; i++) {
        step(c.u);
        takeEvents(c.u);
        if (i % 3 !== 0 || n >= pred.n || !c.u.bodies.includes(b)) continue;
        expect(Math.fround(b.x)).toBe(pred.pts[n * 2]);
        n++;
      }
      expect(n).toBeGreaterThan(15);
    }
  });

  it("ease the drawn sizes over about a second, through the sizes between", () => {
    const wall = layoutFor("wall", VENUE_SIZE.wall.width, VENUE_SIZE.wall.height);
    const c = createCosmos({
      sky: wall.sky,
      maxBodies: 48,
      dustCap: 3000,
      seed: 4,
      scene: 0,
      clockMs: 0,
      dot: wall.dot,
    });
    const sun = c.u.bodies.find((b) => b.kind === "star")!;
    expect(c.drawnRadius(sun, 0)).toBe(sun.re);
    c.setSizes(true, 1000);
    expect(c.drawnRadius(sun, 1000)).toBeCloseTo(sun.re, 6);
    const mid = c.drawnRadius(sun, 1000 + SIZE_EASE_MS / 2);
    expect(mid).toBeLessThan(sun.re * 0.6);
    expect(mid).toBeGreaterThan(sun.rt * 2);
    expect(c.drawnRadius(sun, 1000 + SIZE_EASE_MS + 1)).toBe(sun.rt);
    expect(c.sizeBlend(1000 + SIZE_EASE_MS + 1)).toBe(1);
    // Switching back half way eases back from where it was.
    c.setSizes(false, 3000);
    c.setSizes(true, 3000 + SIZE_EASE_MS / 2);
    const b = c.sizeBlend(3000 + SIZE_EASE_MS / 2);
    expect(b).toBeGreaterThan(0.3);
    expect(b).toBeLessThan(0.7);
    // A new scene keeps the mode.
    c.setScene(3, 5000, 5000);
    expect(c.u.trueSizes).toBe(true);
    expect(c.u.bodies.every((x: Body) => x.r === x.rt)).toBe(true);
  });
});

describe("true sizes on a bank", () => {
  const { W, H } = screenSize(6 * 1080, VENUE_SIZE.screen.width, VENUE_SIZE.screen.height);
  const sky = screenSky(W, H);
  const screen = () => {
    const s = screenScale(W);
    const c = createCosmos({
      sky,
      maxBodies: s.maxBodies,
      dustCap: s.dustCap,
      seed: 9,
      scene: 0,
      clockMs: 0,
      dot: s.dot,
      trueSizes: true,
    });
    for (let t = 50; t <= 2000; t += 50) c.advance(t, t);
    return c;
  };
  const snapOf = (c: ReturnType<typeof screen>) =>
    snapshotOf(
      decodeSky(
        JSON.parse(
          JSON.stringify(
            encodeSky({
              w: W,
              h: H,
              k: c.clockK,
              b: c.u.bodies.map((b) => [b.x, b.y, b.gm, b.r] as [number, number, number, number]),
              f: 2,
              sc: 0,
              vs: 100,
              z: c.trueSizes ? 1 : 0,
            }),
          ),
        ),
      )!,
    );
  const strip = { x0: 4320, x1: 5400 };
  const start = (k: number) => ({
    kind: "giant" as const,
    x: 4860,
    y: 1570,
    vx: 160,
    vy: -1400,
    k,
    owner: "p4",
    pad: 0,
    color: 4,
    human: true,
  });

  it("carry the mode in the snapshot, so frame and screen climb the same small body", () => {
    const c = screen();
    const snap = snapOf(c);
    expect(snap.z).toBe(1);
    const frame = createClimber(start(500), snap, strip);
    expect(frame.r).toBe(TRUE_STRIP_R);
    expect(createClimber(start(500), { ...snap, z: 0 }, strip).r).toBe(STRIP_R.giant);
    while (frame.crossed < 0) stepClimber(frame);
    const t = takeOver(start(500), snap, strip, 500 + 36);
    while (t.climber.crossed < 0) stepClimber(t.climber);
    expect([t.climber.crossed, t.climber.ex, t.climber.ey]).toEqual([
      frame.crossed,
      frame.ex,
      frame.ey,
    ]);
  });

  it("predict the climb and the flight above the bezel exactly with true sizes", () => {
    const c = screen();
    const snap = snapOf(c);
    const s = start(c.clockK);
    const pred = predictClimb(c, s, snap, strip, 300, 3, createPrediction(700, 3), c.holeMass());
    const cl = createClimber({ ...s, k: c.clockK }, snap, strip);
    let body: Body | null = null;
    let ticks = 0;
    let checked = 0;
    for (let i = 0; i < 900 && ticks < pred.steps; i++) {
      const had = body as Body | null;
      c.advance((c.clockK + 1) * STEP_MS + 0.01, 0, () => {
        if (body) return;
        stepClimber(cl);
        ticks++;
        if (cl.crossed >= 0) body = c.launch(launchOf(cl, c.holeMass()));
      });
      if (!had) continue;
      ticks++;
      if (ticks % 3 === 0 && ticks / 3 < pred.n && c.u.bodies.includes(had)) {
        expect(Math.fround(had.x)).toBe(pred.pts[(ticks / 3) * 2]);
        checked++;
      }
    }
    expect((body as Body | null)?.r).toBe((body as Body | null)?.rt);
    expect(checked).toBeGreaterThan(20);
  });
});
