import { describe, expect, it } from "vitest";
import {
  breathCurve,
  createShow,
  MAX_RIPPLES,
  type Pace,
  PACING,
  STIR_GAP,
  STIR_LENGTH,
  spinOf,
} from "../../../src/apps/echidna/show";
import { apply3 } from "../../../src/core/sphere";
import { createRng } from "../../../src/core/rng";

const DT = 1 / 60;

/** Run a show for `minutes`, noting when things start. */
const run = (pace: Pace, minutes: number, stirs = true, seed = "show") => {
  const show = createShow(createRng(seed), { stirs, pace });
  const starts = { ripple: [] as number[], stir: [] as number[] };
  const stirEnds: number[] = [];
  let last = { ...show.counts };
  let maxRipples = 0;
  let maxTilt = 0;
  let still = 0;
  let longestStill = 0;
  let stirring = false;
  let maxYaw = 0;
  for (let i = 0; i < minutes * 3600; i++) {
    show.step(DT);
    if (show.counts.ripples > last.ripples) starts.ripple.push(show.time);
    if (show.counts.stirs > last.stirs) {
      starts.stir.push(show.time);
      stirring = true;
    }
    if (stirring && show.bristle === 0 && show.time - starts.stir.at(-1)! > STIR_LENGTH) {
      stirring = false;
      stirEnds.push(show.time);
    }
    last = { ...show.counts };
    maxRipples = Math.max(maxRipples, show.ripples.length);
    maxTilt = Math.max(maxTilt, Math.abs(show.tilt[0]), Math.abs(show.tilt[1]));
    maxYaw = Math.max(maxYaw, show.yaw);
    still = show.breath === 0 ? still + DT : 0;
    longestStill = Math.max(longestStill, still);
  }
  return { show, starts, stirEnds, maxRipples, maxTilt, longestStill, maxYaw };
};

describe("breathing", () => {
  it("rises in 40 % of a breath and falls in the rest", () => {
    expect(breathCurve(0)).toBeCloseTo(0);
    expect(breathCurve(0.4)).toBeCloseTo(1);
    expect(breathCurve(0.2)).toBeCloseTo(0.5);
    expect(breathCurve(0.999)).toBeLessThan(0.001);
  });

  it("is slow, with pauses, sped up from a resting echidna so people notice", () => {
    const sleepy = run("sleepy", 30);
    const perMinute = sleepy.show.counts.breaths / 30;
    expect(perMinute).toBeGreaterThan(6);
    expect(perMinute).toBeLessThan(11);
    expect(sleepy.longestStill).toBeGreaterThan(PACING.sleepy.pause.min);
    expect(sleepy.longestStill).toBeLessThan(PACING.sleepy.pause.max + 1);
    const restless = run("restless", 30);
    expect(restless.show.counts.breaths / 30).toBeGreaterThan(perMinute);
  });
});

describe("twitches and stirs", () => {
  it("twitch a patch every so often, never more than a few at once", () => {
    const { starts, maxRipples } = run("sleepy", 30);
    const gaps = starts.ripple.slice(1).map((t, i) => t - starts.ripple[i]!);
    expect(gaps.length).toBeGreaterThan(60);
    for (const g of gaps) {
      expect(g).toBeGreaterThan(PACING.sleepy.ripple.min - 0.05);
      expect(g).toBeLessThan(PACING.sleepy.ripple.max + 0.05);
    }
    expect(maxRipples).toBeLessThanOrEqual(MAX_RIPPLES);
  });

  it("stir rarely, never within a minute of the last stir", () => {
    for (const pace of ["sleepy", "restless"] as const) {
      const { starts, stirEnds } = run(pace, 60, true, `stir-${pace}`);
      expect(starts.stir.length).toBeGreaterThan(pace === "sleepy" ? 8 : 18);
      for (let i = 1; i < starts.stir.length; i++) {
        expect(starts.stir[i]! - stirEnds[i - 1]!).toBeGreaterThanOrEqual(STIR_GAP - 0.05);
      }
    }
  });

  it("refuses a stir asked for within the gap", () => {
    const show = createShow(createRng("ask"), { stirs: true, pace: "sleepy" });
    expect(show.trigger("stir")).toBe(true);
    for (let i = 0; i < (STIR_LENGTH + 10) * 60; i++) show.step(DT);
    expect(show.trigger("stir")).toBe(false);
    for (let i = 0; i < STIR_GAP * 60; i++) show.step(DT);
    expect(show.trigger("stir")).toBe(true);
  });

  it("all stop with the option off, while breathing and turning go on", () => {
    const { show, maxYaw } = run("sleepy", 10, false);
    const c = show.counts;
    expect(c.ripples + c.sniffs + c.claws + c.stretches + c.lids + c.stirs).toBe(0);
    expect(c.breaths).toBeGreaterThan(50);
    expect(maxYaw).toBeGreaterThan(0);
  });
});

describe("the curl", () => {
  it("turns once in its period and leans only a few degrees", () => {
    const show = createShow(createRng("turn"), { stirs: false, pace: "sleepy" });
    const start = show.yaw;
    const turn = PACING.sleepy.turn;
    for (let i = 0; i < (turn / 4) * 60; i++) show.step(DT);
    const quarter = (((show.yaw - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(quarter).toBeCloseTo(Math.PI / 2, 2);
    const { maxTilt } = run("restless", 30);
    expect(maxTilt).toBeLessThan(0.16);
  });

  it("is a proper rotation, keeping the belly underneath", () => {
    const spin = spinOf(1.3, [0.08, -0.05]);
    const down = apply3(spin, [0, -1, 0]);
    expect(Math.hypot(...down)).toBeCloseTo(1, 9);
    expect(down[1]).toBeLessThan(-0.99);
  });
});
