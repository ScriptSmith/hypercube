import { describe, expect, it } from "vitest";
import { createOrbit, ORBIT } from "../../../src/apps/robotarm/orbit";

const DT = 1 / 60;

/** Drag a finger from (x0, y0) by (dx, dy) in steps of about 10 px, ms apart. */
const drag = (o: ReturnType<typeof createOrbit>, dx: number, dy: number, t0 = 0, id = 1) => {
  o.begin(id, 500, 500, t0);
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 10));
  let t = t0;
  for (let i = 1; i <= n; i++) {
    t += 16;
    o.move(id, 500 + (dx * i) / n, 500 + (dy * i) / n, t);
  }
  return t;
};

describe("robotarm orbit", () => {
  it("starts at the usual angle", () => {
    const o = createOrbit(1080);
    expect(o.azimuth).toBe(ORBIT.azimuth);
    expect(o.elevation).toBe(ORBIT.elevation);
    expect(o.turned).toBe(false);
  });

  it("swings the near edge the way the finger drags, and tips with a drag down", () => {
    const o = createOrbit(1080);
    drag(o, 200, 0);
    const per = ORBIT.turn / 1080;
    expect(o.azimuth).toBeCloseTo(ORBIT.azimuth - 200 * per, 6);
    o.end(1, 0, 400);
    drag(o, 0, 100, 500);
    expect(o.elevation).toBeCloseTo(ORBIT.elevation + 100 * per, 6);
    expect(o.turned).toBe(true);
  });

  it("turns all the way round, and keeps the tilt between its limits", () => {
    const o = createOrbit(1080);
    drag(o, 2000, 0);
    expect(o.azimuth).toBeGreaterThan(-180);
    expect(o.azimuth).toBeLessThanOrEqual(180);
    o.end(1, 0, 1000);
    drag(o, 0, 3000, 2000);
    expect(o.elevation).toBe(ORBIT.maxElevation);
    o.end(1, 0, 4000);
    drag(o, 0, -6000, 5000);
    expect(o.elevation).toBe(ORBIT.minElevation);
  });

  it("treats a short touch without a drag as a tap", () => {
    const o = createOrbit(1080);
    o.begin(1, 300, 300, 0);
    o.move(1, 305, 302, 50);
    expect(o.end(1, 0, 120)).toBe(true);
    expect(o.turned).toBe(false);
    drag(o, 100, 0, 1000, 2);
    expect(o.end(2, 0, 1300)).toBe(false);
  });

  it("ignores a finger it isn't following", () => {
    const o = createOrbit(1080);
    o.begin(1, 300, 300, 0);
    expect(o.move(2, 600, 300, 16)).toBe(false);
    expect(o.azimuth).toBe(ORBIT.azimuth);
  });

  it("coasts after a flick and slows to a stop", () => {
    const o = createOrbit(1080);
    const t = drag(o, 100, 0);
    o.end(1, 1500, t);
    const after = o.azimuth;
    let now = t;
    for (let i = 0; i < 30; i++) o.step(DT, (now += 16));
    // Dragging right swung the azimuth down; the coast carries on that way.
    const coasted = o.azimuth - after;
    expect(coasted).toBeLessThan(-5);
    expect(coasted).toBeGreaterThan(-ORBIT.maxSpin * ORBIT.coast - 1);
    for (let i = 0; i < 240; i++) o.step(DT, (now += 16));
    const settled = o.azimuth;
    o.step(DT, (now += 16));
    expect(o.azimuth).toBe(settled);
  });

  it("drifts home some time after the last turn, the short way round", () => {
    const o = createOrbit(1080);
    // Turn past the back so the short way home crosses 180 degrees.
    const t = drag(o, -900, 60);
    o.end(1, 0, t);
    const away = o.azimuth;
    expect(away).toBeGreaterThan(100);
    let now = t;
    for (let i = 0; i < 60 * 19; i++) o.step(DT, (now += 1000 / 60));
    expect(o.azimuth).toBe(away);
    expect(o.moving).toBe(false);
    let crossed = false;
    let prev = o.azimuth;
    let moved = false;
    for (let i = 0; i < 60 * 10; i++) {
      o.step(DT, (now += 1000 / 60));
      moved ||= o.moving;
      if (Math.abs(o.azimuth - prev) > 180) crossed = true;
      prev = o.azimuth;
    }
    expect(moved).toBe(true);
    expect(o.turned).toBe(false);
    expect(o.azimuth).toBe(ORBIT.azimuth);
    expect(o.elevation).toBe(ORBIT.elevation);
    expect(o.moving).toBe(false);
    // From about +160 degrees, home at -36 is shorter through 180.
    expect(crossed).toBe(true);
  });

  it("goes home at once on a reset, still eased", () => {
    const o = createOrbit(1080);
    const t = drag(o, 300, 80);
    o.end(1, 0, t);
    o.home();
    expect(o.moving).toBe(true);
    let now = t;
    o.step(DT, (now += 16));
    expect(o.turned).toBe(true);
    for (let i = 0; i < 60 * 6; i++) o.step(DT, (now += 16));
    expect(o.turned).toBe(false);
  });

  it("turns as far per finger width on a wall lane as a panel's reach allows", () => {
    const panel = createOrbit(1080);
    const wall = createOrbit(2160);
    drag(panel, 100, 0);
    drag(wall, 100, 0);
    const per = (o: ReturnType<typeof createOrbit>) => (ORBIT.azimuth - o.azimuth) / 100;
    expect(per(wall)).toBeCloseTo(ORBIT.turn / ORBIT.span, 9);
    expect(per(panel)).toBeGreaterThan(per(wall));
  });
});
