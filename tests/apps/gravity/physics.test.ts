import { describe, expect, it } from "vitest";
import { MASS, REMNANT, STAR_MAX } from "../../../src/apps/gravity/bodies";
import {
  addBody,
  cloneUniverse,
  DT,
  launch,
  step,
  substeps,
  takeEvents,
  tidalLimit,
  totals,
} from "../../../src/apps/gravity/physics";
import { run, seconds, universe } from "./helpers";

const base = { owner: "t", pad: 0, color: 0, human: true };

describe("gravity and the integrator", () => {
  it("keeps a long elliptical orbit's energy over 30 turns", () => {
    const u = universe();
    const sun = addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
    const r = 900;
    const v = Math.sqrt(sun.gm / r) * 0.7;
    addBody(u, { kind: "planet", m: MASS.planet, x: r, y: 0, vx: 0, vy: v });
    const e0 = totals(u).energy;
    const a = -sun.gm / (2 * (0.5 * v * v - sun.gm / r));
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / sun.gm);
    let worst = 0;
    const steps = Math.round((30 * period) / DT);
    for (let i = 0; i < steps; i++) {
      step(u);
      if (i % 50 === 0) worst = Math.max(worst, Math.abs(totals(u).energy - e0) / Math.abs(e0));
    }
    expect(u.bodies).toHaveLength(2);
    expect(worst).toBeLessThan(2e-3);
  });

  it("keeps total momentum when everything pulls on everything", () => {
    const u = universe();
    addBody(u, { kind: "star", m: 1, x: 0, y: 0, vx: 3 });
    addBody(u, { kind: "star", m: 0.6, x: 400, y: 0, vy: 120 });
    addBody(u, { kind: "giant", m: MASS.giant, x: -900, y: 50, vy: -90 });
    addBody(u, { kind: "planet", m: MASS.planet, x: 0, y: 700, vx: 110 });
    const p0 = totals(u);
    run(u, seconds(20));
    const p1 = totals(u);
    const scale = Math.abs(p0.px) + Math.abs(p0.py) + 1e3;
    expect(Math.abs(p1.px - p0.px) / scale).toBeLessThan(1e-9);
    expect(Math.abs(p1.py - p0.py) / scale).toBeLessThan(1e-9);
  });

  it("brings the centre of mass home without changing any relative motion", () => {
    const make = (omega: number) => {
      const u = universe({ omega, home: { x: 0, y: 0 } });
      addBody(u, { kind: "star", m: 1, x: 0, y: 0, vx: 40 });
      addBody(u, { kind: "planet", m: MASS.planet, x: 500, y: 0, vx: 40, vy: 141 });
      addBody(u, { kind: "giant", m: MASS.giant, x: -800, y: 0, vx: 40, vy: -112 });
      return u;
    };
    const free = make(0);
    const kept = make((2 * Math.PI) / 16);
    run(free, seconds(30));
    run(kept, seconds(30));
    for (let i = 1; i < 3; i++) {
      const rf = [free.bodies[i]!.x - free.bodies[0]!.x, free.bodies[i]!.y - free.bodies[0]!.y];
      const rk = [kept.bodies[i]!.x - kept.bodies[0]!.x, kept.bodies[i]!.y - kept.bodies[0]!.y];
      expect(Math.hypot(rf[0]! - rk[0]!, rf[1]! - rk[1]!)).toBeLessThan(1e-4);
    }
    // Free, it drifted 1200 px; kept, it is back near home.
    expect(Math.hypot(free.cm.x, free.cm.y)).toBeGreaterThan(1000);
    expect(Math.hypot(kept.cm.x, kept.cm.y)).toBeLessThan(150);
  });

  it("splits a step into substeps through a close pass, keeping energy steady", () => {
    const u = universe({ units: { gmUnit: 1e10, lenUnit: 1000, minR: 2, kmPx: 1e5 } });
    const sun = addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
    // A smaller star at the closest point of a fly-by just clear of the sun's surface.
    const d = sun.r * 4;
    const v = Math.sqrt((2 * sun.gm) / d) * 1.3;
    addBody(u, { kind: "star", m: 0.4, x: d, y: 0, vy: v });
    const e0 = totals(u).energy;
    let most = 1;
    for (let i = 0; i < seconds(4) && u.bodies.length === 2; i++) {
      step(u);
      most = Math.max(most, substeps(u));
    }
    expect(u.bodies).toHaveLength(2);
    expect(most).toBeGreaterThan(1);
    expect(Math.abs(totals(u).energy - e0) / Math.abs(e0)).toBeLessThan(3e-3);
  });

  it("steps a copy exactly as the original", () => {
    const u = universe({ omega: 0.4 });
    addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
    for (let i = 0; i < 8; i++) {
      addBody(u, {
        kind: i % 2 ? "rock" : "planet",
        m: i % 2 ? MASS.rock : MASS.planet,
        x: 300 + i * 90,
        y: i * 20,
        vy: 160 - i * 7,
      });
    }
    run(u, 30);
    const c = cloneUniverse(u);
    const a = run(u, 900);
    const b = run(c, 900);
    expect(c.bodies.map((x) => [x.id, x.x, x.y, x.vx, x.vy, x.m])).toEqual(
      u.bodies.map((x) => [x.id, x.x, x.y, x.vx, x.vy, x.m]),
    );
    expect(b).toEqual(a);
  });
});

