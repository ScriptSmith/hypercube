import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../../../../src/apps/xrd/chapters";
import { checkState } from "../../../../src/apps/xrd/chapter";
import {
  decode,
  encode,
  litAt,
  presetFor,
  spotsAt,
  START,
  tubeNear,
  tubeOf,
} from "../../../../src/apps/xrd/chapters/goniometer/state";
import { watchParts } from "../../../../src/apps/xrd/chapters/goniometer";
import { CRYSTALS, dSpacing } from "../../../../src/apps/xrd/crystals";
import {
  apply,
  FLAT,
  latticePoints,
  leavesSurface,
  mul,
  orientFor,
  PRESETS,
  sphereGap,
  stageMatrix,
} from "../../../../src/apps/xrd/machine";

describe("chapter 5", () => {
  it("starts on the curved strip's preset, turned on to just before a flash", () => {
    expect({ ...START, omega: PRESETS.strip.state.omega }).toEqual(PRESETS.strip.state);
    expect(presetFor("plate")).toEqual(PRESETS.plate.state);
    // Aluminium's (1 1 1) flashes at θ under cobalt; the wheel starts a few degrees short of it.
    const theta =
      (Math.asin(START.lambda / (2 * dSpacing(CRYSTALS.aluminium.cell, 1, 1, 1))) * 180) / Math.PI;
    expect(theta - START.omega).toBeGreaterThan(2);
    expect(theta - START.omega).toBeLessThan(8);
  });

  it("lights each preset's tube, and the nearest tube for a nearby wavelength", () => {
    expect(tubeOf(PRESETS.plate.state.lambda)).toBe("copper");
    expect(tubeOf(PRESETS.strip.state.lambda)).toBe("cobalt");
    expect(tubeNear(1.5419)).toBe("copper");
    expect(tubeNear(1.789)).toBe("cobalt");
    expect(tubeNear(0.7093)).toBe("molybdenum");
    expect(tubeNear(1.2)).toBeNull();
  });

  it("never draws a scattered ray that heads down into the sample", () => {
    // The review's case: the strip's preset, where (-2 2 -2) sits near the sphere.
    const s = PRESETS.strip.state;
    const lit = litAt(s, 4);
    const n = apply(stageMatrix(s), [0, 1, 0]);
    for (const l of lit) {
      const psi = (l.psi * Math.PI) / 180;
      // The in-plane direction is enough to tell, since n lies in the plane here (χ near 0).
      expect(Math.cos(psi) * n[0] + Math.sin(psi) * n[1], `psi ${l.psi}`).toBeGreaterThan(-0.05);
    }
    // And the rule itself: s_out against the surface normal.
    const c = CRYSTALS.aluminium;
    const R = mul(stageMatrix(s), orientFor(c, FLAT.aluminium));
    const k0 = 1 / s.lambda;
    let below = 0;
    for (const p of latticePoints(c, 2 / s.lambda, 600)) {
      const g = apply(R, p.g);
      if (Math.abs(sphereGap(g, s.lambda)) > 0.02 * k0) continue;
      const out: [number, number, number] = [g[0] + k0, g[1], g[2]];
      if (!leavesSurface(s, out)) below++;
    }
    expect(below).toBeGreaterThan(0);
    // A ray straight up the surface normal leaves; one straight down doesn't.
    expect(leavesSurface({ omega: 30, chi: 0, phi: 0 }, n)).toBe(true);
    expect(leavesSurface({ omega: 30, chi: 0, phi: 0 }, [-n[0], -n[1], -n[2]])).toBe(false);
  });

  it("lays its watch view out so the face gets most of it, on wide and tall views", () => {
    for (const kind of ["strip", "plate"] as const) {
      for (const w of [
        { x: 0, y: 0, width: 992, height: 268 },
        { x: 0, y: 0, width: 865, height: 752 },
      ]) {
        const p = watchParts(w, kind);
        expect(p.face.width * p.face.height, `${kind} ${w.width}`).toBeGreaterThan(
          p.side.width * p.side.height,
        );
        for (const r of [p.face, p.side]) {
          expect(r.x).toBeGreaterThanOrEqual(w.x);
          expect(r.y).toBeGreaterThanOrEqual(w.y);
          expect(r.x + r.width).toBeLessThanOrEqual(w.x + w.width + 1e-9);
          expect(r.y + r.height).toBeLessThanOrEqual(w.y + w.height + 1e-9);
        }
      }
    }
  });

  it("round-trips its state within its ranges", () => {
    const s = {
      ...START,
      omega: 19.2,
      chi: -12.5,
      phi: 170,
      armTwoTheta: 38.4,
      distance: 150,
      detector: "plate" as const,
      lambda: 1.5406,
    };
    const v = encode(s);
    expect(checkState(CHAPTERS.goniometer, v)).not.toBeNull();
    expect(decode(v)).toEqual(s);
    expect(tubeOf(1.5406)).toBe("copper");
    expect(tubeOf(1.541867)).toBeNull();
  });

  it("puts aluminium's (1 1 1) flash on the detector's middle in the symmetric setting", () => {
    const lambda = 1.5406;
    const theta =
      (Math.asin(lambda / (2 * dSpacing(CRYSTALS.aluminium.cell, 1, 1, 1))) * 180) / Math.PI;
    for (const detector of ["strip", "plate"] as const) {
      const spots = spotsAt({
        omega: theta,
        chi: 0,
        phi: 0,
        armTwoTheta: 2 * theta,
        distance: detector === "strip" ? 280 : 121,
        detector,
        lambda,
      });
      expect(
        spots.some((p) => Math.abs(p.fu) < 1e-3 && Math.abs(p.fv) < 1e-3),
        detector,
      ).toBe(true);
    }
    expect(
      spotsAt({
        omega: theta + 5,
        chi: 0,
        phi: 0,
        armTwoTheta: 2 * theta,
        distance: 121,
        detector: "plate",
        lambda,
      }),
    ).toEqual([]);
  });

  it("drives the shared machine's stage, arm, detector and tube", () => {
    const d = CHAPTERS.goniometer.drive!(encode({ ...START, omega: 33 }));
    expect(d.stage?.omega).toBeCloseTo(33, 6);
    expect(d.arm).toBeCloseTo(START.armTwoTheta, 1);
    expect(d.detector).toBe("strip");
    expect(d.lambda).toBeCloseTo(START.lambda, 4);
  });
});
