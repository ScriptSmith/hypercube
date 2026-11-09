import { describe, expect, it } from "vitest";
import { createShow } from "../../../src/apps/trig/show";
import {
  ALL_PARTS,
  FULL_SECS,
  fnsAt,
  lineAt,
  partsAt,
  showLength,
  STEPS,
  stepsFor,
  walkAt,
} from "../../../src/apps/trig/walk";

describe("trig walk-through", () => {
  it("has its seven steps in order, each with short captions", () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      "circle",
      "triangle",
      "squares",
      "tan",
      "arc",
      "waves",
      "signs",
    ]);
    for (const s of STEPS) {
      for (const l of s.lines) {
        expect(l.length, l).toBeLessThanOrEqual(40);
        expect(l.includes(String.fromCharCode(0x2014)), l).toBe(false);
        // Sentence case: a capital or a formula first, no capitals after unless a formula.
        expect(l[0] === l[0]!.toUpperCase() || /^(sin|cos|tan)/.test(l), l).toBe(true);
      }
    }
  });

  it("drops the tan step and caption without tan", () => {
    const without = stepsFor(false);
    expect(without.map((s) => s.id)).not.toContain("tan");
    expect(without.flatMap((s) => s.lines).some((l) => l.startsWith("tan"))).toBe(false);
    expect(stepsFor(true)).toHaveLength(7);
  });

  it("walks through the steps and the whole picture, then loops", () => {
    const steps = stepsFor(true);
    expect(walkAt(steps, 0)).toMatchObject({ step: 0, line: 0 });
    const s0 = steps[0]!.secs;
    expect(walkAt(steps, s0 - 0.01).step).toBe(0);
    expect(walkAt(steps, s0 + 0.01).step).toBe(1);
    const len = showLength(steps);
    expect(walkAt(steps, len - FULL_SECS + 1).step).toBe(steps.length);
    expect(walkAt(steps, len + 0.5).step).toBe(0);
    expect(walkAt(steps, -0.5).step).toBe(steps.length);
  });

  it("shows each caption of a step in turn", () => {
    const s = STEPS[5]!;
    const share = s.secs / s.lines.length;
    expect(lineAt(s, 0)).toBe(0);
    expect(lineAt(s, share + 0.01)).toBe(1);
    expect(lineAt(s, 2 * share + 0.01)).toBe(2);
    expect(lineAt(s, s.secs + 0.01)).toBe(0);
  });

  it("adds one part of the picture a step", () => {
    const steps = stepsFor(true);
    const at = (i: number) => partsAt(steps, i);
    expect(at(0)).toMatchObject({ triangle: false, tan: false, arc: false, graphs: false });
    expect(at(1)).toMatchObject({ triangle: true, squares: false, tan: false });
    expect(at(2)).toMatchObject({ triangle: true, squares: true });
    expect(at(3)).toMatchObject({ squares: false, tan: true, arc: false });
    expect(at(4)).toMatchObject({ arc: true, radians: true, graphs: false });
    expect(at(5)).toMatchObject({ radians: false, graphs: true, signs: false });
    expect(at(6)).toMatchObject({ graphs: true, signs: true, focus: "signs" });
    expect(at(7)).toBe(ALL_PARTS);
    expect(fnsAt(at(0))).toEqual([]);
    expect(fnsAt(at(1))).toEqual(["sin", "cos"]);
    expect(fnsAt(at(3))).toEqual(["sin", "cos", "tan"]);
  });
});