describe("contacts", () => {
  it("absorbs a much smaller body: mass, momentum and volume kept, and the larger heats", () => {
    const u = universe();
    const p = addBody(u, { kind: "planet", m: MASS.planet, x: 0, y: 0 });
    const r = addBody(u, { kind: "rock", m: MASS.rock, x: 120, y: 0, vx: -400 });
    const before = totals(u);
    const vol = p.vol + r.vol;
    const events = run(u, seconds(1));
    expect(events.some((e) => e.type === "merge")).toBe(true);
    expect(u.bodies).toHaveLength(1);
    const b = u.bodies[0]!;
    expect(b.m).toBeCloseTo(MASS.planet + MASS.rock, 12);
    expect(b.vol).toBeCloseTo(vol, 12);
    expect(b.heat).toBeGreaterThan(0.05);
    const after = totals(u);
    expect(after.px).toBeCloseTo(before.px, 6);
    expect(after.py).toBeCloseTo(before.py, 6);
  });

  it("shatters two similar solids hitting fast into fragments that stay bound together", () => {
    const u = universe({ units: { gmUnit: 1e9, lenUnit: 1000, minR: 2, kmPx: 1e5 } });
    const a = addBody(u, { kind: "planet", m: MASS.planet, x: -60, y: 0, vx: 2000 });
    const b = addBody(u, { kind: "planet", m: MASS.planet * 0.8, x: 60, y: 5, vx: -2000 });
    const m = a.m + b.m;
    const before = totals(u);
    const events = takeEvents(u);
    void events;
    let shattered = false;
    for (let i = 0; i < 30 && !shattered; i++) {
      step(u);
      shattered = takeEvents(u).some((e) => e.type === "shatter");
    }
    expect(shattered).toBe(true);
    expect(u.bodies.length).toBeGreaterThanOrEqual(2);
    expect(u.bodies.length).toBeLessThanOrEqual(4);
    expect(u.bodies.reduce((s, x) => s + x.m, 0)).toBeCloseTo(m, 12);
    const after = totals(u);
    expect(after.px).toBeCloseTo(before.px, 3);
    expect(after.py).toBeCloseTo(before.py, 3);
    // Slower than they could escape each other: they can gather again.
    const g = u.bodies.reduce((sum, f) => sum + f.gm, 0);
    const vx = u.bodies.reduce((sum, f) => sum + f.gm * f.vx, 0) / g;
    const vy = u.bodies.reduce((sum, f) => sum + f.gm * f.vy, 0) / g;
    expect(after.energy - 0.5 * g * (vx * vx + vy * vy)).toBeLessThan(0);
    for (const f of u.bodies) expect(f.heat).toBeGreaterThan(0.5);
  });

  it("lets a star swallow what hits it, and collapse into a black hole past its limit", () => {
    const u = universe();
    const big = addBody(u, { kind: "star", m: STAR_MAX - 0.1, x: 0, y: 0 });
    launch(u, { ...base, kind: "star", x: 1500, y: 0, vx: -900, vy: 0 });
    const events = run(u, seconds(4));
    expect(events.some((e) => e.type === "swallow" && e.by === "star")).toBe(true);
    const collapse = events.find((e) => e.type === "collapse");
    expect(collapse).toBeDefined();
    expect(u.bodies).toHaveLength(1);
    expect(big.kind).toBe("hole");
    expect(big.m).toBeCloseTo((STAR_MAX - 0.1 + MASS.star) * REMNANT, 9);
    expect(big.r).toBeLessThan(collapse && collapse.type === "collapse" ? collapse.r : 0);
  });

  it("ignites a gas giant that gathers enough mass", () => {
    const u = universe();
    const g = addBody(u, { kind: "giant", m: 0.075, x: 0, y: 0 });
    addBody(u, { kind: "giant", m: 0.01, x: 400, y: 0, vx: -300 });
    const events = run(u, seconds(3));
    expect(events.some((e) => e.type === "ignite")).toBe(true);
    expect(g.kind).toBe("star");
  });

  it("lets a black hole tear apart what falls in, take it in, and glow", () => {
    const u = universe();
    const h = addBody(u, { kind: "hole", m: 1, x: 0, y: 0 });
    addBody(u, { kind: "rock", m: MASS.rock, x: 0, y: 600, vy: -50 });
    const events = run(u, seconds(5));
    expect(
      events.some(
        (e) =>
          (e.type === "shred" && e.pkind === "hole") || (e.type === "swallow" && e.by === "hole"),
      ),
    ).toBe(true);
    expect(u.bodies).toHaveLength(1);
    expect(h.m).toBeCloseTo(1 + MASS.rock, 12);
    expect(h.feed).toBeGreaterThan(0.1);
  });

  it("lets a black hole swallow another", () => {
    const u = universe();
    const h = addBody(u, { kind: "hole", m: 1, x: 0, y: 0 });
    addBody(u, { kind: "hole", m: 0.3, x: 0, y: 400, vy: -100 });
    const events = run(u, seconds(5));
    expect(events.some((e) => e.type === "swallow" && e.by === "hole")).toBe(true);
    expect(h.m).toBeCloseTo(1.3, 12);
  });
});

