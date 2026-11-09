import { describe, expect, it } from "vitest";
import {
  createFleet,
  FADE_AFTER_MS,
  FADE_OUT_MS,
  MAX_VEHICLES,
  RETIRE_MS,
  TELEPORT_M,
  TRAIL_EVERY_MS,
  TRAIL_MAX,
  TRAIL_MS,
  trailPoints,
} from "../../../src/apps/transit/fleet";
import { makeShapeLine } from "../../../src/apps/transit/match";
import { emptyNetwork, type NetShape, type Network } from "../../../src/apps/transit/network";
import type { Snapshot, SnapVehicle } from "../../../src/apps/transit/replay";

const T = 1_792_675_000;

const net = (): Network => {
  const n = emptyNetwork();
  const shape: NetShape = {
    ...makeShapeLine(Float32Array.from([0, 0, 1000, 0, 1000, 1000])),
    route: "60",
    dir: 0,
  };
  n.routes.set("60", { base: "60", mode: "bus", headsigns: [null, null] });
  n.routes.set("F1", { base: "F1", mode: "ferry", headsigns: [null, null] });
  n.shapes.push(shape);
  n.byRoute.set("60", [shape]);
  return n;
};

const v = (
  key: number,
  x: number,
  y: number,
  ts: number,
  extra: Partial<SnapVehicle> = {},
): SnapVehicle => ({
  key,
  route: "60",
  dir: 0,
  x,
  y,
  bearing: -1,
  ts,
  ...extra,
});
const snap = (vehicles: SnapVehicle[], source: Snapshot["source"] = "live"): Snapshot => ({
  t: T,
  vehicles,
  source,
});