describe("trig show", () => {
  const steps = stepsFor(true);

  it("explore: plays until taken over, then shows everything; plays again when asked", () => {
    const show = createShow("explore", steps, 0);
    expect(show.at(1000, 0)).toMatchObject({ auto: true, step: 0, id: "circle" });
    show.hold(5000, 0);
    const held = show.at(6000, 0);
    expect(held).toMatchObject({ auto: false, step: null, caption: null });
    expect(held.parts).toBe(ALL_PARTS);
    show.play(10_000);
    expect(show.at(10_500, 0)).toMatchObject({ auto: true, step: 0 });
  });

  it("explore: Back and Next step through the walk-through, past the last step shows everything", () => {
    const show = createShow("explore", steps, 0);
    expect(show.at(1000, 0)).toMatchObject({ auto: true, stepping: true, step: 0 });
    show.next(1000, 0);
    expect(show.at(30_000, 0)).toMatchObject({ auto: false, stepping: true, step: 1 });
    // A touch on the circle now keeps the step, as in `steps`.
    show.hold(30_000, 0);
    expect(show.at(31_000, 0)).toMatchObject({ stepping: true, step: 1 });
    show.back(31_000, 0);
    show.back(31_000, 0);
    expect(show.at(31_000, 0).step).toBe(0);
    for (let i = 0; i < steps.length - 1; i++) show.next(32_000, 0);
    expect(show.at(32_000, 0).step).toBe(steps.length - 1);
    show.next(32_000, 0);
    expect(show.at(33_000, 0)).toMatchObject({ auto: false, stepping: false, step: null });
    expect(show.at(33_000, 0).parts).toBe(ALL_PARTS);
    // Back and Next do nothing while everything shows (their buttons are hidden).
    show.next(34_000, 0);
    expect(show.at(34_000, 0).stepping).toBe(false);
  });

  it("explore: Show me plays the steps from the first, then shows everything", () => {
    const show = createShow("explore", steps, 0);
    show.hold(5000, 0);
    expect(show.at(5000, 0).stepping).toBe(false);
    show.guide(10_000);
    expect(show.at(10_000, 0)).toMatchObject({ auto: true, stepping: true, step: 0 });
    const s0 = steps[0]!.secs * 1000;
    expect(show.at(10_000 + s0 + 100, 0).step).toBe(1);
    const len = steps.reduce((n, s) => n + s.secs, 0) * 1000;
    expect(show.at(10_000 + len - 100, 0).step).toBe(steps.length - 1);
    expect(show.at(10_000 + len + 100, 0)).toMatchObject({ auto: false, stepping: false });
    // A touch while the steps play holds the step, as in `steps`.
    show.guide(100_000);
    show.hold(100_000 + s0 + 100, 0);
    expect(show.auto).toBe(false);
    expect(show.at(200_000, 0)).toMatchObject({ stepping: true, step: 1 });
    // Idle plays the walk-through again; a touch then shows everything.
    show.play(300_000);
    show.hold(301_000, 0);
    expect(show.at(301_000, 0).stepping).toBe(false);
  });

  it("steps: advances by itself, holds the step when taken over, and Next and Back move it", () => {
    const show = createShow("steps", steps, 0);
    const s0 = steps[0]!.secs * 1000;
    expect(show.at(s0 + 100, 0).step).toBe(1);
    show.hold(s0 + 100, 0);
    expect(show.auto).toBe(false);
    expect(show.at(s0 + 60_000, 0).step).toBe(1);
    show.next(s0 + 60_000, 0);
    expect(show.at(s0 + 60_100, 0)).toMatchObject({ step: 2, id: "squares" });
    show.back(0, 0);
    show.back(0, 0);
    show.back(0, 0);
    expect(show.at(0, 0).step).toBe(0);
    for (let i = 0; i < 10; i++) show.next(0, 0);
    expect(show.at(0, 0)).toMatchObject({ step: 6, id: "signs" });
    // A held step's animations loop.
    expect(show.at(steps[6]!.secs * 1000 + 500, 0).t).toBeCloseTo(0.5, 6);
    show.play(0);
    expect(show.auto).toBe(true);
  });

  it("on a bank, runs from the shared clock so every frame shows the same step", () => {
    const a = createShow("explore", steps, "clock");
    const b = createShow("explore", steps, "clock");
    for (const clock of [0, 12_345, 54_321, 99_999]) {
      expect(a.at(100, clock)).toEqual(b.at(987_654, clock));
    }
  });
});