describe("tides", () => {
  const moonAt = (share: number) => {
    const u = universe({ units: { gmUnit: 1e9, lenUnit: 1000, minR: 2, kmPx: 1e5 } });
    const g = addBody(u, { kind: "giant", m: MASS.giant * 50, x: 0, y: 0 });
    const probe = addBody(u, { kind: "rock", m: MASS.rock, x: 1e5, y: 0 });
    const lim = tidalLimit(g, probe);
    u.bodies.pop();
    const r = lim * share;
    const v = Math.sqrt(g.gm / r);
    const moon = addBody(u, { kind: "rock", m: MASS.rock, x: r, y: 0, vy: v + 0 });
    // Allow for the pair's softening so the orbit is round.
    const eps = Math.max(g.soft, moon.soft);
    moon.vy = Math.sqrt((g.gm * r * r) / (r * r + eps * eps) ** 1.5);
    return { u, g, moon };
  };

  it("leaves a fast fly-by inside the limit whole", () => {
    const u = universe({ units: { gmUnit: 1e9, lenUnit: 1000, minR: 2, kmPx: 1e5 } });
    const g = addBody(u, { kind: "giant", m: MASS.giant * 50, x: 0, y: 0 });
    const probe = addBody(u, { kind: "rock", m: MASS.rock, x: 1e5, y: 0 });
    const lim = tidalLimit(g, probe);
    u.bodies.pop();
    const v = Math.sqrt((2 * g.gm) / (lim * 0.7)) * 1.5;
    addBody(u, { kind: "rock", m: MASS.rock, x: -4000, y: lim * 0.6, vx: v });
    expect(run(u, seconds(6)).some((e) => e.type === "shred")).toBe(false);
  });

  it("pulls a moon just inside the limit apart within a minute or two, into its primary", () => {
    const { u, g } = moonAt(0.95);
    const m0 = g.m;
    let at = -1;
    for (let i = 0; i < seconds(150) && at < 0; i++) {
      step(u);
      if (takeEvents(u).some((e) => e.type === "shred")) at = i / 120;
    }
    expect(at).toBeGreaterThan(8);
    expect(at).toBeLessThan(120);
    expect(g.m).toBeCloseTo(m0 + MASS.rock, 12);
  });

  it("leaves a moon outside the limit alone, and tears one deep inside apart at once", () => {
    const outside = moonAt(1.15);
    expect(run(outside.u, seconds(120)).some((e) => e.type === "shred")).toBe(false);
    const deep = moonAt(0.4);
    const events = run(deep.u, 3);
    expect(events.some((e) => e.type === "shred")).toBe(true);
  });

  it("puts tidal limits at the textbook number of primary radii", () => {
    const u = universe();
    const sun = addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
    const giant = addBody(u, { kind: "giant", m: MASS.giant, x: 1e5, y: 0 });
    const planet = addBody(u, { kind: "planet", m: MASS.planet, x: 2e5, y: 0 });
    const rock = addBody(u, { kind: "rock", m: MASS.rock, x: 3e5, y: 0 });
    expect(tidalLimit(sun, planet) / sun.r).toBeCloseTo(2.44 * Math.cbrt(1.41 / 5.5), 2);
    expect(tidalLimit(giant, rock) / giant.r).toBeCloseTo(2.44 * Math.cbrt(1.3 / 3), 6);
  });
});

describe("leaving and room", () => {
  it("removes an unbound body far out but keeps a bound one", () => {
    const u = universe({ farR: 3000, lostR: 50_000 });
    const sun = addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
    const fast = addBody(u, { kind: "rock", m: MASS.rock, x: 3500, y: 0, vx: 2000 });
    const slow = addBody(u, { kind: "rock", m: MASS.rock, x: -3500, y: 0, vy: 10 });
    const events = run(u, seconds(1));
    expect(events.some((e) => e.type === "gone" && e.id === fast.id)).toBe(true);
    expect(u.bodies).toContain(slow);
    expect(u.bodies).toContain(sun);
  });

  it("makes room for a throw by taking the lightest body, farthest first, never a star", () => {
    const u = universe({ maxBodies: 4 });
    const sun = addBody(u, { kind: "star", m: 1, x: 0, y: 0 });
    const near = addBody(u, { kind: "rock", m: MASS.rock, x: 300, y: 0 });
    const far = addBody(u, { kind: "rock", m: MASS.rock, x: 3000, y: 0 });
    const planet = addBody(u, { kind: "planet", m: MASS.planet, x: -500, y: 0 });
    launch(u, { ...base, kind: "giant", x: 0, y: 2000, vx: 0, vy: 0 });
    expect(u.bodies).toHaveLength(4);
    expect(u.bodies).not.toContain(far);
    for (const b of [sun, near, planet]) expect(u.bodies).toContain(b);
  });
});
