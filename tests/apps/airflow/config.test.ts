import { describe, expect, it } from "vitest";
import {
  KINDS,
  nearestStep,
  readConfig,
  reynoldsOf,
  speedOf,
  TAU_MIN,
  tauOf,
  U_STRONG,
  WINDS,
} from "../../../src/apps/airflow/config";

describe("airflow config", () => {
  it("reads options, falling back to defaults", () => {
    expect(readConfig("shapes", {}, "wall")).toEqual({
      hands: false,
      wind: WINDS.steady,
      view: "smoke",
      shapes: 3,
      arrows: true,
    });
    const c = readConfig(
      "hands",
      { wind: "strong", view: "swirl", shapes: 9, arrows: false },
      "wall",
    );
    expect(c).toEqual({ hands: true, wind: WINDS.strong, view: "swirl", shapes: 4, arrows: false });
    expect(
      readConfig("shapes", { wind: "hurricane", view: "x", shapes: "lots" }, "wall"),
    ).toMatchObject({
      wind: WINDS.steady,
      view: "smoke",
      shapes: 3,
    });
    expect(readConfig("shapes", { shapes: 4 }, "kiosk").shapes).toBe(2);
    expect(readConfig("shapes", { shapes: 4 }, "panel").shapes).toBe(1);
  });

  it("speeds up the air and raises the Reynolds number as the wind rises", () => {
    let lastU = 0;
    let lastRe = 0;
    for (let w = 0; w <= 1.0001; w += 0.1) {
      const u = speedOf(w);
      const re = reynoldsOf(w);
      expect(u).toBeGreaterThan(lastU);
      expect(re).toBeGreaterThan(lastRe);
      expect(u).toBeLessThanOrEqual(U_STRONG + 1e-12);
      lastU = u;
      lastRe = re;
    }
    // Gentle stays below the shedding threshold (about 47); strong is well above it.
    expect(reynoldsOf(WINDS.gentle)).toBeLessThan(45);
    expect(reynoldsOf(WINDS.steady)).toBeGreaterThan(90);
  });

  it("never asks for a relaxation time below the floor, at any grid", () => {
    for (const disc of [5, 13, 45, 80]) {
      for (let w = 0; w <= 1; w += 0.25) {
        for (const kind of Object.values(KINDS))
          expect(tauOf(w, disc, kind.speed)).toBeGreaterThanOrEqual(TAU_MIN);
      }
    }
  });

  it("snaps a size to the nearest step", () => {
    const steps = [0.6, 0.8, 1, 1.25, 1.5];
    expect(nearestStep(steps, 1)).toBe(2);
    expect(nearestStep(steps, 0.1)).toBe(0);
    expect(nearestStep(steps, 1.3)).toBe(3);
    expect(nearestStep(steps, 9)).toBe(4);
    expect(nearestStep(steps.slice(0, 4), 1.5)).toBe(3);
  });

  it("slows the updrafts, whose shapes fill a third of the chimney", () => {
    expect(KINDS.panel.speed).toBeLessThan(1);
    expect(KINDS.pair.speed).toBe(KINDS.panel.speed);
    expect(speedOf(1, KINDS.panel.speed)).toBeLessThan(0.065);
  });
});
