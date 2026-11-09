import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { createControls, SCENE_HOLD_MS } from "../../../src/apps/gravity/controls";
import { createCosmos, FACTORS, NORMAL_TIME } from "../../../src/apps/gravity/cosmos";
import { createDust, DEBRIS, KEEP, RING } from "../../../src/apps/gravity/dust";
import { layoutFor, screenSize, screenSky } from "../../../src/apps/gravity/layout";
import { STEP_MS } from "../../../src/apps/gravity/physics";
import { buildScene, gm0Of, SCENES } from "../../../src/apps/gravity/scenes";

const wall = layoutFor("wall", VENUE_SIZE.wall.width, VENUE_SIZE.wall.height);
const make = (scene = 0, dustCap = wall.dustCap) =>
  createCosmos({
    sky: wall.sky,
    maxBodies: wall.maxBodies,
    dustCap,
    seed: 3,
    scene,
    clockMs: 0,
    dot: wall.dot,
  });
const runFor = (c: ReturnType<typeof make>, from: number, ms: number) => {
  for (let t = from + 50; t <= from + ms; t += 50) c.advance(t, t);
  return from + ms;
};

describe("time", () => {
  it("steps the universe at the time factor, exactly, on the clock's grid", () => {
    for (let i = 0; i < FACTORS.length; i++) {
      const c = make();
      c.setTime(i);
      const k0 = c.u.k;
      runFor(c, 0, 2000);
      const clockSteps = Math.floor(2000 / STEP_MS);
      expect(c.u.k - k0).toBe(Math.floor(clockSteps * FACTORS[i]!));
    }
  });

  it("interpolates between steps smoothly, also at a quarter speed", () => {
    const c = make();
    c.setTime(0);
    runFor(c, 0, 500);
    const seen = new Set<number>();
    for (let t = 500; t < 560; t += 2) {
      c.advance(t, t);
      const a = c.alpha(t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      seen.add(Math.round(a * 8));
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it("starts at normal speed and clamps the factor", () => {
    const c = make();
    expect(c.timeIndex).toBe(NORMAL_TIME);
    c.setTime(99);
    expect(c.factor).toBe(4);
    c.setTime(-3);
    expect(c.factor).toBe(0.25);
  });
});

describe("scenes", () => {
  const skies = {
    wall: wall.sky,
    panel: layoutFor("panel", 1080, 1920).sky,
    pair: layoutFor("pair", 2160, 1920).sky,
    kiosk: layoutFor("kiosk", 1920, 1080).sky,
    screen: screenSky(
      screenSize(6 * 1080, VENUE_SIZE.screen.width, VENUE_SIZE.screen.height).W,
      screenSize(6 * 1080, VENUE_SIZE.screen.width, VENUE_SIZE.screen.height).H,
    ),
  };
  for (const [kind, sky] of Object.entries(skies)) {
    it(`start balanced, centred and in view (${kind})`, () => {
      for (const id of SCENES) {
        const dust = createDust(3000);
        const s = buildScene(id, { sky, k: 0, seed: 1, maxBodies: 48, dust, keep: 1800, dot: 3 });
        const u = s.universe;
        let g = 0;
        let px = 0;
        let py = 0;
        let x = 0;
        let y = 0;
        for (const b of u.bodies) {
          g += b.gm;
          px += b.gm * b.vx;
          py += b.gm * b.vy;
          x += b.gm * b.x;
          y += b.gm * b.y;
          const v = sky.view;
          expect(b.x, `${id} ${b.kind}`).toBeGreaterThan(v.x0);
          expect(b.x, `${id} ${b.kind}`).toBeLessThan(v.x1);
          expect(b.y, `${id} ${b.kind}`).toBeGreaterThan(v.y0);
          expect(b.y, `${id} ${b.kind}`).toBeLessThan(v.y1);
        }
        const vScale = Math.sqrt(gm0Of(sky) / sky.L);
        expect(Math.hypot(px, py) / g / vScale, id).toBeLessThan(1e-9);
        expect(Math.hypot(x / g - sky.cx, y / g - sky.cy) / sky.L, id).toBeLessThan(0.05);
        expect(dust.live, id).toBeLessThanOrEqual(1800);
        expect(s.speed, id).toBeGreaterThan(0.4);
      }
    });
  }

  it("keeps the solar system and the binary whole for minutes", () => {
    for (const scene of [0, 1]) {
      const c = make(scene);
      const n = c.u.bodies.length;
      runFor(c, 0, 90_000);
      expect(c.u.bodies).toHaveLength(n);
      expect(c.burnt()).toBe(false);
    }
  });

  it("tears the ringed giant's closest moon apart within a minute or so, into a ring", () => {
    const c = make(2);
    let at = -1;
    let t = 0;
    while (t < 120_000 && at < 0) {
      t += 50;
      if (c.advance(t, t).some((e) => e.type === "shred")) at = t;
    }
    expect(at).toBeGreaterThan(20_000);
    expect(at).toBeLessThan(100_000);
    let ring = 0;
    for (let i = 0; i < c.dust.cap; i++) if (c.dust.kind[i] === RING) ring++;
    expect(ring).toBeGreaterThan(30);
  });

  it("lets the cluster's stars meet, merge or fly off, while some stay", () => {
    const c = make(3);
    const n = c.u.bodies.length;
    runFor(c, 0, 60_000);
    expect(c.u.bodies.length).toBeLessThan(n);
    expect(c.u.bodies.filter((b) => b.kind === "star" || b.kind === "hole").length).toBeGreaterThan(
      1,
    );
  });

  it("brings the galaxies close within half a minute, their stars mostly kept", () => {
    const c = make(4);
    const kept = c.dust.live;
    let closest = Infinity;
    let t = 0;
    while (t < 40_000) {
      t = runFor(c, t, 1000);
      const [a, b] = c.u.bodies.filter((x) => x.core);
      if (a && b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(closest / wall.sky.L).toBeLessThan(0.6);
    expect(c.dust.live).toBeGreaterThan(kept * 0.7);
  });

  it("switches scene with fresh particles and trails, the step count running on", () => {
    const c = make(0);
    runFor(c, 0, 3000);
    const k = c.u.k;
    c.setScene(4, 3000, 3000);
    expect(c.sceneId).toBe("galaxies");
    expect(c.u.k).toBe(k);
    expect(c.trails.size).toBe(0);
    let rings = 0;
    for (let i = 0; i < c.dust.cap; i++) if (c.dust.kind[i] === KEEP) rings++;
    expect(rings).toBe(c.dust.live);
  });

  it("calls a scene burnt out once nothing heavy is left in view", () => {
    const c = make(0);
    expect(c.burnt()).toBe(false);
    c.u.bodies.length = 0;
    expect(c.burnt()).toBe(true);
  });

  it("fires black holes of a share of the heaviest body", () => {
    const c = make(0);
    expect(c.holeMass()).toBeCloseTo(0.6, 9);
  });
});

describe("bounded for days", () => {
  it("keeps bodies, particles and trails within their caps however much is thrown", () => {
    const c = make(0, 600);
    let t = 0;
    for (let i = 0; i < 400; i++) {
      c.launch({
        kind: i % 7 === 0 ? "star" : i % 3 === 0 ? "giant" : "planet",
        x: 1000 + (i % 40) * 110,
        y: 1980,
        vx: (i % 5) * 40 - 80,
        vy: -300,
        owner: "t",
        pad: i % 6,
        color: i % 8,
        human: false,
      });
      t = runFor(c, t, 250);
      expect(c.u.bodies.length).toBeLessThanOrEqual(wall.maxBodies);
      expect(c.dust.live).toBeLessThanOrEqual(600);
      expect(c.trails.size).toBeLessThanOrEqual(wall.maxBodies + 16);
      expect(c.flashes.length).toBeLessThanOrEqual(6);
    }
  });

  it("reuses debris before ring material, and never a scene's own particles", () => {
    const d = createDust(10);
    for (let i = 0; i < 4; i++) d.spawn(KEEP, i, 0, 0, 0, Infinity, 0, 1);
    for (let i = 0; i < 3; i++) d.spawn(RING, i, 1, 0, 0, 100, 0, 1);
    for (let i = 0; i < 3; i++) d.spawn(DEBRIS, i, 2, 0, 0, 10, 0, 1);
    for (let i = 0; i < 3; i++) d.spawn(DEBRIS, i, 3, 0, 0, 10, 0, 1);
    const count = (k: number) => [...d.kind].filter((x) => x === k).length;
    expect([count(KEEP), count(RING), count(DEBRIS)]).toEqual([4, 3, 3]);
    for (let i = 0; i < 6; i++) d.spawn(DEBRIS, i, 4, 0, 0, 10, 0, 1);
    expect(count(KEEP)).toBe(4);
    expect(d.live).toBe(10);
    d.clear(false);
    expect(d.live).toBe(4);
  });

  it("lets particles fall into a black hole through a hot disc", () => {
    const d = createDust(200);
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const r = 60 + (i % 10) * 4;
      d.spawn(
        DEBRIS,
        Math.cos(a) * r,
        Math.sin(a) * r,
        -Math.sin(a) * 150,
        Math.cos(a) * 150,
        1e9,
        0,
        1,
      );
    }
    const hole = { x: 0, y: 0, vx: 0, vy: 0, gm: 150 * 150 * 70, eps2: 4, absorb: 12, disc: 140 };
    let fed = 0;
    let hot = 0;
    for (let s = 0; s < 1200; s++) {
      d.step(1 / 60, [hole], 1, 0, 0, { x0: -1e4, y0: -1e4, x1: 1e4, y1: 1e4 });
      fed += d.fed[0]!;
      if (s === 200) for (let i = 0; i < 200; i++) hot = Math.max(hot, d.hot[i]!);
    }
    expect(fed).toBeGreaterThan(150);
    expect(hot).toBeGreaterThan(0.2);
  });
});

describe("controls", () => {
  it("picks bodies, steps time and changes scene only after a held second", () => {
    const l = layoutFor("panel", 1080, 1920);
    const seen: string[] = [];
    const c = createControls(l, {
      pick: (pad, pick) => seen.push(`pick ${pad} ${pick}`),
      time: (d) => seen.push(`time ${d}`),
      sizes: () => seen.push("sizes"),
      scene: () => seen.push("scene"),
    });
    expect(c.picks).toEqual(["planet"]);
    const star = l.pickers[0]!.find((b) => b.pick === "star")!;
    expect(c.down(1, star.x, star.y, false, 0)).toBe(true);
    expect(c.picks).toEqual(["star"]);
    expect(c.down(2, l.faster.x, l.faster.y, false, 0)).toBe(true);
    expect(c.down(3, l.slower.x, l.slower.y, false, 0)).toBe(true);
    expect(c.down(7, l.sizes.x, l.sizes.y, false, 0)).toBe(true);
    expect(c.down(4, l.scene.x, l.scene.y, false, 1000)).toBe(true);
    c.update(1000 + SCENE_HOLD_MS - 100);
    expect(c.hold(1000 + SCENE_HOLD_MS - 100)).toBeGreaterThan(0.8);
    expect(seen).not.toContain("scene");
    c.update(1000 + SCENE_HOLD_MS + 10);
    c.update(1000 + SCENE_HOLD_MS + 500);
    expect(seen.filter((s) => s === "scene")).toHaveLength(1);
    c.up(4);
    // A short press does nothing.
    c.down(5, l.scene.x, l.scene.y, false, 5000);
    c.up(5);
    c.update(7000);
    expect(seen).toEqual(["pick 0 star", "time 1", "time -1", "sizes", "scene"]);
    expect(c.down(6, 10, 10, false, 8000)).toBe(false);
    c.reset();
    expect(c.picks).toEqual(["planet"]);
  });
});
