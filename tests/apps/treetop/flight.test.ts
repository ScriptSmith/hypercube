import { describe, expect, it } from "vitest";
import {
  ADULT,
  BOOST_MAX,
  CEIL_Y,
  FLOOR_Y,
  GRACE_S,
  RADIUS,
  STANDARD,
  START_Y,
  TUMBLE_S,
} from "../../../src/apps/treetop/config";
import type { Course, Gate } from "../../../src/apps/treetop/course";
import {
  createFlight,
  flap,
  flyingSpeed,
  hitsGate,
  launch,
  resetFlight,
  stepFlight,
} from "../../../src/apps/treetop/flight";
import { config, DT, rulesOf } from "./helpers";

const gate = (i: number, x: number, c: number, h = 520): Gate => ({
  i,
  x,
  w: 220,
  c,
  h,
  style: "rock",
  look: 0,
});
const course = (gates: Gate[], length = 20_000): Course => ({ label: "t", length, gates, hash: 0 });
const open = course([]);

describe("flight", () => {
  it("sets the climb on a flap rather than adding to it", () => {
    const f = createFlight();
    launch(f, STANDARD, rulesOf(config()), 0);
    flap(f, STANDARD);
    flap(f, STANDARD);
    flap(f, STANDARD);
    expect(f.vy).toBe(-STANDARD.flap);
  });

  it("doesn't flap unless flying", () => {
    const f = createFlight();
    expect(flap(f, STANDARD)).toBe(false);
    expect(f.vy).toBe(0);
  });

  it("is pushed down by the soft ceiling without crashing", () => {
    const cfg = config();
    const f = createFlight();
    launch(f, STANDARD, rulesOf(cfg), 0);
    for (let i = 0; i < 400; i++) {
      flap(f, STANDARD);
      stepFlight(f, DT, open, STANDARD, rulesOf(cfg), i * DT);
      expect(f.y - RADIUS).toBeGreaterThanOrEqual(CEIL_Y - 1e-6);
    }
    expect(f.mode).toBe("flying");
    expect(f.crashes).toBe(0);
  });

  it("tumbles on the floor, then comes back at the next gap's height with a moment's grace", () => {
    const cfg = config();
    const rules = rulesOf(cfg);
    const c = course([gate(0, 900, 700)]);
    const f = createFlight();
    launch(f, STANDARD, rules, 0);
    const events: string[] = [];
    let t = 0;
    while (f.mode === "flying" && t < 5) {
      t += DT;
      stepFlight(f, DT, c, STANDARD, rules, t, (e) => events.push(e.type));
    }
    expect(events).toContain("crash");
    expect(f.mode).toBe("tumbling");
    expect(f.y).toBeLessThanOrEqual(FLOOR_Y - RADIUS);
    const crashedAt = t;
    while (f.mode === "tumbling") {
      t += DT;
      stepFlight(f, DT, c, STANDARD, rules, t, (e) => events.push(e.type));
    }
    expect(t - crashedAt).toBeCloseTo(TUMBLE_S, 1);
    expect(events.at(-1)).toBe("recover");
    expect(f.mode).toBe("flying");
    expect(f.y).toBe(700);
    expect(f.grace).toBeCloseTo(GRACE_S, 5);
    expect(f.speed).toBeCloseTo(cfg.base * 0.3, 5);
    stepFlight(f, DT, c, STANDARD, rules, t + DT);
    expect(f.speed).toBe(cfg.base);
  });

  it("speeds up 4 % per clean gate, up to 40 %, and back to base after a crash", () => {
    const cfg = config();
    const rules = rulesOf(cfg);
    const gates = Array.from({ length: 14 }, (_, i) => gate(i, 600 + i * 700, START_Y));
    const c = course(gates);
    const f = createFlight();
    launch(f, STANDARD, rules, 0);
    const speeds: number[] = [];
    let t = 0;
    for (let n = 0; n < 12 && t < 60;) {
      // Hold the glider level in the gaps.
      if (f.y > START_Y + 40 && f.vy > 0) flap(f, STANDARD);
      t += DT;
      stepFlight(f, DT, c, STANDARD, rules, t, (e) => {
        if (e.type === "gate") {
          n++;
          speeds.push(flyingSpeed(f, STANDARD, rules, t));
        }
      });
    }
    expect(f.crashes).toBe(0);
    expect(speeds[0]).toBeCloseTo(cfg.base * 1.04, 5);
    expect(speeds[4]).toBeCloseTo(cfg.base * 1.2, 5);
    expect(Math.max(...speeds)).toBeCloseTo(cfg.base * (1 + BOOST_MAX), 5);
    f.vy = 2000;
    while (f.mode === "flying") stepFlight(f, DT, c, STANDARD, rules, (t += DT));
    expect(f.clean).toBe(0);
  });

  it("is out for good after a crash under the out rule, and the course speeds up instead", () => {
    const cfg = config({ crash: "out" });
    const rules = rulesOf(cfg);
    expect(flyingSpeed(createFlight(), STANDARD, rules, 0)).toBe(cfg.base);
    expect(flyingSpeed(createFlight(), STANDARD, rules, cfg.race)).toBeCloseTo(cfg.base * 1.5, 5);
    expect(flyingSpeed(createFlight(), ADULT, rules, 0)).toBeCloseTo(cfg.base * 1.2, 5);
    const f = createFlight();
    launch(f, STANDARD, rules, 0);
    let t = 0;
    while (f.mode === "flying") stepFlight(f, DT, open, STANDARD, rules, (t += DT));
    expect(f.mode).toBe("out");
    const x = f.x;
    for (let i = 0; i < 600; i++) stepFlight(f, DT, open, STANDARD, rules, (t += DT));
    expect(f.mode).toBe("out");
    expect(f.x - x).toBeLessThan(cfg.base);
    expect(f.y).toBe(FLOOR_Y - RADIUS);
  });

  it("times the finish to the moment it crossed the line", () => {
    const cfg = config();
    const rules = rulesOf(cfg);
    const c = course([], 1000);
    const f = createFlight();
    launch(f, STANDARD, rules, 0);
    let fin: number | null = null;
    let t = 0;
    while (f.mode === "flying" && t < 10) {
      if (f.y > START_Y && f.vy > 0) flap(f, STANDARD);
      stepFlight(f, DT, c, STANDARD, rules, (t += DT), (e) => {
        if (e.type === "finish") fin = e.t;
      });
    }
    expect(f.mode).toBe("finished");
    expect(fin).toBe(f.fin);
    expect(f.fin!).toBeCloseTo((1000 / cfg.base) * 1000, -1);
  });

  it("hits the obstacles above and below a gap but not the gap itself", () => {
    const g = gate(0, 1000, 900, 520);
    expect(hitsGate(g, 1110, 900)).toBe(false);
    expect(hitsGate(g, 1110, 900 - 260 + RADIUS)).toBe(false);
    expect(hitsGate(g, 1110, 900 - 260)).toBe(true);
    expect(hitsGate(g, 1110, 900 + 260)).toBe(true);
    expect(hitsGate(g, 1000 - RADIUS, 300)).toBe(false);
    expect(hitsGate(g, 1000 + 220 + RADIUS, 300)).toBe(false);
  });

  it("waits on the start line at its own height, and keeps it across a reset", () => {
    const f = createFlight();
    f.home = START_Y + 170;
    resetFlight(f);
    expect(f.home).toBe(START_Y + 170);
    for (let i = 0; i < 200; i++) stepFlight(f, DT, open, STANDARD, rulesOf(config()), 0);
    expect(f.mode).toBe("waiting");
    expect(f.x).toBe(0);
    expect(Math.abs(f.y - (START_Y + 170))).toBeLessThanOrEqual(30);
  });
});
