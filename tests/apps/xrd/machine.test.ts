import { describe, expect, it } from "vitest";
import { CRYSTALS, dSpacing, type Vec3 } from "../../../src/apps/xrd/crystals";
import {
  apply,
  crossings,
  detectorHit,
  detectorPoint,
  detectorWidth,
  flashes,
  labVector,
  latticePoints,
  type MachineState,
  machineFor,
  PLATE,
  PRESETS,
  sphereGap,
  STRIP,
  stageAxes,
  stageMatrix,
} from "../../../src/apps/xrd/machine";

const CU = 1.5406;
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

const symmetric = (over: Partial<MachineState> = {}): MachineState => ({
  omega: 19.234,
  chi: 0,
  phi: 0,
  armTwoTheta: 38.468,
  distance: STRIP.distance,
  detector: "strip",
  lambda: CU,
  ...over,
});

describe("the stage", () => {
  it("lays the sample flat at rest and tilts it into the beam with ω", () => {
    expect(apply(stageMatrix({ omega: 0, chi: 0, phi: 0 }), [0, 1, 0])).toEqual([0, 1, 0]);
    const n = apply(stageMatrix({ omega: 90, chi: 0, phi: 0 }), [0, 1, 0]);
    // Head on: the normal points back along the beam, towards the tube.
    expect(n[0]).toBeCloseTo(-1, 9);
  });

  it("stacks the circles: χ's axis turns with ω, φ's with both", () => {
    const a = stageAxes({ omega: 30, chi: 40, phi: 10 });
    expect(a.chi[0]).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 9);
    expect(a.chi[1]).toBeCloseTo(Math.sin((30 * Math.PI) / 180), 9);
    // φ's axis is the sample's normal wherever ω and χ leave it: out of the diffraction plane.
    expect(Math.abs(a.phi[2])).toBeGreaterThan(0.5);
  });
});

