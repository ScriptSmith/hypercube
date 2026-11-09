import { describe, expect, it } from "vitest";
import {
  createGlides,
  createKeys,
  createMotion,
  createRemote,
  fallTime,
  LATCH_MS,
  lift,
  LIFT_FROM,
  LIFT_FULL,
  MAX_ACTIVE,
  MAX_REMOTE,
  REMOTE_TTL_MS,
} from "../../../src/apps/chladni/drive";
import { DAMPING_HOME, qOf } from "../../../src/apps/chladni/knobs";
import { type Drive, HOME, modesFor, Q } from "../../../src/apps/chladni/modes";

describe("keys", () => {
  it("a tap rings for about four seconds", () => {
    const keys = createKeys();
    keys.press(2, 5, 1000);
    keys.release(2, 1100);
    expect(keys.ringing(2, 1100)).toBe(true);
    expect(keys.ringing(2, 1000 + LATCH_MS - 1)).toBe(true);
    expect(keys.ringing(2, 1000 + LATCH_MS + 1)).toBe(false);
    expect(keys.active(1200)).toEqual([{ key: 2, mode: 5 }]);
    expect(keys.presses).toBe(1);
  });

  it("holding keeps it ringing, and letting go after the latch stops it", () => {
    const keys = createKeys();
    keys.press(0, 1, 0);
    expect(keys.ringing(0, 9000)).toBe(true);
    keys.release(0, 9000);
    expect(keys.ringing(0, 9001)).toBe(false);
  });

  it("two fingers on one key: it rings until both lift", () => {
    const keys = createKeys();
    keys.press(1, 3, 0);
    keys.press(1, 3, 100);
    keys.release(1, 6000);
    expect(keys.ringing(1, 7000)).toBe(true);
    keys.release(1, 7000);
    expect(keys.ringing(1, 7001)).toBe(false);
  });

  it("a release with nothing down does nothing", () => {
    const keys = createKeys();
    keys.release(4, 0);
    expect(keys.active(0)).toEqual([]);
  });
});

describe("glides", () => {
  it("drive while held and stop on release", () => {
    const g = createGlides();
    g.set(0, 3.5);
    g.set(1, 7);
    expect(g.active()).toEqual([
      { strip: 0, freq: 3.5 },
      { strip: 1, freq: 7 },
    ]);
    g.set(0, null);
    expect(g.active()).toEqual([{ strip: 1, freq: 7 }]);
    g.set(1, Number.NaN);
    expect(g.active()).toEqual([]);
  });
});

describe("remote drives (the screen's view of a bank)", () => {
  it("expire 1.5 s after the last heartbeat", () => {
    const r = createRemote();
    r.note("p1", 3, 3, true, 0);
    expect(r.drives(REMOTE_TTL_MS - 1)).toHaveLength(1);
    r.note("p1", 3, 3, true, 1000);
    expect(r.drives(1000 + REMOTE_TTL_MS - 1)).toHaveLength(1);
    expect(r.drives(1000 + REMOTE_TTL_MS + 1)).toHaveLength(0);
  });

  it("stop at once when their frame says so or leaves", () => {
    const r = createRemote();
    r.note("p1", 0, 0, true, 0);
    r.glide("p2", 4, 2.5, true, 0);
    expect(r.drives(10)).toEqual([
      { kind: "key", mode: 0, freq: 0, level: 1 },
      { kind: "glide", mode: -1, freq: 2.5, level: 1 },
    ]);
    r.note("p1", 0, 0, false, 20);
    expect(r.size(20)).toBe(1);
    r.forget("p2");
    expect(r.size(20)).toBe(0);
  });

  it("are bounded", () => {
    const r = createRemote();
    for (let i = 0; i < 500; i++) r.note(`f${i}`, i % 200, 0, true, i);
    expect(r.size(500)).toBeLessThanOrEqual(MAX_REMOTE);
  });
});

describe("plate motion", () => {
  const modes = modesFor("square");
  const at = HOME.square;
  const key = (mode: number): Drive => ({ kind: "key", mode, freq: 0, level: 1 });
  const run = (m: ReturnType<typeof createMotion>, seconds: number, drives: Drive[], q = Q) => {
    for (let t = 0; t < seconds; t += 1 / 60) m.update(1 / 60, modes, drives, at, [], q);
  };

  it("rises to a pressed key's mode and rings down over a second or two", () => {
    const m = createMotion(modes.length);
    run(m, 2, [key(4)]);
    expect(m.amps[4]).toBeGreaterThan(0.9);
    expect(m.strongest()).toBe(4);
    run(m, 1, []);
    expect(m.amps[4]).toBeLessThan(0.25);
    run(m, 2, []);
    expect(m.amps[4]).toBeLessThan(0.01);
    run(m, 3, []);
    expect(m.level()).toBeLessThan(0.002);
    expect(m.strongest()).toBe(-1);
  });

  it("rings down faster the more it is damped, as a real plate's time constant follows Q", () => {
    expect(qOf(DAMPING_HOME)).toBeCloseTo(Q, 6);
    const left = (damping: number) => {
      const m = createMotion(modes.length);
      run(m, 3, [key(4)], qOf(damping));
      run(m, 0.5, [], qOf(damping));
      return m.amps[4]!;
    };
    const light = left(0);
    const home = left(DAMPING_HOME);
    const heavy = left(1);
    expect(light).toBeGreaterThan(home);
    expect(home).toBeGreaterThan(heavy * 5);
    expect(heavy).toBeLessThan(0.01);
    expect(fallTime(qOf(0))).toBeGreaterThan(fallTime(qOf(1)) * 10);
  });

  it("lists the strongest modes first, at most eight", () => {
    const m = createMotion(modes.length);
    const drives = modes.map((_, i) => ({ ...key(i), level: (i + 1) / modes.length }));
    run(m, 3, drives);
    const active = m.active();
    expect(active).toHaveLength(MAX_ACTIVE);
    expect(m.amps[active[0]!]).toBe(Math.max(...m.amps));
    for (let i = 1; i < active.length; i++) {
      expect(Math.abs(m.amps[active[i]!]!)).toBeLessThanOrEqual(Math.abs(m.amps[active[i - 1]!]!));
    }
  });
});

describe("lift", () => {
  it("throws no sand below the threshold and all of it above", () => {
    expect(lift(0)).toBe(0);
    expect(lift(LIFT_FROM)).toBe(0);
    expect(lift(LIFT_FULL)).toBe(1);
    expect(lift(2)).toBe(1);
    expect(lift((LIFT_FROM + LIFT_FULL) / 2)).toBeCloseTo(0.5, 9);
  });
});