describe("fleet", () => {
  it("places a new vehicle at its fix, fading in, with the mode of its route", () => {
    const f = createFleet({ trails: true });
    const n = net();
    f.apply(
      snap([v(1, 200, 0, T), v(2, 50, 50, T, { route: "F1" }), v(3, 9, 9, T, { route: "BNFG" })]),
      0,
      n,
    );
    f.step(600);
    const a = f.vehicles.get(1)!;
    expect([a.x, a.y]).toEqual([200, 0]);
    expect(a.alpha).toBeCloseTo(0.5);
    expect(a.mode).toBe("bus");
    expect(f.vehicles.get(2)!.mode).toBe("ferry");
    expect(f.vehicles.get(3)!.mode).toBe("train");
    // Its heading comes from the shape it sits on.
    expect(a.headingKnown).toBe(true);
    expect(a.heading).toBeCloseTo(Math.PI / 2);
  });

  it("moves along the shape to the next fix over the gap between fixes", () => {
    const f = createFleet({ trails: false });
    const n = net();
    f.apply(snap([v(1, 800, 0, T)]), 0, n);
    f.apply(snap([v(1, 1000, 400, T + 20)]), 1000, n);
    f.step(1000 + 10_000);
    const a = f.vehicles.get(1)!;
    // Halfway along 600 m of shape: 100 m past the corner.
    expect(a.x).toBeCloseTo(1000, 0);
    expect(a.y).toBeCloseTo(100, 0);
    f.step(1000 + 20_000);
    expect([a.x, a.y]).toEqual([1000, 400]);
    f.step(1000 + 40_000);
    expect([a.x, a.y]).toEqual([1000, 400]);
  });

  it("starts each new leg from where the vehicle is drawn, so it never jumps", () => {
    const f = createFleet({ trails: false });
    const n = net();
    f.apply(snap([v(1, 0, 0, T)]), 0, n);
    f.apply(snap([v(1, 600, 0, T + 30)]), 0, n);
    f.step(15_000);
    const mid = f.vehicles.get(1)!.x;
    expect(mid).toBeCloseTo(300, 0);
    f.apply(snap([v(1, 900, 0, T + 45)]), 15_000, n);
    f.step(15_000);
    expect(f.vehicles.get(1)!.x).toBeCloseTo(mid, 3);
  });

  it("ignores a repeated fix and jumps (fading in again) over a long gap", () => {
    const f = createFleet({ trails: true });
    const n = net();
    f.apply(snap([v(1, 0, 0, T)]), 0, n);
    f.step(5000);
    f.apply(snap([v(1, 500, 0, T)]), 5000, n);
    f.step(6000);
    expect(f.vehicles.get(1)!.x).toBe(0);
    f.apply(snap([v(1, TELEPORT_M + 100, 0, T + 15)]), 7000, n);
    f.step(7000);
    const a = f.vehicles.get(1)!;
    expect(a.x).toBe(TELEPORT_M + 100);
    expect(a.alpha).toBe(0);
    expect(a.trailN).toBe(0);
  });

  it("fades out vehicles not heard for three minutes, then drops them", () => {
    const f = createFleet({ trails: false });
    f.apply(snap([v(1, 0, 0, T)]), 0, net());
    f.step(FADE_AFTER_MS);
    expect(f.vehicles.get(1)!.alpha).toBe(1);
    f.step(FADE_AFTER_MS + FADE_OUT_MS / 2);
    expect(f.vehicles.get(1)!.alpha).toBeCloseTo(0.5);
    f.step(FADE_AFTER_MS + FADE_OUT_MS + 1);
    expect(f.vehicles.size).toBe(0);
  });

  it("retires vehicles on request (the replay's when live data arrives)", () => {
    const f = createFleet({ trails: false });
    f.apply(snap([v(-1, 0, 0, T)], "replay"), 0, net());
    f.apply(snap([v(1, 0, 0, T)], "live"), 0, net());
    f.step(2000);
    f.retire((x) => x.source === "replay", 2000);
    f.step(2000 + RETIRE_MS / 2);
    expect(f.vehicles.get(-1)!.alpha).toBeCloseTo(0.5);
    f.step(2000 + RETIRE_MS + 1);
    expect([...f.vehicles.keys()]).toEqual([1]);
    expect(f.count()).toBe(1);
  });

  it("holds no more than MAX_VEHICLES", () => {
    const f = createFleet({ trails: false });
    const many = Array.from({ length: MAX_VEHICLES + 50 }, (_, i) => v(i + 1, i, 0, T));
    f.apply(snap(many), 0, net());
    expect(f.vehicles.size).toBe(MAX_VEHICLES);
  });

  it("keeps trails bounded in samples and age", () => {
    const f = createFleet({ trails: true });
    const n = net();
    f.apply(snap([v(1, 0, 0, T)]), 0, n);
    // Drive east forever: a fix every 15 s, 150 m on.
    let t = 0;
    for (let i = 1; i < 120; i++) {
      f.apply(snap([v(1, i * 150, 500, T + i * 15)]), t, n);
      for (let k = 0; k < 15_000 / TRAIL_EVERY_MS; k++) {
        t += TRAIL_EVERY_MS;
        f.step(t);
      }
    }
    const a = f.vehicles.get(1)!;
    expect(a.trailN).toBeLessThanOrEqual(TRAIL_MAX);
    const pts = trailPoints(a, [], TRAIL_MS, t);
    expect(pts.length / 2).toBeLessThanOrEqual(TRAIL_MAX + 1);
    // Newest last, ending where it is drawn.
    expect(pts.slice(-2)).toEqual([a.x, a.y]);
    expect(pts[0]!).toBeLessThan(pts[pts.length - 2]!);
    // A shorter age keeps fewer.
    expect(trailPoints(a, [], 20_000, t).length / 2).toBeLessThanOrEqual(
      20_000 / TRAIL_EVERY_MS + 2,
    );
  });

  it("samples no trail while standing still, or with trails off", () => {
    const still = createFleet({ trails: true });
    still.apply(snap([v(1, 0, 0, T)]), 0, net());
    for (let t = 0; t < 60_000; t += 1000) still.step(t);
    expect(still.vehicles.get(1)!.trailN).toBe(1);
    const off = createFleet({ trails: false });
    off.apply(snap([v(1, 0, 0, T)]), 0, net());
    off.apply(snap([v(1, 500, 0, T + 20)]), 0, net());
    for (let t = 0; t < 30_000; t += 1000) off.step(t);
    expect(off.vehicles.get(1)!.trailN).toBe(0);
  });
});