describe("the machine", () => {
  it("flashes aluminium's (1 1 1) at ω = θ with the arm at 2θ, on the detector's centre", () => {
    const al = CRYSTALS.aluminium;
    const d = dSpacing(al.cell, 1, 1, 1);
    const theta = (Math.asin(CU / (2 * d)) * 180) / Math.PI;
    expect(Math.abs(theta - 19.23)).toBeLessThan(0.01);
    for (const detector of ["strip", "plate"] as const) {
      const m = machineFor(
        "aluminium",
        symmetric({
          omega: theta,
          armTwoTheta: 2 * theta,
          detector,
          distance: detector === "strip" ? 280 : 121.03,
        }),
        [1, 1, 1],
      );
      const points = latticePoints(al, 1.2);
      const f = flashes(m, points).find(
        (x) => x.point.hkl[0] === 1 && x.point.hkl[1] === 1 && x.point.hkl[2] === 1,
      );
      expect(f, detector).toBeDefined();
      expect(f!.twoTheta).toBeCloseTo(38.47, 1);
      expect(f!.hit, detector).not.toBeNull();
      expect(Math.abs(f!.hit!.fu)).toBeLessThan(1e-3);
      expect(Math.abs(f!.hit!.fv)).toBeLessThan(1e-3);
      // Away from the Bragg angle it is dark.
      const off = machineFor("aluminium", symmetric({ omega: theta + 3, detector }), [1, 1, 1]);
      expect(flashes(off, points).some((x) => x.point.hkl.join() === "1,1,1")).toBe(false);
    }
  });

  it("changes which points cross the sphere with χ and φ, never their |S|", () => {
    const al = CRYSTALS.aluminium;
    const points = latticePoints(al, 1.0);
    // Sweep ω and collect every point that crosses the sphere on the way.
    const swept = (chi: number, phi: number) => {
      const out = new Set<string>();
      for (let w = 1; w <= 90; w++) {
        const m = machineFor("aluminium", symmetric({ omega: w, chi, phi }), [0, 0, 1]);
        for (const f of crossings(m, { omega: w - 1, chi, phi }, points))
          out.add(f.point.hkl.join());
      }
      return out;
    };
    const sets = [swept(0, 0), swept(35, 0), swept(0, 50)];
    expect(sets[0]!.size).toBeGreaterThan(0);
    const key = (s: Set<string>) => [...s].sort().join(";");
    expect(new Set(sets.map(key)).size).toBeGreaterThan(1);
    for (const chi of [0, 20, 63]) {
      for (const phi of [0, 45, 170]) {
        const m = machineFor("aluminium", symmetric({ chi, phi }), [0, 0, 1]);
        for (const p of points.slice(0, 40))
          expect(len(labVector(m, p.g))).toBeCloseTo(len(p.g), 9);
      }
    }
  });

  it("catches a flash a fast turn would step over", () => {
    const al = CRYSTALS.aluminium;
    const points = latticePoints(al, 1.0);
    const m = machineFor("aluminium", symmetric({ omega: 21 }), [1, 1, 1]);
    const crossed = crossings(m, { omega: 17, chi: 0, phi: 0 }, points);
    expect(crossed.some((f) => f.point.hkl.join() === "1,1,1")).toBe(true);
  });

  it("lands a spot where s_out meets the curved strip and the flat plate", () => {
    for (const det of [STRIP, PLATE]) {
      for (const [fu, fv] of [
        [0, 0],
        [0.3, 0.2],
        [-0.45, -0.4],
      ] as const) {
        const arm = 50;
        const p = detectorPoint(det, arm, fu, fv);
        const hit = detectorHit(det, arm, p);
        expect(hit, `${det.kind} ${fu},${fv}`).not.toBeNull();
        expect(hit!.fu).toBeCloseTo(fu, 6);
        expect(hit!.fv).toBeCloseTo(fv, 6);
        for (let i = 0; i < 3; i++) expect(hit!.at[i]).toBeCloseTo(p[i]!, 6);
      }
      // Off the face, it misses.
      expect(detectorHit(det, 50, detectorPoint(det, 50, 0.7, 0))).toBeNull();
      expect(detectorHit(det, 50, [-1, 0, 0])).toBeNull();
    }
    // The strip's points all sit at the distance; the plate's centre does.
    expect(len(detectorPoint(STRIP, 40, 0.4, 0))).toBeCloseTo(STRIP.distance, 6);
    expect(len(detectorPoint(PLATE, 40, 0, 0))).toBeCloseTo(PLATE.distance, 6);
  });

  it("sizes the detectors as the presets give them", () => {
    expect(detectorWidth(STRIP)).toBeCloseTo(110.1, 6);
    expect(STRIP.rows * STRIP.pixel).toBeCloseTo(15, 6);
    expect(PLATE.thetaPixel).toBeCloseTo(0.048, 3);
    expect(detectorWidth(PLATE)).toBeCloseTo(40, 6);
    expect(PLATE.rows * PLATE.pixel).toBeCloseTo(80, 6);
  });

  it("takes the presets' round settings from presets.json", () => {
    const s = PRESETS.strip;
    expect(s.label).toBe("Curved strip");
    expect(s.stored).toEqual({
      omega: 7.5,
      chi: 0,
      phi: 90,
      twoTheta: 15,
      distance: 280,
      lambda: 1.789,
      pixel: 0.075,
    });
    // The arm holds the strip's centre: its first column plus half its 110°.
    expect(s.state.armTwoTheta).toBe(15 + 55);
    const p = PRESETS.plate;
    expect(p.label).toBe("Flat plate");
    expect(p.stored).toEqual({
      omega: 70,
      chi: 10,
      phi: 0,
      twoTheta: 0,
      distance: 120,
      lambda: 1.5406,
      pixel: 0.1,
    });
    expect(p.state.armTwoTheta).toBe(2 * p.stored.omega);
  });

  it("measures the gap to the sphere", () => {
    expect(sphereGap([0, 0, 0], CU)).toBeCloseTo(0, 12);
    expect(sphereGap([-2 / CU, 0, 0], CU)).toBeCloseTo(0, 12);
    expect(sphereGap([0.1, 0, 0], CU)).toBeGreaterThan(0);
  });
});
