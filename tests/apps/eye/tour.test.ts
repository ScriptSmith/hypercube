import { describe, expect, it } from "vitest";
import { defaultState, derive } from "../../../src/apps/eye/model";
import {
  BANK_STAGGER_S,
  BEAT_B,
  BEAT_C,
  bankCondition,
  bankTour,
  CYCLE_S,
  PART_FOR,
  soloTour,
} from "../../../src/apps/eye/tour";

const LIGHT = 0.6;

describe("the solo tour", () => {
  it("starts on a typical eye with the rays focused on the retina", () => {
    const f = soloTour(0, LIGHT);
    expect(f.state.condition).toBe("typical");
    expect(Math.abs(derive(f.state).se)).toBeLessThan(0.01);
  });

  it("then lengthens the eye into short sight, puts glasses on, and shows the retina", () => {
    const at = (s: number) => soloTour(CYCLE_S + s, LIGHT);
    expect(at(0.5).state.condition).toBe("myopia");
    expect(at(1).state.length).toBeLessThan(at(6).state.length);
    expect(at(6).state.length).toBeCloseTo(defaultState("myopia").length, 2);
    expect(at(2).hand?.target).toEqual(expect.objectContaining({ kind: "slider", id: "length" }));
    expect(at(BEAT_B + 1).state.correction).toBe("glasses");
    expect(at(BEAT_B).hand?.target).toEqual({ kind: "button", id: "corrA" });
    expect(at(BEAT_C + 1).part).toBe(PART_FOR.myopia);
  });

  it("visits every condition in turn and loops", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 11; n++) seen.add(soloTour(n * CYCLE_S + 3, LIGHT).state.condition);
    expect(seen.size).toBe(11);
    expect(soloTour(11 * CYCLE_S + 3, LIGHT).state.condition).toBe("typical");
  });

  it("flips a toggle or turns the page where a condition has no correction", () => {
    let t = 0;
    while (soloTour(t, LIGHT).state.condition !== "glaucoma") t += CYCLE_S;
    expect(soloTour(t + BEAT_B + 1, LIGHT).state.toggle).toBe(1);
    while (soloTour(t, LIGHT).state.condition !== "amd") t += CYCLE_S;
    expect(soloTour(t + BEAT_B + 1, LIGHT).page).toBe(1);
  });
});

describe("the bank tour", () => {
  it("shows different conditions across the bank, on the shared clock", () => {
    for (const t of [1000, 5000.3, 123456.7, 1.7e9]) {
      const frames = Array.from({ length: 10 }, (_, p) => bankCondition(t, p));
      // Away from a hand-over (every frame in the same cycle), every frame differs.
      if (new Set(frames.map((f) => f.n)).size === 1) {
        expect(new Set(frames.map((f) => f.condition)).size).toBe(10);
      }
    }
    const settled = CYCLE_S * 50 + BANK_STAGGER_S * 10 + 1;
    const all = Array.from({ length: 10 }, (_, p) => bankCondition(settled, p).condition);
    expect(new Set(all).size).toBe(10);
    expect(bankTour(50, 3, LIGHT).state).toEqual(bankTour(50, 3, LIGHT).state);
  });

  it("passes each condition one frame to the left, the hand-over rippling rightwards", () => {
    const t = CYCLE_S * 100;
    const before = bankCondition(t - 1, 4).condition;
    expect(bankCondition(t + BANK_STAGGER_S * 5 + 1, 3).condition).toBe(before);
  });
});
